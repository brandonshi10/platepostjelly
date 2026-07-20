import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { createPublicId, assertPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { requireServiceKey } from "./security";
import { loadMissionByPublicId } from "./missions";
import { parseCanonicalRewardAmount } from "./amounts";
import { reserveSubmissionRewardBudgetsInternal } from "./budgets";
import { appendSubmissionEventInternal } from "./events";
import {
  abandonIdempotencyLeaseInternal,
  acquireIdempotencyLeaseInternal,
  completeIdempotencyRecordInternal,
  requireActiveIdempotencyLeaseInternal,
} from "./idempotency";

/**
 * Live-completion submission intake for the namespaced JellyHunt Convex
 * schema. See `convex/jellyhunt/audit.ts` for why these use
 * `convex/server`'s generic `mutationGeneric`/`queryGeneric` builders
 * instead of a generated `./_generated/server` (codegen has not run in this
 * repo yet).
 *
 * `createSubmission` is the single write path a mobile client's "I did the
 * mission" call lands on. It never decides verification/approval here (that
 * is `approvals.ts`'s job later in the pipeline) — this only intakes the
 * claim, guards against reuse (Jelly post ID, dedupe key), snapshots the
 * mission/place/reward terms the participant is being held to, and opens a
 * `pending_verification` reward reservation.
 */

async function loadParticipationByPublicId(ctx: any, participationPublicId: string) {
  const normalized = assertPublicId("par", participationPublicId);
  const participation = await ctx.db
    .query("jellyhuntParticipations")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!participation) throw new Error("participation_not_found");
  return participation;
}

