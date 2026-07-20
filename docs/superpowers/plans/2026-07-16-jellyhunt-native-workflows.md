# JellyHunt Native Workflows, Rewards, and Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the authenticated JellyHunt v2 mission journey—discover, start, submit, verify, review, approve, rank, reward, and inspect status—on the namespaced Convex foundation without trusting client-owned identity or payout data.

**Architecture:** Next.js v2 route handlers validate Jelly mission tokens and map stable HTTP contracts to generated Convex functions. Convex owns atomic workflow state, persistent idempotency, budgets, completion facts, projections, audit, inbox/outbox, and reward attempts. Jelly adapters implement versioned fixture-backed boundaries until signed partner contracts are available; automatic Production payout remains disabled.

**Tech Stack:** Next.js App Router, TypeScript, Convex, Zod, `jose`, `json-canonicalize`, Vitest, `convex-test`, OpenAPI fixtures.

## Global Constraints

- Plan 1’s completion gate is mandatory.
- A body/query user ID is ignored or rejected; authenticated subject is the only owner.
- Optional invalid authentication returns `401` and never becomes anonymous.
- Personalized responses use `Cache-Control: private, no-store` and `Vary: Authorization`.
- Public ETags exclude `requestId` and `generatedAt`; cursors bind resource, subject where applicable, normalized query, page size, concrete scope, and revision.
- Exact post preflight occurs before durable reservation/uniqueness claims.
- Every live approval uses one canonical Convex mutation. Legacy import uses a separate non-paying mutation.
- Reward timeout, dropped response, 5xx, or incomplete receipt is `uncertain`; no blind retry is permitted.
- Public leaderboards expose only rank, canonical username, and approved mission count.

---

### Task 1: Add v2 HTTP, Authentication, Status, Cursor, and Cache Primitives

**Files:**
- Create: `src/lib/jellyhunt/v2/contracts/common.ts`
- Create: `src/lib/jellyhunt/v2/contracts/campaigns.ts`
- Create: `src/lib/jellyhunt/v2/contracts/missions.ts`
- Create: `src/lib/jellyhunt/v2/contracts/places.ts`
- Create: `src/lib/jellyhunt/v2/contracts/participations.ts`
- Create: `src/lib/jellyhunt/v2/contracts/submissions.ts`
- Create: `src/lib/jellyhunt/v2/contracts/leaderboards.ts`
- Create: `src/lib/jellyhunt/v2/contracts/index.ts`
- Create: `src/lib/jellyhunt/v2/errors.ts`
- Create: `src/lib/jellyhunt/v2/envelope.ts`
- Create: `src/lib/jellyhunt/v2/cache.ts`
- Create: `src/lib/jellyhunt/v2/cursor.ts`
- Create: `src/lib/jellyhunt/v2/idempotency.ts`
- Create: `src/lib/jellyhunt/v2/jelly-mission-token.ts`
- Create: `src/lib/jellyhunt/v2/status.ts`
- Create: `src/lib/jellyhunt/v2/route-handler.ts`
- Create: `tests/api/v2/auth.test.ts`
- Create: `tests/api/v2/http.test.ts`
- Create: `tests/jellyhunt-v2-status.test.ts`

**Interfaces:**

```ts
export type JellyScope = "jellyhunt:read" | "jellyhunt:submit";
export type JellyViewer = {
  jellyUserId: string;
  sessionId: string;
  tokenId: string;
  scopes: ReadonlySet<JellyScope>;
};

export async function requireJellyViewer(
  request: Request,
  scope: JellyScope,
): Promise<JellyViewer>;

export async function optionalJellyViewer(
  request: Request,
  scope?: JellyScope,
): Promise<JellyViewer | null>;

export function normalizeOpaqueJellyId(value: string): string;
export function normalizeCanonicalUsername(value: string): string;
export function deriveDisplayState(input: StatusInput): DisplayState;
export function sealCursor(payload: CursorPayload): string;
export function openCursor(token: string, binding: CursorBinding): CursorPayload;
export function semanticEtag(resource: unknown): string;
```

