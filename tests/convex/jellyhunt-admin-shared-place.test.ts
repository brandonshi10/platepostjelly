import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const campaigns = anyApi.jellyhunt.campaigns;
const admin = anyApi.jellyhunt.admin;

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
    slug: `supermoon-ube-eclair-${suffix()}`,
    title: "Ube Eclair",
    description: "Film the ube eclair.",
    status: "draft",
    approvalMode: "manual",
    restaurantTag: "supermoon-bakehouse",
    rewardAmount: 10,
    category: "Bakery",
    difficulty: "easy",
    emoji: "🥐",
    neighborhood: "Lower East Side",
    price: "$$",
    hours: [
      "08:00-18:00", "08:00-18:00", "08:00-18:00", "08:00-18:00",
      "08:00-19:00", "08:00-19:00", "08:00-18:00",
    ],
    sortOrder: 0,
    ...overrides,
  };
}

const SUPERMOON = {
  name: "Supermoon Bakehouse",
  address: "120 Rivington St",
  latitude: 40.7188,
  longitude: -73.9877,
  geofenceRadiusMeters: 75,
  timeZone: "America/New_York",
};

describe("createMissionAtPlace", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("attaches a second mission to an existing place and rejects a bad service key", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    const first = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: mission({ sortOrder: 0 }),
      location: SUPERMOON,
    });
    expect(first.locationId).toMatch(/^plc_/);

    await expect(
      t.mutation(admin.createMissionAtPlace, {
        serviceKey: "wrong-key",
        actorId: "operator",
        locationId: first.locationId,
        mission: mission({ title: "Corn Crunch Cookie", sortOrder: 1 }),
      }),
    ).rejects.toThrow(/unauthorized/);

    const second = await t.mutation(admin.createMissionAtPlace, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      locationId: first.locationId,
      mission: mission({ title: "Corn Crunch Cookie", sortOrder: 1 }),
    });

    expect(second.locationId).toBe(first.locationId);
    expect(second.missionId).not.toBe(first.missionId);

    const places = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntPlaces").collect(),
    );
    expect(places).toHaveLength(1);

    const missions = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntMissions").collect(),
    );
    expect(missions).toHaveLength(2);
    expect(missions[0].placeId).toStrictEqual(missions[1].placeId);
    expect(missions.every((m: any) => m.currentRevision === 1)).toBe(true);
    expect(missions.every((m: any) => m.status === "draft")).toBe(true);

    // The revision's place snapshot must point at the shared place, not a copy.
    const revisions = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntMissionRevisions").collect(),
    );
    expect(revisions).toHaveLength(2);
    expect(revisions[0].place.jellyPlaceId).toBe(revisions[1].place.jellyPlaceId);
    expect(revisions[1].place.name).toBe("Supermoon Bakehouse");
  });

  it("writes shot-type instructions and durations onto the mission revision", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: mission({ title: "Live Boba-Cooking Station", shotType: "action" }),
      location: SUPERMOON,
    });

    const [revision] = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntMissionRevisions").collect(),
    );
    expect(revision.requirements.post.minDurationSeconds).toBe(10);
    expect(revision.requirements.post.maxDurationSeconds).toBe(20);
    expect(revision.requirements.post.prompt).toMatch(/Start filming before it starts/);
  });

  it("leaves a mission with no shot type on the legacy requirements", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: mission(),
      location: SUPERMOON,
    });

    const [revision] = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntMissionRevisions").collect(),
    );
    expect(revision.requirements.post.prompt).toBe("supermoon-bakehouse");
    expect(revision.requirements.post.minDurationSeconds).toBeUndefined();
  });

  it("rejects an unknown shot type", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    await expect(
      t.mutation(admin.createMissionWithLocation, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "operator",
        mission: mission({ shotType: "cinematic" }),
        location: SUPERMOON,
      }),
    ).rejects.toThrow(/invalid_shot_type/);
  });

  it("rejects an unknown place", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    await expect(
      t.mutation(admin.createMissionAtPlace, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "operator",
        locationId: "plc_does_not_exist",
        mission: mission(),
      }),
    ).rejects.toThrow(/place_not_found/);
  });

  it("rejects a duplicate slug", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    const shared = mission({ slug: `dupe-${suffix()}` });
    const first = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: shared,
      location: SUPERMOON,
    });

    await expect(
      t.mutation(admin.createMissionAtPlace, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "operator",
        locationId: first.locationId,
        mission: { ...shared, sortOrder: 1 },
      }),
    ).rejects.toThrow(/slug/);
  });

  it("proves the old path cannot express two missions at one restaurant", async () => {
    const t = createJellyhuntTestConvex();
    await createCurrentCampaign(t);

    await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: mission({ sortOrder: 0 }),
      location: SUPERMOON,
    });

    // This is the defect createMissionAtPlace exists to work around: the
    // place is keyed on restaurantTag, so a second createMissionWithLocation
    // at the same venue is rejected outright.
    await expect(
      t.mutation(admin.createMissionWithLocation, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "operator",
        mission: mission({ title: "Corn Crunch Cookie", sortOrder: 1 }),
        location: SUPERMOON,
      }),
    ).rejects.toThrow(/place_already_linked_to_jelly_place_id/);
  });
});