async function loadSubmissionByPublicId(ctx: any, submissionPublicId: string) {
  const normalized = assertPublicId("sub", submissionPublicId);
  return await ctx.db
    .query("jellyhuntSubmissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
}

async function toPublicSubmission(ctx: any, submission: any) {
  const [campaign, mission, participation] = await Promise.all([
    ctx.db.get(submission.campaignId),
    ctx.db.get(submission.missionId),
    ctx.db.get(submission.participationId),
  ]);
  const snapshot = submission.placeSnapshot;
  const place = snapshot?.placeId ? await ctx.db.get(snapshot.placeId) : null;

  return {
    id: submission.publicId,
    campaignId: campaign?.publicId ?? null,
    missionId: mission?.publicId ?? null,
    participationId: participation?.publicId ?? null,
    jellyPostId: submission.jellyPostId,
    attempt: submission.attempt,
    submissionStatus: submission.submissionStatus,
    rewardStatus: submission.rewardStatus,
    verificationStatus: submission.verificationStatus,
    decisionStatus: submission.decisionStatus,
    ...(submission.reasonCode !== undefined ? { reasonCode: submission.reasonCode } : {}),
    ...(submission.publicMessage !== undefined ? { publicMessage: submission.publicMessage } : {}),
    missionTitleSnapshot: submission.missionTitleSnapshot,
    rewardSnapshot: submission.rewardSnapshot,
    placeSnapshot: {
      placeId: place?.publicId ?? null,
      jellyPlaceId: snapshot.jellyPlaceId,
      name: snapshot.name,
      ...(snapshot.address !== undefined ? { address: snapshot.address } : {}),
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      timeZone: snapshot.timeZone,
    },
    submittedAt: submission.submittedAt,
    ...(submission.decidedAt !== undefined ? { decidedAt: submission.decidedAt } : {}),
    updatedAt: submission.updatedAt,
  };
}

const PREFLIGHT_MAX_AGE_MS = 60_000;
const PREFLIGHT_FUTURE_TOLERANCE_MS = 5_000;
const REVIEW_DEADLINE_MS = 72 * 60 * 60 * 1000;

const intakeLeaseIdentityValidators = {
  recordId: v.id("jellyhuntIdempotencyRecords"),
  jellySubjectId: v.string(),
  httpMethod: v.string(),
  normalizedPath: v.string(),
  requestHash: v.string(),
  leaseOwner: v.string(),
  leaseGeneration: v.number(),
  submissionPublicId: v.string(),
  now: v.number(),
};

function normalizeOpaque(value: string, code: string, maxLength = 256): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function validateJsonResponseBody(value: string, submissionPublicId?: string): void {
  let body: any;
  try {
    body = JSON.parse(value);
  } catch {
    throw new Error("invalid_response_body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_response_body");
  if (submissionPublicId !== undefined && body?.data?.id !== submissionPublicId) {
    throw new Error("invalid_submission_response_binding");
  }
}

function validateClientLocation(clientLocation: any, now: number) {
  if (clientLocation === undefined) return undefined;
  const { latitude, longitude, accuracyMeters, capturedAt } = clientLocation;
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 100_000 ||
    !Number.isFinite(capturedAt) || capturedAt > now + 5 * 60_000
  ) throw new Error("invalid_client_location");
  return { latitude, longitude, accuracyMeters, capturedAt };
}

function leaseIdentity(args: any, submissionPublicId: string) {
  return {
    recordId: args.recordId,
    jellySubjectId: args.jellySubjectId,
    httpMethod: args.httpMethod,
    normalizedPath: args.normalizedPath,
    requestHash: args.requestHash,
    leaseOwner: args.leaseOwner,
    leaseGeneration: args.leaseGeneration,
    resourcePublicId: submissionPublicId,
    now: args.now,
  };
}

/** Acquire HTTP idempotency and bind a preallocated submission ID before Jelly preflight. */
export const prepareSubmissionIntake = mutationGeneric({
  args: {
    serviceKey: v.string(), jellySubjectId: v.string(), httpMethod: v.string(), normalizedPath: v.string(),
    idempotencyKey: v.string(), requestHash: v.string(), originalRequestId: v.string(), leaseOwner: v.string(),
    campaignEndsAt: v.optional(v.number()), now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const result: any = await acquireIdempotencyLeaseInternal(ctx, {
      jellySubjectId: args.jellySubjectId, httpMethod: args.httpMethod, normalizedPath: args.normalizedPath,
      idempotencyKey: args.idempotencyKey, requestHash: args.requestHash,
      originalRequestId: args.originalRequestId, leaseOwner: args.leaseOwner,
      resourcePublicId: createPublicId("sub"), campaignEndsAt: args.campaignEndsAt, now: args.now,
    });
    if (result.status !== "acquired") return result;
    const { resourcePublicId, ...lease } = result;
    return { ...lease, submissionPublicId: resourcePublicId };
  },
});

/** Commit submission, capacity, history, and exact HTTP response in one transaction after exact Jelly preflight. */
export const commitSubmissionIntake = mutationGeneric({
  args: {
    serviceKey: v.string(), ...intakeLeaseIdentityValidators,
    missionPublicId: v.string(), participationPublicId: v.string(), missionRevision: v.number(), jellyPostId: v.string(),
    preflight: v.object({
      jellyPostId: v.string(), canonicalOwnerUserId: v.string(), ownershipStatus: v.literal("matched"), checkedAt: v.number(),
    }),
    clientLocation: v.optional(v.object({
      latitude: v.number(), longitude: v.number(), accuracyMeters: v.number(), capturedAt: v.number(),
    })),
    responseStatus: v.number(), responseBodyJson: v.string(), responseHeadersJson: v.string(), locationHeader: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const submissionPublicId = assertPublicId("sub", args.submissionPublicId);
    const idempotencyRecord = await requireActiveIdempotencyLeaseInternal(ctx, leaseIdentity(args, submissionPublicId));

    if (args.responseStatus !== 202) throw new Error("invalid_submission_response_status");
    const expectedLocation = `/api/v2/jellyhunt/submissions/${submissionPublicId}`;
    if (args.locationHeader !== expectedLocation) throw new Error("invalid_submission_location");
    validateJsonResponseBody(args.responseBodyJson, submissionPublicId);
    try { JSON.parse(args.responseHeadersJson); } catch { throw new Error("invalid_response_headers"); }

    const jellyUserId = normalizeOpaque(args.jellySubjectId, "invalid_jelly_subject_id");
    const jellyPostId = normalizeOpaque(args.jellyPostId, "invalid_jelly_post_id");
    if (
      normalizeOpaque(args.preflight.jellyPostId, "invalid_jelly_post_id") !== jellyPostId ||
      normalizeOpaque(args.preflight.canonicalOwnerUserId, "invalid_jelly_subject_id") !== jellyUserId
    ) throw new Error("jelly_post_not_eligible");
    if (
      !Number.isFinite(args.preflight.checkedAt) || args.preflight.checkedAt > args.now + PREFLIGHT_FUTURE_TOLERANCE_MS ||
      args.now - args.preflight.checkedAt > PREFLIGHT_MAX_AGE_MS
    ) throw new Error("jelly_preflight_stale");
    const clientLocation = validateClientLocation(args.clientLocation, args.now);

    if (await loadSubmissionByPublicId(ctx, submissionPublicId)) throw new Error("recovery_required");
    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status !== "active" || !mission.acceptingSubmissions) throw new Error("mission_not_accepting_submissions");
    const campaign = await ctx.db.get(mission.campaignId);
    if (!campaign) throw new Error("campaign_not_found");
    const participation = await loadParticipationByPublicId(ctx, args.participationPublicId);
    if (participation.jellyUserId !== jellyUserId) throw new Error("participation_user_mismatch");
    if (participation.missionId !== mission._id) throw new Error("participation_mission_mismatch");
    if (participation.status !== "started") throw new Error("participation_not_active");
    if (!Number.isInteger(args.missionRevision) || participation.missionRevision !== args.missionRevision) {
      throw new Error("mission_revision_mismatch");
    }
    if (participation.submissionDeadlineAt <= args.now) throw new Error("submission_deadline_passed");

    const lockedRevision = await ctx.db.query("jellyhuntMissionRevisions")
      .withIndex("by_mission_revision", (q: any) => q.eq("missionId", mission._id).eq("revision", participation.missionRevision))
      .unique();
    if (!lockedRevision) throw new Error("mission_revision_not_found");
    if (
      !Number.isInteger(participation.attemptsUsed) || !Number.isInteger(participation.maxAttempts) ||
      participation.attemptsUsed < 0 || participation.attemptsUsed >= participation.maxAttempts
    ) throw new Error("attempt_limit_reached");

    const missionUserSubmissions = await ctx.db.query("jellyhuntSubmissions")
      .withIndex("by_mission_user", (q: any) => q.eq("missionId", mission._id).eq("jellyUserId", jellyUserId)).collect();
    if (missionUserSubmissions.some((submission: any) => submission.submissionStatus !== "rejected")) {
      throw new Error("mission_already_submitted");
    }
    if (participation.attemptsUsed > 0) {
      if (!lockedRevision.requirements.resubmission.allowedAfterRejection) throw new Error("attempt_limit_reached");
      if (participation.resubmissionDeadlineAt !== undefined && participation.resubmissionDeadlineAt <= args.now) {
        throw new Error("participation_expired");
      }
    }
    const existingByPost = await ctx.db.query("jellyhuntSubmissions")
      .withIndex("by_jelly_post", (q: any) => q.eq("jellyPostId", jellyPostId)).first();
    if (existingByPost) throw new Error("jelly_post_reused");

    parseCanonicalRewardAmount(lockedRevision.reward.amount);
    const attempt = participation.attemptsUsed + 1;
    const dedupeKey = `${participation.publicId}:attempt:${attempt}`;
    if (await ctx.db.query("jellyhuntSubmissions").withIndex("by_dedupe_key", (q: any) => q.eq("dedupeKey", dedupeKey)).first()) {
      throw new Error("mission_already_submitted");
    }

    await reserveSubmissionRewardBudgetsInternal(ctx, {
      campaignId: campaign._id, campaignPublicId: campaign.publicId,
      missionId: mission._id, missionPublicId: mission.publicId, amount: lockedRevision.reward.amount,
    });
    const submissionId = await ctx.db.insert("jellyhuntSubmissions", {
      publicId: submissionPublicId, campaignId: campaign._id, missionId: mission._id, participationId: participation._id,
      jellyUserId, jellyPostId, dedupeKey, attempt, source: "live", missionRevision: participation.missionRevision,
      submissionStatus: "submitted", rewardStatus: "not_eligible", missionTitleSnapshot: lockedRevision.title,
      approvalModeSnapshot: lockedRevision.approvalMode ?? mission.approvalMode,
      placeSnapshot: lockedRevision.place, rewardSnapshot: lockedRevision.reward,
      claimedLatitude: clientLocation?.latitude, claimedLongitude: clientLocation?.longitude,
      claimedAccuracyMeters: clientLocation?.accuracyMeters, claimedCapturedAt: clientLocation?.capturedAt,
      verificationStatus: "pending", verificationAttempts: 0, decisionStatus: "pending",
      submittedAt: args.now, createdAt: args.now, updatedAt: args.now,
    });
    await ctx.db.insert("jellyhuntRewardReservations", {
      submissionId, campaignId: campaign._id, missionId: mission._id, jellyUserId,
      amount: lockedRevision.reward.amount, token: lockedRevision.reward.token,
      status: "pending_verification", reviewDeadlineAt: args.now + REVIEW_DEADLINE_MS,
      createdAt: args.now, updatedAt: args.now,
    });
    await ctx.db.patch(participation._id, { attemptsUsed: attempt, updatedAt: args.now });
    await appendSubmissionEventInternal(ctx, {
      submissionPublicId, type: "submission.created", submissionStatus: "submitted", rewardStatus: "not_eligible",
      displayStatus: "submitted", publicMessage: "Your Jelly was submitted and is being checked.",
      internalMetadataJson: JSON.stringify({ preflightCheckedAt: args.preflight.checkedAt }), occurredAt: args.now,
    });
    await recordAuditEvent(ctx, {
      actor: jellyUserId, action: "submission.created", entityType: "submission", entityId: submissionId,
      nextState: { publicId: submissionPublicId, submissionStatus: "submitted", jellyPostId },
      requestId: idempotencyRecord.originalRequestId,
    });
    await completeIdempotencyRecordInternal(ctx, idempotencyRecord, {
      responseStatus: args.responseStatus, responseBodyJson: args.responseBodyJson,
      responseHeadersJson: args.responseHeadersJson, locationHeader: args.locationHeader,
      resourceId: submissionPublicId, campaignEndsAt: campaign.endsAt, now: args.now,
    });
    return { status: "completed", submissionPublicId, attempt };
  },
});

