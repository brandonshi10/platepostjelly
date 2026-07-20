import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";
import { verifyWebhookSignature } from "../../convex/jellyhunt/webhooks";

const webhooks = anyApi.jellyhunt.webhooks;

describe("verifyWebhookSignature", () => {
  it("accepts a valid current key signature", () => {
    const body = '{"eventId":"evt_1"}';
    const currentKey = "secret_current";
    const sig = computeTestSignature(body, currentKey);
    expect(verifyWebhookSignature(body, sig, "key_1", currentKey)).toBe(true);
  });

  it("accepts a valid previous key signature during rotation", () => {
    const body = '{"eventId":"evt_1"}';
    const previousKey = "secret_old";
    const sig = computeTestSignature(body, previousKey);
    expect(verifyWebhookSignature(body, sig, "key_1", "secret_new", previousKey)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyWebhookSignature('{"x":1}', "badsig", "key_1", "secret")).toBe(false);
  });
});

describe("ingestWebhookEvent", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it("stores a new event and returns 200", async () => {
    const result = await t.mutation(webhooks.ingestWebhookEvent, {
      jellyEventId: "evt_unique_001",
      keyId: "key_1",
      rawBody: '{"type":"reward.sent"}',
      entityType: "reward_intent",
      entityId: "rwd_001",
      sequence: 1,
      eventType: "reward.sent",
    });

    expect(result.status).toBe(200);
    expect(result.duplicate).toBe(false);
    expect(result.eventPublicId).toMatch(/^evt_/);
  });

  it("returns 204 for exact duplicate (same event ID + same body)", async () => {
    const args = {
      jellyEventId: "evt_dedup_001",
      keyId: "key_1",
      rawBody: '{"type":"reward.sent"}',
      entityType: "reward_intent",
      entityId: "rwd_001",
      sequence: 1,
      eventType: "reward.sent",
    };

    await t.mutation(webhooks.ingestWebhookEvent, args);
    const result = await t.mutation(webhooks.ingestWebhookEvent, args);

    expect(result.status).toBe(204);
    expect(result.duplicate).toBe(true);
  });

  it("returns 409 for reused event ID with different body", async () => {
    await t.mutation(webhooks.ingestWebhookEvent, {
      jellyEventId: "evt_conflict_001",
      keyId: "key_1",
      rawBody: '{"type":"reward.sent","v":1}',
      entityType: "reward_intent",
      entityId: "rwd_001",
      sequence: 1,
      eventType: "reward.sent",
    });

    const result = await t.mutation(webhooks.ingestWebhookEvent, {
      jellyEventId: "evt_conflict_001",
      keyId: "key_1",
      rawBody: '{"type":"reward.sent","v":2}',
      entityType: "reward_intent",
      entityId: "rwd_001",
      sequence: 1,
      eventType: "reward.sent",
    });

    expect(result.status).toBe(409);
    expect(result.reason).toBe("event_id_body_mismatch");
  });
});

function computeTestSignature(body: string, secret: string): string {
  const data = `${secret}:${body}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
