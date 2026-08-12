import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

/**
 * Repair opening hours on the carried-over venues.
 *
 * Their hours were copied from the original 16 records, which turned out to be
 * as unreliable as those records' addresses: six of eight were wrong. The worst
 * was The Pastry Box, stored as closed on Sunday and open Monday-Tuesday when
 * it is exactly the opposite — a filmer sent on a Monday would have found a
 * locked door, and one sent on a Sunday would never have been sent at all.
 *
 * Reads the corrected catalog and writes those hours onto every mission at
 * those venues. Dry run first, like every other script here.
 */
const CATALOG = "../migrations/nyc-catalog-carryover-2026-08.json";

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const convexUrl = requireEnvironment("CONVEX_URL");
  const serviceKey = requireEnvironment("PLATEPOST_CONVEX_SERVICE_KEY");
  const client = new ConvexHttpClient(convexUrl);

  const catalog = JSON.parse(
    await readFile(fileURLToPath(new URL(CATALOG, import.meta.url)), "utf8"),
  );
  const wanted = new Map(catalog.map((record) => [record.venue.slug, record.venue]));

  console.log(`Connecting to Convex deployment: ${new URL(convexUrl).origin}`);
  const missions = await client.query(anyApi.jellyhunt.admin.listAdminMissions, { serviceKey });

  let changed = 0;
  let alreadyRight = 0;

  for (const mission of missions) {
    if (mission.status === "archived") continue;
    const venue = wanted.get(mission.restaurantTag);
    if (!venue) continue;

    const current = JSON.stringify(mission.hours);
    const target = JSON.stringify(venue.hours);
    if (current === target) {
      alreadyRight += 1;
      continue;
    }

    if (!apply) {
      console.log(`[dry-run] ${mission.slug}`);
      console.log(`            was ${current}`);
      console.log(`            now ${target}`);
      changed += 1;
      continue;
    }

    await client.mutation(anyApi.jellyhunt.admin.updateMissionWithLocation, {
      serviceKey,
      actorId: "hours-correction",
      missionId: mission._id,
      locationId: mission.location._id,
      mission: {
        slug: mission.slug,
        title: mission.title,
        description: mission.description,
        status: mission.status,
        approvalMode: mission.approvalMode,
        restaurantTag: mission.restaurantTag,
        rewardAmount: mission.rewardAmount,
        category: mission.category,
        difficulty: mission.difficulty,
        emoji: mission.emoji,
        ...(mission.shotType ? { shotType: mission.shotType } : {}),
        neighborhood: mission.neighborhood,
        price: mission.price,
        hours: venue.hours,
        sortOrder: mission.sortOrder,
        ...(mission.websiteUrl ? { websiteUrl: mission.websiteUrl } : {}),
      },
      location: {
        name: mission.location.name,
        address: mission.location.address,
        latitude: mission.location.latitude,
        longitude: mission.location.longitude,
        geofenceRadiusMeters: mission.location.geofenceRadiusMeters,
        timeZone: mission.location.timeZone,
      },
    });
    console.log(`[fixed] ${mission.slug}`);
    changed += 1;
  }

  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${changed} mission(s) ${apply ? "corrected" : "to correct"}; ${alreadyRight} already right.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