/** Finalize deterministic 4xx bytes only; transient results remain retryable. */
export const finalizeSubmissionIntakeError = mutationGeneric({
  args: {
    serviceKey: v.string(), ...intakeLeaseIdentityValidators,
    responseStatus: v.number(), responseBodyJson: v.string(),
    responseHeadersJson: v.optional(v.string()), locationHeader: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const submissionPublicId = assertPublicId("sub", args.submissionPublicId);
    if (args.responseStatus === 429 || args.responseStatus >= 500) throw new Error("transient_response_not_finalizable");
    if (args.responseStatus < 400 || args.responseStatus > 499) throw new Error("invalid_error_response_status");
    validateJsonResponseBody(args.responseBodyJson);
    const record = await requireActiveIdempotencyLeaseInternal(ctx, leaseIdentity(args, submissionPublicId));
    return completeIdempotencyRecordInternal(ctx, record, {
      responseStatus: args.responseStatus, responseBodyJson: args.responseBodyJson,
      responseHeadersJson: args.responseHeadersJson, locationHeader: args.locationHeader, now: args.now,
    });
  },
});

/** Release only a transient processing lease, never the durable key/request binding. */
export const abandonSubmissionIntake = mutationGeneric({
  args: { serviceKey: v.string(), ...intakeLeaseIdentityValidators },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const submissionPublicId = assertPublicId("sub", args.submissionPublicId);
    return abandonIdempotencyLeaseInternal(ctx, leaseIdentity(args, submissionPublicId));
  },
});
/**
 * Service-only: intake a live mission-completion claim.
 *
 * Validates, in order: the mission exists and is currently accepting
 * submissions, the participation exists/belongs to the caller/is `started`,
 * the caller's and mission's revisions still agree with the participation's
 * locked-in `missionRevision`, the Jelly post hasn't already been used on
 * any other submission (`by_jelly_post`), and the dedupe key hasn't already
 * produced a non-rejected submission (`by_dedupe_key`) — a prior rejected
 * attempt is allowed to be resubmitted under a new `attempt` number (and
 * therefore a new `dedupeKey`), but a still-live attempt is not. On success
 * it snapshots the mission title/approval mode/place/reward terms onto the
 * new submission row (so a later mission edit can never retroactively
 * change what a participant is owed), opens a `pending_verification` reward
 * reservation for the snapshot amount, and advances the participation's
 * `attemptsUsed` counter.
 */
