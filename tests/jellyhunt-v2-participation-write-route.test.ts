import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createdFixture from "./contracts/jellyhunt-v2/participation-created.201.json";
import replayFixture from "./contracts/jellyhunt-v2/participation-replay.200.json";

const auth = vi.hoisted(() => ({
  requireJellyViewer: vi.fn(),
}));

const convex = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock("../src/lib/jellyhunt/v2/jelly-mission-token", () => auth);
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(() => ({
    mutation: convex.mutation,
    query: convex.query,
  })),
}));

const missionId = "mis_01HXMISSION000001";
const context = { params: Promise.resolve({ missionId }) };

function participationResult(created: boolean) {
  return {
    created,
    participationPublicId: "par_01HXPARTICIPATE01",
    missionPublicId: missionId,
    missionRevision: 7,
    jellyPlaceId: "jpl_01HXJELLYPLACE001",
    startedAt: Date.parse("2026-08-05T18:10:00Z"),
    submissionDeadlineAt: Date.parse("2026-08-06T18:10:00Z"),
  };
}

function request(body: unknown = { expectedMissionRevision: 7 }) {
  return new Request(`https://platepost.io/api/v2/jellyhunt/missions/${missionId}/participation`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer signed-mission-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("JellyHunt v2 participation write route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CONVEX_URL", "https://convex.example.test");
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", "test-service-key");
    auth.requireJellyViewer.mockResolvedValue({
      jellyUserId: "usr_jelly_canonical_001",
      sessionId: "session-1",
      tokenId: "token-1",
      scopes: new Set(["jellyhunt:submit"]),
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns the frozen 201 participation projection and derives identity only from the viewer", async () => {
    convex.mutation.mockResolvedValueOnce(participationResult(true));
    const { PUT } = await import("../app/api/v2/jellyhunt/missions/[missionId]/participation/route");

    const response = await PUT(request(), context);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    const body = await response.json();
    expect(body.data).toEqual(createdFixture.data);
    expect(body.links).toEqual(createdFixture.links);
    expect(auth.requireJellyViewer).toHaveBeenCalledWith(expect.any(Request), "jellyhunt:submit");
    expect(convex.mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        serviceKey: "test-service-key",
        jellyUserId: "usr_jelly_canonical_001",
        missionPublicId: missionId,
        expectedMissionRevision: 7,
        requestId: expect.any(String),
      },
    );
  });

  it("returns 200 with the frozen replay projection without changing the original timestamps", async () => {
    convex.mutation.mockResolvedValueOnce(participationResult(false));
    const { PUT } = await import("../app/api/v2/jellyhunt/missions/[missionId]/participation/route");

    const response = await PUT(request(), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(replayFixture.data);
    expect(body.links).toEqual(replayFixture.links);
  });

  it("rejects malformed JSON and unknown fields before calling Convex", async () => {
    const { PUT } = await import("../app/api/v2/jellyhunt/missions/[missionId]/participation/route");
    const malformed = new Request(
      `https://platepost.io/api/v2/jellyhunt/missions/${missionId}/participation`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer signed-mission-token", "Content-Type": "application/json" },
        body: "{",
      },
    );

    for (const candidate of [malformed, request({ expectedMissionRevision: 7, jellyUserId: "attacker" })]) {
      const response = await PUT(candidate, context);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("maps a locked mission revision to a stable 409", async () => {
    convex.mutation.mockRejectedValueOnce(new Error("participation_revision_locked"));
    const { PUT } = await import("../app/api/v2/jellyhunt/missions/[missionId]/participation/route");

    const response = await PUT(request(), context);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "participation_revision_locked",
      retryable: false,
    });
  });
});
