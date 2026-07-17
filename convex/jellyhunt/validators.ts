import { v } from "convex/values";

/**
 * Shared Convex validators for the namespaced JellyHunt schema
 * (`convex/jellyhunt/schema.ts`). Keeping these in one module means every
 * `jellyhunt*` table agrees on the same lifecycle/status vocabulary.
 */

export const lifecycle = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);

export const approvalMode = v.union(v.literal("manual"), v.literal("automatic"));

export const difficulty = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("legendary"),
);

export const submissionStatus = v.union(
  v.literal("submitted"),
  v.literal("verifying"),
  v.literal("needs_review"),
  v.literal("approved"),
  v.literal("rejected"),
);

// Intent cancellation maps to submission rewardStatus `not_eligible`; `canceled`
// is a reward-intent-only state (see `rewardIntentStatus` below), never a
// submission-level rewardStatus value.
export const rewardStatus = v.union(
  v.literal("not_eligible"),
  v.literal("queued"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("uncertain"),
);

export const verificationStatus = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("complete"),
  v.literal("unavailable"),
);

export const decisionStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));

export const participationStatus = v.union(
  v.literal("started"),
  v.literal("expired"),
  v.literal("replaced"),
);

export const rewardTokenCode = v.literal("JELLY-MY-JELLY");

export const rewardIntentStatus = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("uncertain"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const rewardAttemptStatus = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("uncertain"),
);

export const reservationStatus = v.union(
  v.literal("pending_verification"),
  v.literal("resubmission_hold"),
  v.literal("approved_reserved"),
  v.literal("processing"),
  v.literal("uncertain"),
  v.literal("paid"),
  v.literal("released"),
);

export const completionSource = v.union(v.literal("live"), v.literal("legacy"));

export const legacyDedupeKind = v.union(
  v.literal("post"),
  v.literal("transaction"),
  v.literal("quarantine"),
);

export const leaderboardEventType = v.union(
  v.literal("increment"),
  v.literal("reversal"),
  v.literal("profile_refresh"),
  v.literal("rebuild"),
  v.literal("publication"),
);

export const idempotencyRecordState = v.union(
  v.literal("processing"),
  v.literal("completed"),
  v.literal("expired"),
);

export const weekday = v.union(
  v.literal("monday"),
  v.literal("tuesday"),
  v.literal("wednesday"),
  v.literal("thursday"),
  v.literal("friday"),
  v.literal("saturday"),
  v.literal("sunday"),
);

/** Reviewed mission-time reward display terms shared by mission revisions and submissions. */
export const rewardTerms = v.object({
  amount: v.string(),
  token: rewardTokenCode,
  displayName: v.string(),
});

/** Reviewed place snapshot embedded into immutable mission revisions and submissions. */
export const placeSnapshot = v.object({
  placeId: v.id("jellyhuntPlaces"),
  jellyPlaceId: v.string(),
  name: v.string(),
  address: v.optional(v.string()),
  latitude: v.number(),
  longitude: v.number(),
  geofenceRadiusMeters: v.number(),
  timeZone: v.string(),
});

/** Structured mission proof/eligibility requirements captured on every revision. */
export const missionRequirements = v.object({
  post: v.object({
    allowedPostTypes: v.array(v.string()),
    authorshipPolicy: v.string(),
    prompt: v.string(),
    minDurationSeconds: v.optional(v.number()),
    maxDurationSeconds: v.optional(v.number()),
    requiredVisibility: v.string(),
  }),
  place: v.object({
    attachmentRequired: v.boolean(),
  }),
  location: v.object({
    required: v.boolean(),
    trustedSource: v.string(),
  }),
  schedule: v.object({
    mustBeWithinMissionWindow: v.boolean(),
    mustBeDuringVenueHours: v.boolean(),
  }),
  resubmission: v.object({
    allowedAfterRejection: v.boolean(),
    maxAttempts: v.number(),
  }),
});
