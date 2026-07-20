import {
  anyApi,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { getJellyHttpConfig, jellyGet } from "./jellyHttpClient";
import {
  normalizeLeaderboardUsername,
  refreshLeaderboardProfileProjection,
} from "./leaderboards";

/** Minimal canonical Jelly profile cache used by ranking projections. */

function computePublicEligible(accountState: string, username: string): boolean {
  return accountState === "active" && username.trim().length > 0;
}

function normalizeUsername(username: string): string {
  return normalizeLeaderboardUsername(username);
}

function toCanonicalPublicProfile(profile: any) {
  return {
    jellyUserId: profile.jellyUserId,
    username: profile.username,
    ...(profile.jellyProfileRevision !== undefined
      ? { jellyProfileRevision: profile.jellyProfileRevision }
      : {}),
    refreshedAt: profile.refreshedAt,
  };
}

/** Internal helper: create or refresh the cached public profile for a Jelly user. */
export const upsertPublicProfile = internalMutationGeneric({
  args: {
    jellyUserId: v.string(),
    username: v.string(),
    accountState: v.union(
      v.literal("active"),
      v.literal("deleted"),
      v.literal("moderated"),
      v.literal("unknown"),
    ),
    jellyProfileRevision: v.optional(v.number()),
    requestId: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    const jellyUserId = args.jellyUserId.trim();
    const normalizedUsername = normalizeUsername(args.username);
    const publicEligible = computePublicEligible(args.accountState, args.username);

    const existing = await ctx.db
      .query("jellyhuntPublicProfiles")
      .withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", jellyUserId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        username: args.username,
        normalizedUsername,
        accountState: args.accountState,
        publicEligible,
        jellyProfileRevision: args.jellyProfileRevision,
        refreshedAt: args.now,
        updatedAt: args.now,
      });
      await refreshLeaderboardProfileProjection(ctx, {
        jellyUserId,
        normalizedUsername,
        publicEligible,
        profileRevision: args.jellyProfileRevision,
        requestId: args.requestId,
        now: args.now,
      });
      return existing.jellyUserId;
    }

    await ctx.db.insert("jellyhuntPublicProfiles", {
      jellyUserId,
      username: args.username,
      normalizedUsername,
      accountState: args.accountState,
      publicEligible,
      jellyProfileRevision: args.jellyProfileRevision,
      refreshedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    });
    await refreshLeaderboardProfileProjection(ctx, {
      jellyUserId,
      normalizedUsername,
      publicEligible,
      profileRevision: args.jellyProfileRevision,
      requestId: args.requestId,
      now: args.now,
    });

    return jellyUserId;
  },
});

/** Internal helper: return only the canonical public fields for an eligible profile. */
export const getPublicProfile = internalQueryGeneric({
  args: { jellyUserId: v.string() },
  handler: async (ctx: any, args: any) => {
    const jellyUserId = args.jellyUserId.trim();
    const profile = await ctx.db
      .query("jellyhuntPublicProfiles")
      .withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", jellyUserId))
      .unique();
    if (!profile || profile.accountState !== "active" || !profile.publicEligible) return null;
    return toCanonicalPublicProfile(profile);
  },
});

const upsertPublicProfileInternal = anyApi.jellyhunt.profiles.upsertPublicProfile as FunctionReference<
  "mutation",
  "internal"
>;
const getPublicProfileInternal = anyApi.jellyhunt.profiles.getPublicProfile as FunctionReference<
  "query",
  "internal"
>;

/** Internal helper: fetch the canonical Jelly profile and refresh the local projection. */
export const fetchAndSyncProfile = internalActionGeneric({
  args: {
    jellyUserId: v.string(),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const jellyUserId = args.jellyUserId.trim();
    const config = getJellyHttpConfig();
    const response = await jellyGet(config, `/user/${encodeURIComponent(jellyUserId)}`, args.correlationId);

    if (response.status !== 200) return null;

    const username: string | undefined = response.body?.data?.user?.username;
    if (!username) return null;

    await ctx.runMutation(upsertPublicProfileInternal, {
      jellyUserId,
      username,
      accountState: "active",
      now: Date.now(),
    });

    return await ctx.runQuery(getPublicProfileInternal, { jellyUserId });
  },
});
