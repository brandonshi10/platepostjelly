import { describe, expect, it } from "vitest";
import { JELLYHUNT_TABLE_NAMES, jellyhuntTables } from "../../convex/jellyhunt/schema";

const EXPECTED = [
  "jellyhuntProgramConfig",
  "jellyhuntPlaces",
  "jellyhuntCampaigns",
  "jellyhuntMissions",
  "jellyhuntMissionRevisions",
  "jellyhuntParticipations",
  "jellyhuntSubmissions",
  "jellyhuntSubmissionEvents",
  "jellyhuntIdempotencyRecords",
  "jellyhuntRewardBudgets",
  "jellyhuntRewardReservations",
  "jellyhuntRewardIntents",
  "jellyhuntRewardAttempts",
  "jellyhuntWebhookInbox",
  "jellyhuntWebhookEvents",
  "jellyhuntWebhookDeliveries",
  "jellyhuntAuditEvents",
  "jellyhuntPublicProfiles",
  "jellyhuntApprovedCompletions",
  "jellyhuntLeaderboardEntries",
  "jellyhuntLeaderboardEvents",
  "jellyhuntLegacyDedupeRecords",
] as const;

describe("JellyHunt namespaced schema", () => {
  it("uses the complete collision-safe physical table inventory", () => {
    expect(JELLYHUNT_TABLE_NAMES).toEqual(EXPECTED);
    expect(EXPECTED.every((name) => name.startsWith("jellyhunt"))).toBe(true);
  });

  it("exposes exactly one defineTable entry per inventoried table name", () => {
    expect(Object.keys(jellyhuntTables).sort()).toEqual([...EXPECTED].sort());
  });
});
