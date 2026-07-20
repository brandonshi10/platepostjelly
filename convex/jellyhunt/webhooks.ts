import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { createPublicId } from "./publicIds";

export async function computeHmacSignature(rawBody: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeSha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  _keyId: string,
  currentKey: string,
  previousKey?: string,
): Promise<boolean> {
  const expectedCurrent = await computeHmacSignature(rawBody, currentKey);
  if (constantTimeEqual(signature, expectedCurrent)) return true;
  if (previousKey) {
    const expectedPrevious = await computeHmacSignature(rawBody, previousKey);
    if (constantTimeEqual(signature, expectedPrevious)) return true;
  }
  return false;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export const ingestWebhookEvent = mutationGeneric({
  args: {
    jellyEventId: v.string(),
    keyId: v.string(),
    bodyHash: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    sequence: v.number(),
    eventType: v.string(),
    rawBody: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("jellyhuntWebhookInbox")
      .withIndex("by_jelly_event_id", (q: any) => q.eq("jellyEventId", args.jellyEventId))
      .unique();

    if (existing) {
      if (existing.bodyHash === args.bodyHash) {
        return { status: 204, duplicate: true };
      }
      return { status: 409, duplicate: false, reason: "event_id_body_mismatch" };
    }

    await ctx.db.insert("jellyhuntWebhookInbox", {
      jellyEventId: args.jellyEventId,
      keyId: args.keyId,
      bodyHash: args.bodyHash,
      entityType: args.entityType,
      entityId: args.entityId,
      sequence: args.sequence,
      eventType: args.eventType,
      receivedAt: now,
    });

    const eventPublicId = createPublicId("evt");
    await ctx.db.insert("jellyhuntWebhookEvents", {
      publicId: eventPublicId,
      type: args.eventType,
      entityType: args.entityType,
      entityId: args.entityId,
      sequence: args.sequence,
      payloadJson: args.rawBody,
      occurredAt: now,
      createdAt: now,
    });

    return { status: 200, duplicate: false, eventPublicId };
  },
});