- [ ] **Step 1: Write token and opaque-ID tests**

```ts
it("derives identity from a five-minute asymmetric token", async () => {
  const request = requestWithToken(await signMissionToken({
    sub: "User_MixedCase",
    aud: "platepost-jellyhunt",
    scope: "jellyhunt:read jellyhunt:submit",
    lifetimeSeconds: 300,
  }));
  const viewer = await requireJellyViewer(request, "jellyhunt:submit");
  expect(viewer.jellyUserId).toBe("User_MixedCase");
});

it("trims but never lowercases opaque Jelly IDs", () => {
  expect(normalizeOpaqueJellyId(" User_AbC ")).toBe("User_AbC");
});
```

Add cases for HS256, wrong issuer/audience/scope, expired/future tokens, lifetime over 300 seconds, JWKS rotation, and invalid optional bearer.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/api/v2/auth.test.ts tests/api/v2/http.test.ts tests/jellyhunt-v2-status.test.ts`

Expected: FAIL because the v2 primitives are absent.

- [ ] **Step 3: Implement asymmetric mission-token validation**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUDIENCE = "platepost-jellyhunt";

export async function verifyMissionToken(token: string): Promise<JellyViewer> {
  const issuer = requiredHttpsUrl("JELLY_MISSION_TOKEN_ISSUER");
  const jwks = createRemoteJWKSet(new URL(requiredHttpsUrl("JELLY_MISSION_JWKS_URL")));
  const result = await jwtVerify(token, jwks, {
    issuer,
    audience: AUDIENCE,
    algorithms: ["RS256", "ES256", "EdDSA"],
    clockTolerance: 30,
  });
  const { sub, sid, jti, iat, exp, scope } = result.payload;
  if (!sub || !sid || !jti || !iat || !exp || exp - iat > 300) throw unauthorized();
  const scopes = new Set(String(scope ?? "").split(/\s+/).filter(Boolean) as JellyScope[]);
  return { jellyUserId: normalizeOpaqueJellyId(sub), sessionId: sid, tokenId: jti, scopes };
}
```

- [ ] **Step 4: Implement the paid-moderation display state exactly**

```ts
if (
  input.submissionStatus === "rejected" &&
  input.rewardStatus === "sent" &&
  input.reasonCode === "post_became_ineligible_after_reward"
) {
  return {
    displayStatus: "rewarded_removed_from_rankings",
    publicMessage: "Reward sent; completion later removed from rankings.",
    nextAction: "contact_support",
    canResubmit: false,
  };
}
```

Implement every other transition from the v2 state table as an exhaustive `never`-checked switch.

- [ ] **Step 5: Implement authenticated cursors and semantic ETags**

Cursor payloads contain `resource`, optional `subject`, `queryHash`, `limit`, `scopeKey`, `revision`, last sort values, `issuedAt`, and `expiresAt`. Use HMAC-SHA256 with server-only `JELLYHUNT_CURSOR_SECRET`, constant-time verification, and `json-canonicalize` for the query hash. Invalid JSON is rejected before the idempotency layer.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run tests/api/v2/auth.test.ts tests/api/v2/http.test.ts tests/jellyhunt-v2-status.test.ts`

Expected: PASS for auth, cache, ETag, cursor, error envelope, and every display state.

- [ ] **Step 7: Commit**

```bash
git add src/lib/jellyhunt/v2 tests/api/v2 tests/jellyhunt-v2-status.test.ts
git commit -m "feat: add JellyHunt v2 HTTP primitives"
```

### Task 2: Implement Participation, Owner History, and Ordered Events

**Files:**
- Create: `convex/jellyhunt/participations.ts`
- Create: `convex/jellyhunt/events.ts`
- Create: `tests/convex/jellyhunt-participations.test.ts`
- Create: `tests/convex/jellyhunt-events.test.ts`

**Interfaces:**

```ts
export type StartParticipationCommand = {
  jellyUserId: string;
  missionPublicId: string;
  expectedMissionRevision: number;
  requestId: string;
  now: number;
};

