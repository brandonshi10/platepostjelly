import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const CATALOG_FILES = [
  "../migrations/nyc-catalog-2026-08.json",
  "../migrations/nyc-catalog-carryover-2026-08.json",
];

const SHOT_TYPES = new Set(["dish", "spread", "action", "display", "ritual"]);
const REWARD_PER_MISSION = 10;

function printUsage() {
  console.log(`Import the NYC dish-mission catalog into Convex.

Usage:
  node scripts/import-nyc-catalog.mjs          # dry run
  node scripts/import-nyc-catalog.mjs --apply  # create missing drafts

Required environment variables:
  CONVEX_URL
  PLATEPOST_CONVEX_SERVICE_KEY

Safety:
  Every mission is created status=draft, approvalMode=manual, 10 JELLY.
  Existing slugs are skipped and never modified. This importer never publishes
  a mission and never initiates a reward.`);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validateCatalog(records) {
  const slugs = new Set();
  const sortOrders = new Set();

  for (const record of records) {
    const venue = record?.venue;
    const missions = record?.missions;
    if (!venue?.slug) throw new Error("Catalog record is missing venue.slug");
    if (!Array.isArray(missions) || missions.length < 3 || missions.length > 5) {
      throw new Error(`${venue.slug}: expected 3-5 missions, got ${missions?.length}`);
    }
    if (!Array.isArray(venue.hours) || venue.hours.length !== 7) {
      throw new Error(`${venue.slug}: hours must have exactly 7 entries`);
    }
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) {
      throw new Error(`${venue.slug}: missing coordinates`);
    }
    if (
      venue.latitude < 40.68 || venue.latitude > 40.88 ||
      venue.longitude < -74.03 || venue.longitude > -73.9
    ) {
      throw new Error(`${venue.slug}: coordinates are not in Manhattan`);
    }
    for (const mission of missions) {
      if (!SHOT_TYPES.has(mission.shotType)) {
        throw new Error(`${mission.slug}: invalid shotType ${mission.shotType}`);
      }
      if (!mission.description?.trim()) {
        throw new Error(`${mission.slug}: empty description`);
      }
      if (slugs.has(mission.slug)) throw new Error(`Duplicate slug: ${mission.slug}`);
      if (sortOrders.has(mission.sortOrder)) {
        throw new Error(`Duplicate sortOrder: ${mission.sortOrder}`);
      }
      slugs.add(mission.slug);
      sortOrders.add(mission.sortOrder);
    }
  }

  return records;
}

function missionPayload(venue, mission) {
  return {
    slug: mission.slug,
    title: mission.title,
    description: mission.description,
    status: "draft",
    approvalMode: "manual",
    restaurantTag: venue.slug,
    rewardAmount: REWARD_PER_MISSION,
    category: venue.category,
    difficulty: mission.difficulty,
    emoji: mission.emoji,
    shotType: mission.shotType,
    neighborhood: venue.neighborhood,
    price: venue.price,
    hours: venue.hours,
    sortOrder: mission.sortOrder,
    ...(venue.websiteUrl ? { websiteUrl: venue.websiteUrl } : {}),
  };
}

async function main() {
  const unknownArgs = process.argv
    .slice(2)
    .filter((arg) => !["--apply", "--help", "-h"].includes(arg));
  if (unknownArgs.length) throw new Error(`Unknown argument: ${unknownArgs.join(", ")}`);
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const apply = process.argv.includes("--apply");
  const convexUrl = requireEnvironment("CONVEX_URL");
  const serviceKey = requireEnvironment("PLATEPOST_CONVEX_SERVICE_KEY");

  const records = [];
  for (const file of CATALOG_FILES) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    records.push(...JSON.parse(await readFile(path, "utf8")));
  }
  validateCatalog(records);

  const client = new ConvexHttpClient(convexUrl);
  console.log(`Connecting to Convex deployment: ${new URL(convexUrl).origin}`);

  const existing = await client.query(anyApi.jellyhunt.admin.listAdminMissions, { serviceKey });
  const existingSlugs = new Set(existing.map((mission) => mission.slug));

  let created = 0;
  let skipped = 0;

  for (const { venue, missions } of records) {
    const pending = missions.filter((mission) => !existingSlugs.has(mission.slug));
    for (const mission of missions.filter((m) => existingSlugs.has(m.slug))) {
      console.log(`[skip] ${mission.slug} already exists; no fields will be changed`);
      skipped += 1;
    }
    if (!pending.length) continue;

    // Reuse the venue's place when one already exists. createMissionWithLocation
    // creates a place and enforces one per restaurantTag, so calling it twice for
    // the same venue throws place_already_linked_to_jelly_place_id. The first
    // mission of a new venue creates the place; every other mission attaches to it.
    let locationId = existing.find((m) => m.restaurantTag === venue.slug)?.location?._id;
    if (locationId) {
      console.log(`[reuse] ${venue.slug}: attaching to existing place ${locationId}`);
    }

    if (!apply) {
      console.log(`[dry-run] ${venue.slug}: would create ${pending.length} draft mission(s)`);
      for (const mission of pending) {
        console.log(`  [dry-run] ${mission.slug} (${mission.shotType})`);
      }
      created += pending.length;
      continue;
    }

    for (const mission of pending) {
      if (!locationId) {
        const result = await client.mutation(
          anyApi.jellyhunt.admin.createMissionWithLocation,
          {
            serviceKey,
            actorId: "nyc-catalog-import",
            mission: missionPayload(venue, mission),
            location: {
              name: venue.name,
              address: venue.address,
              latitude: venue.latitude,
              longitude: venue.longitude,
              geofenceRadiusMeters: venue.geofenceRadiusMeters ?? 75,
              timeZone: venue.timeZone,
            },
          },
        );
        locationId = result.locationId;
      } else {
        await client.mutation(anyApi.jellyhunt.admin.createMissionAtPlace, {
          serviceKey,
          actorId: "nyc-catalog-import",
          locationId,
          mission: missionPayload(venue, mission),
        });
      }
      console.log(`[created] ${mission.slug}`);
      created += 1;
    }
  }

  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${created} mission(s) ${apply ? "created" : "missing"}; ${skipped} existing slug(s) skipped.`,
  );
  console.log(
    "Every mission is a draft. Addresses, coordinates, hours, and dishes require human review before activation.",
  );
  if (!apply && created) {
    console.log("No data was changed. Re-run with --apply only after reviewing this plan.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
