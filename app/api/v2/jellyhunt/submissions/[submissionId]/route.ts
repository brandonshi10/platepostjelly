import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import {
  EmptyQuery,
  SubmissionDetail,
  SubmissionParams,
} from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  ownerResourceNotFound,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery, parseRouteParams } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { getSubmission } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(
  async (request, _requestId, context) => {
    const viewer = await requireJellyViewer(request, "jellyhunt:read");
    parseQuery(request, EmptyQuery);
    const { submissionId } = await parseRouteParams(context, SubmissionParams);
    const raw = await getSubmission(viewer.jellyUserId, submissionId, Date.now());
    if (!raw) throw ownerResourceNotFound("submission");
    const data = SubmissionDetail.parse(raw);

    return {
      data,
      links: {
        mission: `/api/v2/jellyhunt/missions/${data.mission.id}`,
        events: `/api/v2/jellyhunt/submissions/${data.id}/events`,
      },
    };
  },
);
