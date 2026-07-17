/**
 * Prefixed public ID creation/validation for the namespaced JellyHunt schema.
 *
 * Public IDs are generated once and never change (per the approved v2 design):
 * campaign `cam_`, place `plc_`, mission `mis_`, mission revision `mrv_`,
 * participation `par_`, submission `sub_`, webhook event `evt_`, reward
 * intent `rwd_`, approved completion `cmp_`, leaderboard entry `lbe_`, and
 * the program config singleton `cfg_`.
 */

const PREFIXES = ["cfg", "plc", "cam", "mis", "mrv", "par", "sub", "evt", "rwd", "cmp", "lbe"] as const;

export type JellyhuntPublicPrefix = (typeof PREFIXES)[number];

export const JELLYHUNT_PUBLIC_ID_PREFIXES = PREFIXES;

function randomToken(): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID().replace(/-/g, "");
  }
  let token = "";
  for (let index = 0; index < 32; index += 1) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
}

/** Mint a new, never-reused public ID for the given resource prefix. */
export function createPublicId(prefix: JellyhuntPublicPrefix): string {
  return `${prefix}_${randomToken()}`;
}

/** Validate (and normalize) a caller-supplied or stored public ID for the given resource prefix. */
export function assertPublicId(prefix: JellyhuntPublicPrefix, value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith(`${prefix}_`) || normalized.length <= prefix.length + 1) {
    throw new Error(`invalid_${prefix}_public_id`);
  }
  return normalized;
}
