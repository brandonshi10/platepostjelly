export const JELLY_TOKEN_DECIMALS = 6;
const SCALE = 10n ** BigInt(JELLY_TOKEN_DECIMALS);
const CANONICAL_AMOUNT_PATTERN = /^(0|[1-9]\d{0,23})(?:\.([0-9]{1,6}))?$/;

export function parseCanonicalRewardAmount(
  value: string,
  options: { allowZero?: boolean } = {},
): bigint {
  const match = CANONICAL_AMOUNT_PATTERN.exec(value);
  if (!match || (match[2] !== undefined && match[2].endsWith("0"))) {
    throw new Error("invalid_reward_amount_format");
  }

  const whole = BigInt(match[1]);
  const fractional = (match[2] ?? "").padEnd(JELLY_TOKEN_DECIMALS, "0");
  const atomic = whole * SCALE + BigInt(fractional || "0");
  if (atomic === 0n && !options.allowZero) {
    throw new Error("invalid_reward_amount_format");
  }
  return atomic;
}

export function formatCanonicalRewardAmount(atomic: bigint): string {
  if (atomic < 0n) throw new Error("invalid_reward_amount_format");
  const whole = atomic / SCALE;
  const fractional = (atomic % SCALE).toString().padStart(JELLY_TOKEN_DECIMALS, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

export function compareCanonicalRewardAmounts(left: string, right: string): number {
  const leftAtomic = parseCanonicalRewardAmount(left, { allowZero: true });
  const rightAtomic = parseCanonicalRewardAmount(right, { allowZero: true });
  return leftAtomic < rightAtomic ? -1 : leftAtomic > rightAtomic ? 1 : 0;
}
