import { AllTimeLeaderboardData } from "@/src/lib/jellyhunt/v2/contracts/leaderboards";
import { leaderboardRouteResult } from "@/src/lib/jellyhunt/v2/leaderboard-route";
import { optionalJellyViewer } from "@/src/lib/jellyhunt/v2/jelly-mission-token";
import { isoTimestamp } from "@/src/lib/jellyhunt/v2/public-route-utils";
import { getAllTimeLeaderboardContext } from "@/src/lib/jellyhunt/v2/repository";
import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";

export const GET = createV2Handler(
  async (request) => {
    await optionalJellyViewer(request, "jellyhunt:read");
    const context = await getAllTimeLeaderboardContext();
    return leaderboardRouteResult(request, {
      resource: "leaderboard:all-time",
      scopeKey: context.scopeKey,
      revision: context.revision,
      buildData: (standings) =>
        AllTimeLeaderboardData.parse({
          scope: "all_time",
          rankingBasis: "approved_missions",
          startsAt: isoTimestamp(context.startsAt),
          standings,
        }),
    });
  },
  { cachePolicy: "public", maxAge: 30, staleWhileRevalidate: 120, etag: true },
);