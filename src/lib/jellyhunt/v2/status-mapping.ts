import type { SubmissionStatus } from "../contracts";

type V1SubmissionStatus = SubmissionStatus | "not_started";

type V2DisplayStatus =
  | "not_started"
  | "submitted"
  | "under_review"
  | "approved_reward_pending"
  | "rewarded"
  | "rejected"
  | "support_needed";

const STATUS_MAP: Record<V1SubmissionStatus, V2DisplayStatus> = {
  not_started: "not_started",
  submitted: "submitted",
  verifying: "under_review",
  needs_review: "under_review",
  approved: "approved_reward_pending",
  rejected: "rejected",
  reward_queued: "approved_reward_pending",
  reward_sent: "rewarded",
  reward_failed: "support_needed",
  reward_uncertain: "support_needed",
};

export function mapV1StatusToV2Display(v1Status: V1SubmissionStatus): V2DisplayStatus {
  return STATUS_MAP[v1Status] ?? "support_needed";
}

export function mapV1ConflictToV2(
  v1Code: "jelly_post_reused" | "mission_already_submitted",
): "submission_conflict" {
  void v1Code;
  return "submission_conflict";
}
