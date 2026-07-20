import {
  anyApi,
  internalActionGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { requireServiceKey } from "./security";
import { recordAuditEvent } from "./audit";
import { transitionSubmissionBudgetsInternal } from "./budgets";
import { appendSubmissionEventInternal } from "./events";
import { JellyRewardClient } from "./jellyRewardClient";
import {
  getJellyPartnerHttpConfig,
  jellyGet,
  jellyPost,
  partnerTransportIsUsable,
} from "./jellyHttpClient";
import {
  buildPartnerVerificationIdempotencyKey,
  buildPartnerVerificationRequest,
  evaluatePartnerEvidence,
  parsePartnerEvidence,
  type VerificationContext,
} from "./verificationPolicy";
import {
  type RewardIntentSnapshot,
  buildRewardAttempt,
  assertReceiptMatchesIntent,
} from "./rewardContracts";

const LEASE_DURATION_MS = 120_000;

export function automaticRewardDispatchAllowed(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment.JELLYHUNT_AUTOMATIC_REWARDS_ENABLED !== "true") return false;
  const identity = environment.JELLYHUNT_ENVIRONMENT_IDENTITY;
  if (identity !== "development" && identity !== "preview" && identity !== "production") {
    return false;
  }
  if (
    identity === "production" &&
    environment.JELLYHUNT_PRODUCTION_REWARDS_APPROVED !== "true"
  ) return false;
  return true;
}
const rewardReceiptValidator = v.object({
  intentId: v.string(),
  submissionId: v.string(),
  missionId: v.string(),
  jellyPostId: v.string(),
  recipientUserId: v.string(),
  amount: v.string(),
  token: v.string(),
  decimals: v.number(),
  transactionId: v.string(),
  transactionHash: v.optional(v.union(v.string(), v.null())),
});
async function loadQueuedIntent(ctx: any) {
  return await ctx.db
    .query("jellyhuntRewardIntents")
    .withIndex("by_status", (q: any) => q.eq("status", "queued"))
    .first();
}

async function buildSnapshot(ctx: any, intent: any): Promise<RewardIntentSnapshot> {
  const submission = await ctx.db.get(intent.submissionId);
  const mission = await ctx.db.get(intent.missionId);
  const revision = submission
    ? await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q: any) =>
          q.eq("missionId", submission.missionId).eq("revision", submission.missionRevision),
        )
        .unique()
    : null;
  return {
    intentPublicId: intent.publicId,
    submissionPublicId: submission?.publicId ?? "",
    missionPublicId: mission?.publicId ?? "",
    jellyPostId: intent.jellyPostId,
    recipientUserId: intent.recipientUserId,
    amount: intent.amount,
    token: intent.token,
    decimals: intent.decimals,
    ...(submission && revision
      ? {
          eligibilityGuard: {
            authorshipPolicy: revision.requirements.post.authorshipPolicy,
            canonicalOwnerUserId: submission.jellyUserId,
            requiredPostState: "ready" as const,
            requiredVisibility: revision.requirements.post.requiredVisibility,
            requiredModerationStatus: "clear" as const,
            expectedPlaceId: submission.placeSnapshot.jellyPlaceId,
          },
          note: `Thanks for completing ${submission.missionTitleSnapshot}`,
        }
      : {}),
  };
}

