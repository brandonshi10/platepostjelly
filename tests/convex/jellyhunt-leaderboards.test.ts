import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const approvals = anyApi.jellyhunt.approvals;
const leaderboards = anyApi.jellyhunt.leaderboards;

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
    address: "35 Orchard St",
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

  return { campaignPublicId, missionPublicId };
}

async function insertAndApprove(t: any, missionPublicId: string, jellyUserId: string) {
  const suffix = uniqueSuffix();
  const submissionPublicId = `sub_${suffix}`;

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
      source: "live",
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
    });
  });

  const result = await t.mutation(approvals.approveSubmission, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    submissionPublicId,
    approvalDecisionId: `decision_${suffix}`,
  });

  return { submissionPublicId, completionPublicId: result.completionPublicId };
}

describe("listLeaderboard", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns ranked entries for all_time scope", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);

    await insertAndApprove(t, missionPublicId, "alice");
    await insertAndApprove(t, missionPublicId, "bob");

    const page = await t.query(leaderboards.listLeaderboard, {
      scopeKey: "all_time",
      limit: 10,
    });

    expect(page.entries.length).toBe(2);
    expect(page.entries[0].rank).toBe(1);
    expect(page.entries[1].rank).toBe(2);
    expect(page.entries[0].approvedMissionCount).toBe(1);
  });

  it("returns empty for unknown scope", async () => {
    const page = await t.query(leaderboards.listLeaderboard, {
      scopeKey: "campaign:nonexistent",
      limit: 10,
    });

    expect(page.entries).toHaveLength(0);
    expect(page.hasMore).toBe(false);
  });

  it("excludes ineligible profiles", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);

    await insertAndApprove(t, missionPublicId, "visible_user");
    await insertAndApprove(t, missionPublicId, "hidden_user");

    await t.run(async (ctx: any) => {
      const entry = await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .filter((q: any) =>
          q.and(
            q.eq(q.field("scopeKey"), "all_time"),
            q.eq(q.field("jellyUserId"), "hidden_user"),
          ),
        )
        .unique();
      if (entry) {
        await ctx.db.patch(entry._id, { publicEligible: false });
      }
    });

    const page = await t.query(leaderboards.listLeaderboard, {
      scopeKey: "all_time",
      limit: 10,
    });

    expect(page.entries.length).toBe(1);
    expect(page.entries[0].username).toBe("visible_user");
  });

  it("paginates with hasMore and nextCursor", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);

    for (let i = 0; i < 3; i++) {
      await insertAndApprove(t, missionPublicId, `paginate_user_${i}`);
    }

    const page1 = await t.query(leaderboards.listLeaderboard, {
      scopeKey: "all_time",
      limit: 2,
    });

    expect(page1.entries.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
  });
});

describe("refreshProfileInLeaderboards", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("updates username across all scopes", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    await insertAndApprove(t, missionPublicId, "rename_user");

    await t.mutation(leaderboards.refreshProfileInLeaderboards, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "system",
      jellyUserId: "rename_user",
      normalizedUsername: "new_name",
      publicEligible: true,
    });

    const entries = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntLeaderboardEntries")
        .filter((q: any) => q.eq(q.field("jellyUserId"), "rename_user"))
        .collect();
    });

    for (const entry of entries) {
      expect(entry.normalizedUsername).toBe("new_name");
    }
  });
});
