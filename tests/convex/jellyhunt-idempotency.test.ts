import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJellyhuntTestConvex, TEST_SERVICE_KEY } from "./helpers/setup";

const idempotency = anyApi.jellyhunt.idempotency;
const DAY_MS = 86_400_000;
const BASE_NOW = 1_000_000;

function leaseArgs(overrides: Record<string, unknown> = {}) {
  return {
    jellySubjectId: "user_1",
    httpMethod: "POST",
    normalizedPath: "/api/v2/jellyhunt/missions/msn_1/submissions",
    idempotencyKey: "opaque-key-1",
    requestHash: "hash-a",
    originalRequestId: "req-1",
    leaseOwner: "worker-1",
    now: BASE_NOW,
    ...overrides,
  };
}

async function loadOnlyRecord(t: any) {
  return await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("jellyhuntIdempotencyRecords").collect();
    expect(rows).toHaveLength(1);
    return rows[0];
  });
}

async function seedDurableSubmission(t: any, publicId: string) {
  await t.run(async (ctx: any) => {
    const now = BASE_NOW;
    const campaignId = await ctx.db.insert("jellyhuntCampaigns", {
      publicId: "cmp_idem",
      slug: "idem-campaign",
      title: "Idempotency campaign",
      status: "active",
      isCurrent: true,
      startsAt: now - DAY_MS,
      endsAt: now + DAY_MS,
      timeZone: "UTC",
      rewardToken: { code: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      map: {
        centerLatitude: 0,
        centerLongitude: 0,
        boundsSouth: -1,
        boundsWest: -1,
        boundsNorth: 1,
        boundsEast: 1,
        defaultZoom: 10,
      },
      links: {},
      catalogRevision: 1,
      leaderboardRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
    const placeId = await ctx.db.insert("jellyhuntPlaces", {
      publicId: "plc_idem",
      jellyPlaceId: "jpl_idem",
      name: "Idempotency Place",
      latitude: 0,
      longitude: 0,
      geofenceRadiusMeters: 50,
      timeZone: "UTC",
      reviewStatus: "reviewed",
      createdAt: now,
      updatedAt: now,
    });
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId: "msn_idem",
      campaignId,
      slug: "idem-mission",
      status: "active",
      approvalMode: "manual",
      currentRevision: 1,
      title: "Idempotency mission",
      category: "Food",
      difficulty: "easy",
      emoji: "🍮",
      neighborhood: "Test",
      price: "$",
      sortOrder: 1,
      placeId,
      reward: { amount: "1", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      acceptingSubmissions: true,
      createdAt: now,
      updatedAt: now,
    });
    const participationId = await ctx.db.insert("jellyhuntParticipations", {
      publicId: "par_idem",
      jellyUserId: "user_1",
      missionId,
      campaignId,
      missionRevision: 1,
      status: "started",
      startedAt: now,
      submissionDeadlineAt: now + DAY_MS,
      attemptsUsed: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("jellyhuntSubmissions", {
      publicId,
      campaignId,
      missionId,
      participationId,
      jellyUserId: "user_1",
      jellyPostId: "post_idem",
      dedupeKey: "dedupe_idem",
      attempt: 1,
      source: "live",
      missionRevision: 1,
      submissionStatus: "submitted",
      rewardStatus: "not_eligible",
      missionTitleSnapshot: "Idempotency mission",
      approvalModeSnapshot: "manual",
      placeSnapshot: {
        placeId,
        jellyPlaceId: "jpl_idem",
        name: "Idempotency Place",
        latitude: 0,
        longitude: 0,
        geofenceRadiusMeters: 50,
        timeZone: "UTC",
      },
      rewardSnapshot: { amount: "1", token: "JELLY-MY-JELLY", displayName: "Jelly-My-Jelly" },
      verificationStatus: "pending",
      verificationAttempts: 0,
      decisionStatus: "pending",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("durable HTTP idempotency", () => {
  let t: any;

  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
    t = createJellyhuntTestConvex();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("acquires a generation-bound 60-second lease and retains the record for 180 days", async () => {
    const result = await t.mutation(idempotency.acquireIdempotencyLease, leaseArgs());

    expect(result).toMatchObject({
      status: "acquired",
      leaseOwner: "worker-1",
      leaseGeneration: 1,
      processingExpiresAt: BASE_NOW + 60_000,
      expiresAt: BASE_NOW + 180 * DAY_MS,
    });
  });

  it("stores only a SHA-256 key hash and canonical method/path while preserving the opaque subject", async () => {
    await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({
        jellySubjectId: "  User_ABC  ",
        httpMethod: "post",
        normalizedPath: "/api/v2/jellyhunt/./missions/msn_1/submissions/",
        idempotencyKey: "  Case-Sensitive Opaque Key  ",
      }),
    );

    const stored = await loadOnlyRecord(t);
    expect(stored.jellySubjectId).toBe("User_ABC");
    expect(stored.httpMethod).toBe("POST");
    expect(stored.normalizedPath).toBe("/api/v2/jellyhunt/missions/msn_1/submissions");
    expect(stored).not.toHaveProperty("idempotencyKey");
    expect(stored.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.keyHash).not.toContain("Case-Sensitive Opaque Key");
  });

  it("returns in_progress while the current lease is live", async () => {
    await t.mutation(idempotency.acquireIdempotencyLease, leaseArgs());

    const result = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ leaseOwner: "worker-2", now: BASE_NOW + 10 }),
    );

    expect(result).toEqual({ status: "in_progress", retryAfter: 59_990 });
  });

  it("compares requestHash before expired-lease reclaim logic", async () => {
    await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ resourcePublicId: "sub_future" }),
    );

    const result = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({
        requestHash: "hash-b",
        leaseOwner: "worker-2",
        now: BASE_NOW + 60_001,
      }),
    );

    expect(result).toEqual({ status: "key_reused" });
  });

  it("safely reclaims an expired lease only after proving the bound submission is absent", async () => {
    await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ resourcePublicId: "sub_future" }),
    );

    const result = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ leaseOwner: "worker-2", now: BASE_NOW + 60_001 }),
    );

    expect(result).toMatchObject({
      status: "acquired",
      leaseOwner: "worker-2",
      leaseGeneration: 2,
      processingExpiresAt: BASE_NOW + 120_001,
    });
  });

  it("refuses blind reclaim when no durable-work locator was bound", async () => {
    await t.mutation(idempotency.acquireIdempotencyLease, leaseArgs());

    const result = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ leaseOwner: "worker-2", now: BASE_NOW + 60_001 }),
    );

    expect(result).toEqual({ status: "recovery_required" });
  });

  it("fails closed when a bound durable submission exists without exact response bytes", async () => {
    await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ resourcePublicId: "sub_committed" }),
    );
    await seedDurableSubmission(t, "sub_committed");

    const result = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ leaseOwner: "worker-2", now: BASE_NOW + 60_001 }),
    );

    expect(result).toEqual({ status: "recovery_required" });
  });

  it("replays the exact completed response and original request identity", async () => {
    const acquired = await t.mutation(idempotency.acquireIdempotencyLease, leaseArgs());
    const bodyJson = '{"data":{"id":"sub_123"},"meta":{"requestId":"req-1"}}';
    const headersJson = '{"Cache-Control":"no-store","ETag":"opaque-etag"}';

    expect(
      await t.mutation(idempotency.completeIdempotencyRecord, {
        recordId: acquired.recordId,
        leaseOwner: acquired.leaseOwner,
        leaseGeneration: acquired.leaseGeneration,
        responseStatus: 202,
        responseBodyJson: bodyJson,
        responseHeadersJson: headersJson,
        locationHeader: "/api/v2/jellyhunt/submissions/sub_123",
        resourceId: "sub_123",
        now: BASE_NOW + 100,
      }),
    ).toEqual({ status: "completed" });

    const replay = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ leaseOwner: "worker-2", originalRequestId: "req-2", now: BASE_NOW + 200 }),
    );

    expect(replay).toEqual({
      status: "replay",
      response: {
        status: 202,
        bodyJson,
        headersJson,
        locationHeader: "/api/v2/jellyhunt/submissions/sub_123",
        resourceId: "sub_123",
        originalRequestId: "req-1",
      },
    });
  });

  it("rejects stale completion and expiration after a new lease generation owns the record", async () => {
    const first = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ resourcePublicId: "sub_future" }),
    );
    const second = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ leaseOwner: "worker-2", now: BASE_NOW + 60_001 }),
    );

    const staleCompletion = await t.mutation(idempotency.completeIdempotencyRecord, {
      recordId: first.recordId,
      leaseOwner: first.leaseOwner,
      leaseGeneration: first.leaseGeneration,
      responseStatus: 202,
      responseBodyJson: "{}",
      now: BASE_NOW + 60_002,
    });
    const staleExpiration = await t.mutation(idempotency.expireIdempotencyRecord, {
      recordId: first.recordId,
      leaseOwner: first.leaseOwner,
      leaseGeneration: first.leaseGeneration,
      now: BASE_NOW + 60_003,
    });

    expect(staleCompletion).toEqual({ status: "stale_lease" });
    expect(staleExpiration).toEqual({ status: "stale_lease" });

    const stored = await loadOnlyRecord(t);
    expect(stored).toMatchObject({
      state: "processing",
      leaseOwner: second.leaseOwner,
      leaseGeneration: second.leaseGeneration,
    });
  });

  it("honors campaign end plus 90 days when it exceeds 180-day retention", async () => {
    const campaignEndsAt = BASE_NOW + 200 * DAY_MS;
    const result = await t.mutation(
      idempotency.acquireIdempotencyLease,
      leaseArgs({ campaignEndsAt }),
    );

    expect(result.expiresAt).toBe(campaignEndsAt + 90 * DAY_MS);
  });

  it("keeps an expired completed record as a non-reacquirable tombstone", async () => {
    const acquired = await t.mutation(idempotency.acquireIdempotencyLease, leaseArgs());
    await t.mutation(idempotency.completeIdempotencyRecord, {
      recordId: acquired.recordId,
      leaseOwner: acquired.leaseOwner,
      leaseGeneration: acquired.leaseGeneration,
      responseStatus: 202,
      responseBodyJson: "{}",
      now: BASE_NOW + 100,
    });

    const expiredAt = BASE_NOW + 100 + 180 * DAY_MS + 1;
    expect(
      await t.mutation(
        idempotency.acquireIdempotencyLease,
        leaseArgs({ leaseOwner: "worker-2", now: expiredAt }),
      ),
    ).toEqual({ status: "expired", originalRequestId: "req-1" });
    expect(
      await t.mutation(
        idempotency.acquireIdempotencyLease,
        leaseArgs({ leaseOwner: "worker-3", now: expiredAt + DAY_MS }),
      ),
    ).toEqual({ status: "expired", originalRequestId: "req-1" });
    expect(
      await t.mutation(
        idempotency.acquireIdempotencyLease,
        leaseArgs({ requestHash: "hash-b", leaseOwner: "worker-4", now: expiredAt + DAY_MS }),
      ),
    ).toEqual({ status: "key_reused" });
  });

  it("expires a lease only for its current owner and generation", async () => {
    const acquired = await t.mutation(idempotency.acquireIdempotencyLease, leaseArgs());

    expect(
      await t.mutation(idempotency.expireIdempotencyRecord, {
        recordId: acquired.recordId,
        leaseOwner: "wrong-worker",
        leaseGeneration: acquired.leaseGeneration,
        now: BASE_NOW + 10,
      }),
    ).toEqual({ status: "stale_lease" });
    expect(
      await t.mutation(idempotency.expireIdempotencyRecord, {
        recordId: acquired.recordId,
        leaseOwner: acquired.leaseOwner,
        leaseGeneration: acquired.leaseGeneration,
        now: BASE_NOW + 20,
      }),
    ).toEqual({ status: "expired" });
  });
});