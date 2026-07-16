import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const migrationFile = fileURLToPath(
  new URL("../migrations/legacy-jellyhunt-missions.json", import.meta.url),
);

function printUsage() {
  console.log(`Import the 16 legacy Jellyhunt missions into Convex.

Usage:
  node scripts/import-legacy-jellyhunt.mjs          # dry run
  node scripts/import-legacy-jellyhunt.mjs --apply  # create missing drafts

Required environment variables:
  CONVEX_URL
  PLATEPOST_CONVEX_SERVICE_KEY

Safety:
  Every record must be status=draft and approvalMode=manual. Existing slugs are
  skipped. This importer never publishes missions and never initiates rewards.`);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validateMigration(records) {
  if (!Array.isArray(records) || records.length !== 16) {
    throw new Error("Migration must contain exactly 16 legacy missions");
  }

  const legacyIds = new Set();
  const slugs = new Set();
  for (const record of records) {
    const { legacyId, mission, location } = record ?? {};
    if (!Number.isInteger(legacyId) || legacyIds.has(legacyId)) {
      throw new Error(`Invalid or duplicate legacyId: ${legacyId}`);
    }
    if (!mission || typeof mission.slug !== "string" || !mission.slug.trim()) {
      throw new Error(`Legacy mission ${legacyId} is missing a slug`);
    }
    if (slugs.has(mission.slug)) {
      throw new Error(`Duplicate migration slug: ${mission.slug}`);
    }
    if (mission.status !== "draft" || mission.approvalMode !== "manual") {
      throw new Error(
        `Unsafe migration record ${mission.slug}: imports must be draft/manual`,
      );
    }
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error(`Legacy mission ${mission.slug} is missing coordinates`);
    }
    legacyIds.add(legacyId);
    slugs.add(mission.slug);
  }

  return records;
}

async function main() {
  const unknownArgs = process.argv.slice(2).filter((arg) => !["--apply", "--help", "-h"].includes(arg));
  if (unknownArgs.length) throw new Error(`Unknown argument: ${unknownArgs.join(", ")}`);
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const apply = process.argv.includes("--apply");
  const convexUrl = requireEnvironment("CONVEX_URL");
  const serviceKey = requireEnvironment("PLATEPOST_CONVEX_SERVICE_KEY");
  const records = validateMigration(JSON.parse(await readFile(migrationFile, "utf8")));
  const deploymentOrigin = new URL(convexUrl).origin;
  const client = new ConvexHttpClient(convexUrl);

  console.log(`Connecting to Convex deployment: ${deploymentOrigin}`);
  const existingMissions = await client.query(anyApi.missions.listAdminMissions, {
    serviceKey,
  });
  const existingSlugs = new Set(existingMissions.map((mission) => mission.slug));
  const missing = records.filter((record) => !existingSlugs.has(record.mission.slug));
  const skippedRecords = records.filter((record) => existingSlugs.has(record.mission.slug));

  for (const record of skippedRecords) {
    console.log(`[skip] ${record.mission.slug} already exists; no fields will be changed`);
  }
  console.log(
    "Human review is required for addresses, coordinates, restaurant tags, geofences, hours, and rewards before activation.",
  );
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${missing.length} mission(s) missing; ${skippedRecords.length} existing slug(s) skipped.`,
  );

  for (const record of missing) {
    if (!apply) {
      console.log(`[dry-run] Would create ${record.mission.slug} as draft/manual`);
      continue;
    }

    await client.mutation(anyApi.missions.createMissionWithLocation, {
      serviceKey,
      actor: "legacy-jellyhunt-import",
      mission: record.mission,
      location: record.location,
    });
    console.log(`[created] ${record.mission.slug}`);
  }

  if (!apply && missing.length) {
    console.log("No data was changed. Re-run with --apply only after reviewing this plan.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
