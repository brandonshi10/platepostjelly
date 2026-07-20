import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  approvalMode,
  completionSource,
  decisionStatus,
  difficulty,
  idempotencyRecordState,
  leaderboardEventType,
  legacyDedupeKind,
  lifecycle,
  missionRequirements,
  participationStatus,
  placeSnapshot,
  reservationStatus,
  rewardAttemptStatus,
  rewardIntentStatus,
  rewardStatus,
  rewardTerms,
  rewardTokenCode,
  submissionStatus,
  verificationStatus,
  weekday,
} from "./validators";

/**
 * Collision-safe, namespaced JellyHunt Convex schema.
 *
 * Every physical table name below is prefixed `jellyhunt` so this module can
 * be spread into PlatePost's real, shared Convex schema (see
 * `convex/schema.ts`) without colliding with or replacing any existing
 * PlatePost table. Field/index shapes follow the approved
 * `docs/superpowers/specs/2026-07-16-jellyhunt-leaderboard-native-integration-design.md`
 * physical table map and the
 * `docs/superpowers/specs/2026-07-16-platepost-jelly-native-api-v2-design.md`
 * field semantics. Uniqueness invariants called out in those specs (one
 * current campaign, one active participation per user/mission, global Jelly
 * post/tombstone uniqueness, one approved completion per user/campaign/
 * mission, one leaderboard entry per scope/user, one reward intent per
 * approved submission, unique attempt number per intent, unique canonical
 * transaction identity) are enforced by indexed lookups inside the canonical
 * mutations added in a later task; this module only guarantees the indexes
 * those lookups need exist.
 */

