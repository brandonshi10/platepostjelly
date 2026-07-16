import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertServiceKey } from "./security";
import {
  missionValidationOptions,
  validateLocationInput,
  validateMissionInput,
} from "./validation";

const missionStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);
const approvalMode = v.union(v.literal("manual"), v.literal("automatic"));
const difficulty = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
  v.literal("legendary"),
);

const locationArgs = {
  name: v.string(),
  address: v.optional(v.string()),
  jellyRestaurantId: v.optional(v.string()),
  latitude: v.number(),
  longitude: v.number(),
  geofenceRadiusMeters: v.number(),
  timeZone: v.string(),
};

const missionArgs = {
  slug: v.string(),
  title: v.string(),
  description: v.string(),
  status: missionStatus,
  approvalMode,
  restaurantTag: v.string(),
  rewardAmount: v.number(),
  category: v.string(),
  difficulty,
  emoji: v.string(),
  neighborhood: v.string(),
  price: v.string(),
  hours: v.array(v.string()),
  venueType: v.optional(v.string()),
  showtimes: v.optional(v.array(v.string())),
  sortOrder: v.number(),
  websiteUrl: v.optional(v.string()),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
};

async function audit(
  ctx: any,
  event: {
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    previousState?: string;
    nextState?: string;
    metadata?: unknown;
  },
) {
  await ctx.db.insert("auditEvents", {
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    previousState: event.previousState,
    nextState: event.nextState,
    metadataJson: event.metadata === undefined ? undefined : JSON.stringify(event.metadata),
    createdAt: Date.now(),
  });
}

function cleanOptional(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function cleanLocation(input: any) {
  return {
    name: input.name.trim(),
    address: cleanOptional(input.address),
    jellyRestaurantId: cleanOptional(input.jellyRestaurantId),
    latitude: input.latitude,
    longitude: input.longitude,
    geofenceRadiusMeters: input.geofenceRadiusMeters,
    timeZone: input.timeZone.trim(),
  };
}

function cleanMission(input: any) {
  return {
    slug: input.slug.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    status: input.status,
    approvalMode: input.approvalMode,
    restaurantTag: input.restaurantTag.trim(),
    rewardAmount: input.rewardAmount,
    category: input.category.trim(),
    difficulty: input.difficulty,
    emoji: input.emoji.trim(),
    neighborhood: input.neighborhood.trim(),
    price: input.price.trim(),
    hours: input.hours,
    venueType: cleanOptional(input.venueType),
    showtimes: input.showtimes,
    sortOrder: input.sortOrder,
    websiteUrl: cleanOptional(input.websiteUrl),
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  };
}

async function ensureUniqueSlug(ctx: any, slug: string, exceptMissionId?: any) {
  const existing = await ctx.db
    .query("missions")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .unique();
  if (existing && existing._id !== exceptMissionId) {
    throw new Error("Mission slug already exists");
  }
}

async function insertLocation(ctx: any, input: any, actor: string) {
  const location = cleanLocation(input);
  validateLocationInput(location);
  const timestamp = Date.now();
  const locationId = await ctx.db.insert("locations", {
    ...location,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await audit(ctx, {
    actor,
    action: "location.created",
    entityType: "location",
    entityId: locationId,
    nextState: "created",
  });
  return locationId;
}

async function patchLocation(ctx: any, locationId: any, input: any, actor: string) {
  const existing = await ctx.db.get(locationId);
  if (!existing) throw new Error("Location not found");
  const location = cleanLocation(input);
  validateLocationInput(location);
  await ctx.db.patch(locationId, { ...location, updatedAt: Date.now() });
  await audit(ctx, {
    actor,
    action: "location.updated",
    entityType: "location",
    entityId: locationId,
    previousState: "existing",
    nextState: "updated",
  });
}

async function insertMission(
  ctx: any,
  input: any,
  locationId: any,
  actor: string,
) {
  const mission = cleanMission(input);
  validateMissionInput(mission, missionValidationOptions());
  await ensureUniqueSlug(ctx, mission.slug);
  const timestamp = Date.now();
  const missionId = await ctx.db.insert("missions", {
    ...mission,
    locationId,
    rewardToken: "JELLY-MY-JELLY",
    revision: 1,
    createdBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await audit(ctx, {
    actor,
    action: "mission.created",
    entityType: "mission",
    entityId: missionId,
    nextState: mission.status,
    metadata: { slug: mission.slug, revision: 1 },
  });
  return missionId;
}

async function patchMission(
  ctx: any,
  missionId: any,
  input: any,
  locationId: any,
  actor: string,
) {
  const existing = await ctx.db.get(missionId);
  if (!existing) throw new Error("Mission not found");
  const mission = cleanMission(input);
  validateMissionInput(mission, missionValidationOptions());
  await ensureUniqueSlug(ctx, mission.slug, missionId);
  const revision = existing.revision + 1;
  await ctx.db.patch(missionId, {
    ...mission,
    locationId,
    rewardToken: "JELLY-MY-JELLY",
    revision,
    updatedAt: Date.now(),
  });
  await audit(ctx, {
    actor,
    action: "mission.updated",
    entityType: "mission",
    entityId: missionId,
    previousState: existing.status,
    nextState: mission.status,
    metadata: { slug: mission.slug, revision },
  });
  return missionId;
}

export const listPublicMissions = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.now) || args.now < 0) throw new Error("Invalid current time");
    const missions = await ctx.db
      .query("missions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const visible = missions
      .filter(
        (mission) =>
          (!mission.startsAt || mission.startsAt <= args.now) &&
          (!mission.endsAt || mission.endsAt >= args.now),
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);

    return Promise.all(
      visible.map(async (mission) => ({
        ...mission,
        location: await ctx.db.get(mission.locationId),
      })),
    );
  },
});

export const listAdminMissions = query({
  args: { serviceKey: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const missions = await ctx.db.query("missions").order("desc").collect();
    return Promise.all(
      missions.map(async (mission) => ({
        ...mission,
        location: await ctx.db.get(mission.locationId),
      })),
    );
  },
});

export const createLocation = mutation({
  args: { serviceKey: v.string(), ...locationArgs, actor: v.string() },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const { serviceKey: _serviceKey, actor, ...input } = args;
    return await insertLocation(ctx, input, actor);
  },
});

