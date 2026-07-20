import { createV2Handler } from "@/lib/jellyhunt/v2/route-handler";
import { notFound } from "@/lib/jellyhunt/v2/errors";

export const GET = createV2Handler(
  async () => {
    throw notFound("submission_events_not_yet_available");
  },
  { cachePolicy: "private" },
);
