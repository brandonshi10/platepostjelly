import { CurrentSeasonLeaderboardData } from "@/src/lib/jellyhunt/v2/contracts/leaderboards";
import { leaderboardRouteResult } from "@/src/lib/jellyhunt/v2/leaderboard-route";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { isoTimestamp, resourceNotFound } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { getCurrentSeasonLeaderboardContext } from "@/src/lib/jellyhunt/v2/repository";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";

export const GET = createV2Handler(
  async (request) => {
    await optionalJellyViewer(request, "jellyhunt:read");
    const context = await getCurrentSeasonLeaderboardContext();
    if (!context) throw resourceNotFound("campaign");
    return leaderboardRouteResult(request, {
      resource: "leaderboard:current-season",
      scopeKey: context.scopeKey,
      revision: context.revision,
      buildData: (standings) =>
        CurrentSeasonLeaderboardData.parse({
          scope: "current_season",
          rankingBasis: "approved_missions",
          campaign: {
            id: context.campaign.id,
            title: context.campaign.title,
            startsAt: isoTimestamp(context.campaign.startsAt),
            endsAt: isoTimestamp(context.campaign.endsAt),
          },
          standings,
        }),
    });
  },
  { cachePolicy: "public", maxAge: 30, staleWhileRevalidate: 120, etag: true },
);