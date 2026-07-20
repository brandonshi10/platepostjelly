import { describe, expect, it } from "vitest";
import {
  adminReviewCanDecide,
  hasBlockingMissionSibling,
  isRewardProcessingLeaseExpired,
  legacyVerificationOutcome,
  normalizeExternalId,
  rewardQueueDecision,
  verificationCanStart,
  verificationResultIsCurrent,
} from "../convex/workflow";

describe("Convex workflow race guards", () => {
  it("canonicalizes Jelly ids before deduplication", () => {
    expect(normalizeExternalId(" ABC-123 ")).toBe("abc-123");
    expect(() => normalizeExternalId("   ")).toThrow("External id is required");
  });

  it("never auto-approves from legacy heuristic proof", () => {
    expect(legacyVerificationOutcome(undefined, "user-1")).toBe("needs_review");
    expect(legacyVerificationOutcome("user-1", "user-1")).toBe("needs_review");
    expect(legacyVerificationOutcome("user-2", "user-1")).toBe("rejected");
  });

  it("lets only a newly submitted verification claim start", () => {
    expect(verificationCanStart("submitted")).toBe(true);
    expect(verificationCanStart("verifying")).toBe(false);
    expect(verificationCanStart("reward_sent")).toBe(false);
  });

  it("accepts a verification result only for the active attempt", () => {
    expect(verificationResultIsCurrent("verifying", 3, 3)).toBe(true);
    expect(verificationResultIsCurrent("verifying", 3, 2)).toBe(false);
    expect(verificationResultIsCurrent("reward_sent", 3, 3)).toBe(false);
  });

  it("never automatically requeues an existing reward attempt", () => {
    expect(rewardQueueDecision(undefined)).toBe("create");
    expect(rewardQueueDecision("queued")).toBe("already_in_progress");
    expect(rewardQueueDecision("processing")).toBe("already_in_progress");
    expect(rewardQueueDecision("sent")).toBe("already_sent");
    expect(rewardQueueDecision("failed")).toBe("manual_retry_required");
    expect(rewardQueueDecision("uncertain")).toBe("reconciliation_required");
  });

  it("blocks recovery of an older rejected attempt once another attempt is live", () => {
    expect(hasBlockingMissionSibling(["rejected"])).toBe(false);
    expect(hasBlockingMissionSibling(["submitted"])).toBe(true);
    expect(hasBlockingMissionSibling(["reward_sent"])).toBe(true);
  });

  it("requires rejected proof to be reverified before an admin decision", () => {
    expect(adminReviewCanDecide("needs_review")).toBe(true);
    expect(adminReviewCanDecide("rejected")).toBe(false);
    expect(adminReviewCanDecide("reward_failed")).toBe(false);
  });

  it("expires only the unchanged reward processing lease", () => {
    const startedAt = 1_000;
    expect(isRewardProcessingLeaseExpired("processing", startedAt, startedAt, startedAt + 119_999)).toBe(false);
    expect(isRewardProcessingLeaseExpired("processing", startedAt, startedAt, startedAt + 120_000)).toBe(true);
    expect(isRewardProcessingLeaseExpired("processing", startedAt + 1, startedAt, startedAt + 120_000)).toBe(false);
    expect(isRewardProcessingLeaseExpired("sent", startedAt, startedAt, startedAt + 120_000)).toBe(false);
  });
});
