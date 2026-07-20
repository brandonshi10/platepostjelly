import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const ownerReads = anyApi.jellyhunt.ownerReads;
const OWNER = "OpaqueOwner_01";
const OTHER = "OpaqueOwner_02";
const NOW = Date.parse("2026-08-05T19:00:01Z");

async function seed(t: ReturnType<typeof createJellyhuntTestConvex>) {
  await t.run(async (ctx) => {
    const placeId = await ctx.db.insert("jellyhuntPlaces", {
      publicId: "plc_owner01", jellyPlaceId: "jpl_owner01", name: "Scarr's Pizza",
      address: "35 Orchard St", latitude: 40.7163, longitude: -73.9914,
      geofenceRadiusMeters: 75, timeZone: "America/New_York", reviewStatus: "reviewed",
      createdAt: 1, updatedAt: 2,
    });
    const campaignId = await ctx.db.insert("jellyhuntCampaigns", {
      publicId: "cam_owner01", slug: "owner-season", title: "JellyHunt NYC",
      status: "active", isCurrent: true, startsAt: Date.parse("2026-08-01T00:00:00Z"),
      endsAt: Date.parse("2026-09-01T00:00:00Z"), timeZone: "America/New_York",
      rewardToken: { code: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      map: { centerLatitude: 40.72, centerLongitude: -73.99, boundsSouth: 40.7,
        boundsWest: -74, boundsNorth: 40.74, boundsEast: -73.97, defaultZoom: 13 },
      links: {}, catalogRevision: 2, leaderboardRevision: 1, createdAt: 1, updatedAt: 10,
    });
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId: "mis_owner01", campaignId, slug: "cheese-pull", status: "active",
      approvalMode: "manual", currentRevision: 2, title: "Current title", category: "Pizza",
      difficulty: "easy", emoji: "pizza", neighborhood: "Lower East Side", price: "$", sortOrder: 1,
      placeId, reward: { amount: "75", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      acceptingSubmissions: true, createdAt: 1, updatedAt: 20,
    });
    const requirements = {
      post: { allowedPostTypes: ["video"], authorshipPolicy: "canonical_owner", prompt: "Film it",
        minDurationSeconds: 5, maxDurationSeconds: 90, requiredVisibility: "public" },
      place: { attachmentRequired: true },
      location: { required: true, trustedSource: "jelly_post" },
      schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
      resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
    };
    const place = { placeId, jellyPlaceId: "jpl_owner01", name: "Scarr's Pizza",
      address: "35 Orchard St", latitude: 40.7163, longitude: -73.9914,
      geofenceRadiusMeters: 75, timeZone: "America/New_York" };
    for (const revision of [1, 2]) await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: `mrv_owner0${revision}`, missionId, revision,
      title: revision === 1 ? "Locked title" : "Current title",
      description: revision === 1 ? "Locked description" : "Current description",
      instructions: [revision === 1 ? "Locked instruction" : "Current instruction"],
      requirements, approvalMode: "manual",
      reward: { amount: revision === 1 ? "60" : "75", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      place, missionWindow: { startsAt: Date.parse("2026-08-01T16:00:00Z"),
        endsAt: Date.parse("2026-08-31T23:00:00Z") }, createdAt: revision,
    });
    const participationId = await ctx.db.insert("jellyhuntParticipations", {
      publicId: "par_owner01", jellyUserId: OWNER, missionId, campaignId, missionRevision: 1,
      status: "started", startedAt: NOW - 60_000, submissionDeadlineAt: NOW + 86_400_000,
      attemptsUsed: 1, maxAttempts: 3, createdAt: NOW - 60_000, updatedAt: NOW - 1_000,
    });
    const submissionId = await ctx.db.insert("jellyhuntSubmissions", {
      publicId: "sub_owner01", campaignId, missionId, participationId, jellyUserId: OWNER,
      jellyPostId: "post_owner01", dedupeKey: "owner:attempt:1", attempt: 1, source: "live",
      missionRevision: 1, submissionStatus: "needs_review", rewardStatus: "not_eligible",
      missionTitleSnapshot: "Locked title", approvalModeSnapshot: "manual", placeSnapshot: place,
      rewardSnapshot: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      verificationStatus: "complete", verificationAttempts: 1, verificationCompletedAt: NOW - 1_500,
      decisionStatus: "pending", reasonCode: "manual_review_required",
      publicMessage: "Your Jelly is waiting for review.", submittedAt: NOW - 2_000,
      createdAt: NOW - 2_000, updatedAt: NOW - 1_000,
    });
    for (const [sequence, type, submissionStatus, occurredAt] of [
      [1, "submission.created", "submitted", NOW - 2_000],
      [2, "verification.started", "verifying", NOW - 1_800],
      [3, "verification.needs_review", "needs_review", NOW - 1_500],
    ] as const) await ctx.db.insert("jellyhuntSubmissionEvents", {
      publicId: `evt_owner0${sequence}`, submissionId, jellyUserId: OWNER, sequence, type,
      submissionStatus, rewardStatus: "not_eligible",
      displayStatus: submissionStatus === "submitted" ? "submitted" : "under_review",
      reasonCode: sequence === 3 ? "manual_review_required" : undefined,
      publicMessage: sequence === 3 ? "Your Jelly is waiting for review." : undefined,
      internalMetadataJson: JSON.stringify({ operator: "must-not-leak" }), occurredAt,
    });
  });
}
function eventSequences(events: unknown): number[] {
  return (events as Array<{ sequence: number }>).map((event) => event.sequence);
}