export const leaseNextRewardAttempt = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();

    if (!automaticRewardDispatchAllowed()) {
      return { leased: false, reason: "rewards_disabled" };
    }

    const intent = await loadQueuedIntent(ctx);
    if (!intent) {
      return { leased: false, reason: "no_queued_intents" };
    }

    const reservation = await ctx.db
      .query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", intent.submissionId))
      .unique();
    if (!reservation || reservation.status !== "approved_reserved") {
      return { leased: false, reason: "reservation_not_approved" };
    }

    if (intent.latestAttemptNumber > 0) {
      const lastAttempt = await ctx.db
        .query("jellyhuntRewardAttempts")
        .withIndex("by_intent_attempt", (q: any) =>
          q.eq("rewardIntentId", intent._id).eq("attemptNumber", intent.latestAttemptNumber),
        )
        .unique();

      if (lastAttempt && lastAttempt.status !== "failed") {
        return { leased: false, reason: "prior_attempt_not_final" };
      }
      if (lastAttempt && !lastAttempt.confirmedNoTransfer) {
        return { leased: false, reason: "prior_attempt_not_confirmed_absent" };
      }
    }

    const attemptNumber = intent.latestAttemptNumber + 1;
    const snapshot = await buildSnapshot(ctx, intent);
    const { idempotencyKey, body } = buildRewardAttempt(snapshot, attemptNumber);

    const attemptId = await ctx.db.insert("jellyhuntRewardAttempts", {
      rewardIntentId: intent._id,
      attemptNumber,
      idempotencyKey,
      status: "processing",
      confirmedNoTransfer: false,
      leaseExpiresAt: now + LEASE_DURATION_MS,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(intent._id, {
      status: "processing",
      latestAttemptNumber: attemptNumber,
      updatedAt: now,
    });

    await ctx.db.patch(reservation._id, {
      status: "processing",
      updatedAt: now,
    });

    const submission = await ctx.db.get(intent.submissionId);
    if (submission) {
      await ctx.db.patch(submission._id, {
        rewardStatus: "processing",
        rewardProcessingAt: now,
        updatedAt: now,
      });
    }

    await recordAuditEvent(ctx, {
      actor: args.actorId,
      action: "reward.attempt_leased",
      entityType: "reward_intent",
      entityId: intent._id,
      nextState: { attemptNumber, idempotencyKey },
      requestId: args.requestId,
    });

    return {
      leased: true,
      intentInternalId: intent._id,
      submissionInternalId: intent.submissionId,
      attemptId,
      attemptNumber,
      idempotencyKey,
      body,
      snapshot,
    };
  },
});

export const recordRewardOutcome = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    intentInternalId: v.id("jellyhuntRewardIntents"),
    attemptNumber: v.number(),
    outcomeStatus: v.union(
      v.literal("sent"),
      v.literal("confirmed_no_transfer"),
      v.literal("uncertain"),
    ),
    transactionId: v.optional(v.string()),
    transactionHash: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    confirmedNoTransfer: v.optional(v.boolean()),
    receipt: v.optional(rewardReceiptValidator),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();

    const intent = await ctx.db.get(args.intentInternalId);
    if (!intent) throw new Error("intent_not_found");

    const attempt = await ctx.db
      .query("jellyhuntRewardAttempts")
      .withIndex("by_intent_attempt", (q: any) =>
        q.eq("rewardIntentId", intent._id).eq("attemptNumber", args.attemptNumber),
      )
      .unique();
    if (!attempt) throw new Error("attempt_not_found");

    if (attempt.status !== "processing") {
      return { alreadyRecorded: true };
    }

    const submission = await ctx.db.get(intent.submissionId);
    if (!submission) throw new Error("submission_not_found");
    const reservation = await ctx.db
      .query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", intent.submissionId))
      .unique();
    if (!reservation) throw new Error("reward_reservation_not_found");

    if (args.outcomeStatus === "sent") {
      if (!args.transactionId) throw new Error("sent_requires_transaction_id");

      if (intent.transactionId && intent.transactionId !== args.transactionId) {
        throw new Error("transaction_id_conflict");
      }

      const existingTxn = await ctx.db
        .query("jellyhuntRewardIntents")
        .withIndex("by_transaction_id", (q: any) => q.eq("transactionId", args.transactionId))
        .unique();
      if (existingTxn && existingTxn._id !== intent._id) {
        throw new Error("transaction_id_already_used");
      }

      if (!args.receipt) throw new Error("sent_requires_receipt");
      if (args.receipt.transactionId !== args.transactionId) {
        throw new Error("receipt_transaction_id_mismatch");
      }
      const snapshot = await buildSnapshot(ctx, intent);
      assertReceiptMatchesIntent(snapshot, args.receipt);

      await ctx.db.patch(attempt._id, {
        status: "sent",
        jellyTransactionId: args.transactionId,
        updatedAt: now,
      });

      await ctx.db.patch(intent._id, {
        status: "sent",
        transactionId: args.transactionId,
        transactionHash: args.transactionHash ?? undefined,
        sentAt: now,
        updatedAt: now,
      });

      if (reservation.status !== "processing") {
        throw new Error("reward_reservation_state_conflict");
      }
      await transitionSubmissionBudgetsInternal(ctx, {
        campaignId: submission.campaignId,
        missionId: submission.missionId,
        amount: reservation.amount,
        transition: "paid",
      });
      await ctx.db.patch(reservation._id, { status: "paid", updatedAt: now });
      await ctx.db.patch(submission._id, {
        rewardStatus: "sent",
        rewardTransactionId: args.transactionId,
        rewardSentAt: now,
        publicMessage: "Your reward was sent.",
        updatedAt: now,
      });
      await appendSubmissionEventInternal(ctx, {
        submissionPublicId: submission.publicId,
        type: "reward.sent",
        submissionStatus: "approved",
        rewardStatus: "sent",
        displayStatus: "rewarded",
        publicMessage: "Your reward was sent.",
        occurredAt: now,
      });
    } else if (args.outcomeStatus === "confirmed_no_transfer") {
      await ctx.db.patch(attempt._id, {
        status: "failed",
        confirmedNoTransfer: true,
        reasonCode: args.reasonCode,
        updatedAt: now,
      });

      await ctx.db.patch(intent._id, {
        status: "failed",
        updatedAt: now,
      });

      if (reservation.status !== "processing") {
        throw new Error("reward_reservation_state_conflict");
      }
      await ctx.db.patch(reservation._id, { status: "approved_reserved", updatedAt: now });
      await ctx.db.patch(submission._id, {
        rewardStatus: "failed",
        reasonCode: "reward_failed",
        publicMessage: "Your reward needs attention. Please contact support.",
        updatedAt: now,
      });
      await appendSubmissionEventInternal(ctx, {
        submissionPublicId: submission.publicId,
        type: "reward.failed",
        submissionStatus: "approved",
        rewardStatus: "failed",
        displayStatus: "support_needed",
        reasonCode: "reward_failed",
        publicMessage: "Your reward needs attention. Please contact support.",
        occurredAt: now,
      });
    } else {
      await ctx.db.patch(attempt._id, {
        status: "uncertain",
        reasonCode: args.reasonCode,
        updatedAt: now,
      });

      await ctx.db.patch(intent._id, {
        status: "uncertain",
        updatedAt: now,
      });

      if (reservation.status !== "processing") {
        throw new Error("reward_reservation_state_conflict");
      }
      await ctx.db.patch(reservation._id, { status: "uncertain", updatedAt: now });
      await ctx.db.patch(submission._id, {
        rewardStatus: "uncertain",
        reasonCode: "reward_reconciling",
        publicMessage: "We are confirming your reward. Please do not retry.",
        updatedAt: now,
      });
      await appendSubmissionEventInternal(ctx, {
        submissionPublicId: submission.publicId,
        type: "reward.uncertain",
        submissionStatus: "approved",
        rewardStatus: "uncertain",
        displayStatus: "support_needed",
        reasonCode: "reward_reconciling",
        publicMessage: "We are confirming your reward. Please do not retry.",
        occurredAt: now,
      });
    }

    await recordAuditEvent(ctx, {
      actor: args.actorId,
      action: `reward.attempt_${args.outcomeStatus}`,
      entityType: "reward_intent",
      entityId: intent._id,
      nextState: {
        attemptNumber: args.attemptNumber,
        outcomeStatus: args.outcomeStatus,
        transactionId: args.transactionId,
      },
      requestId: args.requestId,
    });

    return { alreadyRecorded: false };
  },
});

