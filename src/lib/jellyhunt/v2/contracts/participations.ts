import { z } from "zod";

export const ParticipationResponse = z.object({
  participationPublicId: z.string(),
  missionPublicId: z.string(),
  jellyUserId: z.string(),
  status: z.string(),
});
export type ParticipationResponse = z.infer<typeof ParticipationResponse>;
