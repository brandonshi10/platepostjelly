import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getCurrentCampaign: vi.fn(),
  getMission: vi.fn(),
  getPlace: vi.fn(),
  listMissions: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  optionalJellyViewer: vi.fn(),
}));

vi.mock("../src/lib/jellyhunt/v2/repository", () => repository);
vi.mock("../src/lib/jellyhunt/v2/jelly-mission-token", () => auth);

const campaign = {
  id: "cam_01HXCAMPAIGN0000001",
  revision: 12,
  catalogRevision: 34,
  title: "PlatePost x JellyJelly: Human Social!",
  shortTitle: "JellyHunt",
  status: "active",
  startsAt: "2026-08-01T04:00:00.000Z",
  endsAt: "2026-09-01T03:59:59.000Z",
  claimsCloseAt: "2026-09-08T03:59:59.000Z",
  timeZone: "America/New_York",
  rewardToken: { code: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
  map: {
    center: { latitude: 40.7218, longitude: -73.9914 },
    bounds: { south: 40.711, west: -74.004, north: 40.734, east: -73.978 },
    defaultZoom: 13,
  },
  links: {
    rules: "https://platepost.io/human-social/rules",
    iosApp: "https://apps.apple.com/app/jellyjelly",
    androidApp: "https://play.google.com/store/apps/details?id=com.jellyjelly",
    support: "https://platepost.io/human-social/support",
  },
};

const mission = {
  id: "mis_01HXMISSION000001",
  campaignId: campaign.id,
  slug: "scarrs-cheese-pull",
  revision: 7,
  title: "The Scarr's Cheese Pull",
  description: "Order one slice and film the cheese pull.",
  instructions: ["Visit the venue.", "Publish the requested Jelly."],
  availability: {
    state: "available",
    startsAt: "2026-08-01T16:00:00.000Z",
    endsAt: "2026-08-31T23:00:00.000Z",
    acceptingSubmissions: true,
    reasonCode: null,
  },
  reward: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
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
  display: {
    category: "Pizza",
    difficulty: "easy",
    emoji: "🍕",
    neighborhood: "Lower East Side",
    price: "$",
    sortOrder: 1,
  },
  place: {
    id: "plc_01HXPLACE0000001",
    revision: 9,
    jellyPlaceId: "jpl_01HXJELLYPLACE001",
    name: "Scarr's Pizza",
    address: "35 Orchard St, New York, NY",
    latitude: 40.7163,
    longitude: -73.9914,
    timeZone: "America/New_York",
    hours: { monday: [{ opensAt: "12:00", closesAt: "23:00" }] },
    source: {
      system: "jelly",
      revision: 9,
      updatedAt: "2026-07-16T19:00:00.000Z",
      syncedAt: "2026-07-16T19:05:00.000Z",
    },
    updatedAt: "2026-07-16T19:05:00.000Z",
  },
  links: {
    self: "/api/v2/jellyhunt/missions/mis_01HXMISSION000001",
    participation: null,
    jellies: "/api/v2/jellyhunt/missions/mis_01HXMISSION000001/jellies",
    start: "https://platepost.io/human-social/missions/mis_01HXMISSION000001/start",
    directions: "https://www.google.com/maps/dir/?api=1&destination=40.7163,-73.9914",
  },
  updatedAt: "2026-07-16T19:00:00.000Z",
};

describe("JellyHunt v2 public discovery routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.optionalJellyViewer.mockResolvedValue(null);
    repository.getCurrentCampaign.mockResolvedValue(campaign);
    const { revision: _revision, source: _source, updatedAt: _placeUpdatedAt, ...missionPlace } = mission.place;
    repository.getMission.mockResolvedValue({ ...mission, place: missionPlace });
    repository.getPlace.mockResolvedValue(mission.place);
    repository.listMissions.mockResolvedValue({
      catalogRevision: 34,
      missions: [{ ...mission, place: missionPlace }],
    });
  });

  it("returns the exact current-campaign envelope with a semantic ETag and supports 304", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/campaigns/current/route");
    const response = await GET(new Request("http://localhost/api/v2/jellyhunt/campaigns/current"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("etag")).toMatch(/^W\//);
    const body = await response.json();
    expect(body.data).toEqual(campaign);
    expect(body.meta.apiVersion).toBe("2.0");
    expect(body.links).toEqual({ missions: `/api/v2/jellyhunt/missions?campaignId=${campaign.id}` });

    const conditional = await GET(
      new Request("http://localhost/api/v2/jellyhunt/campaigns/current", {
        headers: { "If-None-Match": response.headers.get("etag")! },
      }),
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });

  it("maps an absent current campaign to the stable campaign_not_found error", async () => {
    repository.getCurrentCampaign.mockResolvedValue(null);
    const { GET } = await import("../app/api/v2/jellyhunt/campaigns/current/route");
    const response = await GET(new Request("http://localhost/api/v2/jellyhunt/campaigns/current"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("campaign_not_found");
  });

  it("returns cursor-page metadata and summary-only mission list items", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/missions/route");
    const response = await GET(
      new Request("http://localhost/api/v2/jellyhunt/missions?category=Pizza&difficulty=easy&limit=20"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.missions[0]).not.toHaveProperty("requirements");
    expect(body.data.missions[0].title).toBe(mission.title);
    expect(body.meta).toMatchObject({
      apiVersion: "2.0",
      catalogRevision: 34,
      page: { limit: 20, nextCursor: null, hasMore: false },
    });
  });

  it("rejects unknown and internally inconsistent mission-list query parameters", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/missions/route");
    for (const query of ["unknown=value", "sort=nearby", "latitude=40.7", "limit=0"]) {
      const response = await GET(new Request(`http://localhost/api/v2/jellyhunt/missions?${query}`));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error.code, query).toBe("invalid_request");
    }
  });

  it("passes dynamic mission params, returns revision-backed detail, and rejects unknown query fields", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/missions/[missionId]/route");
    const context = { params: Promise.resolve({ missionId: mission.id }) };
    const response = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/missions/${mission.id}`),
      context,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: mission.id,
      revision: 7,
      title: mission.title,
      reward: mission.reward,
      place: { id: mission.place.id, jellyPlaceId: mission.place.jellyPlaceId },
    });
    expect(repository.getMission).toHaveBeenCalledWith(mission.id, expect.objectContaining({ jellyUserId: undefined }));

    const invalid = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/missions/${mission.id}?debug=true`),
      context,
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_request");
  });

  it("returns a safe reviewed place projection with public links and no internal fields", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/places/[placeId]/route");
    const response = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/places/${mission.place.id}`),
      { params: Promise.resolve({ placeId: mission.place.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).not.toHaveProperty("geofenceRadiusMeters");
    expect(body.data).not.toHaveProperty("_id");
    expect(body.links).toEqual({
      self: `/api/v2/jellyhunt/places/${mission.place.id}`,
      jellies: `/api/v2/jellyhunt/places/${mission.place.id}/jellies`,
      directions: "https://www.google.com/maps/dir/?api=1&destination=40.7163,-73.9914",
    });
  });
});
