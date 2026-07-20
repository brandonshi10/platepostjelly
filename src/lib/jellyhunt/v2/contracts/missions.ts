import { z } from "zod";

export const MissionResponse = z.object({
  missionPublicId: z.string(),
  campaignPublicId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
});
export type MissionResponse = z.infer<typeof MissionResponse>;
