export function legacyVerificationOutcome(
  actualAuthorId: string | undefined,
  expectedAuthorId: string,
) {
  return actualAuthorId && actualAuthorId !== expectedAuthorId
    ? "rejected" as const
    : "needs_review" as const;
}
export function normalizeExternalId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error("External id is required");
  return normalized;
}
export type WorkflowSubmissionStatus =
  | "submitted"
  | "verifying"
  | "needs_review"
  | "approved"
  | "rejected"
  | "reward_queued"
  | "reward_sent"
  | "reward_failed"
  | "reward_uncertain";

export type WorkflowRewardStatus =
  | "queued"
  | "processing"
  | "sent"
  | "failed"
  | "uncertain";

export const REWARD_PROCESSING_LEASE_MS = 2 * 60 * 1_000;

export function isRewardProcessingLeaseExpired(
  status: WorkflowRewardStatus,
  updatedAt: number,
  expectedStartedAt: number,
  now: number,
) {
  return (
    status === "processing" &&
    updatedAt === expectedStartedAt &&
    now - updatedAt >= REWARD_PROCESSING_LEASE_MS
  );
}
export function verificationCanStart(status: WorkflowSubmissionStatus) {
  return status === "submitted";
}

export function verificationResultIsCurrent(
  status: WorkflowSubmissionStatus,
  currentAttempt: number,
  resultAttempt: number,
) {
  return status === "verifying" && currentAttempt === resultAttempt;
}

export function hasBlockingMissionSibling(statuses: WorkflowSubmissionStatus[]) {
  return statuses.some((status) => status !== "rejected");
}

export function adminReviewCanDecide(status: WorkflowSubmissionStatus) {
  return status === "needs_review";
}

export function rewardQueueDecision(status: WorkflowRewardStatus | undefined) {
  if (status === undefined) return "create" as const;
  if (status === "queued" || status === "processing") return "already_in_progress" as const;
  if (status === "sent") return "already_sent" as const;
  if (status === "failed") return "manual_retry_required" as const;
  return "reconciliation_required" as const;
}
