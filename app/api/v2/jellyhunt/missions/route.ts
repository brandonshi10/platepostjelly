import { createV2Handler } from "@/lib/jellyhunt/v2/route-handler";
import { notFound } from "@/lib/jellyhunt/v2/errors";

export const GET = createV2Handler(
  async (request) => {
    const url = new URL(request.url);
    const _category = url.searchParams.get("category");
    const _limit = url.searchParams.get("limit");
    // Missions list depends on Convex query not yet exposed as a list query.
    // The v1 route handler at /api/v1/jellyhunt/missions still works.
    throw notFound("missions_list_not_yet_available");
  },
  { cachePolicy: "public", maxAge: 30 },
);
