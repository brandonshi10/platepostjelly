import {
  anyApi,
  mutationGeneric,
  queryGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { approvalMode, difficulty, lifecycle } from "./validators";
import { assertPublicId, createPublicId } from "./publicIds";
import { requireServiceKey } from "./security";
import { recordAuditEvent } from "./audit";
import {
  formatCanonicalRewardAmount,
  parseCanonicalRewardAmount,
} from "./amounts";
import { appendSubmissionEventInternal } from "./events";
import {
  getOrCreateBudgetInternal,
  transitionSubmissionBudgetsInternal,
} from "./budgets";

const ADMIN_REJECTION_PUBLIC_MESSAGE =
  "This submission did not meet the mission requirements. You can submit another eligible Jelly post.";

const weekdays = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

const locationInput = v.object({
  name: v.string(),
  address: v.optional(v.string()),
  jellyRestaurantId: v.optional(v.string()),
  latitude: v.number(),
  longitude: v.number(),
  geofenceRadiusMeters: v.number(),
  timeZone: v.string(),
});

const missionInput = v.object({
  slug: v.string(),
  title: v.string(),
  description: v.string(),
  status: lifecycle,
  approvalMode,
  restaurantTag: v.string(),
  rewardAmount: v.number(),
  category: v.string(),
  difficulty,
  emoji: v.string(),
  shotType: v.optional(v.string()),
  neighborhood: v.string(),
  price: v.string(),
  hours: v.array(v.string()),
  venueType: v.optional(v.string()),
  showtimes: v.optional(v.array(v.string())),
  sortOrder: v.number(),
  websiteUrl: v.optional(v.string()),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
});
const budgetInput = v.optional(
  v.object({
    campaignAllocatedAmount: v.string(),
    missionAllocatedAmount: v.string(),
    expectedCampaignRevision: v.number(),
    expectedMissionRevision: v.number(),
  }),
);

type AdminLocationInput = {
  name: string;
  address?: string;
  jellyRestaurantId?: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  timeZone: string;
};

type AdminBudgetInput = {
  campaignAllocatedAmount: string;
  missionAllocatedAmount: string;
  expectedCampaignRevision: number;
  expectedMissionRevision: number;
};

type AdminMissionInput = {
  slug: string;
  title: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  approvalMode: "manual" | "automatic";
  restaurantTag: string;
  rewardAmount: number;
  category: string;
  difficulty: "easy" | "medium" | "hard" | "legendary";
  emoji: string;
  shotType?: string;
  neighborhood: string;
  price: string;
  hours: string[];
  venueType?: string;
  showtimes?: string[];
  sortOrder: number;
  websiteUrl?: string;
  startsAt?: number;
  endsAt?: number;
};

function required(value: string, code: string): string {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(code);
  return cleaned;
}

function optional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function canonicalRewardAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_reward_amount");
  const parsed = parseCanonicalRewardAmount(String(value));
  if (parsed > parseCanonicalRewardAmount("1000")) {
    throw new Error("reward_amount_exceeds_ceiling");
  }
  return formatCanonicalRewardAmount(parsed);
}

function validateLegacyHours(hours: string[]): void {
  if (
    hours.length !== 7 ||
    hours.some((entry) =>
      entry !== "closed" &&
      !/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry))
  ) {
    throw new Error("invalid_operating_hours");
  }
}

function toStructuredHours(hours: string[]) {
  validateLegacyHours(hours);
  return hours.flatMap((entry, index) => {
    if (entry === "closed") return [];
    const [opensAt, closesAt] = entry.split("-");
    return [{ weekday: weekdays[index], opensAt, closesAt }];
  });
}

function toLegacyHours(hours: any[] | undefined): string[] {
  return weekdays.map((weekday) => {
    const interval = (hours ?? []).find((item: any) => item.weekday === weekday);
    return interval ? `${interval.opensAt}-${interval.closesAt}` : "closed";
  });
}

function cleanMission(input: AdminMissionInput): AdminMissionInput {
  const cleaned = {
    ...input,
    slug: required(input.slug, "invalid_mission_slug"),
    title: required(input.title, "invalid_mission_title"),
    description: required(input.description, "invalid_mission_description"),
    restaurantTag: required(input.restaurantTag, "invalid_restaurant_tag"),
    category: required(input.category, "invalid_mission_category"),
    emoji: required(input.emoji, "invalid_mission_emoji"),
    neighborhood: input.neighborhood.trim(),
    price: input.price.trim(),
    venueType: optional(input.venueType),
    websiteUrl: optional(input.websiteUrl),
    showtimes: input.showtimes?.map((showtime) => showtime.trim()),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cleaned.slug)) {
    throw new Error("invalid_mission_slug");
  }
  if (!Number.isInteger(cleaned.sortOrder) || cleaned.sortOrder < 0) {
    throw new Error("invalid_sort_order");
  }
  if (
    cleaned.startsAt !== undefined &&
    cleaned.endsAt !== undefined &&
    cleaned.startsAt >= cleaned.endsAt
  ) {
    throw new Error("invalid_mission_window");
  }
  validateLegacyHours(cleaned.hours);
  canonicalRewardAmount(cleaned.rewardAmount);
  return cleaned;
}