const jellyhuntProgramConfig = defineTable({
  publicId: v.string(),
  singletonKey: v.literal("default"),
  leaderboardLaunchEpoch: v.number(),
  leaderboardRevision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_singleton_key", ["singletonKey"]);

const jellyhuntPlaces = defineTable({
  publicId: v.string(),
  jellyPlaceId: v.string(),
  name: v.string(),
  address: v.optional(v.string()),
  latitude: v.number(),
  longitude: v.number(),
  geofenceRadiusMeters: v.number(),
  timeZone: v.string(),
  hours: v.optional(
    v.array(
      v.object({
        weekday,
        opensAt: v.string(),
        closesAt: v.string(),
      }),
    ),
  ),
  jellySourceRevision: v.optional(v.number()),
  lastSyncedAt: v.optional(v.number()),
  reviewStatus: v.union(v.literal("draft"), v.literal("reviewed")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_jelly_place_id", ["jellyPlaceId"]);

const jellyhuntCampaigns = defineTable({
  publicId: v.string(),
  slug: v.string(),
  title: v.string(),
  shortTitle: v.optional(v.string()),
  status: lifecycle,
  isCurrent: v.boolean(),
  startsAt: v.number(),
  endsAt: v.number(),
  claimsCloseAt: v.optional(v.number()),
  timeZone: v.string(),
  rewardToken: v.object({
    code: rewardTokenCode,
    displayName: v.string(),
  }),
  map: v.object({
    centerLatitude: v.number(),
    centerLongitude: v.number(),
    boundsSouth: v.number(),
    boundsWest: v.number(),
    boundsNorth: v.number(),
    boundsEast: v.number(),
    defaultZoom: v.number(),
  }),
  links: v.object({
    rules: v.optional(v.string()),
    iosApp: v.optional(v.string()),
    androidApp: v.optional(v.string()),
    support: v.optional(v.string()),
  }),
  revision: v.optional(v.number()),
  catalogRevision: v.number(),
  leaderboardRevision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_slug", ["slug"])
  .index("by_is_current", ["isCurrent"]);

const jellyhuntMissions = defineTable({
  publicId: v.string(),
  campaignId: v.id("jellyhuntCampaigns"),
  legacyNumericId: v.optional(v.number()),
  legacySlug: v.optional(v.string()),
  slug: v.string(),
  status: lifecycle,
  approvalMode,
  currentRevision: v.number(),
  title: v.string(),
  category: v.string(),
  difficulty,
  emoji: v.string(),
  neighborhood: v.string(),
  price: v.string(),
  sortOrder: v.number(),
  placeId: v.id("jellyhuntPlaces"),
  reward: rewardTerms,
  acceptingSubmissions: v.boolean(),
  budgetAllocation: v.optional(v.string()),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  revisionRetentionDeadline: v.optional(v.number()),
  createdBy: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_campaign", ["campaignId"])
  .index("by_campaign_status", ["campaignId", "status"])
  .index("by_slug", ["slug"])
  .index("by_legacy_numeric_id", ["legacyNumericId"])
  .index("by_sort_order", ["sortOrder"])
  .index("by_updated_at", ["updatedAt"]);

const jellyhuntMissionRevisions = defineTable({
  publicId: v.string(),
  missionId: v.id("jellyhuntMissions"),
  revision: v.number(),
  title: v.string(),
  description: v.string(),
  instructions: v.array(v.string()),
  requirements: missionRequirements,
  approvalMode: v.optional(approvalMode),
  reward: rewardTerms,
  place: placeSnapshot,
  missionWindow: v.object({
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
  }),
  legacyDisplay: v.optional(
    v.object({
      restaurantTag: v.string(),
      hours: v.array(v.string()),
      venueType: v.optional(v.string()),
      showtimes: v.optional(v.array(v.string())),
      websiteUrl: v.optional(v.string()),
    }),
  ),
  createdBy: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_mission", ["missionId"])
  .index("by_mission_revision", ["missionId", "revision"]);

const jellyhuntParticipations = defineTable({
  publicId: v.string(),
  jellyUserId: v.string(),
  missionId: v.id("jellyhuntMissions"),
  campaignId: v.id("jellyhuntCampaigns"),
  missionRevision: v.number(),
  status: participationStatus,
  startedAt: v.number(),
  submissionDeadlineAt: v.number(),
  resubmissionDeadlineAt: v.optional(v.number()),
  attemptsUsed: v.number(),
  maxAttempts: v.number(),
  replacementParticipationId: v.optional(v.id("jellyhuntParticipations")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_user_mission", ["jellyUserId", "missionId"])
  .index("by_user_mission_status", ["jellyUserId", "missionId", "status"])
  .index("by_mission", ["missionId"]);

const jellyhuntSubmissions = defineTable({
  publicId: v.string(),
  campaignId: v.id("jellyhuntCampaigns"),
  missionId: v.id("jellyhuntMissions"),
  participationId: v.id("jellyhuntParticipations"),
  jellyUserId: v.string(),
  jellyPostId: v.string(),
  dedupeKey: v.string(),
  attempt: v.number(),
  source: completionSource,
  missionRevision: v.number(),
  submissionStatus,
  rewardStatus,
  legacyStatusProjection: v.optional(v.string()),
  missionTitleSnapshot: v.string(),
  approvalModeSnapshot: approvalMode,
  placeSnapshot,
  rewardSnapshot: rewardTerms,
  claimedLatitude: v.optional(v.number()),
  claimedLongitude: v.optional(v.number()),
  claimedAccuracyMeters: v.optional(v.number()),
  claimedCapturedAt: v.optional(v.number()),
  verifiedLatitude: v.optional(v.number()),
  verifiedLongitude: v.optional(v.number()),
  distanceMeters: v.optional(v.number()),
  verificationStatus,
  verificationAttempts: v.number(),
  verificationSummary: v.optional(v.string()),
  decisionStatus,
  reasonCode: v.optional(v.string()),
  publicMessage: v.optional(v.string()),
  rejectionReason: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  approvalDecisionId: v.optional(v.string()),
  rewardIntentId: v.optional(v.id("jellyhuntRewardIntents")),
  rewardTransactionId: v.optional(v.string()),
  submittedAt: v.number(),
  verificationStartedAt: v.optional(v.number()),
  verificationCompletedAt: v.optional(v.number()),
  decidedAt: v.optional(v.number()),
  rewardQueuedAt: v.optional(v.number()),
  rewardProcessingAt: v.optional(v.number()),
  rewardSentAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_mission_user", ["missionId", "jellyUserId"])
  .index("by_dedupe_key", ["dedupeKey"])
  .index("by_jelly_post", ["jellyPostId"])
  .index("by_submission_status", ["submissionStatus"])
  .index("by_reward_status", ["rewardStatus"])
  .index("by_user_updated", ["jellyUserId", "updatedAt"])
  .index("by_campaign_updated", ["campaignId", "updatedAt"])
  .index("by_updated_at", ["updatedAt"]);

const jellyhuntSubmissionEvents = defineTable({
  publicId: v.string(),
  submissionId: v.id("jellyhuntSubmissions"),
  jellyUserId: v.string(),
  sequence: v.number(),
  type: v.string(),
  submissionStatus,
  rewardStatus,
  displayStatus: v.string(),
  reasonCode: v.optional(v.string()),
  publicMessage: v.optional(v.string()),
  internalMetadataJson: v.optional(v.string()),
  occurredAt: v.number(),
})
  .index("by_submission_sequence", ["submissionId", "sequence"])
  .index("by_user_sequence", ["jellyUserId", "sequence"]);

const jellyhuntIdempotencyRecords = defineTable({
  jellySubjectId: v.string(),
  httpMethod: v.string(),
  normalizedPath: v.string(),
  keyHash: v.string(),
  requestHash: v.string(),
  state: idempotencyRecordState,
  leaseOwner: v.string(),
  leaseGeneration: v.number(),
  processingExpiresAt: v.optional(v.number()),
  originalRequestId: v.string(),
  resourcePublicId: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  responseStatus: v.optional(v.number()),
  responseBodyJson: v.optional(v.string()),
  responseHeadersJson: v.optional(v.string()),
  locationHeader: v.optional(v.string()),
  createdAt: v.number(),
  finalizedAt: v.optional(v.number()),
  expiresAt: v.number(),
})
  .index("by_subject_method_path_key_hash", [
    "jellySubjectId",
    "httpMethod",
    "normalizedPath",
    "keyHash",
  ])
  .index("by_expires_at", ["expiresAt"]);

const jellyhuntRewardBudgets = defineTable({
  scopeType: v.union(v.literal("campaign"), v.literal("mission"), v.literal("day"), v.literal("user")),
  scopeKey: v.string(),
  campaignId: v.optional(v.id("jellyhuntCampaigns")),
  missionId: v.optional(v.id("jellyhuntMissions")),
  allocatedAmount: v.string(),
  reservedAmount: v.string(),
  paidAmount: v.string(),
  releasedAmount: v.string(),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_scope", ["scopeType", "scopeKey"])
  .index("by_campaign", ["campaignId"])
  .index("by_mission", ["missionId"]);

const jellyhuntRewardReservations = defineTable({
  submissionId: v.id("jellyhuntSubmissions"),
  campaignId: v.id("jellyhuntCampaigns"),
  missionId: v.id("jellyhuntMissions"),
  jellyUserId: v.string(),
  amount: v.string(),
  token: rewardTokenCode,
  status: reservationStatus,
  reviewDeadlineAt: v.optional(v.number()),
  resubmissionDeadlineAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_submission", ["submissionId"])
  .index("by_status", ["status"])
  .index("by_mission", ["missionId"]);

const jellyhuntRewardIntents = defineTable({
  publicId: v.string(),
  submissionId: v.id("jellyhuntSubmissions"),
  missionId: v.id("jellyhuntMissions"),
  campaignId: v.id("jellyhuntCampaigns"),
  jellyPostId: v.string(),
  recipientUserId: v.string(),
  amount: v.string(),
  token: rewardTokenCode,
  decimals: v.number(),
  status: rewardIntentStatus,
  latestAttemptNumber: v.number(),
  transactionId: v.optional(v.string()),
  transactionHash: v.optional(v.string()),
  acceptedAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_submission", ["submissionId"])
  .index("by_status", ["status"])
  .index("by_transaction_id", ["transactionId"]);

const jellyhuntRewardAttempts = defineTable({
  rewardIntentId: v.id("jellyhuntRewardIntents"),
  attemptNumber: v.number(),
  idempotencyKey: v.string(),
  status: rewardAttemptStatus,
  confirmedNoTransfer: v.boolean(),
  reasonCode: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  jellyTransactionId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_intent", ["rewardIntentId"])
  .index("by_intent_attempt", ["rewardIntentId", "attemptNumber"])
  .index("by_idempotency_key", ["idempotencyKey"])
  .index("by_status", ["status"]);

const jellyhuntWebhookInbox = defineTable({
  jellyEventId: v.string(),
  keyId: v.string(),
  bodyHash: v.string(),
  entityType: v.string(),
  entityId: v.string(),
  sequence: v.number(),
  eventType: v.string(),
  receivedAt: v.number(),
  processedAt: v.optional(v.number()),
  deadLetterAt: v.optional(v.number()),
  processingError: v.optional(v.string()),
})
  .index("by_jelly_event_id", ["jellyEventId"])
  .index("by_entity", ["entityType", "entityId"])
  .index("by_received_at", ["receivedAt"]);

const jellyhuntWebhookEvents = defineTable({
  publicId: v.string(),
  type: v.string(),
  entityType: v.string(),
  entityId: v.string(),
  sequence: v.number(),
  payloadJson: v.string(),
  occurredAt: v.number(),
  createdAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_entity_sequence", ["entityType", "entityId", "sequence"])
  .index("by_type", ["type"]);

const jellyhuntWebhookDeliveries = defineTable({
  webhookEventId: v.id("jellyhuntWebhookEvents"),
  endpoint: v.string(),
  attemptCount: v.number(),
  nextAttemptAt: v.optional(v.number()),
  responseClass: v.optional(v.string()),
  deliveredAt: v.optional(v.number()),
  deadLetterAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_webhook_event", ["webhookEventId"])
  .index("by_next_attempt", ["nextAttemptAt"]);

const jellyhuntAuditEvents = defineTable({
  actor: v.string(),
  action: v.string(),
  entityType: v.string(),
  entityId: v.string(),
  previousStateJson: v.optional(v.string()),
  nextStateJson: v.optional(v.string()),
  metadataJson: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_entity", ["entityType", "entityId"])
  .index("by_created_at", ["createdAt"]);

const jellyhuntPublicProfiles = defineTable({
  jellyUserId: v.string(),
  username: v.string(),
  normalizedUsername: v.string(),
  jellyProfileRevision: v.optional(v.number()),
  accountState: v.union(
    v.literal("active"),
    v.literal("deleted"),
    v.literal("moderated"),
    v.literal("unknown"),
  ),
  publicEligible: v.boolean(),
  refreshedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_jelly_user_id", ["jellyUserId"])
  .index("by_normalized_username", ["normalizedUsername"]);

const jellyhuntApprovedCompletions = defineTable({
  publicId: v.string(),
  jellyUserId: v.string(),
  campaignId: v.id("jellyhuntCampaigns"),
  missionId: v.id("jellyhuntMissions"),
  winningSubmissionId: v.id("jellyhuntSubmissions"),
  approvalDecisionId: v.string(),
  approvedAt: v.number(),
  source: completionSource,
  countsTowardLeaderboard: v.boolean(),
  reversedAt: v.optional(v.number()),
  reversalReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_user_campaign_mission", ["jellyUserId", "campaignId", "missionId"])
  .index("by_approval_decision", ["approvalDecisionId"])
  .index("by_winning_submission", ["winningSubmissionId"])
  .index("by_campaign", ["campaignId"]);

const jellyhuntLeaderboardEntries = defineTable({
  publicId: v.string(),
  scopeKey: v.string(),
  jellyUserId: v.string(),
  approvedMissionCount: v.number(),
  rankSortScore: v.number(),
  normalizedUsername: v.string(),
  scoreReachedAt: v.number(),
  publicEligible: v.boolean(),
  profileRevision: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_public_id", ["publicId"])
  .index("by_scope_user", ["scopeKey", "jellyUserId"])
  .index("by_scope_public_rank", ["scopeKey", "publicEligible", "rankSortScore", "normalizedUsername", "publicId"]);

const jellyhuntLeaderboardEvents = defineTable({
  scopeKey: v.string(),
  jellyUserId: v.optional(v.string()),
  type: leaderboardEventType,
  correlationId: v.optional(v.string()),
  requestId: v.optional(v.string()),
  beforeCount: v.optional(v.number()),
  afterCount: v.optional(v.number()),
  revisionAfter: v.optional(v.number()),
  occurredAt: v.number(),
})
  .index("by_scope_occurred_at", ["scopeKey", "occurredAt"])
  .index("by_user", ["jellyUserId"]);

const jellyhuntLegacyDedupeRecords = defineTable({
  sourceRowId: v.string(),
  kind: legacyDedupeKind,
  canonicalPostId: v.optional(v.string()),
  canonicalTransactionId: v.optional(v.string()),
  canonicalTransactionHash: v.optional(v.string()),
  legacyUserId: v.optional(v.string()),
  legacyMissionId: v.optional(v.string()),
  sourceHash: v.string(),
  quarantineReason: v.optional(v.string()),
  payoutHoldKey: v.optional(v.string()),
  operatorResolution: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
  importedAt: v.number(),
})
  .index("by_source_row", ["sourceRowId"])
  .index("by_canonical_post_id", ["canonicalPostId"])
  .index("by_canonical_transaction_id", ["canonicalTransactionId"])
  .index("by_canonical_transaction_hash", ["canonicalTransactionHash"])
  .index("by_payout_hold_key", ["payoutHoldKey"]);

export const jellyhuntTables = {
  jellyhuntProgramConfig,
  jellyhuntPlaces,
  jellyhuntCampaigns,
  jellyhuntMissions,
  jellyhuntMissionRevisions,
  jellyhuntParticipations,
  jellyhuntSubmissions,
  jellyhuntSubmissionEvents,
  jellyhuntIdempotencyRecords,
  jellyhuntRewardBudgets,
  jellyhuntRewardReservations,
  jellyhuntRewardIntents,
  jellyhuntRewardAttempts,
  jellyhuntWebhookInbox,
  jellyhuntWebhookEvents,
  jellyhuntWebhookDeliveries,
  jellyhuntAuditEvents,
  jellyhuntPublicProfiles,
  jellyhuntApprovedCompletions,
  jellyhuntLeaderboardEntries,
  jellyhuntLeaderboardEvents,
  jellyhuntLegacyDedupeRecords,
};

export const JELLYHUNT_TABLE_NAMES = Object.keys(jellyhuntTables) as (keyof typeof jellyhuntTables)[];
