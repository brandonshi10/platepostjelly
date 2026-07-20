import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";
import {
  buildRewardAttempt,
  parseRewardAttemptResponse,
  assertReceiptMatchesIntent,
} from "../../convex/jellyhunt/rewardContracts";

const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const approvals = anyApi.jellyhunt.approvals;
const rewards = anyApi.jellyhunt.rewards;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

function campaignArgs() {
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
    map: { centerLatitude: 40.72, centerLongitude: -73.99, boundsSouth: 40.7, boundsWest: -74.0, boundsNorth: 40.74, boundsEast: -73.97, defaultZoom: 13 },
    links: { iosApp: "https://apps.apple.com/app/jellyjelly" },
  };
}

function placeArgs() {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    jellyPlaceId: `jpl_${suffix}`,
    name: "Scarr's Pizza",
    address: "35 Orchard St",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
  };
}

async function seedApprovedSubmission(t: any) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  await t.mutation(campaigns.selectCurrentCampaign, { serviceKey: TEST_SERVICE_KEY, actorId: "admin_1", campaignPublicId });
  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  await t.mutation(places.setPlaceReviewStatus, { serviceKey: TEST_SERVICE_KEY, actorId: "admin_1", placePublicId, reviewStatus: "reviewed" });

  const suffix = uniqueSuffix();
  const missionPublicId = await t.mutation(missions.createDraftMission, {
    serviceKey: TEST_SERVICE_KEY, actorId: "admin_1", campaignPublicId, placePublicId,
    slug: `mission-${suffix}`, title: "Test", category: "Food", difficulty: "easy" as const,
    emoji: "🍕", neighborhood: "LES", price: "$", sortOrder: 1,
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    approvalMode: "manual" as const,
  });
  await t.mutation(missions.publishMissionRevision, {
    serviceKey: TEST_SERVICE_KEY, actorId: "admin_1", missionPublicId, expectedDraftRevision: 0,
    content: {
      title: "Test", description: "Do it", instructions: ["Go"],
      requirements: {
        post: { allowedPostTypes: ["photo"], authorshipPolicy: "self", prompt: "post", requiredVisibility: "public" },
        place: { attachmentRequired: true }, location: { required: true, trustedSource: "server" },
        schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
      },
      reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
      missionWindow: {},
    },
  });

  const jellyUserId = `user_${suffix}`;
  const submissionPublicId = `sub_${suffix}`;

  const missionRow = await t.run(async (ctx: any) => {
    return await ctx.db.query("jellyhuntMissions").withIndex("by_public_id", (q: any) => q.eq("publicId", missionPublicId)).unique();
  });

  const participationId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("jellyhuntParticipations", {
      publicId: `par_${suffix}`, jellyUserId, missionId: missionRow._id, campaignId: missionRow.campaignId,
      missionRevision: 1, status: "started", startedAt: Date.now(), submissionDeadlineAt: Date.now() + 86400000,
      attemptsUsed: 1, maxAttempts: 3, createdAt: Date.now(), updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx: any) => {
    await ctx.db.insert("jellyhuntSubmissions", {
      publicId: submissionPublicId, campaignId: missionRow.campaignId, missionId: missionRow._id,
      participationId, jellyUserId, jellyPostId: `post_${suffix}`,
      dedupeKey: `${jellyUserId}:${missionRow._id}:1`, attempt: 1, source: "live", missionRevision: 1,
      submissionStatus: "needs_review", rewardStatus: "not_eligible",
      missionTitleSnapshot: "Test", approvalModeSnapshot: "manual",
      placeSnapshot: { placeId: missionRow.placeId, jellyPlaceId: "jpl_test", name: "Test", latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75, timeZone: "America/New_York" },
      rewardSnapshot: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      verificationStatus: "complete", verificationAttempts: 1, decisionStatus: "pending",
      submittedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    });
  });

  // Insert reservation so approveSubmission can patch it to approved_reserved
  await t.run(async (ctx: any) => {
    const sub = await ctx.db.query("jellyhuntSubmissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", submissionPublicId)).unique();
    await ctx.db.insert("jellyhuntRewardReservations", {
      submissionId: sub._id,
      campaignId: sub.campaignId,
      missionId: sub.missionId,
      jellyUserId,
      amount: "60",
      token: "JELLY-MY-JELLY",
      status: "pending_verification",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.mutation(approvals.approveSubmission, {
    serviceKey: TEST_SERVICE_KEY, actorId: "admin_1", submissionPublicId, approvalDecisionId: `dec_${suffix}`,
  });

  return { submissionPublicId, jellyUserId, missionPublicId };
}

describe("rewardContracts", () => {
  it("builds idempotency key from intent and attempt number", () => {
    const result = buildRewardAttempt({
      intentPublicId: "rwd_abc123", submissionPublicId: "sub_001", missionPublicId: "mis_001",
      jellyPostId: "post_001", recipientUserId: "user_001", amount: "60", token: "JELLY-MY-JELLY", decimals: 6,
    }, 1);
    expect(result.idempotencyKey).toBe("reward:rwd_abc123:attempt:1");
    expect(result.body.attemptNumber).toBe(1);
  });

  it("parses 201 sent response", () => {
    const outcome = parseRewardAttemptResponse(201, {
      rewardIntent: { status: "sent", transactionId: "txn_001", transactionHash: "0xabc" },
    });
    expect(outcome.status).toBe("sent");
    if (outcome.status === "sent") {
      expect(outcome.transactionId).toBe("txn_001");
    }
  });

  it("parses 202 accepted response", () => {
    const outcome = parseRewardAttemptResponse(202, {});
    expect(outcome.status).toBe("accepted");
  });

  it("parses 422 confirmed no transfer", () => {
    const outcome = parseRewardAttemptResponse(422, { error: { code: "insufficient_balance" } });
    expect(outcome.status).toBe("confirmed_no_transfer");
  });

  it("treats 500/429/timeout as uncertain", () => {
    expect(parseRewardAttemptResponse(500, {}).status).toBe("uncertain");
    expect(parseRewardAttemptResponse(429, {}).status).toBe("uncertain");
  });

  it("assertReceiptMatchesIntent throws on mismatch", () => {
    const intent = {
      intentPublicId: "rwd_001", submissionPublicId: "sub_001", missionPublicId: "mis_001",
      jellyPostId: "post_001", recipientUserId: "user_001", amount: "60", token: "JELLY-MY-JELLY", decimals: 6,
    };
    expect(() => assertReceiptMatchesIntent(intent, {
      ...intent, intentId: "rwd_001", submissionId: "sub_001", missionId: "mis_001",
      transactionId: "txn_001", amount: "999",
    })).toThrow("receipt_mismatch");
  });

  it("assertReceiptMatchesIntent passes on match", () => {
    const intent = {
      intentPublicId: "rwd_001", submissionPublicId: "sub_001", missionPublicId: "mis_001",
      jellyPostId: "post_001", recipientUserId: "user_001", amount: "60", token: "JELLY-MY-JELLY", decimals: 6,
    };
    expect(() => assertReceiptMatchesIntent(intent, {
      intentId: "rwd_001", submissionId: "sub_001", missionId: "mis_001",
      jellyPostId: "post_001", recipientUserId: "user_001", amount: "60", token: "JELLY-MY-JELLY", decimals: 6,
      transactionId: "txn_001",
    })).not.toThrow();
  });
});

describe("leaseNextRewardAttempt", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    vi.stubEnv("JELLYHUNT_AUTOMATIC_REWARDS_ENABLED", "true");
    t = createJellyhuntTestConvex();
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns rewards_disabled when flag is off", async () => {
    vi.stubEnv("JELLYHUNT_AUTOMATIC_REWARDS_ENABLED", "false");
    const result = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });
    expect(result.leased).toBe(false);
    expect(result.reason).toBe("rewards_disabled");
  });

  it("returns no_queued_intents when queue is empty", async () => {
    const result = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });
    expect(result.leased).toBe(false);
    expect(result.reason).toBe("no_queued_intents");
  });

  it("leases a queued intent after approval", async () => {
    await seedApprovedSubmission(t);
    const result = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });
    expect(result.leased).toBe(true);
    expect(result.attemptNumber).toBe(1);
    expect(result.idempotencyKey).toMatch(/^reward:rwd_.*:attempt:1$/);
  });

  it("blocks second lease while first is processing", async () => {
    await seedApprovedSubmission(t);
    await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });
    const second = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });
    expect(second.leased).toBe(false);
  });
});

