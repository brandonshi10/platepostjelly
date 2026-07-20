import { describe, expect, it } from "vitest";
import sentFixture from "./contracts/jelly-partner-v1/reward-intent-attempt-sent.201.json";
import {
  buildRewardAttempt,
  parseRewardAttemptResponse,
  assertReceiptMatchesIntent,
  type RewardIntentSnapshot,
} from "../convex/jellyhunt/rewardContracts";

const FIXTURE_INTENT: RewardIntentSnapshot = {
  intentPublicId: "rwd_01HXREWARD0000002",
  submissionPublicId: "sub_01HXSUBMISSION0001",
  missionPublicId: "mis_01HXMISSION000001",
  jellyPostId: "01HXJELLYPOST000002",
  recipientUserId: "usr_jelly_canonical_001",
  amount: "60",
  token: "JELLY-MY-JELLY",
  decimals: 6,
};

describe("legacy reward adapter contract compatibility", () => {
  it("builds attempt matching the partner v1 fixture format", () => {
    const { idempotencyKey, body } = buildRewardAttempt(FIXTURE_INTENT, 1);
    expect(idempotencyKey).toBe("reward:rwd_01HXREWARD0000002:attempt:1");
    expect(body.submissionId).toBe("sub_01HXSUBMISSION0001");
    expect(body.missionId).toBe("mis_01HXMISSION000001");
    expect(body.recipientUserId).toBe("usr_jelly_canonical_001");
    expect(body.amount).toBe("60");
    expect(body.token).toBe("JELLY-MY-JELLY");
  });

  it("parses the 201 sent fixture correctly", () => {
    const outcome = parseRewardAttemptResponse(sentFixture.status, sentFixture.body);
    expect(outcome.status).toBe("sent");
    if (outcome.status === "sent") {
      expect(outcome.transactionId).toBe("txn_01HXTRANSACTION002");
    }
  });

  it("validates receipt against intent without mismatch", () => {
    expect(() =>
      assertReceiptMatchesIntent(FIXTURE_INTENT, {
        intentId: FIXTURE_INTENT.intentPublicId,
        submissionId: FIXTURE_INTENT.submissionPublicId,
        missionId: FIXTURE_INTENT.missionPublicId,
        jellyPostId: FIXTURE_INTENT.jellyPostId,
        recipientUserId: FIXTURE_INTENT.recipientUserId,
        amount: FIXTURE_INTENT.amount,
        token: FIXTURE_INTENT.token,
        decimals: FIXTURE_INTENT.decimals,
        transactionId: "txn_01HXTRANSACTION002",
      }),
    ).not.toThrow();
  });

  it("does not blindly retry uncertain legacy intents", () => {
    const outcome = parseRewardAttemptResponse(500, { error: "internal" });
    expect(outcome.status).toBe("uncertain");
    expect(outcome.status).not.toBe("sent");
    expect(outcome.status).not.toBe("failed");
  });
});
