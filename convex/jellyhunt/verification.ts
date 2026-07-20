import {
  anyApi,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { recordAuditEvent } from "./audit";
import { transitionSubmissionBudgetsInternal } from "./budgets";
import { appendSubmissionEventInternal } from "./events";
import {
  getJellyHttpConfig,
  getJellyPartnerHttpConfig,
  jellyGet,
  jellyPost,
  partnerTransportIsUsable,
} from "./jellyHttpClient";
import {
  buildPartnerVerificationIdempotencyKey,
  buildPartnerVerificationRequest,
  evidenceDistanceMeters,
  evaluatePartnerEvidence,
  parsePartnerEvidence,
  type VerificationContext,
  type VerificationPolicyResult,
} from "./verificationPolicy";

const VERIFICATION_LEASE_MS = 2 * 60_000;

export function buildLegacyJellyPath(jellyPostId: string): string {
  const normalized = jellyPostId.trim();
  if (!normalized || normalized.length > 256) throw new Error("invalid_jelly_post_id");
  return `/v3/jelly/${encodeURIComponent(normalized)}`;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return evidenceDistanceMeters(lat1, lon1, lat2, lon2);
}

async function loadVerificationContext(ctx: any, submissionInternalId: string) {
  const submission = await ctx.db.get(submissionInternalId as any);
  if (!submission) return null;
  const [mission, campaign, revision] = await Promise.all([
    ctx.db.get(submission.missionId),
    ctx.db.get(submission.campaignId),
    ctx.db
      .query("jellyhuntMissionRevisions")
      .withIndex("by_mission_revision", (q: any) =>
        q.eq("missionId", submission.missionId).eq("revision", submission.missionRevision),
      )
      .unique(),
  ]);
  if (!mission || !campaign || !revision) throw new Error("verification_snapshot_not_found");

  const context: VerificationContext = {
    submissionPublicId: submission.publicId,
    missionPublicId: mission.publicId,
    missionRevision: submission.missionRevision,
    jellyUserId: submission.jellyUserId,
    jellyPostId: submission.jellyPostId,
    approvalMode: submission.approvalModeSnapshot,
    place: {
      jellyPlaceId: submission.placeSnapshot.jellyPlaceId,
      latitude: submission.placeSnapshot.latitude,
      longitude: submission.placeSnapshot.longitude,
      geofenceRadiusMeters: submission.placeSnapshot.geofenceRadiusMeters,
    },
    requirements: {
      post: revision.requirements.post,
      place: revision.requirements.place,
      location: revision.requirements.location,
      schedule: revision.requirements.schedule,
    },
    missionWindow: {
      startsAt: revision.missionWindow.startsAt ?? campaign.startsAt,
      endsAt: revision.missionWindow.endsAt ?? campaign.endsAt,
    },
  };
  return { submission, context };
}

/** Owner-free internal snapshot read retained for diagnostics and tests. */
export const getSubmissionForVerification = internalQueryGeneric({
  args: { submissionInternalId: v.string() },
  handler: async (ctx: any, args: any) => {
    const loaded = await loadVerificationContext(ctx, args.submissionInternalId);
    return loaded?.context ?? null;
  },
});

/** Atomically lease the next verification attempt and expose immutable terms. */
export const beginSubmissionVerification = internalMutationGeneric({
  args: { submissionInternalId: v.string(), now: v.number() },
  handler: async (ctx: any, args: any) => {
    const loaded = await loadVerificationContext(ctx, args.submissionInternalId);
    if (!loaded) throw new Error("submission_not_found");
    const { submission, context } = loaded;
    if (submission.decisionStatus !== "pending" || submission.submissionStatus === "approved" || submission.submissionStatus === "rejected") {
      return { started: false, reason: "submission_terminal" };
    }
    if (
      submission.verificationStatus === "in_progress" &&
      submission.verificationStartedAt !== undefined &&
      submission.verificationStartedAt + VERIFICATION_LEASE_MS > args.now
    ) return { started: false, reason: "verification_in_progress" };

    const verificationAttempt = submission.verificationAttempts + 1;
    await ctx.db.patch(submission._id, {
      submissionStatus: "verifying",
      verificationStatus: "in_progress",
      verificationAttempts: verificationAttempt,
      verificationStartedAt: args.now,
      verificationCompletedAt: undefined,
      verificationSummary: undefined,
      reasonCode: undefined,
      publicMessage: "Your Jelly is being checked.",
      updatedAt: args.now,
    });
    await appendSubmissionEventInternal(ctx, {
      submissionPublicId: submission.publicId,
      type: "verification.started",
      submissionStatus: "verifying",
      rewardStatus: submission.rewardStatus,
      displayStatus: "under_review",
      publicMessage: "Your Jelly is being checked.",
      internalMetadataJson: JSON.stringify({ verificationAttempt }),
      occurredAt: args.now,
    });
    return { started: true, verificationAttempt, context };
  },
});

const verificationOutcome = v.union(
  v.literal("approve"),
  v.literal("needs_review"),
  v.literal("reject"),
  v.literal("retry"),
);

/**
 * Persist one current verification result. Approval remains pending here;
 * the action must call the canonical approval mutation so completion,
 * rankings, reservation state, and reward intent commit together.
 */
export const recordVerificationResult = internalMutationGeneric({
  args: {
    submissionInternalId: v.string(),
    verificationAttempt: v.optional(v.number()),
    verificationStatus: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("complete"),
      v.literal("unavailable"),
    ),
    outcome: v.optional(verificationOutcome),
    verifiedLatitude: v.optional(v.number()),
    verifiedLongitude: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
    verificationSummary: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    publicMessage: v.optional(v.string()),
    // Backward-compatible internal input. "approved" means ready for the
    // canonical approval mutation; it never writes decisionStatus directly.
    decisionStatus: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
    requestId: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    const submission = await ctx.db.get(args.submissionInternalId as any);
    if (!submission) throw new Error("submission_not_found");
    if (
      args.verificationAttempt !== undefined &&
      args.verificationAttempt !== submission.verificationAttempts
    ) return { ignored: true, reason: "stale_verification_attempt" };
    if (submission.submissionStatus === "approved" || submission.submissionStatus === "rejected") {
      return { ignored: true, reason: "submission_terminal" };
    }

    const outcome: VerificationPolicyResult["outcome"] | undefined =
      args.outcome ??
      (args.decisionStatus === "approved"
        ? "approve"
        : args.decisionStatus === "rejected"
          ? "reject"
          : undefined);
    const verificationAttempts =
      args.verificationAttempt === undefined
        ? submission.verificationAttempts + 1
        : submission.verificationAttempts;
    const patch: Record<string, unknown> = {
      verificationStatus: args.verificationStatus,
      verificationAttempts,
      verificationSummary: args.verificationSummary,
      updatedAt: args.now,
    };
    if (submission.verificationStartedAt === undefined) patch.verificationStartedAt = args.now;
    if (args.verificationStatus === "complete" || args.verificationStatus === "unavailable") {
      patch.verificationCompletedAt = args.now;
    }
    if (args.verifiedLatitude !== undefined) patch.verifiedLatitude = args.verifiedLatitude;
    if (args.verifiedLongitude !== undefined) patch.verifiedLongitude = args.verifiedLongitude;
    if (args.distanceMeters !== undefined) patch.distanceMeters = args.distanceMeters;

    let event = {
      type: "verification.completed",
      submissionStatus: submission.submissionStatus,
      rewardStatus: submission.rewardStatus,
      displayStatus: "under_review",
      reasonCode: args.reasonCode,
      publicMessage: args.publicMessage,
    };

    if (outcome === "approve") {
      patch.submissionStatus = "verifying";
      patch.decisionStatus = "pending";
      patch.reasonCode = undefined;
      patch.publicMessage = args.publicMessage ?? "Verification passed. Approval is being finalized.";
      event = { ...event, submissionStatus: "verifying", publicMessage: patch.publicMessage as string };
    } else if (outcome === "needs_review" || outcome === "retry") {
      const reasonCode = args.reasonCode ?? (outcome === "retry" ? "evidence_unavailable" : "manual_review_required");
      const publicMessage =
        args.publicMessage ??
        (outcome === "retry"
          ? "Evidence is temporarily unavailable. Your submission is queued for review."
          : "Your submission needs a review.");
      patch.submissionStatus = "needs_review";
      patch.decisionStatus = "pending";
      patch.reasonCode = reasonCode;
      patch.publicMessage = publicMessage;
      event = {
        ...event,
        type: outcome === "retry" ? "verification.unavailable" : "verification.needs_review",
        submissionStatus: "needs_review",
        reasonCode,
        publicMessage,
      };
    } else if (outcome === "reject") {
      const reasonCode = args.reasonCode ?? "post_not_eligible";
      const publicMessage = args.publicMessage ?? "This Jelly is not eligible for the mission.";
      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
        .unique();
      if (
        reservation &&
        (reservation.status === "pending_verification" || reservation.status === "resubmission_hold")
      ) {
        await transitionSubmissionBudgetsInternal(ctx, {
          campaignId: submission.campaignId,
          missionId: submission.missionId,
          amount: reservation.amount,
          transition: "release",
        });
        await ctx.db.patch(reservation._id, { status: "released", updatedAt: args.now });
      }
      patch.submissionStatus = "rejected";
      patch.decisionStatus = "rejected";
      patch.rewardStatus = "not_eligible";
      patch.reasonCode = reasonCode;
      patch.rejectionReason = publicMessage;
      patch.publicMessage = publicMessage;
      patch.decidedAt = args.now;
      event = {
        ...event,
        type: "decision.rejected",
        submissionStatus: "rejected",
        rewardStatus: "not_eligible",
        displayStatus: "rejected",
        reasonCode,
        publicMessage,
      };
    }

    await ctx.db.patch(submission._id, patch);
    await appendSubmissionEventInternal(ctx, {
      submissionPublicId: submission.publicId,
      ...event,
      internalMetadataJson: JSON.stringify({
        verificationAttempt: args.verificationAttempt ?? verificationAttempts,
        verificationSummary: args.verificationSummary,
      }),
      occurredAt: args.now,
    });
    await recordAuditEvent(ctx, {
      actor: "jelly-verifier",
      action: `verification.${outcome ?? args.verificationStatus}`,
      entityType: "submission",
      entityId: submission._id,
      previousState: {
        submissionStatus: submission.submissionStatus,
        verificationStatus: submission.verificationStatus,
      },
      nextState: {
        submissionStatus: patch.submissionStatus ?? submission.submissionStatus,
        verificationStatus: args.verificationStatus,
        reasonCode: patch.reasonCode,
      },
      requestId: args.requestId,
    });
    return { ignored: false, submissionPublicId: submission.publicId, outcome };
  },
});