function cleanLocation(input: AdminLocationInput, restaurantTag: string) {
  if (
    !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 ||
    !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180
  ) {
    throw new Error("invalid_place_coordinates");
  }
  if (!Number.isFinite(input.geofenceRadiusMeters) || input.geofenceRadiusMeters <= 0) {
    throw new Error("invalid_geofence_radius");
  }
  return {
    name: required(input.name, "invalid_place_name"),
    address: optional(input.address),
    jellyPlaceId:
      optional(input.jellyRestaurantId) ?? required(restaurantTag, "invalid_restaurant_tag"),
    latitude: input.latitude,
    longitude: input.longitude,
    geofenceRadiusMeters: input.geofenceRadiusMeters,
    timeZone: required(input.timeZone, "invalid_place_time_zone"),
  };
}

async function maybeCurrentCampaign(ctx: any) {
  return await ctx.db
    .query("jellyhuntCampaigns")
    .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true))
    .unique();
}

async function currentCampaign(ctx: any) {
  const campaign = await maybeCurrentCampaign(ctx);
  if (!campaign) throw new Error("current_campaign_not_configured");
  if (campaign.status === "archived") throw new Error("current_campaign_archived");
  return campaign;
}

async function loadMission(ctx: any, missionPublicId: string) {
  const publicId = assertPublicId("mis", missionPublicId);
  const mission = await ctx.db
    .query("jellyhuntMissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", publicId))
    .unique();
  if (!mission) throw new Error("mission_not_found");
  return mission;
}

async function loadPlace(ctx: any, placePublicId: string) {
  const publicId = assertPublicId("plc", placePublicId);
  const place = await ctx.db
    .query("jellyhuntPlaces")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", publicId))
    .unique();
  if (!place) throw new Error("place_not_found");
  return place;
}

async function ensureUniqueSlug(ctx: any, slug: string, exceptId?: any) {
  const existing = await ctx.db
    .query("jellyhuntMissions")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .unique();
  if (existing && existing._id !== exceptId) throw new Error("mission_slug_already_exists");
}

async function ensureUniqueJellyPlace(ctx: any, jellyPlaceId: string, exceptId?: any) {
  const existing = await ctx.db
    .query("jellyhuntPlaces")
    .withIndex("by_jelly_place_id", (q: any) => q.eq("jellyPlaceId", jellyPlaceId))
    .unique();
  if (existing && existing._id !== exceptId) {
    throw new Error("place_already_linked_to_jelly_place_id");
  }
}

function rewardTerms(rewardAmount: number) {
  return {
    amount: canonicalRewardAmount(rewardAmount),
    token: "JELLY-MY-JELLY" as const,
    displayName: "Jelly-My-Jelly",
  };
}

/**
 * Filming rules per shot type.
 *
 * Deliberately a second copy of `src/lib/jellyhunt/shot-types.ts`: Convex
 * modules cannot import from `src/`, and a build step for five strings costs
 * more than it saves. `tests/jellyhunt-shot-types.test.ts` reads this file and
 * fails if the two ever disagree.
 */
const SHOT_TYPE_RULES: Record<
  string,
  { instruction: string; minDurationSeconds: number; maxDurationSeconds: number }
