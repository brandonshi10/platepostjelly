import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { createPublicId, assertPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { requireServiceKey } from "./security";

export type ApproveSubmissionCommand = {
  submissionPublicId: string;
  approvalDecisionId: string;
  actorId: string;
  now: number;
};

export type ReverseCompletionCommand = {
  completionPublicId: string;
  reason: string;
  actorId: string;
  now: number;
};

export type PostPaymentModerationCommand = {
  submissionPublicId: string;
  reasonCode: string;
  actorId: string;
  now: number;
};

async function loadSubmissionByPublicId(ctx: any, publicId: string) {
  const normalized = assertPublicId("sub", publicId);
  const submission = await ctx.db
    .query("jellyhuntSubmissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!submission) throw new Error("submission_not_found");
  return submission;
}

async function loadCompletionByPublicId(ctx: any, publicId: string) {
  const normalized = assertPublicId("cmp", publicId);
  const completion = await ctx.db
    .query("jellyhuntApprovedCompletions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!completion) throw new Error("completion_not_found");
  return completion;
}

async function findExistingCompletion(ctx: any, jellyUserId: string, campaignId: any, missionId: any) {
  return await ctx.db
    .query("jellyhuntApprovedCompletions")
    .withIndex("by_user_campaign_mission", (q: any) =>
      q.eq("jellyUserId", jellyUserId).eq("campaignId", campaignId).eq("missionId", missionId),
    )
    .unique();
}

async function findCompletionByDecisionId(ctx: any, decisionId: string) {
  return await ctx.db
    .query("jellyhuntApprovedCompletions")
    .withIndex("by_approval_decision", (q: any) => q.eq("approvalDecisionId", decisionId))
    .unique();
}

async function incrementLeaderboard(ctx: any, scopeKey: string, jellyUserId: string, profile: any, now: number) {
  const existing = await ctx.db
    .query("jellyhuntLeaderboardEntries")
    .withIndex("by_scope_user", (q: any) => q.eq("scopeKey", scopeKey).eq("jellyUserId", jellyUserId))
    .unique();

  if (existing) {
    const newCount = existing.approvedMissionCount + 1;
    await ctx.db.patch(existing._id, {
      approvedMissionCount: newCount,
      rankSortScore: -newCount,
      normalizedUsername: profile.normalizedUsername,
      publicEligible: profile.publicEligible,
      scoreReachedAt: now,
      profileRevision: profile.jellyProfileRevision,
      updatedAt: now,
    });
    return { entryId: existing._id, beforeCount: existing.approvedMissionCount, afterCount: newCount };
  }

  const entryId = await ctx.db.insert("jellyhuntLeaderboardEntries", {
    publicId: createPublicId("lbe"),
    scopeKey,
    jellyUserId,
    approvedMissionCount: 1,
    rankSortScore: -1,
    normalizedUsername: profile.normalizedUsername,
    scoreReachedAt: now,
    publicEligible: profile.publicEligible,
    profileRevision: profile.jellyProfileRevision,
    createdAt: now,
    updatedAt: now,
  });
  return { entryId, beforeCount: 0, afterCount: 1 };
}

async function decrementLeaderboard(ctx: any, scopeKey: string, jellyUserId: string, now: number) {
  const existing = await ctx.db
    .query("jellyhuntLeaderboardEntries")
    .withIndex("by_scope_user", (q: any) => q.eq("scopeKey", scopeKey).eq("jellyUserId", jellyUserId))
    .unique();

  if (!existing || existing.approvedMissionCount <= 0) return null;

  const newCount = existing.approvedMissionCount - 1;
  await ctx.db.patch(existing._id, {
    approvedMissionCount: newCount,
    rankSortScore: -newCount,
    scoreReachedAt: now,
    updatedAt: now,
  });
  return { entryId: existing._id, beforeCount: existing.approvedMissionCount, afterCount: newCount };
}

async function bumpLeaderboardRevision(ctx: any, campaignId: any, now: number) {
  const campaign = await ctx.db.get(campaignId);
  if (campaign) {
    await ctx.db.patch(campaign._id, {
      leaderboardRevision: campaign.leaderboardRevision + 1,
      updatedAt: now,
    });
  }

  const config = await ctx.db
    .query("jellyhuntProgramConfig")
    .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
    .unique();
  if (config) {
    await ctx.db.patch(config._id, {
      leaderboardRevision: config.leaderboardRevision + 1,
      updatedAt: now,
    });
  }
}

async function recordLeaderboardEvent(
  ctx: any,
  scopeKey: string,
  jellyUserId: string,
  type: string,
  result: { beforeCount: number; afterCount: number } | null,
  correlationId: string,
  requestId: string | undefined,
  now: number,
) {
  await ctx.db.insert("jellyhuntLeaderboardEvents", {
    scopeKey,
    jellyUserId,
    type,
    correlationId,
    requestId,
    beforeCount: result?.beforeCount,
    afterCount: result?.afterCount,
    occurredAt: now,
  });
}

async function getOrCreateProfile(ctx: any, jellyUserId: string, now: number) {
  const existing = await ctx.db
    .query("jellyhuntPublicProfiles")
    .withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", jellyUserId))
    .unique();
  if (existing) return existing;

  const profileId = await ctx.db.insert("jellyhuntPublicProfiles", {
    jellyUserId,
    username: jellyUserId,
    normalizedUsername: jellyUserId.toLowerCase(),
    accountState: "active",
    publicEligible: true,
    refreshedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(profileId);
}

function isCountableCompletion(source: string, config: any, approvedAt: number): boolean {
  if (source !== "live") return false;
  if (config && approvedAt < config.leaderboardLaunchEpoch) return false;
  return true;
}

export const approveSubmission = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    submissionPublicId: v.string(),
    approvalDecisionId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();
    const now = Date.now();

    const submission = await loadSubmissionByPublicId(ctx, args.submissionPublicId);

    const existingByDecision = await findCompletionByDecisionId(ctx, args.approvalDecisionId);
    if (existingByDecision) {
      if (existingByDecision.winningSubmissionId !== submission._id) {
        throw new Error("approval_decision_id_conflict");
      }
      return { completionPublicId: existingByDecision.publicId, replay: true };
    }

    if (submission.decisionStatus === "approved") {
      throw new Error("submission_already_decided");
    }
    if (submission.submissionStatus === "rejected") {
      throw new Error("submission_already_rejected");
    }

    const existingCompletion = await findExistingCompletion(
      ctx,
      submission.jellyUserId,
      submission.campaignId,
      submission.missionId,
    );
    if (existingCompletion && !existingCompletion.reversedAt) {
      throw new Error("mission_already_completed");
    }

    const config = await ctx.db
      .query("jellyhuntProgramConfig")
      .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
      .unique();

    const countsTowardLeaderboard = isCountableCompletion(submission.source, config, now);

    const profile = await getOrCreateProfile(ctx, submission.jellyUserId, now);

    const completionPublicId = createPublicId("cmp");
    await ctx.db.insert("jellyhuntApprovedCompletions", {
      publicId: completionPublicId,
      jellyUserId: submission.jellyUserId,
      campaignId: submission.campaignId,
      missionId: submission.missionId,
      winningSubmissionId: submission._id,
      approvalDecisionId: args.approvalDecisionId,
      approvedAt: now,
      source: submission.source,
      countsTowardLeaderboard,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(submission._id, {
      submissionStatus: "approved",
      decisionStatus: "approved",
      approvedAt: now,
      approvalDecisionId: args.approvalDecisionId,
      rewardStatus: "queued",
      rewardQueuedAt: now,
      decidedAt: now,
      updatedAt: now,
    });

    const reservation = await ctx.db
      .query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    if (reservation) {
      await ctx.db.patch(reservation._id, {
        status: "approved_reserved",
        updatedAt: now,
      });
    }

    const rewardIntentPublicId = createPublicId("rwd");
    await ctx.db.insert("jellyhuntRewardIntents", {
      publicId: rewardIntentPublicId,
      submissionId: submission._id,
      missionId: submission.missionId,
      campaignId: submission.campaignId,
      jellyPostId: submission.jellyPostId,
      recipientUserId: submission.jellyUserId,
      amount: submission.rewardSnapshot.amount,
      token: submission.rewardSnapshot.token,
      decimals: 6,
      status: "queued",
      latestAttemptNumber: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (countsTowardLeaderboard) {
      const campaignScopeKey = `campaign:${submission.campaignId}`;
      const campaignResult = await incrementLeaderboard(ctx, campaignScopeKey, submission.jellyUserId, profile, now);
      const allTimeResult = await incrementLeaderboard(ctx, "all_time", submission.jellyUserId, profile, now);

      await recordLeaderboardEvent(ctx, campaignScopeKey, submission.jellyUserId, "increment", campaignResult, completionPublicId, args.requestId, now);
      await recordLeaderboardEvent(ctx, "all_time", submission.jellyUserId, "increment", allTimeResult, completionPublicId, args.requestId, now);

      await bumpLeaderboardRevision(ctx, submission.campaignId, now);
    }

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "submission.approved",
      entityType: "submission",
      entityId: submission._id,
      previousState: { decisionStatus: submission.decisionStatus, rewardStatus: submission.rewardStatus },
      nextState: { decisionStatus: "approved", rewardStatus: "queued", completionPublicId },
      requestId: args.requestId,
    });

    return { completionPublicId, replay: false };
  },
});

export const reverseCompletion = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    completionPublicId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();
    const now = Date.now();

    const completion = await loadCompletionByPublicId(ctx, args.completionPublicId);
    if (completion.reversedAt) {
      return { alreadyReversed: true };
    }

    const submission = await ctx.db.get(completion.winningSubmissionId);
    if (!submission) throw new Error("submission_not_found");

    const rewardIntent = await ctx.db
      .query("jellyhuntRewardIntents")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();

    if (rewardIntent) {
      if (rewardIntent.status === "processing" || rewardIntent.status === "uncertain") {
        throw new Error("reconciliation_required");
      }
      if (rewardIntent.status === "sent") {
        throw new Error("cannot_reverse_after_payment");
      }
      await ctx.db.patch(rewardIntent._id, {
        status: "canceled",
        updatedAt: now,
      });
    }

    const reservation = await ctx.db
      .query("jellyhuntRewardReservations")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .unique();
    if (reservation && reservation.status !== "released" && reservation.status !== "paid") {
      await ctx.db.patch(reservation._id, {
        status: "released",
        updatedAt: now,
      });
    }

    await ctx.db.patch(completion._id, {
      reversedAt: now,
      reversalReason: args.reason,
      updatedAt: now,
    });

    await ctx.db.patch(submission._id, {
      submissionStatus: "rejected",
      decisionStatus: "rejected",
      rewardStatus: "not_eligible",
      reasonCode: "completion_reversed",
      decidedAt: now,
      updatedAt: now,
    });

    if (completion.countsTowardLeaderboard) {
      const campaignScopeKey = `campaign:${completion.campaignId}`;
      const campaignResult = await decrementLeaderboard(ctx, campaignScopeKey, completion.jellyUserId, now);
      const allTimeResult = await decrementLeaderboard(ctx, "all_time", completion.jellyUserId, now);

      await recordLeaderboardEvent(ctx, campaignScopeKey, completion.jellyUserId, "reversal", campaignResult, completion.publicId, args.requestId, now);
      await recordLeaderboardEvent(ctx, "all_time", completion.jellyUserId, "reversal", allTimeResult, completion.publicId, args.requestId, now);

      await bumpLeaderboardRevision(ctx, completion.campaignId, now);
    }

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "completion.reversed",
      entityType: "completion",
      entityId: completion._id,
      previousState: { reversedAt: null },
      nextState: { reversedAt: now, reason: args.reason },
      requestId: args.requestId,
    });

    return { alreadyReversed: false };
  },
});

