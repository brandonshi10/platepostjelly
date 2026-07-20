import { queryGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { requireServiceKey } from "./security";
import { recordAuditEvent } from "./audit";

export type LeaderboardScopeKey = `campaign:${string}` | "all_time";

export type LeaderboardEntry = {
  publicId: string;
  rank: number;
  username: string;
  approvedMissionCount: number;
};

export type LeaderboardPage = {
  entries: LeaderboardEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  revision: number;
};

export const listLeaderboard = queryGeneric({
  args: {
    scopeKey: v.string(),
    limit: v.optional(v.number()),
    afterRank: v.optional(v.number()),
    afterScore: v.optional(v.number()),
    afterUsername: v.optional(v.string()),
    afterPublicId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 100);
    const scopeKey = args.scopeKey;

    let revision = 0;
    if (scopeKey === "all_time") {
      const config = await ctx.db
        .query("jellyhuntProgramConfig")
        .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
        .unique();
      revision = config?.leaderboardRevision ?? 0;
    } else if (scopeKey.startsWith("campaign:")) {
      const campaignInternalId = scopeKey.slice("campaign:".length);
      const campaign = await ctx.db.get(campaignInternalId);
      revision = campaign?.leaderboardRevision ?? 0;
    }

    let query = ctx.db
      .query("jellyhuntLeaderboardEntries")
      .withIndex("by_scope_public_rank", (q: any) => {
        let b = q.eq("scopeKey", scopeKey).eq("publicEligible", true);
        if (args.afterScore !== undefined && args.afterUsername !== undefined && args.afterPublicId !== undefined) {
          b = b.gt("rankSortScore", args.afterScore);
        }
        return b;
      })
      .order("asc");

    const candidates = await query.take(limit + 1);

    let startRank = args.afterRank ?? 0;
    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < Math.min(candidates.length, limit); i++) {
      const entry = candidates[i];
      startRank++;
      entries.push({
        publicId: entry.publicId,
        rank: startRank,
        username: entry.normalizedUsername,
        approvedMissionCount: entry.approvedMissionCount,
      });
    }

    const hasMore = candidates.length > limit;

    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
    const lastCandidate = entries.length > 0 ? candidates[entries.length - 1] : null;

    return {
      entries,
      hasMore,
      nextCursor: hasMore && lastCandidate
        ? JSON.stringify({
            afterRank: lastEntry!.rank,
            afterScore: lastCandidate.rankSortScore,
            afterUsername: lastCandidate.normalizedUsername,
            afterPublicId: lastCandidate.publicId,
          })
        : null,
      revision,
    };
  },
});

export const refreshProfileInLeaderboards = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    jellyUserId: v.string(),
    normalizedUsername: v.string(),
    publicEligible: v.boolean(),
    profileRevision: v.optional(v.number()),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const now = Date.now();
    let updatedCount = 0;

    const entries = await ctx.db
      .query("jellyhuntLeaderboardEntries")
      .withIndex("by_scope_public_rank")
      .filter((q: any) => q.eq(q.field("jellyUserId"), args.jellyUserId))
      .collect();

    for (const entry of entries) {
      const needsUpdate =
        entry.normalizedUsername !== args.normalizedUsername ||
        entry.publicEligible !== args.publicEligible ||
        entry.profileRevision !== args.profileRevision;

      if (needsUpdate) {
        await ctx.db.patch(entry._id, {
          normalizedUsername: args.normalizedUsername,
          publicEligible: args.publicEligible,
          profileRevision: args.profileRevision,
          updatedAt: now,
        });

        await ctx.db.insert("jellyhuntLeaderboardEvents", {
          scopeKey: entry.scopeKey,
          jellyUserId: args.jellyUserId,
          type: "profile_refresh",
          correlationId: args.requestId,
          requestId: args.requestId,
          occurredAt: now,
        });

        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      await recordAuditEvent(ctx, {
        actor: args.actorId,
        action: "leaderboard.profile_refreshed",
        entityType: "profile",
        entityId: args.jellyUserId,
        nextState: { normalizedUsername: args.normalizedUsername, publicEligible: args.publicEligible, updatedEntries: updatedCount },
        requestId: args.requestId,
      });
    }

    return { updatedCount };
  },
});