> = {
  dish: {
    instruction:
      "One plated item. Hold the phone steady and make a single close pass over it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  spread: {
    instruction:
      "The whole table. Show the scale first, then pan slowly across everything on it.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  action: {
    instruction:
      "Something being made. Start filming before it starts and don't cut away early.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  display: {
    instruction:
      "The case or counter. One slow pass, keeping the whole display in frame.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  ritual: {
    instruction:
      "The moment people come here for. One take, and film the person doing it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
};

function requirements(mission: AdminMissionInput) {
  const rule = mission.shotType ? SHOT_TYPE_RULES[mission.shotType] : undefined;
  if (mission.shotType && !rule) throw new Error("invalid_shot_type");

  return {
    post: {
      allowedPostTypes: ["video"],
      authorshipPolicy: "canonical_owner",
      // Without a shot type this stays the legacy restaurantTag, so the 16
      // pre-existing missions keep the exact requirements they were created with.
      prompt: rule ? rule.instruction : mission.restaurantTag,
      ...(rule
        ? {
            minDurationSeconds: rule.minDurationSeconds,
            maxDurationSeconds: rule.maxDurationSeconds,
          }
        : {}),
      requiredVisibility: "public",
    },
    place: { attachmentRequired: true },
    location: { required: true, trustedSource: "jelly_post" },
    schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
    resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
  };
}

function placeSnapshot(placeId: any, location: ReturnType<typeof cleanLocation>) {
  return {
    placeId,
    jellyPlaceId: location.jellyPlaceId,
    name: location.name,
    address: location.address,
    latitude: location.latitude,
    longitude: location.longitude,
    geofenceRadiusMeters: location.geofenceRadiusMeters,
    timeZone: location.timeZone,
  };
}

function legacyDisplay(mission: AdminMissionInput) {
  return {
    restaurantTag: mission.restaurantTag,
    hours: mission.hours,
    venueType: mission.venueType,
    showtimes: mission.showtimes,
    websiteUrl: mission.websiteUrl,
  };
}

async function bumpCatalog(ctx: any, campaign: any, now: number) {
  await ctx.db.patch(campaign._id, {
    catalogRevision: campaign.catalogRevision + 1,
    updatedAt: now,
  });
}

function canonicalBudgetAllocation(value: string): string {
  const cleaned = required(value, "invalid_budget_allocation");
  try {
    return formatCanonicalRewardAmount(
      parseCanonicalRewardAmount(cleaned, { allowZero: true }),
    );
  } catch {
    throw new Error("invalid_budget_allocation");
  }
}

function assertBudgetRevision(value: number, code: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(code);
}

function budgetAmountAtomic(value: string): bigint {
  return parseCanonicalRewardAmount(value, { allowZero: true });
}

function projectBudget(budget?: any) {
  const allocatedAmount = budget?.allocatedAmount ?? "0";
  const reservedAmount = budget?.reservedAmount ?? "0";
  const paidAmount = budget?.paidAmount ?? "0";
  const releasedAmount = budget?.releasedAmount ?? "0";
  const remaining =
    budgetAmountAtomic(allocatedAmount) -
    budgetAmountAtomic(reservedAmount) -
    budgetAmountAtomic(paidAmount);
  if (remaining < 0n) throw new Error("budget_commitment_exceeds_allocation");
  return {
    allocatedAmount,
    reservedAmount,
    paidAmount,
    releasedAmount,
    remainingAmount: formatCanonicalRewardAmount(remaining),
    revision: budget?.revision ?? 0,
  };
}

async function findBudget(ctx: any, scopeType: "campaign" | "mission", scopeKey: string) {
  return await ctx.db
    .query("jellyhuntRewardBudgets")
    .withIndex("by_scope", (q: any) =>
      q.eq("scopeType", scopeType).eq("scopeKey", scopeKey))
    .unique();
}

async function missionBudgetState(ctx: any, campaign: any, mission: any, rewardAmount: string) {
  const [campaignRow, missionRow] = await Promise.all([
    findBudget(ctx, "campaign", campaign.publicId),
    findBudget(ctx, "mission", mission.publicId),
  ]);
  const campaignBudget = projectBudget(campaignRow);
  const missionBudget = projectBudget(missionRow);
  const reward = parseCanonicalRewardAmount(rewardAmount);
  const hasCapacity =
    budgetAmountAtomic(campaignBudget.remainingAmount) >= reward &&
    budgetAmountAtomic(missionBudget.remainingAmount) >= reward;
  const isUnfunded =
    budgetAmountAtomic(campaignBudget.allocatedAmount) === 0n ||
    budgetAmountAtomic(missionBudget.allocatedAmount) === 0n;
  return {
    campaign: campaignBudget,
    mission: missionBudget,
    capacityStatus: hasCapacity ? "funded" : isUnfunded ? "unfunded" : "insufficient",
  };
}

async function applyMissionBudgets(
  ctx: any,
  campaign: any,
  mission: any,
  command: AdminBudgetInput | undefined,
  rewardAmount: string,
  requireCapacity: boolean,
  now: number,
) {
  let campaignBudget = await getOrCreateBudgetInternal(ctx, {
    scopeType: "campaign",
    scopeKey: campaign.publicId,
    campaignId: campaign._id,
  });
  let missionBudget = await getOrCreateBudgetInternal(ctx, {
    scopeType: "mission",
    scopeKey: mission.publicId,
    campaignId: campaign._id,
    missionId: mission._id,
  });
  if (!campaignBudget || !missionBudget) throw new Error("budget_scope_not_found");

  if (command) {
    assertBudgetRevision(command.expectedCampaignRevision, "invalid_campaign_budget_revision");
    assertBudgetRevision(command.expectedMissionRevision, "invalid_mission_budget_revision");
    if (campaignBudget.revision !== command.expectedCampaignRevision) {
      throw new Error("campaign_budget_revision_conflict");
    }
    if (missionBudget.revision !== command.expectedMissionRevision) {
      throw new Error("mission_budget_revision_conflict");
    }

    const campaignAllocatedAmount = canonicalBudgetAllocation(
      command.campaignAllocatedAmount,
    );
    const missionAllocatedAmount = canonicalBudgetAllocation(
      command.missionAllocatedAmount,
    );
    if (
      budgetAmountAtomic(campaignAllocatedAmount) <
      budgetAmountAtomic(campaignBudget.reservedAmount) + budgetAmountAtomic(campaignBudget.paidAmount)
    ) {
      throw new Error("campaign_allocation_below_committed");
    }
    if (
      budgetAmountAtomic(missionAllocatedAmount) <
      budgetAmountAtomic(missionBudget.reservedAmount) + budgetAmountAtomic(missionBudget.paidAmount)
    ) {
      throw new Error("mission_allocation_below_committed");
    }

    await ctx.db.patch(campaignBudget._id, {
      allocatedAmount: campaignAllocatedAmount,
      revision: campaignBudget.revision + 1,
      updatedAt: now,
    });
    await ctx.db.patch(missionBudget._id, {
      allocatedAmount: missionAllocatedAmount,
      revision: missionBudget.revision + 1,
      updatedAt: now,
    });
    campaignBudget = {
      ...campaignBudget,
      allocatedAmount: campaignAllocatedAmount,
      revision: campaignBudget.revision + 1,
      updatedAt: now,
    };
    missionBudget = {
      ...missionBudget,
      allocatedAmount: missionAllocatedAmount,
      revision: missionBudget.revision + 1,
      updatedAt: now,
    };
  }

  const projected = {
    campaign: projectBudget(campaignBudget),
    mission: projectBudget(missionBudget),
  };
  const reward = parseCanonicalRewardAmount(rewardAmount);
  if (
    requireCapacity &&
    (budgetAmountAtomic(projected.campaign.remainingAmount) < reward ||
      budgetAmountAtomic(projected.mission.remainingAmount) < reward)
  ) {
    throw new Error("reward_budget_capacity_required");
  }
  return projected;
}

async function currentRevision(ctx: any, mission: any) {
  if (mission.currentRevision < 1) return null;
  return await ctx.db
    .query("jellyhuntMissionRevisions")
    .withIndex("by_mission_revision", (q: any) =>
      q.eq("missionId", mission._id).eq("revision", mission.currentRevision))
    .unique();
}

async function projectMission(ctx: any, mission: any) {
  const revision = await currentRevision(ctx, mission);
  const place = await ctx.db.get(mission.placeId);
  if (!revision || !place) return null;
  const display = revision.legacyDisplay;
  return {
    _id: mission.publicId,
    slug: mission.slug,
    title: revision.title,
    description: revision.description,
    status: mission.status,
    approvalMode: revision.approvalMode ?? mission.approvalMode,
    restaurantTag: display?.restaurantTag ?? revision.requirements.post.prompt,
    rewardAmount: Number(revision.reward.amount),
    rewardToken: revision.reward.token,
    category: mission.category,
    difficulty: mission.difficulty,
    emoji: mission.emoji,
    neighborhood: mission.neighborhood,
    price: mission.price,
    hours: display?.hours ?? toLegacyHours(place.hours),
    venueType: display?.venueType,
    showtimes: display?.showtimes,
    sortOrder: mission.sortOrder,
    websiteUrl: display?.websiteUrl,
    startsAt: revision.missionWindow.startsAt,
    endsAt: revision.missionWindow.endsAt,
    location: {
      _id: place.publicId,
      name: place.name,
      address: place.address,
      jellyRestaurantId: place.jellyPlaceId,
      latitude: place.latitude,
      longitude: place.longitude,
      geofenceRadiusMeters: place.geofenceRadiusMeters,
      timeZone: place.timeZone,
    },
  };
}

function legacySubmissionStatus(submission: any): string {
  if (submission.submissionStatus !== "approved") return submission.submissionStatus;
  if (submission.rewardStatus === "queued" || submission.rewardStatus === "processing") {
    return "reward_queued";
  }
  if (submission.rewardStatus === "sent") return "reward_sent";
  if (submission.rewardStatus === "failed") return "reward_failed";
  if (submission.rewardStatus === "uncertain") return "reward_uncertain";
  return "approved";
}

async function latestUserStatus(ctx: any, mission: any, jellyUserId: string) {
  const rows = await ctx.db
    .query("jellyhuntSubmissions")
    .withIndex("by_mission_user", (q: any) =>
      q.eq("missionId", mission._id).eq("jellyUserId", jellyUserId))
    .collect();
  rows.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
  const submission = rows[0];
  if (!submission) return { missionId: mission.publicId, status: "not_started" };
  return {
    missionId: mission.publicId,
    status: legacySubmissionStatus(submission),
    submissionId: submission.publicId,
    jellyPostId: submission.jellyPostId,
    rejectionReason: submission.rejectionReason,
    rewardTransactionId: submission.rewardTransactionId,
  };
}

export const listAdminMissions = queryGeneric({
  args: { serviceKey: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const campaign = await maybeCurrentCampaign(ctx);
    if (!campaign) return [];
    const rows = await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaign._id))
      .collect();
    rows.sort((a: any, b: any) => a.sortOrder - b.sortOrder || b.updatedAt - a.updatedAt);
    return (
      await Promise.all(rows.map(async (row: any) => {
        const mission = await projectMission(ctx, row);
        if (!mission) return null;
        return {
          ...mission,
          budgets: await missionBudgetState(ctx, campaign, row, row.reward.amount),
        };
      }))
    ).filter(Boolean);
  },
});

