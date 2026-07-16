import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertServiceKey } from "./security";
import {
  adminReviewCanDecide,
  hasBlockingMissionSibling,
  isRewardProcessingLeaseExpired,
  normalizeExternalId,
  REWARD_PROCESSING_LEASE_MS,
  rewardQueueDecision,
  verificationCanStart,
  verificationResultIsCurrent,
} from "./workflow";

function dedupeKey(missionId: string, jellyUserId: string, jellyPostId: string) {
  return [missionId, jellyUserId, jellyPostId]
    .map((part) => part.trim().toLowerCase())
    .join(":");
}

async function audit(
  ctx: any,
  event: {
    actor: string;
    action: string;
    entityId: string;
    previousState?: string;
    nextState?: string;
    metadata?: unknown;
  },
) {
  await ctx.db.insert("auditEvents", {
    actor: event.actor,
    action: event.action,
    entityType: "submission",
    entityId: event.entityId,
    previousState: event.previousState,
    nextState: event.nextState,
    metadataJson: event.metadata === undefined ? undefined : JSON.stringify(event.metadata),
    createdAt: Date.now(),
  });
}

async function assertNoBlockingMissionSibling(
  ctx: any,
  submission: {
    _id: any;
    missionId: any;
    jellyUserId: string;
  },
) {
  const siblings = await ctx.db
    .query("submissions")
    .withIndex("by_mission_user", (q: any) =>
      q.eq("missionId", submission.missionId).eq("jellyUserId", submission.jellyUserId),
    )
    .collect();
  const siblingStatuses = siblings
    .filter((candidate: any) => candidate._id !== submission._id)
    .map((candidate: any) => candidate.status);
  if (hasBlockingMissionSibling(siblingStatuses)) {
    throw new Error("Another submission is already active or rewarded for this user and mission");
  }
}
async function queueReward(ctx: any, submissionId: any, actor: string) {
  const submission = await ctx.db.get(submissionId);
  if (!submission) throw new Error("Submission not found");
  if (submission.status !== "approved") {
    throw new Error("Only an approved submission can queue a reward");
  }

  await assertNoBlockingMissionSibling(ctx, submission);

  const idempotencyKey = `jellyhunt:${submission.dedupeKey}`;
  const attempt = await ctx.db
    .query("rewardAttempts")
    .withIndex("by_idempotency_key", (q: any) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  const decision = rewardQueueDecision(attempt?.status);

  if (decision === "already_sent" || decision === "already_in_progress") {
    return attempt._id;
  }
  if (decision === "reconciliation_required") {
    throw new Error("Reward outcome is uncertain and must be reconciled");
  }
  if (decision === "manual_retry_required") {
    throw new Error("A confirmed failed reward must be retried explicitly");
  }

  const timestamp = Date.now();
  const rewardAttemptId = await ctx.db.insert("rewardAttempts", {
    submissionId,
    idempotencyKey,
    rewardAmount: submission.rewardAmountSnapshot,
    rewardToken: submission.rewardTokenSnapshot,
    missionTitle: submission.missionTitleSnapshot,
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await ctx.db.patch(submissionId, {
    status: "reward_queued",
    updatedAt: timestamp,
  });
  await audit(ctx, {
    actor,
    action: "reward.queued",
    entityId: submissionId,
    previousState: submission.status,
    nextState: "reward_queued",
    metadata: { rewardAttemptId },
  });
  await ctx.scheduler.runAfter(0, internal.jelly.sendReward, { rewardAttemptId });
  return rewardAttemptId;
}

export const submitMission = mutation({
  args: {
    serviceKey: v.string(),
    missionId: v.id("missions"),
    jellyUserId: v.string(),
    jellyPostId: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const jellyUserId = normalizeExternalId(args.jellyUserId);
    const jellyPostId = normalizeExternalId(args.jellyPostId);
    const mission = await ctx.db.get(args.missionId);
    const timestamp = Date.now();
    if (
      !mission ||
      mission.status !== "active" ||
      (mission.startsAt && mission.startsAt > timestamp) ||
      (mission.endsAt && mission.endsAt < timestamp)
    ) {
      throw new Error("Mission is not available");
    }
    const location = await ctx.db.get(mission.locationId);
    if (!location) throw new Error("Mission location is unavailable");

    if ((args.latitude === undefined) !== (args.longitude === undefined)) {
      throw new Error("Latitude and longitude must be supplied together");
    }

    const key = dedupeKey(args.missionId, jellyUserId, jellyPostId);
    const exact = await ctx.db
      .query("submissions")
      .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", key))
      .unique();
    if (exact) {
      return { submissionId: exact._id, status: exact.status, idempotent: true };
    }

    const postUse = await ctx.db
      .query("submissions")
      .withIndex("by_jelly_post", (q) => q.eq("jellyPostId", jellyPostId))
      .first();
    if (postUse) throw new Error("Jelly post already used for a mission");

    const userMissionSubmissions = await ctx.db
      .query("submissions")
      .withIndex("by_mission_user", (q) =>
        q.eq("missionId", args.missionId).eq("jellyUserId", jellyUserId),
      )
      .collect();
    const activeSubmission = userMissionSubmissions.find(
      (submission) => submission.status !== "rejected",
    );
    if (activeSubmission) throw new Error("Mission already submitted by this user");

    const submissionId = await ctx.db.insert("submissions", {
      missionId: args.missionId,
      jellyUserId,
      jellyPostId,
      dedupeKey: key,
      status: "submitted",
      missionRevision: mission.revision,
      missionTitleSnapshot: mission.title,
      approvalModeSnapshot: mission.approvalMode,
      restaurantTagSnapshot: mission.restaurantTag,
      locationNameSnapshot: location.name,
      jellyRestaurantIdSnapshot: location.jellyRestaurantId,
      locationLatitudeSnapshot: location.latitude,
      locationLongitudeSnapshot: location.longitude,
      geofenceRadiusMetersSnapshot: location.geofenceRadiusMeters,
      rewardAmountSnapshot: mission.rewardAmount,
      rewardTokenSnapshot: mission.rewardToken,
      claimedLatitude: args.latitude,
      claimedLongitude: args.longitude,
      verificationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await audit(ctx, {
      actor: `jelly-user:${jellyUserId}`,
      action: "submission.created",
      entityId: submissionId,
      nextState: "submitted",
      metadata: { missionId: args.missionId, jellyPostId },
    });
    await ctx.scheduler.runAfter(0, internal.jelly.verifySubmission, { submissionId });

    return { submissionId, status: "submitted", idempotent: false };
  },
});

export const listUserStatuses = query({
  args: { serviceKey: v.string(), jellyUserId: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const jellyUserId = normalizeExternalId(args.jellyUserId);
    const activeMissions = await ctx.db
      .query("missions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    return Promise.all(
      activeMissions.map(async (mission) => {
        const submissions = await ctx.db
          .query("submissions")
          .withIndex("by_mission_user", (q) =>
            q.eq("missionId", mission._id).eq("jellyUserId", jellyUserId),
          )
          .collect();
        const latest = submissions.sort((left, right) => right.createdAt - left.createdAt)[0];
        return latest
          ? {
              missionId: mission._id,
              status: latest.status,
              submissionId: latest._id,
              jellyPostId: latest.jellyPostId,
              rejectionReason: latest.rejectionReason,
              rewardTransactionId: latest.rewardTransactionId,
            }
          : { missionId: mission._id, status: "not_started" };
      }),
    );
  },
});

export const listAdminSubmissions = query({
  args: { serviceKey: v.string(), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const submissions = args.status && args.status !== "all"
      ? await ctx.db
          .query("submissions")
          .withIndex("by_status", (q) => q.eq("status", args.status as any))
          .order("desc")
          .collect()
      : await ctx.db.query("submissions").order("desc").collect();

    return Promise.all(
      submissions.map(async (submission) => {
        const mission = await ctx.db.get(submission.missionId);
        const location = mission ? await ctx.db.get(mission.locationId) : null;
        const attempts = await ctx.db
          .query("rewardAttempts")
          .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
          .collect();
        const rewardAttempt = attempts.sort((left, right) => right.createdAt - left.createdAt)[0];
        return { ...submission, mission, location, rewardAttempt };
      }),
    );
  },
});

export const getVerificationContext = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");
    return {
      submission,
      mission: {
        _id: submission.missionId,
        revision: submission.missionRevision,
        title: submission.missionTitleSnapshot,
        approvalMode: submission.approvalModeSnapshot,
        restaurantTag: submission.restaurantTagSnapshot,
        rewardAmount: submission.rewardAmountSnapshot,
        rewardToken: submission.rewardTokenSnapshot,
      },
      location: {
        name: submission.locationNameSnapshot,
        jellyRestaurantId: submission.jellyRestaurantIdSnapshot,
        latitude: submission.locationLatitudeSnapshot,
        longitude: submission.locationLongitudeSnapshot,
        geofenceRadiusMeters: submission.geofenceRadiusMetersSnapshot,
      },
    };
  },
});
export const markVerificationStarted = internalMutation({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || !verificationCanStart(submission.status)) return null;
    const verificationAttempt = submission.verificationAttempts + 1;
    await ctx.db.patch(args.submissionId, {
      status: "verifying",
      verificationAttempts: verificationAttempt,
      updatedAt: Date.now(),
    });
    return verificationAttempt;
  },
});

