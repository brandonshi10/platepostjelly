import { z } from "zod";

export const SubmissionStatus = z.enum([
  "submitted",
  "verifying",
  "needs_review",
  "approved",
  "rejected",
]);

export const RewardStatus = z.enum([
  "not_eligible",
  "queued",
  "processing",
  "sent",
  "failed",
  "uncertain",
]);

export const SubmissionResponse = z.object({
  submissionPublicId: z.string(),
  missionPublicId: z.string(),
  jellyUserId: z.string(),
  submissionStatus: SubmissionStatus,
  rewardStatus: RewardStatus,
  reasonCode: z.string().optional(),
  displayStatus: z.string(),
  publicMessage: z.string(),
  nextAction: z.string(),
  canResubmit: z.boolean(),
});
export type SubmissionResponse = z.infer<typeof SubmissionResponse>;
