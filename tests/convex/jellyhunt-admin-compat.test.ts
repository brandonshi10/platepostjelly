import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const campaigns = anyApi.jellyhunt.campaigns;
const admin = anyApi.jellyhunt.admin;
const NOW = Date.parse("2026-08-15T16:00:00Z");

function suffix() {
  return Math.random().toString(36).slice(2);
}

async function createCurrentCampaign(t: ReturnType<typeof createJellyhuntTestConvex>) {
  const id = await t.mutation(campaigns.createCampaign, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    slug: `human-social-${suffix()}`,
    title: "Human Social",
    status: "active",
    startsAt: Date.parse("2026-08-01T00:00:00Z"),
    endsAt: Date.parse("2026-09-01T00:00:00Z"),
    timeZone: "America/New_York",
    rewardTokenCode: "JELLY-MY-JELLY",
    rewardTokenDisplayName: "Jelly-My-Jelly",
    map: {
      centerLatitude: 40.72,
      centerLongitude: -73.99,
      boundsSouth: 40.7,
      boundsWest: -74.02,
      boundsNorth: 40.75,
      boundsEast: -73.96,
      defaultZoom: 13,
    },
    links: {},
  });
  await t.mutation(campaigns.selectCurrentCampaign, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    campaignPublicId: id,
  });
  return id;
}

