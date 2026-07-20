import { randomUUID } from "crypto";
import { z } from "zod";
import { JellyhuntV2Error, internalError, notFound } from "@/src/lib/jellyhunt/v2/errors";
import { wrapError } from "@/src/lib/jellyhunt/v2/envelope";
import { computeCanonicalRequestHash, extractIdempotencyKey } from "@/src/lib/jellyhunt/v2/idempotency";
import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { preflightJellyPost } from "@/src/lib/jellyhunt/v2/jelly-post-preflight";
import { invalidRequest, parseRouteParams } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler, type V2RouteContext } from "@/src/lib/jellyhunt/v2/route-handler";
import {
  abandonSubmissionIntake,
  commitSubmissionIntake,
  finalizeSubmissionIntakeError,
  getSubmissionIntakeContext,
  prepareSubmissionIntake,
  type SubmissionIntakeLease,
  type SubmissionIntakeLeaseIdentity,
  type StoredSubmissionIntakeResponse,
} from "@/src/lib/jellyhunt/v2/write-repository";

const Params = z.object({ missionId: z.string().regex(/^mis_[0-9A-Za-z]+$/) }).strict();
const ClientLocation = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().nonnegative().max(100_000),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const SubmissionBody = z
  .object({
    participationId: z.string().regex(/^par_[0-9A-Za-z]+$/),
    missionRevision: z.number().int().nonnegative(),
    jellyPostId: z.string().trim().min(1).max(256),
    clientLocation: ClientLocation.optional(),
  })
  .strict();

type SubmissionBody = z.infer<typeof SubmissionBody>;
type MissionParams = { missionId: string };
type StableHeaders = Record<string, string>;

export const GET = createV2Handler(
  async () => {
    throw notFound("mission_submissions_not_yet_available");
  },
  { cachePolicy: "private" },
);

function contractTimestamp(value: number): string {
  return new Date(value).toISOString().replace(/\.000Z$/, "Z");
}

function stableHeaders(location?: string): StableHeaders {
  return {
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json",
    ...(location ? { Location: location } : {}),
    Vary: "Authorization",
  };
}

function rawResponse(
  bodyJson: string,
  status: number,
  requestId: string,
  headers: StableHeaders,
  transportHeaders: StableHeaders = {},
): Response {
  return new Response(bodyJson, {
    status,
    headers: {
      ...headers,
      ...transportHeaders,
      "X-Request-Id": requestId,
    },
  });
}

function errorBody(error: JellyhuntV2Error, requestId: string, now = Date.now()): string {
  const envelope = wrapError(error.errorCode, error.message, requestId, {
    retryable: error.statusCode === 429 || error.statusCode >= 500,
  });
  envelope.meta.generatedAt = contractTimestamp(now);
  return JSON.stringify(envelope);
}

function errorResponse(
  error: JellyhuntV2Error,
  requestId: string,
  extraHeaders: StableHeaders = {},
): Response {
  return rawResponse(errorBody(error, requestId), error.statusCode, requestId, stableHeaders(), extraHeaders);
}

function submissionError(status: number, code: string, message: string): JellyhuntV2Error {
  return new JellyhuntV2Error(status, code, message);
}

function mapSubmissionError(error: unknown): JellyhuntV2Error {
  if (error instanceof JellyhuntV2Error) return error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("jelly_post_reused") || message.includes("mission_already_submitted")) {
    return submissionError(409, "submission_conflict", "This submission conflicts with existing work.");
  }
  if (message.includes("participation_not_found") || message.includes("participation_user_mismatch")) {
    return submissionError(404, "participation_not_found", "This participation does not exist.");
  }
  if (message.includes("participation_mission_mismatch")) {
    return submissionError(409, "submission_conflict", "This submission conflicts with existing work.");
  }
  if (message.includes("mission_not_found")) {
    return submissionError(404, "mission_not_found", "This mission does not exist.");
  }
  if (message.includes("mission_revision_mismatch") || message.includes("mission_revision_not_found")) {
    return submissionError(409, "mission_revision_changed", "The mission revision has changed.");
  }
  if (message.includes("mission_not_accepting_submissions")) {
    return submissionError(409, "mission_not_available", "This mission is not accepting submissions.");
  }
  if (
    message.includes("submission_deadline_passed") ||
    message.includes("participation_expired") ||
    message.includes("participation_not_active")
  ) {
    return submissionError(409, "participation_expired", "This participation can no longer be submitted.");
  }
  if (message.includes("attempt_limit_reached")) {
    return submissionError(409, "attempt_limit_reached", "No submission attempts remain.");
  }
  if (message.includes("budget_not_allocated") || message.includes("budget_exceeded")) {
    return submissionError(409, "reward_capacity_exhausted", "Reward capacity is exhausted.");
  }
  if (message.includes("jelly_post_not_eligible") || message.includes("invalid_jelly_post_id")) {
    return submissionError(
      422,
      "jelly_post_not_eligible",
      "This Jelly post does not meet the mission requirements.",
    );
  }
  if (message.includes("invalid_client_location")) {
    return invalidRequest();
  }
  if (message.includes("rate_limited")) {
    return submissionError(429, "rate_limited", "Too many requests.");
  }
  if (
    message.includes("jelly_preflight_stale") ||
    message.includes("convex_not_configured") ||
    message.includes("convex_service_key_not_configured") ||
    message.includes("submission_intake_context_invalid") ||
    message.includes("submission_attempt_changed") ||
    message.includes("unauthorized")
  ) {
    return submissionError(
      503,
      "dependency_unavailable",
      "A required dependency is temporarily unavailable.",
    );
  }
  return internalError();
}

