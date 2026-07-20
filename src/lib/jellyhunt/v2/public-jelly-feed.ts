import "server-only";

import { JellyFeedPublic } from "./public-discovery-contracts";
import {
  computeQueryHash,
  openCursor,
  sealCursor,
} from "./cursor";
import { invalidCursor } from "./errors";
import { fetchJellyPlaceFeed } from "./jelly-place-feed";

export type PublicFeedPlace = {
  id: string;
  revision: number;
  jellyPlaceId: string;
  updatedAt: string;
};

export async function buildPublicJellyFeed(args: {
  place: PublicFeedPlace;
  cursor?: string;
  limit: number;
  requestId: string;
}) {
  const queryHash = await computeQueryHash({
    placeId: args.place.id,
    limit: args.limit,
  });
  const snapshot =
    args.place.id + ":" + args.place.revision + ":" + args.place.updatedAt;
  let upstreamCursor: string | undefined;

  if (args.cursor) {
    const cursor = await openCursor(args.cursor, {
      resource: "place_jellies",
      queryHash,
      limit: args.limit,
      scopeKey: args.place.id,
      snapshot,
    });
    if (
      cursor.lastSortValues.length !== 1 ||
      typeof cursor.lastSortValues[0] !== "string" ||
      !cursor.lastSortValues[0]
    ) {
      throw invalidCursor();
    }
    upstreamCursor = cursor.lastSortValues[0];
  }

  if (!args.place.jellyPlaceId.trim()) {
    return {
      data: JellyFeedPublic.parse({
        jellies: [],
        source: "jelly",
        sourceStatus: "place_not_linked",
      }),
      page: { limit: args.limit, nextCursor: null, hasMore: false },
      maxAge: 30,
    };
  }

  const feed = await fetchJellyPlaceFeed({
    jellyPlaceId: args.place.jellyPlaceId,
    upstreamCursor,
    limit: args.limit,
    requestId: args.requestId,
  });
  const now = Date.now();
  const mediaMaxAge =
    feed.jellies.length === 0
      ? 30
      : Math.max(
          0,
          Math.floor(
            (Math.min(...feed.jellies.map((jelly) => Date.parse(jelly.mediaExpiresAt))) -
              now) /
              1000,
          ),
        );
  const maxAge = Math.min(30, mediaMaxAge);
  const nextCursor =
    feed.hasMore && feed.nextCursor
      ? await sealCursor({
          version: 1,
          resource: "place_jellies",
          queryHash,
          limit: args.limit,
          scopeKey: args.place.id,
          snapshot,
          lastSortValues: [feed.nextCursor],
          issuedAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
        })
      : null;

  return {
    data: JellyFeedPublic.parse({
      jellies: feed.jellies,
      source: "jelly",
      sourceStatus: "live",
    }),
    page: {
      limit: args.limit,
      nextCursor,
      hasMore: nextCursor !== null,
    },
    maxAge,
  };
}
