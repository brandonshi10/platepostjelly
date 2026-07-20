import {
  FeedQuery,
  PlaceParams,
  PlacePublic,
} from "@/src/lib/jellyhunt/v2/public-discovery-contracts";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { buildPublicJellyFeed } from "@/src/lib/jellyhunt/v2/public-jelly-feed";
import {
  parseQuery,
  parseRouteParams,
  resourceNotFound,
} from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { getPlace } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createV2Handler(
  async (request, requestId, context) => {
    const query = parseQuery(request, FeedQuery);
    const { placeId } = await parseRouteParams(context, PlaceParams);
    const viewer = await optionalJellyViewer(request, "jellyhunt:read");
    const rawPlace = await getPlace(placeId);
    if (!rawPlace) throw resourceNotFound("place");
    const place = PlacePublic.parse(rawPlace);
    const feed = await buildPublicJellyFeed({
      place,
      cursor: query.cursor,
      limit: query.limit,
      requestId,
    });

    return {
      data: feed.data,
      meta: { page: feed.page },
      links: {},
      cachePolicy: viewer ? "private" : "public",
      maxAge: feed.maxAge,
      staleWhileRevalidate: Math.min(120, feed.maxAge * 4),
    };
  },
  { cachePolicy: "public", maxAge: 30, staleWhileRevalidate: 120, etag: true },
);
