import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireServiceKey } from "./security";
import { assertPublicId } from "./publicIds";
import { formatCanonicalRewardAmount, parseCanonicalRewardAmount } from "./amounts";

const JELLY_WATCH_BASE = "https://jellyjelly.com/watch/";

function ownerId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("invalid_jelly_user_id");
  return normalized;
}

function clampLimit(value: number, fallback: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(Math.max(normalized, 1), 100);
}

function temporalCampaignStatus(campaign: any, now: number): "upcoming" | "active" | "ended" {
  if (now < campaign.startsAt) return "upcoming";
  if (now > campaign.endsAt) return "ended";
  return "active";
}

function missionAvailability(mission: any, revision: any, campaign: any, now: number) {
  if (mission.status === "archived") {
    return { state: "archived", acceptingSubmissions: false, reasonCode: "mission_ended" };
  }
  if (mission.status === "paused") {
    return { state: "paused", acceptingSubmissions: false, reasonCode: "mission_paused" };
  }
  const startsAt = revision.missionWindow.startsAt ?? campaign.startsAt;
  const endsAt = revision.missionWindow.endsAt ?? campaign.endsAt;
  if (now < startsAt) {
    return { state: "upcoming", acceptingSubmissions: false, reasonCode: "mission_upcoming" };
  }
  if (now > endsAt) {
    return { state: "ended", acceptingSubmissions: false, reasonCode: "mission_ended" };
  }
  return {
    state: "available",
    acceptingSubmissions: Boolean(mission.acceptingSubmissions),
    reasonCode: mission.acceptingSubmissions ? null : "mission_paused",
  };
}

function displayForSubmission(submission: any) {
  if (!submission) return {
    displayStatus: "in_progress", nextAction: "submit_post",
    publicMessage: "Publish your Jelly to complete this mission.",
  };
  if (submission.submissionStatus === "rejected" && submission.rewardStatus === "sent" &&
      submission.reasonCode === "post_became_ineligible_after_reward") {
    return {
      displayStatus: "rewarded_removed_from_rankings", nextAction: "contact_support",
      publicMessage: submission.publicMessage ?? "Reward sent; completion later removed from rankings.",
    };
  }
  if (submission.submissionStatus === "submitted") return {
    displayStatus: "submitted", nextAction: "wait_for_verification",
    publicMessage: submission.publicMessage ?? "Your Jelly was submitted for verification.",
  };
  if (submission.submissionStatus === "verifying") return {
    displayStatus: "under_review", nextAction: "wait_for_verification",
    publicMessage: submission.publicMessage ?? "Your Jelly is being verified.",
  };
  if (submission.submissionStatus === "needs_review") return {
    displayStatus: "under_review", nextAction: "wait_for_review",
    publicMessage: submission.publicMessage ?? "Your Jelly is waiting for review.",
  };
  if (submission.submissionStatus === "approved" && submission.rewardStatus === "sent") return {
    displayStatus: "rewarded", nextAction: "view_reward",
    publicMessage: submission.publicMessage ?? "Mission approved and reward sent.",
  };
  if (submission.submissionStatus === "approved" &&
      (submission.rewardStatus === "failed" || submission.rewardStatus === "uncertain")) return {
    displayStatus: "support_needed", nextAction: "contact_support",
    publicMessage: submission.publicMessage ?? "Your approved reward needs support.",
  };
  if (submission.submissionStatus === "approved") return {
    displayStatus: "approved_reward_pending", nextAction: "wait_for_reward",
    publicMessage: submission.publicMessage ?? "Approved. Your reward is being sent.",
  };
  return {
    displayStatus: "rejected", nextAction: "submit_new_post",
    publicMessage: submission.publicMessage ?? "This Jelly did not meet the mission requirements.",
  };
}