export const getAdminBudgetContext = queryGeneric({
  args: { serviceKey: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const campaign = await maybeCurrentCampaign(ctx);
    if (!campaign) return null;
    const campaignBudget = await findBudget(ctx, "campaign", campaign.publicId);
    return {
      campaignId: campaign.publicId,
      campaign: projectBudget(campaignBudget),
    };
  },
});

export const listV1Missions = queryGeneric({
  args: {
    now: v.number(),
    serviceKey: v.optional(v.string()),
    jellyUserId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("invalid_current_time");
    let jellyUserId: string | undefined;
    if (args.jellyUserId !== undefined) {
      if (!args.serviceKey) throw new Error("service_key_required");
      requireServiceKey(args.serviceKey);
      jellyUserId = required(args.jellyUserId, "invalid_jelly_user_id");
    }
    const campaign = await maybeCurrentCampaign(ctx);
    if (!campaign) return { missions: [], ...(jellyUserId ? { userStatus: [] } : {}) };
    const rows = await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_campaign_status", (q: any) =>
        q.eq("campaignId", campaign._id).eq("status", "active"))
      .collect();
    const visible = rows
      .filter((mission: any) =>
        mission.currentRevision >= 1 &&
        mission.acceptingSubmissions &&
        (mission.startsAt === undefined || mission.startsAt <= args.now) &&
        (mission.endsAt === undefined || mission.endsAt >= args.now))
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const missions = (
      await Promise.all(visible.map((row: any) => projectMission(ctx, row)))
    ).filter(Boolean);
    const userStatus = jellyUserId
      ? await Promise.all(visible.map((row: any) => latestUserStatus(ctx, row, jellyUserId)))
      : undefined;
    return { missions, ...(userStatus ? { userStatus } : {}) };
  },
});
export const createMissionWithLocation = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    mission: missionInput,
    location: locationInput,
    budgets: budgetInput,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const campaign = await currentCampaign(ctx);
    const mission = cleanMission(args.mission);
    const location = cleanLocation(args.location, mission.restaurantTag);
    await ensureUniqueSlug(ctx, mission.slug);
    await ensureUniqueJellyPlace(ctx, location.jellyPlaceId);

    const now = Date.now();
    const placePublicId = createPublicId("plc");
    const placeId = await ctx.db.insert("jellyhuntPlaces", {
      publicId: placePublicId,
      jellyPlaceId: location.jellyPlaceId,
      name: location.name,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      geofenceRadiusMeters: location.geofenceRadiusMeters,
      timeZone: location.timeZone,
      hours: toStructuredHours(mission.hours),
      reviewStatus: "reviewed",
      createdAt: now,
      updatedAt: now,
    });

    const missionPublicId = createPublicId("mis");
    const reward = rewardTerms(mission.rewardAmount);
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId: missionPublicId,
      campaignId: campaign._id,
      legacySlug: mission.slug,
      slug: mission.slug,
      status: mission.status,
      approvalMode: mission.approvalMode,
      currentRevision: 1,
      title: mission.title,
      category: mission.category,
      difficulty: mission.difficulty,
      emoji: mission.emoji,
      neighborhood: mission.neighborhood,
      price: mission.price,
      sortOrder: mission.sortOrder,
      placeId,
      reward,
      acceptingSubmissions: mission.status === "active",
      startsAt: mission.startsAt,
      endsAt: mission.endsAt,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });

    const appliedBudgets = await applyMissionBudgets(
      ctx,
      campaign,
      { _id: missionId, publicId: missionPublicId },
      args.budgets,
      reward.amount,
      mission.status === "active",
      now,
    );
    await ctx.db.patch(missionId, {
      budgetAllocation: appliedBudgets.mission.allocatedAmount,
    });

    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: createPublicId("mrv"),
      missionId,
      revision: 1,
      title: mission.title,
      description: mission.description,
      instructions: [mission.description],
      requirements: requirements(mission),
      approvalMode: mission.approvalMode,
      reward,
      place: placeSnapshot(placeId, location),
      missionWindow: { startsAt: mission.startsAt, endsAt: mission.endsAt },
      legacyDisplay: legacyDisplay(mission),
      createdBy: actorId,
      createdAt: now,
    });

    await bumpCatalog(ctx, campaign, now);
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "place.created_and_reviewed",
      entityType: "place",
      entityId: placeId,
      nextState: { publicId: placePublicId, reviewStatus: "reviewed" },
    });
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.created",
      entityType: "mission",
      entityId: missionId,
      nextState: { publicId: missionPublicId, status: mission.status, revision: 1 },
    });
    return { missionId: missionPublicId, locationId: placePublicId };
  },
});

