import {
  MissionDetailQuery,
  MissionParams,
  MissionPublic,
} from "@/src/lib/jellyhunt/v2/public-discovery-contracts";
import { JellyhuntV2Error } from "@/src/lib/jellyhunt/v2/errors";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import {
  parseQuery,
  parseRouteParams,
  resourceNotFound,
} from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { getMission } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createV2Handler(
  async (request, _requestId, context) => {
    const query = parseQuery(request, MissionDetailQuery);
    const { missionId } = await parseRouteParams(context, MissionParams);
    const authenticatedViewer = await optionalJellyViewer(request, "jellyhunt:read");
    if (query.include === "viewer" && !authenticatedViewer) {
      throw new JellyhuntV2Error(401, "authentication_required", "Authentication is required.");
    }

    const rawMission = await getMission(missionId, {
      jellyUserId: query.include === "viewer" ? authenticatedViewer?.jellyUserId : undefined,
      now: Date.now(),
    });
    if (!rawMission) throw resourceNotFound("mission");

    const mission = MissionPublic.parse(rawMission);

    return {
      data: mission,
      links: {},
      cachePolicy: authenticatedViewer ? "private" : "public",
    };
  },
  { cachePolicy: "public", maxAge: 30, staleWhileRevalidate: 120, etag: true },
);