export const markVerificationResult = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    verificationAttempt: v.number(),
    outcome: v.union(
      v.literal("verified"),
      v.literal("needs_review"),
      v.literal("rejected"),
    ),
    summary: v.string(),
    reason: v.optional(v.string()),
    verifiedLatitude: v.optional(v.number()),
    verifiedLongitude: v.optional(v.number()),
    distanceMeters: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");
    if (!verificationResultIsCurrent(
      submission.status,
      submission.verificationAttempts,
      args.verificationAttempt,
    )) return false;
    const nextStatus =
      args.outcome === "rejected"
        ? "rejected"
        : args.outcome === "needs_review" || submission.approvalModeSnapshot === "manual"
          ? "needs_review"
          : "approved";

    await ctx.db.patch(args.submissionId, {
      status: nextStatus,
      verificationSummary: args.summary,
      rejectionReason: args.outcome === "rejected" ? args.reason : undefined,
      verifiedLatitude: args.verifiedLatitude,
      verifiedLongitude: args.verifiedLongitude,
      distanceMeters: args.distanceMeters,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: "jelly-verifier",
      action: "submission.verified",
      entityId: args.submissionId,
      previousState: submission.status,
      nextState: nextStatus,
      metadata: { outcome: args.outcome, summary: args.summary },
    });

    if (nextStatus === "approved") {
      await queueReward(ctx, args.submissionId, "automatic-verifier");
    }
    return true;
  },
});
export const markVerificationUnavailable = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    verificationAttempt: v.number(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (
      !submission ||
      !verificationResultIsCurrent(
        submission.status,
        submission.verificationAttempts,
        args.verificationAttempt,
      )
    ) return false;
    await ctx.db.patch(args.submissionId, {
      status: "needs_review",
      verificationSummary: args.summary,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: "jelly-verifier",
      action: "verification.needs_review",
      entityId: args.submissionId,
      previousState: submission.status,
      nextState: "needs_review",
    });
    return true;
  },
});

