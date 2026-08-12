import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

/**
 * Archive every mission from the original 16.
 *
 * All sixteen are old-format missions: one per restaurant, a scavenger-hunt
 * prompt rather than a named menu item, paying 60-110 JELLY. They are replaced
 * by the dish missions in the NYC catalog, which pay 10 each.
 *
 * Archived, never deleted, so revisions, submissions and audit history survive.
 * The places behind the venues we kept survive too, and the new dish missions
 * attach to them.
 *
 * Three groups, with the reason recorded for each:
 *   - superseded: the venue is kept and now has dish missions
 *   - not a dish venue: no menu a videomenu could be built from
 *   - bad record: the address or the business itself does not check out
 */
const LEGACY_MISSIONS = {
  "scarrs-pizza": "superseded by dish missions",
  "trapizzino": "superseded by dish missions",
  "economy-candy": "superseded by dish missions",
  "russ-and-daughters-cafe": "superseded by dish missions",
  "cafe-integral": "superseded by dish missions",
  "the-pastry-box": "superseded by dish missions",
  "librae-bakery": "superseded by dish missions",
  "dimes": "superseded by dish missions",
  "morgensterns": "bad record: W Houston location closed Oct 2025; replaced by morgensterns-rivington",
  "conbud": "not a dish venue: cannabis dispensary, no food",
  "comedy-cellar": "not a dish venue: comedy club",
  "hester-street-fair": "not a dish venue: open-air market with rotating vendors",
  "the-good-company": "not a dish venue: bar",
  "limprimerie": "bad record: actually 1524 Myrtle Ave, Brooklyn, and listed closed",
  "ssam-bar-bang-bar": "bad record: Momofuku Ssam Bar closed 2023; nothing by this name at 171 Stanton",
  "beverlys": "bad record: actually 297 Grand St, and a cocktail bar with little food",
};

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

  console.log(`Connecting to Convex deployment: ${new URL(convexUrl).origin}`);
  const missions = await client.query(anyApi.jellyhunt.admin.listAdminMissions, { serviceKey });

  const targets = missions.filter(
    (mission) => LEGACY_MISSIONS[mission.slug] && mission.status !== "archived",
  );
  const missing = Object.keys(LEGACY_MISSIONS).filter(
    (slug) => !missions.some((m) => m.slug === slug),
  );
  if (missing.length) console.log(`[note] not found in this deployment: ${missing.join(", ")}`);

  for (const mission of targets) {
    if (!apply) {
      console.log(
        `[dry-run] would archive ${mission.slug} (currently ${mission.status}) — ${LEGACY_MISSIONS[mission.slug]}`,
      );
      continue;
    }
    await client.mutation(anyApi.jellyhunt.admin.updateMissionStatus, {
      serviceKey,
      actorId: "nyc-catalog-import",
      missionId: mission._id,
      status: "archived",
    });
    console.log(`[archived] ${mission.slug} — ${LEGACY_MISSIONS[mission.slug]}`);
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${targets.length} mission(s) to archive.`);
  if (!apply && targets.length) {
    console.log("No data was changed. Re-run with --apply only after reviewing this plan.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
