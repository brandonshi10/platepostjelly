import { z } from "zod";

const finiteLatitude = z.number().finite().min(-90).max(90);
const finiteLongitude = z.number().finite().min(-180).max(180);

const partnerPostSchema = z.object({
  id: z.string().min(1).max(256),
  canonicalOwnerUserId: z.string().min(1).max(256),
  eligibleParticipantIds: z.array(z.string().min(1).max(256)).max(100),
  postType: z.string().min(1).max(64),
  durationSeconds: z.number().finite().nonnegative().nullable().optional(),
  state: z.string().min(1).max(64),
  visibility: z.string().min(1).max(64),
  moderationStatus: z.string().min(1).max(64),
  postedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  observedAt: z.string().datetime(),
});

const authorProofSchema = z.object({
  policy: z.string().min(1).max(64),
  matched: z.boolean(),
  canonicalOwnerUserId: z.string().min(1).max(256),
  eligibleParticipantIds: z.array(z.string().min(1).max(256)).max(100),
  source: z.string().min(1).max(128),
});

const placeProofSchema = z.object({
  matched: z.boolean(),
  actualPlaceId: z.string().min(1).max(256).nullable().optional(),
  source: z.string().min(1).max(128),
});

const locationProofSchema = z.object({
  matched: z.boolean(),
  source: z.string().min(1).max(128),
  latitude: finiteLatitude.optional(),
  longitude: finiteLongitude.optional(),
  accuracyMeters: z.number().finite().nonnegative().max(100_000).optional(),
  capturedAt: z.string().datetime().optional(),
  distanceMeters: z.number().finite().nonnegative().max(50_000_000).optional(),
});

export const partnerEvidenceSchema = z.object({
  verificationId: z.string().min(1).max(256),
  evidenceVersion: z.literal("1"),
  evidenceStatus: z.enum(["complete", "incomplete", "unavailable"]),
  reasonCodes: z.array(z.string().min(1).max(128)).max(100),
  post: partnerPostSchema.optional(),
  proof: z.object({
    author: authorProofSchema.optional(),
    place: placeProofSchema.optional(),
    location: locationProofSchema.optional(),
  }).optional(),
  checkedAt: z.string().datetime(),
});

export type PartnerEvidence = z.infer<typeof partnerEvidenceSchema>;

export type VerificationContext = {
  submissionPublicId: string;
  missionPublicId: string;
  missionRevision: number;
  jellyUserId: string;
  jellyPostId: string;
  approvalMode: "manual" | "automatic";
  place: {
    jellyPlaceId: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
  };
  requirements: {
    post: {
      allowedPostTypes: string[];
      authorshipPolicy: string;
      minDurationSeconds?: number;
      maxDurationSeconds?: number;
      requiredVisibility: string;
    };
    place: { attachmentRequired: boolean };
    location: { required: boolean; trustedSource: string };
    schedule: {
      mustBeWithinMissionWindow: boolean;
      mustBeDuringVenueHours: boolean;
    };
  };
  missionWindow: { startsAt?: number; endsAt?: number };
};

export type VerificationPolicyResult = {
  outcome: "approve" | "needs_review" | "reject" | "retry";
  reasonCode: string;
  summary: string;
  verifiedLatitude?: number;
  verifiedLongitude?: number;
  distanceMeters?: number;
};

export function parsePartnerEvidence(value: unknown): PartnerEvidence {
  return partnerEvidenceSchema.parse(value);
}

const EARTH_RADIUS_METERS = 6_371_000;
const MAX_COMPLETE_EVIDENCE_AGE_MS = 60_000;
const EVIDENCE_FUTURE_TOLERANCE_MS = 5_000;
const MAX_TRUSTED_LOCATION_ACCURACY_METERS = 50;

