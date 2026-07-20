import "server-only";

import { createHash, randomUUID } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  isMissionVisible,
  mapConvexMission,
  submissionConflictCode,
} from "./domain";
import {
  missionsResponseSchema,
  type MissionsResponse,
  type SubmissionRequest,
  type UserMissionStatus,
} from "./contracts";
import { sampleMissionsResponse } from "./sample-data";
import { getMission } from "./v2/repository";
import {
  abandonSubmissionIntake,
  commitSubmissionIntake,
  getSubmissionIntakeContext,
  prepareSubmissionIntake,
  startParticipation,
  type SubmissionIntakeLease,
} from "./v2/write-repository";
import { preflightJellyPost } from "./v2/jelly-post-preflight";

const admin = anyApi.jellyhunt.admin;
const approvals = anyApi.jellyhunt.approvals;
const audit = anyApi.jellyhunt.audit;

export class JellyhuntSubmissionConflictError extends Error {
  constructor(
    public readonly code: "jelly_post_reused" | "mission_already_submitted",
  ) {
    super(
      code === "jelly_post_reused"
        ? "This Jelly post has already been used for a mission."
        : "This user has already submitted this mission.",
    );
    this.name = "JellyhuntSubmissionConflictError";
  }
}

export class JellyhuntDataError extends Error {
  constructor(
    public readonly code:
      | "convex_not_configured"
      | "convex_service_key_not_configured"
      | "convex_request_failed",
    message: string,
  ) {
    super(message);
    this.name = "JellyhuntDataError";
  }
}

function getConvexUrl() {
  return process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
}

function createClient() {
  const url = getConvexUrl();
  if (!url) {
    throw new JellyhuntDataError(
      "convex_not_configured",
      "Set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL.",
    );
  }
  return new ConvexHttpClient(url);
}

function serviceArgs() {
  const serviceKey = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
  if (!serviceKey) {
    throw new JellyhuntDataError(
      "convex_service_key_not_configured",
      "Set PLATEPOST_CONVEX_SERVICE_KEY in Vercel and Convex.",
    );
  }
  return { serviceKey };
}

function fixtureAllowed() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.JELLYHUNT_DATA_SOURCE === "fixture"
  );
}

export async function getMissionResponse(userId?: string): Promise<MissionsResponse> {
  if (fixtureAllowed()) {
    return missionsResponseSchema.parse({
      ...sampleMissionsResponse,
      generatedAt: new Date().toISOString(),
      userStatus: userId
        ? sampleMissionsResponse.missions.map((mission) => ({
            missionId: mission.id,
            status: "not_started" as const,
          }))
        : undefined,
    });
  }

  try {
    const client = createClient();
    const now = new Date();
    const queryNow = Math.floor(now.getTime() / 60_000) * 60_000;
    const result = (await client.query(admin.listV1Missions, {
      now: queryNow,
      ...(userId ? { ...serviceArgs(), jellyUserId: userId } : {}),
    })) as {
      missions: Record<string, unknown>[];
      userStatus?: UserMissionStatus[];
    };
    const missions = result.missions
      .map(mapConvexMission)
      .filter((mission) => isMissionVisible(mission, now))
      .sort((left, right) => left.sortOrder - right.sortOrder);

    const visibleMissionIds = new Set(missions.map((mission) => mission.id));
    const userStatus = result.userStatus?.filter((item) =>
      visibleMissionIds.has(item.missionId),
    );

    return missionsResponseSchema.parse({
      apiVersion: "1.0",
      generatedAt: now.toISOString(),
      missions,
      userStatus,
    });
  } catch (error) {
    if (error instanceof JellyhuntDataError) throw error;
    throw new JellyhuntDataError(
      "convex_request_failed",
      error instanceof Error ? error.message : "Convex request failed.",
    );
  }
}

