import "server-only";

import { z } from "zod";
import {
  computeQueryHash,
  openCursor,
  sealCursor,
  type CursorPayload,
} from "./cursor";
import { invalidCursor } from "./errors";
import { parseQuery } from "./public-route-utils";
import { listLeaderboard } from "./repository";
import type { V2RouteResult } from "./route-handler";
import type {
  LeaderboardData,
  LeaderboardStanding,
} from "./contracts/leaderboards";

const LeaderboardQuery = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .transform(Number)
      .default("20"),
  })
  .strict();

export type LeaderboardResume = {
  eligibleItemsSeen: number;
  lastRank: number;
  lastScore: number;
  lastUsername: string;
  lastPublicId: string;
};

export type LeaderboardRepositoryPage = {
  standings: LeaderboardStanding[];
  hasMore: boolean;
  cursorState: LeaderboardResume | null;
  revision: number;
};

function parseResume(payload: CursorPayload): LeaderboardResume {
  const [eligibleItemsSeen, lastRank, lastScore, lastUsername, lastPublicId] =
    payload.lastSortValues;
  if (
    payload.lastSortValues.length !== 5 ||
    !Number.isInteger(eligibleItemsSeen) ||
    (eligibleItemsSeen as number) < 1 ||
    !Number.isInteger(lastRank) ||
    (lastRank as number) < 1 ||
    !Number.isInteger(lastScore) ||
    (lastScore as number) < 1 ||
    typeof lastUsername !== "string" ||
    !lastUsername ||
    typeof lastPublicId !== "string" ||
    !lastPublicId
  ) {
    throw invalidCursor();
  }
  return {
    eligibleItemsSeen: eligibleItemsSeen as number,
    lastRank: lastRank as number,
    lastScore: lastScore as number,
    lastUsername,
    lastPublicId,
  };
}

function cursorTimes(now: number): { issuedAt: number; expiresAt: number } {
  const fiveMinutes = 5 * 60 * 1000;
  const issuedAt = Math.floor(now / fiveMinutes) * fiveMinutes;
  return { issuedAt, expiresAt: issuedAt + 15 * 60 * 1000 };
}

export async function leaderboardRouteResult(
  request: Request,
  options: {
    resource: "leaderboard:all-time" | "leaderboard:current-season";
    scopeKey: string;
    revision: number;
    buildData: (standings: LeaderboardStanding[]) => LeaderboardData;
  },
): Promise<V2RouteResult<LeaderboardData>> {
  const query = parseQuery(request, LeaderboardQuery);
  const queryHash = await computeQueryHash({});
  const snapshot = String(options.revision);
  const binding = {
    resource: options.resource,
    queryHash,
    limit: query.limit,
    scopeKey: options.scopeKey,
    snapshot,
  };
  const resume = query.cursor
    ? parseResume(await openCursor(query.cursor, binding))
    : undefined;

  let page: LeaderboardRepositoryPage;
  try {
    page = await listLeaderboard({
      scopeKey: options.scopeKey,
      limit: query.limit,
      expectedRevision: options.revision,
      resume,
    });
  } catch (error) {
    if (query.cursor && error instanceof Error && error.message.includes("leaderboard_revision_changed")) {
      throw invalidCursor();
    }
    throw error;
  }

  if (page.revision !== options.revision) {
    if (query.cursor) throw invalidCursor();
    throw new Error("leaderboard_revision_changed");
  }

  let nextCursor: string | null = null;
  if (page.hasMore) {
    if (!page.cursorState) throw new Error("leaderboard_cursor_state_missing");
    const times = cursorTimes(Date.now());
    nextCursor = await sealCursor({
      version: 1,
      resource: options.resource,
      queryHash,
      limit: query.limit,
      scopeKey: options.scopeKey,
      snapshot,
      lastSortValues: [
        page.cursorState.eligibleItemsSeen,
        page.cursorState.lastRank,
        page.cursorState.lastScore,
        page.cursorState.lastUsername,
        page.cursorState.lastPublicId,
      ],
      ...times,
    });
  }

  return {
    data: options.buildData(page.standings),
    meta: {
      leaderboardRevision: options.revision,
      page: {
        limit: query.limit,
        nextCursor,
        hasMore: page.hasMore,
      },
    },
    cachePolicy: "public",
    maxAge: 30,
    staleWhileRevalidate: 120,
    etag: true,
  };
}