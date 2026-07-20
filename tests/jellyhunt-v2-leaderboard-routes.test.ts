import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  getAllTimeLeaderboardContext: vi.fn(),
  getCurrentSeasonLeaderboardContext: vi.fn(),
  listLeaderboard: vi.fn(),
}));

vi.mock("../src/lib/jellyhunt/v2/repository", () => repository);

const campaign = {
  id: "cam_01HXCAMPAIGN0000001",
  title: "JellyHunt NYC — Season 1",
  startsAt: Date.parse("2026-08-01T04:00:00Z"),
  endsAt: Date.parse("2026-09-01T03:59:59Z"),
};

const firstPage = {
  standings: [
    { rank: 1, username: "ari", approvedMissionCount: 12 },
    { rank: 1, username: "mika", approvedMissionCount: 12 },
  ],
  hasMore: true,
  cursorState: {
    eligibleItemsSeen: 2,
    lastRank: 1,
    lastScore: 12,
    lastUsername: "mika",
    lastPublicId: "lbe_01HXLASTENTRY000001",
  },
  revision: 51,
};

const lastPage = {
  standings: [{ rank: 3, username: "zoe", approvedMissionCount: 9 }],
  hasMore: false,
  cursorState: null,
  revision: 51,
};

describe("JellyHunt v2 leaderboard routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JELLYHUNT_CURSOR_SECRET", "leaderboard-route-test-secret-at-least-32-bytes");
    repository.getAllTimeLeaderboardContext.mockResolvedValue({
      scopeKey: "all_time",
      revision: 51,
      startsAt: Date.parse("2026-07-01T00:00:00Z"),
    });
    repository.getCurrentSeasonLeaderboardContext.mockResolvedValue({
      scopeKey: `campaign:${campaign.id}`,
      revision: 84,
      campaign,
    });
    repository.listLeaderboard.mockResolvedValue(firstPage);
  });

  it("returns the exact all-time contract with a signed opaque cursor and no identifiers", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/leaderboards/all-time/route");
    const response = await GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");
    expect(response.headers.get("etag")).toMatch(/^W\//);
    const body = await response.json();
    expect(body.data).toEqual({
      scope: "all_time",
      rankingBasis: "approved_missions",
      startsAt: "2026-07-01T00:00:00.000Z",
      standings: firstPage.standings,
    });
    expect(body.meta).toMatchObject({
      apiVersion: "2.0",
      leaderboardRevision: 51,
      page: { limit: 2, hasMore: true },
    });
    expect(body.meta.page.nextCursor).toEqual(expect.any(String));
    expect(() => JSON.parse(body.meta.page.nextCursor)).toThrow();
    expect(JSON.stringify(body)).not.toMatch(/jellyUserId|lastPublicId|lbe_01/);
  }, 60_000);

  it("opens the signed cursor, passes its rank state to Convex, and preserves a cross-page tie", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/leaderboards/all-time/route");
    const firstResponse = await GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2"),
    );
    const cursor = (await firstResponse.json()).meta.page.nextCursor;

    repository.listLeaderboard.mockResolvedValueOnce(lastPage);
    const secondResponse = await GET(
      new Request(
        `https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2&cursor=${encodeURIComponent(cursor)}`,
      ),
    );

    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()).data.standings[0].rank).toBe(3);
    expect(repository.listLeaderboard).toHaveBeenLastCalledWith({
      scopeKey: "all_time",
      limit: 2,
      expectedRevision: 51,
      resume: firstPage.cursorState,
    });
  });

  it("rejects a tampered or revision-stale cursor with restartRequired", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/leaderboards/all-time/route");
    const firstResponse = await GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2"),
    );
    const cursor = (await firstResponse.json()).meta.page.nextCursor as string;
    repository.listLeaderboard.mockClear();

    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    const tamperedResponse = await GET(
      new Request(
        `https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2&cursor=${encodeURIComponent(tampered)}`,
      ),
    );
    expect(tamperedResponse.status).toBe(400);
    expect(await tamperedResponse.json()).toMatchObject({
      error: { code: "invalid_cursor", restartRequired: true },
    });

    repository.getAllTimeLeaderboardContext.mockResolvedValue({
      scopeKey: "all_time",
      revision: 52,
      startsAt: Date.parse("2026-07-01T00:00:00Z"),
    });
    const staleResponse = await GET(
      new Request(
        `https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2&cursor=${encodeURIComponent(cursor)}`,
      ),
    );
    expect(staleResponse.status).toBe(400);
    expect((await staleResponse.json()).error.code).toBe("invalid_cursor");
    expect(repository.listLeaderboard).not.toHaveBeenCalled();
  });

  it("binds current-season data and cursors to the selected public campaign", async () => {
    repository.listLeaderboard.mockResolvedValue({ ...firstPage, revision: 84 });
    const { GET } = await import("../app/api/v2/jellyhunt/leaderboards/current-season/route");
    const response = await GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/current-season?limit=2"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      scope: "current_season",
      rankingBasis: "approved_missions",
      campaign: {
        id: campaign.id,
        title: campaign.title,
        startsAt: "2026-08-01T04:00:00.000Z",
        endsAt: "2026-09-01T03:59:59.000Z",
      },
      standings: firstPage.standings,
    });
    expect(body.meta.leaderboardRevision).toBe(84);
    expect(repository.listLeaderboard).toHaveBeenCalledWith({
      scopeKey: `campaign:${campaign.id}`,
      limit: 2,
      expectedRevision: 84,
      resume: undefined,
    });
  });

  it("returns campaign_not_found and rejects unknown or invalid query values", async () => {
    repository.getCurrentSeasonLeaderboardContext.mockResolvedValue(null);
    const current = await import("../app/api/v2/jellyhunt/leaderboards/current-season/route");
    const missing = await current.GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/current-season"),
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("campaign_not_found");

    const allTime = await import("../app/api/v2/jellyhunt/leaderboards/all-time/route");
    for (const query of ["limit=0", "limit=101", "limit=2.5", "unknown=true"]) {
      const invalid = await allTime.GET(
        new Request(`https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?${query}`),
      );
      expect(invalid.status, query).toBe(400);
      expect((await invalid.json()).error.code, query).toBe("invalid_request");
    }
  });

  it("returns 304 for an unchanged semantic leaderboard representation", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/leaderboards/all-time/route");
    const response = await GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2"),
    );
    const conditional = await GET(
      new Request("https://platepost.io/api/v2/jellyhunt/leaderboards/all-time?limit=2", {
        headers: { "If-None-Match": response.headers.get("etag")! },
      }),
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });
});