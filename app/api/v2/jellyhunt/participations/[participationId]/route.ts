import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import {
  EmptyQuery,
  ParticipationDetail,
  ParticipationParams,
} from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  ownerResourceNotFound,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery, parseRouteParams } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { getParticipation } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(
  async (request, _requestId, context) => {
    const viewer = await requireJellyViewer(request, "jellyhunt:read");
    parseQuery(request, EmptyQuery);
    const { participationId } = await parseRouteParams(context, ParticipationParams);
    const raw = await getParticipation(viewer.jellyUserId, participationId, Date.now());
    if (!raw) throw ownerResourceNotFound("participation");
    const data = ParticipationDetail.parse(raw);

    return {
      data,
      links: {
        mission: `/api/v2/jellyhunt/missions/${data.missionId}`,
        latestSubmission: data.latestSubmissionId
          ? `/api/v2/jellyhunt/submissions/${data.latestSubmissionId}`
          : null,
      },
    };
  },
);
