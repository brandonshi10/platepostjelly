import {
  anyApi,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";

/**
 * Server-side evidence verification for JellyHunt submissions: confirms a
 * claimed Jelly post actually exists, belongs to the submitting user, and
 * (when the post carries location data) is close enough to the mission's
 * place to be plausible.
 *
 * `verifySubmissionEvidence` is scheduled internally (e.g. right after a
 * submission is created, per Task 3's flow) - it is not a service-key-gated
 * admin action because it never accepts caller-controlled write intent of
 * its own; it only reads a submission the caller already created and
 * records what verification found via `recordVerificationResult`.
 */

const EARTH_RADIUS_METERS = 6_371_000;

export function buildLegacyJellyPath(jellyPostId: string): string {
  const normalized = jellyPostId.trim();
  if (!normalized || normalized.length > 256) throw new Error("invalid_jelly_post_id");
  return `/v3/jelly/${encodeURIComponent(normalized)}`;
}

/** Great-circle distance between two lat/lon points, in meters. */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Internal: persists a verification outcome onto a `jellyhuntSubmissions`
 * row and increments its attempt counter. `decisionStatus` is only touched
 * when the caller explicitly supplies one (automatic-approval-mode callers
 * decide that outcome themselves before calling this); manual-review
 * missions leave the submission's existing `decisionStatus` (`pending`)
 * alone so a human reviewer still makes the call.
 */
export const recordVerificationResult = internalMutationGeneric({
  args: {
    submissionInternalId: v.string(),
    verificationStatus: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("complete"),
      v.literal("unavailable"),
    ),
    verifiedLatitude: v.optional(v.number()),
    verifiedLongitude: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
    verificationSummary: v.optional(v.string()),
    decisionStatus: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    const submission = await ctx.db.get(args.submissionInternalId as any);
    if (!submission) throw new Error("submission_not_found");

    const patch: Record<string, unknown> = {
      verificationStatus: args.verificationStatus,
      verificationAttempts: submission.verificationAttempts + 1,
      updatedAt: args.now,
    };

    if (args.verifiedLatitude !== undefined) patch.verifiedLatitude = args.verifiedLatitude;
    if (args.verifiedLongitude !== undefined) patch.verifiedLongitude = args.verifiedLongitude;
    if (args.distanceMeters !== undefined) patch.distanceMeters = args.distanceMeters;
    if (args.verificationSummary !== undefined) patch.verificationSummary = args.verificationSummary;

    if (submission.verificationStartedAt === undefined) {
      patch.verificationStartedAt = args.now;
    }
    if (args.verificationStatus === "complete" || args.verificationStatus === "unavailable") {
      patch.verificationCompletedAt = args.now;
    }

    if (args.decisionStatus !== undefined) {
      patch.decisionStatus = args.decisionStatus;
      if (args.decisionStatus !== "pending") {
        patch.decidedAt = args.now;
      }
    }

    await ctx.db.patch(submission._id, patch);

    return { submissionInternalId: submission._id, verificationStatus: args.verificationStatus };
  },
});

/**
 * Internal query: loads a submission plus the fields
 * `verifySubmissionEvidence` needs (owner, mission approval mode, place
 * coordinates/geofence) as a single plain object, so the action never has
 * to reach into `ctx.db` directly.
 */
export const getSubmissionForVerification = internalQueryGeneric({
  args: { submissionInternalId: v.string() },
  handler: async (ctx: any, args: any) => {
    const submission = await ctx.db.get(args.submissionInternalId as any);
    if (!submission) return null;
    return {
      jellyUserId: submission.jellyUserId,
      jellyPostId: submission.jellyPostId,
      approvalModeSnapshot: submission.approvalModeSnapshot,
      place: submission.placeSnapshot
        ? {
            latitude: submission.placeSnapshot.latitude,
            longitude: submission.placeSnapshot.longitude,
            geofenceRadiusMeters: submission.placeSnapshot.geofenceRadiusMeters,
          }
        : null,
    };
  },
});

/**
 * Internal action: verify a submission's evidence against the Jelly
 * partner API. Loads the submission/mission/place, fetches the claimed
 * post, checks existence/ownership/location, computes distance to the
 * mission's place when location data is present, and records the result.
 *
 * Automatic-approval missions (`approvalModeSnapshot === "automatic"`) get
 * an immediate `decisionStatus` based on the verification outcome; manual
 * missions are left `pending` for a human reviewer regardless of what
 * verification found.
 */
const getSubmissionForVerificationInternal = anyApi.jellyhunt.verification.getSubmissionForVerification as FunctionReference<
  "query",
  "internal"
>;
const recordVerificationResultInternal = anyApi.jellyhunt.verification.recordVerificationResult as FunctionReference<
  "mutation",
  "internal"
>;

export const verifySubmissionEvidence = internalActionGeneric({
  args: {
    submissionInternalId: v.string(),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const submission = await ctx.runQuery(getSubmissionForVerificationInternal, {
      submissionInternalId: args.submissionInternalId,
    });
    if (!submission) throw new Error("submission_not_found");

    const { getJellyHttpConfig, jellyGet } = await import("./jellyHttpClient");
    const config = getJellyHttpConfig();
    const response = await jellyGet(config, buildLegacyJellyPath(submission.jellyPostId), args.correlationId);

    const now = Date.now();
    const isAutomatic = submission.approvalModeSnapshot === "automatic";

    if (response.status !== 200) {
      return await ctx.runMutation(recordVerificationResultInternal, {
        submissionInternalId: args.submissionInternalId,
        verificationStatus: "unavailable",
        verificationSummary: "post_not_found",
        decisionStatus: isAutomatic ? "rejected" : undefined,
        now,
      });
    }

    const post = response.body?.data;
    if (!post || post.deletedAt) {
      return await ctx.runMutation(recordVerificationResultInternal, {
        submissionInternalId: args.submissionInternalId,
        verificationStatus: "unavailable",
        verificationSummary: "post_deleted",
        decisionStatus: isAutomatic ? "rejected" : undefined,
        now,
      });
    }

    if (String(post.userId).trim() !== submission.jellyUserId) {
      return await ctx.runMutation(recordVerificationResultInternal, {
        submissionInternalId: args.submissionInternalId,
        verificationStatus: "complete",
        verificationSummary: "owner_mismatch",
        decisionStatus: isAutomatic ? "rejected" : undefined,
        now,
      });
    }

    const location = post.location;
    if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number") {
      return await ctx.runMutation(recordVerificationResultInternal, {
        submissionInternalId: args.submissionInternalId,
        verificationStatus: "complete",
        verificationSummary: "no_location_data",
        decisionStatus: isAutomatic ? "rejected" : undefined,
        now,
      });
    }

    const place = submission.place;
    const distanceMeters = place
      ? haversineDistance(location.latitude, location.longitude, place.latitude, place.longitude)
      : undefined;

    const withinGeofence =
      distanceMeters !== undefined && place?.geofenceRadiusMeters !== undefined
        ? distanceMeters <= place.geofenceRadiusMeters
        : undefined;

    return await ctx.runMutation(recordVerificationResultInternal, {
      submissionInternalId: args.submissionInternalId,
      verificationStatus: "complete",
      verifiedLatitude: location.latitude,
      verifiedLongitude: location.longitude,
      distanceMeters,
      verificationSummary: withinGeofence === false ? "outside_geofence" : "verified",
      decisionStatus: isAutomatic ? (withinGeofence === false ? "rejected" : "approved") : undefined,
      now,
    });
  },
});