export function evidenceDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function result(
  outcome: VerificationPolicyResult["outcome"],
  reasonCode: string,
  summary = reasonCode,
  location?: Pick<VerificationPolicyResult, "verifiedLatitude" | "verifiedLongitude" | "distanceMeters">,
): VerificationPolicyResult {
  return { outcome, reasonCode, summary, ...location };
}

/**
 * Decide a PlatePost mission outcome from Jelly-owned, component-level
 * evidence. Generic topics, transcript text, and client xdata are not part
 * of this input and therefore can never produce an approval.
 */
export function evaluatePartnerEvidence(
  context: VerificationContext,
  evidence: PartnerEvidence,
  evaluatedAt: number,
): VerificationPolicyResult {
  if (evidence.evidenceStatus === "unavailable") {
    return result("retry", "evidence_unavailable");
  }
  if (evidence.evidenceStatus === "incomplete") {
    return result("needs_review", "evidence_incomplete");
  }

  const checkedAt = Date.parse(evidence.checkedAt);
  if (
    !Number.isFinite(evaluatedAt) ||
    checkedAt > evaluatedAt + EVIDENCE_FUTURE_TOLERANCE_MS
  ) return result("needs_review", "evidence_timestamp_invalid");
  if (evaluatedAt - checkedAt > MAX_COMPLETE_EVIDENCE_AGE_MS) {
    return result("retry", "evidence_stale");
  }

  const post = evidence.post;
  const proof = evidence.proof;
  if (!post || !proof?.author) return result("needs_review", "evidence_incomplete");

  const observedAt = Date.parse(post.observedAt);
  if (
    observedAt > evaluatedAt + EVIDENCE_FUTURE_TOLERANCE_MS ||
    observedAt > checkedAt + EVIDENCE_FUTURE_TOLERANCE_MS
  ) return result("needs_review", "evidence_timestamp_invalid");
  if (evaluatedAt - observedAt > MAX_COMPLETE_EVIDENCE_AGE_MS) {
    return result("retry", "evidence_stale");
  }
  if (proof.author.policy !== context.requirements.post.authorshipPolicy) {
    return result("needs_review", "authorship_policy_mismatch");
  }

  if (post.id !== context.jellyPostId) return result("reject", "post_mismatch");
  if (
    post.canonicalOwnerUserId !== context.jellyUserId ||
    proof.author.canonicalOwnerUserId !== context.jellyUserId ||
    !proof.author.matched ||
    !post.eligibleParticipantIds.includes(context.jellyUserId) ||
    !proof.author.eligibleParticipantIds.includes(context.jellyUserId)
  ) return result("reject", "owner_mismatch");
  if (post.deletedAt !== null) return result("reject", "post_deleted");
  if (post.state !== "ready") return result("reject", "post_not_ready");
  if (post.visibility !== context.requirements.post.requiredVisibility) {
    return result("reject", "post_not_public");
  }
  if (post.moderationStatus !== "clear") return result("reject", "post_moderated");
  if (!context.requirements.post.allowedPostTypes.includes(post.postType)) {
    return result("reject", "wrong_post_type");
  }

  const minimumDuration = context.requirements.post.minDurationSeconds;
  const maximumDuration = context.requirements.post.maxDurationSeconds;
  if ((minimumDuration !== undefined || maximumDuration !== undefined) && post.durationSeconds == null) {
    return result("needs_review", "duration_missing");
  }
  if (minimumDuration !== undefined && post.durationSeconds! < minimumDuration) {
    return result("reject", "duration_too_short");
  }
  if (maximumDuration !== undefined && post.durationSeconds! > maximumDuration) {
    return result("reject", "duration_too_long");
  }

  if (context.requirements.schedule.mustBeWithinMissionWindow) {
    const postedAt = Date.parse(post.postedAt);
    if (
      (context.missionWindow.startsAt !== undefined && postedAt < context.missionWindow.startsAt) ||
      (context.missionWindow.endsAt !== undefined && postedAt > context.missionWindow.endsAt)
    ) return result("reject", "outside_mission_window");
  }

  // The v1 partner evidence contract does not yet carry an authoritative
  // venue-hours proof. Never infer it from client time or map display data.
  if (context.requirements.schedule.mustBeDuringVenueHours) {
    return result("needs_review", "venue_hours_evidence_missing");
  }
  if (context.requirements.place.attachmentRequired) {
    if (!proof.place) return result("needs_review", "place_evidence_missing");
    if (!proof.place.matched || proof.place.actualPlaceId !== context.place.jellyPlaceId) {
      return result("reject", "wrong_place");
    }
  }

  let verifiedLocation: Pick<
    VerificationPolicyResult,
    "verifiedLatitude" | "verifiedLongitude" | "distanceMeters"
  > | undefined;
  if (context.requirements.location.required) {
    const location = proof.location;
    if (
      !location ||
      location.latitude === undefined ||
      location.longitude === undefined ||
      location.accuracyMeters === undefined ||
      location.distanceMeters === undefined
    ) return result("needs_review", "location_evidence_missing");
    if (!location.matched) return result("reject", "outside_geofence");
    if (location.source !== context.requirements.location.trustedSource) {
      return result("needs_review", "location_source_untrusted");
    }
    if (location.accuracyMeters > MAX_TRUSTED_LOCATION_ACCURACY_METERS) {
      return result("needs_review", "location_accuracy_too_low");
    }

    const computedDistance = evidenceDistanceMeters(
      context.place.latitude,
      context.place.longitude,
      location.latitude,
      location.longitude,
    );
    const agreementTolerance = Math.max(25, location.accuracyMeters + 10);
    if (Math.abs(location.distanceMeters - computedDistance) > agreementTolerance) {
      return result("needs_review", "distance_inconsistent");
    }
    const borderTolerance = Math.max(10, location.accuracyMeters);
    if (computedDistance > context.place.geofenceRadiusMeters + borderTolerance) {
      return result("reject", "outside_geofence", "outside_geofence", {
        verifiedLatitude: location.latitude,
        verifiedLongitude: location.longitude,
        distanceMeters: computedDistance,
      });
    }
    verifiedLocation = {
      verifiedLatitude: location.latitude,
      verifiedLongitude: location.longitude,
      distanceMeters: computedDistance,
    };
  }

  if (context.approvalMode === "manual") {
    return result("needs_review", "manual_review_required", "verified_manual_review", verifiedLocation);
  }
  return result("approve", "verified", "verified", verifiedLocation);
}

