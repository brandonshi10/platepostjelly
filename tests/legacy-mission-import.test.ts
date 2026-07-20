import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdminMissionSchema } from "../src/lib/jellyhunt/admin-contracts";

const migrationPath = "migrations/legacy-jellyhunt-missions.json";
const importerPath = "scripts/import-legacy-jellyhunt.mjs";

type MigrationRecord = {
  legacyId: number;
  mission: Record<string, unknown>;
  location: Record<string, unknown>;
};

function readMigration(): MigrationRecord[] {
  if (!existsSync(migrationPath)) return [];
  return JSON.parse(readFileSync(migrationPath, "utf8")) as MigrationRecord[];
}

describe("legacy Jellyhunt mission migration", () => {
  it("contains all 16 legacy missions in admin-valid draft/manual form", () => {
    const records = readMigration();

    expect(records).toHaveLength(16);
    for (const record of records) {
      expect(
        createAdminMissionSchema.safeParse({
          mission: record.mission,
          location: record.location,
        }).success,
      ).toBe(true);
      expect(record.mission).toMatchObject({
        status: "draft",
        approvalMode: "manual",
      });
    }
  });

  it("preserves one unique, ordered record for each legacy mission", () => {
    const records = readMigration();
    const slugs = records.map((record) => record.mission.slug);

    expect(records.map((record) => record.legacyId)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(new Set(slugs).size).toBe(16);
    expect(records.map((record) => record.mission.sortOrder)).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
  });

  it("keeps the importer dry-run by default and uses slug-based idempotency", () => {
    const source = existsSync(importerPath) ? readFileSync(importerPath, "utf8") : "";

    expect(source).toContain("ConvexHttpClient");
    expect(source).toContain("anyApi.jellyhunt.admin.listAdminMissions");
    expect(source).toContain("anyApi.jellyhunt.admin.createMissionWithLocation");
    expect(source).not.toContain("anyApi.missions.");
    expect(source).toContain('process.argv.includes("--apply")');
    expect(source).toContain("CONVEX_URL");
    expect(source).toContain("PLATEPOST_CONVEX_SERVICE_KEY");
    expect(source).toContain("Connecting to Convex deployment:");
    expect(source).toContain("[skip]");
    expect(source).toContain("Human review is required");
    expect(source).not.toContain("updateMissionStatus");
    expect(source).not.toContain("sendReward");
  });
});