export const markExpiredProcessingAttemptsUncertain = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200);
    const attempts = await ctx.db
      .query("jellyhuntRewardAttempts")
      .withIndex("by_status", (q: any) => q.eq("status", "processing"))
      .take(limit);
    let markedUncertain = 0;

    for (const attempt of attempts) {
      if (attempt.leaseExpiresAt === undefined || attempt.leaseExpiresAt > args.now) continue;
      const intent = await ctx.db.get(attempt.rewardIntentId);
      if (!intent || intent.status !== "processing") continue;
      const submission = await ctx.db.get(intent.submissionId);
      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", intent.submissionId))
        .unique();

      await ctx.db.patch(attempt._id, {
        status: "uncertain",
        confirmedNoTransfer: false,
        reasonCode: "worker_lease_expired",
        updatedAt: args.now,
      });
      await ctx.db.patch(intent._id, { status: "uncertain", updatedAt: args.now });
      if (reservation?.status === "processing") {
        await ctx.db.patch(reservation._id, { status: "uncertain", updatedAt: args.now });
      }
      if (submission?.rewardStatus === "processing") {
        await ctx.db.patch(submission._id, {
          rewardStatus: "uncertain",
          reasonCode: "reward_reconciling",
          publicMessage: "We are confirming your reward. Please do not retry.",
          updatedAt: args.now,
        });
        await appendSubmissionEventInternal(ctx, {
          submissionPublicId: submission.publicId,
          type: "reward.lease_expired",
          submissionStatus: submission.submissionStatus,
          rewardStatus: "uncertain",
          displayStatus: "support_needed",
          reasonCode: "reward_reconciling",
          publicMessage: "We are confirming your reward. Please do not retry.",
          occurredAt: args.now,
        });
      }
      await recordAuditEvent(ctx, {
        actor: args.actorId,
        action: "reward.lease_expired",
        entityType: "reward_intent",
        entityId: intent._id,
        previousState: { status: "processing", attemptNumber: attempt.attemptNumber },
        nextState: { status: "uncertain", reasonCode: "worker_lease_expired" },
      });
      markedUncertain += 1;
    }
    return { inspected: attempts.length, markedUncertain };
  },
});