export const createSubmission = mutationGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    missionPublicId: v.string(),
    participationPublicId: v.string(),
    missionRevision: v.number(),
    jellyPostId: v.string(),
    dedupeKey: v.string(),
    attempt: v.number(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();

    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status !== "active" || !mission.acceptingSubmissions) {
      throw new Error("mission_not_accepting_submissions");
    }

    const participation = await loadParticipationByPublicId(ctx, args.participationPublicId);
    if (participation.jellyUserId !== jellyUserId) {
      throw new Error("participation_user_mismatch");
    }
    if (participation.missionId !== mission._id) {
      throw new Error("participation_mission_mismatch");
    }
    if (participation.status !== "started") {
      throw new Error("participation_not_active");
    }
    if (participation.missionRevision !== args.missionRevision) {
      throw new Error("mission_revision_mismatch");
    }

    // Deadline enforcement: `jellyhuntParticipations.submissionDeadlineAt`
    // is the only such field in the current schema (no per-mission
    // submission-deadline field exists on `jellyhuntMissions`/
    // `jellyhuntCampaigns`), so that is what is checked here.
    if (participation.submissionDeadlineAt <= args.now) {
      throw new Error("submission_deadline_passed");
    }

    const lockedRevision = await ctx.db
      .query("jellyhuntMissionRevisions")
      .withIndex("by_mission_revision", (q: any) =>
        q.eq("missionId", mission._id).eq("revision", participation.missionRevision),
      )
      .unique();
    if (!lockedRevision) throw new Error("mission_revision_not_found");

    const jellyPostId = args.jellyPostId.trim();
    if (!jellyPostId || jellyPostId.length > 256) {
      throw new Error("invalid_jelly_post_id");
    }
    const existingByPost = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_jelly_post", (q: any) => q.eq("jellyPostId", jellyPostId))
      .unique();
    if (existingByPost) throw new Error("jelly_post_reused");

    const existingByDedupe = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_dedupe_key", (q: any) => q.eq("dedupeKey", args.dedupeKey))
      .unique();
    if (existingByDedupe && existingByDedupe.submissionStatus !== "rejected") {
      throw new Error("mission_already_submitted");
    }

    const placeSnapshot = lockedRevision.place;
    const rewardSnapshot = lockedRevision.reward;

    const now = args.now;
    const publicId = createPublicId("sub");
    const submissionId = await ctx.db.insert("jellyhuntSubmissions", {
      publicId,
      campaignId: mission.campaignId,
      missionId: mission._id,
      participationId: participation._id,
      jellyUserId,
      jellyPostId,
      dedupeKey: args.dedupeKey,
      attempt: args.attempt,
      source: "live",
      missionRevision: args.missionRevision,
      submissionStatus: "submitted",
      rewardStatus: "not_eligible",
      missionTitleSnapshot: lockedRevision.title,
      approvalModeSnapshot: lockedRevision.approvalMode ?? mission.approvalMode,
      placeSnapshot,
      rewardSnapshot,
      verificationStatus: "pending",
      verificationAttempts: 0,
      decisionStatus: "pending",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("jellyhuntRewardReservations", {
      submissionId,
      campaignId: mission.campaignId,
      missionId: mission._id,
      jellyUserId,
      amount: rewardSnapshot.amount,
      token: rewardSnapshot.token,
      status: "pending_verification",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(participation._id, {
      attemptsUsed: participation.attemptsUsed + 1,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: jellyUserId,
      action: "submission.created",
      entityType: "submission",
      entityId: submissionId,
      nextState: { publicId, submissionStatus: "submitted", jellyPostId },
    });

    return { submissionPublicId: publicId };
  },
});

/**
 * Public (owner-only): submission detail by public ID.
 *
 * Returns `null` for a submission that doesn't exist or doesn't belong to
 * `jellyUserId` — never distinguishes the two, so an enumeration attempt
 * cannot tell "not found" from "not yours" apart.
 */
export const getSubmissionByPublicId = queryGeneric({
  args: { serviceKey: v.string(), submissionPublicId: v.string(), jellyUserId: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const submission = await loadSubmissionByPublicId(ctx, args.submissionPublicId);
    if (!submission || submission.jellyUserId !== jellyUserId) return null;
    return await toPublicSubmission(ctx, submission);
  },
});

/** Server-only owner read: the caller's submissions, newest first. */
export const listUserSubmissions = queryGeneric({
  args: { serviceKey: v.string(), jellyUserId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 200);
    const submissions = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_user_updated", (q: any) => q.eq("jellyUserId", jellyUserId))
      .order("desc")
      .take(limit);
    return await Promise.all(submissions.map((submission: any) => toPublicSubmission(ctx, submission)));
  },
});
