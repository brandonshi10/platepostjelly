import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const campaigns = anyApi.jellyhunt.campaigns;
const places = anyApi.jellyhunt.places;
const missions = anyApi.jellyhunt.missions;
const submissions = anyApi.jellyhunt.submissions;

function uniqueSuffix() {
  return Math.random().toString(36).slice(2);
}

function campaignArgs(overrides: Record<string, unknown> = {}) {
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
    links: { iosApp: "https://apps.apple.com/app/jellyjelly" },
    ...overrides,
  };
}

function placeArgs(overrides: Record<string, unknown> = {}) {
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

async function seedCampaignAndMission(t: any) {
  const campaignPublicId = await t.mutation(campaigns.createCampaign, campaignArgs());
  await t.mutation(campaigns.selectCurrentCampaign, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
  });

  const placePublicId = await t.mutation(places.createPlace, placeArgs());
  await t.mutation(places.setPlaceReviewStatus, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    placePublicId,
    reviewStatus: "reviewed",
  });

  const suffix = uniqueSuffix();
  const missionPublicId = await t.mutation(missions.createDraftMission, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "admin_1",
    campaignPublicId,
    placePublicId,
    slug: `mission-${suffix}`,
    title: "Test Mission",
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
      title: "Test Mission",
      description: "Do the thing",
      instructions: ["Step 1"],
      requirements: {
        post: { allowedPostTypes: ["photo"], authorshipPolicy: "self", prompt: "post it", requiredVisibility: "public" },
        place: { attachmentRequired: true },
        location: { required: true, trustedSource: "server" },
        schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
        resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
      },
      reward: { amount: "60", token: "JELLY-MY-JELLY" as const, displayName: "Jelly-My-Jelly" },
      missionWindow: {},
    },
  });

  return { campaignPublicId, placePublicId, missionPublicId };
}