function canResubmit(participation: any, mission: any, latestSubmission: any, now: number): boolean {
  return Boolean(
    participation && mission && latestSubmission?.submissionStatus === "rejected" &&
      latestSubmission.rewardStatus !== "sent" && participation.status === "started" &&
      mission.acceptingSubmissions && participation.attemptsUsed < participation.maxAttempts &&
      participation.submissionDeadlineAt >= now &&
      (participation.resubmissionDeadlineAt === undefined ||
        participation.resubmissionDeadlineAt >= now),
  );
}

function timelineEvent(event: any) {
  return {
    sequence: event.sequence,
    type: event.type,
    submissionStatus: event.submissionStatus,
    rewardStatus: event.rewardStatus,
    displayStatus: event.displayStatus,
    ...(event.reasonCode !== undefined ? { reasonCode: event.reasonCode } : {}),
    occurredAt: event.occurredAt,
  };
}

async function campaignForOwner(ctx: any, campaignPublicId?: string) {
  if (campaignPublicId) {
    return await ctx.db.query("jellyhuntCampaigns")
      .withIndex("by_public_id", (q: any) =>
        q.eq("publicId", assertPublicId("cam", campaignPublicId)),
      ).unique();
  }
  return await ctx.db.query("jellyhuntCampaigns")
    .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true)).unique();
}

function isAfterCursor(updatedAt: number, publicId: string, beforeAt?: number, beforeId?: string) {
  if (beforeAt === undefined || beforeId === undefined) return true;
  return updatedAt < beforeAt || (updatedAt === beforeAt && publicId > beforeId);
}

function normalizedRequirements(requirements: any) {
  return {
    ...requirements,
    post: {
      ...requirements.post,
      minDurationSeconds: requirements.post.minDurationSeconds ?? 0,
      maxDurationSeconds: requirements.post.maxDurationSeconds ?? 300,
    },
  };
}

