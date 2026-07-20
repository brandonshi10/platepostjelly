import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireServiceKey } from "./security";
import { assertPublicId } from "./publicIds";

const JELLY_WATCH_BASE = "https://jellyjelly.com/watch/";

export const getOwnerParticipation = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    participationPublicId: v.string(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const normalized = assertPublicId("par", args.participationPublicId);
    const participation = await ctx.db
      .query("jellyhuntParticipations")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!participation || participation.jellyUserId !== args.jellyUserId) return null;

    const mission = await ctx.db.get(participation.missionId);
    if (!mission) return null;

    const revision = await ctx.db
      .query("jellyhuntMissionRevisions")
      .withIndex("by_mission_revision", (q: any) =>
        q.eq("missionId", participation.missionId).eq("revision", participation.missionRevision),
      )
      .unique();

    const latestSubmission = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_mission_user", (q: any) =>
        q.eq("missionId", participation.missionId).eq("jellyUserId", args.jellyUserId),
      )
      .order("desc")
      .first();

    const hasNonRejectedSubmission = latestSubmission && latestSubmission.submissionStatus !== "rejected";
    const deadlinePassed = args.now > participation.submissionDeadlineAt;
    const canSubmit =
      !hasNonRejectedSubmission &&
      !deadlinePassed &&
      mission.acceptingSubmissions &&
      participation.attemptsUsed < participation.maxAttempts;

    let nextAction = "submit";
    if (hasNonRejectedSubmission) {
      nextAction = latestSubmission.decisionStatus === "pending" ? "wait_for_review" : "none";
    } else if (deadlinePassed) {
      nextAction = "expired";
    }

    return {
      id: participation.publicId,
      missionId: mission.publicId,
      missionRevision: participation.missionRevision,
      isCurrentMissionRevision: participation.missionRevision === mission.currentRevision,
      terms: revision
        ? {
            title: revision.title,
            description: revision.description,
            reward: { amount: revision.reward.amount },
          }
        : null,
      currentControls: {
        acceptingSubmissions: mission.acceptingSubmissions,
        reasonCode: mission.acceptingSubmissions ? null : "mission_paused",
      },
      latestSubmissionId: latestSubmission?.publicId ?? null,
      canSubmit,
      nextAction,
    };
  },
});

export const getOwnerSubmission = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    submissionPublicId: v.string(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const normalized = assertPublicId("sub", args.submissionPublicId);
    const submission = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!submission || submission.jellyUserId !== args.jellyUserId) return null;

    const events = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
      .order("asc")
      .collect();
    const timeline = events.slice(-20).map((e: any) => ({
      sequence: e.sequence,
      type: e.type,
      displayStatus: e.displayStatus,
      reasonCode: e.reasonCode ?? null,
      message: e.publicMessage ?? null,
      occurredAt: e.occurredAt,
    }));

    const lastEvent = events[events.length - 1];
    const displayStatus = lastEvent?.displayStatus ?? "submitted";
    const nextAction = deriveNextAction(submission);

    const rewardIntent = submission.rewardIntentId
      ? await ctx.db.get(submission.rewardIntentId)
      : null;

    return {
      mission: {
        id: (await ctx.db.get(submission.missionId))?.publicId,
        revision: submission.missionRevision,
        title: submission.missionTitleSnapshot,
      },
      jellyPost: {
        id: submission.jellyPostId,
        watchUrl: `${JELLY_WATCH_BASE}${submission.jellyPostId}`,
      },
      verification: {
        status: submission.verificationStatus,
        attempts: submission.verificationAttempts,
        reasonCode: submission.reasonCode ?? null,
      },
      decision: {
        status: submission.decisionStatus,
        reasonCode: submission.decisionStatus === "rejected" ? submission.reasonCode ?? null : null,
        message: submission.decisionStatus === "rejected" ? submission.publicMessage ?? null : null,
        decidedAt: submission.decidedAt ?? null,
      },
      reward: {
        id: rewardIntent?.publicId ?? null,
        status: submission.rewardStatus,
        amount: submission.rewardSnapshot.amount,
        transactionId: rewardIntent?.transactionId ?? null,
      },
      displayStatus,
      nextAction,
      timeline,
    };
  },
});

function deriveNextAction(submission: any): string {
  if (submission.decisionStatus === "approved") {
    if (submission.rewardStatus === "sent") return "none";
    if (submission.rewardStatus === "failed") return "contact_support";
    return "wait_for_reward";
  }
  if (submission.decisionStatus === "rejected") return "resubmit_if_eligible";
  if (submission.submissionStatus === "needs_review") return "wait_for_review";
  if (submission.submissionStatus === "verifying") return "wait_for_verification";
  return "wait";
}

export const listOwnerSubmissionEvents = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    submissionPublicId: v.string(),
    limit: v.number(),
    beforeSequence: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const normalized = assertPublicId("sub", args.submissionPublicId);
    const submission = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!submission || submission.jellyUserId !== args.jellyUserId) return null;

    let allEvents = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
      .order("desc")
      .collect();

    if (args.beforeSequence !== undefined) {
      allEvents = allEvents.filter((e: any) => e.sequence < args.beforeSequence);
    }

    const page = allEvents.slice(0, args.limit);
    const hasMore = allEvents.length > args.limit;

    return {
      events: page.map((e: any) => ({
        sequence: e.sequence,
        type: e.type,
        displayStatus: e.displayStatus,
        reasonCode: e.reasonCode ?? null,
        message: e.publicMessage ?? null,
        occurredAt: e.occurredAt,
      })),
      hasMore,
      nextBeforeSequence: page.length > 0 ? page[page.length - 1].sequence : undefined,
    };
  },
});

