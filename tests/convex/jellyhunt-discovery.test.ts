import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const participations = anyApi.jellyhunt.participations;

async function seedPublishedMission(t: ReturnType<typeof createJellyhuntTestConvex>) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    slug: "human-social",
    title: "PlatePost x JellyJelly: Human Social!",
    shortTitle: "JellyHunt",
    status: "active",
    startsAt: Date.parse("2026-08-01T04:00:00Z"),
    endsAt: Date.parse("2026-09-01T03:59:59Z"),
    claimsCloseAt: Date.parse("2026-09-08T03:59:59Z"),
    timeZone: "America/New_York",
    rewardTokenCode: "JELLY-MY-JELLY",
    rewardTokenDisplayName: "Jelly-My-Jelly",
    map: {
      centerLatitude: 40.7218,
      centerLongitude: -73.9914,
      boundsSouth: 40.711,
      boundsWest: -74.004,
      boundsNorth: 40.734,
      boundsEast: -73.978,
      defaultZoom: 13,
    },
    links: {
      rules: "https://platepost.io/human-social/rules",
      iosApp: "https://apps.apple.com/app/jellyjelly",
      androidApp: "https://play.google.com/store/apps/details?id=com.jellyjelly",
      support: "https://platepost.io/human-social/support",
    },
  });
  await t.mutation(campaigns.selectCurrentCampaign, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    campaignPublicId,
  });

  const placePublicId = await t.mutation(places.createPlace, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    jellyPlaceId: "jpl_scarrs",
    name: "Scarr's Pizza",
    address: "35 Orchard St, New York, NY",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
    hours: [{ weekday: "monday", opensAt: "12:00", closesAt: "23:00" }],
  });
  await t.mutation(places.setPlaceReviewStatus, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    placePublicId,
    reviewStatus: "reviewed",
  });

  const missionPublicId = await t.mutation(missions.createDraftMission, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    campaignPublicId,
    placePublicId,
    slug: "scarrs-cheese-pull",
    title: "Mutable draft title",
    category: "Pizza",
    difficulty: "easy",
    emoji: "🍕",
    neighborhood: "Lower East Side",
    price: "$",
    sortOrder: 1,
    reward: { amount: "999", token: "JELLY-MY-JELLY", displayName: "Wrong draft reward" },
    approvalMode: "manual",
  });

  await t.mutation(missions.publishMissionRevision, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    missionPublicId,
    expectedDraftRevision: 0,
    content: {
      title: "Immutable published title",
      description: "Order one slice and film the cheese pull.",
      instructions: ["Visit the venue.", "Publish the requested Jelly."],
      requirements: {
        post: {
          allowedPostTypes: ["video"],
          authorshipPolicy: "canonical_owner",
          prompt: "Film the cheese pull.",
          minDurationSeconds: 5,
          maxDurationSeconds: 90,
          requiredVisibility: "public",
        },
        place: { attachmentRequired: true },
        location: { required: true, trustedSource: "jelly_post" },
        schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
      },
      reward: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      missionWindow: {
        startsAt: Date.parse("2026-08-01T16:00:00Z"),
        endsAt: Date.parse("2026-08-31T23:00:00Z"),
      },
    },
  });

  await t.mutation(missions.updateMissionDraft, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin",
    missionPublicId,
    expectedRevision: 1,
    title: "Unpublished changed title",
    reward: { amount: "500", token: "JELLY-MY-JELLY", displayName: "Changed" },
  });

  return { campaignPublicId, placePublicId, missionPublicId };
}

describe("JellyHunt public discovery Convex projections", () => {
  beforeEach(() => vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("returns null when no current campaign is selected", async () => {
    const t = createJellyhuntTestConvex();
    expect(await t.query(campaigns.getCurrentCampaignDiscovery, {})).toBeNull();
  });

  it("returns exact campaign and reviewed-place projections without internal fields", async () => {
    const t = createJellyhuntTestConvex();
    const { placePublicId } = await seedPublishedMission(t);
    const campaign = await t.query(campaigns.getCurrentCampaignDiscovery, {});
    expect(campaign).toMatchObject({
      title: "PlatePost x JellyJelly: Human Social!",
      status: "upcoming",
      map: { center: { latitude: 40.7218, longitude: -73.9914 } },
    });
    expect(campaign).not.toHaveProperty("campaignPublicId");

    const place = await t.query(places.getPlaceDiscovery, { placePublicId });
    expect(place).toMatchObject({
      id: placePublicId,
      jellyPlaceId: "jpl_scarrs",
      hours: { monday: [{ opensAt: "12:00", closesAt: "23:00" }] },
      source: { system: "jelly" },
    });
    expect(place).not.toHaveProperty("_id");
    expect(place).not.toHaveProperty("geofenceRadiusMeters");
  });

  it("renders mission terms from the immutable published revision, not the edited draft", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await seedPublishedMission(t);
    const detail = await t.query(missions.getMissionDiscovery, {
      missionPublicId,
      now: Date.parse("2026-08-05T18:00:00Z"),
    });
    expect(detail).toMatchObject({
      id: missionPublicId,
      title: "Immutable published title",
      reward: { amount: "60", displayName: "Jelly-My-Jelly" },
      availability: { state: "available", acceptingSubmissions: true },
    });

    const list = await t.query(missions.listMissionDiscovery, {
      now: Date.parse("2026-08-05T18:00:00Z"),
    });
    expect(list.missions).toHaveLength(1);
    expect(list.missions[0].title).toBe("Immutable published title");
    expect(list.missions[0].reward.amount).toBe("60");
    const revision = await t.run(async (ctx) => {
      const missionRow = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
      return await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) => q.eq("missionId", missionRow!._id).eq("revision", 1))
        .unique();
    });
    expect(revision!.approvalMode).toBe("manual");
  });

  it("adds owner-safe viewer state and keeps a paused mission private to participants", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await seedPublishedMission(t);
    await t.mutation(participations.startParticipation, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId: "user_ari",
      missionPublicId,
      expectedMissionRevision: 1,
      now: Date.parse("2026-08-05T18:00:00Z"),
    });
    await t.mutation(missions.setMissionLifecycle, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin",
      missionPublicId,
      status: "paused",
    });

    expect(
      await t.query(missions.getMissionDiscovery, {
        missionPublicId,
        now: Date.parse("2026-08-05T18:05:00Z"),
      }),
    ).toBeNull();

    const viewerDetail = await t.query(missions.getMissionDiscovery, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId: "user_ari",
      missionPublicId,
      now: Date.parse("2026-08-05T18:05:00Z"),
    });
    expect(viewerDetail).toMatchObject({
      availability: { state: "paused", acceptingSubmissions: false },
      viewer: {
        participationStatus: "started",
        canStart: false,
        canSubmit: false,
        displayStatus: "in_progress",
      },
    });
    expect(viewerDetail.viewer).not.toHaveProperty("jellyUserId");
  });
});