/**
 * Admin/service-only: create a mission at a place that already exists.
 *
 * `createMissionWithLocation` creates a place per mission and enforces one
 * place per `jellyPlaceId`, so it cannot express "five dishes at one
 * restaurant" — the second call throws `place_already_linked_to_jelly_place_id`.
 * That uniqueness rule is correct and stays; this mutation is the missing
 * second half, attaching an additional mission to a place that has already
 * been created and reviewed.
 *
 * The place is reused as-is. Its coordinates, hours, geofence, and review
 * status are never rewritten here, because a later mission must not be able
 * to silently move a venue that earlier missions were verified against.
 */
export const createMissionAtPlace = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    locationId: v.string(),
    mission: missionInput,
    budgets: budgetInput,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const campaign = await currentCampaign(ctx);
    const mission = cleanMission(args.mission);

    const place = await ctx.db
      .query("jellyhuntPlaces")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", args.locationId))
      .unique();
    if (!place) throw new Error("place_not_found");

    await ensureUniqueSlug(ctx, mission.slug);

    const now = Date.now();
    const missionPublicId = createPublicId("mis");
    const reward = rewardTerms(mission.rewardAmount);
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId: missionPublicId,
      campaignId: campaign._id,
      legacySlug: mission.slug,
      slug: mission.slug,
      status: mission.status,
      approvalMode: mission.approvalMode,
      currentRevision: 1,
      title: mission.title,
      category: mission.category,
      difficulty: mission.difficulty,
      emoji: mission.emoji,
      neighborhood: mission.neighborhood,
      price: mission.price,
      sortOrder: mission.sortOrder,
      placeId: place._id,
      reward,
      acceptingSubmissions: mission.status === "active",
      startsAt: mission.startsAt,
      endsAt: mission.endsAt,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });

    const appliedBudgets = await applyMissionBudgets(
      ctx,
      campaign,
      { _id: missionId, publicId: missionPublicId },
      args.budgets,
      reward.amount,
      mission.status === "active",
      now,
    );
    await ctx.db.patch(missionId, {
      budgetAllocation: appliedBudgets.mission.allocatedAmount,
    });

    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: createPublicId("mrv"),
      missionId,
      revision: 1,
      title: mission.title,
      description: mission.description,
      instructions: [mission.description],
      requirements: requirements(mission),
      approvalMode: mission.approvalMode,
      reward,
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
      missionWindow: { startsAt: mission.startsAt, endsAt: mission.endsAt },
      legacyDisplay: legacyDisplay(mission),
      createdBy: actorId,
      createdAt: now,
    });

    await bumpCatalog(ctx, campaign, now);
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.created",
      entityType: "mission",
      entityId: missionId,
      nextState: {
        publicId: missionPublicId,
        status: mission.status,
        revision: 1,
        placeId: place.publicId,
      },
    });
    return { missionId: missionPublicId, locationId: place.publicId };
  },
});

