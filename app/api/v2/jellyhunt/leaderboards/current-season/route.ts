import { createV2Handler } from "@/lib/jellyhunt/v2/route-handler";
import { listLeaderboard, getCurrentCampaign } from "@/lib/jellyhunt/v2/repository";
import { notFound } from "@/lib/jellyhunt/v2/errors";

export const GET = createV2Handler(
  async (request) => {
    const campaign = await getCurrentCampaign();
    if (!campaign) throw notFound("current_campaign");
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100);
    const page = await listLeaderboard(`campaign:${campaign.campaignPublicId}`, limit);
    return { data: page };
  },
  { cachePolicy: "public", maxAge: 30 },
);
