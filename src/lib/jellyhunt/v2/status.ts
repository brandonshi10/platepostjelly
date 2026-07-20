export type SubmissionStatus = "submitted" | "verifying" | "needs_review" | "approved" | "rejected";
export type RewardStatus = "not_eligible" | "queued" | "processing" | "sent" | "failed" | "uncertain";

export type StatusInput = {
  submissionStatus: SubmissionStatus;
  rewardStatus: RewardStatus;
  reasonCode?: string;
};

export type DisplayState = {
  displayStatus: string;
  publicMessage: string;
  nextAction: string;
  canResubmit: boolean;
};

const UNKNOWN: DisplayState = {
  displayStatus: "support_needed",
  publicMessage: "We could not determine the current mission status.",
  nextAction: "contact_support",
  canResubmit: false,
};

export function deriveDisplayState(input: StatusInput): DisplayState {
  const { submissionStatus, rewardStatus, reasonCode } = input;

  switch (submissionStatus) {
    case "submitted":
      if (rewardStatus === "not_eligible") {
        return {
          displayStatus: "submitted",
          publicMessage: "Your Jelly was submitted and is waiting for verification.",
          nextAction: "wait_for_verification",
          canResubmit: false,
        };
      }
      return UNKNOWN;

    case "verifying":
      if (rewardStatus === "not_eligible") {
        return {
          displayStatus: "under_review",
          publicMessage: "Your Jelly is being verified.",
          nextAction: "wait_for_verification",
          canResubmit: false,
        };
      }
      return UNKNOWN;

    case "needs_review":
      if (rewardStatus === "not_eligible") {
        return {
          displayStatus: "under_review",
          publicMessage: "Your Jelly needs a quick manual review.",
          nextAction: "wait_for_review",
          canResubmit: false,
        };
      }
      return UNKNOWN;

    case "approved":
      if (rewardStatus === "queued" || rewardStatus === "processing") {
        return {
          displayStatus: "approved_reward_pending",
          publicMessage: "Mission approved. Your reward is on the way.",
          nextAction: "wait_for_reward",
          canResubmit: false,
        };
      }
      if (rewardStatus === "sent") {
        return {
          displayStatus: "rewarded",
          publicMessage: "Mission approved and reward sent.",
          nextAction: "view_reward",
          canResubmit: false,
        };
      }
      if (rewardStatus === "failed" || rewardStatus === "uncertain") {
        return {
          displayStatus: "support_needed",
          publicMessage: "Your mission was approved, but the reward needs support.",
          nextAction: "contact_support",
          canResubmit: false,
        };
      }
      return UNKNOWN;

    case "rejected":
      if (rewardStatus === "not_eligible") {
        return {
          displayStatus: "rejected",
          publicMessage: "This Jelly did not meet the mission requirements.",
          nextAction: "submit_new_post",
          canResubmit: true,
        };
      }
      if (rewardStatus === "sent" && reasonCode === "post_became_ineligible_after_reward") {
        return {
          displayStatus: "rewarded_removed_from_rankings",
          publicMessage: "Your reward was sent, but this completion no longer counts in rankings.",
          nextAction: "contact_support",
          canResubmit: false,
        };
      }
      return UNKNOWN;

    default:
      return UNKNOWN;
  }
}
