import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import http from "node:http";

describe("jellyhunt v2 primitives", () => {
  describe("jelly-mission-token", () => {
    let server: http.Server;
    let jwksUrl: string;
    let privateKey: KeyLike;
    let hsKey: Uint8Array;

    const ISSUER = "https://issuer.example.test";

    beforeEach(async () => {
      vi.resetModules();
      const { publicKey, privateKey: privKey } = await generateKeyPair("ES256", { extractable: true });
      privateKey = privKey;
      const jwk = await exportJWK(publicKey);
      jwk.alg = "ES256";
      jwk.use = "sig";
      jwk.kid = "test-key-1";

      hsKey = new TextEncoder().encode("not-used-hs-secret");

      server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [jwk] }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      jwksUrl = `http://127.0.0.1:${port}/jwks`;

      vi.stubEnv("JELLY_MISSION_JWKS_URL", jwksUrl);
      vi.stubEnv("JELLY_MISSION_TOKEN_ISSUER", ISSUER);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    async function makeToken(overrides: Record<string, unknown> = {}, opts: { alg?: string } = {}) {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        session_id: "session-1",
        jti: "token-1",
        scope: "jellyhunt:read jellyhunt:submit",
        ...overrides,
      };
      const jwt = new SignJWT(payload)
        .setProtectedHeader({ alg: opts.alg ?? "ES256", kid: "test-key-1" })
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .setIssuer(ISSUER)
        .setAudience("platepost-jellyhunt")
        .setSubject((overrides.sub as string) ?? "user-1");
      return jwt.sign(privateKey);
    }

    it("accepts a valid token", async () => {
      const { requireJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const token = await makeToken();
      const request = new Request("https://example.test/api", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const viewer = await requireJellyViewer(request, "jellyhunt:read");
      expect(viewer.jellyUserId).toBe("user-1");
      expect(viewer.sessionId).toBe("session-1");
      expect(viewer.tokenId).toBe("token-1");
      expect(viewer.scopes.has("jellyhunt:read")).toBe(true);
      expect(viewer.scopes.has("jellyhunt:submit")).toBe(true);
    });

    it("rejects an expired token", async () => {
      const { requireJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ session_id: "s1", jti: "t1", scope: "jellyhunt:read" })
        .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
        .setIssuedAt(now - 600)
        .setExpirationTime(now - 500)
        .setIssuer(ISSUER)
        .setAudience("platepost-jellyhunt")
        .setSubject("user-1");
      const token = await jwt.sign(privateKey);
      const request = new Request("https://example.test/api", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await expect(requireJellyViewer(request, "jellyhunt:read")).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("rejects wrong audience", async () => {
      const { requireJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ session_id: "s1", jti: "t1", scope: "jellyhunt:read" })
        .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .setIssuer(ISSUER)
        .setAudience("wrong-audience")
        .setSubject("user-1");
      const token = await jwt.sign(privateKey);
      const request = new Request("https://example.test/api", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await expect(requireJellyViewer(request, "jellyhunt:read")).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("rejects missing required scope", async () => {
      const { requireJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const token = await makeToken({ scope: "jellyhunt:read" });
      const request = new Request("https://example.test/api", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await expect(requireJellyViewer(request, "jellyhunt:submit")).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("rejects lifetime greater than 300s", async () => {
      const { requireJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ session_id: "s1", jti: "t1", scope: "jellyhunt:read" })
        .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
        .setIssuedAt(now)
        .setExpirationTime(now + 600)
        .setIssuer(ISSUER)
        .setAudience("platepost-jellyhunt")
        .setSubject("user-1");
      const token = await jwt.sign(privateKey);
      const request = new Request("https://example.test/api", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await expect(requireJellyViewer(request, "jellyhunt:read")).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("rejects HS256 tokens", async () => {
      const { requireJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ session_id: "s1", jti: "t1", scope: "jellyhunt:read" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .setIssuer(ISSUER)
        .setAudience("platepost-jellyhunt")
        .setSubject("user-1");
      const token = await jwt.sign(hsKey);
      const request = new Request("https://example.test/api", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await expect(requireJellyViewer(request, "jellyhunt:read")).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it("optionalJellyViewer returns null with no header", async () => {
      const { optionalJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const request = new Request("https://example.test/api");
      const viewer = await optionalJellyViewer(request, "jellyhunt:read");
      expect(viewer).toBeNull();
    });

    it("optionalJellyViewer throws on invalid header", async () => {
      const { optionalJellyViewer } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      const request = new Request("https://example.test/api", {
        headers: { Authorization: "Bearer not-a-real-token" },
      });
      await expect(optionalJellyViewer(request, "jellyhunt:read")).rejects.toMatchObject({
        statusCode: 401,
      });
    });
  });

  describe("normalizeOpaqueJellyId / normalizeCanonicalUsername", () => {
    it("trims but does not lowercase opaque ids", async () => {
      const { normalizeOpaqueJellyId } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      expect(normalizeOpaqueJellyId("  AbC123  ")).toBe("AbC123");
    });

    it("trims and lowercases usernames", async () => {
      const { normalizeCanonicalUsername } = await import("../src/lib/jellyhunt/v2/jelly-mission-token");
      expect(normalizeCanonicalUsername("  JellyFan99  ")).toBe("jellyfan99");
    });
  });

  describe("deriveDisplayState", () => {
    it("submitted/not_eligible", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      expect(deriveDisplayState({ submissionStatus: "submitted", rewardStatus: "not_eligible" })).toEqual({
        displayStatus: "submitted",
        publicMessage: "Your Jelly was submitted and is waiting for verification.",
        nextAction: "wait_for_verification",
        canResubmit: false,
      });
    });

    it("verifying/not_eligible", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      expect(deriveDisplayState({ submissionStatus: "verifying", rewardStatus: "not_eligible" }).displayStatus).toBe(
        "under_review",
      );
    });

    it("needs_review/not_eligible", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      expect(
        deriveDisplayState({ submissionStatus: "needs_review", rewardStatus: "not_eligible" }).displayStatus,
      ).toBe("under_review");
    });

    it("approved/queued", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      expect(deriveDisplayState({ submissionStatus: "approved", rewardStatus: "queued" }).displayStatus).toBe(
        "approved_reward_pending",
      );
    });

    it("approved/processing", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      expect(deriveDisplayState({ submissionStatus: "approved", rewardStatus: "processing" }).displayStatus).toBe(
        "approved_reward_pending",
      );
    });

    it("approved/sent", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      const result = deriveDisplayState({ submissionStatus: "approved", rewardStatus: "sent" });
      expect(result.displayStatus).toBe("rewarded");
      expect(result.nextAction).toBe("view_reward");
    });

    it("approved/failed", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      const result = deriveDisplayState({ submissionStatus: "approved", rewardStatus: "failed" });
      expect(result.displayStatus).toBe("support_needed");
      expect(result.nextAction).toBe("contact_support");
    });

    it("approved/uncertain", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      expect(deriveDisplayState({ submissionStatus: "approved", rewardStatus: "uncertain" }).displayStatus).toBe(
        "support_needed",
      );
    });

    it("rejected/not_eligible allows resubmit", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      const result = deriveDisplayState({ submissionStatus: "rejected", rewardStatus: "not_eligible" });
      expect(result.displayStatus).toBe("rejected");
      expect(result.canResubmit).toBe(true);
    });

    it("rejected/sent with post_became_ineligible_after_reward", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      const result = deriveDisplayState({
        submissionStatus: "rejected",
        rewardStatus: "sent",
        reasonCode: "post_became_ineligible_after_reward",
      });
      expect(result.displayStatus).toBe("rewarded_removed_from_rankings");
      expect(result.nextAction).toBe("contact_support");
    });

    it("rejected/sent other reason", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      const result = deriveDisplayState({
        submissionStatus: "rejected",
        rewardStatus: "sent",
        reasonCode: "something_else",
      });
      expect(result.displayStatus).toBe("support_needed");
    });

    it("falls back to unknown for unmapped combos", async () => {
      const { deriveDisplayState } = await import("../src/lib/jellyhunt/v2/status");
      const result = deriveDisplayState({
        submissionStatus: "submitted",
        rewardStatus: "sent",
      } as never);
      expect(result.displayStatus).toBe("support_needed");
    });
  });

  describe("cursor", () => {
    beforeEach(() => {
      vi.stubEnv("JELLYHUNT_CURSOR_SECRET", "test-cursor-secret");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const binding = {
      resource: "leaderboard",
      subject: "scope-1",
      queryHash: "hash-abc",
      limit: 25,
      scopeKey: "weekly",
      snapshot: "revision:1",
    };

    it("round trips seal/open", async () => {
      const { hashCursorSubject, sealCursor, openCursor } = await import("../src/lib/jellyhunt/v2/cursor");
      const payload = {
        version: 1 as const,
        resource: binding.resource,
        subjectHash: await hashCursorSubject(binding.subject),
        queryHash: binding.queryHash,
        limit: binding.limit,
        scopeKey: binding.scopeKey,
        snapshot: binding.snapshot,
        lastSortValues: ["a", 1],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      };
      const token = await sealCursor(payload);
      const opened = await openCursor(token, binding);
      expect(opened.lastSortValues).toEqual(["a", 1]);
    });

    it("rejects expired cursor", async () => {
      const { hashCursorSubject, sealCursor, openCursor } = await import("../src/lib/jellyhunt/v2/cursor");
      const payload = {
        version: 1 as const,
        resource: binding.resource,
        subjectHash: await hashCursorSubject(binding.subject),
        queryHash: binding.queryHash,
        limit: binding.limit,
        scopeKey: binding.scopeKey,
        snapshot: binding.snapshot,
        lastSortValues: [],
        issuedAt: Date.now() - 120_000,
        expiresAt: Date.now() - 60_000,
      };
      const token = await sealCursor(payload);
      await expect(openCursor(token, binding)).rejects.toMatchObject({
        statusCode: 400,
        errorCode: "invalid_cursor",
      });
    });

    it("rejects binding mismatch", async () => {
      const { hashCursorSubject, sealCursor, openCursor } = await import("../src/lib/jellyhunt/v2/cursor");
      const payload = {
        version: 1 as const,
        resource: binding.resource,
        subjectHash: await hashCursorSubject(binding.subject),
        queryHash: binding.queryHash,
        limit: binding.limit,
        scopeKey: binding.scopeKey,
        snapshot: binding.snapshot,
        lastSortValues: [],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      };
      const token = await sealCursor(payload);
      await expect(openCursor(token, { ...binding, limit: 50 })).rejects.toMatchObject({
        statusCode: 400,
        errorCode: "invalid_cursor",
      });
    });

    it("computeQueryHash is stable across key order", async () => {
      const { computeQueryHash } = await import("../src/lib/jellyhunt/v2/cursor");
      const a = await computeQueryHash({ b: 1, a: 2 });
      const b = await computeQueryHash({ a: 2, b: 1 });
      expect(a).toBe(b);
    });
  });
  describe("cache", () => {
    it("applies public cache headers with etag", async () => {
      const { applyCacheHeaders } = await import("../src/lib/jellyhunt/v2/cache");
      const headers = new Headers();
      applyCacheHeaders(headers, { type: "public", maxAge: 60 }, 'W/"abc123"');
      expect(headers.get("Cache-Control")).toBe("public, max-age=60");
      expect(headers.get("ETag")).toBe('W/"abc123"');
    });

    it("applies private cache headers without etag", async () => {
      const { applyCacheHeaders } = await import("../src/lib/jellyhunt/v2/cache");
      const headers = new Headers();
      applyCacheHeaders(headers, { type: "private" });
      expect(headers.get("Cache-Control")).toBe("private, no-store");
      expect(headers.get("Vary")).toBe("Authorization");
      expect(headers.get("ETag")).toBeNull();
    });

    it("semanticEtag produces weak etag format", async () => {
      const { semanticEtag } = await import("../src/lib/jellyhunt/v2/cache");
      const etag = await semanticEtag({ a: 1, b: 2 });
      expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    });
  });

  describe("idempotency", () => {
    it("extracts idempotency key", () => {
      return import("../src/lib/jellyhunt/v2/idempotency").then(({ extractIdempotencyKey }) => {
        const request = new Request("https://example.test/api", {
          headers: { "Idempotency-Key": "  01ARZ3NDEKTSV4RRFFQ69G5FAV  " },
        });
        expect(extractIdempotencyKey(request)).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
      });
    });

    it("returns null when header missing", async () => {
      const { extractIdempotencyKey } = await import("../src/lib/jellyhunt/v2/idempotency");
      const request = new Request("https://example.test/api");
      expect(extractIdempotencyKey(request)).toBeNull();
    });

    it("rejects overly long keys", async () => {
      const { extractIdempotencyKey } = await import("../src/lib/jellyhunt/v2/idempotency");
      const request = new Request("https://example.test/api", {
        headers: { "Idempotency-Key": "x".repeat(200) },
      });
      expect(() => extractIdempotencyKey(request)).toThrowError(
        expect.objectContaining({ statusCode: 400, errorCode: "invalid_idempotency_key" }),
      );
    });

    it("computeCanonicalRequestHash is deterministic", async () => {
      const { computeCanonicalRequestHash } = await import("../src/lib/jellyhunt/v2/idempotency");
      const a = await computeCanonicalRequestHash("POST", "/api/v2/submissions", { b: 1, a: 2 });
      const b = await computeCanonicalRequestHash("POST", "/api/v2/submissions", { a: 2, b: 1 });
      expect(a).toBe(b);
    });
  });
});
