import { z } from "zod";

const PublicId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z]+$`));
const Timestamp = z.string().datetime({ offset: true });
const NullableTimestamp = Timestamp.nullable();

export const CampaignPublic = z
  .object({
    id: PublicId("cam"),
    revision: z.number().int().nonnegative(),
    catalogRevision: z.number().int().nonnegative(),
    title: z.string(),
    shortTitle: z.string(),
    status: z.enum(["upcoming", "active", "ended"]),
    startsAt: Timestamp,
    endsAt: Timestamp,
    claimsCloseAt: Timestamp,
    timeZone: z.string().min(1),
    rewardToken: z
      .object({
        code: z.string().min(1),
        displayName: z.string().min(1),
      })
      .strict(),
    map: z
      .object({
        center: z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
          })
          .strict(),
        bounds: z
          .object({
            south: z.number().min(-90).max(90),
            west: z.number().min(-180).max(180),
            north: z.number().min(-90).max(90),
            east: z.number().min(-180).max(180),
          })
          .strict(),
        defaultZoom: z.number(),
      })
      .strict(),
    links: z
      .object({
        rules: z.string(),
        iosApp: z.string(),
        androidApp: z.string(),
        support: z.string(),
      })
      .strict(),
  })
  .strict();

const HoursInterval = z.object({ opensAt: z.string(), closesAt: z.string() }).strict();
export const PlaceHours = z
  .object({
    monday: z.array(HoursInterval).optional(),
    tuesday: z.array(HoursInterval).optional(),
    wednesday: z.array(HoursInterval).optional(),
    thursday: z.array(HoursInterval).optional(),
    friday: z.array(HoursInterval).optional(),
    saturday: z.array(HoursInterval).optional(),
    sunday: z.array(HoursInterval).optional(),
  })
  .strict();

export const PlaceSummary = z
  .object({
    id: PublicId("plc"),
    jellyPlaceId: z.string(),
    name: z.string(),
    address: z.string(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timeZone: z.string(),
  })
  .strict();

export const PlacePublic = PlaceSummary.extend({
  revision: z.number().int().nonnegative(),
  hours: PlaceHours,
  source: z
    .object({
      system: z.literal("jelly"),
      revision: z.number().int().nonnegative(),
      updatedAt: Timestamp,
      syncedAt: Timestamp,
    })
    .strict(),
  updatedAt: Timestamp,
}).strict();

const Reward = z
  .object({
    amount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/),
    token: z.string(),
    displayName: z.string(),
  })
  .strict();

const Availability = z
  .object({
    state: z.enum(["upcoming", "available", "paused", "ended", "archived"]),
    startsAt: Timestamp,
    endsAt: Timestamp,
    acceptingSubmissions: z.boolean(),
    reasonCode: z.string().nullable(),
  })
  .strict();

const Display = z
  .object({
    category: z.string(),
    difficulty: z.string(),
    emoji: z.string(),
    neighborhood: z.string(),
    price: z.string(),
    sortOrder: z.number().int(),
  })
  .strict();

export const ViewerSummary = z
  .object({
    participationStatus: z.enum(["not_started", "started"]),
    participationId: PublicId("par").nullable(),
    missionRevision: z.number().int().nullable(),
    submissionDeadlineAt: NullableTimestamp,
    resubmissionDeadlineAt: NullableTimestamp,
    displayStatus: z.enum([
      "not_started",
      "in_progress",
      "submitted",
      "under_review",
      "approved_reward_pending",
      "rewarded",
      "rewarded_removed_from_rankings",
      "rejected",
      "support_needed",
    ]),
    submissionStatus: z.string().nullable(),
    rewardStatus: z.string(),
    latestSubmissionId: PublicId("sub").nullable(),
    startedAt: NullableTimestamp,
    canStart: z.boolean(),
    canSubmit: z.boolean(),
    canResubmit: z.boolean(),
    nextAction: z.enum([
      "start_mission",
      "publish_jelly",
      "submit_post",
      "wait_for_verification",
      "wait_for_review",
      "wait_for_reward",
      "view_reward",
      "submit_new_post",
      "contact_support",
      "none",
    ]),
    publicMessage: z.string(),
    updatedAt: NullableTimestamp,
  })
  .strict();

export const MissionSummary = z
  .object({
    id: PublicId("mis"),
    campaignId: PublicId("cam"),
    revision: z.number().int().positive(),
    title: z.string(),
    availability: Availability,
    reward: Reward,
    display: Display,
    place: PlaceSummary,
    viewer: ViewerSummary.optional(),
    links: z
      .object({
        self: z.string(),
        start: z.string(),
      })
      .strict(),
    updatedAt: Timestamp,
  })
  .strict();

const MissionRequirements = z
  .object({
    post: z
      .object({
        allowedPostTypes: z.array(z.string()).min(1),
        authorshipPolicy: z.string(),
        prompt: z.string(),
        minDurationSeconds: z.number().nonnegative(),
        maxDurationSeconds: z.number().positive(),
        requiredVisibility: z.string(),
      })
      .strict(),
    place: z.object({ attachmentRequired: z.boolean() }).strict(),
    location: z.object({ required: z.boolean(), trustedSource: z.string() }).strict(),
    schedule: z
      .object({
        mustBeWithinMissionWindow: z.boolean(),
        mustBeDuringVenueHours: z.boolean(),
      })
      .strict(),
    resubmission: z
      .object({
        allowedAfterRejection: z.boolean(),
        maxAttempts: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const MissionPublic = z
  .object({
    id: PublicId("mis"),
    campaignId: PublicId("cam"),
    slug: z.string(),
    revision: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    instructions: z.array(z.string()),
    availability: Availability,
    reward: Reward,
    requirements: MissionRequirements,
    display: Display,
    place: PlaceSummary.extend({ hours: PlaceHours }).strict(),
    viewer: ViewerSummary.optional(),
    links: z
      .object({
        self: z.string(),
        participation: z.string().nullable(),
        jellies: z.string(),
        start: z.string(),
        directions: z.string(),
      })
      .strict(),
    updatedAt: Timestamp,
  })
  .strict();

export const JellyFeedItem = z
  .object({
    id: z.string().min(1),
    postType: z.string(),
    author: z
      .object({
        id: z.string(),
        username: z.string(),
        displayName: z.string(),
        avatarUrl: z.string(),
      })
      .strict(),
    title: z.string(),
    summary: z.string(),
    thumbnailUrl: z.string(),
    mediaExpiresAt: Timestamp,
    watchUrl: z.string(),
    postedAt: Timestamp,
  })
  .strict();

export const JellyFeedPublic = z
  .object({
    jellies: z.array(JellyFeedItem),
    source: z.literal("jelly"),
    sourceStatus: z.enum(["live", "stale", "place_not_linked"]),
  })
  .strict();

const OptionalString = z.string().trim().min(1).max(200);
const MissionListQueryBase = z
  .object({
    campaignId: PublicId("cam").optional(),
    availability: z.string().trim().min(1).optional(),
    category: OptionalString.optional(),
    difficulty: z.enum(["easy", "medium", "hard", "legendary"]).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusMeters: z.coerce.number().int().min(1).max(100_000).optional(),
    sort: z.enum(["curated", "nearby", "updated"]).default("curated"),
    include: z.literal("viewer").optional(),
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const MissionListQuery = MissionListQueryBase.superRefine((value, ctx) => {
  const hasLatitude = value.latitude !== undefined;
  const hasLongitude = value.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "latitude and longitude must be supplied together" });
  }
  if (value.sort === "nearby" && (!hasLatitude || !hasLongitude)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "nearby sort requires latitude and longitude" });
  }
  if (value.radiusMeters !== undefined && (!hasLatitude || !hasLongitude)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "radiusMeters requires latitude and longitude" });
  }
  if (value.availability) {
    const allowed = new Set(["available", "upcoming", "ended", "paused"]);
    const parts = value.availability.split(",");
    if (parts.some((part) => !allowed.has(part)) || new Set(parts).size !== parts.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "availability is invalid" });
    }
  }
}).transform((value) => ({
  ...value,
  availability: value.availability
    ? (value.availability.split(",") as Array<"available" | "upcoming" | "ended" | "paused">)
    : (["available", "upcoming"] as Array<"available" | "upcoming" | "ended" | "paused">),
}));

export const MissionDetailQuery = z.object({ include: z.literal("viewer").optional() }).strict();
export const FeedQuery = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const MissionParams = z.object({ missionId: PublicId("mis") }).strict();
export const PlaceParams = z.object({ placeId: PublicId("plc") }).strict();
