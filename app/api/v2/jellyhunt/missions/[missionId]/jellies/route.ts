import {
  FeedQuery,
  MissionParams,
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
import { getMission, getPlace } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createV2Handler(
  async (request, requestId, context) => {
    const query = parseQuery(request, FeedQuery);
    const { missionId } = await parseRouteParams(context, MissionParams);
    const viewer = await optionalJellyViewer(request, "jellyhunt:read");
    const mission = await getMission(missionId, {
      jellyUserId: undefined,
      now: Date.now(),
    });
    if (!mission) throw resourceNotFound("mission");

    const missionPlaceId =
      mission &&
      typeof mission === "object" &&
      "place" in mission &&
      mission.place &&
      typeof mission.place === "object" &&
      "id" in mission.place &&
      typeof mission.place.id === "string"
        ? mission.place.id
        : null;
    if (!missionPlaceId) throw resourceNotFound("mission");

    const rawPlace = await getPlace(missionPlaceId);
    if (!rawPlace) throw resourceNotFound("mission");
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
