export type RewardIntentSnapshot = {
  intentPublicId: string;
  submissionPublicId: string;
  missionPublicId: string;
  jellyPostId: string;
  recipientUserId: string;
  amount: string;
  token: string;
  decimals: number;
  eligibilityGuard?: {
    authorshipPolicy: string;
    canonicalOwnerUserId: string;
    requiredPostState: "ready";
    requiredVisibility: string;
    requiredModerationStatus: "clear";
    expectedPlaceId: string;
  };
  note?: string;
};

export type RewardAttemptRequest = {
  attemptNumber: number;
  submissionId: string;
  missionId: string;
  recipientUserId: string;
  jellyPostId: string;
  amount: string;
  token: string;
  eligibilityGuard?: RewardIntentSnapshot["eligibilityGuard"];
  note?: string;
  visibility: "private";
  participantConsentId: null;
  /** Transport-only: sent as the Idempotency-Key header, never in JSON. */
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
  | { status: "sent"; transactionId: string; transactionHash?: string | null; receipt: RewardIntentReceipt }
  | { status: "accepted" }
  | { status: "replay"; transactionId: string; receipt: RewardIntentReceipt }
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
      ...(intent.eligibilityGuard ? { eligibilityGuard: intent.eligibilityGuard } : {}),
      ...(intent.note ? { note: intent.note } : {}),
      visibility: "private",
      participantConsentId: null,
      idempotencyKey,
    },
  };
}

function parseRewardReceipt(value: unknown): RewardIntentReceipt | null {
  const receipt = value as Record<string, unknown> | null | undefined;
  if (
    !receipt ||
    typeof receipt.id !== "string" ||
    typeof receipt.submissionId !== "string" ||
    typeof receipt.missionId !== "string" ||
    typeof receipt.jellyPostId !== "string" ||
    typeof receipt.recipientUserId !== "string" ||
    typeof receipt.amount !== "string" ||
    typeof receipt.token !== "string" ||
    !Number.isInteger(receipt.decimals) ||
    typeof receipt.transactionId !== "string" ||
    receipt.transactionId.length === 0
  ) return null;
  if (receipt.transactionHash !== undefined && receipt.transactionHash !== null && typeof receipt.transactionHash !== "string") {
    return null;
  }
  return {
    intentId: receipt.id,
    submissionId: receipt.submissionId,
    missionId: receipt.missionId,
    jellyPostId: receipt.jellyPostId,
    recipientUserId: receipt.recipientUserId,
    amount: receipt.amount,
    token: receipt.token,
    decimals: receipt.decimals as number,
    transactionId: receipt.transactionId,
    transactionHash: (receipt.transactionHash as string | null | undefined) ?? null,
  };
}

export function parseRewardAttemptResponse(
  status: number,
  body: unknown,
  expected?: { intentId: string; attemptNumber: number },
): PartnerRewardOutcome {
  const b = body as Record<string, any> | undefined;
  if (status === 201 && b?.rewardIntent?.status === "sent") {
    const receipt = parseRewardReceipt(b.rewardIntent);
    if (!receipt) return { status: "uncertain", reasonCode: "invalid_sent_receipt" };
    return {
      status: "sent",
      transactionId: receipt.transactionId,
      transactionHash: receipt.transactionHash ?? null,
      receipt,
    };
  }
  if (status === 202) {
    return { status: "accepted" };
  }
  if (status === 200 && b?.rewardIntent?.transactionId) {
    const receipt = parseRewardReceipt(b.rewardIntent);
    if (!receipt) return { status: "uncertain", reasonCode: "invalid_replay_receipt" };
    return { status: "replay", transactionId: receipt.transactionId, receipt };
  }
  if (status === 422) {
    const intent = b?.rewardIntent as Record<string, unknown> | undefined;
    const attempt = b?.attempt as Record<string, unknown> | undefined;
    const reasonCode =
      typeof b?.error?.code === "string" && b.error.code.length > 0
        ? b.error.code
        : "partner_rejected";
    if (
      expected &&
      intent?.id === expected.intentId &&
      attempt?.number === expected.attemptNumber &&
      attempt?.status === "failed" &&
      attempt?.final === true &&
      attempt?.confirmedNoTransfer === true
    ) {
      return { status: "confirmed_no_transfer", reasonCode };
    }
    return { status: "uncertain", reasonCode: "invalid_no_transfer_proof" };
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
  if (receipt.decimals !== intent.decimals) mismatches.push("decimals");
  if (mismatches.length > 0) {
    throw new Error(`receipt_mismatch:${mismatches.join(",")}`);
  }
  if (!receipt.transactionId) {
    throw new Error("receipt_missing_transaction_id");
  }
}
