import { createV2Handler } from "@/lib/jellyhunt/v2/route-handler";
import { getMission } from "@/lib/jellyhunt/v2/repository";
import { notFound } from "@/lib/jellyhunt/v2/errors";

export const GET = createV2Handler(
  async (_request, _requestId) => {
    // missionId extracted from URL by Next.js params — but createV2Handler
    // doesn't pass params yet. This route is a placeholder until the
    // route-handler wrapper is extended for dynamic segments.
    throw notFound("mission_detail_not_yet_available");
  },
  { cachePolicy: "public", maxAge: 30 },
);