async function seedParticipation(
  t: any,
  missionPublicId: string,
  jellyUserId: string,
  overrides: Record<string, unknown> = {},
) {
  const suffix = uniqueSuffix();
  const now = Date.now();

  const missionRow = await t.run(async (ctx: any) => {
    return await ctx.db
      .query("jellyhuntMissions")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", missionPublicId))
      .unique();
  });

  const participationPublicId = `par_${suffix}`;
  await t.run(async (ctx: any) => {
    await ctx.db.insert("jellyhuntParticipations", {
      publicId: participationPublicId,
      jellyUserId,
      missionId: missionRow._id,
      campaignId: missionRow.campaignId,
      missionRevision: missionRow.currentRevision,
      status: "started",
      startedAt: now,
      submissionDeadlineAt: now + 86_400_000,
      attemptsUsed: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  });

  return { participationPublicId, missionRevision: missionRow.currentRevision };
}

function submitArgs(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const suffix = uniqueSuffix();
  return {
    serviceKey: TEST_SERVICE_KEY,
    jellyPostId: `post_${suffix}`,
    dedupeKey: `dedupe_${suffix}`,
    attempt: 1,
    now: Date.now(),
    ...overrides,
  };
}

describe("createSubmission", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a submission for a valid participation", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_1";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);

    const result = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId,
        missionRevision,
      }),
    );

    expect(result.submissionPublicId).toMatch(/^sub_/);

    const fetched = await t.query(submissions.getSubmissionByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: result.submissionPublicId,
      jellyUserId,
    });
    expect(fetched).not.toBeNull();
    expect(fetched.submissionStatus).toBe("submitted");
    expect(fetched.rewardSnapshot.amount).toBe("60");
  });

  it("blocks reuse of the same Jelly post across submissions", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_1";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);

    const sharedPostId = `post_${uniqueSuffix()}`;

    await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId,
        missionRevision,
        jellyPostId: sharedPostId,
      }),
    );

    const { participationPublicId: participation2 } = await seedParticipation(t, missionPublicId, jellyUserId, {
      status: "started",
    });

    await expect(
      t.mutation(
        submissions.createSubmission,
        submitArgs({
          jellyUserId,
          missionPublicId,
          participationPublicId: participation2,
          missionRevision,
          jellyPostId: sharedPostId,
          attempt: 2,
        }),
      ),
    ).rejects.toThrow("jelly_post_reused");
  });

  it("blocks a duplicate dedupeKey while the prior submission is not rejected", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_1";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);

    const dedupeKey = `dedupe_${uniqueSuffix()}`;

    await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId,
        missionRevision,
        dedupeKey,
      }),
    );

    await expect(
      t.mutation(
        submissions.createSubmission,
        submitArgs({
          jellyUserId,
          missionPublicId,
          participationPublicId,
          missionRevision,
          dedupeKey,
        }),
      ),
    ).rejects.toThrow("mission_already_submitted");
  });

  it("allows resubmission under the same dedupeKey once the prior submission was rejected", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_1";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);

    const dedupeKey = `dedupe_${uniqueSuffix()}`;

    const first = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId,
        missionRevision,
        dedupeKey,
      }),
    );

    await t.run(async (ctx: any) => {
      const sub = await ctx.db
        .query("jellyhuntSubmissions")
        .withIndex("by_public_id", (q: any) => q.eq("publicId", first.submissionPublicId))
        .unique();
      await ctx.db.patch(sub._id, { submissionStatus: "rejected" });
    });

    const second = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId,
        missionRevision,
        dedupeKey,
        attempt: 2,
      }),
    );

    expect(second.submissionPublicId).toMatch(/^sub_/);
  });

  it("rejects submission after the participation's submission deadline has passed", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_1";
    const now = Date.now();
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId, {
      submissionDeadlineAt: now - 1000,
    });

    await expect(
      t.mutation(
        submissions.createSubmission,
        submitArgs({
          jellyUserId,
          missionPublicId,
          participationPublicId,
          missionRevision,
          now,
        }),
      ),
    ).rejects.toThrow("submission_deadline_passed");
  });

  it("returns null from getSubmissionByPublicId for a non-owner", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_1";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);

    const result = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId,
        missionRevision,
      }),
    );

    const asOwner = await t.query(submissions.getSubmissionByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: result.submissionPublicId,
      jellyUserId,
    });
    expect(asOwner).not.toBeNull();

    const asOther = await t.query(submissions.getSubmissionByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: result.submissionPublicId,
      jellyUserId: "someone_else",
    });
    expect(asOther).toBeNull();
  });

  it("lists a user's submissions newest first", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_list";

    const first = await seedParticipation(t, missionPublicId, jellyUserId);
    const s1 = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId: first.participationPublicId,
        missionRevision: first.missionRevision,
        now: Date.now(),
      }),
    );

    const second = await seedParticipation(t, missionPublicId, jellyUserId);
    const s2 = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId: second.participationPublicId,
        missionRevision: second.missionRevision,
        now: Date.now() + 1000,
      }),
    );

    const list = await t.query(submissions.listUserSubmissions, { serviceKey: TEST_SERVICE_KEY, jellyUserId });
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(s2.submissionPublicId);
    expect(list[1].id).toBe(s1.submissionPublicId);
  });
  it("checks the create service key before parsing caller-controlled resource IDs", async () => {
    await expect(
      t.mutation(submissions.createSubmission, {
        serviceKey: "wrong-service-key",
        jellyUserId: "OpaqueUser_A",
        missionPublicId: "not-a-mission-id",
        participationPublicId: "not-a-participation-id",
        missionRevision: 1,
        jellyPostId: "post_untrusted",
        dedupeKey: "dedupe_untrusted",
        attempt: 1,
        now: Date.now(),
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("fails closed on owner reads without the correct service key", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "OpaqueUser_Read";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);
    const result = await t.mutation(
      submissions.createSubmission,
      submitArgs({ jellyUserId, missionPublicId, participationPublicId, missionRevision }),
    );

    await expect(
      t.query(submissions.getSubmissionByPublicId, {
        submissionPublicId: result.submissionPublicId,
        jellyUserId,
      }),
    ).rejects.toThrow();
    await expect(
      t.query(submissions.listUserSubmissions, {
        serviceKey: "wrong-service-key",
        jellyUserId,
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("returns stable public IDs and omits raw geofence/internal fields", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "OpaqueUser_CaseSensitive";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);
    const result = await t.mutation(
      submissions.createSubmission,
      submitArgs({ jellyUserId, missionPublicId, participationPublicId, missionRevision }),
    );

    const fetched = await t.query(submissions.getSubmissionByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: result.submissionPublicId,
      jellyUserId: `  ${jellyUserId}  `,
    });

    expect(fetched).not.toBeNull();
    expect(fetched.campaignId).toMatch(/^cam_/);
    expect(fetched.missionId).toBe(missionPublicId);
    expect(fetched.participationId).toBe(participationPublicId);
    expect(fetched.placeSnapshot.placeId).toMatch(/^plc_/);
    expect(fetched.placeSnapshot).not.toHaveProperty("geofenceRadiusMeters");
    expect(fetched).not.toHaveProperty("jellyUserId");
    expect(fetched).not.toHaveProperty("dedupeKey");
    expect(fetched).not.toHaveProperty("_id");
    expect(fetched).not.toHaveProperty("_creationTime");

    const lowercased = await t.query(submissions.getSubmissionByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: result.submissionPublicId,
      jellyUserId: jellyUserId.toLowerCase(),
    });
    expect(lowercased).toBeNull();
  });

  it.each(["", "   ", "x".repeat(257)])("rejects an invalid opaque Jelly post ID", async (jellyPostId) => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_invalid_post";
    const { participationPublicId, missionRevision } = await seedParticipation(t, missionPublicId, jellyUserId);

    await expect(
      t.mutation(
        submissions.createSubmission,
        submitArgs({ jellyUserId, missionPublicId, participationPublicId, missionRevision, jellyPostId }),
      ),
    ).rejects.toThrow("invalid_jelly_post_id");
  });

  it("honors the participation's immutable mission revision after a newer revision is published", async () => {
    const { missionPublicId } = await seedCampaignAndMission(t);
    const jellyUserId = "user_revision_lock";
    const locked = await seedParticipation(t, missionPublicId, jellyUserId);

    await t.mutation(missions.publishMissionRevision, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "admin_1",
      missionPublicId,
      expectedDraftRevision: 1,
      content: {
        title: "Changed Mission",
        description: "Changed after this user started",
        instructions: ["New step"],
        requirements: {
          post: { allowedPostTypes: ["video"], authorshipPolicy: "canonical_owner", prompt: "new", requiredVisibility: "public" },
          place: { attachmentRequired: true },
          location: { required: true, trustedSource: "server" },
          schedule: { mustBeWithinMissionWindow: false, mustBeDuringVenueHours: false },
          resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
        },
        reward: { amount: "50", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
        missionWindow: {},
      },
    });

    const result = await t.mutation(
      submissions.createSubmission,
      submitArgs({
        jellyUserId,
        missionPublicId,
        participationPublicId: locked.participationPublicId,
        missionRevision: locked.missionRevision,
      }),
    );
    const fetched = await t.query(submissions.getSubmissionByPublicId, {
      serviceKey: TEST_SERVICE_KEY,
      submissionPublicId: result.submissionPublicId,
      jellyUserId,
    });

    expect(fetched.missionTitleSnapshot).toBe("Test Mission");
    expect(fetched.rewardSnapshot.amount).toBe("60");
  });
});