export const getOwnerParticipation = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    participationPublicId: v.string(),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = ownerId(args.jellyUserId);
    const normalized = assertPublicId("par", args.participationPublicId);
    const participation = await ctx.db
      .query("jellyhuntParticipations")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!participation || participation.jellyUserId !== jellyUserId) return null;

    const mission = await ctx.db.get(participation.missionId);
    if (!mission) return null;
    const revision = await ctx.db
      .query("jellyhuntMissionRevisions")
      .withIndex("by_mission_revision", (q: any) =>
        q.eq("missionId", participation.missionId).eq("revision", participation.missionRevision),
      )
      .unique();
    if (!revision) return null;
    const campaign = await ctx.db.get(participation.campaignId);
    const place = await ctx.db.get(revision.place.placeId);
    if (!campaign || !place) return null;

    const submissions = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_mission_user", (q: any) =>
        q.eq("missionId", participation.missionId).eq("jellyUserId", jellyUserId),
      )
      .collect();
    submissions.sort((left: any, right: any) =>
      right.updatedAt - left.updatedAt || left.publicId.localeCompare(right.publicId),
    );
    const latestSubmission = submissions[0] ?? null;

    const deadlinePassed = args.now > participation.submissionDeadlineAt;
    const canSubmit =
      !latestSubmission &&
      !deadlinePassed &&
      participation.status === "started" &&
      mission.acceptingSubmissions &&
      participation.attemptsUsed < participation.maxAttempts;
    const mayResubmit = canResubmit(participation, mission, latestSubmission, args.now);
    const display = latestSubmission
      ? displayForSubmission(latestSubmission)
      : canSubmit
        ? displayForSubmission(null)
        : {
            displayStatus: "in_progress",
            nextAction: "none",
            publicMessage: "This participation is not currently accepting submissions.",
          };

    return {
      id: participation.publicId,
      status: participation.status,
      missionId: mission.publicId,
      missionRevision: participation.missionRevision,
      isCurrentMissionRevision: participation.missionRevision === mission.currentRevision,
      startedAt: participation.startedAt,
      submissionDeadlineAt: participation.submissionDeadlineAt,
      resubmissionDeadlineAt: participation.resubmissionDeadlineAt ?? null,
      attemptsUsed: participation.attemptsUsed,
      maxAttempts: participation.maxAttempts,
      latestSubmissionId: latestSubmission?.publicId ?? null,
      terms: {
        title: revision.title,
        description: revision.description,
        instructions: revision.instructions,
        missionWindow: {
          startsAt: revision.missionWindow.startsAt ?? campaign.startsAt,
          endsAt: revision.missionWindow.endsAt ?? campaign.endsAt,
        },
        reward: revision.reward,
        requirements: normalizedRequirements(revision.requirements),
        place: {
          id: place.publicId,
          jellyPlaceId: revision.place.jellyPlaceId,
          name: revision.place.name,
          address: revision.place.address ?? "",
          latitude: revision.place.latitude,
          longitude: revision.place.longitude,
          timeZone: revision.place.timeZone,
        },
      },
      currentControls: {
        acceptingSubmissions: Boolean(mission.acceptingSubmissions),
        reasonCode: mission.acceptingSubmissions ? null : "mission_paused",
      },
      canStart: false,
      canSubmit,
      canResubmit: mayResubmit,
      nextAction: mayResubmit ? "submit_new_post" : display.nextAction,
      publicMessage: display.publicMessage,
      updatedAt: Math.max(participation.updatedAt, latestSubmission?.updatedAt ?? 0),
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
    const jellyUserId = ownerId(args.jellyUserId);
    const normalized = assertPublicId("sub", args.submissionPublicId);
    const submission = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!submission || submission.jellyUserId !== jellyUserId) return null;

    const events = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
      .order("asc")
      .collect();
    const mission = await ctx.db.get(submission.missionId);
    const participation = await ctx.db.get(submission.participationId);
    if (!mission || !participation) return null;
    const rewardIntent = submission.rewardIntentId ? await ctx.db.get(submission.rewardIntentId) : null;
    const missionSubmissions = await ctx.db.query("jellyhuntSubmissions")
      .withIndex("by_mission_user", (q: any) =>
        q.eq("missionId", submission.missionId).eq("jellyUserId", jellyUserId),
      ).collect();
    missionSubmissions.sort((a: any, b: any) =>
      b.updatedAt - a.updatedAt || a.publicId.localeCompare(b.publicId),
    );
    const mayResubmit =
      missionSubmissions[0]?._id === submission._id &&
      canResubmit(participation, mission, submission, args.now);
    const display = displayForSubmission(submission);

    return {
      id: submission.publicId,
      mission: {
        id: mission.publicId,
        revision: submission.missionRevision,
        title: submission.missionTitleSnapshot,
      },
      attempt: submission.attempt,
      jellyPost: {
        id: submission.jellyPostId,
        watchUrl: `${JELLY_WATCH_BASE}${encodeURIComponent(submission.jellyPostId)}`,
      },
      submissionStatus: submission.submissionStatus,
      verification: {
        status: submission.verificationStatus,
        attempts: submission.verificationAttempts,
        reasonCode: submission.reasonCode ?? null,
        checkedAt: submission.verificationCompletedAt ?? null,
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
        token: submission.rewardSnapshot.token,
        transactionId: rewardIntent?.transactionId ?? submission.rewardTransactionId ?? null,
        sentAt: rewardIntent?.sentAt ?? submission.rewardSentAt ?? null,
      },
      displayStatus: display.displayStatus,
      reasonCode: submission.reasonCode ?? null,
      publicMessage: display.publicMessage,
      canResubmit: mayResubmit,
      nextAction: mayResubmit ? "submit_new_post" : display.nextAction,
      timeline: events.slice(-20).map(timelineEvent),
      submittedAt: submission.submittedAt,
      updatedAt: submission.updatedAt,
    };
  },
});

