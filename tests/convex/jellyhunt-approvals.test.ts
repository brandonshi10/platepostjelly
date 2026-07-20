import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const approvals = anyApi.jellyhunt.approvals;
const budgets = anyApi.jellyhunt.budgets;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

function campaignArgs(overrides: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    slug: `season-${suffix}`,
    title: "JellyHunt NYC",
    status: "active" as const,
    startsAt: Date.parse("2026-08-01T00:00:00Z"),
    endsAt: Date.parse("2026-09-01T00:00:00Z"),
    timeZone: "America/New_York",
    rewardTokenCode: "JELLY-MY-JELLY" as const,
    rewardTokenDisplayName: "Jelly-My-Jelly",
    map: {
      centerLatitude: 40.72,
      centerLongitude: -73.99,
      boundsSouth: 40.7,
      boundsWest: -74.0,
      boundsNorth: 40.74,
      boundsEast: -73.97,
      defaultZoom: 13,
    },
    links: { iosApp: "https://apps.apple.com/app/jellyjelly" },
    ...overrides,
  };
}

function placeArgs(overrides: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    jellyPlaceId: `jpl_${suffix}`,
    name: "Scarr's Pizza",
    address: "35 Orchard St, New York, NY",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
    ...overrides,
  };
}

async function seedCampaignAndMission(t: any) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  await t.mutation(campaigns.selectCurrentCampaign, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
  });

  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  await t.mutation(places.setPlaceReviewStatus, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    placePublicId,
    reviewStatus: "reviewed",
  });

  const suffix = uniqueSuffix();
  const missionPublicId = await t.mutation(missions.createDraftMission, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
    placePublicId,
    slug: `mission-${suffix}`,
    title: "Test Mission",
    category: "Food",
    difficulty: "easy" as const,
    emoji: "🍕",
    neighborhood: "LES",
    price: "$",
    sortOrder: 1,
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    approvalMode: "manual" as const,
  });

  await t.mutation(missions.publishMissionRevision, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    missionPublicId,
    expectedDraftRevision: 0,
    content: {
      title: "Test Mission",
      description: "Do the thing",
      instructions: ["Step 1"],
      requirements: {
        post: { allowedPostTypes: ["photo"], authorshipPolicy: "self", prompt: "post it", requiredVisibility: "public" },
        place: { attachmentRequired: true },
        location: { required: true, trustedSource: "server" },
        schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
      },
      reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
      missionWindow: {},
    },
  });
  await t.mutation(budgets.setBudgetAllocation, {
    serviceKey: TEST_SERVICE_KEY,
    scopeType: "campaign",
    scopeKey: campaignPublicId,
    allocatedAmount: "6000",
    expectedRevision: 0,
  });
  await t.mutation(budgets.setBudgetAllocation, {
    serviceKey: TEST_SERVICE_KEY,
    scopeType: "mission",
    scopeKey: missionPublicId,
    allocatedAmount: "6000",
    expectedRevision: 0,
  });

  return { campaignPublicId, placePublicId, missionPublicId };
}