export const updateMissionWithLocation = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    missionId: v.string(),
    locationId: v.string(),
    mission: missionInput,
    location: locationInput,
    budgets: budgetInput,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const campaign = await currentCampaign(ctx);
    const existingMission = await loadMission(ctx, args.missionId);
    if (existingMission.campaignId !== campaign._id) {
      throw new Error("mission_not_in_current_campaign");
    }
    const existingPlace = await loadPlace(ctx, args.locationId);
    if (existingMission.placeId !== existingPlace._id) {
      throw new Error("location_does_not_belong_to_mission");
    }

    const mission = cleanMission(args.mission);
    const location = cleanLocation(args.location, mission.restaurantTag);
    await ensureUniqueSlug(ctx, mission.slug, existingMission._id);
    await ensureUniqueJellyPlace(ctx, location.jellyPlaceId, existingPlace._id);

    const now = Date.now();
    const reward = rewardTerms(mission.rewardAmount);
    const revision = existingMission.currentRevision + 1;
    const appliedBudgets = await applyMissionBudgets(
      ctx,
      campaign,
      existingMission,
      args.budgets,
      reward.amount,
      mission.status === "active",
      now,
    );
    await ctx.db.patch(existingPlace._id, {
      jellyPlaceId: location.jellyPlaceId,
      name: location.name,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      geofenceRadiusMeters: location.geofenceRadiusMeters,
      timeZone: location.timeZone,
      hours: toStructuredHours(mission.hours),
      reviewStatus: "reviewed",
      updatedAt: now,
    });
    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: createPublicId("mrv"),
      missionId: existingMission._id,
      revision,
      title: mission.title,
      description: mission.description,
      instructions: [mission.description],
      requirements: requirements(mission),
      approvalMode: mission.approvalMode,
      reward,
      place: placeSnapshot(existingPlace._id, location),
      missionWindow: { startsAt: mission.startsAt, endsAt: mission.endsAt },
      legacyDisplay: legacyDisplay(mission),
      createdBy: actorId,
      createdAt: now,
    });
    await ctx.db.patch(existingMission._id, {
      legacySlug: mission.slug,
      slug: mission.slug,
      status: mission.status,
      approvalMode: mission.approvalMode,
      currentRevision: revision,
      title: mission.title,
      category: mission.category,
      difficulty: mission.difficulty,
      emoji: mission.emoji,
      neighborhood: mission.neighborhood,
      price: mission.price,
      sortOrder: mission.sortOrder,
      reward,
      budgetAllocation: appliedBudgets.mission.allocatedAmount,
      acceptingSubmissions: mission.status === "active",
      startsAt: mission.startsAt,
      endsAt: mission.endsAt,
      updatedAt: now,
    });
    await bumpCatalog(ctx, campaign, now);
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.updated",
      entityType: "mission",
      entityId: existingMission._id,
      previousState: {
        status: existingMission.status,
        revision: existingMission.currentRevision,
      },
      nextState: { status: mission.status, revision },
    });
    return { missionId: existingMission.publicId, locationId: existingPlace.publicId };
  },
});

export const updateMissionStatus = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    missionId: v.string(),
    status: lifecycle,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const campaign = await currentCampaign(ctx);
    const mission = await loadMission(ctx, args.missionId);
    if (mission.campaignId !== campaign._id) {
      throw new Error("mission_not_in_current_campaign");
    }
    if (mission.status === args.status) return mission.publicId;
    const now = Date.now();
    if (args.status === "active") {
      if (mission.currentRevision < 1) throw new Error("mission_has_no_published_revision");
      const place = await ctx.db.get(mission.placeId);
      if (!place || place.reviewStatus !== "reviewed") throw new Error("place_not_reviewed");
      await applyMissionBudgets(
        ctx,
        campaign,
        mission,
        undefined,
        mission.reward.amount,
        true,
        now,
      );
    }
    await ctx.db.patch(mission._id, {
      status: args.status,
      acceptingSubmissions: args.status === "active",
      updatedAt: now,
    });
    await bumpCatalog(ctx, campaign, now);
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.lifecycle_changed",
      entityType: "mission",
      entityId: mission._id,
      previousState: { status: mission.status },
      nextState: { status: args.status },
    });
    return mission.publicId;
  },
});

async function projectAdminSubmission(ctx: any, submission: any) {
  const [mission, participation, revision, reservation, rewardIntent] =
    await Promise.all([
      ctx.db.get(submission.missionId),
      ctx.db.get(submission.participationId),
      ctx.db.query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q: any) =>
          q.eq("missionId", submission.missionId).eq("revision", submission.missionRevision))
        .unique(),
      ctx.db.query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
        .unique(),
      ctx.db.query("jellyhuntRewardIntents")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
        .unique(),
    ]);
  const rewardAttempt = rewardIntent && rewardIntent.latestAttemptNumber > 0
    ? await ctx.db.query("jellyhuntRewardAttempts")
        .withIndex("by_intent_attempt", (q: any) =>
          q.eq("rewardIntentId", rewardIntent._id)
            .eq("attemptNumber", rewardIntent.latestAttemptNumber))
        .unique()
    : null;
  const place = submission.placeSnapshot;
  const canonicalPlace = place.placeId ? await ctx.db.get(place.placeId) : null;
  return {
    _id: submission.publicId,
    jellyUserId: submission.jellyUserId,
    jellyPostId: submission.jellyPostId,
    status: legacySubmissionStatus(submission),
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    verificationSummary: submission.verificationSummary,
    rejectionReason: submission.rejectionReason,
    rewardTransactionId: submission.rewardTransactionId,
    missionTitleSnapshot: submission.missionTitleSnapshot,
    locationNameSnapshot: place.name,
    restaurantTagSnapshot:
      revision?.legacyDisplay?.restaurantTag ?? revision?.requirements?.post?.prompt,
    jellyRestaurantIdSnapshot: place.jellyPlaceId,
    rewardAmountSnapshot: Number(submission.rewardSnapshot.amount),
    claimedLatitude: submission.claimedLatitude,
    claimedLongitude: submission.claimedLongitude,
    verifiedLatitude: submission.verifiedLatitude,
    verifiedLongitude: submission.verifiedLongitude,
    distanceMeters: submission.distanceMeters,
    mission: mission ? {
      _id: mission.publicId,
      title: mission.title,
      emoji: mission.emoji,
      rewardAmount: Number(mission.reward.amount),
    } : null,
    location: {
      _id: canonicalPlace?.publicId ?? null,
      name: place.name,
      address: place.address,
      jellyRestaurantId: place.jellyPlaceId,
      latitude: place.latitude,
      longitude: place.longitude,
      geofenceRadiusMeters: place.geofenceRadiusMeters,
      timeZone: place.timeZone,
    },
    participation: participation ? { _id: participation.publicId } : null,
    reservation: reservation ? { status: reservation.status, amount: reservation.amount } : null,
    rewardAttempt: rewardAttempt
      ? { status: rewardAttempt.status, error: rewardAttempt.error }
      : null,
  };
}