export const listOwnerSubmissionEvents = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    submissionPublicId: v.string(),
    limit: v.number(),
    asOfSequence: v.optional(v.number()),
    beforeSequence: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = ownerId(args.jellyUserId);
    const normalized = assertPublicId("sub", args.submissionPublicId);
    const submission = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!submission || submission.jellyUserId !== jellyUserId) return null;

    const allEvents = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
      .order("desc")
      .collect();
    const asOfSequence = args.asOfSequence ?? allEvents[0]?.sequence ?? 0;
    const filtered = allEvents.filter((event: any) =>
      event.sequence <= asOfSequence &&
      (args.beforeSequence === undefined || event.sequence < args.beforeSequence),
    );
    const limit = clampLimit(args.limit, 50);
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;

    return {
      events: page.map(timelineEvent),
      hasMore,
      asOfSequence,
      nextBeforeSequence: hasMore ? page[page.length - 1]?.sequence ?? null : null,
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
    const jellyUserId = ownerId(args.jellyUserId);

    const allEvents = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_user_sequence", (q: any) => q.eq("jellyUserId", jellyUserId))
      .order("asc")
      .collect();
    const filtered = allEvents.filter((event: any) =>
      args.afterSequence === undefined || event.sequence > args.afterSequence,
    );
    const limit = clampLimit(args.limit, 50);
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const events = await Promise.all(page.map(async (event: any) => {
      const submission = await ctx.db.get(event.submissionId);
      if (!submission || submission.jellyUserId !== jellyUserId) return null;
      const participation = await ctx.db.get(submission.participationId);
      const rewardIntent = submission.rewardIntentId
        ? await ctx.db.get(submission.rewardIntentId)
        : null;
      const rewardEvent = event.type.startsWith("reward.");
      const type = event.type === "submission.created"
        ? "jellyhunt.submission.created"
        : rewardEvent
          ? "jellyhunt.reward.status_changed"
          : "jellyhunt.submission.status_changed";
      const entity = rewardEvent && rewardIntent
        ? { type: "reward_intent", id: rewardIntent.publicId, sequence: event.sequence }
        : { type: "submission", id: submission.publicId, sequence: event.sequence };
      return {
        id: event.publicId,
        sequence: event.sequence,
        type,
        entity,
        changes: {
          participationStatus: participation?.status ?? null,
          submissionStatus: event.submissionStatus,
          rewardStatus: event.rewardStatus,
          displayStatus: event.displayStatus,
          reasonCode: event.reasonCode ?? null,
          publicMessage: event.publicMessage ?? displayForSubmission(submission).publicMessage,
        },
        occurredAt: event.occurredAt,
        submissionId: submission.publicId,
      };
    }));

    return {
      events: events.filter((event: any) => event !== null),
      hasMore,
      nextAfterSequence: page[page.length - 1]?.sequence ?? null,
    };
  },
});

