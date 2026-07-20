import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JellyhuntV2Error } from "../src/lib/jellyhunt/v2/errors";
import acceptedFixture from "./contracts/jellyhunt-v2/submission-accepted.202.json";

const repository = vi.hoisted(() => ({
  prepareSubmissionIntake: vi.fn(),
  getSubmissionIntakeContext: vi.fn(),
  commitSubmissionIntake: vi.fn(),
  finalizeSubmissionIntakeError: vi.fn(),
  abandonSubmissionIntake: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  requireJellyViewer: vi.fn(),
}));

const preflight = vi.hoisted(() => ({
  preflightJellyPost: vi.fn(),
}));

vi.mock("../src/lib/jellyhunt/v2/write-repository", () => repository);
vi.mock("../src/lib/jellyhunt/v2/jelly-mission-token", () => auth);
vi.mock("../src/lib/jellyhunt/v2/jelly-post-preflight", () => preflight);

const NOW = Date.parse("2026-08-05T18:42:11Z");
const missionId = "mis_01HXMISSION000001";
const participationId = "par_01HXPARTICIPATE01";
const submissionId = "sub_01HXSUBMISSION0001";
const jellyPostId = "01HXJELLYPOST000002";
const idempotencyKey = "018f3f96-92db-7d3d-8c21-fd656cb50aaa";
const normalizedPath = `/api/v2/jellyhunt/missions/${missionId}/submissions`;
const context = { params: Promise.resolve({ missionId }) };

const acquired = {
  status: "acquired" as const,
  recordId: "idem-record-1",
  leaseOwner: "route-worker-1",
  leaseGeneration: 1,
  processingExpiresAt: NOW + 60_000,
  expiresAt: NOW + 180 * 86_400_000,
  submissionPublicId: submissionId,
};

const intakeContext = {
  participationPublicId: participationId,
  missionPublicId: missionId,
  missionRevision: 7,
  attempt: 1,
  reward: { amount: "60", token: "JELLY-MY-JELLY" },
};

const matchedPreflight = {
  jellyPostId,
  canonicalOwnerUserId: "usr_jelly_canonical_001",
  ownershipStatus: "matched" as const,
  checkedAt: NOW - 1_000,
};