const beginVerificationInternal = anyApi.jellyhunt.verification.beginSubmissionVerification as FunctionReference<
  "mutation",
  "internal"
>;
const recordVerificationInternal = anyApi.jellyhunt.verification.recordVerificationResult as FunctionReference<
  "mutation",
  "internal"
>;
const approveSubmissionPublic = anyApi.jellyhunt.approvals.approveSubmission as FunctionReference<
  "mutation",
  "public"
>;

function safePartnerStatus(status: number): VerificationPolicyResult {
  if (status === 404) {
    return { outcome: "reject", reasonCode: "post_not_found", summary: "post_not_found" };
  }
  return { outcome: "retry", reasonCode: "evidence_unavailable", summary: "partner_unavailable" };
}

async function recordPolicyResult(
  ctx: any,
  input: {
    submissionInternalId: string;
    verificationAttempt: number;
    requestId?: string;
    policy: VerificationPolicyResult;
    verificationStatus?: "complete" | "unavailable";
  },
) {
  return await ctx.runMutation(recordVerificationInternal, {
    submissionInternalId: input.submissionInternalId,
    verificationAttempt: input.verificationAttempt,
    verificationStatus:
      input.verificationStatus ?? (input.policy.outcome === "retry" ? "unavailable" : "complete"),
    outcome: input.policy.outcome,
    verifiedLatitude: input.policy.verifiedLatitude,
    verifiedLongitude: input.policy.verifiedLongitude,
    distanceMeters: input.policy.distanceMeters,
    verificationSummary: input.policy.summary,
    reasonCode: input.policy.reasonCode,
    requestId: input.requestId,
    now: Date.now(),
  });
}

