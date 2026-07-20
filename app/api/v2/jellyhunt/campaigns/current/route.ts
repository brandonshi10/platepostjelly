import { createV2Handler } from "@/lib/jellyhunt/v2/route-handler";
import { getCurrentCampaign } from "@/lib/jellyhunt/v2/repository";
import { notFound } from "@/lib/jellyhunt/v2/errors";

export const GET = createV2Handler(
  async () => {
    const campaign = await getCurrentCampaign();
    if (!campaign) throw notFound("campaign");
    return { data: campaign };
  },
  { cachePolicy: "public", maxAge: 60 },
);
