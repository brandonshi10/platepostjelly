import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { assertPublicId } from "./publicIds";
import { requireServiceKey } from "./security";
import { recordAuditEvent } from "./audit";

export type LeaderboardScopeKey = `campaign:${string}` | "all_time";

export type LeaderboardStanding = {
  rank: number;
  username: string;
  approvedMissionCount: number;
};

export type LeaderboardCursorState = {
  eligibleItemsSeen: number;
  lastRank: number;
  lastScore: number;
  lastUsername: string;
  lastPublicId: string;
};

export type LeaderboardPage = {
  standings: LeaderboardStanding[];
  hasMore: boolean;
  cursorState: LeaderboardCursorState | null;
  revision: number;
};

export type LeaderboardProfileProjectionInput = {
  jellyUserId: string;
  normalizedUsername: string;
  publicEligible: boolean;
  profileRevision?: number;
  requestId?: string;
  now: number;
};

const cursorStateValidator = v.object({
  eligibleItemsSeen: v.number(),
  lastRank: v.number(),
  lastScore: v.number(),
  lastUsername: v.string(),
  lastPublicId: v.string(),
});

export function normalizeLeaderboardUsername(username: string): string {
  return username.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

async function loadProgramConfig(ctx: any) {
  const config = await ctx.db
    .query("jellyhuntProgramConfig")
    .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
    .unique();
  if (!config) throw new Error("leaderboard_program_config_not_found");
  return config;
}

async function loadCampaignForScope(ctx: any, scopeKey: string) {
  if (!scopeKey.startsWith("campaign:")) throw new Error("invalid_leaderboard_scope");
  const campaignPublicId = assertPublicId("cam", scopeKey.slice("campaign:".length));
  const campaign = await ctx.db
    .query("jellyhuntCampaigns")
    .withIndex("by_public_id", (q: any) => q.eq("publicId", campaignPublicId))
    .unique();
  if (!campaign) throw new Error("campaign_not_found");
  return campaign;
}

async function loadScopeRevision(ctx: any, scopeKey: string): Promise<number> {
  if (scopeKey === "all_time") return (await loadProgramConfig(ctx)).leaderboardRevision;
  return (await loadCampaignForScope(ctx, scopeKey)).leaderboardRevision;
}

export const getAllTimeLeaderboardContext = queryGeneric({
  args: { serviceKey: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const config = await loadProgramConfig(ctx);
    return {
      scopeKey: "all_time" as const,
      revision: config.leaderboardRevision,
      startsAt: config.leaderboardLaunchEpoch,
    };
  },
});

export const getCurrentSeasonLeaderboardContext = queryGeneric({
  args: { serviceKey: v.string() },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const campaign = await ctx.db
      .query("jellyhuntCampaigns")
      .withIndex("by_is_current", (q: any) => q.eq("isCurrent", true))
      .unique();
    if (!campaign) return null;
    return {
      scopeKey: `campaign:${campaign.publicId}`,
      revision: campaign.leaderboardRevision,
      campaign: {
        id: campaign.publicId,
        title: campaign.title,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      },
    };
  },
});

function isAfterCursor(entry: any, cursor: LeaderboardCursorState): boolean {
  if (entry.approvedMissionCount !== cursor.lastScore) {
    return entry.approvedMissionCount < cursor.lastScore;
  }
  if (entry.normalizedUsername !== cursor.lastUsername) {
    return entry.normalizedUsername > cursor.lastUsername;
  }
  return entry.publicId > cursor.lastPublicId;
}

