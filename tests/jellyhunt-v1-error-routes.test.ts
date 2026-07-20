import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => {
  class JellyhuntSubmissionConflictError extends Error {
    constructor(
      public readonly code: "jelly_post_reused" | "mission_already_submitted",
    ) {
      super(
        code === "jelly_post_reused"
          ? "This Jelly post has already been used for a mission."
          : "This user has already submitted this mission.",
      );
    }
  }

  class JellyhuntDataError extends Error {
    constructor(
      public readonly code:
        | "convex_not_configured"
        | "convex_service_key_not_configured"
        | "convex_request_failed",
    ) {
      super(code);
    }
  }

  return {
    createSubmission: vi.fn(),
    getMissionResponse: vi.fn(),
    JellyhuntSubmissionConflictError,
    JellyhuntDataError,
  };
});

const domain = vi.hoisted(() => ({
  isValidServerKey: vi.fn(),
}));

vi.mock("../src/lib/jellyhunt/convex-repository", () => repository);
vi.mock("../src/lib/jellyhunt/domain", () => domain);

import { GET as getMissions } from "../app/api/v1/jellyhunt/missions/route";
import { POST as postSubmission } from "../app/api/v1/jellyhunt/submissions/route";

function expectRequestId(response: Response, body: Record<string, unknown>) {
  const header = response.headers.get("x-request-id");
  expect(header).toMatch(/^[0-9a-f-]{36}$/i);
  expect(body.requestId).toBe(header);
}

describe("JellyHunt v1 route error compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domain.isValidServerKey.mockReturnValue(true);
    repository.getMissionResponse.mockResolvedValue({
      apiVersion: "1.0",
      generatedAt: new Date(0).toISOString(),
      missions: [],
    });
    repository.createSubmission.mockResolvedValue({
      submissionId: "sub_01",
      status: "submitted",
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("disables the legacy submission write path in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await postSubmission(
      new Request("https://platepost.test/api/v1/jellyhunt/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-jellyhunt-api-key": "valid-key",
        },
        body: JSON.stringify({
          missionId: "mission_1",
          jellyUserId: "user_1",
          jellyPostId: "post_1",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error).toEqual({
      code: "legacy_write_disabled",
      message: "Legacy JellyHunt submission writes are disabled. Use the JellyHunt v2 submission API.",
    });
    expect(repository.createSubmission).not.toHaveBeenCalled();
    expectRequestId(response, body);
  });

  it("adds one request ID to unauthorized responses", async () => {
    domain.isValidServerKey.mockReturnValue(false);

    const response = await postSubmission(
      new Request("https://platepost.test/api/v1/jellyhunt/submissions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expectRequestId(response, body);
  });

  it("returns the frozen 400 shape for a schema-invalid submission", async () => {
    const response = await postSubmission(
      new Request("https://platepost.test/api/v1/jellyhunt/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missionId: "" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_submission");
    expectRequestId(response, body);
  });

  it.each([
    ["jelly_post_reused", "jelly_post_reused"],
    ["mission_already_submitted", "mission_already_submitted"],
  ] as const)("preserves the frozen 409 code %s", async (code, expected) => {
    repository.createSubmission.mockRejectedValue(
      new repository.JellyhuntSubmissionConflictError(code),
    );

    const response = await postSubmission(
      new Request("https://platepost.test/api/v1/jellyhunt/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId: "mission_1",
          jellyUserId: "user_1",
          jellyPostId: "post_1",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(expected);
    expectRequestId(response, body);
  });

  it("keeps configuration and transport failures at 503", async () => {
    repository.getMissionResponse.mockRejectedValue(
      new repository.JellyhuntDataError("convex_not_configured"),
    );

    const response = await getMissions(
      new Request("https://platepost.test/api/v1/jellyhunt/missions"),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("convex_not_configured");
    expectRequestId(response, body);
  });

  it("uses a safe 500 for an unknown submission failure", async () => {
    repository.createSubmission.mockRejectedValue(new Error("private upstream body"));

    const response = await postSubmission(
      new Request("https://platepost.test/api/v1/jellyhunt/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId: "mission_1",
          jellyUserId: "user_1",
          jellyPostId: "post_1",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "submission_failed",
      message: "The submission could not be completed.",
    });
    expect(JSON.stringify(body)).not.toContain("private upstream body");
    expectRequestId(response, body);
  });
});