async function fetchLegacyManualReview(
  context: VerificationContext,
  correlationId?: string,
): Promise<VerificationPolicyResult> {
  const config = getJellyHttpConfig();
  if (!partnerTransportIsUsable(config)) {
    return { outcome: "retry", reasonCode: "evidence_unavailable", summary: "partner_api_not_configured" };
  }
  const response = await jellyGet(config, buildLegacyJellyPath(context.jellyPostId), correlationId);
  if (response.status !== 200) {
    return { outcome: "retry", reasonCode: "evidence_unavailable", summary: "legacy_post_unavailable" };
  }
  const post = response.body?.data;
  if (!post || String(post.id ?? context.jellyPostId) !== context.jellyPostId) {
    return { outcome: "needs_review", reasonCode: "legacy_evidence_incomplete", summary: "legacy_evidence_incomplete" };
  }
  if (String(post.userId ?? "").trim() !== context.jellyUserId) {
    return { outcome: "reject", reasonCode: "owner_mismatch", summary: "legacy_owner_mismatch" };
  }
  if (post.deletedAt) {
    return { outcome: "reject", reasonCode: "post_deleted", summary: "legacy_post_deleted" };
  }
  const location = post.location;
  const hasLocation =
    location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
  const distanceMeters = hasLocation
    ? evidenceDistanceMeters(
        context.place.latitude,
        context.place.longitude,
        location.latitude,
        location.longitude,
      )
    : undefined;
  return {
    outcome: "needs_review",
    reasonCode: "legacy_evidence_manual_review",
    summary: "legacy_evidence_manual_review",
    ...(hasLocation
      ? {
          verifiedLatitude: location.latitude,
          verifiedLongitude: location.longitude,
          distanceMeters,
        }
      : {}),
  };
}