const leaseRewardAttemptPublic = anyApi.jellyhunt.rewards.leaseNextRewardAttempt as FunctionReference<
  "mutation",
  "public"
>;
const recordRewardOutcomePublic = anyApi.jellyhunt.rewards.recordRewardOutcome as FunctionReference<
  "mutation",
  "public"
>;
const markExpiredRewardsPublic = anyApi.jellyhunt.rewards.markExpiredProcessingAttemptsUncertain as FunctionReference<
  "mutation",
  "public"
>;
const getVerificationContextInternal = anyApi.jellyhunt.verification.getSubmissionForVerification as FunctionReference<
  "query",
  "internal"
>;
const getCompletionForRewardSubmissionInternal = anyApi.jellyhunt.rewards.getCompletionForRewardSubmission as FunctionReference<
  "query",
  "internal"
>;
const reverseCompletionPublic = anyApi.jellyhunt.approvals.reverseCompletion as FunctionReference<
  "mutation",
  "public"
>;

export const getCompletionForRewardSubmission = internalQueryGeneric({
  args: {
    submissionInternalId: v.id("jellyhuntSubmissions"),
  },
  handler: async (ctx: any, args: any) => {
    const completion = await ctx.db
      .query("jellyhuntApprovedCompletions")
      .withIndex("by_winning_submission", (q: any) =>
        q.eq("winningSubmissionId", args.submissionInternalId),
      )
      .unique();
    return completion?.reversedAt ? null : completion?.publicId ?? null;
  },
});

async function recordWorkerOutcome(
  ctx: any,
  serviceKey: string,
  lease: any,
  requestId: string,
  outcome: Awaited<ReturnType<JellyRewardClient["executeAttempt"]>>,
) {
  if (outcome.status === "sent" || outcome.status === "replay") {
    return await ctx.runMutation(recordRewardOutcomePublic, {
      serviceKey,
      actorId: "jelly-reward-worker",
      requestId,
      intentInternalId: lease.intentInternalId,
      attemptNumber: lease.attemptNumber,
      outcomeStatus: "sent",
      transactionId: outcome.transactionId,
      transactionHash: outcome.receipt.transactionHash ?? undefined,
      receipt: outcome.receipt,
    });
  }
  if (outcome.status === "confirmed_no_transfer") {
    return await ctx.runMutation(recordRewardOutcomePublic, {
      serviceKey,
      actorId: "jelly-reward-worker",
      requestId,
      intentInternalId: lease.intentInternalId,
      attemptNumber: lease.attemptNumber,
      outcomeStatus: "confirmed_no_transfer",
      reasonCode: outcome.reasonCode,
      confirmedNoTransfer: true,
    });
  }
  return await ctx.runMutation(recordRewardOutcomePublic, {
    serviceKey,
    actorId: "jelly-reward-worker",
    requestId,
    intentInternalId: lease.intentInternalId,
    attemptNumber: lease.attemptNumber,
    outcomeStatus: "uncertain",
    reasonCode: outcome.status === "accepted" ? "partner_accepted" : outcome.reasonCode,
  });
}