export type StartParticipationResult = {
  created: boolean;
  participationPublicId: string;
  missionPublicId: string;
  missionRevision: number;
  jellyPlaceId: string;
  startedAt: number;
  submissionDeadlineAt: number;
};
```

- [ ] **Step 1: Write failing Convex transaction tests**

Cover idempotent replay, different expected revision conflict, one active participation per user/mission, paused/upcoming/ended availability, late owner history, immutable terms after edit/archive, another-owner lookup returning the same null result as absent, monotonic subject event sequence, and newest-twenty embedded timeline ordering.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-participations.test.ts tests/convex/jellyhunt-events.test.ts`

Expected: FAIL because the modules are absent.

- [ ] **Step 3: Implement idempotent start in one mutation**

The mutation queries the active user/mission index. An exact mission revision replay returns the stored row without changing `startedAt`; a different revision returns `participation_revision_locked`. A new row snapshots campaign, mission revision, requirements, place, reward display, deadline, and event sequence before committing.

- [ ] **Step 4: Implement append-only event allocation**

Each owner event mutation reads and increments a per-user sequence stored in `jellyhuntProgramConfig` shards or the owner’s latest indexed event, inserts one `jellyhuntSubmissionEvents` row, and includes public-safe status/reason only. Duplicate event IDs are idempotent.

- [ ] **Step 5: Run focused and full Convex tests**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-participations.test.ts tests/convex/jellyhunt-events.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/jellyhunt/participations.ts convex/jellyhunt/events.ts tests/convex/jellyhunt-participations.test.ts tests/convex/jellyhunt-events.test.ts
git commit -m "feat: add JellyHunt participation and event history"
```

### Task 3: Implement Durable Submission Idempotency, Dedupe, and Reservations

**Files:**
- Create: `convex/jellyhunt/idempotency.ts`
- Create: `convex/jellyhunt/submissions.ts`
- Create: `convex/jellyhunt/budgets.ts`
- Create: `tests/convex/jellyhunt-idempotency.test.ts`
- Create: `tests/convex/jellyhunt-submissions.test.ts`
- Create: `tests/convex/jellyhunt-budgets.test.ts`

**Interfaces:**

```ts
export type StoredHttpResponse = {
  status: number;
  bodyJson: string;
  headers: { location?: string };
  originalRequestId: string;
};

export type CreateSubmissionCommand = {
  jellyUserId: string;
  missionPublicId: string;
  participationPublicId: string;
  missionRevision: number;
  jellyPostId: string;
  idempotencyKey: string;
  normalizedPath: string;
  canonicalRequestHash: string;
  originalRequestId: string;
  now: number;
};
```

- [ ] **Step 1: Write concurrency and replay tests**

Cover exact stored response replay, changed-body key reuse, in-progress `Retry-After`, expired tombstone rejection, lease reclaim only when no durable row exists, global post reuse, one live user/campaign/mission attempt, valid resubmission with a new post, preflight failure creating no reservation, and concurrent budget limits without lost updates.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-idempotency.test.ts tests/convex/jellyhunt-submissions.test.ts tests/convex/jellyhunt-budgets.test.ts`

Expected: FAIL because the canonical submission workflow is absent.

- [ ] **Step 3: Implement persistent request leasing**

The idempotency record key is `(subject, method, normalizedPath, idempotencyKey)`. It stores canonical request hash, state `in_progress|completed|expired`, lease owner/expiry, exact response, original request ID, and retention expiry. A canonical hash mismatch returns `idempotency_key_reused`; an expired completed tombstone returns `idempotency_record_expired` and never creates new work.

- [ ] **Step 4: Implement atomic reservation finalization**