export const listAdminSubmissions = queryGeneric({
  args: { serviceKey: v.string(), status: v.optional(v.string()) },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const campaign = await maybeCurrentCampaign(ctx);
    if (!campaign) return [];
    const rows = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_campaign_updated", (q: any) => q.eq("campaignId", campaign._id))
      .order("desc")
      .take(500);
    const projected = await Promise.all(
      rows.map((row: any) => projectAdminSubmission(ctx, row)),
    );
    return args.status && args.status !== "all"
      ? projected.filter((row: any) => row.status === args.status)
      : projected;
  },
});

async function loadSubmission(ctx: any, submissionPublicId: string) {
  const publicId = assertPublicId("sub", submissionPublicId);
  const submission = await ctx.db.query("jellyhuntSubmissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", publicId))
    .unique();
  if (!submission) throw new Error("submission_not_found");
  return submission;
}
export const rejectSubmission = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    submissionPublicId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const reason = required(args.reason, "rejection_reason_required");
    const submission = await loadSubmission(ctx, args.submissionPublicId);
    if (
      submission.submissionStatus !== "needs_review" ||
      submission.decisionStatus !== "pending"
    ) {
      throw new Error("submission_not_ready_for_decision");
    }
    const reservation = await ctx.db.query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    if (
      !reservation ||
      (reservation.status !== "pending_verification" &&
        reservation.status !== "resubmission_hold")
    ) {
      throw new Error("reward_reservation_not_ready");
    }

    const now = Date.now();
    await transitionSubmissionBudgetsInternal(ctx, {
      campaignId: submission.campaignId,
      missionId: submission.missionId,
      amount: reservation.amount,
      transition: "release",
    });
    await ctx.db.patch(reservation._id, { status: "released", updatedAt: now });
    await ctx.db.patch(submission._id, {
      submissionStatus: "rejected",
      decisionStatus: "rejected",
      rewardStatus: "not_eligible",
      reasonCode: "admin_rejected",
      rejectionReason: ADMIN_REJECTION_PUBLIC_MESSAGE,
      publicMessage: ADMIN_REJECTION_PUBLIC_MESSAGE,
      decidedAt: now,
      updatedAt: now,
    });
    await appendSubmissionEventInternal(ctx, {
      submissionPublicId: submission.publicId,
      type: "decision.rejected",
      submissionStatus: "rejected",
      rewardStatus: "not_eligible",
      displayStatus: "rejected",
      reasonCode: "admin_rejected",
      publicMessage: ADMIN_REJECTION_PUBLIC_MESSAGE,
      occurredAt: now,
    });
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "submission.rejected",
      entityType: "submission",
      entityId: submission._id,
      previousState: {
        submissionStatus: submission.submissionStatus,
        decisionStatus: submission.decisionStatus,
      },
      nextState: { submissionStatus: "rejected", decisionStatus: "rejected" },
      metadata: {
        internalNote: reason,
        publicReasonCode: "admin_rejected",
      },
    });
    return submission.publicId;
  },
});

const verifySubmissionEvidenceInternal =
  anyApi.jellyhunt.verification.verifySubmissionEvidence as FunctionReference<
    "action",
    "internal"
  >;

export const retryVerification = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    submissionPublicId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const submission = await loadSubmission(ctx, args.submissionPublicId);
    if (
      submission.decisionStatus !== "pending" ||
      submission.submissionStatus === "approved" ||
      submission.submissionStatus === "rejected"
    ) {
      throw new Error("submission_terminal");
    }
    if (
      submission.submissionStatus === "verifying" &&
      submission.verificationStatus === "in_progress"
    ) {
      throw new Error("verification_already_in_progress");
    }

    const now = Date.now();
    await ctx.db.patch(submission._id, {
      submissionStatus: "submitted",
      verificationStatus: "pending",
      verificationSummary: undefined,
      reasonCode: undefined,
      publicMessage: "Your Jelly is queued for verification.",
      updatedAt: now,
    });
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "verification.retry_requested",
      entityType: "submission",
      entityId: submission._id,
      nextState: { verificationStatus: "pending" },
    });
    if (process.env.JELLYHUNT_VERIFICATION_AUTORUN_ENABLED !== "false") {
      await ctx.scheduler.runAfter(0, verifySubmissionEvidenceInternal, {
        submissionInternalId: submission._id,
      });
    }
    return submission.publicId;
  },
});