export const getOwnerSummary = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    campaignPublicId: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = ownerId(args.jellyUserId);
    const campaign = await campaignForOwner(ctx, args.campaignPublicId);
    if (!campaign) return null;

    const missions = await ctx.db.query("jellyhuntMissions")
      .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaign._id)).collect();
    const allSubmissions = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_user_updated", (q: any) => q.eq("jellyUserId", jellyUserId))
      .collect();
    const userSubmissions = allSubmissions.filter((sub: any) => sub.campaignId === campaign._id);
    const allParticipations = await ctx.db.query("jellyhuntParticipations")
      .withIndex("by_user_mission").collect();
    const userParticipations = allParticipations.filter((part: any) =>
      part.jellyUserId === jellyUserId && part.campaignId === campaign._id,
    );
    const statusCounts = {
      notStarted: 0, inProgress: 0, submitted: 0, underReview: 0,
      approvedRewardPending: 0, rewarded: 0, rejected: 0, supportNeeded: 0,
    };
    for (const mission of missions.filter((row: any) => row.status !== "draft")) {
      const participation = userParticipations
        .filter((row: any) => row.missionId === mission._id)
        .sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0];
      const submission = userSubmissions
        .filter((row: any) => row.missionId === mission._id)
        .sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0];
      if (!submission) {
        if (participation) statusCounts.inProgress += 1;
        else if (mission.status !== "archived") statusCounts.notStarted += 1;
      } else if (submission.submissionStatus === "submitted") {
        statusCounts.submitted += 1;
      } else if (submission.submissionStatus === "verifying" ||
          submission.submissionStatus === "needs_review") {
        statusCounts.underReview += 1;
      } else if (submission.submissionStatus === "approved" &&
          (submission.rewardStatus === "queued" || submission.rewardStatus === "processing")) {
        statusCounts.approvedRewardPending += 1;
      } else if (submission.rewardStatus === "sent") {
        statusCounts.rewarded += 1;
      } else if (submission.submissionStatus === "rejected") {
        statusCounts.rejected += 1;
      } else {
        statusCounts.supportNeeded += 1;
      }
    }
    let confirmedAtomic = 0n;
    for (const sub of userSubmissions) {
      if (sub.rewardStatus === "sent") {
        confirmedAtomic += parseCanonicalRewardAmount(sub.rewardSnapshot.amount, { allowZero: true });
      }
    }
    const latestEvent = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_user_sequence", (q: any) => q.eq("jellyUserId", jellyUserId))
      .order("desc")
      .first();
    const updatedAt = Math.max(
      campaign.updatedAt,
      ...userParticipations.map((row: any) => row.updatedAt),
      ...userSubmissions.map((row: any) => row.updatedAt),
    );

    return {
      subject: { jellyUserId },
      campaign: {
        id: campaign.publicId,
        status: temporalCampaignStatus(campaign, args.now),
        statusCounts,
        confirmedRewards: {
          amount: formatCanonicalRewardAmount(confirmedAtomic),
          token: campaign.rewardToken.code,
        },
        latestEventSequence: latestEvent?.sequence ?? 0,
        updatedAt,
      },
    };
  },
});

