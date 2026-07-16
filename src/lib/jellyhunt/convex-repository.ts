import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
  mapConvexMission,
  isMissionVisible,
  submissionConflictCode,
} from "./domain";
import {
  missionsResponseSchema,
  type MissionsResponse,
  type SubmissionRequest,
  type UserMissionStatus,
} from "./contracts";
import { sampleMissionsResponse } from "./sample-data";


export class JellyhuntSubmissionConflictError extends Error {
  constructor(
    public readonly code: "jelly_post_reused" | "mission_already_submitted",
  ) {
    super(code === "jelly_post_reused" ? "This Jelly post has already been used for a mission." : "This user has already submitted this mission.");
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
  return process.env.NODE_ENV !== "production" && process.env.JELLYHUNT_DATA_SOURCE === "fixture";
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
    const rawMissions = (await client.query(anyApi.missions.listPublicMissions, {
      now: queryNow,
    })) as Record<string, unknown>[];
    const missions = rawMissions
      .map(mapConvexMission)
      .filter((mission) => isMissionVisible(mission, now))
      .sort((left, right) => left.sortOrder - right.sortOrder);

    let userStatus: UserMissionStatus[] | undefined;
    if (userId) {
      const visibleMissionIds = new Set(missions.map((mission) => mission.id));
      const statuses = (await client.query(anyApi.submissions.listUserStatuses, {
        ...serviceArgs(),
        jellyUserId: userId,
      })) as UserMissionStatus[];
      userStatus = statuses.filter((item) => visibleMissionIds.has(item.missionId));
    }

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

export async function createSubmission(payload: SubmissionRequest) {
  if (fixtureAllowed()) {
    return {
      submissionId: `fixture_${payload.missionId}_${payload.jellyPostId}`,
      status: "submitted",
      fixture: true,
    };
  }

  try {
    const client = createClient();
    return await client.mutation(anyApi.submissions.submitMission, {
      ...serviceArgs(),
      ...payload,
    });
  } catch (error) {
    if (error instanceof JellyhuntDataError) throw error;
    const message = error instanceof Error ? error.message : "Convex request failed.";
    const conflictCode = submissionConflictCode(message);
    if (conflictCode) throw new JellyhuntSubmissionConflictError(conflictCode);
    throw new JellyhuntDataError("convex_request_failed", message);
  }
}

export async function callAdminQuery(
  functionName: "listAdminMissions" | "listAdminSubmissions" | "listAuditEvents",
  args: Record<string, unknown> = {},
) {
  const client = createClient();
  const reference =
    functionName === "listAdminMissions"
      ? anyApi.missions.listAdminMissions
      : functionName === "listAdminSubmissions"
        ? anyApi.submissions.listAdminSubmissions
        : anyApi.audit.listAuditEvents;

  return client.query(reference, { ...serviceArgs(), ...args });
}

export async function callAdminMutation(
  module: "missions" | "submissions",
  functionName: string,
  args: Record<string, unknown>,
) {
  const client = createClient();
  const reference =
    module === "missions"
      ? anyApi.missions[functionName]
      : anyApi.submissions[functionName];
  return client.mutation(reference, { ...serviceArgs(), ...args });
}
