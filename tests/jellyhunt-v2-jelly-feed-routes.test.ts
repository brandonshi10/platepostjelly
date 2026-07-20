import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getMission: vi.fn(),
  getPlace: vi.fn(),
}));
const auth = vi.hoisted(() => ({ optionalJellyViewer: vi.fn() }));

vi.mock("../src/lib/jellyhunt/v2/repository", () => repository);
vi.mock("../src/lib/jellyhunt/v2/jelly-mission-token", () => auth);

const place = {
  id: "plc_01HXPLACE0000001",
  revision: 9,
  jellyPlaceId: "jpl_01HXJELLYPLACE001",
  name: "Scarr's Pizza",
  address: "35 Orchard St, New York, NY",
  latitude: 40.7163,
  longitude: -73.9914,
  timeZone: "America/New_York",
  hours: {},
  source: {
    system: "jelly",
    revision: 9,
    updatedAt: "2026-07-16T19:00:00.000Z",
    syncedAt: "2026-07-16T19:05:00.000Z",
  },
  updatedAt: "2026-07-16T19:05:00.000Z",
};

function partnerBody(nextCursor: string | null = null) {
  return {
    place: { id: place.jellyPlaceId, revision: 9 },
    jellies: [
      {
        id: "01HXJELLYPOST000001",
        revision: 4,
        state: "ready",
        visibility: "public",
        moderationStatus: "clear",
        postType: "video",
        durationSeconds: 31.4,
        author: {
          id: "usr_jelly_ari",
          username: "ari",
          displayName: "Ari",
          avatarUrl: "https://cdn.jellyjelly.com/avatars/ari.jpg",
        },
        title: "Best slice on Orchard",
        summary: "A first bite at Scarr's.",
        thumbnailUrl: "https://cdn.jellyjelly.com/signed/thumb1.jpg",
        mediaExpiresAt: "2026-08-05T19:45:00.000Z",
        watchUrl: "https://jellyjelly.com/watch/01HXJELLYPOST000001",
        placeAssociation: {
          placeId: place.jellyPlaceId,
          source: "server_place_relation",
          associatedAt: "2026-08-05T18:30:00.000Z",
        },
        postedAt: "2026-08-05T18:30:00.000Z",
        updatedAt: "2026-08-05T18:31:00.000Z",
      },
    ],
    page: { limit: 20, nextCursor, hasMore: nextCursor !== null },
    generatedAt: "2026-08-05T18:45:00.000Z",
  };
}

describe("JellyHunt v2 place-linked Jelly feeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JELLY_API_BASE_URL", "https://api.jelly.test");
    vi.stubEnv("JELLY_PARTNER_API_KEY", "test-partner-key");
    vi.stubEnv("JELLYHUNT_CURSOR_SECRET", "test-feed-cursor-secret-at-least-32");
    auth.optionalJellyViewer.mockResolvedValue(null);
    repository.getPlace.mockResolvedValue(place);
    repository.getMission.mockResolvedValue({ id: "mis_01HXMISSION000001", place });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches and strictly normalizes a place-indexed Jelly feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(partnerBody()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/v2/jellyhunt/places/[placeId]/jellies/route");
    const response = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/places/${place.id}/jellies?limit=20`),
      { params: Promise.resolve({ placeId: place.id }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toMatch(/^W\//);
    expect(response.headers.get("cache-control")).toContain("public");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.jelly.test/partner/v1/jellyhunt/places/${place.jellyPlaceId}/jellies?limit=20`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-partner-key" }),
      }),
    );

    const body = await response.json();
    expect(body.data).toEqual({
      jellies: [
        {
          id: "01HXJELLYPOST000001",
          postType: "video",
          author: {
            id: "usr_jelly_ari",
            username: "ari",
            displayName: "Ari",
            avatarUrl: "https://cdn.jellyjelly.com/avatars/ari.jpg",
          },
          title: "Best slice on Orchard",
          summary: "A first bite at Scarr's.",
          thumbnailUrl: "https://cdn.jellyjelly.com/signed/thumb1.jpg",
          mediaExpiresAt: "2026-08-05T19:45:00.000Z",
          watchUrl: "https://jellyjelly.com/watch/01HXJELLYPOST000001",
          postedAt: "2026-08-05T18:30:00.000Z",
        },
      ],
      source: "jelly",
      sourceStatus: "live",
    });
    expect(body.meta.page).toEqual({ limit: 20, nextCursor: null, hasMore: false });
  });

  it("resolves mission feeds through the immutable mission place relation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(partnerBody()), { status: 200 })),
    );
    const { GET } = await import("../app/api/v2/jellyhunt/missions/[missionId]/jellies/route");
    const missionId = "mis_01HXMISSION000001";
    const response = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/missions/${missionId}/jellies`),
      { params: Promise.resolve({ missionId }) },
    );
    expect(response.status).toBe(200);
    expect(repository.getMission).toHaveBeenCalledWith(
      missionId,
      expect.objectContaining({ jellyUserId: undefined }),
    );
    expect((await response.json()).data.sourceStatus).toBe("live");
  });

  it("returns an empty place_not_linked feed without guessing or calling Jelly", async () => {
    repository.getPlace.mockResolvedValue({ ...place, jellyPlaceId: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../app/api/v2/jellyhunt/places/[placeId]/jellies/route");
    const response = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/places/${place.id}/jellies`),
      { params: Promise.resolve({ placeId: place.id }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { jellies: [], source: "jelly", sourceStatus: "place_not_linked" },
      meta: { page: { nextCursor: null, hasMore: false } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns stable dependency errors for outages and invalid partner bodies", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/places/[placeId]/jellies/route");
    const context = { params: Promise.resolve({ placeId: place.id }) };

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const unavailable = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/places/${place.id}/jellies`),
      context,
    );
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe("dependency_unavailable");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 })),
    );
    const invalid = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/places/${place.id}/jellies`),
      context,
    );
    expect(invalid.status).toBe(502);
    expect((await invalid.json()).error.code).toBe("dependency_invalid_response");
  });

  it("rejects unknown feed query parameters", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/places/[placeId]/jellies/route");
    const response = await GET(
      new Request(`http://localhost/api/v2/jellyhunt/places/${place.id}/jellies?tag=Pizza`),
      { params: Promise.resolve({ placeId: place.id }) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });
});
