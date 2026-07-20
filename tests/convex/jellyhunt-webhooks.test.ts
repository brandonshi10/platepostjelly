import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";
import { verifyWebhookSignature, computeHmacSignature, computeSha256Hex } from "../../convex/jellyhunt/webhooks";

const webhooks = anyApi.jellyhunt.webhooks;

describe("verifyWebhookSignature", () => {
  it("accepts a valid current key signature", async () => {
    const body = '{"eventId":"evt_1"}';
    const currentKey = "secret_current";
    const sig = await computeHmacSignature(body, currentKey);
    expect(await verifyWebhookSignature(body, sig, "key_1", currentKey)).toBe(true);
  });

  it("accepts a valid previous key signature during rotation", async () => {
    const body = '{"eventId":"evt_1"}';
    const previousKey = "secret_old";
    const sig = await computeHmacSignature(body, previousKey);
    expect(await verifyWebhookSignature(body, sig, "key_1", "secret_new", previousKey)).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    expect(await verifyWebhookSignature('{"x":1}', "badsig", "key_1", "secret")).toBe(false);
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
    const rawBody = '{"type":"reward.sent"}';
    const bodyHash = await computeSha256Hex(rawBody);
    const result = await t.mutation(webhooks.ingestWebhookEvent, {
      jellyEventId: "evt_unique_001",
      keyId: "key_1",
      bodyHash,
      rawBody,
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
    const rawBody = '{"type":"reward.sent"}';
    const bodyHash = await computeSha256Hex(rawBody);
    const args = {
      jellyEventId: "evt_dedup_001",
      keyId: "key_1",
      bodyHash,
      rawBody,
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
    const rawBody1 = '{"type":"reward.sent","v":1}';
    const rawBody2 = '{"type":"reward.sent","v":2}';
    await t.mutation(webhooks.ingestWebhookEvent, {
      jellyEventId: "evt_conflict_001",
      keyId: "key_1",
      bodyHash: await computeSha256Hex(rawBody1),
      rawBody: rawBody1,
      entityType: "reward_intent",
      entityId: "rwd_001",
      sequence: 1,
      eventType: "reward.sent",
    });

    const result = await t.mutation(webhooks.ingestWebhookEvent, {
      jellyEventId: "evt_conflict_001",
      keyId: "key_1",
      bodyHash: await computeSha256Hex(rawBody2),
      rawBody: rawBody2,
      entityType: "reward_intent",
      entityId: "rwd_001",
      sequence: 1,
      eventType: "reward.sent",
    });

    expect(result.status).toBe(409);
    expect(result.reason).toBe("event_id_body_mismatch");
  });
});
