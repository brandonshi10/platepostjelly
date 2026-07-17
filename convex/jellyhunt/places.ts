import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { weekday } from "./validators";
import { assertPublicId, createPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { requireServiceKey } from "./security";

/**
 * Reviewed-place CRUD for the namespaced JellyHunt Convex schema. See
 * `convex/jellyhunt/audit.ts` for why these use `convex/server`'s generic
 * `mutationGeneric`/`queryGeneric` builders instead of a generated
 * `./_generated/server` (codegen has not run in this repo yet).
 */

const hoursArgs = v.optional(
  v.array(
    v.object({
      weekday,
      opensAt: v.string(),
      closesAt: v.string(),
    }),
  ),
);

/** Internal helper (not exported as a Convex function): load a place row by its public ID or throw. */
export async function loadPlaceByPublicId(ctx: any, placePublicId: string) {
  const normalized = assertPublicId("plc", placePublicId);
  const place = await ctx.db
    .query("jellyhuntPlaces")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!place) throw new Error("place_not_found");
  return place;
}

/** Public: reviewed place snapshot for map/detail rendering. */
export const getPlaceByPublicId = queryGeneric({
  args: { placePublicId: v.string() },
  handler: async (ctx: any, args: any) => {
    return await loadPlaceByPublicId(ctx, args.placePublicId);
  },
});

/** Admin/service-only: create a place. New places always start `reviewStatus: "draft"`. */
export const createPlace = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    jellyPlaceId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.number(),
    longitude: v.number(),
    geofenceRadiusMeters: v.number(),
    timeZone: v.string(),
    hours: hoursArgs,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    if (args.geofenceRadiusMeters <= 0) throw new Error("invalid_geofence_radius");

    const existing = await ctx.db
      .query("jellyhuntPlaces")
      .withIndex("by_jelly_place_id", (q: any) => q.eq("jellyPlaceId", args.jellyPlaceId))
      .unique();
    if (existing) throw new Error("place_already_linked_to_jelly_place_id");

    const now = Date.now();
    const publicId = createPublicId("plc");
    const placeId = await ctx.db.insert("jellyhuntPlaces", {
      publicId,
      jellyPlaceId: args.jellyPlaceId,
      name: args.name,
      address: args.address,
      latitude: args.latitude,
      longitude: args.longitude,
      geofenceRadiusMeters: args.geofenceRadiusMeters,
      timeZone: args.timeZone,
      hours: args.hours,
      reviewStatus: "draft",
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: args.actorId,
      action: "place.created",
      entityType: "place",
      entityId: placeId,
      nextState: { publicId, jellyPlaceId: args.jellyPlaceId, reviewStatus: "draft" },
      requestId: args.requestId,
    });

    return publicId;
  },
});

/** Admin/service-only: mark a place `draft` or `reviewed`. Activation requires `reviewed`. */
export const setPlaceReviewStatus = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    placePublicId: v.string(),
    reviewStatus: v.union(v.literal("draft"), v.literal("reviewed")),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const place = await loadPlaceByPublicId(ctx, args.placePublicId);
    const previousReviewStatus = place.reviewStatus;
    if (previousReviewStatus === args.reviewStatus) return place.publicId;

    await ctx.db.patch(place._id, { reviewStatus: args.reviewStatus, updatedAt: Date.now() });

    await recordAuditEvent(ctx, {
      actor: args.actorId,
      action: "place.review_status_changed",
      entityType: "place",
      entityId: place._id,
      previousState: { reviewStatus: previousReviewStatus },
      nextState: { reviewStatus: args.reviewStatus },
      requestId: args.requestId,
    });

    return place.publicId;
  },
});
