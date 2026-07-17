import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import manifest from "./contracts/jellyhunt-v2/manifest.json";

const FIXTURES_DIR = path.join("tests", "contracts", "jellyhunt-v2");
const OPENAPI_PATH = path.join("openapi", "jellyhunt-v2.yaml");

// Maps each manifest successFixture file name to the OpenAPI component schema
// it must validate against. This mirrors the exact route -> operation ->
// response mapping declared in openapi/jellyhunt-v2.yaml.
const FIXTURE_SCHEMA: Record<string, string> = {
  "campaign-current.200.json": "CampaignEnvelope",
  "missions-list-anonymous.200.json": "MissionListEnvelope",
  "missions-list-viewer.200.json": "MissionListEnvelope",
  "mission-detail-anonymous.200.json": "MissionDetailEnvelope",
  "mission-detail-viewer.200.json": "MissionDetailEnvelope",
  "place-detail.200.json": "PlaceEnvelope",
  "place-jellies.200.json": "JellyFeedEnvelope",
  "participation-created.201.json": "ParticipationStartEnvelope",
  "participation-replay.200.json": "ParticipationStartEnvelope",
  "submission-accepted.202.json": "SubmissionCreatedEnvelope",
  "submission-detail-under-review.200.json": "SubmissionDetailEnvelope",
  "submission-detail-paid-moderated.200.json": "SubmissionDetailEnvelope",
  "submission-events.200.json": "SubmissionEventsEnvelope",
  "me.200.json": "MeEnvelope",
  "me-missions.200.json": "MyMissionsEnvelope",
  "me-submissions.200.json": "MySubmissionsEnvelope",
  "me-events.200.json": "MyEventsEnvelope",
  "leaderboard-current-season.200.json": "LeaderboardEnvelope",
  "leaderboard-all-time.200.json": "LeaderboardEnvelope",
};

// Fixtures for the public / optionally-personalized surface (see the "Public
// or optionally personalized" table in the approved v2 design). Owner-only
// personalized resources (/me, /participations/*, /submissions/*) legitimately
// return the caller's own jellyUserId and are intentionally excluded from this
// public-fixture privacy scan.
const PUBLIC_FIXTURES = [
  "campaign-current.200.json",
  "missions-list-anonymous.200.json",
  "missions-list-viewer.200.json",
  "mission-detail-anonymous.200.json",
  "mission-detail-viewer.200.json",
  "place-detail.200.json",
  "place-jellies.200.json",
  "leaderboard-current-season.200.json",
  "leaderboard-all-time.200.json",
];

const FORBIDDEN_KEY_PATTERN = /convex|wallet|geofence|approvalMode|jellyUserId/i;

const openapiDoc = parseYaml(readFileSync(OPENAPI_PATH, "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(openapiDoc, "openapi");

function compileSchema(name: string) {
  return ajv.compile({ $ref: `openapi#/components/schemas/${name}` });
}

function loadFixture(fileName: string): unknown {
  const raw = readFileSync(path.join(FIXTURES_DIR, fileName), "utf8");
  return JSON.parse(raw);
}

function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe("JellyHunt v2 fixtures", () => {
  it("loads a manifest matching the frozen apiVersion and fixture list", () => {
    expect(manifest.apiVersion).toBe("2.0");
    expect(manifest.successFixtures.length).toBeGreaterThan(0);
    expect(manifest.errorStatuses.length).toBeGreaterThan(0);
  });

  for (const fixtureFile of manifest.successFixtures) {
    it(`validates ${fixtureFile} against its OpenAPI response schema`, () => {
      const schemaName = FIXTURE_SCHEMA[fixtureFile];
      expect(schemaName, `no schema mapping declared for ${fixtureFile}`).toBeDefined();

      const validate = compileSchema(schemaName);
      const fixture = loadFixture(fixtureFile);
      const valid = validate(fixture);

      expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    });
  }

  for (const status of manifest.errorStatuses) {
    it(`validates error-${status}.json against the shared Error schema`, () => {
      const validate = compileSchema("Error");
      const fixture = loadFixture(`error-${status}.json`);
      const valid = validate(fixture);

      expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
    });
  }

  it("keeps every public fixture free of internal/private keys", () => {
    for (const fixtureFile of PUBLIC_FIXTURES) {
      const fixture = loadFixture(fixtureFile);
      const keys = collectKeys(fixture);
      const offending = [...keys].filter((key) => FORBIDDEN_KEY_PATTERN.test(key));

      expect(offending, `${fixtureFile} exposed forbidden keys: ${offending.join(", ")}`).toEqual([]);
    }
  });

  it("pins the exact paid-moderation owner-status fixture", () => {
    const fixture = loadFixture("submission-detail-paid-moderated.200.json") as {
      data: {
        displayStatus: string;
        reasonCode: string;
        canResubmit: boolean;
        nextAction: string;
      };
    };

    expect(fixture.data.displayStatus).toBe("rewarded_removed_from_rankings");
    expect(fixture.data.reasonCode).toBe("post_became_ineligible_after_reward");
    expect(fixture.data.canResubmit).toBe(false);
    expect(fixture.data.nextAction).toBe("contact_support");
  });
});
