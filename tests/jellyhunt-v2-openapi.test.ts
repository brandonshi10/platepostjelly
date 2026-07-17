import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REQUIRED = [
  "getCurrentCampaign",
  "listMissions",
  "getMission",
  "getMissionJellies",
  "getPlace",
  "getPlaceJellies",
  "startMissionParticipation",
  "getParticipation",
  "createMissionSubmission",
  "getSubmission",
  "listSubmissionEvents",
  "getMe",
  "listMyMissions",
  "listMySubmissions",
  "listMyEvents",
  "getCurrentSeasonLeaderboard",
  "getAllTimeLeaderboard",
] as const;

describe("JellyHunt v2 OpenAPI", () => {
  it("declares every approved operation exactly once", () => {
    const source = readFileSync("openapi/jellyhunt-v2.yaml", "utf8");
    for (const operationId of REQUIRED) {
      expect(source.match(new RegExp(`operationId: ${operationId}`, "g"))).toHaveLength(1);
    }
  });
});
