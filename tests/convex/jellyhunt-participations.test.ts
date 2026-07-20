import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

// See the comment in tests/convex/jellyhunt-campaigns.test.ts: `anyApi` is
// used deliberately instead of the real generated `api` object so this
// file's TypeScript program never transitively type-checks the broken
// pre-namespacing `convex/audit.ts` / `missions.ts` / `submissions.ts`
// files that `convex/_generated/api.d.ts` type-references.
const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const participations = anyApi.jellyhunt.participations;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

function campaignArgs(overrides: Partial<Record<string, unknown>> = {}) {
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

function placeArgs(overrides: Partial<Record<string, unknown>> = {}) {
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

function missionArgs(campaignPublicId: string, placePublicId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
    placePublicId,
    slug: `scarrs-cheese-pull-${suffix}`,
    title: "The Scarr's Cheese Pull",
    category: "Pizza",
    difficulty: "easy" as const,
    emoji: "🍕",
    neighborhood: "Lower East Side",
    price: "$",
    sortOrder: 1,
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    approvalMode: "manual" as const,
    ...overrides,
  };
}

function publishContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "The Scarr's Cheese Pull",
    description: "Order one slice and film the cheese pull.",
    instructions: ["Visit the venue during the mission window.", "Record and publish the requested Jelly."],
    requirements: {
      post: {
        allowedPostTypes: ["video"],
        authorshipPolicy: "canonical_owner",
        prompt: "Film the cheese pull and your first reaction.",
        requiredVisibility: "public",
      },
      place: { attachmentRequired: true },
      location: { required: true, trustedSource: "jelly_post" },
      schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
      resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
    },
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    missionWindow: {
      startsAt: Date.parse("2026-08-01T16:00:00Z"),
      endsAt: Date.parse("2026-08-31T23:00:00Z"),
    },
    ...overrides,
  };
}

/** Build campaign + reviewed place + published (active) mission fixtures. */
async function setupActiveMission(t: ReturnType<typeof createJellyhuntTestConvex>) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  await t.mutation(places.setPlaceReviewStatus, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    placePublicId,
    reviewStatus: "reviewed",
  });
  const missionPublicId = await t.mutation(missions.createDraftMission, missionArgs(campaignPublicId, placePublicId));
  await t.mutation(missions.publishMissionRevision, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    missionPublicId,
    expectedDraftRevision: 0,
    content: publishContent(),
  });
  return { campaignPublicId, placePublicId, missionPublicId };
}

