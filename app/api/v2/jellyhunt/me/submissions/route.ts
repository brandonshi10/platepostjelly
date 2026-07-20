import { createV2Handler } from "@/src/lib/jellyhunt/v2/route-handler";
import { notFound } from "@/src/lib/jellyhunt/v2/errors";

export const GET = createV2Handler(
  async () => {
    throw notFound("my_submissions_not_yet_available");
  },
  { cachePolicy: "private" },
);
