import { z } from "zod";

export const CampaignResponse = z.object({
  campaignPublicId: z.string(),
  name: z.string(),
  status: z.string(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});
export type CampaignResponse = z.infer<typeof CampaignResponse>;
