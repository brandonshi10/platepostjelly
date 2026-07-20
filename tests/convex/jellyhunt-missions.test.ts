import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

// See the comment in tests/convex/jellyhunt-campaigns.test.ts: `anyApi` is
// used deliberately instead of the real generated `api` object so this
// file's TypeScript program never transitively type-checks the broken
// pre-namespacing `convex/audit.ts` / `missions.ts` / `submissions.ts`
// files that `convex/_generated/api.d.ts` type-references.
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

/** Build campaign + place + draft mission fixtures. Reviews the place unless `reviewPlace: false`. */
async function setupDraftMission(t: ReturnType<typeof createJellyhuntTestConvex>, options: { reviewPlace?: boolean } = {}) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  if (options.reviewPlace !== false) {
    await t.mutation(places.setPlaceReviewStatus, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      placePublicId,
      reviewStatus: "reviewed",
    });
  }
  const missionPublicId = await t.mutation(missions.createDraftMission, missionArgs(campaignPublicId, placePublicId));
  return { campaignPublicId, placePublicId, missionPublicId };
}

describe("JellyHunt mission publish, edit, and lifecycle transactions", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes an immutable mission revision and increments catalog revision", async () => {
    const t = createJellyhuntTestConvex();
    const { campaignPublicId, missionPublicId } = await setupDraftMission(t);

    const catalogRevisionBefore = await t.run(async (ctx) => {
      const campaign = await ctx.db
        .query("jellyhuntCampaigns")
        .withIndex("by_public_id", (q) => q.eq("publicId", campaignPublicId))
        .unique();
      return campaign!.catalogRevision;
    });

    const result = await t.mutation(missions.publishMissionRevision, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      expectedDraftRevision: 0,
      content: publishContent(),
    });

    expect(result.revision).toBe(1);

    const [revisionRow, missionRow, campaignRow] = await t.run(async (ctx) => {
      const mission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
      const revision = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) => q.eq("missionId", mission!._id).eq("revision", 1))
        .unique();
      const campaign = await ctx.db.get(mission!.campaignId);
      return [revision, mission, campaign];
    });

    expect(revisionRow).toBeDefined();
    expect(revisionRow!.title).toBe("The Scarr's Cheese Pull");
    expect(missionRow!.currentRevision).toBe(1);
    expect(missionRow!.status).toBe("active");
    expect(campaignRow!.catalogRevision).toBe(catalogRevisionBefore + 1);
  });

  it("editing a published mission creates a new draft and never mutates the published revision", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupDraftMission(t);

    await t.mutation(missions.publishMissionRevision, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      expectedDraftRevision: 0,
      content: publishContent(),
    });

    await t.mutation(missions.updateMissionDraft, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      expectedRevision: 1,
      title: "The Scarr's Cheese Pull (Redux)",
    });

    const [missionRow, revisionRow] = await t.run(async (ctx) => {
      const mission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
      const revision = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) => q.eq("missionId", mission!._id).eq("revision", 1))
        .unique();
      return [mission, revision];
    });

    // The mutable draft advanced...
    expect(missionRow!.title).toBe("The Scarr's Cheese Pull (Redux)");
    // ...but the currentRevision pointer did not silently move, and the
    // immutable published revision snapshot kept its original title.
    expect(missionRow!.currentRevision).toBe(1);
    expect(revisionRow!.title).toBe("The Scarr's Cheese Pull");

    // Publishing again creates revision 2 while revision 1 remains untouched.
    await t.mutation(missions.publishMissionRevision, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      expectedDraftRevision: 1,
      content: publishContent({ title: "The Scarr's Cheese Pull (Redux)" }),
    });

    const [revision1Again, revision2, missionAfterRepublish] = await t.run(async (ctx) => {
      const mission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
      const rev1 = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) => q.eq("missionId", mission!._id).eq("revision", 1))
        .unique();
      const rev2 = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission_revision", (q) => q.eq("missionId", mission!._id).eq("revision", 2))
        .unique();
      return [rev1, rev2, mission];
    });

    expect(revision1Again!.title).toBe("The Scarr's Cheese Pull");
    expect(revision2!.title).toBe("The Scarr's Cheese Pull (Redux)");
    expect(missionAfterRepublish!.currentRevision).toBe(2);
  });

  it("pausing a mission blocks new starts but preserves owner history", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupDraftMission(t);

    await t.mutation(missions.publishMissionRevision, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      expectedDraftRevision: 0,
      content: publishContent(),
    });

    const beforePause = await t.run(async (ctx) => {
      const mission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
      const revisions = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission", (q) => q.eq("missionId", mission!._id))
        .collect();
      return { mission, revisionCount: revisions.length };
    });
    expect(beforePause.mission!.status).toBe("active");
    expect(beforePause.mission!.acceptingSubmissions).toBe(true);

    await t.mutation(missions.setMissionLifecycle, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      status: "paused",
    });

    const afterPause = await t.run(async (ctx) => {
      const mission = await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
      const revisions = await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission", (q) => q.eq("missionId", mission!._id))
        .collect();
      return { mission, revisionCount: revisions.length };
    });

    // Pausing blocks new starts...
    expect(afterPause.mission!.status).toBe("paused");
    expect(afterPause.mission!.acceptingSubmissions).toBe(false);
    // ...but preserves owner/mission history: the same published revision
    // pointer and every revision row from before the pause are untouched.
    expect(afterPause.mission!.currentRevision).toBe(beforePause.mission!.currentRevision);
    expect(afterPause.revisionCount).toBe(beforePause.revisionCount);
  });

  it("requires a reviewed canonical Jelly place before activation", async () => {
    const t = createJellyhuntTestConvex();
    const { missionPublicId } = await setupDraftMission(t, { reviewPlace: false });

    await expect(
      t.mutation(missions.publishMissionRevision, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        missionPublicId,
        expectedDraftRevision: 0,
        content: publishContent(),
      }),
    ).rejects.toThrow(/place_not_reviewed/);

    const missionRow = await t.run(async (ctx) => {
      return await ctx.db
        .query("jellyhuntMissions")
        .withIndex("by_public_id", (q) => q.eq("publicId", missionPublicId))
        .unique();
    });
    expect(missionRow!.status).toBe("draft");
    expect(missionRow!.currentRevision).toBe(0);

    const revisionRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("jellyhuntMissionRevisions")
        .withIndex("by_mission", (q) => q.eq("missionId", missionRow!._id))
        .collect();
    });
    expect(revisionRows).toHaveLength(0);
  });

  it("trims a whitespace-padded jellyPlaceId so it dedupes against the unpadded canonical place", async () => {
    const t = createJellyhuntTestConvex();
    const jellyPlaceId = `jpl_${uniqueSuffix()}`;

    await t.mutation(places.createPlace, placeArgs({ jellyPlaceId }));

    await expect(
      t.mutation(places.createPlace, placeArgs({ jellyPlaceId: `  ${jellyPlaceId}\n` })),
    ).rejects.toThrow(/place_already_linked_to_jelly_place_id/);

    const matchingPlaces = await t.run(async (ctx) => {
      return await ctx.db
        .query("jellyhuntPlaces")
        .withIndex("by_jelly_place_id", (q) => q.eq("jellyPlaceId", jellyPlaceId))
        .collect();
    });

    // Exactly one canonical place row exists, and it stored the trimmed
    // (never lowercased) ID.
    expect(matchingPlaces).toHaveLength(1);
    expect(matchingPlaces[0].jellyPlaceId).toBe(jellyPlaceId);
  });
  it("requires canonical six-decimal reward amounts across draft and publish writes", async () => {
    const t = createJellyhuntTestConvex();
    const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
    const placePublicId = await t.mutation(places.createPlace, placeArgs());

    await expect(
      t.mutation(
        missions.createDraftMission,
        missionArgs(campaignPublicId, placePublicId, {
          reward: { amount: "01", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
        }),
      ),
    ).rejects.toThrow("invalid_reward_amount_format");

    const missionPublicId = await t.mutation(
      missions.createDraftMission,
      missionArgs(campaignPublicId, placePublicId),
    );

    await expect(
      t.mutation(missions.updateMissionDraft, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        missionPublicId,
        expectedRevision: 0,
        reward: { amount: "1.0", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      }),
    ).rejects.toThrow("invalid_reward_amount_format");

    await t.mutation(places.setPlaceReviewStatus, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      placePublicId,
      reviewStatus: "reviewed",
    });
    await expect(
      t.mutation(missions.publishMissionRevision, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "admin_1",
        missionPublicId,
        expectedDraftRevision: 0,
        content: publishContent({
          reward: { amount: "1000.000001", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
        }),
      }),
    ).rejects.toThrow("reward_amount_exceeds_ceiling");
  });
});
