import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { rewardStatus, submissionStatus } from "./validators";
import { assertPublicId, createPublicId } from "./publicIds";
import { requireServiceKey } from "./security";

function toPublicEvent(event: any, submissionPublicId: string) {
  return {
    id: event.publicId,
    submissionId: submissionPublicId,
    sequence: event.sequence,
    type: event.type,
    submissionStatus: event.submissionStatus,
    rewardStatus: event.rewardStatus,
    displayStatus: event.displayStatus,
    ...(event.reasonCode !== undefined ? { reasonCode: event.reasonCode } : {}),
    ...(event.publicMessage !== undefined ? { publicMessage: event.publicMessage } : {}),
    occurredAt: event.occurredAt,
  };
}

async function loadSubmissionByPublicId(ctx: any, value: string) {
  const publicId = assertPublicId("sub", value);
  return await ctx.db
    .query("jellyhuntSubmissions")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", publicId))
    .unique();
}

export type SubmissionEventInput = {
  submissionPublicId: string;
  type: string;
  submissionStatus: "submitted" | "verifying" | "needs_review" | "approved" | "rejected";
  rewardStatus: "not_eligible" | "queued" | "processing" | "sent" | "failed" | "uncertain";
  displayStatus: string;
  reasonCode?: string;
  publicMessage?: string;
  internalMetadataJson?: string;
  occurredAt: number;
};
/** Plain helper for status changes that must commit atomically with their domain mutation. */
export async function appendSubmissionEventInternal(
  ctx: any,
  args: SubmissionEventInput,

): Promise<string> {
  const submission = await loadSubmissionByPublicId(ctx, args.submissionPublicId);
  if (!submission) throw new Error("submission_not_found");
  const jellyUserId = submission.jellyUserId;

  const existingForSubmission = await ctx.db
    .query("jellyhuntSubmissionEvents")
    .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
    .collect();
  const duplicate = existingForSubmission.find(
    (event: any) => event.type === args.type && event.occurredAt === args.occurredAt,
  );
  if (duplicate) return duplicate.publicId;

  const latestForUser = await ctx.db
    .query("jellyhuntSubmissionEvents")
    .withIndex("by_user_sequence", (q: any) => q.eq("jellyUserId", jellyUserId))
    .order("desc")
    .first();
  const nextSequence = (latestForUser?.sequence ?? 0) + 1;

  const publicId = createPublicId("evt");
  await ctx.db.insert("jellyhuntSubmissionEvents", {
    publicId,
    submissionId: submission._id,
    jellyUserId,
    sequence: nextSequence,
    type: args.type,
    submissionStatus: args.submissionStatus,
    rewardStatus: args.rewardStatus,
    displayStatus: args.displayStatus,
    reasonCode: args.reasonCode,
    publicMessage: args.publicMessage,
    internalMetadataJson: args.internalMetadataJson,
    occurredAt: args.occurredAt,
  });
  return publicId;
}

/** Internal Convex entry point delegates to the same-transaction helper above. */
export const appendSubmissionEvent = internalMutationGeneric({
  args: {
    submissionPublicId: v.string(),
    type: v.string(),
    submissionStatus,
    rewardStatus,
    displayStatus: v.string(),
    reasonCode: v.optional(v.string()),
    publicMessage: v.optional(v.string()),
    internalMetadataJson: v.optional(v.string()),
    occurredAt: v.number(),
  },
  handler: appendSubmissionEventInternal,
});
/** Trusted-server owner read by stable public submission ID, oldest first. */
export const listSubmissionEvents = queryGeneric({
  args: {
    serviceKey: v.string(),
    submissionPublicId: v.string(),
    jellyUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 200);
    const submission = await loadSubmissionByPublicId(ctx, args.submissionPublicId);
    if (!submission || submission.jellyUserId !== jellyUserId) return [];

    const events = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_submission_sequence", (q: any) => q.eq("submissionId", submission._id))
      .order("asc")
      .collect();
    return events.slice(0, limit).map((event: any) => toPublicEvent(event, submission.publicId));
  },
});

/** Trusted-server owner read across submissions, newest first. */
export const listUserEvents = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 200);
    const events = await ctx.db
      .query("jellyhuntSubmissionEvents")
      .withIndex("by_user_sequence", (q: any) => q.eq("jellyUserId", jellyUserId))
      .order("desc")
      .take(limit * 2);

    const projected = await Promise.all(
      events.map(async (event: any) => {
        const submission = await ctx.db.get(event.submissionId);
        if (!submission || submission.jellyUserId !== jellyUserId) return null;
        return toPublicEvent(event, submission.publicId);
      }),
    );
    return projected.filter((event: any) => event !== null).slice(0, limit);
  },
});
