import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { approvalMode, difficulty, missionRequirements, rewardTerms } from "./validators";
import { createPublicId, assertPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { requireServiceKey } from "./security";
import { loadCampaignByPublicId } from "./campaigns";
import { loadPlaceByPublicId, toPublicPlace } from "./places";

/**
 * Draft mission CRUD, immutable publish-time revisioning, and lifecycle
 * changes for the namespaced JellyHunt Convex schema. See
 * `convex/jellyhunt/audit.ts` for why these use `convex/server`'s generic
 * `mutationGeneric`/`queryGeneric` builders instead of a generated
 * `./_generated/server` (codegen has not run in this repo yet).
 *
 * `jellyhuntMissions` only stores the current *mutable draft* fields
 * (title, category, reward, schedule, ...); it deliberately has no
 * `description`/`instructions`/`requirements` columns of its own — those
 * only ever exist as an immutable snapshot inside `jellyhuntMissionRevisions`.
 * Editing the draft (`updateMissionDraft`) therefore can never touch a
 * previously published revision row, and publishing
 * (`publishMissionRevision`) is what turns the current draft content plus
 * the caller-supplied long-form content into the next immutable revision.
 */

/** Design-doc "command envelope": the identity + optimistic-concurrency fields for publish. */
export type PublishMissionCommand = {
  missionPublicId: string;
  expectedDraftRevision: number;
  actorId: string;
};

/**
 * Sanity ceiling on a single mission's reward amount, expressed in the same
 * decimal-string units as `reward.amount` (`JELLY-MY-JELLY`, 6 decimals).
 * This is a conservative operator guard against a fat-fingered admin entry,
 * not a budget/allocation system (that lives in `jellyhuntRewardBudgets`,
 * out of this task's scope).
 */
export const MAX_REWARD_CEILING_AMOUNT = "1000";

const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

function assertValidRewardAmount(amount: string, ceilingAmount: string): void {
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) throw new Error("invalid_reward_amount_format");
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_reward_amount_format");
  if (value > Number(ceilingAmount)) throw new Error("reward_amount_exceeds_ceiling");
}

function assertStructuredRequirements(requirements: any): void {
  if (!Array.isArray(requirements.post.allowedPostTypes) || requirements.post.allowedPostTypes.length === 0) {
    throw new Error("invalid_mission_requirements");
  }
  if (!Number.isInteger(requirements.resubmission.maxAttempts) || requirements.resubmission.maxAttempts < 1) {
    throw new Error("invalid_mission_requirements");
  }
}

function assertValidWindow(window: { startsAt?: number; endsAt?: number }): void {
  if (window.startsAt !== undefined && window.endsAt !== undefined && window.startsAt >= window.endsAt) {
    throw new Error("invalid_mission_window");
  }
}

/** Internal helper (not exported as a Convex function): load a mission row by its public ID or throw. */
export async function loadMissionByPublicId(ctx: any, missionPublicId: string) {
  const normalized = assertPublicId("mis", missionPublicId);
  const mission = await ctx.db
    .query("jellyhuntMissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!mission) throw new Error("mission_not_found");
  return mission;
}

/** Internal helper: a mission may only become/stay `active` behind a reviewed canonical Jelly place. */
async function assertPlaceReviewed(ctx: any, placeId: any) {
  const place = await ctx.db.get(placeId);
  if (!place) throw new Error("place_not_found");
  if (place.reviewStatus !== "reviewed") throw new Error("place_not_reviewed");
  return place;
}

/**
 * Public: current mission detail by public ID.
 *
 * This query has no `serviceKey` gate, so it must never return a raw
 * `jellyhuntMissions` row: that row carries internal-only fields
 * (`geofenceRadiusMeters` via the place link, `approvalMode`,
 * `budgetAllocation`, `createdBy`, legacy IDs, Convex `_id`/`_creationTime`)
 * and can describe a draft/unpublished mission. Instead this returns `null`
 * for any mission that has never published a revision or whose lifecycle is
 * outside `active`/`paused` (`draft` and `archived` are never visible here),
 * and otherwise a projected public-safe shape built from the mission's
 * current published revision and its reviewed place.
 */
export const getMissionByPublicId = queryGeneric({
  args: { missionPublicId: v.string() },
  handler: async (ctx: any, args: any) => {
    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status !== "active" && mission.status !== "paused") return null;
    if (mission.currentRevision < 1) return null;

    const revision = await ctx.db
      .query("jellyhuntMissionRevisions")
      .withIndex("by_mission_revision", (q: any) =>
        q.eq("missionId", mission._id).eq("revision", mission.currentRevision),
      )
      .unique();
    if (!revision) return null;

    const campaign = await ctx.db.get(mission.campaignId);
    if (!campaign) return null;

    const place = await ctx.db.get(mission.placeId);
    if (!place || place.reviewStatus !== "reviewed") return null;

    return {
      id: mission.publicId,
      campaignId: campaign.publicId,
      slug: mission.slug,
      revision: mission.currentRevision,
      title: mission.title,
      description: revision.description,
      instructions: revision.instructions,
      availability: {
        state: mission.status,
        startsAt: mission.startsAt,
        endsAt: mission.endsAt,
        acceptingSubmissions: mission.acceptingSubmissions,
      },
      reward: mission.reward,
      requirements: revision.requirements,
      display: {
        category: mission.category,
        difficulty: mission.difficulty,
        emoji: mission.emoji,
        neighborhood: mission.neighborhood,
        price: mission.price,
        sortOrder: mission.sortOrder,
      },
      place: toPublicPlace(place),
      updatedAt: mission.updatedAt,
    };
  },
});