describe("recordRewardOutcome", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    vi.stubEnv("JELLYHUNT_AUTOMATIC_REWARDS_ENABLED", "true");
    t = createJellyhuntTestConvex();
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("records sent outcome with transaction ID", async () => {
    await seedApprovedSubmission(t);
    const lease = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });

    const result = await t.mutation(rewards.recordRewardOutcome, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
      intentInternalId: lease.intentInternalId,
      attemptNumber: 1,
      outcomeStatus: "sent",
      transactionId: "txn_unique_001",
    });

    expect(result.alreadyRecorded).toBe(false);

    const status = await t.query(rewards.getRewardIntentStatus, {
      serviceKey: TEST_SERVICE_KEY,
      intentPublicId: lease.snapshot.intentPublicId,
    });
    expect(status.status).toBe("sent");
    expect(status.transactionId).toBe("txn_unique_001");
  });

  it("records uncertain outcome", async () => {
    await seedApprovedSubmission(t);
    const lease = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });

    await t.mutation(rewards.recordRewardOutcome, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
      intentInternalId: lease.intentInternalId,
      attemptNumber: 1,
      outcomeStatus: "uncertain",
      reasonCode: "http_500",
    });

    const status = await t.query(rewards.getRewardIntentStatus, {
      serviceKey: TEST_SERVICE_KEY,
      intentPublicId: lease.snapshot.intentPublicId,
    });
    expect(status.status).toBe("uncertain");
  });

  it("records confirmed_no_transfer and releases reservation", async () => {
    await seedApprovedSubmission(t);
    const lease = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });

    await t.mutation(rewards.recordRewardOutcome, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
      intentInternalId: lease.intentInternalId,
      attemptNumber: 1,
      outcomeStatus: "confirmed_no_transfer",
      reasonCode: "insufficient_balance",
      confirmedNoTransfer: true,
    });

    const status = await t.query(rewards.getRewardIntentStatus, {
      serviceKey: TEST_SERVICE_KEY,
      intentPublicId: lease.snapshot.intentPublicId,
    });
    expect(status.status).toBe("failed");
  });

  it("rejects sent without transaction ID", async () => {
    await seedApprovedSubmission(t);
    const lease = await t.mutation(rewards.leaseNextRewardAttempt, {
      serviceKey: TEST_SERVICE_KEY, actorId: "worker",
    });

    await expect(
      t.mutation(rewards.recordRewardOutcome, {
        serviceKey: TEST_SERVICE_KEY, actorId: "worker",
        intentInternalId: lease.intentInternalId,
        attemptNumber: 1,
        outcomeStatus: "sent",
      }),
    ).rejects.toThrow("sent_requires_transaction_id");
  });
});