async function parseBody(request: Request): Promise<SubmissionBody> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw invalidRequest();
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw invalidRequest();
  }
  const parsed = SubmissionBody.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function parseStoredHeaders(response: StoredSubmissionIntakeResponse): StableHeaders {
  const result = stableHeaders(response.locationHeader);
  if (!response.headersJson) return result;
  let value: unknown;
  try {
    value = JSON.parse(response.headersJson);
  } catch {
    throw internalError();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw internalError();
  const allowed = new Set(["cache-control", "content-type", "location", "vary"]);
  for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(key.toLowerCase()) || typeof headerValue !== "string") throw internalError();
    result[key] = headerValue;
  }
  if (response.locationHeader) result.Location = response.locationHeader;
  return result;
}

function replayResponse(
  stored: StoredSubmissionIntakeResponse,
  requestId: string,
): Response {
  return rawResponse(stored.bodyJson, stored.status, requestId, parseStoredHeaders(stored), {
    "Idempotent-Replayed": "true",
    "Idempotency-Original-Request-Id": stored.originalRequestId,
  });
}

function leaseIdentity(
  lease: SubmissionIntakeLease,
  jellySubjectId: string,
  normalizedPath: string,
  requestHash: string,
  now: number,
): SubmissionIntakeLeaseIdentity {
  return {
    recordId: lease.recordId,
    jellySubjectId,
    httpMethod: "POST",
    normalizedPath,
    requestHash,
    leaseOwner: lease.leaseOwner,
    leaseGeneration: lease.leaseGeneration,
    submissionPublicId: lease.submissionPublicId,
    now,
  };
}

async function settleAcquiredError(args: {
  error: unknown;
  lease: SubmissionIntakeLease;
  jellySubjectId: string;
  normalizedPath: string;
  requestHash: string;
  requestId: string;
}): Promise<Response> {
  const mapped = mapSubmissionError(args.error);
  const now = Date.now();
  const identity = leaseIdentity(
    args.lease,
    args.jellySubjectId,
    args.normalizedPath,
    args.requestHash,
    now,
  );
  const bodyJson = errorBody(mapped, args.requestId, now);
  const headers = stableHeaders();

  if (mapped.statusCode === 429 || mapped.statusCode >= 500) {
    try {
      await abandonSubmissionIntake(identity);
    } catch {
      // The processing lease remains bounded and reclaimable after expiry.
    }
    return rawResponse(bodyJson, mapped.statusCode, args.requestId, headers, {
      "Retry-After": "1",
    });
  }

  try {
    await finalizeSubmissionIntakeError({
      ...identity,
      responseStatus: mapped.statusCode,
      responseBodyJson: bodyJson,
      responseHeadersJson: JSON.stringify(headers),
    });
  } catch {
    try {
      await abandonSubmissionIntake(identity);
    } catch {
      // A completed record will reject abandonment and replay on the next request.
    }
    return errorResponse(
      submissionError(
        503,
        "dependency_unavailable",
        "A required dependency is temporarily unavailable.",
      ),
      args.requestId,
      { "Retry-After": "1" },
    );
  }
  return rawResponse(bodyJson, mapped.statusCode, args.requestId, headers);
}

function prepareConflict(status: string): JellyhuntV2Error {
  if (status === "key_reused") {
    return submissionError(409, "idempotency_key_reused", "This idempotency key was used for another request.");
  }
  if (status === "expired") {
    return submissionError(409, "idempotency_record_expired", "This idempotency record has expired.");
  }
  if (status === "in_progress") {
    return submissionError(409, "idempotency_in_progress", "This request is already being processed.");
  }
  return internalError();
}

