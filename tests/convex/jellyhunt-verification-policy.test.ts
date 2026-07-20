import { describe, expect, it } from "vitest";
import fixture from "../contracts/jelly-partner-v1/submission-verify-complete.200.json";
import {
  buildPartnerVerificationIdempotencyKey,
  evaluatePartnerEvidence,
  parsePartnerEvidence,
  type VerificationContext,
} from "../../convex/jellyhunt/verificationPolicy";

const context: VerificationContext = {
  submissionPublicId: "sub_01HXSUBMISSION0001",
  missionPublicId: "mis_01HXMISSION000001",
  missionRevision: 7,
  jellyUserId: "usr_jelly_canonical_001",
  jellyPostId: "01HXJELLYPOST000002",
  approvalMode: "automatic",
  place: {
    jellyPlaceId: "jpl_01HXJELLYPLACE001",
    latitude: 40.7163,
    longitude: -73.9914,
    geofenceRadiusMeters: 75,
  },
  requirements: fixture.request.postRequirements && {
    post: {
      allowedPostTypes: fixture.request.postRequirements.allowedPostTypes,
      authorshipPolicy: fixture.request.postRequirements.authorshipPolicy,
      minDurationSeconds: fixture.request.postRequirements.minDurationSeconds,
      maxDurationSeconds: fixture.request.postRequirements.maxDurationSeconds,
      requiredVisibility: fixture.request.postRequirements.requiredVisibility,
    },
    place: { attachmentRequired: true },
    location: { required: true, trustedSource: "trusted_post_gps" },
    schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
  },
  missionWindow: {
    startsAt: Date.parse(fixture.request.missionWindow.startsAt),
    endsAt: Date.parse(fixture.request.missionWindow.endsAt),
  },
};

const EVALUATED_AT = Date.parse(fixture.body.checkedAt) + 1_000;

function evidence(overrides: Record<string, unknown> = {}) {
  return parsePartnerEvidence({ ...fixture.body, ...overrides });
}

function evaluate(currentContext: VerificationContext, currentEvidence: ReturnType<typeof evidence>) {
  return evaluatePartnerEvidence(currentContext, currentEvidence, EVALUATED_AT);
}

