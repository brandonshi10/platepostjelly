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
    const submissionId = await ctx.db.insert("jellyhuntSubmissions", {
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
    await ctx.db.insert("jellyhuntRewardReservations", {
      submissionId,
      campaignId: missionRow.campaignId,
      missionId: missionRow._id,
      jellyUserId,
      amount: "60",
      token: "JELLY-MY-JELLY",
      status: "pending_verification",
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

async function seedProgramConfig(t: any, leaderboardRevision = 0) {
  await t.run(async (ctx: any) => {
    const now = Date.now();
    await ctx.db.insert("jellyhuntProgramConfig", {
      publicId: `cfg_${uniqueSuffix()}`,
      singletonKey: "default",
      leaderboardLaunchEpoch: Date.parse("2026-07-01T00:00:00Z"),
      leaderboardRevision,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedPublicProfile(
  t: any,
  jellyUserId: string,
  username: string,
  publicEligible = true,
) {
  await t.run(async (ctx: any) => {
    const now = Date.now();
    await ctx.db.insert("jellyhuntPublicProfiles", {
      jellyUserId,
      username,
      normalizedUsername: username.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
      accountState: publicEligible ? "active" : "moderated",
      publicEligible,
      refreshedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function seedLeaderboardEntry(
  t: any,
  scopeKey: string,
  jellyUserId: string,
  username: string,
  approvedMissionCount: number,
) {
  await seedPublicProfile(t, jellyUserId, username);
  await t.run(async (ctx: any) => {
    const now = Date.now();
    await ctx.db.insert("jellyhuntLeaderboardEntries", {
      publicId: `lbe_${uniqueSuffix()}`,
      scopeKey,
      jellyUserId,
      approvedMissionCount,
      rankSortScore: -approvedMissionCount,
      normalizedUsername: username.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
      scoreReachedAt: now,
      publicEligible: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("listLeaderboard", () => {
  let t: any;

  beforeEach(async () => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
    await seedProgramConfig(t);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects direct Convex reads without the server service key", async () => {
    await expect(
      t.query(leaderboards.listLeaderboard, { scopeKey: "all_time", limit: 10 }),
    ).rejects.toThrow(/serviceKey|unauthorized_service_key/);
  });

  it("returns canonical usernames with shared competition ranks and no identifiers", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);

    await seedPublicProfile(t, "alice", "Alice.Jelly");
    await seedPublicProfile(t, "bob", "BobJelly");
    await insertAndApprove(t, missionPublicId, "alice");
    await insertAndApprove(t, missionPublicId, "bob");

    const page = await t.query(leaderboards.listLeaderboard, {
      serviceKey: TEST_SERVICE_KEY,
      scopeKey: "all_time",
      limit: 10,
    });

    expect(page.standings).toEqual([
      { rank: 1, username: "Alice.Jelly", approvedMissionCount: 1 },
      { rank: 1, username: "BobJelly", approvedMissionCount: 1 },
    ]);
    expect(page.standings[0]).not.toHaveProperty("jellyUserId");
    expect(page.standings[0]).not.toHaveProperty("publicId");
  });

  it("uses the public campaign id for the campaign scope", async () => {
    const { campaignPublicId, missionPublicId } = await seedCampaignAndMission(t);
    await seedPublicProfile(t, "public_scope_user", "scope-user");
    await insertAndApprove(t, missionPublicId, "public_scope_user");

    const scopeKeys = await t.run(async (ctx: any) =>
      (await ctx.db.query("jellyhuntLeaderboardEntries").collect()).map((entry: any) => entry.scopeKey),
    );

    expect(scopeKeys).toContain(`campaign:${campaignPublicId}`);
    expect(scopeKeys.filter((scopeKey: string) => scopeKey.startsWith("campaign:"))).toEqual([
      `campaign:${campaignPublicId}`,
    ]);
  });

  it("withholds entries without an eligible canonical username instead of inventing a fallback", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);

    await seedPublicProfile(t, "visible_user", "VisibleUser");
    await insertAndApprove(t, missionPublicId, "visible_user");
    await insertAndApprove(t, missionPublicId, "hidden_user");

    const page = await t.query(leaderboards.listLeaderboard, {
      serviceKey: TEST_SERVICE_KEY,
      scopeKey: "all_time",
      limit: 10,
    });

    expect(page.standings).toEqual([
      { rank: 1, username: "VisibleUser", approvedMissionCount: 1 },
    ]);
  });

  it("continues competition ranks across a page boundary without skipping tied users", async () => {
    await seedLeaderboardEntry(t, "all_time", "u_zed", "zed", 3);
    await seedLeaderboardEntry(t, "all_time", "u_amy", "Amy", 3);
    await seedLeaderboardEntry(t, "all_time", "u_ben", "Ben", 2);
    await seedLeaderboardEntry(t, "all_time", "u_cia", "Cia", 2);
    await seedLeaderboardEntry(t, "all_time", "u_dee", "Dee", 1);

    const page1 = await t.query(leaderboards.listLeaderboard, {
      serviceKey: TEST_SERVICE_KEY,
      scopeKey: "all_time",
      limit: 3,
    });

    expect(page1.standings).toEqual([
      { rank: 1, username: "Amy", approvedMissionCount: 3 },
      { rank: 1, username: "zed", approvedMissionCount: 3 },
      { rank: 3, username: "Ben", approvedMissionCount: 2 },
    ]);
    expect(page1.hasMore).toBe(true);
    expect(page1.cursorState).toEqual({
      eligibleItemsSeen: 3,
      lastRank: 3,
      lastScore: 2,
      lastUsername: "ben",
      lastPublicId: expect.stringMatching(/^lbe_/),
    });

    const page2 = await t.query(leaderboards.listLeaderboard, {
      serviceKey: TEST_SERVICE_KEY,
      scopeKey: "all_time",
      limit: 3,
      resume: page1.cursorState,
    });

    expect(page2.standings).toEqual([
      { rank: 3, username: "Cia", approvedMissionCount: 2 },
      { rank: 5, username: "Dee", approvedMissionCount: 1 },
    ]);
    expect(page2.hasMore).toBe(false);
    expect(page2.cursorState).toBeNull();
  });
});

describe("refreshProfileInLeaderboards", () => {
  let t: any;

  beforeEach(async () => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
    await seedProgramConfig(t);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("updates username across all scopes", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    await seedPublicProfile(t, "rename_user", "Old Name");
    await insertAndApprove(t, missionPublicId, "rename_user");

    await t.run(async (ctx: any) => {
      const config = await ctx.db
        .query("jellyhuntProgramConfig")
        .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
        .unique();
      await ctx.db.patch(config._id, { leaderboardRevision: 10 });
    });

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

    const revisions = await t.run(async (ctx: any) => {
      const config = await ctx.db
        .query("jellyhuntProgramConfig")
        .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
        .unique();
      const campaign = await ctx.db
        .query("jellyhuntCampaigns")
        .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true))
        .unique();
      return { allTime: config.leaderboardRevision, campaign: campaign.leaderboardRevision };
    });
    expect(revisions).toEqual({ allTime: 11, campaign: 2 });
  });
});