async function insertSubmission(t: any, missionPublicId: string, overrides: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  const submissionPublicId = `sub_${suffix}`;
  const jellyUserId = (overrides.jellyUserId as string) ?? `user_${suffix}`;

  const missionRow = await t.run(async (ctx: any) => {
    return await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", missionPublicId))
      .unique();
  });

  const participationId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("jellyhuntParticipations", {
      publicId: `par_${suffix}`,
      jellyUserId,
      missionId: missionRow._id,
      campaignId: missionRow.campaignId,
      missionRevision: 1,
      status: "started",
      startedAt: Date.now(),
      submissionDeadlineAt: Date.now() + 86400000,
      attemptsUsed: 1,
      maxAttempts: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx: any) => {
    await ctx.db.insert("jellyhuntSubmissions", {
      publicId: submissionPublicId,
      campaignId: missionRow.campaignId,
      missionId: missionRow._id,
      participationId,
      jellyUserId,
      jellyPostId: `post_${suffix}`,
      dedupeKey: `${jellyUserId}:${missionRow._id}:1`,
      attempt: 1,
      source: (overrides.source as string) ?? "live",
      missionRevision: 1,
      submissionStatus: "needs_review",
      rewardStatus: "not_eligible",
      missionTitleSnapshot: "Test Mission",
      approvalModeSnapshot: "manual",
      placeSnapshot: {
        placeId: missionRow.placeId,
        jellyPlaceId: "jpl_test",
        name: "Test Place",
        latitude: 40.7163,
        longitude: -73.9914,
        geofenceRadiusMeters: 75,
        timeZone: "America/New_York",
      },
      rewardSnapshot: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      verificationStatus: "complete",
      verificationAttempts: 1,
      decisionStatus: "pending",
      submittedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });
    const submission = await ctx.db
      .query("jellyhuntSubmissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", submissionPublicId))
      .unique();
    await ctx.db.insert("jellyhuntRewardReservations", {
      submissionId: submission._id,
      campaignId: submission.campaignId,
      missionId: submission.missionId,
      jellyUserId,
      amount: submission.rewardSnapshot.amount,
      token: submission.rewardSnapshot.token,
      status: "pending_verification",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const campaignRow = await t.run(async (ctx: any) => ctx.db.get(missionRow.campaignId));
  await t.mutation(budgets.reserveBudgetAmount, {
    serviceKey: TEST_SERVICE_KEY,
    scopeType: "campaign",
    scopeKey: campaignRow.publicId,
    campaignId: campaignRow._id,
    amount: "60",
  });
  await t.mutation(budgets.reserveBudgetAmount, {
    serviceKey: TEST_SERVICE_KEY,
    scopeType: "mission",
    scopeKey: missionRow.publicId,
    campaignId: campaignRow._id,
    missionId: missionRow._id,
    amount: "60",
  });

  return { submissionPublicId, jellyUserId };
}

describe("approveSubmission", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a completion and queues reward on first approval", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId } = await insertSubmission(t, missionPublicId);

    const result = await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_001",
    });

    expect(result.replay).toBe(false);
    expect(result.completionPublicId).toMatch(/^cmp_/);

    const state = await t.run(async (ctx: any) => {
      const submission = await ctx.db
        .query("jellyhuntSubmissions")
        .withIndex("by_public_id", (q: any) => q.eq("publicId", submissionPublicId))
        .unique();
      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
        .unique();
      const events = await ctx.db
        .query("jellyhuntSubmissionEvents")
        .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
        .collect();
      return { submission, reservation, events };
    });

    expect(state.submission.rewardIntentId).toBeDefined();
    expect(state.reservation.status).toBe("approved_reserved");
    expect(state.events.at(-1)).toMatchObject({
      type: "decision.approved",
      submissionStatus: "approved",
      rewardStatus: "queued",
      displayStatus: "approved_reward_pending",
    });
  });

  it("rejects approval before a submission reaches review or verified decision state", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId } = await insertSubmission(t, missionPublicId, {
      submissionStatus: "submitted",
      verificationStatus: "pending",
      verificationAttempts: 0,
    });

    await expect(
      t.mutation(approvals.approveSubmission, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        submissionPublicId,
        approvalDecisionId: "decision_too_early",
      }),
    ).rejects.toThrow("submission_not_ready_for_decision");
  });

  it("replays the same decision ID + submission idempotently", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId } = await insertSubmission(t, missionPublicId);

    const first = await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_001",
    });

    const replay = await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_001",
    });

    expect(replay.replay).toBe(true);
    expect(replay.completionPublicId).toBe(first.completionPublicId);
  });

  it("rejects same decision ID for a different submission", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const sub1 = await insertSubmission(t, missionPublicId, { jellyUserId: "user_a" });
    const sub2 = await insertSubmission(t, missionPublicId, { jellyUserId: "user_b" });

    await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId: sub1.submissionPublicId,
      approvalDecisionId: "decision_shared",
    });

    await expect(
      t.mutation(approvals.approveSubmission, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        submissionPublicId: sub2.submissionPublicId,
        approvalDecisionId: "decision_shared",
      }),
    ).rejects.toThrow("approval_decision_id_conflict");
  });

  it("blocks double approval of same user/campaign/mission", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const sub1 = await insertSubmission(t, missionPublicId, { jellyUserId: "user_dup" });

    await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId: sub1.submissionPublicId,
      approvalDecisionId: "decision_first",
    });

    const sub2 = await insertSubmission(t, missionPublicId, { jellyUserId: "user_dup" });

    await expect(
      t.mutation(approvals.approveSubmission, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        submissionPublicId: sub2.submissionPublicId,
        approvalDecisionId: "decision_second",
      }),
    ).rejects.toThrow("mission_already_completed");
  });

  it("increments campaign and all-time leaderboard counts for live submissions", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId, jellyUserId } = await insertSubmission(t, missionPublicId);

    await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_lb",
    });

    const allTimeEntries = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .filter((q: any) =>
          q.and(
            q.eq(q.field("scopeKey"), "all_time"),
            q.eq(q.field("jellyUserId"), jellyUserId),
          ),
        )
        .collect();
    });

    expect(allTimeEntries).toHaveLength(1);
    expect(allTimeEntries[0].approvedMissionCount).toBe(1);
    expect(allTimeEntries[0].rankSortScore).toBe(-1);
  });

  it("does not count legacy source toward leaderboard", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId, jellyUserId } = await insertSubmission(t, missionPublicId, { source: "legacy" });

    await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_legacy",
    });

    const allTimeEntries = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .filter((q: any) =>
          q.and(
            q.eq(q.field("scopeKey"), "all_time"),
            q.eq(q.field("jellyUserId"), jellyUserId),
          ),
        )
        .collect();
    });

    expect(allTimeEntries).toHaveLength(0);
  });
});

