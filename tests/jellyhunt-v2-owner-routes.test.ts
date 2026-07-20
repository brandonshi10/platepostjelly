import { beforeEach, describe, expect, it, vi } from "vitest";
import meFixture from "./contracts/jellyhunt-v2/me.200.json";
import meEventsFixture from "./contracts/jellyhunt-v2/me-events.200.json";
import meMissionsFixture from "./contracts/jellyhunt-v2/me-missions.200.json";
import meSubmissionsFixture from "./contracts/jellyhunt-v2/me-submissions.200.json";
import submissionDetailFixture from "./contracts/jellyhunt-v2/submission-detail-under-review.200.json";
import submissionEventsFixture from "./contracts/jellyhunt-v2/submission-events.200.json";

const repository = vi.hoisted(() => ({
  getMe: vi.fn(),
  getParticipation: vi.fn(),
  getSubmission: vi.fn(),
  listMyEvents: vi.fn(),
  listMyMissions: vi.fn(),
  listMySubmissions: vi.fn(),
  listSubmissionEvents: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  requireJellyViewer: vi.fn(),
}));

vi.mock("../src/lib/jellyhunt/v2/repository", () => repository);
vi.mock("../src/lib/jellyhunt/v2/jelly-mission-token", () => auth);

const OWNER = "usr_jelly_canonical_001";
const OTHER = "usr_jelly_canonical_002";
const AS_OF = Date.parse("2026-08-05T19:00:00Z");

const participation = {
  id: "par_01HXPARTICIPATE01",
  status: "started",
  missionId: "mis_01HXMISSION000001",
  missionRevision: 7,
  isCurrentMissionRevision: false,
  startedAt: "2026-08-05T18:10:00Z",
  submissionDeadlineAt: "2026-08-06T18:10:00Z",
  resubmissionDeadlineAt: null,
  attemptsUsed: 1,
  maxAttempts: 3,
  latestSubmissionId: "sub_01HXSUBMISSION0001",
  terms: {
    title: "The Scarr's Cheese Pull",
    description: "Order one slice and film the cheese pull.",
    instructions: ["Visit the venue.", "Publish the requested Jelly."],
    missionWindow: {
      startsAt: "2026-08-01T16:00:00Z",
      endsAt: "2026-08-31T23:00:00Z",
    },
    reward: {
      amount: "60",
      token: "JELLY-MY-JELLY",
      displayName: "Jelly-My-Jelly",
    },
    requirements: {
      post: {
        allowedPostTypes: ["video"],
        authorshipPolicy: "canonical_owner",
        prompt: "Film the cheese pull and your first reaction.",
        minDurationSeconds: 5,
        maxDurationSeconds: 90,
        requiredVisibility: "public",
      },
      place: { attachmentRequired: true },
      location: { required: true, trustedSource: "jelly_post" },
      schedule: {
        mustBeWithinMissionWindow: true,
        mustBeDuringVenueHours: false,
      },
      resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
    },
    place: {
      id: "plc_01HXPLACE0000001",
      jellyPlaceId: "jpl_01HXJELLYPLACE001",
      name: "Scarr's Pizza",
      address: "35 Orchard St, New York, NY",
      latitude: 40.7163,
      longitude: -73.9914,
      timeZone: "America/New_York",
    },
  },
  currentControls: { acceptingSubmissions: true, reasonCode: null },
  canStart: false,
  canSubmit: false,
  canResubmit: false,
  nextAction: "wait_for_review",
  publicMessage: "Your Jelly is waiting for review.",
  updatedAt: "2026-08-05T18:42:20Z",
  _id: "convex-participation-id-must-not-leak",
  jellyUserId: OTHER,
};

function withoutLinks<T extends { links?: unknown }>(value: T): Omit<T, "links"> {
  const result = { ...value };
  delete result.links;
  return result;
}

