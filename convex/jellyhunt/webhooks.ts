import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { createPublicId } from "./publicIds";

function sha256Hex(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  keyId: string,
  currentKey: string,
  previousKey?: string,
): boolean {
  const expectedCurrent = computeSignature(rawBody, currentKey);
  if (constantTimeEqual(signature, expectedCurrent)) return true;
  if (previousKey) {
    const expectedPrevious = computeSignature(rawBody, previousKey);
    if (constantTimeEqual(signature, expectedPrevious)) return true;
  }
  return false;
}

function computeSignature(rawBody: string, secret: string): string {
  return sha256Hex(`${secret}:${rawBody}`);
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
    rawBody: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    sequence: v.number(),
    eventType: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const bodyHash = sha256Hex(args.rawBody);

    const existing = await ctx.db
      .query("jellyhuntWebhookInbox")
      .withIndex("by_jelly_event_id", (q: any) => q.eq("jellyEventId", args.jellyEventId))
      .unique();

    if (existing) {
      if (existing.bodyHash === bodyHash) {
        return { status: 204, duplicate: true };
      }
      return { status: 409, duplicate: false, reason: "event_id_body_mismatch" };
    }

    await ctx.db.insert("jellyhuntWebhookInbox", {
      jellyEventId: args.jellyEventId,
      keyId: args.keyId,
      bodyHash,
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