/** Admin/service-only: create a draft mission. Draft missions never accept submissions. */
export const createDraftMission = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    campaignPublicId: v.string(),
    placePublicId: v.string(),
    slug: v.string(),
    title: v.string(),
    category: v.string(),
    difficulty,
    emoji: v.string(),
    neighborhood: v.string(),
    price: v.string(),
    sortOrder: v.number(),
    reward: rewardTerms,
    approvalMode,
    budgetAllocation: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();

    const campaign = await loadCampaignByPublicId(ctx, args.campaignPublicId);
    if (campaign.status === "archived") throw new Error("campaign_archived_cannot_add_mission");

    const place = await loadPlaceByPublicId(ctx, args.placePublicId);

    const existingSlug = await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_slug", (q: any) => q.eq("slug", args.slug))
      .unique();
    if (existingSlug) throw new Error("mission_slug_already_exists");

    const now = Date.now();
    const publicId = createPublicId("mis");
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId,
      campaignId: campaign._id,
      slug: args.slug,
      status: "draft",
      approvalMode: args.approvalMode,
      currentRevision: 0,
      title: args.title,
      category: args.category,
      difficulty: args.difficulty,
      emoji: args.emoji,
      neighborhood: args.neighborhood,
      price: args.price,
      sortOrder: args.sortOrder,
      placeId: place._id,
      reward: args.reward,
      acceptingSubmissions: false,
      budgetAllocation: args.budgetAllocation,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.draft_created",
      entityType: "mission",
      entityId: missionId,
      nextState: { publicId, slug: args.slug, status: "draft" },
      requestId: args.requestId,
    });

    return publicId;
  },
});

/**
 * Admin/service-only: edit the mission's mutable draft fields.
 *
 * This never inserts into or mutates `jellyhuntMissionRevisions` and never
 * changes `currentRevision` — a previously published revision snapshot
 * (locked into any started participation/submission) is therefore
 * unaffected by this call. Publishing again is required to turn these
 * edits into a new immutable revision.
 */
export const updateMissionDraft = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    missionPublicId: v.string(),
    expectedRevision: v.number(),
    title: v.optional(v.string()),
    category: v.optional(v.string()),
    difficulty: v.optional(difficulty),
    emoji: v.optional(v.string()),
    neighborhood: v.optional(v.string()),
    price: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    reward: v.optional(rewardTerms),
    budgetAllocation: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();
    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status === "archived") throw new Error("mission_archived_cannot_edit");
    if (mission.currentRevision !== args.expectedRevision) throw new Error("draft_revision_conflict");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const previousState: Record<string, unknown> = {};
    const nextState: Record<string, unknown> = {};
    for (const field of ["title", "category", "difficulty", "emoji", "neighborhood", "price", "sortOrder", "reward", "budgetAllocation"] as const) {
      if (args[field] !== undefined) {
        previousState[field] = (mission as any)[field];
        nextState[field] = args[field];
        patch[field] = args[field];
      }
    }

    await ctx.db.patch(mission._id, patch);

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.draft_updated",
      entityType: "mission",
      entityId: mission._id,
      previousState,
      nextState,
      requestId: args.requestId,
    });

    return mission.publicId;
  },
});