describe("JellyHunt v2 owner projections", () => {
  beforeEach(() => vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("returns immutable participation terms and current controls only to its owner", async () => {
    const t = createJellyhuntTestConvex(); await seed(t);
    const owned = await t.query(ownerReads.getOwnerParticipation, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, participationPublicId: "par_owner01", now: NOW,
    });
    const foreign = await t.query(ownerReads.getOwnerParticipation, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OTHER, participationPublicId: "par_owner01", now: NOW,
    });
    expect(foreign).toBeNull();
    expect(owned).toMatchObject({
      id: "par_owner01", missionId: "mis_owner01", missionRevision: 1,
      isCurrentMissionRevision: false,
      status: "started", startedAt: NOW - 60_000,
      submissionDeadlineAt: NOW + 86_400_000, resubmissionDeadlineAt: null,
      attemptsUsed: 1, maxAttempts: 3,
      terms: {
        title: "Locked title", description: "Locked description",
        instructions: ["Locked instruction"],
        missionWindow: {
          startsAt: Date.parse("2026-08-01T16:00:00Z"),
          endsAt: Date.parse("2026-08-31T23:00:00Z"),
        },
        reward: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
        place: {
          id: "plc_owner01", jellyPlaceId: "jpl_owner01", name: "Scarr's Pizza",
          address: "35 Orchard St", latitude: 40.7163, longitude: -73.9914,
          timeZone: "America/New_York",
        },
      },
      currentControls: { acceptingSubmissions: true, reasonCode: null },
      latestSubmissionId: "sub_owner01", canStart: false, canSubmit: false,
      canResubmit: false, nextAction: "wait_for_review",
      publicMessage: "Your Jelly is waiting for review.", updatedAt: NOW - 1_000,
    });
    expect(JSON.stringify(owned)).not.toMatch(/geofenceRadiusMeters|verifiedLatitude|must-not-leak|OpaqueOwner/);
  });

  it("returns separated safe submission state and newest twenty timeline events ascending", async () => {
    const t = createJellyhuntTestConvex(); await seed(t);
    const detail = await t.query(ownerReads.getOwnerSubmission, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, submissionPublicId: "sub_owner01", now: NOW,
    });
    expect(detail).toMatchObject({
      id: "sub_owner01", attempt: 1, submissionStatus: "needs_review",
      mission: { id: "mis_owner01", revision: 1, title: "Locked title" },
      jellyPost: { id: "post_owner01", watchUrl: "https://jellyjelly.com/watch/post_owner01" },
      verification: {
        status: "complete", attempts: 1, reasonCode: "manual_review_required",
        checkedAt: NOW - 1_500,
      },
      decision: { status: "pending", reasonCode: null, message: null, decidedAt: null },
      reward: {
        id: null, status: "not_eligible", amount: "60", token: "JELLY-MY-JELLY",
        transactionId: null, sentAt: null,
      },
      displayStatus: "under_review", reasonCode: "manual_review_required",
      publicMessage: "Your Jelly is waiting for review.", canResubmit: false,
      nextAction: "wait_for_review", submittedAt: NOW - 2_000, updatedAt: NOW - 1_000,
    });
    expect(eventSequences(detail.timeline)).toEqual([1, 2, 3]);
    expect(detail.timeline[2]).toMatchObject({
      submissionStatus: "needs_review", rewardStatus: "not_eligible",
      displayStatus: "under_review", reasonCode: "manual_review_required",
    });
    expect(JSON.stringify(detail)).not.toMatch(/internalMetadata|operator|verifiedLatitude|verifiedLongitude|OpaqueOwner/);
  });

  it("allows a rejected owner to resubmit without a separate resubmission expiry", async () => {
    const t = createJellyhuntTestConvex(); await seed(t);
    await t.run(async (ctx) => {
      const submission = await ctx.db.query("jellyhuntSubmissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", "sub_owner01"))
        .unique();
      if (!submission) throw new Error("submission_not_found");
      await ctx.db.patch(submission._id, {
        submissionStatus: "rejected",
        decisionStatus: "rejected",
        reasonCode: "wrong_place",
        publicMessage: "This Jelly did not meet the mission requirements.",
        decidedAt: NOW,
        updatedAt: NOW,
      });
    });

    const participation = await t.query(ownerReads.getOwnerParticipation, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, participationPublicId: "par_owner01", now: NOW,
    });
    const submission = await t.query(ownerReads.getOwnerSubmission, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, submissionPublicId: "sub_owner01", now: NOW,
    });

    expect(participation).toMatchObject({
      resubmissionDeadlineAt: null,
      attemptsUsed: 1,
      maxAttempts: 3,
      canResubmit: true,
      nextAction: "submit_new_post",
    });
    expect(submission).toMatchObject({
      submissionStatus: "rejected",
      canResubmit: true,
      nextAction: "submit_new_post",
    });
  });

  it("paginates submission events DESC and user events ASC without owner enumeration", async () => {
    const t = createJellyhuntTestConvex(); await seed(t);
    const submissionPage = await t.query(ownerReads.listOwnerSubmissionEvents, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, submissionPublicId: "sub_owner01", limit: 2,
    });
    const userPage = await t.query(ownerReads.listOwnerEvents, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, afterSequence: 1, limit: 1,
    });
    const foreign = await t.query(ownerReads.listOwnerSubmissionEvents, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OTHER, submissionPublicId: "sub_owner01", limit: 2,
    });
    expect(foreign).toBeNull();
    expect(eventSequences(submissionPage.events)).toEqual([3, 2]);
    expect(submissionPage.events[0]).toMatchObject({
      submissionStatus: "needs_review", rewardStatus: "not_eligible",
      displayStatus: "under_review", reasonCode: "manual_review_required",
    });
    expect(submissionPage).toMatchObject({
      hasMore: true, asOfSequence: 3, nextBeforeSequence: 2,
    });
    const olderSubmissionPage = await t.query(ownerReads.listOwnerSubmissionEvents, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, submissionPublicId: "sub_owner01",
      limit: 2, asOfSequence: submissionPage.asOfSequence,
      beforeSequence: submissionPage.nextBeforeSequence,
    });
    expect(eventSequences(olderSubmissionPage.events)).toEqual([1]);
    expect(olderSubmissionPage).toMatchObject({
      hasMore: false, asOfSequence: 3, nextBeforeSequence: null,
    });

    expect(eventSequences(userPage.events)).toEqual([2]);
    expect(userPage.events[0]).toMatchObject({
      id: "evt_owner02", type: "jellyhunt.submission.status_changed",
      entity: { type: "submission", id: "sub_owner01", sequence: 2 },
      changes: {
        participationStatus: "started", submissionStatus: "verifying",
        rewardStatus: "not_eligible", displayStatus: "under_review",
        reasonCode: null,
      },
      submissionId: "sub_owner01",
    });
    expect(userPage).toMatchObject({ hasMore: true, nextAfterSequence: 2 });
    const nextUserPage = await t.query(ownerReads.listOwnerEvents, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER,
      afterSequence: userPage.nextAfterSequence, limit: 1,
    });
    expect(eventSequences(nextUserPage.events)).toEqual([3]);
    expect(nextUserPage).toMatchObject({ hasMore: false, nextAfterSequence: 3 });
    expect(JSON.stringify(userPage)).not.toMatch(/internalMetadata|operator|OpaqueOwner/);
  });

  it("returns deterministic mission/submission history and current campaign summary", async () => {
    const t = createJellyhuntTestConvex(); await seed(t);
    const summary = await t.query(ownerReads.getOwnerSummary, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, campaignPublicId: "cam_owner01", now: NOW,
    });
    const missions = await t.query(ownerReads.listOwnerMissions, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, campaignPublicId: "cam_owner01",
      limit: 20, now: NOW, asOf: NOW,
    });
    const submissions = await t.query(ownerReads.listOwnerSubmissions, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, campaignPublicId: "cam_owner01",
      limit: 20, asOf: NOW,
    });
    expect(summary).toEqual({ subject: { jellyUserId: OWNER }, campaign: {
      id: "cam_owner01", status: "active",
      statusCounts: {
        notStarted: 0, inProgress: 0, submitted: 0, underReview: 1,
        approvedRewardPending: 0, rewarded: 0, rejected: 0, supportNeeded: 0,
      },
      confirmedRewards: { amount: "0", token: "JELLY-MY-JELLY" },
      latestEventSequence: 3, updatedAt: NOW - 1_000,
    } });
    expect(missions.items[0]).toMatchObject({
      mission: {
        id: "mis_owner01", revision: 2, title: "Current title",
        availability: { state: "available", acceptingSubmissions: true, reasonCode: null },
        reward: { amount: "75", token: "JELLY-MY-JELLY" },
        display: { category: "Pizza", difficulty: "easy", neighborhood: "Lower East Side" },
        place: { id: "plc_owner01", name: "Scarr's Pizza" },
      },
      participationStatus: "started",
      participation: {
        id: "par_owner01", missionRevision: 1, startedAt: NOW - 60_000,
        submissionDeadlineAt: NOW + 86_400_000, resubmissionDeadlineAt: null,
      },
      latestSubmission: {
        id: "sub_owner01", attempt: 1, submissionStatus: "needs_review",
        rewardStatus: "not_eligible", displayStatus: "under_review", updatedAt: NOW - 1_000,
      },
      canStart: false, canSubmit: false, canResubmit: false,
      nextAction: "wait_for_review", reasonCode: "manual_review_required",
      publicMessage: "Your Jelly is waiting for review.", updatedAt: NOW - 1_000,
    });
    expect(missions).toMatchObject({
      hasMore: false, asOf: NOW, nextUpdatedAt: null, nextMissionPublicId: null,
    });
    expect(submissions.items[0]).toMatchObject({
      id: "sub_owner01", source: "native", participationId: "par_owner01",
      mission: { id: "mis_owner01", revision: 1, title: "Locked title" },
      jellyPost: { id: "post_owner01", watchUrl: "https://jellyjelly.com/watch/post_owner01" },
      submissionStatus: "needs_review",
      reward: {
        id: null, status: "not_eligible", amount: "60", token: "JELLY-MY-JELLY",
        transactionId: null, sentAt: null,
      },
      displayStatus: "under_review", reasonCode: "manual_review_required",
      publicMessage: "Your Jelly is waiting for review.", canResubmit: false,
      nextAction: "wait_for_review", submittedAt: NOW - 2_000, updatedAt: NOW - 1_000,
    });
    expect(submissions).toMatchObject({
      hasMore: false, asOf: NOW, nextUpdatedAt: null, nextSubmissionPublicId: null,
    });

    const resumedMissions = await t.query(ownerReads.listOwnerMissions, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, campaignPublicId: "cam_owner01",
      limit: 20, now: NOW, asOf: NOW,
      beforeUpdatedAt: NOW - 1_000, beforeMissionPublicId: "mis_owner01",
    });
    const staleSnapshotSubmissions = await t.query(ownerReads.listOwnerSubmissions, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId: OWNER, campaignPublicId: "cam_owner01",
      limit: 20, asOf: NOW - 1_500,
    });
    expect(resumedMissions.items).toEqual([]);
    expect(staleSnapshotSubmissions.items).toEqual([]);
    expect(JSON.stringify({ summary, missions, submissions })).not.toMatch(
      /"_id"|"_creationTime"|geofenceRadiusMeters|internalMetadata|verifiedLatitude|verifiedLongitude|rawError/,
    );
  });
});
