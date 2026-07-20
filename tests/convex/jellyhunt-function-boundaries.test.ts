import { describe, expect, it } from "vitest";
import * as budgets from "../../convex/jellyhunt/budgets";
import * as events from "../../convex/jellyhunt/events";
import * as idempotency from "../../convex/jellyhunt/idempotency";
import * as participations from "../../convex/jellyhunt/participations";
import * as profiles from "../../convex/jellyhunt/profiles";
import * as submissions from "../../convex/jellyhunt/submissions";
import * as verification from "../../convex/jellyhunt/verification";

function expectInternal(functions: unknown[]) {
  for (const fn of functions) {
    expect((fn as { isInternal?: boolean }).isInternal).toBe(true);
    expect((fn as { isPublic?: boolean }).isPublic).not.toBe(true);
  }
}

function expectPublic(functions: unknown[]) {
  for (const fn of functions) {
    expect((fn as { isPublic?: boolean }).isPublic).toBe(true);
    expect((fn as { isInternal?: boolean }).isInternal).not.toBe(true);
  }
}

describe("JellyHunt Convex function boundaries", () => {
  it("registers helper-only operations as internal Convex functions", () => {
    expectInternal([
      events.appendSubmissionEvent,
      idempotency.acquireIdempotencyLease,
      idempotency.completeIdempotencyRecord,
      idempotency.expireIdempotencyRecord,
      budgets.getOrCreateBudget,
      verification.recordVerificationResult,
      verification.getSubmissionForVerification,
      verification.verifySubmissionEvidence,
      profiles.upsertPublicProfile,
      profiles.getPublicProfile,
      profiles.fetchAndSyncProfile,
    ]);
  });

  it("keeps only server-gated owner operations public", () => {
    expectPublic([
      participations.startParticipation,
      participations.getParticipationByPublicId,
      participations.listUserParticipations,
      submissions.createSubmission,
      submissions.getSubmissionByPublicId,
      submissions.listUserSubmissions,
      events.listSubmissionEvents,
      events.listUserEvents,
    ]);
  });
});
