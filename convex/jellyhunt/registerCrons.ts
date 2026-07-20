import { anyApi, type Crons, type FunctionReference } from "convex/server";

const runRewardWorker = anyApi.jellyhunt.rewards.runRewardWorker as FunctionReference<
  "action",
  "internal"
>;
const runRewardWatchdog = anyApi.jellyhunt.rewards.runRewardWatchdog as FunctionReference<
  "action",
  "internal"
>;

export function registerJellyhuntCrons(crons: Crons): void {
  // Both jobs are safe to register in every environment. The dispatcher
  // exits unless automatic rewards are explicitly enabled, and Production
  // additionally requires a separate reviewed enablement flag.
  crons.interval("jellyhunt reward dispatcher", { minutes: 1 }, runRewardWorker, {});
  crons.interval("jellyhunt reward lease watchdog", { minutes: 1 }, runRewardWatchdog, {});
}