function mission(overrides: Record<string, unknown> = {}) {
  return {
    slug: `scarrs-${suffix()}`,
    title: "Post at Scarr's Pizza",
    description: "Film a cheese pull and your first reaction.",
    status: "active",
    approvalMode: "manual",
    restaurantTag: "scarrs-pizza",
    rewardAmount: 60,
    category: "Pizza",
    difficulty: "easy",
    emoji: "🍕",
    neighborhood: "Lower East Side",
    price: "$",
    hours: [
      "11:00-23:00", "11:00-23:00", "11:00-23:00", "11:00-23:00",
      "11:00-23:59", "12:00-23:59", "closed",
    ],
    venueType: "restaurant",
    showtimes: [],
    sortOrder: 1,
    websiteUrl: "https://example.com/scarrs",
    startsAt: Date.parse("2026-08-01T00:00:00Z"),
    endsAt: Date.parse("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

function budgets(campaignRevision = 0, missionRevision = 0) {
  return {
    campaignAllocatedAmount: "600",
    missionAllocatedAmount: "600",
    expectedCampaignRevision: campaignRevision,
    expectedMissionRevision: missionRevision,
  };
}
function location(overrides: Record<string, unknown> = {}) {
  return {
    name: "Scarr's Pizza",
    address: "35 Orchard St, New York, NY",
    jellyRestaurantId: undefined,
    latitude: 40.7158,
    longitude: -73.9917,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
    ...overrides,
  };
}

describe("canonical JellyHunt admin compatibility boundary", () => {
  it("refuses to activate a mission without explicit campaign and mission capacity", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    await expect(
      t.mutation(admin.createMissionWithLocation, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin",
        mission: mission(),
        location: location(),
      }),
    ).rejects.toThrow("reward_budget_capacity_required");
  });

  beforeEach(() => vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("creates a reviewed place, mission, and immutable revision under the current campaign", async () => {
    const t = createJellyhuntTestConvex();
    const campaignPublicId = await createCurrentCampaign(t);

    const created = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      mission: mission(),
      location: location(),
      budgets: budgets(),
    });

    const state = await t.run(async (ctx) => {
      const canonicalMission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", created.missionId))
        .unique();
      const canonicalPlace = await ctx.db
        .query("jellyhuntPlaces")
        .withIndex("by_public_id", (q) => q.eq("publicId", created.locationId))
        .unique();
      const revision = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) =>
          q.eq("missionId", canonicalMission!._id).eq("revision", 1),
        )
        .unique();
      const campaign = await ctx.db.get(canonicalMission!.campaignId);
      return { canonicalMission, canonicalPlace, revision, campaign };
    });

    expect(state.campaign?.publicId).toBe(campaignPublicId);
    expect(state.canonicalPlace).toMatchObject({
      publicId: created.locationId,
      jellyPlaceId: "scarrs-pizza",
      reviewStatus: "reviewed",
    });
    expect(state.canonicalMission).toMatchObject({
      publicId: created.missionId,
      currentRevision: 1,
      status: "active",
      acceptingSubmissions: true,
    });
    expect(state.revision).toMatchObject({
      revision: 1,
      description: "Film a cheese pull and your first reaction.",
      legacyDisplay: { restaurantTag: "scarrs-pizza" },
    });
  });

  it("rejects stale budget revisions without publishing a partial mission revision", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);
    const originalMission = mission({ status: "draft" });
    const created = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      mission: originalMission,
      location: location(),
      budgets: budgets(),
    });

    await expect(
      t.mutation(admin.updateMissionWithLocation, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin",
        missionId: created.missionId,
        locationId: created.locationId,
        mission: { ...originalMission, title: "Must not publish" },
        location: location(),
        budgets: budgets(0, 1),
      }),
    ).rejects.toThrow("campaign_budget_revision_conflict");

    const state = await t.run(async (ctx) => {
      const canonicalMission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", created.missionId))
        .unique();
      const revisions = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission", (q) => q.eq("missionId", canonicalMission!._id))
        .collect();
      return { canonicalMission, revisions };
    });
    expect(state.canonicalMission).toMatchObject({ currentRevision: 1, title: originalMission.title });
    expect(state.revisions).toHaveLength(1);
  });

  it("projects the same canonical mission into admin and public v1 shapes", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);
    const created = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      mission: mission(),
      location: location(),
      budgets: budgets(),
    });

    const [adminRows, publicRows] = await Promise.all([
      t.query(admin.listAdminMissions, { serviceKey: TEST_SERVICE_KEY }),
      t.query(admin.listV1Missions, { now: NOW }),
    ]);

    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]).toMatchObject({
      _id: created.missionId,
      title: "Post at Scarr's Pizza",
      restaurantTag: "scarrs-pizza",
      location: { _id: created.locationId, name: "Scarr's Pizza" },
    });
    expect(adminRows[0].budgets).toMatchObject({
      campaign: { allocatedAmount: "600", remainingAmount: "600", revision: 1 },
      mission: { allocatedAmount: "600", remainingAmount: "600", revision: 1 },
      capacityStatus: "funded",
    });
    expect(publicRows.missions).toEqual([
      expect.objectContaining({ _id: created.missionId, title: "Post at Scarr's Pizza" }),
    ]);
    expect(publicRows.missions[0]).not.toHaveProperty("budgets");
  });

  it("publishes edits as a new revision without mutating the old revision or its place snapshot", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);
    const originalMission = mission();
    const created = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      mission: originalMission,
      location: location(),
      budgets: budgets(),
    });

    await t.mutation(admin.updateMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      missionId: created.missionId,
      locationId: created.locationId,
      mission: { ...originalMission, title: "A better cheese pull" },
      location: location({ name: "Scarr's Pizza — Orchard" }),
      budgets: budgets(1, 1),
    });

    const revisions = await t.run(async (ctx) => {
      const canonicalMission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", created.missionId))
        .unique();
      return await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission", (q) => q.eq("missionId", canonicalMission!._id))
        .collect();
    });

    expect(revisions.map((revision) => revision.title)).toEqual([
      "Post at Scarr's Pizza",
      "A better cheese pull",
    ]);
    expect(revisions[0].place.name).toBe("Scarr's Pizza");
    expect(revisions[1].place.name).toBe("Scarr's Pizza — Orchard");
  });

  it("changes map visibility on the canonical mission without deleting its revisions", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);
    const created = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      mission: mission(),
      location: location(),
      budgets: budgets(),
    });

    await t.mutation(admin.updateMissionStatus, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      missionId: created.missionId,
      status: "paused",
    });

    const publicRows = await t.query(admin.listV1Missions, { now: NOW });
    const state = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", created.missionId))
        .unique();
      const revisions = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission", (q) => q.eq("missionId", row!._id))
        .collect();
      return { row, revisions };
    });

    expect(publicRows.missions).toEqual([]);
    expect(state.row).toMatchObject({ status: "paused", acceptingSubmissions: false });
    expect(state.revisions).toHaveLength(1);
  });

  it("lists and safely rejects a canonical v2 submission with atomic budget release", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);
    const created = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      mission: mission(),
      location: location(),
      budgets: budgets(),
    });
    const submissionPublicId = `sub_${suffix()}`;

    await t.run(async (ctx) => {
      const missionRow = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", created.missionId))
        .unique();
      const revision = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) =>
          q.eq("missionId", missionRow!._id).eq("revision", 1),
        )
        .unique();
      const campaign = await ctx.db.get(missionRow!.campaignId);
      const now = Date.now();
      const participationId = await ctx.db.insert("jellyhuntParticipations", {
        publicId: `par_${suffix()}`,
        jellyUserId: "jelly-user-1",
        missionId: missionRow!._id,
        campaignId: campaign!._id,
        missionRevision: 1,
        status: "started",
        startedAt: now,
        submissionDeadlineAt: now + 86_400_000,
        attemptsUsed: 1,
        maxAttempts: 3,
        createdAt: now,
        updatedAt: now,
      });
      const submissionId = await ctx.db.insert("jellyhuntSubmissions", {
        publicId: submissionPublicId,
        campaignId: campaign!._id,
        missionId: missionRow!._id,
        participationId,
        jellyUserId: "jelly-user-1",
        jellyPostId: `post-${suffix()}`,
        dedupeKey: `dedupe-${suffix()}`,
        attempt: 1,
        source: "live",
        missionRevision: 1,
        submissionStatus: "needs_review",
        rewardStatus: "not_eligible",
        missionTitleSnapshot: revision!.title,
        approvalModeSnapshot: "manual",
        placeSnapshot: revision!.place,
        rewardSnapshot: revision!.reward,
        verificationStatus: "complete",
        verificationAttempts: 1,
        decisionStatus: "pending",
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("jellyhuntRewardReservations", {
        submissionId,
        campaignId: campaign!._id,
        missionId: missionRow!._id,
        jellyUserId: "jelly-user-1",
        amount: "60",
        token: "JELLY-MY-JELLY",
        status: "pending_verification",
        createdAt: now,
        updatedAt: now,
      });
      const rewardBudgets = await ctx.db.query("jellyhuntRewardBudgets").collect();
      for (const budget of rewardBudgets) {
        await ctx.db.patch(budget._id, {
          reservedAmount: "60",
          revision: budget.revision + 1,
          updatedAt: now,
        });
      }
    });

    const queue = await t.query(admin.listAdminSubmissions, {
      serviceKey: TEST_SERVICE_KEY,
      status: "needs_review",
    });
    expect(queue[0]).toMatchObject({
      _id: submissionPublicId,
      status: "needs_review",
      restaurantTagSnapshot: "scarrs-pizza",
      rewardAmountSnapshot: 60,
    });

    await t.mutation(admin.rejectSubmission, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      submissionPublicId,
      reason: "The post did not show the required dish.",
    });

    const state = await t.run(async (ctx) => {
      const submission = await ctx.db
        .query("jellyhuntSubmissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", submissionPublicId))
        .unique();
      const reservation = await ctx.db
        .query("jellyhuntRewardReservations")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission!._id))
        .unique();
      const budgets = await ctx.db.query("jellyhuntRewardBudgets").collect();
      return { submission, reservation, budgets };
    });

    expect(state.submission).toMatchObject({
      submissionStatus: "rejected",
      decisionStatus: "rejected",
      rejectionReason:
        "This submission did not meet the mission requirements. You can submit another eligible Jelly post.",
      publicMessage:
        "This submission did not meet the mission requirements. You can submit another eligible Jelly post.",
    });
    expect(state.reservation?.status).toBe("released");
    expect(state.budgets).toHaveLength(2);
    expect(state.budgets.every((budget) => budget.reservedAmount === "0")).toBe(true);
    expect(state.budgets.every((budget) => budget.releasedAmount === "60")).toBe(true);
  });});