export const listLeaderboard = queryGeneric({
  args: {
    serviceKey: v.string(),
    scopeKey: v.string(),
    limit: v.optional(v.number()),
    expectedRevision: v.optional(v.number()),
    resume: v.optional(cursorStateValidator),
  },
  handler: async (ctx: any, args: any): Promise<LeaderboardPage> => {
    requireServiceKey(args.serviceKey);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 20), 1), 100);
    const revision = await loadScopeRevision(ctx, args.scopeKey);
    if (args.expectedRevision !== undefined && args.expectedRevision !== revision) {
      throw new Error("leaderboard_revision_changed");
    }

    const scoreRows = await ctx.db
      .query("jellyhuntLeaderboardEntries")
      .withIndex("by_scope_public_rank", (q: any) => q.eq("scopeKey", args.scopeKey))
      .collect();

    const eligibleRows: any[] = [];
    for (const entry of scoreRows) {
      if (entry.approvedMissionCount <= 0) continue;
      const profile = await ctx.db
        .query("jellyhuntPublicProfiles")
        .withIndex("by_jelly_user_id", (q: any) => q.eq("jellyUserId", entry.jellyUserId))
        .unique();
      if (!profile || profile.accountState !== "active" || !profile.publicEligible) continue;
      const username = profile.username.trim();
      if (!username) continue;
      eligibleRows.push({
        publicId: entry.publicId,
        approvedMissionCount: entry.approvedMissionCount,
        normalizedUsername: normalizeLeaderboardUsername(username),
        username,
      });
    }

    eligibleRows.sort((left, right) =>
      right.approvedMissionCount - left.approvedMissionCount ||
      left.normalizedUsername.localeCompare(right.normalizedUsername, "en-US") ||
      left.publicId.localeCompare(right.publicId, "en-US"),
    );

    const remainingRows = args.resume
      ? eligibleRows.filter((entry) => isAfterCursor(entry, args.resume))
      : eligibleRows;
    const selectedRows = remainingRows.slice(0, limit);
    const hasMore = remainingRows.length > limit;

    const standings: LeaderboardStanding[] = [];
    let previousScore: number | undefined = args.resume?.lastScore;
    let previousRank = args.resume?.lastRank ?? 0;
    const alreadySeen = args.resume?.eligibleItemsSeen ?? 0;

    for (let index = 0; index < selectedRows.length; index += 1) {
      const entry = selectedRows[index];
      const absolutePosition = alreadySeen + index + 1;
      const rank = entry.approvedMissionCount === previousScore ? previousRank : absolutePosition;
      standings.push({
        rank,
        username: entry.username,
        approvedMissionCount: entry.approvedMissionCount,
      });
      previousScore = entry.approvedMissionCount;
      previousRank = rank;
    }

    const lastRow = selectedRows.at(-1);
    return {
      standings,
      hasMore,
      cursorState:
        hasMore && lastRow
          ? {
              eligibleItemsSeen: alreadySeen + selectedRows.length,
              lastRank: previousRank,
              lastScore: lastRow.approvedMissionCount,
              lastUsername: lastRow.normalizedUsername,
              lastPublicId: lastRow.publicId,
            }
          : null,
      revision,
    };
  },
});

async function bumpScopeRevision(ctx: any, scopeKey: string, now: number): Promise<number> {
  if (scopeKey === "all_time") {
    const config = await loadProgramConfig(ctx);
    const revision = config.leaderboardRevision + 1;
    await ctx.db.patch(config._id, { leaderboardRevision: revision, updatedAt: now });
    return revision;
  }

  const campaign = await loadCampaignForScope(ctx, scopeKey);
  const revision = campaign.leaderboardRevision + 1;
  await ctx.db.patch(campaign._id, { leaderboardRevision: revision, updatedAt: now });
  return revision;
}

/**
 * Plain mutation helper for the canonical profile sync transaction.
 * `profiles.upsertPublicProfile` should call this after writing the profile so
 * sort keys, visibility, revisions, ETags, and signed cursors change together.
 */
export async function refreshLeaderboardProfileProjection(
  ctx: any,
  args: LeaderboardProfileProjectionInput,
): Promise<{ updatedCount: number; updatedScopeKeys: string[] }> {
  const normalizedUsername = normalizeLeaderboardUsername(args.normalizedUsername);
  const entries = await ctx.db
    .query("jellyhuntLeaderboardEntries")
    .filter((q: any) => q.eq(q.field("jellyUserId"), args.jellyUserId))
    .collect();
  const updatedScopeKeys: string[] = [];

  for (const entry of entries) {
    const needsUpdate =
      entry.normalizedUsername !== normalizedUsername ||
      entry.publicEligible !== args.publicEligible ||
      entry.profileRevision !== args.profileRevision;
    if (!needsUpdate) continue;

    await ctx.db.patch(entry._id, {
      normalizedUsername,
      publicEligible: args.publicEligible,
      profileRevision: args.profileRevision,
      updatedAt: args.now,
    });
    updatedScopeKeys.push(entry.scopeKey);
  }

  for (const scopeKey of new Set(updatedScopeKeys)) {
    const revisionAfter = await bumpScopeRevision(ctx, scopeKey, args.now);
    await ctx.db.insert("jellyhuntLeaderboardEvents", {
      scopeKey,
      jellyUserId: args.jellyUserId,
      type: "profile_refresh",
      correlationId: args.requestId,
      requestId: args.requestId,
      revisionAfter,
      occurredAt: args.now,
    });
  }

  return { updatedCount: updatedScopeKeys.length, updatedScopeKeys: [...new Set(updatedScopeKeys)] };
}

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
    const result = await refreshLeaderboardProfileProjection(ctx, {
      jellyUserId: args.jellyUserId.trim(),
      normalizedUsername: args.normalizedUsername,
      publicEligible: args.publicEligible,
      profileRevision: args.profileRevision,
      requestId: args.requestId,
      now,
    });

    if (result.updatedCount > 0) {
      await recordAuditEvent(ctx, {
        actor: args.actorId,
        action: "leaderboard.profile_refreshed",
        entityType: "profile",
        entityId: args.jellyUserId,
        nextState: {
          normalizedUsername: normalizeLeaderboardUsername(args.normalizedUsername),
          publicEligible: args.publicEligible,
          updatedEntries: result.updatedCount,
        },
        requestId: args.requestId,
      });
    }

    return result;
  },
});