export function buildPartnerVerificationIdempotencyKey(
  purpose: "verification" | "pre-payout",
  stableId: string,
  attempt: number,
): string {
  const normalizedId = stableId.trim();
  if (!normalizedId || !Number.isInteger(attempt) || attempt < 1) {
    throw new Error("invalid_verification_idempotency_identity");
  }
  return `jellyhunt:${purpose}:${normalizedId}:attempt:${attempt}`;
}

export function buildPartnerVerificationRequest(
  context: VerificationContext,
  verificationAttempt: number,
) {
  return {
    submissionId: context.submissionPublicId,
    verificationAttempt,
    missionId: context.missionPublicId,
    missionRevision: context.missionRevision,
    userId: context.jellyUserId,
    postId: context.jellyPostId,
    expectedPlaceId: context.place.jellyPlaceId,
    postRequirements: context.requirements.post,
    missionWindow: {
      ...(context.missionWindow.startsAt !== undefined
        ? { startsAt: new Date(context.missionWindow.startsAt).toISOString() }
        : {}),
      ...(context.missionWindow.endsAt !== undefined
        ? { endsAt: new Date(context.missionWindow.endsAt).toISOString() }
        : {}),
    },
    placeSnapshot: {
      latitude: context.place.latitude,
      longitude: context.place.longitude,
      geofenceRadiusMeters: context.place.geofenceRadiusMeters,
    },
  };
}
