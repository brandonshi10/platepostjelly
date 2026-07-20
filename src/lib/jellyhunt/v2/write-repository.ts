import "server-only";

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

function getConvexUrl(): string {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("convex_not_configured");
  return url;
}

function getServiceKey(): string {
  const serviceKey = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
  if (!serviceKey) throw new Error("convex_service_key_not_configured");
  return serviceKey;
}

function createClient(): ConvexHttpClient {
  return new ConvexHttpClient(getConvexUrl());
}

const participations = anyApi.jellyhunt.participations;
const submissions = anyApi.jellyhunt.submissions;
const ownerReads = anyApi.jellyhunt.ownerReads;

export type StartParticipationResult = {
  created: boolean;
  participationPublicId: string;
  missionPublicId: string;
  missionRevision: number;
  jellyPlaceId: string;
  startedAt: number;
  submissionDeadlineAt: number;
};

export async function startParticipation(args: {
  jellyUserId: string;
  missionPublicId: string;
  expectedMissionRevision: number;
  requestId: string;
}): Promise<StartParticipationResult> {
  return await createClient().mutation(participations.startParticipation, {
    serviceKey: getServiceKey(),
    ...args,
  });
}

export type SubmissionIntakeLease = {
  status: "acquired";
  recordId: unknown;
  leaseOwner: string;
  leaseGeneration: number;
  processingExpiresAt: number;
  expiresAt: number;
  submissionPublicId: string;
};

export type StoredSubmissionIntakeResponse = {
  status: number;
  bodyJson: string;
  headersJson?: string;
  locationHeader?: string;
  resourceId?: string;
  originalRequestId: string;
};

export type PrepareSubmissionIntakeResult =
  | SubmissionIntakeLease
  | { status: "replay"; response: StoredSubmissionIntakeResponse }
  | { status: "key_reused" }
  | { status: "expired"; originalRequestId?: string }
  | { status: "in_progress"; retryAfter: number }
  | { status: "recovery_required" };

export async function prepareSubmissionIntake(args: {
  jellySubjectId: string;
  httpMethod: string;
  normalizedPath: string;
  idempotencyKey: string;
  requestHash: string;
  originalRequestId: string;
  leaseOwner: string;
  now: number;
}): Promise<PrepareSubmissionIntakeResult> {
  return await createClient().mutation(submissions.prepareSubmissionIntake, {
    serviceKey: getServiceKey(),
    ...args,
  });
}

export type SubmissionIntakeContext = {
  participationPublicId: string;
  missionPublicId: string;
  missionRevision: number;
  attempt: number;
  reward: {
    amount: string;
    token: "JELLY-MY-JELLY";
  };
};

export async function getSubmissionIntakeContext(args: {
  jellyUserId: string;
  participationPublicId: string;
  missionPublicId: string;
  missionRevision: number;
  now: number;
}): Promise<SubmissionIntakeContext> {
  const client = createClient();
  const serviceKey = getServiceKey();
  const [participation, snapshot] = await Promise.all([
    client.query(participations.getParticipationByPublicId, {
      serviceKey,
      jellyUserId: args.jellyUserId,
      participationPublicId: args.participationPublicId,
    }),
    client.query(ownerReads.getOwnerParticipation, {
      serviceKey,
      jellyUserId: args.jellyUserId,
      participationPublicId: args.participationPublicId,
      now: args.now,
    }),
  ]);

  if (!participation || !snapshot) throw new Error("participation_not_found");
  if (participation.missionId !== args.missionPublicId) {
    throw new Error("participation_mission_mismatch");
  }
  if (
    participation.missionRevision !== args.missionRevision ||
    snapshot.missionRevision !== args.missionRevision
  ) {
    throw new Error("mission_revision_mismatch");
  }
  const attemptsUsed = participation.attemptsUsed;
  const rewardAmount = snapshot.terms?.reward?.amount;
  if (!Number.isInteger(attemptsUsed) || attemptsUsed < 0 || typeof rewardAmount !== "string") {
    throw new Error("submission_intake_context_invalid");
  }
  return {
    participationPublicId: participation.id,
    missionPublicId: participation.missionId,
    missionRevision: participation.missionRevision,
    attempt: attemptsUsed + 1,
    reward: { amount: rewardAmount, token: "JELLY-MY-JELLY" },
  };
}

export type SubmissionIntakeLeaseIdentity = {
  recordId: unknown;
  jellySubjectId: string;
  httpMethod: string;
  normalizedPath: string;
  requestHash: string;
  leaseOwner: string;
  leaseGeneration: number;
  submissionPublicId: string;
  now: number;
};

export async function commitSubmissionIntake(
  args: SubmissionIntakeLeaseIdentity & {
    missionPublicId: string;
    participationPublicId: string;
    missionRevision: number;
    expectedAttempt: number;
    jellyPostId: string;
    preflight: {
      jellyPostId: string;
      canonicalOwnerUserId: string;
      ownershipStatus: "matched";
      checkedAt: number;
    };
    clientLocation?: {
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: number;
    };
    responseStatus: number;
    responseBodyJson: string;
    responseHeadersJson: string;
    locationHeader: string;
  },
): Promise<{ status: "completed"; submissionPublicId: string; attempt: number }> {
  return await createClient().mutation(submissions.commitSubmissionIntake, {
    serviceKey: getServiceKey(),
    ...args,
  });
}

export async function finalizeSubmissionIntakeError(
  args: SubmissionIntakeLeaseIdentity & {
    responseStatus: number;
    responseBodyJson: string;
    responseHeadersJson?: string;
    locationHeader?: string;
  },
): Promise<{ status: "completed" }> {
  return await createClient().mutation(submissions.finalizeSubmissionIntakeError, {
    serviceKey: getServiceKey(),
    ...args,
  });
}

export async function abandonSubmissionIntake(
  args: SubmissionIntakeLeaseIdentity,
): Promise<{ status: "abandoned" }> {
  return await createClient().mutation(submissions.abandonSubmissionIntake, {
    serviceKey: getServiceKey(),
    ...args,
  });
}
