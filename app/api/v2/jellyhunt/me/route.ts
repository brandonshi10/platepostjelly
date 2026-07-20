import { requireJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { MeQuery, MeSummary } from "@/src/lib/jellyhunt/v2/owner-read-contracts";
import {
  createOwnerReadHandler,
  ownerResourceNotFound,
} from "@/src/lib/jellyhunt/v2/owner-read-route";
import { parseQuery } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { getMe } from "@/src/lib/jellyhunt/v2/repository";

export const GET = createOwnerReadHandler(async (request) => {
  const viewer = await requireJellyViewer(request, "jellyhunt:read");
  const query = parseQuery(request, MeQuery);
  const raw = await getMe({
    jellyUserId: viewer.jellyUserId,
    campaignPublicId: query.campaignId,
    now: Date.now(),
  });
  if (!raw) throw ownerResourceNotFound("campaign");
  const data = MeSummary.parse(raw);

  return {
    data,
    links: {
      missions: `/api/v2/jellyhunt/me/missions?campaignId=${data.campaign.id}`,
      submissions: `/api/v2/jellyhunt/me/submissions?campaignId=${data.campaign.id}`,
      events: "/api/v2/jellyhunt/me/events",
    },
  };
});