export async function POST(
  request: Request,
  context: V2RouteContext<MissionParams>,
): Promise<Response> {
  const requestId = randomUUID();
  let viewer: Awaited<ReturnType<typeof requireJellyViewer>>;
  let missionId: string;
  let body: SubmissionBody;
  let idempotencyKey: string;
  let normalizedPath: string;
  let requestHash: string;

  try {
    if (new URL(request.url).search) throw invalidRequest();
    viewer = await requireJellyViewer(request, "jellyhunt:submit");
    ({ missionId } = await parseRouteParams(context, Params));
    body = await parseBody(request);
    const extractedKey = extractIdempotencyKey(request);
    if (!extractedKey) {
      throw submissionError(
        400,
        "invalid_idempotency_key",
        "Idempotency-Key must be a client-generated UUID or ULID.",
      );
    }
    idempotencyKey = extractedKey;
    normalizedPath = `/api/v2/jellyhunt/missions/${missionId}/submissions`;
    requestHash = await computeCanonicalRequestHash("POST", normalizedPath, body);
  } catch (error) {
    return errorResponse(mapSubmissionError(error), requestId);
  }

  let prepared;
  try {
    prepared = await prepareSubmissionIntake({
      jellySubjectId: viewer.jellyUserId,
      httpMethod: "POST",
      normalizedPath,
      idempotencyKey,
      requestHash,
      originalRequestId: requestId,
      leaseOwner: randomUUID(),
      now: Date.now(),
    });
  } catch (error) {
    return errorResponse(mapSubmissionError(error), requestId, { "Retry-After": "1" });
  }

  if (prepared.status === "replay") return replayResponse(prepared.response, requestId);
  if (prepared.status !== "acquired") {
    const error = prepareConflict(prepared.status);
    const headers: StableHeaders = prepared.status === "in_progress"
      ? { "Retry-After": String(Math.max(1, Math.ceil(prepared.retryAfter / 1_000))) }
      : {};
    return errorResponse(error, requestId, headers);
  }

  try {
    const intake = await getSubmissionIntakeContext({
      jellyUserId: viewer.jellyUserId,
      participationPublicId: body.participationId,
      missionPublicId: missionId,
      missionRevision: body.missionRevision,
      now: Date.now(),
    });
    const exactPreflight = await preflightJellyPost({
      jellyPostId: body.jellyPostId,
      submissionPublicId: prepared.submissionPublicId,
      jellyUserId: viewer.jellyUserId,
      requestId,
    });
    const committedAt = Date.now();
    const location = `/api/v2/jellyhunt/submissions/${prepared.submissionPublicId}`;
    const timestamp = contractTimestamp(committedAt);
    const accepted = {
      data: {
        id: prepared.submissionPublicId,
        missionId,
        attempt: intake.attempt,
        jellyPost: {
          id: body.jellyPostId,
          watchUrl: `https://jellyjelly.com/watch/${encodeURIComponent(body.jellyPostId)}`,
        },
        submissionStatus: "submitted",
        reward: {
          status: "not_eligible",
          amount: intake.reward.amount,
          token: intake.reward.token,
          transactionId: null,
        },
        displayStatus: "submitted",
        publicMessage: "Your Jelly was submitted and is being checked.",
        canResubmit: false,
        submittedAt: timestamp,
        updatedAt: timestamp,
      },
      meta: {
        apiVersion: "2.0",
        requestId,
        generatedAt: timestamp,
      },
      links: {
        self: location,
        mission: `/api/v2/jellyhunt/missions/${missionId}`,
        events: `/api/v2/jellyhunt/submissions/${prepared.submissionPublicId}/events`,
      },
    } as const;
    const responseBodyJson = JSON.stringify(accepted);
    const responseHeaders = stableHeaders(location);
    await commitSubmissionIntake({
      ...leaseIdentity(
        prepared,
        viewer.jellyUserId,
        normalizedPath,
        requestHash,
        committedAt,
      ),
      missionPublicId: missionId,
      participationPublicId: body.participationId,
      missionRevision: body.missionRevision,
      expectedAttempt: intake.attempt,
      jellyPostId: body.jellyPostId,
      preflight: exactPreflight,
      ...(body.clientLocation
        ? {
            clientLocation: {
              latitude: body.clientLocation.latitude,
              longitude: body.clientLocation.longitude,
              accuracyMeters: body.clientLocation.accuracyMeters,
              capturedAt: Date.parse(body.clientLocation.capturedAt),
            },
          }
        : {}),
      responseStatus: 202,
      responseBodyJson,
      responseHeadersJson: JSON.stringify(responseHeaders),
      locationHeader: location,
    });
    return rawResponse(responseBodyJson, 202, requestId, responseHeaders, {
      "Idempotent-Replayed": "false",
    });
  } catch (error) {
    return await settleAcquiredError({
      error,
      lease: prepared,
      jellySubjectId: viewer.jellyUserId,
      normalizedPath,
      requestHash,
      requestId,
    });
  }
}
