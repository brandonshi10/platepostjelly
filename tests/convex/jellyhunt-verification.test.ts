import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";
import { buildLegacyJellyPath, haversineDistance } from "../../convex/jellyhunt/verification";

const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const verification = anyApi.jellyhunt.verification;

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

async function seedSubmission(t: any, approvalMode: "manual" | "automatic" = "manual") {
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
    approvalMode,
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

  const submissionInternalId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("jellyhuntSubmissions", {
      publicId: submissionPublicId, campaignId: missionRow.campaignId, missionId: missionRow._id,
      participationId, jellyUserId, jellyPostId: `post_${suffix}`,
      dedupeKey: `${jellyUserId}:${missionRow._id}:1`, attempt: 1, source: "live", missionRevision: 1,
      submissionStatus: "needs_review", rewardStatus: "not_eligible",
      missionTitleSnapshot: "Test", approvalModeSnapshot: approvalMode,
      placeSnapshot: { placeId: missionRow.placeId, jellyPlaceId: "jpl_test", name: "Test", latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75, timeZone: "America/New_York" },
      rewardSnapshot: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      verificationStatus: "pending", verificationAttempts: 0, decisionStatus: "pending",
      submittedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    });
  });

  return { submissionInternalId, submissionPublicId, jellyUserId };
}

describe("legacy Jelly request paths", () => {
  it("encodes opaque post IDs as one path segment", () => {
    expect(buildLegacyJellyPath("  post/a?b#c  ")).toBe("/v3/jelly/post%2Fa%3Fb%23c");
  });
});
describe("haversineDistance", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("returns expected meters for known coordinates within 1% tolerance", () => {
    // Times Square (40.7580, -73.9855) to Empire State Building (40.7484, -73.9857)
    // known distance ~1067 meters
    const distance = haversineDistance(40.758, -73.9855, 40.7484, -73.9857);
    expect(distance).toBeGreaterThan(1067 * 0.99);
    expect(distance).toBeLessThan(1067 * 1.01);
  });
});

describe("recordVerificationResult", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets complete status on successful verification", async () => {
    const { submissionInternalId } = await seedSubmission(t);
    const now = Date.now();

    await t.mutation(verification.recordVerificationResult, {
      submissionInternalId,
      verificationStatus: "complete",
      verifiedLatitude: 40.7163,
      verifiedLongitude: -73.9914,
      distanceMeters: 5,
      verificationSummary: "verified",
      now,
    });

    const submission = await t.run(async (ctx: any) => ctx.db.get(submissionInternalId));
    expect(submission.verificationStatus).toBe("complete");
    expect(submission.verificationSummary).toBe("verified");
    expect(submission.verificationCompletedAt).toBe(now);
  });

  it("increments verificationAttempts", async () => {
    const { submissionInternalId } = await seedSubmission(t);

    await t.mutation(verification.recordVerificationResult, {
      submissionInternalId,
      verificationStatus: "in_progress",
      now: Date.now(),
    });
    let submission = await t.run(async (ctx: any) => ctx.db.get(submissionInternalId));
    expect(submission.verificationAttempts).toBe(1);

    await t.mutation(verification.recordVerificationResult, {
      submissionInternalId,
      verificationStatus: "complete",
      now: Date.now(),
    });
    submission = await t.run(async (ctx: any) => ctx.db.get(submissionInternalId));
    expect(submission.verificationAttempts).toBe(2);
  });

  it("sets decisionStatus to approved in automatic mode when verification passes", async () => {
    const { submissionInternalId } = await seedSubmission(t, "automatic");

    await t.mutation(verification.recordVerificationResult, {
      submissionInternalId,
      verificationStatus: "complete",
      verifiedLatitude: 40.7163,
      verifiedLongitude: -73.9914,
      distanceMeters: 5,
      verificationSummary: "verified",
      decisionStatus: "approved",
      now: Date.now(),
    });

    const submission = await t.run(async (ctx: any) => ctx.db.get(submissionInternalId));
    expect(submission.decisionStatus).toBe("approved");
  });
});
