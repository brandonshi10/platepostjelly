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
const events = anyApi.jellyhunt.events;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

function campaignArgs() {
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
    map: { centerLatitude: 40.72, centerLongitude: -73.99, boundsSouth: 40.7, boundsWest: -74.0, boundsNorth: 40.74, boundsEast: -73.97, defaultZoom: 13 },
    links: { iosApp: "https://apps.apple.com/app/jellyjelly" },
  };
}

function placeArgs() {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    jellyPlaceId: `jpl_${suffix}`,
    name: "Scarr's Pizza",
    address: "35 Orchard St",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
    timeZone: "America/New_York",
  };
}

/** Seed a campaign + reviewed place + published mission + a raw submission row, returning its Convex id. */
async function seedSubmission(t: ReturnType<typeof createJellyhuntTestConvex>, jellyUserId: string) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  await t.mutation(places.setPlaceReviewStatus, { serviceKey: TEST_SERVICE_KEY, actorId: "admin_1", placePublicId, reviewStatus: "reviewed" });

  const suffix = uniqueSuffix();
  const missionPublicId = await t.mutation(missions.createDraftMission, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
    placePublicId,
    slug: `mission-${suffix}`,
    title: "Test",
    category: "Food",
    difficulty: "easy" as const,
    emoji: "🍕",
    neighborhood: "LES",
    price: "$",
    sortOrder: 1,
    reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
    approvalMode: "manual" as const,
  });
  await t.mutation(missions.publishMissionRevision, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    missionPublicId,
    expectedDraftRevision: 0,
    content: {
      title: "Test",
      description: "Do it",
      instructions: ["Go"],
      requirements: {
        post: { allowedPostTypes: ["photo"], authorshipPolicy: "self", prompt: "post", requiredVisibility: "public" },
        place: { attachmentRequired: true },
        location: { required: true, trustedSource: "server" },
        schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
      },
      reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
      missionWindow: {},
    },
  });

  const missionRow = await t.run(async (ctx: any) => {
    return await ctx.db.query("jellyhuntMissions").withIndex("by_public_id", (q: any) => q.eq("publicId", missionPublicId)).unique();
  });

  const participationId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("jellyhuntParticipations", {
      publicId: `par_${suffix}`,
      jellyUserId,
      missionId: missionRow._id,
      campaignId: missionRow.campaignId,
      missionRevision: 1,
      status: "started",
      startedAt: Date.now(),
      submissionDeadlineAt: Date.now() + 86400000,
      attemptsUsed: 1,
      maxAttempts: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const submissionPublicId = `sub_${suffix}`;
  await t.run(async (ctx: any) => {
    await ctx.db.insert("jellyhuntSubmissions", {
      publicId: submissionPublicId,
      campaignId: missionRow.campaignId,
      missionId: missionRow._id,
      participationId,
      jellyUserId,
      jellyPostId: `post_${suffix}`,
      dedupeKey: `${jellyUserId}:${missionRow._id}:1`,
      attempt: 1,
      source: "live",
      missionRevision: 1,
      submissionStatus: "submitted",
      rewardStatus: "not_eligible",
      missionTitleSnapshot: "Test",
      approvalModeSnapshot: "manual",
      placeSnapshot: { placeId: missionRow.placeId, jellyPlaceId: "jpl_test", name: "Test", latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75, timeZone: "America/New_York" },
      rewardSnapshot: { amount: "60", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      verificationStatus: "pending",
      verificationAttempts: 0,
      decisionStatus: "pending",
      submittedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return submissionPublicId;
}

function eventArgs(submissionPublicId: string, _jellyUserId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    submissionPublicId,
    type: "submission.created",
    submissionStatus: "submitted" as const,
    rewardStatus: "not_eligible" as const,
    displayStatus: "Submitted",
    occurredAt: Date.now(),
    ...overrides,
  };
}

describe("JellyHunt submission events", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allocates sequential sequence numbers per user", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `user_${uniqueSuffix()}`;
    const submissionId = await seedSubmission(t, jellyUserId);

    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionId, jellyUserId, { type: "submission.created", occurredAt: 1000 }));
    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionId, jellyUserId, { type: "submission.verifying", occurredAt: 2000 }));
    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionId, jellyUserId, { type: "submission.approved", occurredAt: 3000 }));

    const list = await t.query(events.listSubmissionEvents, { serviceKey: TEST_SERVICE_KEY, submissionPublicId: submissionId, jellyUserId });
    expect(list).toHaveLength(3);
    expect(list.map((e: any) => e.sequence)).toEqual([1, 2, 3]);
    expect(list.map((e: any) => e.type)).toEqual(["submission.created", "submission.verifying", "submission.approved"]);
  });

  it("is idempotent on duplicate (submissionId, type, occurredAt)", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `user_${uniqueSuffix()}`;
    const submissionId = await seedSubmission(t, jellyUserId);

    const first = await t.mutation(events.appendSubmissionEvent, eventArgs(submissionId, jellyUserId, { type: "submission.created", occurredAt: 1000 }));
    const second = await t.mutation(events.appendSubmissionEvent, eventArgs(submissionId, jellyUserId, { type: "submission.created", occurredAt: 1000 }));

    expect(second).toBe(first);

    const list = await t.query(events.listSubmissionEvents, { serviceKey: TEST_SERVICE_KEY, submissionPublicId: submissionId, jellyUserId });
    expect(list).toHaveLength(1);
  });

  it("lists only the matching submission's events", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `user_${uniqueSuffix()}`;
    const submissionA = await seedSubmission(t, jellyUserId);
    const submissionB = await seedSubmission(t, jellyUserId);

    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionA, jellyUserId, { type: "submission.created", occurredAt: 1000 }));
    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionB, jellyUserId, { type: "submission.created", occurredAt: 2000 }));
    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionA, jellyUserId, { type: "submission.verifying", occurredAt: 3000 }));

    const listA = await t.query(events.listSubmissionEvents, { serviceKey: TEST_SERVICE_KEY, submissionPublicId: submissionA, jellyUserId });
    const listB = await t.query(events.listSubmissionEvents, { serviceKey: TEST_SERVICE_KEY, submissionPublicId: submissionB, jellyUserId });

    expect(listA).toHaveLength(2);
    expect(listA.every((e: any) => e.submissionId === submissionA)).toBe(true);
    expect(listB).toHaveLength(1);
    expect(listB[0].submissionId).toMatch(/^sub_/);
  });

  it("lists a user's most recent events across submissions, newest first", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `user_${uniqueSuffix()}`;
    const submissionA = await seedSubmission(t, jellyUserId);
    const submissionB = await seedSubmission(t, jellyUserId);

    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionA, jellyUserId, { type: "submission.created", occurredAt: 1000 }));
    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionB, jellyUserId, { type: "submission.created", occurredAt: 2000 }));
    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionA, jellyUserId, { type: "submission.verifying", occurredAt: 3000 }));

    const list = await t.query(events.listUserEvents, { serviceKey: TEST_SERVICE_KEY, jellyUserId });
    expect(list).toHaveLength(3);
    expect(list.map((e: any) => e.sequence)).toEqual([3, 2, 1]);
  });

  it("returns an empty list for a submission's events when queried by a non-owner", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `user_${uniqueSuffix()}`;
    const otherUserId = `user_${uniqueSuffix()}`;
    const submissionId = await seedSubmission(t, jellyUserId);

    await t.mutation(events.appendSubmissionEvent, eventArgs(submissionId, jellyUserId, { type: "submission.created", occurredAt: 1000 }));

    const list = await t.query(events.listSubmissionEvents, { serviceKey: TEST_SERVICE_KEY, submissionPublicId: submissionId, jellyUserId: otherUserId });
    expect(list).toHaveLength(0);
  });

  it("fails closed on owner event reads without the correct service key", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `OpaqueUser_${uniqueSuffix()}`;
    const submissionId = await seedSubmission(t, jellyUserId);

    await expect(
      t.query(events.listSubmissionEvents, { submissionPublicId: submissionId, jellyUserId }),
    ).rejects.toThrow();
    await expect(
      t.query(events.listUserEvents, {
        serviceKey: "wrong-service-key",
        jellyUserId,
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("returns an allowlisted event projection with a stable public submission ID", async () => {
    const t = createJellyhuntTestConvex();
    const jellyUserId = `OpaqueUser_${uniqueSuffix()}`;
    const submissionId = await seedSubmission(t, jellyUserId);
    const submission = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntSubmissions").withIndex("by_public_id", (q: any) => q.eq("publicId", submissionId)).unique(),
    );

    await t.mutation(
      events.appendSubmissionEvent,
      eventArgs(submissionId, jellyUserId, {
        occurredAt: 1000,
        reasonCode: "safe_reason",
        publicMessage: "Safe for the participant",
        internalMetadataJson: JSON.stringify({ operator: "private" }),
      }),
    );

    const [event] = await t.query(events.listSubmissionEvents, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: submissionId,
      jellyUserId,
    });

    expect(event.submissionId).toBe(submission.publicId);
    expect(Object.keys(event).sort()).toEqual([
      "displayStatus",
      "id",
      "occurredAt",
      "publicMessage",
      "reasonCode",
      "rewardStatus",
      "sequence",
      "submissionId",
      "submissionStatus",
      "type",
    ]);
    expect(JSON.stringify(event)).not.toContain("private");
    expect(JSON.stringify(event)).not.toContain(jellyUserId);
  });
  it("derives event ownership from the submission and filters inconsistent indexed rows", async () => {
    const t = createJellyhuntTestConvex();
    const ownerId = `owner_${uniqueSuffix()}`;
    const otherId = `other_${uniqueSuffix()}`;
    const submissionPublicId = await seedSubmission(t, ownerId);
    const submission = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntSubmissions").withIndex("by_public_id", (q: any) => q.eq("publicId", submissionPublicId)).unique(),
    );

    await t.run(async (ctx: any) => {
      await ctx.db.insert("jellyhuntSubmissionEvents", {
        publicId: `evt_${uniqueSuffix()}`,
        submissionId: submission._id,
        jellyUserId: otherId,
        sequence: 1,
        type: "corrupt.owner",
        submissionStatus: "submitted",
        rewardStatus: "not_eligible",
        displayStatus: "submitted",
        occurredAt: 1,
      });
    });

    const leaked = await t.query(events.listUserEvents, {
      serviceKey: TEST_SERVICE_KEY,
      jellyUserId: otherId,
    });
    expect(leaked).toEqual([]);

    await expect(
      t.mutation(events.appendSubmissionEvent, eventArgs("sub_missing", ownerId)),
    ).rejects.toThrow("submission_not_found");
  });
});