function submissionIdentity(payload: SubmissionRequest): string {
  return [payload.missionId, payload.jellyUserId, payload.jellyPostId]
    .map((part) => part.trim())
    .join("\u0000");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function conflictFrom(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    submissionConflictCode(message) ??
    (/jelly_post_reused/i.test(message)
      ? "jelly_post_reused"
      : /mission_already_submitted/i.test(message)
        ? "mission_already_submitted"
        : null);
  return code ? new JellyhuntSubmissionConflictError(code) : null;
}

function replaySubmission(responseBodyJson: string) {
  try {
    const body = JSON.parse(responseBodyJson);
    const submissionId = body?.data?.id;
    if (typeof submissionId !== "string" || !submissionId) {
      throw new Error("invalid_replay");
    }
    return { submissionId, status: "submitted", replay: true };
  } catch {
    throw new JellyhuntDataError(
      "convex_request_failed",
      "Stored submission replay was invalid.",
    );
  }
}

async function abandonLease(
  lease: SubmissionIntakeLease,
  payload: SubmissionRequest,
  requestHash: string,
  now: number,
) {
  await abandonSubmissionIntake({
    recordId: lease.recordId,
    jellySubjectId: payload.jellyUserId,
    httpMethod: "POST",
    normalizedPath: "/api/v1/jellyhunt/submissions",
    requestHash,
    leaseOwner: lease.leaseOwner,
    leaseGeneration: lease.leaseGeneration,
    submissionPublicId: lease.submissionPublicId,
    now,
  }).catch(() => undefined);
}

export async function createSubmission(payload: SubmissionRequest) {
  if (fixtureAllowed()) {
    return {
      submissionId: `fixture_${payload.missionId}_${payload.jellyPostId}`,
      status: "submitted",
      fixture: true,
    };
  }

  let lease: SubmissionIntakeLease | undefined;
  const requestId = randomUUID();
  const now = Date.now();
  const identity = submissionIdentity(payload);
  const requestHash = digest(identity);
  try {
    const mission = await getMission(payload.missionId, {
      jellyUserId: payload.jellyUserId,
      now,
    });
    if (!mission) throw new Error("mission_not_found");

    let participationPublicId = mission.viewer?.participationId ?? undefined;
    let missionRevision = mission.viewer?.missionRevision ?? undefined;
    if (!participationPublicId || !missionRevision) {
      const started = await startParticipation({
        jellyUserId: payload.jellyUserId,
        missionPublicId: payload.missionId,
        expectedMissionRevision: mission.revision,
        requestId,
      });
      participationPublicId = started.participationPublicId;
      missionRevision = started.missionRevision;
    }

    const context = await getSubmissionIntakeContext({
      jellyUserId: payload.jellyUserId,
      participationPublicId,
      missionPublicId: payload.missionId,
      missionRevision,
      now,
    });
    const prepared = await prepareSubmissionIntake({
      jellySubjectId: payload.jellyUserId,
      httpMethod: "POST",
      normalizedPath: "/api/v1/jellyhunt/submissions",
      idempotencyKey: `v1-${digest(identity)}`,
      requestHash,
      originalRequestId: requestId,
      leaseOwner: requestId,

      now,
    });
    if (prepared.status === "replay") {
      return replaySubmission(prepared.response.bodyJson);
    }
    if (prepared.status !== "acquired") {
      if (prepared.status === "key_reused") {
        throw new JellyhuntSubmissionConflictError("mission_already_submitted");
      }
      throw new Error(`submission_intake_${prepared.status}`);
    }
    lease = prepared;

    const preflight = await preflightJellyPost({
      jellyPostId: payload.jellyPostId,
      submissionPublicId: lease.submissionPublicId,
      jellyUserId: payload.jellyUserId,
      requestId,
    });
    const responseBodyJson = JSON.stringify({
      data: {
        id: lease.submissionPublicId,
        missionId: payload.missionId,
        participationId: participationPublicId,
        jellyPostId: payload.jellyPostId,
        attempt: context.attempt,
      },
    });
    await commitSubmissionIntake({
      recordId: lease.recordId,
      jellySubjectId: payload.jellyUserId,
      httpMethod: "POST",
      normalizedPath: "/api/v1/jellyhunt/submissions",
      requestHash,
      leaseOwner: lease.leaseOwner,
      leaseGeneration: lease.leaseGeneration,
      submissionPublicId: lease.submissionPublicId,
      now,
      missionPublicId: payload.missionId,
      participationPublicId,
      missionRevision,
      expectedAttempt: context.attempt,
      jellyPostId: payload.jellyPostId,
      preflight,
      responseStatus: 202,
      responseBodyJson,
      responseHeadersJson: JSON.stringify({ "content-type": "application/json" }),
      locationHeader: `/api/v2/jellyhunt/submissions/${lease.submissionPublicId}`,
    });
    return {
      submissionId: lease.submissionPublicId,
      status: "submitted",
      replay: false,
    };
  } catch (error) {
    if (lease) await abandonLease(lease, payload, requestHash, Date.now());
    if (
      error instanceof JellyhuntDataError ||
      error instanceof JellyhuntSubmissionConflictError
    ) {
      throw error;
    }
    const conflict = conflictFrom(error);
    if (conflict) throw conflict;
    throw new JellyhuntDataError(
      "convex_request_failed",
      error instanceof Error ? error.message : "Convex request failed.",
    );
  }
}

function parseNextState(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
    return (
      parsed?.status ??
      parsed?.submissionStatus ??
      parsed?.rewardStatus ??
      parsed?.reviewStatus
    );
  } catch {
    return undefined;
  }
}

export async function callAdminQuery(
  functionName:
    | "listAdminMissions"
    | "getAdminBudgetContext"
    | "listAdminSubmissions"
    | "listAuditEvents",
  args: Record<string, unknown> = {},
) {
  const client = createClient();
  if (functionName === "listAdminMissions") {
    return client.query(admin.listAdminMissions, { ...serviceArgs(), ...args });
  }
  if (functionName === "getAdminBudgetContext") {
    return client.query(admin.getAdminBudgetContext, { ...serviceArgs(), ...args });
  }
  if (functionName === "listAdminSubmissions") {
    return client.query(admin.listAdminSubmissions, { ...serviceArgs(), ...args });
  }
  const rows = (await client.query(audit.listAuditEvents, {
    ...serviceArgs(),
    ...args,
  })) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    _id: String(row._id ?? ""),
    nextState: parseNextState(row.nextStateJson),
  }));
}

export async function callAdminMutation(
  module: "missions" | "submissions" | "approvals",
  functionName: string,
  args: Record<string, unknown>,
) {
  const client = createClient();
  const reference =
    module === "approvals"
      ? approvals[functionName]
      : admin[functionName];
  return client.mutation(reference, { ...serviceArgs(), ...args });
}
