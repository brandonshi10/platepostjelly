import { z } from "zod";
import { CampaignPublic } from "@/src/lib/jellyhunt/v2/public-discovery-contracts";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { resourceNotFound, parseQuery } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { getCurrentCampaign } from "@/src/lib/jellyhunt/v2/repository";

const EmptyQuery = z.object({}).strict();

export const GET = createV2Handler(
  async (request) => {
    parseQuery(request, EmptyQuery);
    const viewer = await optionalJellyViewer(request, "jellyhunt:read");
    const rawCampaign = await getCurrentCampaign();
    if (!rawCampaign) throw resourceNotFound("campaign");
    const campaign = CampaignPublic.parse(rawCampaign);

    return {
      data: campaign,
      links: {
        missions: `/api/v2/jellyhunt/missions?campaignId=${campaign.id}`,
      },
      cachePolicy: viewer ? "private" : "public",
    };
  },
  { cachePolicy: "public", maxAge: 60, staleWhileRevalidate: 300, etag: true },
);
