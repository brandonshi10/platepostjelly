import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { assertPublicId, createPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { loadMissionByPublicId } from "./missions";
import { requireServiceKey } from "./security";

/**
 * Participation lifecycle (start) for the namespaced JellyHunt Convex
 * schema. See `convex/jellyhunt/audit.ts` for why these use
 * `convex/server`'s generic `mutationGeneric`/`queryGeneric` builders
 * instead of a generated `./_generated/server` (codegen has not run in
 * this repo yet).
 *
 * `startParticipation` is a user-facing (non-admin) mutation: it does not
 * requires a `serviceKey` because it is invoked by the trusted Next server on behalf of a Jelly user
 * starting a mission, not an operator. It enforces the design doc's "one
 * active participation per user/mission" invariant via the
 * `by_user_mission_status` index and is idempotent under retry as long as
 * the caller-supplied `expectedMissionRevision` still matches the
 * mission's currently published revision.
 */

const SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Internal helper (not exported as a Convex function): load a participation row by its public ID or throw. */
export async function loadParticipationByPublicId(ctx: any, participationPublicId: string) {
  const normalized = assertPublicId("par", participationPublicId);
  const participation = await ctx.db
    .query("jellyhuntParticipations")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!participation) throw new Error("participation_not_found");
  return participation;
}

async function loadMissionCurrentRevisionRow(ctx: any, mission: any) {
  const revision = await ctx.db
    .query("jellyhuntMissionRevisions")
    .withIndex("by_mission_revision", (q: any) => q.eq("missionId", mission._id).eq("revision", mission.currentRevision))
    .unique();
  if (!revision) throw new Error("mission_has_no_published_revision");
  return revision;
}

/**
 * User-facing: start (or idempotently replay) a participation for a
 * mission.
 *
 * Validates the mission is `active` and `acceptingSubmissions`, and that
 * `expectedMissionRevision` still matches the mission's currently
 * published revision (otherwise `participation_revision_locked`, since the
 * caller fetched a mission detail that has since republished). If the user
 * already has a `started` participation for this mission at the same
 * revision, that row is returned unchanged (`created: false`) rather than
 * inserting a duplicate — this keeps the "one active participation per
 * user/mission" invariant intact under retried/duplicate client requests.
 */
export const startParticipation = mutationGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    missionPublicId: v.string(),
    expectedMissionRevision: v.number(),
    requestId: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const now = args.now ?? Date.now();

    const mission = await loadMissionByPublicId(ctx, args.missionPublicId);
    if (mission.status !== "active") throw new Error("mission_not_active");
    if (!mission.acceptingSubmissions) throw new Error("mission_not_accepting_submissions");
    if (mission.currentRevision !== args.expectedMissionRevision) {
      throw new Error("participation_revision_locked");
    }

    const place = await ctx.db.get(mission.placeId);
    if (!place) throw new Error("place_not_found");

    const existing = await ctx.db
      .query("jellyhuntParticipations")
      .withIndex("by_user_mission_status", (q: any) =>
        q.eq("jellyUserId", jellyUserId).eq("missionId", mission._id).eq("status", "started"),
      )
      .unique();

    if (existing) {
      if (existing.missionRevision !== mission.currentRevision) {
        throw new Error("participation_revision_locked");
      }
      return {
        created: false,
        participationPublicId: existing.publicId,
        missionPublicId: mission.publicId,
        missionRevision: existing.missionRevision,
        jellyPlaceId: place.jellyPlaceId,
        startedAt: existing.startedAt,
        submissionDeadlineAt: existing.submissionDeadlineAt,
      };
    }

    const revision = await loadMissionCurrentRevisionRow(ctx, mission);
    const maxAttempts = revision.requirements.resubmission.maxAttempts;

    const publicId = createPublicId("par");
    const submissionDeadlineAt = now + SUBMISSION_WINDOW_MS;

    await ctx.db.insert("jellyhuntParticipations", {
      publicId,
      jellyUserId,
      missionId: mission._id,
      campaignId: mission.campaignId,
      missionRevision: mission.currentRevision,
      status: "started",
      startedAt: now,
      submissionDeadlineAt,
      attemptsUsed: 0,
      maxAttempts,
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: jellyUserId,
      action: "participation.started",
      entityType: "participation",
      entityId: publicId,
      nextState: { publicId, missionPublicId: mission.publicId, missionRevision: mission.currentRevision },
      requestId: args.requestId,
    });

    return {
      created: true,
      participationPublicId: publicId,
      missionPublicId: mission.publicId,
      missionRevision: mission.currentRevision,
      jellyPlaceId: place.jellyPlaceId,
      startedAt: now,
      submissionDeadlineAt,
    };
  },
});

/** User-facing: fetch a participation by public ID, scoped to its owner. */
export const getParticipationByPublicId = queryGeneric({
  args: {
    serviceKey: v.string(),
    participationPublicId: v.string(),
    jellyUserId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const normalized = assertPublicId("par", args.participationPublicId);
    const participation = await ctx.db
      .query("jellyhuntParticipations")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
      .unique();
    if (!participation || participation.jellyUserId !== jellyUserId) return null;

    const mission = await ctx.db.get(participation.missionId);
    const place = mission ? await ctx.db.get(mission.placeId) : null;

    return {
      id: participation.publicId,
      missionId: mission?.publicId ?? null,
      placeId: place?.publicId ?? null,
      missionRevision: participation.missionRevision,
      status: participation.status,
      startedAt: participation.startedAt,
      submissionDeadlineAt: participation.submissionDeadlineAt,
      resubmissionDeadlineAt: participation.resubmissionDeadlineAt,
      attemptsUsed: participation.attemptsUsed,
      maxAttempts: participation.maxAttempts,
    };
  },
});

/** User-facing: list a user's participations, most recently started first. */
export const listUserParticipations = queryGeneric({
  args: {
    serviceKey: v.string(),
    jellyUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const jellyUserId = args.jellyUserId.trim();
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 200);

    const participations = await ctx.db
      .query("jellyhuntParticipations")
      .withIndex("by_user_mission", (q: any) => q.eq("jellyUserId", jellyUserId))
      .collect();

    participations.sort((a: any, b: any) => b.startedAt - a.startedAt);
    const page = participations.slice(0, limit);

    return await Promise.all(
      page.map(async (participation: any) => {
        const mission = await ctx.db.get(participation.missionId);
        return {
          id: participation.publicId,
          missionId: mission?.publicId ?? null,
          missionRevision: participation.missionRevision,
          status: participation.status,
          startedAt: participation.startedAt,
          submissionDeadlineAt: participation.submissionDeadlineAt,
          resubmissionDeadlineAt: participation.resubmissionDeadlineAt,
          attemptsUsed: participation.attemptsUsed,
          maxAttempts: participation.maxAttempts,
        };
      }),
    );
  },
});