export const listOwnerMissions = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    campaignPublicId: v.optional(v.string()),
    participationStatus: v.optional(v.union(v.literal("not_started"), v.literal("started"))),
    limit: v.number(),
    now: v.number(),
    asOf: v.optional(v.number()),
    beforeUpdatedAt: v.optional(v.number()),
    beforeMissionPublicId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = ownerId(args.jellyUserId);
    const campaign = await campaignForOwner(ctx, args.campaignPublicId);
    if (!campaign) return null;
    const asOf = args.asOf ?? Date.now();
    const limit = clampLimit(args.limit, 20);
    const missions = await ctx.db.query("jellyhuntMissions")
      .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaign._id)).collect();
    const allParticipations = await ctx.db.query("jellyhuntParticipations")
      .withIndex("by_user_mission").collect();
    const participations = allParticipations.filter((part: any) =>
      part.jellyUserId === jellyUserId && part.campaignId === campaign._id,
    );

    const projected = [];
    for (const mission of missions) {
      const participation = participations
        .filter((part: any) => part.missionId === mission._id)
        .sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null;
      if (mission.status === "draft" || (mission.status === "archived" && !participation)) continue;
      const revision = await ctx.db.query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q: any) =>
          q.eq("missionId", mission._id).eq("revision", mission.currentRevision),
        ).unique();
      if (!revision) continue;
      const place = await ctx.db.get(revision.place.placeId);
      if (!place) continue;
      const submissions = await ctx.db.query("jellyhuntSubmissions")
        .withIndex("by_mission_user", (q: any) =>
          q.eq("missionId", mission._id).eq("jellyUserId", jellyUserId),
        ).collect();
      submissions.sort((a: any, b: any) =>
        b.updatedAt - a.updatedAt || a.publicId.localeCompare(b.publicId),
      );
      const latestSubmission = submissions[0] ?? null;
      const availability = missionAvailability(mission, revision, campaign, args.now);
      const canStart = !participation && availability.acceptingSubmissions;
      const canSubmit = Boolean(
        participation && !latestSubmission && participation.status === "started" &&
        availability.acceptingSubmissions && participation.submissionDeadlineAt >= args.now &&
        participation.attemptsUsed < participation.maxAttempts,
      );
      const mayResubmit = canResubmit(participation, mission, latestSubmission, args.now) &&
        availability.acceptingSubmissions;
      const display = latestSubmission
        ? displayForSubmission(latestSubmission)
        : participation
          ? (canSubmit ? displayForSubmission(null) : {
              displayStatus: "in_progress", nextAction: "none",
              publicMessage: "This participation is not currently accepting submissions.",
            })
          : {
              displayStatus: "not_started", nextAction: canStart ? "start_mission" : "none",
              publicMessage: canStart
                ? "Visit the place and start this mission in JellyJelly."
                : "This mission is not currently available.",
            };
      const updatedAt = Math.max(
        mission.updatedAt, participation?.updatedAt ?? 0, latestSubmission?.updatedAt ?? 0,
      );
      projected.push({
        mission: {
          id: mission.publicId,
          revision: mission.currentRevision,
          title: mission.title,
          availability,
          reward: { amount: mission.reward.amount, token: mission.reward.token },
          display: {
            emoji: mission.emoji, category: mission.category,
            difficulty: mission.difficulty, neighborhood: mission.neighborhood,
          },
          place: {
            id: place.publicId, name: revision.place.name,
            latitude: revision.place.latitude, longitude: revision.place.longitude,
          },
        },
        participationStatus: participation ? "started" : "not_started",
        participation: participation ? {
          id: participation.publicId,
          missionRevision: participation.missionRevision,
          startedAt: participation.startedAt,
          submissionDeadlineAt: participation.submissionDeadlineAt,
          resubmissionDeadlineAt: participation.resubmissionDeadlineAt ?? null,
        } : null,
        latestSubmission: latestSubmission
          ? {
              id: latestSubmission.publicId,
              attempt: latestSubmission.attempt,
              submissionStatus: latestSubmission.submissionStatus,
              rewardStatus: latestSubmission.rewardStatus,
              displayStatus: display.displayStatus,
              updatedAt: latestSubmission.updatedAt,
            }
          : null,
        canStart,
        canSubmit,
        canResubmit: mayResubmit,
        nextAction: mayResubmit
          ? "submit_new_post"
          : latestSubmission?.submissionStatus === "rejected" && display.nextAction === "submit_new_post"
            ? "none"
            : display.nextAction,
        reasonCode: latestSubmission?.reasonCode ?? availability.reasonCode ?? null,
        publicMessage: display.publicMessage,
        updatedAt,
      });
    }
    const filtered = projected
      .filter((item: any) => item.updatedAt <= asOf)
      .filter((item: any) => !args.participationStatus ||
        item.participationStatus === args.participationStatus)
      .sort((a: any, b: any) =>
        b.updatedAt - a.updatedAt || a.mission.id.localeCompare(b.mission.id),
      )
      .filter((item: any) => isAfterCursor(
        item.updatedAt, item.mission.id, args.beforeUpdatedAt, args.beforeMissionPublicId,
      ));
    const items = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const last = hasMore ? items[items.length - 1] : null;
    return {
      items, hasMore, asOf,
      nextUpdatedAt: last?.updatedAt ?? null,
      nextMissionPublicId: last?.mission.id ?? null,
    };
  },
});

