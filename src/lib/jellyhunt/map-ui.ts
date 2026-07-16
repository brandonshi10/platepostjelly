import type { UserMissionStatus } from "./contracts";

export type ConsumerMissionStatus = UserMissionStatus["status"];

const STATUS_LABELS: Record<ConsumerMissionStatus, string> = {
  not_started: "Start mission →",
  submitted: "Submitted",
  verifying: "Verifying",
  needs_review: "Pending review",
  approved: "Mission complete",
  rejected: "Try again →",
  reward_queued: "Mission complete · reward queued",
  reward_sent: "Mission complete · reward sent",
  reward_failed: "Mission complete · reward needs attention",
  reward_uncertain: "Mission complete · reward reconciling",
};

const COMPLETED_STATUSES = new Set<ConsumerMissionStatus>([
  "approved",
  "reward_queued",
  "reward_sent",
  "reward_failed",
  "reward_uncertain",
]);

export function missionStatusLabel(status: ConsumerMissionStatus) {
  return STATUS_LABELS[status];
}

export function canStartMission(status: ConsumerMissionStatus) {
  return status === "not_started" || status === "rejected";
}

export function isMissionComplete(status: ConsumerMissionStatus) {
  return COMPLETED_STATUSES.has(status);
}