function request(
  body: unknown = {
    participationId,
    missionRevision: 7,
    jellyPostId,
    clientLocation: {
      latitude: 40.7164,
      longitude: -73.9915,
      accuracyMeters: 12,
      capturedAt: "2026-08-05T18:42:10Z",
    },
  },
  key: string | null = idempotencyKey,
) {
  const headers: Record<string, string> = {
    Authorization: "Bearer signed-mission-token",
    "Content-Type": "application/json",
  };
  if (key !== null) headers["Idempotency-Key"] = key;
  return new Request(`https://platepost.io${normalizedPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("JellyHunt v2 submission write route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    auth.requireJellyViewer.mockResolvedValue({
      jellyUserId: "usr_jelly_canonical_001",
      sessionId: "session-1",
      tokenId: "token-1",
      scopes: new Set(["jellyhunt:submit"]),
    });
    repository.prepareSubmissionIntake.mockResolvedValue(acquired);
    repository.getSubmissionIntakeContext.mockResolvedValue(intakeContext);
    preflight.preflightJellyPost.mockResolvedValue(matchedPreflight);
    repository.commitSubmissionIntake.mockResolvedValue({
      status: "completed",
      submissionPublicId: submissionId,
      attempt: 1,
    });
    repository.finalizeSubmissionIntakeError.mockResolvedValue({ status: "completed" });
    repository.abandonSubmissionIntake.mockResolvedValue({ status: "abandoned" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("prepares before exact ownership preflight and atomically commits the frozen 202 envelope", async () => {
    const { POST } = await import("../app/api/v2/jellyhunt/missions/[missionId]/submissions/route");

    const response = await POST(request(), context);
    const responseText = await response.text();
    const body = JSON.parse(responseText);

    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/api/v2/jellyhunt/submissions/${submissionId}`);
    expect(response.headers.get("idempotent-replayed")).toBe("false");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual(acceptedFixture.data);
    expect(body.links).toEqual(acceptedFixture.links);
    expect(auth.requireJellyViewer).toHaveBeenCalledWith(expect.any(Request), "jellyhunt:submit");
    expect(repository.prepareSubmissionIntake).toHaveBeenCalledWith({
      jellySubjectId: "usr_jelly_canonical_001",
      httpMethod: "POST",
      normalizedPath,
      idempotencyKey,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      originalRequestId: expect.any(String),
      leaseOwner: expect.any(String),
      now: NOW,
    });
    expect(repository.prepareSubmissionIntake.mock.invocationCallOrder[0]).toBeLessThan(
      preflight.preflightJellyPost.mock.invocationCallOrder[0]!,
    );
    expect(preflight.preflightJellyPost).toHaveBeenCalledWith({
      jellyPostId,
      submissionPublicId: submissionId,
      jellyUserId: "usr_jelly_canonical_001",
      requestId: expect.any(String),
    });

    const commit = repository.commitSubmissionIntake.mock.calls[0]![0];
    expect(commit).toMatchObject({
      recordId: acquired.recordId,
      jellySubjectId: "usr_jelly_canonical_001",
      httpMethod: "POST",
      normalizedPath,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      leaseOwner: acquired.leaseOwner,
      leaseGeneration: acquired.leaseGeneration,
      submissionPublicId: submissionId,
      missionPublicId: missionId,
      participationPublicId: participationId,
      missionRevision: 7,
      expectedAttempt: 1,
      jellyPostId,
      preflight: matchedPreflight,
      clientLocation: {
        latitude: 40.7164,
        longitude: -73.9915,
        accuracyMeters: 12,
        capturedAt: Date.parse("2026-08-05T18:42:10Z"),
      },
      responseStatus: 202,
      locationHeader: `/api/v2/jellyhunt/submissions/${submissionId}`,
      now: NOW,
    });
    expect(commit.responseBodyJson).toBe(responseText);
    expect(JSON.parse(commit.responseHeadersJson)).toEqual({
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      Location: `/api/v2/jellyhunt/submissions/${submissionId}`,
      Vary: "Authorization",
    });
  });

  it("replays the exact stored body, status, and Location with fresh replay transport headers", async () => {
    const storedBody = JSON.stringify(acceptedFixture);
    repository.prepareSubmissionIntake.mockResolvedValueOnce({
      status: "replay",
      response: {
        status: 202,
        bodyJson: storedBody,
        headersJson: JSON.stringify({
          "Cache-Control": "private, no-store",
          "Content-Type": "application/json",
          Location: `/api/v2/jellyhunt/submissions/${submissionId}`,
          Vary: "Authorization",
        }),
        locationHeader: `/api/v2/jellyhunt/submissions/${submissionId}`,
        resourceId: submissionId,
        originalRequestId: "req_01HXREQUEST000010",
      },
    });
    const { POST } = await import("../app/api/v2/jellyhunt/missions/[missionId]/submissions/route");

    const response = await POST(request(), context);

    expect(response.status).toBe(202);
    expect(await response.text()).toBe(storedBody);
    expect(response.headers.get("location")).toBe(`/api/v2/jellyhunt/submissions/${submissionId}`);
    expect(response.headers.get("idempotent-replayed")).toBe("true");
    expect(response.headers.get("idempotency-original-request-id")).toBe("req_01HXREQUEST000010");
    expect(response.headers.get("x-request-id")).not.toBe("req_01HXREQUEST000010");
    expect(repository.getSubmissionIntakeContext).not.toHaveBeenCalled();
    expect(preflight.preflightJellyPost).not.toHaveBeenCalled();
    expect(repository.commitSubmissionIntake).not.toHaveBeenCalled();
  });

  it.each([
    ["key_reused", "idempotency_key_reused", undefined],
    ["expired", "idempotency_record_expired", undefined],
    ["in_progress", "idempotency_in_progress", 1_500],
  ])("maps prepare status %s without running preflight", async (status, errorCode, retryAfter) => {
    repository.prepareSubmissionIntake.mockResolvedValueOnce({
      status,
      ...(retryAfter === undefined ? {} : { retryAfter }),
    });
    const { POST } = await import("../app/api/v2/jellyhunt/missions/[missionId]/submissions/route");

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(errorCode);
    expect(response.headers.get("retry-after")).toBe(retryAfter === undefined ? null : "2");
    expect(preflight.preflightJellyPost).not.toHaveBeenCalled();
  });

  it("finalizes privacy-safe uniqueness conflicts with the exact deterministic 409 body", async () => {
    repository.commitSubmissionIntake.mockRejectedValueOnce(new Error("jelly_post_reused"));
    const { POST } = await import("../app/api/v2/jellyhunt/missions/[missionId]/submissions/route");

    const response = await POST(request(), context);
    const responseText = await response.text();

    expect(response.status).toBe(409);
    expect(JSON.parse(responseText).error).toMatchObject({
      code: "submission_conflict",
      retryable: false,
    });
    expect(repository.finalizeSubmissionIntakeError).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: acquired.recordId,
        responseStatus: 409,
        responseBodyJson: responseText,
        responseHeadersJson: JSON.stringify({
          "Cache-Control": "private, no-store",
          "Content-Type": "application/json",
          Vary: "Authorization",
        }),
      }),
    );
    expect(repository.abandonSubmissionIntake).not.toHaveBeenCalled();
  });

  it.each([
    [429, "rate_limited"],
    [503, "dependency_unavailable"],
  ])("abandons a transient %s lease so the same key can be reclaimed", async (status, code) => {
    preflight.preflightJellyPost.mockRejectedValueOnce(
      new JellyhuntV2Error(status, code, "Temporary dependency failure"),
    );
    const { POST } = await import("../app/api/v2/jellyhunt/missions/[missionId]/submissions/route");

    const response = await POST(request(), context);

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(repository.abandonSubmissionIntake).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: acquired.recordId,
        submissionPublicId: submissionId,
        now: NOW,
      }),
    );
    expect(repository.finalizeSubmissionIntakeError).not.toHaveBeenCalled();
    expect(repository.commitSubmissionIntake).not.toHaveBeenCalled();
  });

  it("rejects malformed or privileged body fields and requires a UUID/ULID key before intake", async () => {
    const { POST } = await import("../app/api/v2/jellyhunt/missions/[missionId]/submissions/route");
    const invalidRequests = [
      request({ participationId, missionRevision: 7, jellyPostId, rewardAmount: "6000" }),
      request(undefined, null),
      request(undefined, "not-a-uuid-or-ulid"),
      new Request(`https://platepost.io${normalizedPath}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer signed-mission-token",
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: "{",
      }),
    ];

    for (const candidate of invalidRequests) {
      const response = await POST(candidate, context);
      expect(response.status).toBe(400);
      expect(["invalid_request", "invalid_idempotency_key"]).toContain(
        (await response.json()).error.code,
      );
    }
    expect(repository.prepareSubmissionIntake).not.toHaveBeenCalled();
    expect(preflight.preflightJellyPost).not.toHaveBeenCalled();
  });
});