export const listOwnerSubmissions = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    campaignPublicId: v.optional(v.string()),
    missionPublicId: v.optional(v.string()),
    submissionStatus: v.optional(v.string()),
    rewardStatus: v.optional(v.string()),
    updatedAfter: v.optional(v.number()),
    limit: v.number(),
    asOf: v.optional(v.number()),
    beforeUpdatedAt: v.optional(v.number()),
    beforeSubmissionPublicId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = ownerId(args.jellyUserId);
    const campaign = args.campaignPublicId
      ? await campaignForOwner(ctx, args.campaignPublicId)
      : null;
    if (args.campaignPublicId && !campaign) return null;
    let missionFilter: any = null;
    if (args.missionPublicId) {
      missionFilter = await ctx.db.query("jellyhuntMissions")
        .withIndex("by_public_id", (q: any) =>
          q.eq("publicId", assertPublicId("mis", args.missionPublicId)),
        ).unique();
      if (!missionFilter) return {
        items: [], hasMore: false, asOf: args.asOf ?? Date.now(),
        nextUpdatedAt: null, nextSubmissionPublicId: null,
      };
    }
    const asOf = args.asOf ?? Date.now();
    const limit = clampLimit(args.limit, 20);
    const allSubmissions = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_user_updated", (q: any) => q.eq("jellyUserId", jellyUserId))
      .order("desc")
      .collect();
    const candidates = allSubmissions.filter((sub: any) =>
      (!campaign || sub.campaignId === campaign._id) &&
      (!missionFilter || sub.missionId === missionFilter._id) &&
      (!args.submissionStatus || sub.submissionStatus === args.submissionStatus) &&
      (!args.rewardStatus || sub.rewardStatus === args.rewardStatus) &&
      (args.updatedAfter === undefined || sub.updatedAt > args.updatedAfter) &&
      sub.updatedAt <= asOf,
    );

    const projected = [];
    for (const sub of candidates) {
      const mission = await ctx.db.get(sub.missionId);
      const participation = await ctx.db.get(sub.participationId);
      if (!mission) continue;
      const rewardIntent = sub.rewardIntentId ? await ctx.db.get(sub.rewardIntentId) : null;
      const latestForMission = allSubmissions
        .filter((row: any) => row.missionId === sub.missionId)
        .sort((a: any, b: any) =>
          b.updatedAt - a.updatedAt || a.publicId.localeCompare(b.publicId),
        )[0];
      const mayResubmit = latestForMission?._id === sub._id &&
        canResubmit(participation, mission, sub, Date.now());
      const display = displayForSubmission(sub);
      projected.push({
        id: sub.publicId,
        source: sub.source === "live" ? "native" : sub.source,
        attempt: sub.attempt,
        participationId: participation?.publicId ?? null,
        mission: {
          id: mission?.publicId,
          revision: sub.missionRevision,
          title: sub.missionTitleSnapshot,
        },
        jellyPost: {
          id: sub.jellyPostId,
          watchUrl: `${JELLY_WATCH_BASE}${encodeURIComponent(sub.jellyPostId)}`,
        },
        submissionStatus: sub.submissionStatus,
        reward: {
          id: rewardIntent?.publicId ?? null,
          status: sub.rewardStatus,
          amount: sub.rewardSnapshot.amount,
          token: sub.rewardSnapshot.token,
          transactionId: rewardIntent?.transactionId ?? sub.rewardTransactionId ?? null,
          sentAt: rewardIntent?.sentAt ?? sub.rewardSentAt ?? null,
        },
        displayStatus: display.displayStatus,
        reasonCode: sub.reasonCode ?? null,
        publicMessage: display.publicMessage,
        canResubmit: mayResubmit,
        nextAction: mayResubmit
          ? "submit_new_post"
          : sub.submissionStatus === "rejected" && display.nextAction === "submit_new_post"
            ? "none"
            : display.nextAction,
        submittedAt: sub.submittedAt,
        updatedAt: sub.updatedAt,
      });
    }
    const ordered = projected
      .sort((a: any, b: any) =>
        b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
      )
      .filter((item: any) => isAfterCursor(
        item.updatedAt, item.id, args.beforeUpdatedAt, args.beforeSubmissionPublicId,
      ));
    const items = ordered.slice(0, limit);
    const hasMore = ordered.length > limit;
    const last = hasMore ? items[items.length - 1] : null;
    return {
      items, hasMore, asOf,
      nextUpdatedAt: last?.updatedAt ?? null,
      nextSubmissionPublicId: last?.id ?? null,
    };
  },
});