After the internal Jelly preflight action succeeds, one mutation revalidates mission/revision/deadline, claims Jelly post uniqueness, inserts the submission snapshot, moves capacity into `pending_verification`, completes the idempotency record with exact `202` body and `Location`, appends the owner event/audit/outbox rows, and schedules verification.

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-idempotency.test.ts tests/convex/jellyhunt-submissions.test.ts tests/convex/jellyhunt-budgets.test.ts`

Expected: PASS under concurrent test execution.

- [ ] **Step 6: Commit**

```bash
git add convex/jellyhunt/idempotency.ts convex/jellyhunt/submissions.ts convex/jellyhunt/budgets.ts tests/convex
git commit -m "feat: add idempotent JellyHunt submission intake"
```

### Task 4: Implement Jelly Place, Content, Profile, and Evidence Providers

**Files:**
- Create: `convex/jellyhunt/jellyHttpClient.ts`
- Create: `convex/jellyhunt/jellyPlaces.ts`
- Create: `convex/jellyhunt/verification.ts`
- Create: `convex/jellyhunt/profiles.ts`
- Create: `tests/contracts/jelly-partner-v1/mission-token.json`
- Create: `tests/contracts/jelly-partner-v1/place-jellies.json`
- Create: `tests/contracts/jelly-partner-v1/mission-evidence.json`
- Create: `tests/contracts/jelly-partner-v1/public-profile.json`
- Create: `tests/convex/jellyhunt-verification.test.ts`
- Create: `tests/convex/jellyhunt-profiles.test.ts`

**Interfaces:**

```ts
export type CanonicalJellyProfile = {
  jellyUserId: string;
  username: string;
  normalizedUsername: string;
  profileRevision: string | null;
  accountState: "active" | "restricted" | "deleted";
  publicEligible: boolean;
};

export interface JellyEvidenceProvider {
  preflight(input: ExactPostPreflight): Promise<PreflightResult>;
  verify(input: MissionEvidenceRequest): Promise<MissionEvidence>;
  listPlaceJellies(input: PlaceFeedRequest): Promise<PlaceJellyPage>;
  fetchPublicProfile(jellyUserId: string): Promise<CanonicalJellyProfile | null>;
}
```

- [ ] **Step 1: Write provider and evidence tests**

Cover exact owner, post readiness/visibility/deletion/moderation, canonical place, timestamp, trusted coordinates/accuracy, supplied vs computed distance agreement, border tolerance, dependency outage, stale safe feed, username normalization, restricted/deleted profile withholding, and profile revision updates.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-verification.test.ts tests/convex/jellyhunt-profiles.test.ts`

Expected: FAIL because providers are absent.

- [ ] **Step 3: Implement the signed partner adapter against fixtures**

The adapter uses HTTPS, bounded timeout, request correlation ID, server-only credential, and strict Zod response parsing. It never derives place association from topics, transcript, title, or client `xdata`. Missing or inconsistent required evidence yields `needs_review` or retry; dependency outage never causes rejection.

- [ ] **Step 4: Implement the limited development profile bridge**

When the signed partner profile route is unavailable outside Production, call `GET /user/{userId}`, read only `data.user.username`, set `profileRevision: null`, `accountState: active`, and `publicEligible: true` only for a non-empty canonical username. Production rejects this bridge unless the integration manifest explicitly enables a reviewed versioned contract.

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-verification.test.ts tests/convex/jellyhunt-profiles.test.ts`

Expected: PASS and no fixture relies on generic tags or `xdata` for automatic approval.

- [ ] **Step 6: Commit**

```bash
git add convex/jellyhunt tests/contracts/jelly-partner-v1 tests/convex/jellyhunt-verification.test.ts tests/convex/jellyhunt-profiles.test.ts
git commit -m "feat: add Jelly mission evidence providers"
```

### Task 5: Implement Canonical Approval, Reversal, and Materialized Leaderboards

**Files:**
- Create: `convex/jellyhunt/approvals.ts`
- Create: `convex/jellyhunt/leaderboards.ts`
- Create: `tests/convex/jellyhunt-approvals.test.ts`
- Create: `tests/convex/jellyhunt-leaderboards.test.ts`

**Interfaces:**

```ts
export type ApproveSubmissionCommand = {
  submissionPublicId: string;
  approvalDecisionId: string;
  actorId: string;
  now: number;
};

