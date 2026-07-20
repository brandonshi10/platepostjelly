import { createV2Handler } from "@/lib/jellyhunt/v2/route-handler";
import { listLeaderboard } from "@/lib/jellyhunt/v2/repository";

export const GET = createV2Handler(
  async (request) => {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25), 1), 100);
    const page = await listLeaderboard("all_time", limit);
    return { data: page };
  },
  { cachePolicy: "public", maxAge: 30 },
);