/** Lease, recheck eligibility, and dispatch at most one reward attempt. */
export const runRewardWorker = internalActionGeneric({
  args: {},
  handler: async (ctx: any) => {
    if (!automaticRewardDispatchAllowed()) return { dispatched: false, reason: "rewards_disabled" };
    const serviceKey = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
    const config = getJellyPartnerHttpConfig();
    if (!serviceKey || !partnerTransportIsUsable(config)) {
      return { dispatched: false, reason: "partner_not_configured" };
    }
    const requestId = `reward-worker:${Date.now()}`;
    const lease = await ctx.runMutation(leaseRewardAttemptPublic, {
      serviceKey,
      actorId: "jelly-reward-worker",
      requestId,
    });
    if (!lease.leased) return { dispatched: false, reason: lease.reason };

    const context = (await ctx.runQuery(getVerificationContextInternal, {
      submissionInternalId: lease.submissionInternalId,
    })) as VerificationContext | null;
    if (!context) {
      await recordWorkerOutcome(ctx, serviceKey, lease, requestId, {
        status: "confirmed_no_transfer",
        reasonCode: "pre_payout_context_missing",
      });
      return { dispatched: false, reason: "pre_payout_context_missing" };
    }

    const evidenceResponse = await jellyPost(
      config,
      "/partner/v1/jellyhunt/submissions/verify",
      buildPartnerVerificationRequest(context, lease.attemptNumber),
      requestId,
      {
        "Idempotency-Key": buildPartnerVerificationIdempotencyKey(
          "pre-payout",
          lease.snapshot.intentPublicId,
          lease.attemptNumber,
        ),
      },
    );
    let evidenceEligible = false;
    let evidenceAuthoritativelyIneligible = evidenceResponse.status === 404;
    let evidenceReason = "pre_payout_evidence_unavailable";
    if (evidenceResponse.status === 200) {
      try {
        const evidence = parsePartnerEvidence(evidenceResponse.body);
        const policy = evaluatePartnerEvidence(
          { ...context, approvalMode: "automatic" },
          evidence,
          Date.now(),
        );
        evidenceEligible = policy.outcome === "approve";
        evidenceAuthoritativelyIneligible = policy.outcome === "reject";
        evidenceReason = `pre_payout_${policy.reasonCode}`;
      } catch {
        evidenceReason = "pre_payout_invalid_evidence";
      }
    }
    if (!evidenceEligible) {
      await recordWorkerOutcome(ctx, serviceKey, lease, requestId, {
        status: "confirmed_no_transfer",
        reasonCode: evidenceReason,
      });
      if (evidenceAuthoritativelyIneligible) {
        const completionPublicId = await ctx.runQuery(
          getCompletionForRewardSubmissionInternal,
          { submissionInternalId: lease.submissionInternalId },
        );
        if (completionPublicId) {
          try {
            await ctx.runMutation(reverseCompletionPublic, {
              serviceKey,
              actorId: "jelly-reward-worker",
              requestId,
              completionPublicId,
              reason: "post_became_ineligible",
            });
          } catch {
            return {
              dispatched: false,
              reason: "pre_payout_reversal_requires_reconciliation",
            };
          }
        }
      }
      return { dispatched: false, reason: evidenceReason };
    }

    const client = new JellyRewardClient({
      sendAttempt: async (rewardIntentId, request) => {
        const { idempotencyKey, ...body } = request;
        return await jellyPost(
          config,
          `/partner/v1/jellyhunt/reward-intents/${encodeURIComponent(rewardIntentId)}/attempts`,
          body,
          requestId,
          { "Idempotency-Key": idempotencyKey },
        );
      },
      lookupIntent: async (rewardIntentId) =>
        await jellyGet(
          config,
          `/partner/v1/jellyhunt/reward-intents/${encodeURIComponent(rewardIntentId)}`,
          requestId,
        ),
    });
    const outcome = await client.executeAttempt(lease.snapshot.intentPublicId, lease.body);
    await recordWorkerOutcome(ctx, serviceKey, lease, requestId, outcome);
    return { dispatched: true, intentId: lease.snapshot.intentPublicId, outcome: outcome.status };
  },
});

/** Cron entry point: quarantine expired leases; never schedules a retry. */
export const runRewardWatchdog = internalActionGeneric({
  args: {},
  handler: async (ctx: any) => {
    const serviceKey = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
    if (!serviceKey) return { inspected: 0, markedUncertain: 0, reason: "service_not_configured" };
    return await ctx.runMutation(markExpiredRewardsPublic, {
      serviceKey,
      actorId: "jelly-reward-watchdog",
      now: Date.now(),
      limit: 100,
    });
  },
});

export const getRewardIntentStatus = queryGeneric({
  args: {
    serviceKey: v.string(),
    intentPublicId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const intent = await ctx.db
      .query("jellyhuntRewardIntents")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", args.intentPublicId))
      .unique();
    if (!intent) return null;

    const attempts = await ctx.db
      .query("jellyhuntRewardAttempts")
      .withIndex("by_intent", (q: any) => q.eq("rewardIntentId", intent._id))
      .collect();

    return {
      publicId: intent.publicId,
      status: intent.status,
      amount: intent.amount,
      token: intent.token,
      recipientUserId: intent.recipientUserId,
      transactionId: intent.transactionId,
      transactionHash: intent.transactionHash,
      latestAttemptNumber: intent.latestAttemptNumber,
      attempts: attempts.map((a: any) => ({
        number: a.attemptNumber,
        status: a.status,
        confirmedNoTransfer: a.confirmedNoTransfer,
        reasonCode: a.reasonCode,
        jellyTransactionId: a.jellyTransactionId,
      })),
    };
  },
});
