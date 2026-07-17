import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { fetchTextWithTimeout } from "./httpFetch";
import { legacyVerificationOutcome } from "./workflow";
import {
  evaluatePartnerLocationProof,
  requireCredentialedEndpoint,
} from "./jellySecurity";

type JsonObject = Record<string, unknown>;

type VerificationOutcome = "verified" | "needs_review" | "rejected";
type RewardOutcome = "sent" | "failed" | "uncertain";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nestedObject(value: unknown, key: string): JsonObject | undefined {
  return isObject(value) && isObject(value[key]) ? value[key] : undefined;
}

function unwrapJelly(payload: unknown): JsonObject | undefined {
  if (!isObject(payload)) return undefined;
  const data = nestedObject(payload, "data");
  const jelly = nestedObject(payload, "jelly") ?? nestedObject(data, "jelly");
  return jelly ?? data ?? payload;
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[@#]+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseXdata(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function tagCandidates(jelly: JsonObject): string[] {
  const result: string[] = [];
  if (Array.isArray(jelly.topics)) {
    for (const topic of jelly.topics) {
      if (typeof topic === "string") result.push(topic);
      if (isObject(topic)) {
        for (const key of ["code", "name", "slug", "tag"]) {
          const candidate = stringValue(topic[key]);
          if (candidate) result.push(candidate);
        }
      }
    }
  }

  const xdata = parseXdata(jelly.xdata);
  const visit = (value: unknown, depth = 0) => {
    if (!isObject(value) || depth > 3) return;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
      const isTagField = [
        "restauranttag",
        "locationtag",
        "placetag",
        "venue",
        "restaurant",
        "location",
        "place",
        "tag",
        "tags",
      ].includes(normalizedKey);
      if (isTagField && typeof child === "string") result.push(child);
      if (isTagField && Array.isArray(child)) {
        for (const entry of child) if (typeof entry === "string") result.push(entry);
      }
      if (isObject(child)) visit(child, depth + 1);
    }
  };
  visit(xdata);
  return result;
}

function extractCoordinates(value: unknown, depth = 0): { latitude: number; longitude: number } | undefined {
  if (!isObject(value) || depth > 5) return undefined;

  let latitude: number | undefined;
  let longitude: number | undefined;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (["lat", "latitude"].includes(normalizedKey)) latitude = numberValue(child);
    if (["lng", "lon", "long", "longitude"].includes(normalizedKey)) longitude = numberValue(child);
  }
  if (
    latitude !== undefined &&
    longitude !== undefined &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  ) {
    return { latitude, longitude };
  }

  for (const child of Object.values(value)) {
    const nested = extractCoordinates(parseXdata(child), depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function haversineMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function partnerHeaders(idempotencyKey?: string): Record<string, string> {
  const apiKey = process.env.JELLY_PARTNER_API_KEY;
  if (!apiKey) throw new Error("JELLY_PARTNER_API_KEY is required for partner endpoints");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function saveVerification(
  ctx: any,
  submissionId: any,
  verificationAttempt: number,
  result: {
    outcome: VerificationOutcome;
    summary: string;
    reason?: string;
    latitude?: number;
    longitude?: number;
    distanceMeters?: number;
  },
) {
  await ctx.runMutation(internal.submissions.markVerificationResult, {
    submissionId,
    verificationAttempt,
    outcome: result.outcome,
    summary: result.summary,
    reason: result.reason,
    verifiedLatitude: result.latitude,
    verifiedLongitude: result.longitude,
    distanceMeters: result.distanceMeters,
  });
}
async function verifyWithPartner(
  ctx: any,
  context: any,
  endpoint: string,
  verificationAttempt: number,
) {
  const { submission, mission, location } = context;
  let response: Response;
  let text: string;
  try {
    const result = await fetchTextWithTimeout(requireCredentialedEndpoint(endpoint), {
      method: "POST",
      headers: partnerHeaders(),
      body: JSON.stringify({
        submission_id: submission._id,
        mission_id: mission._id,
        user_id: submission.jellyUserId,
        post_id: submission.jellyPostId,
        restaurant_tag: mission.restaurantTag,
        location: {
          jelly_restaurant_id: location.jellyRestaurantId,
          latitude: location.latitude,
          longitude: location.longitude,
          geofence_radius_meters: location.geofenceRadiusMeters,
        },
      }),
    });
    response = result.response;
    text = result.text;
  } catch (error) {
    await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
      submissionId: submission._id,
      verificationAttempt,
      summary: `Jelly partner verification could not be reached: ${error instanceof Error ? error.message : "network error"}`,
    });
    return;
  }

  if (!response.ok) {
    await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
      submissionId: submission._id,
      verificationAttempt,
      summary: `Jelly partner verification returned HTTP ${response.status}`,
    });
    return;
  }

  const payload = parseJson(text);
  const result = isObject(payload) && isObject(payload.data) ? payload.data : payload;
  if (!isObject(result)) {
    await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
      submissionId: submission._id,
      verificationAttempt,
      summary: "Jelly partner verification returned an invalid response",
    });
    return;
  }

  const rawOutcome = stringValue(result.outcome);
  const outcome: VerificationOutcome | undefined =
    rawOutcome === "verified" || rawOutcome === "needs_review" || rawOutcome === "rejected"
      ? rawOutcome
      : result.passed === true
        ? "verified"
        : result.passed === false
          ? "rejected"
          : undefined;
  if (!outcome) {
    await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
      submissionId: submission._id,
      verificationAttempt,
      summary: "Jelly partner verification did not include a decision",
    });
    return;
  }

  const coordinates = extractCoordinates(result);
  const suppliedDistance = numberValue(result.distance_meters ?? result.distanceMeters);
  const locationProof = evaluatePartnerLocationProof({
    outcome,
    coordinates,
    suppliedDistanceMeters: suppliedDistance,
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      geofenceRadiusMeters: location.geofenceRadiusMeters,
    },
  });

  await saveVerification(ctx, submission._id, verificationAttempt, {
    outcome: locationProof.outcome,
    summary: locationProof.reason === "outside_geofence"
      ? `Verified post location is ${Math.round(locationProof.distanceMeters!)}m from the mission venue`
      : locationProof.reason === "incomplete_partner_location_proof"
        ? "Jelly partner verification omitted complete trusted location evidence"
        : locationProof.reason === "inconsistent_partner_location_proof"
          ? "Jelly partner verification returned location evidence that did not agree"
          : stringValue(result.summary) ?? "Jelly partner verification completed",
    reason: locationProof.reason ?? stringValue(result.reason),
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    distanceMeters: locationProof.distanceMeters,
  });
}