/** Verify immutable submission terms through Jelly's versioned partner API. */
export const verifySubmissionEvidence = internalActionGeneric({
  args: {
    submissionInternalId: v.string(),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const started = await ctx.runMutation(beginVerificationInternal, {
      submissionInternalId: args.submissionInternalId,
      now: Date.now(),
    });
    if (!started.started) return started;

    const context = started.context as VerificationContext;
    const partnerConfig = getJellyPartnerHttpConfig();
    let policy: VerificationPolicyResult;
    let verificationId: string | undefined;

    if (partnerTransportIsUsable(partnerConfig)) {
      const response = await jellyPost(
        partnerConfig,
        "/partner/v1/jellyhunt/submissions/verify",
        buildPartnerVerificationRequest(context, started.verificationAttempt),
        args.correlationId,
        {
          "Idempotency-Key": buildPartnerVerificationIdempotencyKey(
            "verification",
            context.submissionPublicId,
            started.verificationAttempt,
          ),
        },
      );
      if (response.status !== 200) {
        policy = safePartnerStatus(response.status);
      } else {
        try {
          const evidence = parsePartnerEvidence(response.body);
          verificationId = evidence.verificationId;
          policy = evaluatePartnerEvidence(context, evidence, Date.now());
        } catch {
          policy = {
            outcome: "needs_review",
            reasonCode: "invalid_partner_evidence",
            summary: "invalid_partner_evidence",
          };
        }
      }
    } else {
      policy = await fetchLegacyManualReview(context, args.correlationId);
    }

    const recorded = await recordPolicyResult(ctx, {
      submissionInternalId: args.submissionInternalId,
      verificationAttempt: started.verificationAttempt,
      requestId: args.correlationId,
      policy,
    });
    if (recorded.ignored || policy.outcome !== "approve") return { ...recorded, policy };

    const serviceKey = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
    if (!serviceKey) {
      const fallback = {
        outcome: "needs_review" as const,
        reasonCode: "automatic_approval_not_configured",
        summary: "automatic_approval_not_configured",
      };
      await recordPolicyResult(ctx, {
        submissionInternalId: args.submissionInternalId,
        verificationAttempt: started.verificationAttempt,
        requestId: args.correlationId,
        policy: fallback,
      });
      return { recorded: true, policy: fallback };
    }

    try {
      const approval = await ctx.runMutation(approveSubmissionPublic, {
        serviceKey,
        actorId: "jelly-verifier",
        requestId: args.correlationId,
        submissionPublicId: context.submissionPublicId,
        approvalDecisionId: `auto:${context.submissionPublicId}:${started.verificationAttempt}:${verificationId ?? "verified"}`,
      });
      return { recorded: true, policy, approval };
    } catch {
      const fallback = {
        outcome: "needs_review" as const,
        reasonCode: "automatic_approval_failed",
        summary: "automatic_approval_failed",
      };
      await recordPolicyResult(ctx, {
        submissionInternalId: args.submissionInternalId,
        verificationAttempt: started.verificationAttempt,
        requestId: args.correlationId,
        policy: fallback,
      });
      return { recorded: true, policy: fallback };
    }
  },
});
