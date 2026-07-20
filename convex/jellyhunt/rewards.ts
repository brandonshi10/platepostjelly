import { mutationGeneric, queryGeneric, actionGeneric } from "convex/server";
import { v } from "convex/values";
import { requireServiceKey } from "./security";
import { recordAuditEvent } from "./audit";
import { createPublicId } from "./publicIds";
import {
  type RewardIntentSnapshot,
  buildRewardAttempt,
  assertReceiptMatchesIntent,
} from "./rewardContracts";

const LEASE_DURATION_MS = 120_000;

async function loadQueuedIntent(ctx: any) {
  return await ctx.db
    .query("jellyhuntRewardIntents")
    .withIndex("by_status", (q: any) => q.eq("status", "queued"))
    .first();
}

async function buildSnapshot(ctx: any, intent: any): Promise<RewardIntentSnapshot> {
  const submission = await ctx.db.get(intent.submissionId);
  const mission = await ctx.db.get(intent.missionId);
  return {
    intentPublicId: intent.publicId,
    submissionPublicId: submission?.publicId ?? "",
    missionPublicId: mission?.publicId ?? "",
    jellyPostId: intent.jellyPostId,
    recipientUserId: intent.recipientUserId,
    amount: intent.amount,
    token: intent.token,
    decimals: intent.decimals,
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

    const enabled = process.env.JELLYHUNT_AUTOMATIC_REWARDS_ENABLED;
    if (enabled !== "true") {
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
    outcomeStatus: v.string(),
    transactionId: v.optional(v.string()),
    transactionHash: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    confirmedNoTransfer: v.optional(v.boolean()),
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

      const snapshot = await buildSnapshot(ctx, intent);
      assertReceiptMatchesIntent(snapshot, {
        intentId: intent.publicId,
        submissionId: snapshot.submissionPublicId,
        missionId: snapshot.missionPublicId,
        jellyPostId: intent.jellyPostId,
        recipientUserId: intent.recipientUserId,
        amount: intent.amount,
        token: intent.token,
        decimals: intent.decimals,
        transactionId: args.transactionId,
        transactionHash: args.transactionHash,
      });

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

      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", intent.submissionId))
        .unique();
      if (reservation) {
        await ctx.db.patch(reservation._id, { status: "paid", updatedAt: now });
      }

      const submission = await ctx.db.get(intent.submissionId);
      if (submission) {
        await ctx.db.patch(submission._id, {
          rewardStatus: "sent",
          rewardTransactionId: args.transactionId,
          rewardSentAt: now,
          updatedAt: now,
        });
      }
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

      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", intent.submissionId))
        .unique();
      if (reservation) {
        await ctx.db.patch(reservation._id, { status: "released", updatedAt: now });
      }

      const submission = await ctx.db.get(intent.submissionId);
      if (submission) {
        await ctx.db.patch(submission._id, {
          rewardStatus: "failed",
          updatedAt: now,
        });
      }
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

      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", intent.submissionId))
        .unique();
      if (reservation) {
        await ctx.db.patch(reservation._id, { status: "uncertain", updatedAt: now });
      }

      const submission = await ctx.db.get(intent.submissionId);
      if (submission) {
        await ctx.db.patch(submission._id, {
          rewardStatus: "uncertain",
          updatedAt: now,
        });
      }
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
