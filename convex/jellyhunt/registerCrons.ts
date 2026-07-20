import type { Crons } from "convex/server";

export function registerJellyhuntCrons(_crons: Crons): void {
  // Reward watchdog cron intentionally omitted from this plan.
  // Production enablement requires:
  // 1. JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=true in the Convex environment
  // 2. A reviewed cron interval agreed with PlatePost operations
  // 3. Alerting for uncertain/stuck intents
  //
  // The leaseNextRewardAttempt mutation already checks the env flag and
  // will no-op when rewards are disabled, so registering a cron here
  // is safe but pointless until the flag is set.
}