export type LeaderboardScopeKey = `campaign:${string}` | "all_time";

export type LeaderboardCursorState = {
  scopeKey: LeaderboardScopeKey;
  revision: number;
  eligibleItemsSeen: number;
  lastDisplayedRank: number;
  lastScore: number;
  lastNormalizedUsername: string;
  lastPublicEntryId: string;
};
```

- [ ] **Step 1: Write approval and ranking tests**

Cover first approval, exact replay, same-decision/different-submission quarantine, concurrent different-mission increments, late approval after rollover, pre-epoch/legacy exclusion, reward-state independence, pre-payout reversal vs worker lease, post-payment moderation preserving receipt, username/eligibility revision invalidation, competition ties across pages, withheld profiles without rank gaps, concrete current campaign cursor binding, and all-time/current-season 404 behavior.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-approvals.test.ts tests/convex/jellyhunt-leaderboards.test.ts`

Expected: FAIL because approval facts and projections are absent.

- [ ] **Step 3: Implement the canonical approval mutation in the reviewed order**

Query the `(jellyUserId, campaignId, missionId)` completion key before setting approval state. Treat a replay as idempotent only when both decision ID and winning submission match. Quarantine every other occupant without changing the loser. Then set `approvedAt`, insert `source: live`/countable completion, increment immutable campaign and eligible all-time projections, create/confirm queued intent and `approved_reserved`, bump revisions, and append events atomically.

- [ ] **Step 4: Implement both moderation paths**

Pre-payout reversal requires queued intent, no active lease, and no accepted transfer-capable attempt; it cancels/releases before reversing completion and score. Processing/uncertain returns `reconciliation_required`. Post-payment moderation keeps the paid reservation/receipt/transaction, sets rejected+sent with the safe reason, reverses completion and both counted scopes, disallows resubmission, and emits owner/audit events atomically.

- [ ] **Step 5: Implement indexed competition ranking**

Store `rankSortScore = -approvedMissionCount` and query the ascending `(scopeKey, publicEligible, rankSortScore, normalizedUsername, publicEntryId)` index with `publicEligible: true`. Bind the current-season cursor/ETag to concrete `campaign:<campaignId>` plus revision; bind all-time to `all_time` plus global revision.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-approvals.test.ts tests/convex/jellyhunt-leaderboards.test.ts`

Expected: PASS for every concurrency, rollover, reversal, moderation, eligibility, and pagination case.

- [ ] **Step 7: Commit**

```bash
git add convex/jellyhunt/approvals.ts convex/jellyhunt/leaderboards.ts tests/convex/jellyhunt-approvals.test.ts tests/convex/jellyhunt-leaderboards.test.ts
git commit -m "feat: add approved-mission leaderboards"
```

### Task 6: Implement Reward Intents, Versioned Attempts, Reconciliation, and Webhooks

**Files:**
- Create: `convex/jellyhunt/rewardContracts.ts`
- Create: `convex/jellyhunt/jellyRewardClient.ts`
- Create: `convex/jellyhunt/rewards.ts`
- Create: `convex/jellyhunt/webhooks.ts`
- Create: `convex/jellyhunt/registerHttpRoutes.ts`
- Create: `convex/jellyhunt/registerCrons.ts`
- Modify: `convex/http.ts`
- Create: `convex/crons.ts`
- Create: `tests/convex/jellyhunt-rewards.test.ts`
- Create: `tests/convex/jellyhunt-webhooks.test.ts`
- Create: `tests/jellyhunt-legacy-reward-adapter.test.ts`

**Interfaces:**

```ts
export function buildRewardAttempt(
  intent: RewardIntentSnapshot,
  attemptNumber: number,
): { idempotencyKey: `reward:${string}:attempt:${number}`; body: RewardAttemptRequest };

export function parseRewardAttemptResponse(
  status: number,
  body: unknown,
): PartnerRewardOutcome;