export const adminReviewSubmission = mutation({
  args: {
    serviceKey: v.string(),
    submissionId: v.id("submissions"),
    action: v.union(v.literal("approve"), v.literal("reject")),
    reason: v.optional(v.string()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");
    if (!adminReviewCanDecide(submission.status)) {
      throw new Error("Submission is not ready for admin review");
    }

    if (args.action === "approve") {
      await assertNoBlockingMissionSibling(ctx, submission);
    }

    if (args.action === "reject") {
      if (!args.reason?.trim()) throw new Error("Rejection reason is required");
      await ctx.db.patch(args.submissionId, {
        status: "rejected",
        rejectionReason: args.reason.trim(),
        updatedAt: Date.now(),
      });
      await audit(ctx, {
        actor: args.actor,
        action: "submission.rejected",
        entityId: args.submissionId,
        previousState: submission.status,
        nextState: "rejected",
        metadata: { reason: args.reason.trim() },
      });
      return { status: "rejected" };
    }

    await ctx.db.patch(args.submissionId, {
      status: "approved",
      rejectionReason: undefined,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: args.actor,
      action: "submission.approved",
      entityId: args.submissionId,
      previousState: submission.status,
      nextState: "approved",
    });
    const rewardAttemptId = await queueReward(ctx, args.submissionId, args.actor);
    return { status: "reward_queued", rewardAttemptId };
  },
});

export const retryVerification = mutation({
  args: {
    serviceKey: v.string(),
    submissionId: v.id("submissions"),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found");
    if (!["submitted", "verifying", "needs_review", "rejected"].includes(submission.status)) {
      throw new Error("Submission cannot be reverified");
    }
    await assertNoBlockingMissionSibling(ctx, submission);
    await ctx.db.patch(args.submissionId, {
      status: "submitted",
      rejectionReason: undefined,
      verificationSummary: undefined,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: args.actor,
      action: "verification.retried",
      entityId: args.submissionId,
      previousState: submission.status,
      nextState: "submitted",
      metadata: { preservedMissionRevision: submission.missionRevision },
    });
    await ctx.scheduler.runAfter(0, internal.jelly.verifySubmission, {
      submissionId: args.submissionId,
    });
  },
});
export const getRewardContext = internalQuery({
  args: { rewardAttemptId: v.id("rewardAttempts") },
  handler: async (ctx, args) => {
    const rewardAttempt = await ctx.db.get(args.rewardAttemptId);
    if (!rewardAttempt) throw new Error("Reward attempt not found");
    const submission = await ctx.db.get(rewardAttempt.submissionId);
    if (!submission) throw new Error("Submission not found");
    return {
      rewardAttempt,
      submission,
      mission: {
        title: rewardAttempt.missionTitle,
        rewardAmount: rewardAttempt.rewardAmount,
        rewardToken: rewardAttempt.rewardToken,
      },
    };
  },
});
export const markRewardProcessing = internalMutation({
  args: { rewardAttemptId: v.id("rewardAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.rewardAttemptId);
    if (!attempt || attempt.status !== "queued") return false;
    const processingStartedAt = Date.now();
    await ctx.db.patch(args.rewardAttemptId, {
      status: "processing",
      updatedAt: processingStartedAt,
    });
    await ctx.scheduler.runAfter(
      REWARD_PROCESSING_LEASE_MS,
      internal.submissions.markStaleRewardUncertain,
      { rewardAttemptId: args.rewardAttemptId, processingStartedAt },
    );
    return true;
  },
});

export const markStaleRewardUncertain = internalMutation({
  args: {
    rewardAttemptId: v.id("rewardAttempts"),
    processingStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.rewardAttemptId);
    const timestamp = Date.now();
    if (
      !attempt ||
      !isRewardProcessingLeaseExpired(
        attempt.status,
        attempt.updatedAt,
        args.processingStartedAt,
        timestamp,
      )
    ) return false;

    const submission = await ctx.db.get(attempt.submissionId);
    if (!submission || submission.status !== "reward_queued") return false;
    const error = "Reward processing timed out; reconcile with Jelly before retrying";
    await ctx.db.patch(args.rewardAttemptId, {
      status: "uncertain",
      error,
      updatedAt: timestamp,
    });
    await ctx.db.patch(submission._id, {
      status: "reward_uncertain",
      updatedAt: timestamp,
    });
    await audit(ctx, {
      actor: "jelly-reward-watchdog",
      action: "reward.processing_timed_out",
      entityId: submission._id,
      previousState: "reward_queued",
      nextState: "reward_uncertain",
      metadata: { rewardAttemptId: args.rewardAttemptId, processingStartedAt: args.processingStartedAt },
    });
    return true;
  },
});

export const markRewardResult = internalMutation({
  args: {
    rewardAttemptId: v.id("rewardAttempts"),
    outcome: v.union(v.literal("sent"), v.literal("failed"), v.literal("uncertain")),
    transactionId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.rewardAttemptId);
    if (!attempt || attempt.status !== "processing") return false;
    const submission = await ctx.db.get(attempt.submissionId);
    if (!submission || submission.status !== "reward_queued") return false;
    const status =
      args.outcome === "sent"
        ? "reward_sent"
        : args.outcome === "uncertain"
          ? "reward_uncertain"
          : "reward_failed";

    await ctx.db.patch(args.rewardAttemptId, {
      status: args.outcome,
      jellyTransactionId: args.transactionId,
      error: args.error,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(submission._id, {
      status,
      rewardTransactionId: args.transactionId,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: "jelly-reward-service",
      action: `reward.${args.outcome}`,
      entityId: submission._id,
      previousState: submission.status,
      nextState: status,
      metadata: { rewardAttemptId: args.rewardAttemptId },
    });
    return true;
  },
});
export const reconcileUncertainReward = mutation({
  args: {
    serviceKey: v.string(),
    submissionId: v.id("submissions"),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    transactionId: v.optional(v.string()),
    reason: v.optional(v.string()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.status !== "reward_uncertain") {
      throw new Error("Submission does not have an uncertain reward");
    }
    const attempts = await ctx.db
      .query("rewardAttempts")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();
    const attempt = attempts.sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!attempt || attempt.status !== "uncertain") {
      throw new Error("Uncertain reward attempt was not found");
    }

    const transactionId = args.transactionId?.trim();
    const reason = args.reason?.trim();
    if (args.outcome === "sent" && !transactionId) {
      throw new Error("Jelly transaction ID is required to reconcile a sent reward");
    }
    if (args.outcome === "failed" && !reason) {
      throw new Error("A reconciliation reason is required to confirm failure");
    }

    const nextStatus = args.outcome === "sent" ? "reward_sent" : "reward_failed";
    await ctx.db.patch(attempt._id, {
      status: args.outcome,
      jellyTransactionId: transactionId,
      error: args.outcome === "failed" ? reason : undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(submission._id, {
      status: nextStatus,
      rewardTransactionId: transactionId,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: args.actor,
      action: `reward.reconciled_${args.outcome}`,
      entityId: submission._id,
      previousState: "reward_uncertain",
      nextState: nextStatus,
      metadata: {
        rewardAttemptId: attempt._id,
        transactionId,
        reason,
      },
    });
    return { status: nextStatus };
  },
});
export const retryReward = mutation({
  args: {
    serviceKey: v.string(),
    submissionId: v.id("submissions"),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const attempts = await ctx.db
      .query("rewardAttempts")
      .withIndex("by_submission", (q) => q.eq("submissionId", args.submissionId))
      .collect();
    const latest = attempts.sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!latest || latest.status !== "failed") {
      throw new Error("Only confirmed failed rewards may be retried");
    }
    await ctx.db.patch(latest._id, {
      status: "queued",
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.submissionId, {
      status: "reward_queued",
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: args.actor,
      action: "reward.retried",
      entityId: args.submissionId,
      previousState: "reward_failed",
      nextState: "reward_queued",
    });
    await ctx.scheduler.runAfter(0, internal.jelly.sendReward, {
      rewardAttemptId: latest._id,
    });
  },
});