export const retryReward = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    submissionPublicId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const submission = await loadSubmission(ctx, args.submissionPublicId);
    if (
      submission.submissionStatus !== "approved" ||
      submission.rewardStatus !== "failed"
    ) {
      throw new Error("reward_not_retryable");
    }
    const intent = await ctx.db.query("jellyhuntRewardIntents")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    const reservation = await ctx.db.query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    if (!intent || intent.status !== "failed") throw new Error("reward_intent_not_retryable");
    if (!reservation || reservation.status !== "approved_reserved") {
      throw new Error("reward_reservation_not_ready");
    }
    const attempt = await ctx.db.query("jellyhuntRewardAttempts")
      .withIndex("by_intent_attempt", (q: any) =>
        q.eq("rewardIntentId", intent._id).eq("attemptNumber", intent.latestAttemptNumber))
      .unique();
    if (!attempt || attempt.status !== "failed" || attempt.confirmedNoTransfer !== true) {
      throw new Error("reward_outcome_not_confirmed_absent");
    }

    const now = Date.now();
    await ctx.db.patch(intent._id, { status: "queued", updatedAt: now });
    await ctx.db.patch(submission._id, {
      rewardStatus: "queued",
      reasonCode: undefined,
      publicMessage: "Your reward retry is queued.",
      rewardQueuedAt: now,
      updatedAt: now,
    });
    await appendSubmissionEventInternal(ctx, {
      submissionPublicId: submission.publicId,
      type: "reward.retry_queued",
      submissionStatus: "approved",
      rewardStatus: "queued",
      displayStatus: "approved_reward_pending",
      publicMessage: "Your reward retry is queued.",
      occurredAt: now,
    });
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "reward.retry_queued",
      entityType: "reward_intent",
      entityId: intent._id,
      nextState: { status: "queued" },
    });
    return submission.publicId;
  },
});
export const reconcileUncertainReward = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    submissionPublicId: v.string(),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    transactionId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const submission = await loadSubmission(ctx, args.submissionPublicId);
    if (
      submission.submissionStatus !== "approved" ||
      submission.rewardStatus !== "uncertain"
    ) {
      throw new Error("reward_not_uncertain");
    }
    const intent = await ctx.db.query("jellyhuntRewardIntents")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    const reservation = await ctx.db.query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    if (!intent || intent.status !== "uncertain") throw new Error("reward_intent_not_uncertain");
    if (!reservation || reservation.status !== "uncertain") {
      throw new Error("reward_reservation_not_uncertain");
    }
    const attempt = await ctx.db.query("jellyhuntRewardAttempts")
      .withIndex("by_intent_attempt", (q: any) =>
        q.eq("rewardIntentId", intent._id).eq("attemptNumber", intent.latestAttemptNumber))
      .unique();
    if (!attempt || attempt.status !== "uncertain") {
      throw new Error("reward_attempt_not_uncertain");
    }

    const now = Date.now();
    if (args.outcome === "sent") {
      const transactionId = required(args.transactionId ?? "", "transaction_id_required");
      const existing = await ctx.db.query("jellyhuntRewardIntents")
        .withIndex("by_transaction_id", (q: any) => q.eq("transactionId", transactionId))
        .unique();
      if (existing && existing._id !== intent._id) {
        throw new Error("transaction_id_already_used");
      }
      await transitionSubmissionBudgetsInternal(ctx, {
        campaignId: submission.campaignId,
        missionId: submission.missionId,
        amount: reservation.amount,
        transition: "paid",
      });
      await ctx.db.patch(attempt._id, {
        status: "sent",
        jellyTransactionId: transactionId,
        updatedAt: now,
      });
      await ctx.db.patch(intent._id, {
        status: "sent",
        transactionId,
        sentAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(reservation._id, { status: "paid", updatedAt: now });
      await ctx.db.patch(submission._id, {
        rewardStatus: "sent",
        rewardTransactionId: transactionId,
        rewardSentAt: now,
        reasonCode: undefined,
        publicMessage: "Your reward was sent.",
        updatedAt: now,
      });
      await appendSubmissionEventInternal(ctx, {
        submissionPublicId: submission.publicId,
        type: "reward.reconciled_sent",
        submissionStatus: "approved",
        rewardStatus: "sent",
        displayStatus: "rewarded",
        publicMessage: "Your reward was sent.",
        occurredAt: now,
      });
    } else {
      const reason = required(args.reason ?? "", "reconciliation_reason_required");
      await ctx.db.patch(attempt._id, {
        status: "failed",
        confirmedNoTransfer: true,
        reasonCode: "admin_confirmed_no_transfer",
        error: reason,
        updatedAt: now,
      });
      await ctx.db.patch(intent._id, { status: "failed", updatedAt: now });
      await ctx.db.patch(reservation._id, {
        status: "approved_reserved",
        updatedAt: now,
      });
      await ctx.db.patch(submission._id, {
        rewardStatus: "failed",
        reasonCode: "reward_failed",
        publicMessage: "Your reward needs attention. Please contact support.",
        updatedAt: now,
      });
      await appendSubmissionEventInternal(ctx, {
        submissionPublicId: submission.publicId,
        type: "reward.reconciled_failed",
        submissionStatus: "approved",
        rewardStatus: "failed",
        displayStatus: "support_needed",
        reasonCode: "reward_failed",
        publicMessage: "Your reward needs attention. Please contact support.",
        occurredAt: now,
      });
    }

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: `reward.reconciled_${args.outcome}`,
      entityType: "reward_intent",
      entityId: intent._id,
      previousState: { status: "uncertain" },
      nextState: { status: args.outcome, transactionId: args.transactionId },
      metadata: { reason: args.reason },
    });
    return submission.publicId;
  },
});