describe("reverseCompletion", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reverses a completion and decrements leaderboard", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId, jellyUserId } = await insertSubmission(t, missionPublicId);

    const { completionPublicId } = await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_rev",
    });

    const result = await t.mutation(approvals.reverseCompletion, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      completionPublicId,
      reason: "fraud_detected",
    });

    expect(result.alreadyReversed).toBe(false);

    const allTimeEntries = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .filter((q: any) =>
          q.and(
            q.eq(q.field("scopeKey"), "all_time"),
            q.eq(q.field("jellyUserId"), jellyUserId),
          ),
        )
        .collect();
    });

    expect(allTimeEntries[0].approvedMissionCount).toBe(0);
  });

  it("is idempotent when already reversed", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId } = await insertSubmission(t, missionPublicId);

    const { completionPublicId } = await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_idem",
    });

    await t.mutation(approvals.reverseCompletion, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      completionPublicId,
      reason: "fraud",
    });

    const result = await t.mutation(approvals.reverseCompletion, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      completionPublicId,
      reason: "fraud",
    });

    expect(result.alreadyReversed).toBe(true);
  });

  it("blocks reversal when reward is processing or uncertain", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId } = await insertSubmission(t, missionPublicId);

    const { completionPublicId } = await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_proc",
    });

    await t.run(async (ctx: any) => {
      const intent = await ctx.db
        .query("jellyhuntRewardIntents")
        .order("desc")
        .first();
      if (intent) {
        await ctx.db.patch(intent._id, { status: "processing" });
      }
    });

    await expect(
      t.mutation(approvals.reverseCompletion, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        completionPublicId,
        reason: "fraud",
      }),
    ).rejects.toThrow("reconciliation_required");
  });
});

describe("moderateAfterPayment", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps reward as sent but reverses completion and score", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId, jellyUserId } = await insertSubmission(t, missionPublicId);

    await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_mod",
    });

    await t.run(async (ctx: any) => {
      const sub = await ctx.db
        .query("jellyhuntSubmissions")
        .withIndex("by_public_id", (q: any) => q.eq("publicId", submissionPublicId))
        .unique();
      await ctx.db.patch(sub._id, { rewardStatus: "sent" });
    });

    const result = await t.mutation(approvals.moderateAfterPayment, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      reasonCode: "post_became_ineligible_after_reward",
    });

    expect(result.completionPublicId).toMatch(/^cmp_/);

    const submission = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntSubmissions")
        .withIndex("by_public_id", (q: any) => q.eq("publicId", submissionPublicId))
        .unique();
    });

    expect(submission.submissionStatus).toBe("rejected");
    expect(submission.rewardStatus).toBe("sent");

    const allTimeEntries = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .filter((q: any) =>
          q.and(
            q.eq(q.field("scopeKey"), "all_time"),
            q.eq(q.field("jellyUserId"), jellyUserId),
          ),
        )
        .collect();
    });

    expect(allTimeEntries[0].approvedMissionCount).toBe(0);
  });

  it("rejects when reward is not sent", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const { submissionPublicId } = await insertSubmission(t, missionPublicId);

    await t.mutation(approvals.approveSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      submissionPublicId,
      approvalDecisionId: "decision_notsent",
    });

    await expect(
      t.mutation(approvals.moderateAfterPayment, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        submissionPublicId,
        reasonCode: "post_became_ineligible_after_reward",
      }),
    ).rejects.toThrow("post_payment_moderation_requires_sent_reward");
  });
});
