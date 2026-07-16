import { describe, expect, it, vi } from "vitest";
import { fetchTextWithTimeout } from "../convex/http";

describe("Convex outbound HTTP bounds", () => {
  it("returns both the response and its text", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const result = await fetchTextWithTimeout("https://example.test", {}, 100, fetchImpl);
    expect(result.response.status).toBe(200);
    expect(result.text).toBe('{"ok":true}');
  });

  it("aborts a request that does not complete in time", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    );
    await expect(
      fetchTextWithTimeout("https://example.test", {}, 5, fetchImpl),
    ).rejects.toThrow("aborted");
  });
});