describe("JellyHunt v2 authenticated owner-read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JELLYHUNT_CURSOR_SECRET", "owner-route-test-secret-at-least-32-bytes");
    auth.requireJellyViewer.mockResolvedValue({
      jellyUserId: OWNER,
      sessionId: "session-owner",
      tokenId: "token-owner",
      scopes: new Set(["jellyhunt:read"]),
    });
    repository.getMe.mockResolvedValue(meFixture.data);
    repository.getParticipation.mockResolvedValue(participation);
    repository.getSubmission.mockResolvedValue({
      ...submissionDetailFixture.data,
      _id: "convex-submission-id-must-not-leak",
      verifiedLatitude: 40.71631,
      verifiedLongitude: -73.99142,
      reward: {
        ...submissionDetailFixture.data.reward,
        rawError: "upstream wallet failure must not leak",
      },
    });
    repository.listSubmissionEvents.mockResolvedValue({
      events: submissionEventsFixture.data.events,
      hasMore: false,
      asOfSequence: 3,
      nextBeforeSequence: null,
    });
    repository.listMyMissions.mockResolvedValue({
      items: meMissionsFixture.data.missions.map(withoutLinks),
      hasMore: false,
      asOf: AS_OF,
      nextUpdatedAt: null,
      nextMissionPublicId: null,
    });
    repository.listMySubmissions.mockResolvedValue({
      items: meSubmissionsFixture.data.submissions.map((item) => ({
        ...withoutLinks(item),
        internalMetadataJson: "must not leak",
      })),
      hasMore: true,
      asOf: AS_OF,
      nextUpdatedAt: AS_OF,
      nextSubmissionPublicId: meSubmissionsFixture.data.submissions[0].id,
    });
    repository.listMyEvents.mockResolvedValue({
      events: meEventsFixture.data.events.map((event) => ({
        ...withoutLinks(event),
        submissionId: "sub_01HXSUBMISSION0001",
      })),
      hasMore: false,
      nextAfterSequence: 42,
    });
  });

  it("derives /me exclusively from the bearer subject and returns the frozen links privately", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/me/route");
    const response = await GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/me?campaignId=cam_01HXCAMPAIGN0000001",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.has("etag")).toBe(false);
    const body = await response.json();
    expect(body.data).toEqual(meFixture.data);
    expect(body.links).toEqual(meFixture.links);
    expect(repository.getMe).toHaveBeenCalledWith({
      jellyUserId: OWNER,
      campaignPublicId: "cam_01HXCAMPAIGN0000001",
      now: expect.any(Number),
    });
  });

  it("requires read-scope bearer authentication and applies owner privacy headers to errors", async () => {
    const { JellyhuntV2Error } = await import("../src/lib/jellyhunt/v2/errors");
    auth.requireJellyViewer.mockRejectedValueOnce(
      new JellyhuntV2Error(401, "unauthorized", "Authentication required"),
    );
    const { GET } = await import("../app/api/v2/jellyhunt/me/route");
    const response = await GET(new Request("https://platepost.io/api/v2/jellyhunt/me"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect((await response.json()).error.code).toBe("unauthorized");
    expect(repository.getMe).not.toHaveBeenCalled();
  });

  it("returns exact /me mission, submission, and polling-event envelopes with safe links", async () => {
    const missionsRoute = await import("../app/api/v2/jellyhunt/me/missions/route");
    const submissionsRoute = await import("../app/api/v2/jellyhunt/me/submissions/route");
    const eventsRoute = await import("../app/api/v2/jellyhunt/me/events/route");

    const missionsResponse = await missionsRoute.GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/me/missions?campaignId=cam_01HXCAMPAIGN0000001&limit=20",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
    );
    const submissionsResponse = await submissionsRoute.GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/me/submissions?campaignId=cam_01HXCAMPAIGN0000001&limit=20",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
    );
    const eventsResponse = await eventsRoute.GET(
      new Request("https://platepost.io/api/v2/jellyhunt/me/events?limit=50", {
        headers: { Authorization: "Bearer signed-owner-token" },
      }),
    );

    expect(missionsResponse.status).toBe(200);
    expect(submissionsResponse.status).toBe(200);
    expect(eventsResponse.status).toBe(200);
    const missionBody = await missionsResponse.json();
    const submissionBody = await submissionsResponse.json();
    const eventBody = await eventsResponse.json();
    expect(missionBody.data).toEqual(meMissionsFixture.data);
    expect(missionBody.meta.page).toEqual({ limit: 20, nextCursor: null, hasMore: false });
    expect(submissionBody.data).toEqual(meSubmissionsFixture.data);
    expect(submissionBody.meta.page).toMatchObject({
      limit: 20,
      nextCursor: expect.any(String),
      hasMore: true,
    });
    expect(eventBody.data).toEqual(meEventsFixture.data);
    expect(eventBody.meta.page).toMatchObject({
      limit: 50,
      nextCursor: expect.any(String),
      hasMore: false,
    });
    expect(JSON.stringify([missionBody, submissionBody, eventBody])).not.toMatch(
      /internalMetadata|convex-|rawError|verifiedLatitude|verifiedLongitude/,
    );
  });

  it("binds history cursors to the bearer subject, normalized query, page size, and snapshot", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/me/submissions/route");
    const first = await GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/me/submissions?campaignId=cam_01HXCAMPAIGN0000001&submissionStatus=approved&limit=20",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
    );
    const cursor = (await first.json()).meta.page.nextCursor as string;

    repository.listMySubmissions.mockResolvedValueOnce({
      items: [],
      hasMore: false,
      asOf: AS_OF,
      nextUpdatedAt: null,
      nextSubmissionPublicId: null,
    });
    const second = await GET(
      new Request(
        `https://platepost.io/api/v2/jellyhunt/me/submissions?campaignId=cam_01HXCAMPAIGN0000001&submissionStatus=approved&limit=20&cursor=${encodeURIComponent(cursor)}`,
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
    );
    expect(second.status).toBe(200);
    expect(repository.listMySubmissions).toHaveBeenLastCalledWith({
      jellyUserId: OWNER,
      campaignPublicId: "cam_01HXCAMPAIGN0000001",
      missionPublicId: undefined,
      submissionStatus: "approved",
      rewardStatus: undefined,
      updatedAfter: undefined,
      limit: 20,
      asOf: AS_OF,
      beforeUpdatedAt: AS_OF,
      beforeSubmissionPublicId: "sub_01HXSUBMISSION0001",
    });

    repository.listMySubmissions.mockClear();
    auth.requireJellyViewer.mockResolvedValue({ jellyUserId: OTHER });
    const wrongSubject = await GET(
      new Request(
        `https://platepost.io/api/v2/jellyhunt/me/submissions?campaignId=cam_01HXCAMPAIGN0000001&submissionStatus=approved&limit=20&cursor=${encodeURIComponent(cursor)}`,
        { headers: { Authorization: "Bearer other-token" } },
      ),
    );
    expect(wrongSubject.status).toBe(400);
    expect(await wrongSubject.json()).toMatchObject({
      error: { code: "invalid_cursor", restartRequired: true },
    });

    auth.requireJellyViewer.mockResolvedValue({ jellyUserId: OWNER });
    const changedQuery = await GET(
      new Request(
        `https://platepost.io/api/v2/jellyhunt/me/submissions?campaignId=cam_01HXCAMPAIGN0000001&submissionStatus=rejected&limit=20&cursor=${encodeURIComponent(cursor)}`,
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
    );
    expect(changedQuery.status).toBe(400);
    expect((await changedQuery.json()).error.code).toBe("invalid_cursor");
    expect(repository.listMySubmissions).not.toHaveBeenCalled();
  });

  it("returns the exact owner participation projection and never exposes Convex or foreign-owner fields", async () => {
    const { GET } = await import("../app/api/v2/jellyhunt/participations/[participationId]/route");
    const response = await GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/participations/par_01HXPARTICIPATE01",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
      { params: Promise.resolve({ participationId: "par_01HXPARTICIPATE01" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const safeParticipation = Object.fromEntries(
      Object.entries(participation).filter(([key]) => !["_id", "jellyUserId"].includes(key)),
    );
    expect(body.data).toEqual(safeParticipation);
    expect(body.data).not.toHaveProperty("_id");
    expect(body.data).not.toHaveProperty("jellyUserId");
    expect(body.links).toEqual({
      mission: "/api/v2/jellyhunt/missions/mis_01HXMISSION000001",
      latestSubmission: "/api/v2/jellyhunt/submissions/sub_01HXSUBMISSION0001",
    });
    expect(repository.getParticipation).toHaveBeenCalledWith(
      OWNER,
      "par_01HXPARTICIPATE01",
      expect.any(Number),
    );
  });

  it("makes missing and foreign owner resources indistinguishable", async () => {
    repository.getParticipation.mockResolvedValue(null);
    repository.getSubmission.mockResolvedValue(null);
    const participationRoute = await import(
      "../app/api/v2/jellyhunt/participations/[participationId]/route"
    );
    const submissionRoute = await import("../app/api/v2/jellyhunt/submissions/[submissionId]/route");

    const participationResponse = await participationRoute.GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/participations/par_01HXUNKNOWN000001",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
      { params: Promise.resolve({ participationId: "par_01HXUNKNOWN000001" }) },
    );
    const submissionResponse = await submissionRoute.GET(
      new Request("https://platepost.io/api/v2/jellyhunt/submissions/sub_01HXUNKNOWN000001", {
        headers: { Authorization: "Bearer signed-owner-token" },
      }),
      { params: Promise.resolve({ submissionId: "sub_01HXUNKNOWN000001" }) },
    );

    expect(participationResponse.status).toBe(404);
    expect(await participationResponse.json()).toMatchObject({
      error: {
        code: "participation_not_found",
        message: "This participation does not exist.",
      },
    });
    expect(submissionResponse.status).toBe(404);
    expect(await submissionResponse.json()).toMatchObject({
      error: { code: "submission_not_found", message: "This submission does not exist." },
    });
  });

  it("returns exact safe submission detail and descending owner-only event history", async () => {
    const detailRoute = await import("../app/api/v2/jellyhunt/submissions/[submissionId]/route");
    const eventsRoute = await import(
      "../app/api/v2/jellyhunt/submissions/[submissionId]/events/route"
    );
    const context = { params: Promise.resolve({ submissionId: "sub_01HXSUBMISSION0001" }) };
    const detail = await detailRoute.GET(
      new Request("https://platepost.io/api/v2/jellyhunt/submissions/sub_01HXSUBMISSION0001", {
        headers: { Authorization: "Bearer signed-owner-token" },
      }),
      context,
    );
    const events = await eventsRoute.GET(
      new Request(
        "https://platepost.io/api/v2/jellyhunt/submissions/sub_01HXSUBMISSION0001/events?limit=50",
        { headers: { Authorization: "Bearer signed-owner-token" } },
      ),
      context,
    );

    expect(detail.status).toBe(200);
    expect(events.status).toBe(200);
    const detailBody = await detail.json();
    const eventBody = await events.json();
    expect(detailBody.data).toEqual(submissionDetailFixture.data);
    expect(detailBody.links).toEqual(submissionDetailFixture.links);
    expect(eventBody.data).toEqual(submissionEventsFixture.data);
    expect(eventBody.meta.page).toEqual({ limit: 50, nextCursor: null, hasMore: false });
    expect(JSON.stringify(detailBody)).not.toMatch(
      /rawError|wallet|verifiedLatitude|verifiedLongitude|convex-/,
    );
  });

  it("strictly rejects unknown, repeated, invalid identity, path, filter, and pagination inputs", async () => {
    const meRoute = await import("../app/api/v2/jellyhunt/me/route");
    const missionsRoute = await import("../app/api/v2/jellyhunt/me/missions/route");
    const submissionsRoute = await import("../app/api/v2/jellyhunt/me/submissions/route");
    const eventsRoute = await import("../app/api/v2/jellyhunt/me/events/route");
    const participationRoute = await import(
      "../app/api/v2/jellyhunt/participations/[participationId]/route"
    );

    const requests = [
      meRoute.GET(
        new Request("https://platepost.io/api/v2/jellyhunt/me?jellyUserId=spoofed", {
          headers: { Authorization: "Bearer signed-owner-token" },
        }),
      ),
      missionsRoute.GET(
        new Request(
          "https://platepost.io/api/v2/jellyhunt/me/missions?participationStatus=unknown",
          { headers: { Authorization: "Bearer signed-owner-token" } },
        ),
      ),
      missionsRoute.GET(
        new Request("https://platepost.io/api/v2/jellyhunt/me/missions?limit=1&limit=2", {
          headers: { Authorization: "Bearer signed-owner-token" },
        }),
      ),
      submissionsRoute.GET(
        new Request(
          "https://platepost.io/api/v2/jellyhunt/me/submissions?submissionStatus=paid",
          { headers: { Authorization: "Bearer signed-owner-token" } },
        ),
      ),
      submissionsRoute.GET(
        new Request(
          "https://platepost.io/api/v2/jellyhunt/me/submissions?updatedAfter=not-a-date",
          { headers: { Authorization: "Bearer signed-owner-token" } },
        ),
      ),
      eventsRoute.GET(
        new Request("https://platepost.io/api/v2/jellyhunt/me/events?limit=101", {
          headers: { Authorization: "Bearer signed-owner-token" },
        }),
      ),
      participationRoute.GET(
        new Request("https://platepost.io/api/v2/jellyhunt/participations/not-public", {
          headers: { Authorization: "Bearer signed-owner-token" },
        }),
        { params: Promise.resolve({ participationId: "not-public" }) },
      ),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
  });
});
