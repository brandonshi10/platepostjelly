import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const submissions = anyApi.jellyhunt.submissions;
const NOW = 1_800_000_000_000;
const PATH = "/api/v2/jellyhunt/missions/mis_atomic/submissions";

function prepareArgs(overrides: Record<string, unknown> = {}) {
  return {
    serviceKey: TEST_SERVICE_KEY,
    jellySubjectId: "jelly-user-1",
    httpMethod: "POST",
    normalizedPath: PATH,
    idempotencyKey: "018f3f96-92db-7d3d-8c21-fd656cb50aaa",
    requestHash: "request-hash-a",
    originalRequestId: "request-original",
    leaseOwner: "next-worker-1",
    campaignEndsAt: NOW + 86_400_000,
    now: NOW,
    ...overrides,
  };
}

async function seedAtomicMission(
  t: any,
  overrides: { missionBudget?: string; campaignBudget?: string; revisionApprovalMode?: "manual" | "automatic" } = {},
) {
  await t.run(async (ctx: any) => {
    const campaignId = await ctx.db.insert("jellyhuntCampaigns", {
      publicId: "cam_atomic",
      slug: "atomic",
      title: "Atomic Campaign",
      status: "active",
      isCurrent: true,
      startsAt: NOW - 86_400_000,
      endsAt: NOW + 86_400_000,
      timeZone: "UTC",
      rewardToken: { code: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      map: {
        centerLatitude: 40.7,
        centerLongitude: -74,
        boundsSouth: 40,
        boundsWest: -75,
        boundsNorth: 41,
        boundsEast: -73,
        defaultZoom: 12,
      },
      links: {},
      catalogRevision: 1,
      leaderboardRevision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const placeId = await ctx.db.insert("jellyhuntPlaces", {
      publicId: "plc_atomic",
      jellyPlaceId: "jelly-place-1",
      name: "Atomic Pizza",
      address: "1 Test St",
      latitude: 40.7163,
      longitude: -73.9914,
      geofenceRadiusMeters: 75,
      timeZone: "America/New_York",
      reviewStatus: "reviewed",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId: "mis_atomic",
      campaignId,
      slug: "atomic-pizza",
      status: "active",
      approvalMode: "manual",
      currentRevision: 2,
      title: "Mutable title",
      category: "Food",
      difficulty: "easy",
      emoji: "pizza",
      neighborhood: "LES",
      price: "$",
      sortOrder: 1,
      placeId,
      reward: { amount: "99", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      acceptingSubmissions: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: "mrv_atomic_locked",
      missionId,
      revision: 1,
      title: "Locked title",
      description: "Locked terms",
      instructions: ["Post a Jelly"],
      requirements: {
        post: {
          allowedPostTypes: ["video"],
          authorshipPolicy: "canonical_owner",
          prompt: "Show the restaurant",
          requiredVisibility: "public",
        },
        place: { attachmentRequired: true },
        location: { required: true, trustedSource: "server" },
        schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
      },
      approvalMode: overrides.revisionApprovalMode ?? "automatic",
      reward: { amount: "0.000001", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      place: {
        placeId,
        jellyPlaceId: "jelly-place-1",
        name: "Atomic Pizza",
        address: "1 Test St",
        latitude: 40.7163,
        longitude: -73.9914,
        geofenceRadiusMeters: 75,
        timeZone: "America/New_York",
      },
      missionWindow: {},
      createdAt: NOW - 1000,
    });
    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: "mrv_atomic_current",
      missionId,
      revision: 2,
      title: "Mutable title",
      description: "New terms",
      instructions: ["Different"],
      requirements: {
        post: {
          allowedPostTypes: ["photo"],
          authorshipPolicy: "self",
          prompt: "Different",
          requiredVisibility: "public",
        },
        place: { attachmentRequired: true },
        location: { required: true, trustedSource: "server" },
        schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: false, maxAttempts: 1 },
      },
      approvalMode: "manual",
      reward: { amount: "99", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      place: {
        placeId,
        jellyPlaceId: "jelly-place-1",
        name: "Atomic Pizza",
        latitude: 40.7163,
        longitude: -73.9914,
        geofenceRadiusMeters: 75,
        timeZone: "America/New_York",
      },
      missionWindow: {},
      createdAt: NOW,
    });
    await ctx.db.insert("jellyhuntParticipations", {
      publicId: "par_atomic",
      jellyUserId: "jelly-user-1",
      missionId,
      campaignId,
      missionRevision: 1,
      status: "started",
      startedAt: NOW - 1000,
      submissionDeadlineAt: NOW + 86_400_000,
      attemptsUsed: 0,
      maxAttempts: 3,
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
    });
    for (const budget of [
      { scopeType: "campaign", scopeKey: "cam_atomic", amount: overrides.campaignBudget ?? "1" },
      { scopeType: "mission", scopeKey: "mis_atomic", amount: overrides.missionBudget ?? "1" },
    ]) {
      await ctx.db.insert("jellyhuntRewardBudgets", {
        scopeType: budget.scopeType,
        scopeKey: budget.scopeKey,
        campaignId,
        missionId: budget.scopeType === "mission" ? missionId : undefined,
        allocatedAmount: budget.amount,
        reservedAmount: "0",
        paidAmount: "0",
        releasedAmount: "0",
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
  });
}

function commitArgs(acquired: any, overrides: Record<string, unknown> = {}) {
  const submissionPublicId = acquired.submissionPublicId;
  const locationHeader = `/api/v2/jellyhunt/submissions/${submissionPublicId}`;
  return {
    serviceKey: TEST_SERVICE_KEY,
    recordId: acquired.recordId,
    jellySubjectId: "jelly-user-1",
    httpMethod: "POST",
    normalizedPath: PATH,
    requestHash: "request-hash-a",
    leaseOwner: acquired.leaseOwner,
    leaseGeneration: acquired.leaseGeneration,
    submissionPublicId,
    missionPublicId: "mis_atomic",
    participationPublicId: "par_atomic",
    missionRevision: 1,
    expectedAttempt: 1,
    jellyPostId: "jelly-post-1",
    preflight: {
      jellyPostId: "jelly-post-1",
      canonicalOwnerUserId: "jelly-user-1",
      ownershipStatus: "matched",
      checkedAt: NOW - 100,
    },
    clientLocation: {
      latitude: 40.7164,
      longitude: -73.9915,
      accuracyMeters: 12,
      capturedAt: NOW - 500,
    },
    responseStatus: 202,
    responseBodyJson: JSON.stringify({
      data: { id: submissionPublicId, attempt: 1 },
      meta: { requestId: "request-original" },
    }),
    responseHeadersJson: JSON.stringify({ "Cache-Control": "no-store", Location: locationHeader }),
    locationHeader,
    now: NOW,
    ...overrides,
  };
}

describe("atomic v2 submission intake", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("preallocates and durably binds an opaque submission ID behind a service-key boundary", async () => {
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());

    expect(acquired).toMatchObject({
      status: "acquired",
      leaseOwner: "next-worker-1",
      leaseGeneration: 1,
    });
    expect(acquired.submissionPublicId).toMatch(/^sub_/);

    const record = await t.run(async (ctx: any) => (await ctx.db.query("jellyhuntIdempotencyRecords").collect())[0]);
    expect(record.resourcePublicId).toBe(acquired.submissionPublicId);
    expect(record).not.toHaveProperty("idempotencyKey");

    await expect(
      t.mutation(submissions.prepareSubmissionIntake, prepareArgs({ serviceKey: "wrong-service-key" })),
    ).rejects.toThrow("unauthorized");
  });

  it("atomically snapshots locked terms, reserves exact capacity, emits history, and finalizes exact response bytes", async () => {
    await seedAtomicMission(t);
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());
    const args = commitArgs(acquired);

    expect(await t.mutation(submissions.commitSubmissionIntake, args)).toEqual({
      status: "completed",
      submissionPublicId: acquired.submissionPublicId,
      attempt: 1,
    });

    const state = await t.run(async (ctx: any) => ({
      submission: await ctx.db.query("jellyhuntSubmissions").withIndex("by_public_id", (q: any) => q.eq("publicId", acquired.submissionPublicId)).unique(),
      reservation: (await ctx.db.query("jellyhuntRewardReservations").collect())[0],
      budgets: await ctx.db.query("jellyhuntRewardBudgets").collect(),
      events: await ctx.db.query("jellyhuntSubmissionEvents").collect(),
      participation: await ctx.db.query("jellyhuntParticipations").withIndex("by_public_id", (q: any) => q.eq("publicId", "par_atomic")).unique(),
      record: await ctx.db.get(acquired.recordId),
    }));

    expect(state.submission).toMatchObject({
      missionRevision: 1,
      missionTitleSnapshot: "Locked title",
      approvalModeSnapshot: "automatic",
      rewardSnapshot: { amount: "0.000001" },
      claimedLatitude: 40.7164,
      claimedLongitude: -73.9915,
      claimedAccuracyMeters: 12,
      claimedCapturedAt: NOW - 500,
    });
    expect(state.reservation).toMatchObject({
      submissionId: state.submission._id,
      amount: "0.000001",
      status: "pending_verification",
    });
    expect(state.budgets).toHaveLength(2);
    expect(state.budgets.every((budget: any) => budget.reservedAmount === "0.000001")).toBe(true);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      submissionId: state.submission._id,
      type: "submission.created",
      submissionStatus: "submitted",
      rewardStatus: "not_eligible",
      displayStatus: "submitted",
    });
    expect(state.participation.attemptsUsed).toBe(1);
    expect(state.record).toMatchObject({
      state: "completed",
      resourceId: acquired.submissionPublicId,
      responseStatus: 202,
      responseBodyJson: args.responseBodyJson,
      responseHeadersJson: args.responseHeadersJson,
      locationHeader: args.locationHeader,
    });
  });

  it("replays the byte-identical accepted response and never creates a second submission", async () => {
    await seedAtomicMission(t);
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());
    const committed = commitArgs(acquired);
    await t.mutation(submissions.commitSubmissionIntake, committed);

    const replay = await t.mutation(
      submissions.prepareSubmissionIntake,
      prepareArgs({ originalRequestId: "request-retry", leaseOwner: "next-worker-2", now: NOW + 10 }),
    );

    expect(replay).toEqual({
      status: "replay",
      response: {
        status: 202,
        bodyJson: committed.responseBodyJson,
        headersJson: committed.responseHeadersJson,
        locationHeader: committed.locationHeader,
        resourceId: acquired.submissionPublicId,
        originalRequestId: "request-original",
      },
    });
    expect(await t.run(async (ctx: any) => (await ctx.db.query("jellyhuntSubmissions").collect()).length)).toBe(1);
  });

  it("rolls back every durable side effect when exact mission capacity is exhausted", async () => {
    await seedAtomicMission(t, { missionBudget: "0" });
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());

    await expect(t.mutation(submissions.commitSubmissionIntake, commitArgs(acquired))).rejects.toThrow("budget_not_allocated");

    const state = await t.run(async (ctx: any) => ({
      submissions: await ctx.db.query("jellyhuntSubmissions").collect(),
      reservations: await ctx.db.query("jellyhuntRewardReservations").collect(),
      events: await ctx.db.query("jellyhuntSubmissionEvents").collect(),
      budgets: await ctx.db.query("jellyhuntRewardBudgets").collect(),
      participation: await ctx.db.query("jellyhuntParticipations").withIndex("by_public_id", (q: any) => q.eq("publicId", "par_atomic")).unique(),
      record: await ctx.db.get(acquired.recordId),
    }));
    expect(state.submissions).toEqual([]);
    expect(state.reservations).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.budgets.every((budget: any) => budget.reservedAmount === "0")).toBe(true);
    expect(state.participation.attemptsUsed).toBe(0);
    expect(state.record.state).toBe("processing");
  });

  it.each([
    ["request hash", { requestHash: "wrong-hash" }, "idempotency_request_mismatch"],
    ["resource binding", { submissionPublicId: "sub_wrong" }, "idempotency_resource_mismatch"],
    ["expired lease", { now: NOW + 60_001 }, "idempotency_lease_expired"],
    ["attempt snapshot", { expectedAttempt: 2 }, "submission_attempt_changed"],
  ])("rejects a commit with an invalid %s without creating durable work", async (_label, overrides, error) => {
    await seedAtomicMission(t);
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());
    await expect(t.mutation(submissions.commitSubmissionIntake, commitArgs(acquired, overrides))).rejects.toThrow(error);
    expect(await t.run(async (ctx: any) => (await ctx.db.query("jellyhuntSubmissions").collect()).length)).toBe(0);
  });

  it.each([
    ["post", { preflight: { jellyPostId: "other-post", canonicalOwnerUserId: "jelly-user-1", ownershipStatus: "matched", checkedAt: NOW } }],
    ["owner", { preflight: { jellyPostId: "jelly-post-1", canonicalOwnerUserId: "other-user", ownershipStatus: "matched", checkedAt: NOW } }],
  ])("requires an exact matched preflight for the same %s", async (_label, overrides) => {
    await seedAtomicMission(t);
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());
    await expect(t.mutation(submissions.commitSubmissionIntake, commitArgs(acquired, overrides))).rejects.toThrow("jelly_post_not_eligible");
  });

  it("finalizes deterministic 4xx bytes but leaves 429 and 5xx outcomes reclaimable", async () => {
    const first = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());
    const identity = {
      serviceKey: TEST_SERVICE_KEY,
      recordId: first.recordId,
      jellySubjectId: "jelly-user-1",
      httpMethod: "POST",
      normalizedPath: PATH,
      requestHash: "request-hash-a",
      leaseOwner: first.leaseOwner,
      leaseGeneration: first.leaseGeneration,
      submissionPublicId: first.submissionPublicId,
      now: NOW + 1,
    };
    const body = '{"error":{"code":"submission_conflict"}}';
    expect(await t.mutation(submissions.finalizeSubmissionIntakeError, {
      ...identity,
      responseStatus: 409,
      responseBodyJson: body,
      responseHeadersJson: '{"Cache-Control":"no-store"}',
    })).toEqual({ status: "completed" });
    expect(await t.mutation(submissions.prepareSubmissionIntake, prepareArgs({ now: NOW + 2 }))).toMatchObject({
      status: "replay",
      response: { status: 409, bodyJson: body },
    });

    const transient = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs({
      idempotencyKey: "018f3f96-92db-7d3d-8c21-fd656cb50bbb",
      leaseOwner: "transient-worker",
    }));
    for (const responseStatus of [429, 503]) {
      await expect(t.mutation(submissions.finalizeSubmissionIntakeError, {
        ...identity,
        recordId: transient.recordId,
        leaseOwner: transient.leaseOwner,
        leaseGeneration: transient.leaseGeneration,
        submissionPublicId: transient.submissionPublicId,
        responseStatus,
        responseBodyJson: "{}",
      })).rejects.toThrow("transient_response_not_finalizable");
    }
    expect(await t.mutation(submissions.abandonSubmissionIntake, {
      ...identity,
      recordId: transient.recordId,
      leaseOwner: transient.leaseOwner,
      leaseGeneration: transient.leaseGeneration,
      submissionPublicId: transient.submissionPublicId,
    })).toEqual({ status: "abandoned" });
    const reclaimed = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs({
      idempotencyKey: "018f3f96-92db-7d3d-8c21-fd656cb50bbb",
      leaseOwner: "retry-worker",
      now: NOW + 2,
    }));
    expect(reclaimed).toMatchObject({
      status: "acquired",
      leaseGeneration: 2,
      submissionPublicId: transient.submissionPublicId,
    });
  });

  it("fails closed with recovery_required when a bound submission exists without exact response bytes", async () => {
    await seedAtomicMission(t);
    const acquired = await t.mutation(submissions.prepareSubmissionIntake, prepareArgs());
    await t.run(async (ctx: any) => {
      const campaign = await ctx.db.query("jellyhuntCampaigns").withIndex("by_public_id", (q: any) => q.eq("publicId", "cam_atomic")).unique();
      const mission = await ctx.db.query("jellyhuntMissions").withIndex("by_public_id", (q: any) => q.eq("publicId", "mis_atomic")).unique();
      const participation = await ctx.db.query("jellyhuntParticipations").withIndex("by_public_id", (q: any) => q.eq("publicId", "par_atomic")).unique();
      await ctx.db.insert("jellyhuntSubmissions", {
        publicId: acquired.submissionPublicId,
        campaignId: campaign._id,
        missionId: mission._id,
        participationId: participation._id,
        jellyUserId: "jelly-user-1",
        jellyPostId: "jelly-post-orphan",
        dedupeKey: "orphan:1",
        attempt: 1,
        source: "live",
        missionRevision: 1,
        submissionStatus: "submitted",
        rewardStatus: "not_eligible",
        missionTitleSnapshot: "Locked title",
        approvalModeSnapshot: "automatic",
        placeSnapshot: {
          placeId: mission.placeId,
          jellyPlaceId: "jelly-place-1",
          name: "Atomic Pizza",
          latitude: 40.7163,
          longitude: -73.9914,
          geofenceRadiusMeters: 75,
          timeZone: "America/New_York",
        },
        rewardSnapshot: { amount: "0.000001", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
        verificationStatus: "pending",
        verificationAttempts: 0,
        decisionStatus: "pending",
        submittedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    expect(await t.mutation(submissions.prepareSubmissionIntake, prepareArgs({
      leaseOwner: "recovery-worker",
      now: NOW + 60_001,
    }))).toEqual({ status: "recovery_required" });
  });
});