async function verifyWithLegacyApi(
  ctx: any,
  context: any,
  verificationAttempt: number,
) {
  const { submission, mission, location } = context;
  const baseUrl = (process.env.JELLY_API_BASE_URL ?? "https://api.jellyjelly.com").replace(/\/$/, "");
  const legacyToken = process.env.JELLY_LEGACY_API_TOKEN;
  let response: Response;
  let text: string;
  try {
    const result = await fetchTextWithTimeout(
      requireCredentialedEndpoint(
        `${baseUrl}/v3/jelly/${encodeURIComponent(submission.jellyPostId)}`,
      ),
      { headers: legacyToken ? { Authorization: `Token ${legacyToken}` } : undefined },
    );
    response = result.response;
    text = result.text;
  } catch (error) {
    await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
      submissionId: submission._id,
      verificationAttempt,
      summary: `Legacy Jelly API could not be reached: ${error instanceof Error ? error.message : "network error"}`,
    });
    return;
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      await saveVerification(ctx, submission._id, verificationAttempt, {
        outcome: "rejected",
        summary: "The submitted Jelly post could not be found",
        reason: "jelly_post_not_found",
      });
    } else {
      await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
        submissionId: submission._id,
      verificationAttempt,
      summary: `Legacy Jelly API returned HTTP ${response.status}`,
      });
    }
    return;
  }

  const jelly = unwrapJelly(parseJson(text));
  if (!jelly) {
    await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
      submissionId: submission._id,
      verificationAttempt,
      summary: "Legacy Jelly API returned an invalid post response",
    });
    return;
  }

  const authorId = stringValue(jelly.started_by_id);
  const authorOutcome = legacyVerificationOutcome(authorId, submission.jellyUserId);
  if (authorOutcome === "rejected") {
    await saveVerification(ctx, submission._id, verificationAttempt, {
      outcome: "rejected",
      summary: "The Jelly post does not belong to the mission participant",
      reason: "jelly_post_author_mismatch",
    });
    return;
  }

  const expectedTag = normalizeTag(mission.restaurantTag);
  const hasRestaurantTag = tagCandidates(jelly).some(
    (candidate) => normalizeTag(candidate) === expectedTag,
  );
  const coordinates = extractCoordinates(parseXdata(jelly.xdata));
  const distanceMeters = coordinates
    ? haversineMeters(
        coordinates.latitude,
        coordinates.longitude,
        location.latitude,
        location.longitude,
      )
    : undefined;
  const insideGeofence =
    distanceMeters !== undefined && distanceMeters <= location.geofenceRadiusMeters;
  const availableEvidence = [
    authorId ? "post ownership" : undefined,
    hasRestaurantTag ? "restaurant tag" : undefined,
    coordinates ? "legacy location metadata" : undefined,
  ].filter(Boolean).join(", ");

  await saveVerification(ctx, submission._id, verificationAttempt, {
    outcome: "needs_review",
    summary: availableEvidence
      ? `Legacy API supplied ${availableEvidence}; manual review is required because this is not authoritative partner proof${coordinates ? ` (${Math.round(distanceMeters!)}m from venue)` : ""}`
      : "Legacy API returned the post, but authoritative ownership, restaurant, and location proof were unavailable",
    reason: coordinates && !insideGeofence
      ? "legacy_geofence_warning"
      : "legacy_proof_requires_review",
    latitude: coordinates?.latitude,
    longitude: coordinates?.longitude,
    distanceMeters,
  });
}
export const verifySubmission = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const verificationAttempt = await ctx.runMutation(
      internal.submissions.markVerificationStarted,
      args,
    );
    if (typeof verificationAttempt !== "number") return;

    try {
      const context = await ctx.runQuery(internal.submissions.getVerificationContext, args);
      const partnerEndpoint = process.env.JELLY_PARTNER_VERIFY_URL;
      if (partnerEndpoint) {
        await verifyWithPartner(ctx, context, partnerEndpoint, verificationAttempt);
      } else {
        await verifyWithLegacyApi(ctx, context, verificationAttempt);
      }
    } catch (error) {
      await ctx.runMutation(internal.submissions.markVerificationUnavailable, {
        submissionId: args.submissionId,
        verificationAttempt,
        summary: `Verification worker failed before reaching Jelly: ${error instanceof Error ? error.message : "internal error"}`,
      });
    }
  },
});