export const moderateAfterPayment = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    submissionPublicId: v.string(),
    reasonCode: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();
    const now = Date.now();

    const submission = await loadSubmissionByPublicId(ctx, args.submissionPublicId);

    if (submission.rewardStatus !== "sent") {
      throw new Error("post_payment_moderation_requires_sent_reward");
    }

    const completion = await ctx.db
      .query("jellyhuntApprovedCompletions")
      .withIndex("by_winning_submission", (q: any) => q.eq("winningSubmissionId", submission._id))
      .unique();
    if (!completion) throw new Error("completion_not_found");

    await ctx.db.patch(submission._id, {
      submissionStatus: "rejected",
      decisionStatus: "rejected",
      reasonCode: args.reasonCode,
      publicMessage: "Reward sent; completion later removed from rankings.",
      decidedAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(completion._id, {
      reversedAt: now,
      reversalReason: args.reasonCode,
      countsTowardLeaderboard: false,
      updatedAt: now,
    });

    if (completion.countsTowardLeaderboard) {
      const campaignScopeKey = `campaign:${completion.campaignId}`;
      const campaignResult = await decrementLeaderboard(ctx, campaignScopeKey, completion.jellyUserId, now);
      const allTimeResult = await decrementLeaderboard(ctx, "all_time", completion.jellyUserId, now);

      await recordLeaderboardEvent(ctx, campaignScopeKey, completion.jellyUserId, "reversal", campaignResult, completion.publicId, args.requestId, now);
      await recordLeaderboardEvent(ctx, "all_time", completion.jellyUserId, "reversal", allTimeResult, completion.publicId, args.requestId, now);

      await bumpLeaderboardRevision(ctx, completion.campaignId, now);
    }

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "submission.post_payment_moderation",
      entityType: "submission",
      entityId: submission._id,
      previousState: { submissionStatus: submission.submissionStatus, rewardStatus: submission.rewardStatus },
      nextState: { submissionStatus: "rejected", rewardStatus: "sent", reasonCode: args.reasonCode },
      requestId: args.requestId,
    });

    return { completionPublicId: completion.publicId };
  },
});
