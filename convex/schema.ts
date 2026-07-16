import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const missionStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);

const approvalMode = v.union(v.literal("manual"), v.literal("automatic"));

const submissionStatus = v.union(
  v.literal("submitted"),
  v.literal("verifying"),
  v.literal("needs_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("reward_queued"),
  v.literal("reward_sent"),
  v.literal("reward_failed"),
  v.literal("reward_uncertain"),
);

const difficulty = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("legendary"),
);

export default defineSchema({
  locations: defineTable({
    name: v.string(),
    address: v.optional(v.string()),
    jellyRestaurantId: v.optional(v.string()),
    latitude: v.number(),
    longitude: v.number(),
    geofenceRadiusMeters: v.number(),
    timeZone: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jelly_restaurant", ["jellyRestaurantId"])
    .index("by_name", ["name"]),

  missions: defineTable({
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    status: missionStatus,
    approvalMode,
    locationId: v.id("locations"),
    restaurantTag: v.string(),
    rewardAmount: v.number(),
    rewardToken: v.literal("JELLY-MY-JELLY"),
    revision: v.number(),
    category: v.string(),
    difficulty,
    emoji: v.string(),
    neighborhood: v.string(),
    price: v.string(),
    hours: v.array(v.string()),
    venueType: v.optional(v.string()),
    showtimes: v.optional(v.array(v.string())),
    sortOrder: v.number(),
    websiteUrl: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"])
    .index("by_location", ["locationId"])
    .index("by_sort_order", ["sortOrder"]),

  submissions: defineTable({
    missionId: v.id("missions"),
    jellyUserId: v.string(),
    jellyPostId: v.string(),
    dedupeKey: v.string(),
    status: submissionStatus,
    missionRevision: v.number(),
    missionTitleSnapshot: v.string(),
    approvalModeSnapshot: approvalMode,
    restaurantTagSnapshot: v.string(),
    locationNameSnapshot: v.string(),
    jellyRestaurantIdSnapshot: v.optional(v.string()),
    locationLatitudeSnapshot: v.number(),
    locationLongitudeSnapshot: v.number(),
    geofenceRadiusMetersSnapshot: v.number(),
    rewardAmountSnapshot: v.number(),
    rewardTokenSnapshot: v.literal("JELLY-MY-JELLY"),
    claimedLatitude: v.optional(v.number()),
    claimedLongitude: v.optional(v.number()),
    verifiedLatitude: v.optional(v.number()),
    verifiedLongitude: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
    verificationSummary: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    rewardTransactionId: v.optional(v.string()),
    verificationAttempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_mission_user", ["missionId", "jellyUserId"])
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_jelly_post", ["jellyPostId"])
    .index("by_status", ["status"]),

  rewardAttempts: defineTable({
    submissionId: v.id("submissions"),
    idempotencyKey: v.string(),
    rewardAmount: v.number(),
    rewardToken: v.literal("JELLY-MY-JELLY"),
    missionTitle: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("uncertain"),
    ),
    jellyTransactionId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_submission", ["submissionId"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_status", ["status"]),

  auditEvents: defineTable({
    actor: v.string(),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    previousState: v.optional(v.string()),
    nextState: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_created_at", ["createdAt"]),
});
