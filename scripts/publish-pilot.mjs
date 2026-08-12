import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

/**
 * Publish the pilot cohort: every mission at ten hand-checked venues.
 *
 * Deliberately spread across neighbourhoods rather than clustered, so the map
 * reads as a city. Everything else stays draft and is switched on from /admin
 * with no code change.
 */
const PILOT_VENUES = [
  "supermoon-bakehouse",        // Lower East Side
  "scarrs-pizza",               // Lower East Side
  "nan-xiang-soup-dumplings",   // East Village
  "xing-fu-tang",               // East Village
  "miss-korea-bbq",             // Koreatown
  "mitr-thai-restaurant",       // Midtown
  "amor-loco",                  // Midtown
  "shuka",                      // SoHo
  "taiyaki-nyc",                // Chinatown
  "figo-il-gelato-italiano",    // Nolita
];

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const revert = process.argv.includes("--revert");
  const convexUrl = requireEnvironment("CONVEX_URL");
  const serviceKey = requireEnvironment("PLATEPOST_CONVEX_SERVICE_KEY");
  const client = new ConvexHttpClient(convexUrl);
  const target = revert ? "draft" : "active";

  console.log(`Connecting to Convex deployment: ${new URL(convexUrl).origin}`);
  const missions = await client.query(anyApi.jellyhunt.admin.listAdminMissions, { serviceKey });

  const targets = missions.filter(
    (mission) =>
      PILOT_VENUES.includes(mission.restaurantTag) &&
      mission.status !== "archived" &&
      mission.status !== target,
  );

  const missing = PILOT_VENUES.filter(
    (slug) => !missions.some((m) => m.restaurantTag === slug),
  );
  if (missing.length) console.log(`[note] venue not found: ${missing.join(", ")}`);

  // A mission cannot go active without reward capacity behind it --
  // applyMissionBudgets throws reward_budget_capacity_required. The budget rows
  // already exist (the importer creates them at zero), so allocating is a matter
  // of setting an amount on the campaign scope and on each mission scope.
  const CAMPAIGN_ALLOCATION = "10000";
  const MISSION_ALLOCATION = "100"; // ten completions per mission at 10 JELLY

  if (apply && !revert) {
    const campaign = await client.query(anyApi.jellyhunt.campaigns.getCurrentCampaign, {});
    const campaignBudget = await client.mutation(anyApi.jellyhunt.budgets.setBudgetAllocation, {
      serviceKey,
      scopeType: "campaign",
      scopeKey: campaign.campaignPublicId,
      allocatedAmount: CAMPAIGN_ALLOCATION,
      expectedRevision: 0,
    }).catch((error) => {
      if (String(error).includes("budget_revision_conflict")) {
        console.log("[budget] campaign allocation already set; leaving it alone");
        return null;
      }
      throw error;
    });
    if (campaignBudget) console.log(`[budget] campaign allocated ${CAMPAIGN_ALLOCATION}`);

    for (const mission of targets) {
      await client.mutation(anyApi.jellyhunt.budgets.setBudgetAllocation, {
        serviceKey,
        scopeType: "mission",
        scopeKey: mission._id,
        allocatedAmount: MISSION_ALLOCATION,
        expectedRevision: 0,
      }).catch((error) => {
        if (String(error).includes("budget_revision_conflict")) return null;
        throw error;
      });
    }
    console.log(`[budget] ${targets.length} mission allocation(s) set to ${MISSION_ALLOCATION}`);
  }

  for (const mission of targets) {
    if (!apply) {
      console.log(`[dry-run] would set ${mission.slug} -> ${target} (currently ${mission.status})`);
      continue;
    }
    await client.mutation(anyApi.jellyhunt.admin.updateMissionStatus, {
      serviceKey,
      actorId: "brandon@platepost.io",
      missionId: mission._id,
      status: target,
    });
    console.log(`[${target}] ${mission.slug}`);
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${targets.length} mission(s) -> ${target}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
