export type RewardIntentSnapshot = {
  intentPublicId: string;
  submissionPublicId: string;
  missionPublicId: string;
  jellyPostId: string;
  recipientUserId: string;
  amount: string;
  token: string;
  decimals: number;
};

export type RewardAttemptRequest = {
  attemptNumber: number;
  submissionId: string;
  missionId: string;
  recipientUserId: string;
  jellyPostId: string;
  amount: string;
  token: string;
  idempotencyKey: string;
};

export type RewardIntentReceipt = {
  intentId: string;
  submissionId: string;
  missionId: string;
  jellyPostId: string;
  recipientUserId: string;
  amount: string;
  token: string;
  decimals: number;
  transactionId: string;
  transactionHash?: string | null;
};

export type PartnerRewardOutcome =
  | { status: "sent"; transactionId: string; transactionHash?: string | null }
  | { status: "accepted" }
  | { status: "replay"; transactionId: string }
  | { status: "confirmed_no_transfer"; reasonCode: string }
  | { status: "uncertain"; reasonCode: string };

export function buildRewardAttempt(
  intent: RewardIntentSnapshot,
  attemptNumber: number,
): { idempotencyKey: `reward:${string}:attempt:${number}`; body: RewardAttemptRequest } {
  const idempotencyKey = `reward:${intent.intentPublicId}:attempt:${attemptNumber}` as const;
  return {
    idempotencyKey,
    body: {
      attemptNumber,
      submissionId: intent.submissionPublicId,
      missionId: intent.missionPublicId,
      recipientUserId: intent.recipientUserId,
      jellyPostId: intent.jellyPostId,
      amount: intent.amount,
      token: intent.token,
      idempotencyKey,
    },
  };
}

export function parseRewardAttemptResponse(
  status: number,
  body: unknown,
): PartnerRewardOutcome {
  const b = body as Record<string, any> | undefined;
  if (status === 201 && b?.rewardIntent?.status === "sent") {
    return {
      status: "sent",
      transactionId: b.rewardIntent.transactionId,
      transactionHash: b.rewardIntent.transactionHash ?? null,
    };
  }
  if (status === 202) {
    return { status: "accepted" };
  }
  if (status === 200 && b?.rewardIntent?.transactionId) {
    return { status: "replay", transactionId: b.rewardIntent.transactionId };
  }
  if (status === 422) {
    return {
      status: "confirmed_no_transfer",
      reasonCode: b?.error?.code ?? "unprocessable",
    };
  }
  return {
    status: "uncertain",
    reasonCode: `http_${status}`,
  };
}

export function assertReceiptMatchesIntent(
  intent: RewardIntentSnapshot,
  receipt: RewardIntentReceipt,
): void {
  const mismatches: string[] = [];
  if (receipt.intentId !== intent.intentPublicId) mismatches.push("intentId");
  if (receipt.submissionId !== intent.submissionPublicId) mismatches.push("submissionId");
  if (receipt.missionId !== intent.missionPublicId) mismatches.push("missionId");
  if (receipt.jellyPostId !== intent.jellyPostId) mismatches.push("jellyPostId");
  if (receipt.recipientUserId !== intent.recipientUserId) mismatches.push("recipientUserId");
  if (receipt.amount !== intent.amount) mismatches.push("amount");
  if (receipt.token !== intent.token) mismatches.push("token");
  if (mismatches.length > 0) {
    throw new Error(`receipt_mismatch:${mismatches.join(",")}`);
  }
  if (!receipt.transactionId) {
    throw new Error("receipt_missing_transaction_id");
  }
}
