import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import matchedFixture from "./contracts/jelly-partner-v1/post-preflight-matched.200.json";

const NOW = Date.parse("2026-08-05T18:42:11Z");

describe("JellyHunt v2 exact Jelly post preflight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("strictly parses the frozen partner response and binds the preallocated submission and token subject", async () => {
    vi.stubEnv(
      "JELLY_PARTNER_PREFLIGHT_URL",
      "https://jelly.partner.test/partner/v1/jellyhunt/posts/{postId}/preflight",
    );
    vi.stubEnv("JELLY_PARTNER_API_KEY", "partner-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(matchedFixture.body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { preflightJellyPost } = await import("../src/lib/jellyhunt/v2/jelly-post-preflight");

    const result = await preflightJellyPost({
      jellyPostId: "01HXJELLYPOST000002",
      submissionPublicId: "sub_01HXSUBMISSION0001",
      jellyUserId: "usr_jelly_canonical_001",
      requestId: "request-1",
    });

    expect(result).toEqual({
      jellyPostId: "01HXJELLYPOST000002",
      canonicalOwnerUserId: "usr_jelly_canonical_001",
      ownershipStatus: "matched",
      checkedAt: Date.parse("2026-08-05T18:42:10Z"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://jelly.partner.test/partner/v1/jellyhunt/posts/01HXJELLYPOST000002/preflight",
    );
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer partner-secret");
    expect(JSON.parse(String(init?.body))).toEqual(matchedFixture.request);
  });

  it("maps partner not-found and an explicit owner mismatch without exposing another owner", async () => {
    vi.stubEnv("JELLY_PARTNER_PREFLIGHT_URL", "https://jelly.partner.test/preflight");
    vi.stubEnv("JELLY_PARTNER_API_KEY", "partner-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { preflightJellyPost } = await import("../src/lib/jellyhunt/v2/jelly-post-preflight");
    const input = {
      jellyPostId: "post/private",
      submissionPublicId: "sub_01HXSUBMISSION0001",
      jellyUserId: "usr_jelly_canonical_001",
      requestId: "request-2",
    };

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(preflightJellyPost(input)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "post_not_found",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://jelly.partner.test/preflight/post%2Fprivate");

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...matchedFixture.body,
          ownershipStatus: "mismatched",
          reasonCodes: ["author_mismatch"],
          post: {
            ...matchedFixture.body.post,
            id: "post/private",
            canonicalOwnerUserId: "some-other-private-owner",
          },
        }),
        { status: 200 },
      ),
    );
    await expect(preflightJellyPost(input)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "jelly_post_not_eligible",
      message: expect.not.stringContaining("some-other-private-owner"),
    });
  });

  it.each([
    ["rate limit", new Response("{}", { status: 429 })],
    ["server failure", new Response("{}", { status: 500 })],
    ["malformed JSON", new Response("not-json", { status: 200 })],
    ["invalid schema", new Response(JSON.stringify({ ownershipStatus: "matched" }), { status: 200 })],
  ])("maps partner %s to dependency_unavailable", async (_label, upstream) => {
    vi.stubEnv("JELLY_PARTNER_PREFLIGHT_URL", "https://jelly.partner.test/preflight/{postId}");
    vi.stubEnv("JELLY_PARTNER_API_KEY", "partner-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(upstream);
    const { preflightJellyPost } = await import("../src/lib/jellyhunt/v2/jelly-post-preflight");

    await expect(
      preflightJellyPost({
        jellyPostId: "post-1",
        submissionPublicId: "sub_01HXSUBMISSION0001",
        jellyUserId: "usr_jelly_canonical_001",
        requestId: "request-3",
      }),
    ).rejects.toMatchObject({ statusCode: 503, errorCode: "dependency_unavailable" });
  });

  it("falls back to the exact legacy post endpoint and requires one exact canonical ID and owner", async () => {
    vi.stubEnv("JELLY_API_BASE_URL", "https://legacy.jelly.test/");
    vi.stubEnv("JELLY_LEGACY_API_TOKEN", "legacy-secret");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "post/a?b#c",
            jelly_id: "post/a?b#c",
            started_by_id: "usr_jelly_canonical_001",
          },
        }),
        { status: 200 },
      ),
    );
    const { preflightJellyPost } = await import("../src/lib/jellyhunt/v2/jelly-post-preflight");

    const result = await preflightJellyPost({
      jellyPostId: "post/a?b#c",
      submissionPublicId: "sub_01HXSUBMISSION0001",
      jellyUserId: "usr_jelly_canonical_001",
      requestId: "request-4",
    });

    expect(result).toEqual({
      jellyPostId: "post/a?b#c",
      canonicalOwnerUserId: "usr_jelly_canonical_001",
      ownershipStatus: "matched",
      checkedAt: NOW,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://legacy.jelly.test/v3/jelly/post%2Fa%3Fb%23c");
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Token legacy-secret");
  });

  it("rejects legacy owner mismatches and treats ambiguous or invalid legacy bodies as unavailable", async () => {
    vi.stubEnv("JELLY_API_BASE_URL", "https://legacy.jelly.test");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { preflightJellyPost } = await import("../src/lib/jellyhunt/v2/jelly-post-preflight");
    const input = {
      jellyPostId: "post-1",
      submissionPublicId: "sub_01HXSUBMISSION0001",
      jellyUserId: "usr_jelly_canonical_001",
      requestId: "request-5",
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { id: "post-1", started_by_id: "private-owner" } }), {
        status: 200,
      }),
    );
    await expect(preflightJellyPost(input)).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "jelly_post_not_eligible",
      message: expect.not.stringContaining("private-owner"),
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { id: "post-1", jelly_id: "different-post", started_by_id: input.jellyUserId } }),
        { status: 200 },
      ),
    );
    await expect(preflightJellyPost(input)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "dependency_unavailable",
    });
  });
});