export function assertReceiptMatchesIntent(
  intent: RewardIntentSnapshot,
  receipt: RewardIntentReceipt,
): void;
```

- [ ] **Step 1: Write attempt and webhook tests**

Cover decimal-string tuple, 201 sent, 202 accepted, 200 replay, 422 confirmed-no-transfer, timeout/5xx/429 uncertainty, mandatory lookup, N+1 only after confirmed absence, at-most-one sent attempt, transaction uniqueness, tuple mismatch, signed raw-body validation, current/previous key overlap, event ID/body-hash dedupe, out-of-order delivery, and no automatic legacy uncertain retry.

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-rewards.test.ts tests/convex/jellyhunt-webhooks.test.ts`

Expected: FAIL because reward-intent and webhook modules are absent.

- [ ] **Step 3: Implement immutable intent and attempt leasing**

The worker mutation leases only queued intent plus `approved_reserved`, assigns a unique attempt number, and snapshots mission/submission/post/recipient/amount/token. Any ambiguous transport result becomes uncertain. A later attempt is impossible until lookup proves the prior attempt final with no transfer.

- [ ] **Step 4: Implement receipt verification**

Before `sent`, compare intent ID, submission ID, mission ID, post ID, recipient ID, canonical decimal amount, token, and globally unique transaction ID. Any mismatch remains uncertain and alerts operators.

- [ ] **Step 5: Implement signed inbox/outbox and merge the root router/crons**

Register namespaced webhook paths through `registerJellyhuntHttpRoutes(router)` and namespaced watchdogs through `registerJellyhuntCrons(crons)`. Root files retain existing PlatePost/Manus registrations before calling those helpers. Store raw-body hash and event ID before side effects; exact duplicates return 204 and reused IDs with different bytes return 409.

- [ ] **Step 6: Keep Production dispatch disabled**

The reward worker checks `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED === "true"` and environment identity. Missing/false pauses queued work without releasing reservations or contacting Jelly. Production enablement is absent from this plan.