/**
 * Admin/service-only: publish the current draft as a new immutable
 * revision, and (re)activate the mission.
 *
 * Validates, in order: the mission/campaign public IDs, the expected draft
 * revision (optimistic concurrency against `currentRevision`), the current
 * reward ceiling, the place's review status, campaign ownership (the
 * mission's own campaign must exist and not be archived), the mission
 * window, and the structured requirements. On success it inserts one
 * `jellyhuntMissionRevisions` row, advances the mission's published
 * revision pointer and lifecycle to `active`, increments the campaign's
 * `catalogRevision`, and appends one audit event — all in the same
 * transaction.
 */
export const publishMissionRevision = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    missionPublicId: v.string(),
    expectedDraftRevision: v.number(),
    content: v.object({
      title: v.string(),
      description: v.string(),
      instructions: v.array(v.string()),
      requirements: missionRequirements,
      reward: rewardTerms,
      missionWindow: v.object({
        startsAt: v.optional(v.number()),
        endsAt: v.optional(v.number()),
      }),
    }),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();

    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status === "archived") throw new Error("mission_archived_cannot_publish");
    if (mission.currentRevision !== args.expectedDraftRevision) throw new Error("draft_revision_conflict");

    assertValidRewardAmount(args.content.reward.amount, MAX_REWARD_CEILING_AMOUNT);

    const place = await assertPlaceReviewed(ctx, mission.placeId);

    const campaign = await ctx.db.get(mission.campaignId);
    if (!campaign) throw new Error("campaign_not_found");
    if (campaign.status === "archived") throw new Error("campaign_archived_cannot_publish");

    assertValidWindow(args.content.missionWindow);
    assertStructuredRequirements(args.content.requirements);

    const now = Date.now();
    const newRevision = mission.currentRevision + 1;
    const revisionPublicId = createPublicId("mrv");

    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: revisionPublicId,
      missionId: mission._id,
      revision: newRevision,
      title: args.content.title,
      description: args.content.description,
      instructions: args.content.instructions,
      requirements: args.content.requirements,
      reward: args.content.reward,
      place: {
        placeId: place._id,
        jellyPlaceId: place.jellyPlaceId,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        geofenceRadiusMeters: place.geofenceRadiusMeters,
        timeZone: place.timeZone,
      },
      missionWindow: args.content.missionWindow,
      createdBy: actorId,
      createdAt: now,
    });

    const previousMissionState = { currentRevision: mission.currentRevision, status: mission.status };
    await ctx.db.patch(mission._id, {
      currentRevision: newRevision,
      title: args.content.title,
      reward: args.content.reward,
      startsAt: args.content.missionWindow.startsAt,
      endsAt: args.content.missionWindow.endsAt,
      status: "active",
      acceptingSubmissions: true,
      updatedAt: now,
    });

    await ctx.db.patch(campaign._id, {
      catalogRevision: campaign.catalogRevision + 1,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.published",
      entityType: "mission",
      entityId: mission._id,
      previousState: previousMissionState,
      nextState: { currentRevision: newRevision, status: "active", revisionPublicId },
      requestId: args.requestId,
    });

    return { missionPublicId: mission.publicId, revisionPublicId, revision: newRevision };
  },
});

/**
 * Admin/service-only: pause, archive, or reactivate a mission.
 *
 * Pausing/archiving preserves every existing revision, participation, and
 * audit row (nothing is deleted or rewritten) and only flips
 * `acceptingSubmissions` off so new starts are blocked while owner history
 * remains intact. Reactivating back to `active` re-validates the place's
 * review status and requires at least one prior publish. `status` is
 * deliberately restricted to `active|paused|archived`: this mutation is a
 * post-publish lifecycle toggle, never a way to demote an already-published
 * mission back to `draft` (only `createDraftMission` may create a `draft`
 * mission).
 */
export const setMissionLifecycle = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    missionPublicId: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();
    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status === args.status) return mission.publicId;

    if (args.status === "active") {
      if (mission.currentRevision < 1) throw new Error("mission_has_no_published_revision");
      await assertPlaceReviewed(ctx, mission.placeId);
    }

    const previousStatus = mission.status;
    await ctx.db.patch(mission._id, {
      status: args.status,
      acceptingSubmissions: args.status === "active",
      updatedAt: Date.now(),
    });

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.lifecycle_changed",
      entityType: "mission",
      entityId: mission._id,
      previousState: { status: previousStatus },
      nextState: { status: args.status },
      requestId: args.requestId,
    });

    return mission.publicId;
  },
});