describe("JellyHunt participation start", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts a participation for an active mission with the expected fields", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const jellyUserId = `user_${uniqueSuffix()}`;
    const now = Date.parse("2026-08-05T12:00:00Z");

    const result = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId,
      missionPublicId,
      expectedMissionRevision: 1,
      now,
    });

    expect(result.created).toBe(true);
    expect(result.missionPublicId).toBe(missionPublicId);
    expect(result.missionRevision).toBe(1);
    expect(result.startedAt).toBe(now);
    expect(result.submissionDeadlineAt).toBe(now + 86400000);
    expect(result.participationPublicId).toMatch(/^par_/);
    expect(typeof result.jellyPlaceId).toBe("string");

    const stored = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntParticipations")
        .withIndex("by_public_id", (q: any) => q.eq("publicId", result.participationPublicId))
        .unique();
    });
    expect(stored!.status).toBe("started");
    expect(stored!.maxAttempts).toBe(3);
    expect(stored!.attemptsUsed).toBe(0);
  });

  it("is idempotent on replay with the same expected revision", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const jellyUserId = `user_${uniqueSuffix()}`;

    const first = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId,
      missionPublicId,
      expectedMissionRevision: 1,
    });

    const second = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId,
      missionPublicId,
      expectedMissionRevision: 1,
    });

    expect(second.created).toBe(false);
    expect(second.participationPublicId).toBe(first.participationPublicId);

    const rows = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntParticipations")
        .withIndex("by_user_mission", (q: any) => q.eq("jellyUserId", jellyUserId))
        .collect();
    });
    expect(rows).toHaveLength(1);
  });

  it("rejects a stale expected mission revision", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const jellyUserId = `user_${uniqueSuffix()}`;

    await expect(
      t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
        jellyUserId,
        missionPublicId,
        expectedMissionRevision: 999,
      }),
    ).rejects.toThrow(/participation_revision_locked/);

    const rows = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntParticipations")
        .withIndex("by_user_mission", (q: any) => q.eq("jellyUserId", jellyUserId))
        .collect();
    });
    expect(rows).toHaveLength(0);
  });

  it("only ever keeps one active participation per user/mission across repeated starts", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const jellyUserId = `user_${uniqueSuffix()}`;

    await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId, missionPublicId, expectedMissionRevision: 1 });
    await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId, missionPublicId, expectedMissionRevision: 1 });
    await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY, jellyUserId, missionPublicId, expectedMissionRevision: 1 });

    const rows = await t.run(async (ctx: any) => {
      return await ctx.db
        .query("jellyhuntParticipations")
        .withIndex("by_user_mission", (q: any) => q.eq("jellyUserId", jellyUserId))
        .collect();
    });

    expect(rows).toHaveLength(1);
  });

  it("throws when the mission is paused", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    await t.mutation(missions.setMissionLifecycle, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      status: "paused",
    });

    await expect(
      t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
        jellyUserId: `user_${uniqueSuffix()}`,
        missionPublicId,
        expectedMissionRevision: 1,
      }),
    ).rejects.toThrow(/mission_not_active/);
  });

  it("throws when the mission is not accepting submissions", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);

    await t.run(async (ctx: any) => {
      const mission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q: any) => q.eq("publicId", missionPublicId))
        .unique();
      await ctx.db.patch(mission!._id, { acceptingSubmissions: false });
    });

    await expect(
      t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
        jellyUserId: `user_${uniqueSuffix()}`,
        missionPublicId,
        expectedMissionRevision: 1,
      }),
    ).rejects.toThrow(/mission_not_accepting_submissions/);
  });

  it("returns a participation by public ID only to its owner", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const owner = `user_${uniqueSuffix()}`;
    const other = `user_${uniqueSuffix()}`;

    const started = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId: owner,
      missionPublicId,
      expectedMissionRevision: 1,
    });

    const ownerResult = await t.query(participations.getParticipationByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      participationPublicId: started.participationPublicId,
      jellyUserId: owner,
    });
    expect(ownerResult).not.toBeNull();
    expect(ownerResult.id).toBe(started.participationPublicId);
    expect(ownerResult.missionId).toBe(missionPublicId);

    const otherResult = await t.query(participations.getParticipationByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      participationPublicId: started.participationPublicId,
      jellyUserId: other,
    });
    expect(otherResult).toBeNull();
  });

  it("lists a user's participations most recently started first", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId: missionA } = await setupActiveMission(t);
    const { missionPublicId: missionB } = await setupActiveMission(t);
    const jellyUserId = `user_${uniqueSuffix()}`;

    const first = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId,
      missionPublicId: missionA,
      expectedMissionRevision: 1,
      now: 1000,
    });
    const second = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId,
      missionPublicId: missionB,
      expectedMissionRevision: 1,
      now: 2000,
    });

    const list = await t.query(participations.listUserParticipations, { serviceKey: TEST_SERVICE_KEY, jellyUserId });
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(second.participationPublicId);
    expect(list[1].id).toBe(first.participationPublicId);
  });

  it("fails closed before starting when the service key is missing or wrong", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const jellyUserId = `OpaqueUser_${uniqueSuffix()}`;

    await expect(
      t.mutation(participations.startParticipation, {
        jellyUserId,
        missionPublicId,
        expectedMissionRevision: 1,
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(participations.startParticipation, {
        serviceKey: "wrong-service-key",
        jellyUserId,
        missionPublicId,
        expectedMissionRevision: 1,
      }),
    ).rejects.toThrow(/unauthorized/);

    const rows = await t.run(async (ctx: any) => ctx.db.query("jellyhuntParticipations").collect());
    expect(rows).toHaveLength(0);
  });

  it("requires the service key for owner reads and preserves opaque user-id case", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupActiveMission(t);
    const jellyUserId = `  OpaqueUser_${uniqueSuffix()}  `;

    const started = await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId,
      missionPublicId,
      expectedMissionRevision: 1,
    });

    await expect(
      t.query(participations.getParticipationByPublicId, {
        serviceKey: "wrong-service-key",
        participationPublicId: started.participationPublicId,
        jellyUserId: jellyUserId.trim(),
      }),
    ).rejects.toThrow(/unauthorized/);

    const owned = await t.query(participations.getParticipationByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      participationPublicId: started.participationPublicId,
      jellyUserId: jellyUserId.trim(),
    });
    expect(owned).not.toBeNull();

    const lowercased = await t.query(participations.getParticipationByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      participationPublicId: started.participationPublicId,
      jellyUserId: jellyUserId.trim().toLowerCase(),
    });
    expect(lowercased).toBeNull();
  });
});
