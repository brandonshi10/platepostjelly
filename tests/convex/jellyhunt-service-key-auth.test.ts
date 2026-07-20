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
// behavior.
const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

function campaignArgs(overrides: Partial<Record<string, unknown>> = {}) {
  const suffix = uniqueSuffix();
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

function placeArgs(overrides: Partial<Record<string, unknown>> = {}) {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    jellyPlaceId: `jpl_${suffix}`,
    name: "Scarr's Pizza",
    address: "35 Orchard St, New York, NY",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
    ...overrides,
  };
}

function missionArgs(campaignPublicId: string, placePublicId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
    placePublicId,
    slug: `scarrs-cheese-pull-${suffix}`,
    title: "The Scarr's Cheese Pull",
    category: "Pizza",
    difficulty: "easy" as const,
    emoji: "🍕",
    neighborhood: "Lower East Side",
    price: "$",
    sortOrder: 1,
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    approvalMode: "manual" as const,
    ...overrides,
  };
}

function publishContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "The Scarr's Cheese Pull",
    description: "Order one slice and film the cheese pull.",
    instructions: ["Visit the venue during the mission window.", "Record and publish the requested Jelly."],
    requirements: {
      post: {
        allowedPostTypes: ["video"],
        authorshipPolicy: "canonical_owner",
        prompt: "Film the cheese pull and your first reaction.",
        requiredVisibility: "public",
      },
      place: { attachmentRequired: true },
      location: { required: true, trustedSource: "jelly_post" },
      schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
      resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
    },
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    missionWindow: {
      startsAt: Date.parse("2026-08-01T16:00:00Z"),
      endsAt: Date.parse("2026-08-31T23:00:00Z"),
    },
    ...overrides,
  };
}

/** Build campaign + reviewed place + draft mission fixtures using the real (valid) service key. */
async function setupPublishableMission(t: ReturnType<typeof createJellyhuntTestConvex>) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  await t.mutation(places.setPlaceReviewStatus, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    placePublicId,
    reviewStatus: "reviewed",
  });
  const missionPublicId = await t.mutation(missions.createDraftMission, missionArgs(campaignPublicId, placePublicId));
  return { campaignPublicId, placePublicId, missionPublicId };
}

describe("JellyHunt admin/service mutation authorization", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("createCampaign", () => {
    it("rejects a wrong serviceKey", async () => {
      const t = createJellyhuntTestConvex();
      await expect(
        t.mutation(campaigns.createCampaign, campaignArgs({ serviceKey: "wrong-service-key" })),
      ).rejects.toThrow(/unauthorized/);
    });

    it("rejects an empty serviceKey", async () => {
      const t = createJellyhuntTestConvex();
      await expect(
        t.mutation(campaigns.createCampaign, campaignArgs({ serviceKey: "" })),
      ).rejects.toThrow(/unauthorized/);
    });
  });

  describe("publishMissionRevision", () => {
    it("rejects a wrong serviceKey", async () => {
      const t = createJellyhuntTestConvex();
      const { missionPublicId } = await setupPublishableMission(t);

      await expect(
        t.mutation(missions.publishMissionRevision, {
          serviceKey: "wrong-service-key",
          actorId: "admin_1",
          missionPublicId,
          expectedDraftRevision: 0,
          content: publishContent(),
        }),
      ).rejects.toThrow(/unauthorized/);

      const missionRow = await t.run(async (ctx) => {
        return await ctx.db
          .query("jellyhuntMissions")
          .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
          .unique();
      });
      // The rejected call must never have published a revision.
      expect(missionRow!.status).toBe("draft");
      expect(missionRow!.currentRevision).toBe(0);
    });

    it("rejects an empty serviceKey", async () => {
      const t = createJellyhuntTestConvex();
      const { missionPublicId } = await setupPublishableMission(t);

      await expect(
        t.mutation(missions.publishMissionRevision, {
          serviceKey: "",
          actorId: "admin_1",
          missionPublicId,
          expectedDraftRevision: 0,
          content: publishContent(),
        }),
      ).rejects.toThrow(/unauthorized/);

      const missionRow = await t.run(async (ctx) => {
        return await ctx.db
          .query("jellyhuntMissions")
          .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
          .unique();
      });
      expect(missionRow!.status).toBe("draft");
      expect(missionRow!.currentRevision).toBe(0);
    });
  });
});
