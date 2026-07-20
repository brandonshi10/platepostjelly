import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { lifecycle, rewardTokenCode } from "./validators";
import { assertPublicId, createPublicId } from "./publicIds";
import { recordAuditEvent } from "./audit";
import { requireServiceKey } from "./security";

/**
 * Campaign mutations/queries for the namespaced JellyHunt Convex schema.
 *
 * See `convex/jellyhunt/audit.ts` for why these are built on
 * `mutationGeneric`/`queryGeneric` from `convex/server` instead of a
 * generated `./_generated/server` (codegen has not run in this repo yet).
 */

/** The single native/web start-link base every mission `start` link is built from (see the v2 design doc). */
export const UNIVERSAL_START_LINK_BASE = "https://platepost.io/human-social/missions";

export type CurrentCampaignResult = {
  campaignPublicId: string;
  catalogRevision: number;
  leaderboardRevision: number;
  startsAt: number;
  endsAt: number;
  map: { centerLatitude: number; centerLongitude: number; zoom: number };
  appLinks: { ios: string; android: string; universalStartBase: string };
};

function toCurrentCampaignResult(campaign: any): CurrentCampaignResult {
  return {
    campaignPublicId: campaign.publicId,
    catalogRevision: campaign.catalogRevision,
    leaderboardRevision: campaign.leaderboardRevision,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    map: {
      centerLatitude: campaign.map.centerLatitude,
      centerLongitude: campaign.map.centerLongitude,
      zoom: campaign.map.defaultZoom,
    },
    appLinks: {
      ios: campaign.links.iosApp ?? "",
      android: campaign.links.androidApp ?? "",
      universalStartBase: UNIVERSAL_START_LINK_BASE,
    },
  };
}

/** Internal helper (not exported as a Convex function): load a campaign row by its public ID or throw. */
export async function loadCampaignByPublicId(ctx: any, campaignPublicId: string) {
  const normalized = assertPublicId("cam", campaignPublicId);
  const campaign = await ctx.db
    .query("jellyhuntCampaigns")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", normalized))
    .unique();
  if (!campaign) throw new Error("campaign_not_found");
  return campaign;
}

const mapArgs = v.object({
  centerLatitude: v.number(),
  centerLongitude: v.number(),
  boundsSouth: v.number(),
  boundsWest: v.number(),
  boundsNorth: v.number(),
  boundsEast: v.number(),
  defaultZoom: v.number(),
});

const linksArgs = v.object({
  rules: v.optional(v.string()),
  iosApp: v.optional(v.string()),
  androidApp: v.optional(v.string()),
  support: v.optional(v.string()),
});

/** Public: the exactly-one-or-zero `isCurrent` campaign for map/mission/leaderboard discovery. */
export const getCurrentCampaign = queryGeneric({
  args: {},
  handler: async (ctx: any) => {
    const campaign = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true))
      .unique();
    if (!campaign) throw new Error("campaign_not_found");
    return toCurrentCampaignResult(campaign);
  },
});

/** Admin/service-only: create a new campaign. It never starts current; use `selectCurrentCampaign`. */
export const createCampaign = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    shortTitle: v.optional(v.string()),
    status: lifecycle,
    startsAt: v.number(),
    endsAt: v.number(),
    claimsCloseAt: v.optional(v.number()),
    timeZone: v.string(),
    rewardTokenCode,
    rewardTokenDisplayName: v.string(),
    map: mapArgs,
    links: linksArgs,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    // `actorId` is a Jelly-sourced ID: trim surrounding whitespace at ingest
    // but never lowercase it (design spec: "Jelly IDs are trimmed but never
    // lowercased").
    const actorId = args.actorId.trim();
    if (args.startsAt >= args.endsAt) throw new Error("invalid_campaign_window");

    const existingSlug = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_slug", (q: any) => q.eq("slug", args.slug))
      .unique();
    if (existingSlug) throw new Error("campaign_slug_already_exists");

    const now = Date.now();
    const publicId = createPublicId("cam");
    const campaignId = await ctx.db.insert("jellyhuntCampaigns", {
      publicId,
      slug: args.slug,
      title: args.title,
      shortTitle: args.shortTitle,
      status: args.status,
      isCurrent: false,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      claimsCloseAt: args.claimsCloseAt,
      timeZone: args.timeZone,
      rewardToken: { code: args.rewardTokenCode, displayName: args.rewardTokenDisplayName },
      map: args.map,
      links: args.links,
      catalogRevision: 0,
      leaderboardRevision: 0,
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "campaign.created",
      entityType: "campaign",
      entityId: campaignId,
      nextState: { publicId, slug: args.slug, status: args.status },
      requestId: args.requestId,
    });

    return publicId;
  },
});

/**
 * Admin/service-only: select the exactly-one current campaign in one
 * atomic mutation.
 *
 * Validates the target campaign exists and is not archived *before*
 * touching any row, so a rejected selection never clears the previously
 * current campaign. On success it clears the prior current campaign (when
 * different), sets the requested campaign current, increments both
 * affected campaigns' `catalogRevision` (an unchanged-but-still-current
 * campaign's revision is not bumped a second time), and appends one audit
 * event.
 */
export const selectCurrentCampaign = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    campaignPublicId: v.string(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();
    const target = await loadCampaignByPublicId(ctx, args.campaignPublicId);
    if (target.status === "archived") throw new Error("archived_campaign_cannot_be_current");

    const now = Date.now();
    const priorCurrent = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true))
      .unique();

    if (priorCurrent && priorCurrent._id === target._id) {
      // Idempotent replay: already the current campaign, nothing to change.
      return toCurrentCampaignResult(target);
    }

    if (priorCurrent) {
      await ctx.db.patch(priorCurrent._id, {
        isCurrent: false,
        catalogRevision: priorCurrent.catalogRevision + 1,
        updatedAt: now,
      });
    }

    await ctx.db.patch(target._id, {
      isCurrent: true,
      catalogRevision: target.catalogRevision + 1,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "campaign.selected_current",
      entityType: "campaign",
      entityId: target._id,
      previousState: { currentCampaignPublicId: priorCurrent?.publicId ?? null },
      nextState: { currentCampaignPublicId: target.publicId },
      requestId: args.requestId,
    });

    const updated = await ctx.db.get(target._id);
    return toCurrentCampaignResult(updated);
  },
});
