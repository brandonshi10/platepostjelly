import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCanonicalUsername } from "../src/lib/jellyhunt/v2/jelly-mission-token";
import { deriveDisplayState } from "../src/lib/jellyhunt/v2/status";
import { extractIdempotencyKey } from "../src/lib/jellyhunt/v2/idempotency";
import { hashCursorSubject, openCursor, sealCursor } from "../src/lib/jellyhunt/v2/cursor";
import { semanticEtag } from "../src/lib/jellyhunt/v2/cache";

describe("JellyHunt v2 primitive hardening", () => {
  it("normalizes canonical usernames with NFKC and en-US lowercase", () => {
    expect(normalizeCanonicalUsername("  ＪＥＬＬＹＦＡＮ  ")).toBe("jellyfan");
  });

  it("rejects an oversized idempotency key instead of truncating it", () => {
    const request = new Request("https://platepost.io/api/v2/jellyhunt/missions/mis_1/submissions", {
      headers: { "Idempotency-Key": "x".repeat(129) },
    });

    expect(() => extractIdempotencyKey(request)).toThrowError(
      expect.objectContaining({ statusCode: 400, errorCode: "invalid_idempotency_key" }),
    );
  });

  it.each([
    [{ submissionStatus: "submitted", rewardStatus: "not_eligible" } as const, "submitted", "wait_for_verification"],
    [{ submissionStatus: "verifying", rewardStatus: "not_eligible" } as const, "under_review", "wait_for_verification"],
    [{ submissionStatus: "needs_review", rewardStatus: "not_eligible" } as const, "under_review", "wait_for_review"],
    [{ submissionStatus: "approved", rewardStatus: "queued" } as const, "approved_reward_pending", "wait_for_reward"],
    [{ submissionStatus: "approved", rewardStatus: "processing" } as const, "approved_reward_pending", "wait_for_reward"],
    [{ submissionStatus: "approved", rewardStatus: "sent" } as const, "rewarded", "view_reward"],
    [{ submissionStatus: "approved", rewardStatus: "failed" } as const, "support_needed", "contact_support"],
    [{ submissionStatus: "approved", rewardStatus: "uncertain" } as const, "support_needed", "contact_support"],
  ])("derives the closed display and next-action contract for %o", (input, displayStatus, nextAction) => {
    expect(deriveDisplayState(input)).toMatchObject({ displayStatus, nextAction });
  });

  describe("opaque cursors", () => {
    beforeEach(() => vi.stubEnv("JELLYHUNT_CURSOR_SECRET", "test-cursor-secret-with-sufficient-entropy"));
    afterEach(() => vi.unstubAllEnvs());

    it("binds subject and snapshot without embedding the raw Jelly user ID", async () => {
      const subject = "User_AbC";
      const subjectHash = await hashCursorSubject(subject);
      const payload = {
        version: 1 as const,
        resource: "me_submissions",
        subjectHash,
        queryHash: "query-hash",
        limit: 20,
        scopeKey: "me",
        snapshot: "as-of:42",
        lastSortValues: [42, "sub_1"],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      };
      const token = await sealCursor(payload);
      const decodedPayload = new TextDecoder().decode(
        Uint8Array.from(Buffer.from(token.split(".")[1]!, "base64url")),
      );

      expect(decodedPayload).not.toContain(subject);
      await expect(
        openCursor(token, {
          resource: "me_submissions",
          subject,
          queryHash: "query-hash",
          limit: 20,
          scopeKey: "me",
          snapshot: "as-of:42",
        }),
      ).resolves.toMatchObject({ subjectHash, snapshot: "as-of:42" });
    });

    it("returns the stable 400 invalid_cursor error for a stale snapshot", async () => {
      const token = await sealCursor({
        version: 1,
        resource: "leaderboard",
        queryHash: "query-hash",
        limit: 20,
        scopeKey: "campaign:mis_1",
        snapshot: "revision:7",
        lastSortValues: [-3, "jellyfan", "lbe_1"],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      });

      await expect(
        openCursor(token, {
          resource: "leaderboard",
          queryHash: "query-hash",
          limit: 20,
          scopeKey: "campaign:mis_1",
          snapshot: "revision:8",
        }),
      ).rejects.toMatchObject({ statusCode: 400, errorCode: "invalid_cursor" });
    });
  });

  it("excludes volatile envelope metadata from semantic ETags", async () => {
    const first = await semanticEtag({ data: { id: "mis_1", revision: 7 }, meta: { requestId: "req_1", generatedAt: "one" } });
    const second = await semanticEtag({ data: { id: "mis_1", revision: 7 }, meta: { requestId: "req_2", generatedAt: "two" } });
    expect(first).toBe(second);
  });
});