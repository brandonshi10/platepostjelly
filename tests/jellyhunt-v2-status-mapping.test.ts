import { describe, expect, it } from "vitest";
import { mapV1StatusToV2Display, mapV1ConflictToV2 } from "../src/lib/jellyhunt/v2/status-mapping";

describe("v1-to-v2 status mapping", () => {
  it.each([
    ["not_started", "not_started"],
    ["submitted", "submitted"],
    ["verifying", "under_review"],
    ["needs_review", "under_review"],
    ["approved", "approved_reward_pending"],
    ["rejected", "rejected"],
    ["reward_queued", "approved_reward_pending"],
    ["reward_sent", "rewarded"],
    ["reward_failed", "support_needed"],
    ["reward_uncertain", "support_needed"],
  ] as const)("maps v1 %s to v2 %s", (v1, expected) => {
    expect(mapV1StatusToV2Display(v1)).toBe(expected);
  });
});

describe("v1-to-v2 conflict code mapping", () => {
  it("maps jelly_post_reused to privacy-safe submission_conflict", () => {
    expect(mapV1ConflictToV2("jelly_post_reused")).toBe("submission_conflict");
  });

  it("maps mission_already_submitted to privacy-safe submission_conflict", () => {
    expect(mapV1ConflictToV2("mission_already_submitted")).toBe("submission_conflict");
  });
});