export const updateLocation = mutation({
  args: {
    serviceKey: v.string(),
    locationId: v.id("locations"),
    ...locationArgs,
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const { serviceKey: _serviceKey, actor, locationId, ...input } = args;
    await patchLocation(ctx, locationId, input, actor);
    return locationId;
  },
});

export const createMission = mutation({
  args: {
    serviceKey: v.string(),
    ...missionArgs,
    locationId: v.id("locations"),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const location = await ctx.db.get(args.locationId);
    if (!location) throw new Error("Location not found");
    const { serviceKey: _serviceKey, actor, locationId, ...input } = args;
    return await insertMission(ctx, input, locationId, actor);
  },
});

export const updateMission = mutation({
  args: {
    serviceKey: v.string(),
    missionId: v.id("missions"),
    ...missionArgs,
    locationId: v.id("locations"),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const location = await ctx.db.get(args.locationId);
    if (!location) throw new Error("Location not found");
    const { serviceKey: _serviceKey, actor, missionId, locationId, ...input } = args;
    return await patchMission(ctx, missionId, input, locationId, actor);
  },
});

export const createMissionWithLocation = mutation({
  args: {
    serviceKey: v.string(),
    actor: v.string(),
    mission: v.object(missionArgs),
    location: v.object(locationArgs),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const location = cleanLocation(args.location);
    const mission = cleanMission(args.mission);
    validateLocationInput(location);
    validateMissionInput(mission, missionValidationOptions());
    await ensureUniqueSlug(ctx, mission.slug);

    const locationId = await insertLocation(ctx, location, args.actor);
    const missionId = await insertMission(ctx, mission, locationId, args.actor);
    return { missionId, locationId };
  },
});

export const updateMissionWithLocation = mutation({
  args: {
    serviceKey: v.string(),
    actor: v.string(),
    missionId: v.id("missions"),
    locationId: v.id("locations"),
    mission: v.object(missionArgs),
    location: v.object(locationArgs),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const existingMission = await ctx.db.get(args.missionId);
    if (!existingMission) throw new Error("Mission not found");
    if (existingMission.locationId !== args.locationId) {
      throw new Error("Location does not belong to mission");
    }

    const location = cleanLocation(args.location);
    const mission = cleanMission(args.mission);
    validateLocationInput(location);
    validateMissionInput(mission, missionValidationOptions());
    await ensureUniqueSlug(ctx, mission.slug, args.missionId);

    await patchLocation(ctx, args.locationId, location, args.actor);
    await patchMission(ctx, args.missionId, mission, args.locationId, args.actor);
    return { missionId: args.missionId, locationId: args.locationId };
  },
});

export const updateMissionStatus = mutation({
  args: {
    serviceKey: v.string(),
    missionId: v.id("missions"),
    status: missionStatus,
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    assertServiceKey(args.serviceKey);
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found");
    if (args.status === "active") {
      validateMissionInput(mission, missionValidationOptions());
    }
    await ctx.db.patch(args.missionId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: args.actor,
      action: "mission.status_updated",
      entityType: "mission",
      entityId: args.missionId,
      previousState: mission.status,
      nextState: args.status,
    });
  },
});
