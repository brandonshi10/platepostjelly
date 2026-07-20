import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { approvalMode, difficulty, missionRequirements, rewardTerms } from "./validators";
import { createPublicId, assertPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { requireServiceKey } from "./security";
import { loadCampaignByPublicId } from "./campaigns";
import { loadPlaceByPublicId, toPublicPlace } from "./places";
import { parseCanonicalRewardAmount } from "./amounts";

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

function assertValidRewardAmount(amount: string, ceilingAmount: string): void {
  const value = parseCanonicalRewardAmount(amount);
  const ceiling = parseCanonicalRewardAmount(ceilingAmount);
  if (value > ceiling) throw new Error("reward_amount_exceeds_ceiling");
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

type DiscoveryAvailability = "upcoming" | "available" | "paused" | "ended";

function discoveryAvailability(mission: any, revision: any, campaign: any, now: number): DiscoveryAvailability {
  if (mission.status === "paused") return "paused";
  const startsAt = revision.missionWindow.startsAt ?? campaign.startsAt;
  const endsAt = revision.missionWindow.endsAt ?? campaign.endsAt;
  if (now < startsAt) return "upcoming";
  if (now > endsAt) return "ended";
  return "available";
}

function discoveryHours(hours: any[] | undefined) {
  const grouped: Record<string, Array<{ opensAt: string; closesAt: string }>> = {};
  for (const weekdayName of [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]) {
    const intervals = (hours ?? [])
      .filter((interval: any) => interval.weekday === weekdayName)
      .map((interval: any) => ({
        opensAt: interval.opensAt,
        closesAt: interval.closesAt,
      }));
    if (intervals.length > 0) grouped[weekdayName] = intervals;
  }
  return grouped;
}

function submissionDisplay(submission: any) {
  if (submission.submissionStatus === "submitted") {
    return {
      displayStatus: "submitted",
      nextAction: "wait_for_verification",
      publicMessage: submission.publicMessage ?? "Your Jelly was submitted for verification.",
    };
  }
  if (submission.submissionStatus === "verifying") {
    return {
      displayStatus: "under_review",
      nextAction: "wait_for_verification",
      publicMessage: submission.publicMessage ?? "Your Jelly is being verified.",
    };
  }
  if (submission.submissionStatus === "needs_review") {
    return {
      displayStatus: "under_review",
      nextAction: "wait_for_review",
      publicMessage: submission.publicMessage ?? "Your Jelly is waiting for review.",
    };
  }
  if (submission.submissionStatus === "approved" && submission.rewardStatus === "sent") {
    return {
      displayStatus: "rewarded",
      nextAction: "view_reward",
      publicMessage: submission.publicMessage ?? "Mission approved and reward sent.",
    };
  }
  if (
    submission.submissionStatus === "approved" &&
    (submission.rewardStatus === "failed" || submission.rewardStatus === "uncertain")
  ) {
    return {
      displayStatus: "support_needed",
      nextAction: "contact_support",
      publicMessage: submission.publicMessage ?? "Your reward needs support.",
    };
  }
  if (submission.submissionStatus === "approved") {
    return {
      displayStatus: "approved_reward_pending",
      nextAction: "wait_for_reward",
      publicMessage: submission.publicMessage ?? "Mission approved. Your reward is processing.",
    };
  }
  return {
    displayStatus: "rejected",
    nextAction: "none",
    publicMessage: submission.publicMessage ?? "This submission was not approved.",
  };
}

async function discoveryViewer(
  ctx: any,
  mission: any,
  jellyUserId: string,
  availability: DiscoveryAvailability,
  now: number,
) {
  const participations = await ctx.db
    .query("jellyhuntParticipations")
    .withIndex("by_user_mission", (q: any) =>
      q.eq("jellyUserId", jellyUserId).eq("missionId", mission._id),
    )
    .collect();
  participations.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
  const participation = participations[0] ?? null;

  const submissions = await ctx.db
    .query("jellyhuntSubmissions")
    .withIndex("by_mission_user", (q: any) =>
      q.eq("missionId", mission._id).eq("jellyUserId", jellyUserId),
    )
    .collect();
  submissions.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
  const submission = submissions[0] ?? null;

  const missionAvailable = availability === "available" && mission.acceptingSubmissions;
  if (!participation) {
    const canStart = missionAvailable;
    return {
      participated: false,
      viewer: {
        participationStatus: "not_started" as const,
        participationId: null,
        missionRevision: null,
        submissionDeadlineAt: null,
        resubmissionDeadlineAt: null,
        displayStatus: "not_started",
        submissionStatus: null,
        rewardStatus: "not_eligible",
        latestSubmissionId: null,
        startedAt: null,
        canStart,
        canSubmit: false,
        canResubmit: false,
        nextAction: canStart ? "start_mission" : "none",
        publicMessage: canStart
          ? "Visit the place and start this mission in JellyJelly."
          : availability === "upcoming"
            ? "This mission is not open yet."
            : availability === "paused"
              ? "This mission is paused."
              : "This mission has ended.",
        updatedAt: null,
      },
    };
  }

  const beforeSubmissionDeadline = participation.submissionDeadlineAt > now;
  const attemptsRemain = participation.attemptsUsed < participation.maxAttempts;
  const canSubmit =
    !submission &&
    participation.status === "started" &&
    missionAvailable &&
    beforeSubmissionDeadline &&
    attemptsRemain;
  const resubmissionDeadlineAt =
    participation.resubmissionDeadlineAt ?? participation.submissionDeadlineAt;
  const canResubmit =
    submission?.submissionStatus === "rejected" &&
    participation.status === "started" &&
    missionAvailable &&
    resubmissionDeadlineAt > now &&
    attemptsRemain;
  const display = submission ? submissionDisplay(submission) : null;

  return {
    participated: true,
    viewer: {
      participationStatus: "started" as const,
      participationId: participation.publicId,
      missionRevision: participation.missionRevision,
      submissionDeadlineAt: new Date(participation.submissionDeadlineAt).toISOString(),
      resubmissionDeadlineAt:
        participation.resubmissionDeadlineAt === undefined
          ? null
          : new Date(participation.resubmissionDeadlineAt).toISOString(),
      displayStatus: display?.displayStatus ?? "in_progress",
      submissionStatus: submission?.submissionStatus ?? null,
      rewardStatus: submission?.rewardStatus ?? "not_eligible",
      latestSubmissionId: submission?.publicId ?? null,
      startedAt: new Date(participation.startedAt).toISOString(),
      canStart: false,
      canSubmit,
      canResubmit,
      nextAction: canResubmit
        ? "submit_new_post"
        : display?.nextAction ?? (canSubmit ? "submit_post" : "none"),
      publicMessage:
        display?.publicMessage ??
        (canSubmit
          ? "Publish your Jelly to complete this mission."
          : availability === "paused"
            ? "This mission is paused."
            : "This mission participation is no longer accepting submissions."),
      updatedAt: new Date(
        Math.max(participation.updatedAt, submission?.updatedAt ?? 0),
      ).toISOString(),
    },
  };
}

async function projectMissionDiscovery(
  ctx: any,
  mission: any,
  campaign: any,
  jellyUserId: string | undefined,
  now: number,
) {
  if (mission.status === "draft" || mission.status === "archived" || mission.currentRevision < 1) {
    return null;
  }
  const revision = await ctx.db
    .query("jellyhuntMissionRevisions")
    .withIndex("by_mission_revision", (q: any) =>
      q.eq("missionId", mission._id).eq("revision", mission.currentRevision),
    )
    .unique();
  if (!revision) return null;

  const place = await ctx.db.get(revision.place.placeId);
  if (!place || place.reviewStatus !== "reviewed") return null;

  const availability = discoveryAvailability(mission, revision, campaign, now);
  const viewerResult = jellyUserId
    ? await discoveryViewer(ctx, mission, jellyUserId, availability, now)
    : null;
  if (availability === "paused" && !viewerResult?.participated) return null;

  const startsAt = revision.missionWindow.startsAt ?? campaign.startsAt;
  const endsAt = revision.missionWindow.endsAt ?? campaign.endsAt;
  const publicPlace = {
    id: place.publicId,
    jellyPlaceId: revision.place.jellyPlaceId,
    name: revision.place.name,
    address: revision.place.address ?? "",
    latitude: revision.place.latitude,
    longitude: revision.place.longitude,
    timeZone: revision.place.timeZone,
    hours: discoveryHours(place.hours),
  };
  const directions =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    revision.place.latitude +
    "," +
    revision.place.longitude;

  return {
    id: mission.publicId,
    campaignId: campaign.publicId,
    slug: mission.slug,
    revision: revision.revision,
    title: revision.title,
    description: revision.description,
    instructions: revision.instructions,
    availability: {
      state: availability,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      acceptingSubmissions: availability === "available" && mission.acceptingSubmissions,
      reasonCode: availability === "paused" ? "mission_paused" : null,
    },
    reward: revision.reward,
    requirements: {
      ...revision.requirements,
      post: {
        ...revision.requirements.post,
        minDurationSeconds: revision.requirements.post.minDurationSeconds ?? 0,
        maxDurationSeconds: revision.requirements.post.maxDurationSeconds ?? 300,
      },
    },
    display: {
      category: mission.category,
      difficulty: mission.difficulty,
      emoji: mission.emoji,
      neighborhood: mission.neighborhood,
      price: mission.price,
      sortOrder: mission.sortOrder,
    },
    place: publicPlace,
    ...(viewerResult ? { viewer: viewerResult.viewer } : {}),
    links: {
      self: "/api/v2/jellyhunt/missions/" + mission.publicId,
      participation: viewerResult?.viewer.participationId
        ? "/api/v2/jellyhunt/participations/" + viewerResult.viewer.participationId
        : null,
      jellies: "/api/v2/jellyhunt/missions/" + mission.publicId + "/jellies",
      start:
        "https://platepost.io/human-social/missions/" + mission.publicId + "/start",
      directions,
    },
    updatedAt: new Date(mission.updatedAt).toISOString(),
  };
}

function assertDiscoveryViewer(args: any): string | undefined {
  if (args.jellyUserId === undefined) return undefined;
  if (!args.serviceKey) throw new Error("service_key_required");
  requireServiceKey(args.serviceKey);
  const jellyUserId = args.jellyUserId.trim();
  if (!jellyUserId) throw new Error("invalid_jelly_user_id");
  return jellyUserId;
}

export const getMissionDiscovery = queryGeneric({
  args: {
    missionPublicId: v.string(),
    serviceKey: v.optional(v.string()),
    jellyUserId: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    const missionPublicId = assertPublicId("mis", args.missionPublicId);
    const mission = await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", missionPublicId))
      .unique();
    if (!mission) return null;
    const campaign = await ctx.db.get(mission.campaignId);
    if (!campaign) return null;
    const jellyUserId = assertDiscoveryViewer(args);
    return await projectMissionDiscovery(
      ctx,
      mission,
      campaign,
      jellyUserId,
      args.now ?? Date.now(),
    );
  },
});

export const listMissionDiscovery = queryGeneric({
  args: {
    campaignPublicId: v.optional(v.string()),
    serviceKey: v.optional(v.string()),
    jellyUserId: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    const jellyUserId = assertDiscoveryViewer(args);
    const campaign = args.campaignPublicId
      ? await ctx.db
          .query("jellyhuntCampaigns")
          .withIndex("by_public_id", (q: any) =>
            q.eq("publicId", assertPublicId("cam", args.campaignPublicId)),
          )
          .unique()
      : await ctx.db
          .query("jellyhuntCampaigns")
          .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true))
          .unique();
    if (!campaign) return null;

    const rows = await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaign._id))
      .collect();
    const projected = await Promise.all(
      rows.map((mission: any) =>
        projectMissionDiscovery(
          ctx,
          mission,
          campaign,
          jellyUserId,
          args.now ?? Date.now(),
        ),
      ),
    );
    return {
      catalogRevision: campaign.catalogRevision,
      missions: projected.filter((mission: any) => mission !== null),
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
    assertValidRewardAmount(args.reward.amount, MAX_REWARD_CEILING_AMOUNT);
    if (args.budgetAllocation !== undefined) {
      parseCanonicalRewardAmount(args.budgetAllocation);
    }
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
    if (args.reward !== undefined) {
      assertValidRewardAmount(args.reward.amount, MAX_REWARD_CEILING_AMOUNT);
    }
    if (args.budgetAllocation !== undefined) {
      parseCanonicalRewardAmount(args.budgetAllocation);
    }
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
      approvalMode: mission.approvalMode,
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
