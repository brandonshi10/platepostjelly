import { z } from "zod";
import {
  PlaceParams,
  PlacePublic,
} from "@/src/lib/jellyhunt/v2/public-discovery-contracts";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import {
  directionsLink,
  parseQuery,
  parseRouteParams,
  resourceNotFound,
} from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { getPlace } from "@/src/lib/jellyhunt/v2/repository";

const EmptyQuery = z.object({}).strict();

export const GET = createV2Handler(
  async (request, _requestId, context) => {
    parseQuery(request, EmptyQuery);
    const { placeId } = await parseRouteParams(context, PlaceParams);
    const viewer = await optionalJellyViewer(request, "jellyhunt:read");
    const rawPlace = await getPlace(placeId);
    if (!rawPlace) throw resourceNotFound("place");
    const place = PlacePublic.parse(rawPlace);

    return {
      data: place,
      links: {
        self: `/api/v2/jellyhunt/places/${place.id}`,
        jellies: `/api/v2/jellyhunt/places/${place.id}/jellies`,
        directions: directionsLink(place.latitude, place.longitude),
      },
      cachePolicy: viewer ? "private" : "public",
    };
  },
  { cachePolicy: "public", maxAge: 60, staleWhileRevalidate: 300, etag: true },
);