function responseTransactionId(payload: unknown): string | undefined {
  if (!isObject(payload)) return undefined;
  const data = isObject(payload.data) ? payload.data : undefined;
  const value =
    data?.transaction_id ??
    data?.transactionId ??
    payload.transaction_id ??
    payload.transactionId;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

async function saveReward(
  ctx: any,
  rewardAttemptId: any,
  outcome: RewardOutcome,
  responseText: string,
  error?: string,
) {
  const payload = parseJson(responseText);
  await ctx.runMutation(internal.submissions.markRewardResult, {
    rewardAttemptId,
    outcome,
    transactionId: outcome === "sent" ? responseTransactionId(payload) : undefined,
    error,
  });
}

export const sendReward = internalAction({
  args: { rewardAttemptId: v.id("rewardAttempts") },
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.submissions.markRewardProcessing, args);
    if (!started) return;

    let context: any;
    try {
      context = await ctx.runQuery(internal.submissions.getRewardContext, args);
    } catch (error) {
      await saveReward(
        ctx,
        args.rewardAttemptId,
        "failed",
        "",
        `Reward worker could not load its immutable snapshot: ${error instanceof Error ? error.message : "internal error"}`,
      );
      return;
    }
    const { rewardAttempt, submission, mission } = context;
    const partnerEndpoint = process.env.JELLY_PARTNER_REWARD_URL;
    const legacyToken =
      process.env.JELLY_REWARD_API_TOKEN ??
      process.env.JELLY_LEGACY_API_TOKEN ??
      process.env.JELLY_REWARD_BEARER_TOKEN;
    const legacyAuthScheme =
      process.env.JELLY_REWARD_AUTH_SCHEME ??
      (process.env.JELLY_REWARD_API_TOKEN || process.env.JELLY_LEGACY_API_TOKEN
        ? "Token"
        : "Bearer");
    const baseUrl = (process.env.JELLY_API_BASE_URL ?? "https://api.jellyjelly.com").replace(/\/$/, "");
    const endpoint = partnerEndpoint ?? `${baseUrl}/crypto/send`;

    if (!partnerEndpoint && !legacyToken) {
      await saveReward(
        ctx,
        args.rewardAttemptId,
        "failed",
        "",
        "A Jelly legacy reward token is not configured",
      );
      return;
    }

    let response: Response;
    let responseText: string;
    try {
      const result = await fetchTextWithTimeout(requireCredentialedEndpoint(endpoint), {
        method: "POST",
        headers: partnerEndpoint
          ? partnerHeaders(rewardAttempt.idempotencyKey)
          : {
              Authorization: `${legacyAuthScheme} ${legacyToken}`,
              "Content-Type": "application/json",
            },
        body: JSON.stringify({
          to_user_id: submission.jellyUserId,
          post_id: submission.jellyPostId,
          jelly_id: submission.jellyPostId,
          token: mission.rewardToken,
          amount: mission.rewardAmount,
          note_text: `Jellyhunt mission reward: ${mission.title}`,
          is_tip: true,
          is_public: true,
          idempotency_key: rewardAttempt.idempotencyKey,
        }),
      });
      response = result.response;
      responseText = result.text;
    } catch (error) {
      await saveReward(
        ctx,
        args.rewardAttemptId,
        partnerEndpoint ? "failed" : "uncertain",
        "",
        `${partnerEndpoint ? "Partner" : "Legacy"} Jelly reward request failed: ${error instanceof Error ? error.message : "network error"}`,
      );
      return;
    }

    if (response.ok) {
      const transactionId = responseTransactionId(parseJson(responseText));
      if (transactionId) {
        await saveReward(ctx, args.rewardAttemptId, "sent", responseText);
      } else {
        await saveReward(
          ctx,
          args.rewardAttemptId,
          "uncertain",
          responseText,
          "Jelly reward endpoint returned success without a transaction ID",
        );
      }
      return;
    }

    const legacyOutcome: RewardOutcome =
      !partnerEndpoint && (response.status >= 500 || response.status === 408 || response.status === 429)
        ? "uncertain"
        : "failed";
    await saveReward(
      ctx,
      args.rewardAttemptId,
      legacyOutcome,
      responseText,
      `Jelly reward endpoint returned HTTP ${response.status}`,
    );
  },
});