export const listOwnerEvents = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    afterSequence: v.optional(v.number()),
    limit: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);

    let allEvents = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_user_sequence", (q: any) => q.eq("jellyUserId", args.jellyUserId))
      .order("asc")
      .collect();

    if (args.afterSequence !== undefined) {
      allEvents = allEvents.filter((e: any) => e.sequence > args.afterSequence);
    }

    const page = allEvents.slice(0, args.limit);
    const hasMore = allEvents.length > args.limit;

    return {
      events: page.map((e: any) => ({
        sequence: e.sequence,
        type: e.type,
        displayStatus: e.displayStatus,
        reasonCode: e.reasonCode ?? null,
        message: e.publicMessage ?? null,
        occurredAt: e.occurredAt,
      })),
      hasMore,
      nextAfterSequence: page.length > 0 ? page[page.length - 1].sequence : undefined,
    };
  },
});

export const getOwnerSummary = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    campaignPublicId: v.string(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const normalizedCampaign = assertPublicId("cam", args.campaignPublicId);
    const campaign = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalizedCampaign))
      .unique();
    if (!campaign) return null;

    const submissions = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_mission_user")
      .collect();
    const userSubmissions = submissions.filter(
      (s: any) => s.jellyUserId === args.jellyUserId && s.campaignId === campaign._id,
    );

    const statusCounts: Record<string, number> = {};
    let confirmedAmount = 0;
    for (const sub of userSubmissions) {
      if (sub.submissionStatus === "needs_review") {
        statusCounts.underReview = (statusCounts.underReview ?? 0) + 1;
      } else if (sub.submissionStatus === "approved") {
        statusCounts.approved = (statusCounts.approved ?? 0) + 1;
        if (sub.rewardStatus === "sent") confirmedAmount += Number(sub.rewardSnapshot.amount);
      } else if (sub.submissionStatus === "rejected") {
        statusCounts.rejected = (statusCounts.rejected ?? 0) + 1;
      } else {
        statusCounts.pending = (statusCounts.pending ?? 0) + 1;
      }
    }

    const userEvents = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_user_sequence", (q: any) => q.eq("jellyUserId", args.jellyUserId))
      .order("desc")
      .first();

    return {
      subject: { jellyUserId: args.jellyUserId },
      campaign: {
        id: campaign.publicId,
        statusCounts,
        confirmedRewards: { amount: String(confirmedAmount) },
        latestEventSequence: userEvents?.sequence ?? 0,
      },
    };
  },
});

export const listOwnerMissions = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    campaignPublicId: v.string(),
    limit: v.number(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const normalizedCampaign = assertPublicId("cam", args.campaignPublicId);
    const campaign = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalizedCampaign))
      .unique();
    if (!campaign) return { items: [] };

    const participations = await ctx.db
      .query("jellyhuntParticipations")
      .withIndex("by_user_mission")
      .collect();
    const userParticipations = participations.filter(
      (p: any) => p.jellyUserId === args.jellyUserId && p.campaignId === campaign._id,
    );

    const items = [];
    for (const participation of userParticipations) {
      const mission = await ctx.db.get(participation.missionId);
      if (!mission) continue;

      const latestSubmission = await ctx.db
        .query("jellyhuntSubmissions")
        .withIndex("by_mission_user", (q: any) =>
          q.eq("missionId", participation.missionId).eq("jellyUserId", args.jellyUserId),
        )
        .order("desc")
        .first();

      const lastEvent = latestSubmission
        ? await ctx.db
            .query("jellyhuntSubmissionEvents")
            .withIndex("by_submission_sequence", (q: any) =>
              q.eq("submissionId", latestSubmission._id),
            )
            .order("desc")
            .first()
        : null;

      items.push({
        mission: {
          id: mission.publicId,
          revision: mission.currentRevision,
          title: mission.title,
        },
        participation: {
          id: participation.publicId,
          missionRevision: participation.missionRevision,
        },
        latestSubmission: latestSubmission
          ? {
              id: latestSubmission.publicId,
              displayStatus: lastEvent?.displayStatus ?? "submitted",
            }
          : null,
      });
    }

    return { items: items.slice(0, args.limit) };
  },
});

export const listOwnerSubmissions = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    campaignPublicId: v.string(),
    limit: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const normalizedCampaign = assertPublicId("cam", args.campaignPublicId);
    const campaign = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalizedCampaign))
      .unique();
    if (!campaign) return { items: [] };

    const allSubmissions = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_user_updated", (q: any) => q.eq("jellyUserId", args.jellyUserId))
      .order("desc")
      .collect();
    const campaignSubmissions = allSubmissions.filter(
      (s: any) => s.campaignId === campaign._id,
    );

    const items = [];
    for (const sub of campaignSubmissions.slice(0, args.limit)) {
      const mission = await ctx.db.get(sub.missionId);
      const participation = await ctx.db.get(sub.participationId);
      items.push({
        id: sub.publicId,
        source: sub.source === "live" ? "native" : sub.source,
        participationId: participation?.publicId ?? null,
        mission: {
          id: mission?.publicId,
          revision: sub.missionRevision,
          title: sub.missionTitleSnapshot,
        },
      });
    }

    return { items };
  },
});