describe("partner mission evidence policy", () => {
  it("approves automatic missions only when every authoritative component matches", () => {
    expect(evaluate(context, evidence())).toMatchObject({
      outcome: "approve",
      reasonCode: "verified",
    });
  });

  it("sends complete evidence to review for manual missions", () => {
    expect(evaluate({ ...context, approvalMode: "manual" }, evidence())).toMatchObject({
      outcome: "needs_review",
      reasonCode: "manual_review_required",
    });
  });

  it.each([
    ["owner_mismatch", { post: { ...fixture.body.post, canonicalOwnerUserId: "usr_other" } }],
    ["post_deleted", { post: { ...fixture.body.post, deletedAt: "2026-08-05T19:00:00Z" } }],
    ["post_not_ready", { post: { ...fixture.body.post, state: "processing" } }],
    ["post_not_public", { post: { ...fixture.body.post, visibility: "private" } }],
    ["post_moderated", { post: { ...fixture.body.post, moderationStatus: "blocked" } }],
    ["wrong_post_type", { post: { ...fixture.body.post, postType: "photo" } }],
    ["wrong_place", { proof: { ...fixture.body.proof, place: { ...fixture.body.proof.place, matched: false } } }],
  ])("rejects authoritative negative evidence: %s", (reasonCode, overrides) => {
    expect(evaluate(context, evidence(overrides))).toMatchObject({
      outcome: "reject",
      reasonCode,
    });
  });

  it("accepts a geofence-border result within the trusted accuracy tolerance", () => {
    const body = evidence({
      proof: {
        ...fixture.body.proof,
        location: {
          ...fixture.body.proof.location,
          latitude: 40.7163,
          longitude: -73.9904,
          distanceMeters: 84,
          accuracyMeters: 12,
        },
      },
    });
    expect(evaluate(context, body).outcome).toBe("approve");
  });

  it("requires review when Jelly's supplied distance disagrees with coordinates", () => {
    const body = evidence({
      proof: {
        ...fixture.body.proof,
        location: { ...fixture.body.proof.location, distanceMeters: 900 },
      },
    });
    expect(evaluate(context, body)).toMatchObject({
      outcome: "needs_review",
      reasonCode: "distance_inconsistent",
    });
  });

  it("never rejects when the dependency says evidence is unavailable", () => {
    const body = evidence({
      evidenceStatus: "unavailable",
      reasonCodes: ["upstream_timeout"],
      post: undefined,
      proof: undefined,
    });
    expect(evaluate(context, body)).toMatchObject({
      outcome: "retry",
      reasonCode: "evidence_unavailable",
    });
  });

  it("requires review when venue-hours enforcement is enabled without authoritative hours proof", () => {
    expect(evaluate({
      ...context,
      requirements: {
        ...context.requirements,
        schedule: {
          ...context.requirements.schedule,
          mustBeDuringVenueHours: true,
        },
      },
    }, evidence())).toMatchObject({
      outcome: "needs_review",
      reasonCode: "venue_hours_evidence_missing",
    });
  });
  it("rejects unsupported evidence contract versions during parsing", () => {
    expect(() => parsePartnerEvidence({ ...fixture.body, evidenceVersion: "2" })).toThrow();
  });

  it("requests fresh evidence when the complete result is stale", () => {
    const checkedAt = new Date(EVALUATED_AT - 61_000).toISOString();
    const body = evidence({
      checkedAt,
      post: { ...fixture.body.post, observedAt: checkedAt },
    });
    expect(evaluate(context, body)).toMatchObject({
      outcome: "retry",
      reasonCode: "evidence_stale",
    });
  });

  it("requires the frozen authorship policy and trusted location source", () => {
    const wrongPolicy = evidence({
      proof: {
        ...fixture.body.proof,
        author: { ...fixture.body.proof.author, policy: "delegated_owner" },
      },
    });
    expect(evaluate(context, wrongPolicy)).toMatchObject({
      outcome: "needs_review",
      reasonCode: "authorship_policy_mismatch",
    });

    const wrongSource = evidence({
      proof: {
        ...fixture.body.proof,
        location: { ...fixture.body.proof.location, source: "other_server_source" },
      },
    });
    expect(evaluate(context, wrongSource)).toMatchObject({
      outcome: "needs_review",
      reasonCode: "location_source_untrusted",
    });
  });

  it("requires review when trusted coordinates are too inaccurate", () => {
    const body = evidence({
      proof: {
        ...fixture.body.proof,
        location: { ...fixture.body.proof.location, accuracyMeters: 500 },
      },
    });
    expect(evaluate(context, body)).toMatchObject({
      outcome: "needs_review",
      reasonCode: "location_accuracy_too_low",
    });
  });

  it("builds distinct stable idempotency keys for verification and pre-payout checks", () => {
    expect(buildPartnerVerificationIdempotencyKey("verification", context.submissionPublicId, 2))
      .toBe("jellyhunt:verification:sub_01HXSUBMISSION0001:attempt:2");
    expect(buildPartnerVerificationIdempotencyKey("pre-payout", "rwd_01HXREWARD0001", 2))
      .toBe("jellyhunt:pre-payout:rwd_01HXREWARD0001:attempt:2");
  });

  it("requires review for incomplete evidence instead of inferring from tags or xdata", () => {
    const body = evidence({
      evidenceStatus: "incomplete",
      reasonCodes: ["place_relation_missing"],
      proof: { ...fixture.body.proof, place: undefined },
      topics: ["scarrs"],
      xdata: { restaurant: "Scarr's" },
    });
    expect(evaluate(context, body)).toMatchObject({
      outcome: "needs_review",
      reasonCode: "evidence_incomplete",
    });
  });
});