- [ ] **Step 7: Run reward/webhook gates**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-rewards.test.ts tests/convex/jellyhunt-webhooks.test.ts`

Run: `pnpm exec vitest run tests/jellyhunt-legacy-reward-adapter.test.ts tests/platepost-surface-preservation.test.ts`

Expected: PASS with zero blind retry and preserved root registrations.

- [ ] **Step 8: Commit**

```bash
git add convex/jellyhunt convex/http.ts convex/crons.ts tests/convex tests/jellyhunt-legacy-reward-adapter.test.ts
git commit -m "feat: add safe Jelly reward intent workflow"
```

### Task 7: Implement Every Native v2 Route and Repository Method

**Files:**
- Create: `src/lib/jellyhunt/v2/repository.ts`
- Create: `app/api/v2/jellyhunt/campaigns/current/route.ts`
- Create: `app/api/v2/jellyhunt/missions/route.ts`
- Create: `app/api/v2/jellyhunt/missions/[missionId]/route.ts`
- Create: `app/api/v2/jellyhunt/missions/[missionId]/jellies/route.ts`
- Create: `app/api/v2/jellyhunt/missions/[missionId]/participation/route.ts`
- Create: `app/api/v2/jellyhunt/missions/[missionId]/submissions/route.ts`
- Create: `app/api/v2/jellyhunt/places/[placeId]/route.ts`
- Create: `app/api/v2/jellyhunt/places/[placeId]/jellies/route.ts`
- Create: `app/api/v2/jellyhunt/participations/[participationId]/route.ts`
- Create: `app/api/v2/jellyhunt/submissions/[submissionId]/route.ts`
- Create: `app/api/v2/jellyhunt/submissions/[submissionId]/events/route.ts`
- Create: `app/api/v2/jellyhunt/me/route.ts`
- Create: `app/api/v2/jellyhunt/me/missions/route.ts`
- Create: `app/api/v2/jellyhunt/me/submissions/route.ts`
- Create: `app/api/v2/jellyhunt/me/events/route.ts`
- Create: `app/api/v2/jellyhunt/leaderboards/current-season/route.ts`
- Create: `app/api/v2/jellyhunt/leaderboards/all-time/route.ts`
- Create: `tests/api/v2/campaigns.test.ts`
- Create: `tests/api/v2/missions.test.ts`
- Create: `tests/api/v2/places.test.ts`
- Create: `tests/api/v2/participations.test.ts`
- Create: `tests/api/v2/submissions.test.ts`
- Create: `tests/api/v2/submission-status.test.ts`
- Create: `tests/api/v2/me.test.ts`
- Create: `tests/api/v2/leaderboards.test.ts`

**Interfaces:**

```ts
export interface JellyhuntV2Repository {
  getCurrentCampaign(): Promise<CurrentCampaign | null>;
  listMissions(input: MissionListInput, subject?: string): Promise<MissionPage>;
  getMission(input: { missionId: string; subject?: string }): Promise<MissionDetail | null>;
  getPlace(placeId: string): Promise<PlaceDetail | null>;
  listPlaceJellies(input: PlaceJelliesInput): Promise<JellyPage>;
  startParticipation(command: StartParticipationCommand): Promise<StartParticipationResult>;
  createSubmission(command: CreateSubmissionCommand): Promise<IdempotentSubmissionResult>;
  getParticipation(subject: string, id: string): Promise<ParticipationDetail | null>;
  getSubmission(subject: string, id: string): Promise<SubmissionDetail | null>;
  listSubmissionEvents(input: OwnedEventPageInput): Promise<SubmissionEventPage>;
  getMe(input: MeQuery): Promise<MeSummary>;
  listMyMissions(input: MyMissionQuery): Promise<MyMissionPage>;
  listMySubmissions(input: MySubmissionQuery): Promise<MySubmissionPage>;
  listMyEvents(input: MyEventQuery): Promise<MyEventPage>;
  listLeaderboard(input: LeaderboardQuery): Promise<LeaderboardPage>;
}
```

- [ ] **Step 1: Write route tests from every success and error fixture**

Instantiate handlers with a fake repository and signed test tokens. Assert exact status/body/headers, ownership privacy, cache policy, cursor invalidation, `Location`, idempotent replay, optional viewer behavior, and no internal IDs/policy fields.

- [ ] **Step 2: Verify all route tests fail**

Run: `pnpm exec vitest run tests/api/v2`

Expected: FAIL because route files do not exist.

- [ ] **Step 3: Implement one shared route-handler wrapper**

The wrapper creates a transport request ID, validates JSON/query through Zod, resolves required/optional viewer, calls the repository, maps typed domain errors to stable envelopes, sets cache/Vary/ETag/cursor headers, and redacts unknown exceptions to `500 internal_error`.

- [ ] **Step 4: Implement all seventeen route handlers as thin adapters**

Handlers contain only schema selection, auth scope, repository call, response mapping, and documented cache policy. No route duplicates workflow logic or contacts Jelly directly.

- [ ] **Step 5: Run contract and API suites**

Run: `pnpm exec vitest run tests/api/v2`

Run: `pnpm test:contracts`

Expected: all route responses validate against OpenAPI fixtures.

- [ ] **Step 6: Run the complete Plan 2 gate**

Run: `pnpm test:convex`

Run: `pnpm typecheck:convex`

Run: `pnpm test && pnpm lint && pnpm build`

Expected: every command exits zero; build output lists every v2 route; v1 fixtures still pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/v2 src/lib/jellyhunt/v2 tests/api/v2
git commit -m "feat: expose JellyHunt native API v2"
```

## Native Workflow Completion Gate

Do not enable Production rewards or begin legacy cutover. Plan 2 is complete only when every v2 fixture passes, all owner lookups are privacy-safe, Convex concurrency tests pass, current/all-time rankings are deterministic, reward ambiguity cannot duplicate payment, generated Convex typechecking succeeds, and the full existing baseline remains green.

