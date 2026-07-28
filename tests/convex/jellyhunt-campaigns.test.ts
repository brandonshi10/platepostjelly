import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

// See tests/convex/helpers/setup.ts: real generated bindings exist
// (convex/_generated/), but `convex/_generated/api.d.ts` type-references
// every top-level Convex module -- including the pre-namespacing
// `convex/audit.ts`, `convex/missions.ts`, and `convex/submissions.ts`
// files, which still reference table names `convex/schema.ts` retired.
// Importing the typed `api` object here would pull those files into this
// test's TypeScript program and fail `pnpm build`
// (see docs/PLATEPOST_INTEGRATION.md, "Known gap surfaced by turning on
// real typecheck"). `anyApi` avoids that without changing runtime
// behavior: it is the same untyped reference form these tests used before
// codegen existed, still resolved through the hand-built module map below.
const campaigns = anyApi.jellyhunt.campaigns;

function campaignArgs(overrides: Partial<Record<string, unknown>> = {}) {
  const suffix = overrides.slug ?? Math.random().toString(36).slice(2);
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    slug: `season-${suffix}`,
    title: "JellyHunt NYC",
    status: "active" as const,
    startsAt: Date.parse("2026-08-01T00:00:00Z"),
    endsAt: Date.parse("2026-09-01T00:00:00Z"),
    timeZone: "America/New_York",
    rewardTokenCode: "JELLY-MY-JELLY" as const,
    rewardTokenDisplayName: "Jelly-My-Jelly",
    map: {
      centerLatitude: 40.72,
      centerLongitude: -73.99,
      boundsSouth: 40.7,
      boundsWest: -74.0,
      boundsNorth: 40.74,
      boundsEast: -73.97,
      defaultZoom: 13,
    },
    links: { iosApp: "https://apps.apple.com/app/jellyjelly", androidApp: "https://play.google.com/store/apps/jellyjelly" },
    ...overrides,
  };
}

describe("JellyHunt campaign current-selection transaction", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects exactly one current campaign under concurrent mutations", async () => {
    const t = createJellyhuntTestConvex();
    const campaignAId = await t.mutation(campaigns.createCampaign, campaignArgs({ slug: "a" }));
    const campaignBId = await t.mutation(campaigns.createCampaign, campaignArgs({ slug: "b" }));
    const campaignCId = await t.mutation(campaigns.createCampaign, campaignArgs({ slug: "c" }));

    await t.mutation(campaigns.selectCurrentCampaign, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      campaignPublicId: campaignAId,
    });

    // Two concurrent requests to make different campaigns current. Whichever
    // commits last should win, but exactly one campaign must end up current
    // -- never zero, never two.
    await Promise.all([
      t.mutation(campaigns.selectCurrentCampaign, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_2",
        campaignPublicId: campaignBId,
      }),
      t.mutation(campaigns.selectCurrentCampaign, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_3",
        campaignPublicId: campaignCId,
      }),
    ]);

    const currentRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("jellyhuntCampaigns")
        .withIndex("by_is_current", (q) => q.eq("isCurrent", true))
        .collect();
    });

    expect(currentRows).toHaveLength(1);
    expect([campaignBId, campaignCId]).toContain(currentRows[0].publicId);
  });

  it("rejects a second current campaign without clearing the first atomically", async () => {
    const t = createJellyhuntTestConvex();
    const currentCampaignId = await t.mutation(campaigns.createCampaign, campaignArgs({ slug: "live" }));
    const archivedCampaignId = await t.mutation(
      campaigns.createCampaign,
      campaignArgs({ slug: "archived", status: "archived" }),
    );

    await t.mutation(campaigns.selectCurrentCampaign, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      campaignPublicId: currentCampaignId,
    });

    const before = await t.query(campaigns.getCurrentCampaign, {});
    expect(before.campaignPublicId).toBe(currentCampaignId);
    const catalogRevisionBefore = before.catalogRevision;

    await expect(
      t.mutation(campaigns.selectCurrentCampaign, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        campaignPublicId: archivedCampaignId,
      }),
    ).rejects.toThrow(/archived_campaign_cannot_be_current/);

    // The rejected selection must not have cleared (or otherwise touched)
    // the previously current campaign: it is still current, at the same
    // catalogRevision, with no partial-clear side effect.
    const after = await t.query(campaigns.getCurrentCampaign, {});
    expect(after.campaignPublicId).toBe(currentCampaignId);
    expect(after.catalogRevision).toBe(catalogRevisionBefore);
  });

  it("records actor, request, and before/after state in jellyhuntAuditEvents", async () => {
    const t = createJellyhuntTestConvex();
    const campaignAId = await t.mutation(campaigns.createCampaign, campaignArgs({ slug: "audit-a" }));
    const campaignBId = await t.mutation(campaigns.createCampaign, campaignArgs({ slug: "audit-b" }));

    await t.mutation(campaigns.selectCurrentCampaign, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      campaignPublicId: campaignAId,
    });

    await t.mutation(campaigns.selectCurrentCampaign, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_2",
      requestId: "req_selection_42",
      campaignPublicId: campaignBId,
    });

    const events = await t.run(async (ctx) => {
      return await ctx.db.query("jellyhuntAuditEvents").order("desc").collect();
    });

    const selectionEvent = events.find((event) => event.action === "campaign.selected_current" && event.actor === "admin_2");
    expect(selectionEvent).toBeDefined();
    expect(selectionEvent!.entityType).toBe("campaign");

    const previousState = JSON.parse(selectionEvent!.previousStateJson!);
    const nextState = JSON.parse(selectionEvent!.nextStateJson!);
    expect(previousState.currentCampaignPublicId).toBe(campaignAId);
    expect(nextState.currentCampaignPublicId).toBe(campaignBId);

    const metadata = JSON.parse(selectionEvent!.metadataJson!);
    expect(metadata.requestId).toBe("req_selection_42");
  });
});

describe("ensureProgramConfig", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the singleton, is idempotent, and requires the service key", async () => {
    const t = createJellyhuntTestConvex();
    const epoch = Date.parse("2026-07-01T00:00:00Z");

    await expect(
      t.mutation(campaigns.ensureProgramConfig, {
        serviceKey: "wrong-key",
        actorId: "operator",
        leaderboardLaunchEpoch: epoch,
      }),
    ).rejects.toThrow(/unauthorized/);

    const first = await t.mutation(campaigns.ensureProgramConfig, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      leaderboardLaunchEpoch: epoch,
    });
    expect(first).toMatch(/^cfg_/);

    const second = await t.mutation(campaigns.ensureProgramConfig, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      leaderboardLaunchEpoch: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(second).toBe(first);

    const rows = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntProgramConfig").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].leaderboardLaunchEpoch).toBe(epoch);
    expect(rows[0].singletonKey).toBe("default");
  });
});
