# Next Steps

Last updated: 2026-07-20

The PlatePost JellyHunt application code is built, but the system is **not production-ready** until PlatePost and Jelly complete the external integration, data migration, security, and payout gates below. Complete them in order.

## Current handoff state

- [x] Canonical delivery repository: [`brandonshi10/platepostjelly`](https://github.com/brandonshi10/platepostjelly), default branch `main`.
- [x] Full implementation [PR #3](https://github.com/brandonshi10/platepostjelly/pull/3) and dependency-error [PR #4](https://github.com/brandonshi10/platepostjelly/pull/4) are merged.
- [x] Consumer map, admin, v1 compatibility API, native v2 API/OpenAPI, Convex workflows, tests, and handoff documentation are present in Git.
- [ ] PlatePost's shared Convex project and environment mapping are connected.
- [ ] The exact existing PlatePost Vercel project is identified and linked.
- [ ] Jelly mission-token, partner evidence/place/profile/reward APIs, and native-app integration are accepted.

The current owner decision is **GitHub-only handoff; deployment paused**. Git work may continue, but nobody should create, link, or deploy a Vercel project until a PlatePost owner explicitly resumes hosting. Shared PlatePost Convex and Production remain untouched.

## Implemented baseline

These items are already present in this repository and should be preserved during PlatePost integration:

- [x] Host-ready `/human-social` map and `/admin` operations dashboard.
- [x] Live current-season/all-time “most approved” leaderboard tabs with Jelly usernames and loading, empty, error, and retry states.
- [x] Admin-editable, non-hardcoded missions and reviewed mission-place snapshots, plus optimistic-revision campaign/mission reward caps that cannot fall below reserved + paid amounts.
- [x] Namespaced `jellyhunt*` Convex schema, immutable mission revisions, participations, submissions, events, dedupe/idempotency, budget reservations, approvals, reward intents/attempts, profiles, leaderboards, webhooks, and audit.
- [x] v1 mission/admin compatibility and non-Production submission routes; Production v1 writes return `410 legacy_write_disabled`.
- [x] Implemented v2 mission, place, participation, submission, owner-status/event, and current-season/all-time leaderboard routes.
- [x] Jelly mission-token verifier, strict submission preflight, fresh versioned evidence policy, pre-payout recheck, safe reward worker/watchdog, uncertain-state quarantine, and restricted audited operator reconciliation.
- [x] Local 16-mission parity fixture and guarded dry-run-first legacy catalog importer.
- [x] OpenAPI 3.1, versioned fixtures, and focused route/workflow/security tests.

“Implemented” means code exists and has local/focused verification. It does not mean the route has been exercised against PlatePost's shared Convex or Jelly's real partner services.

## Launch gates, in order

### 1. Rotate exposed credentials

**Owners:** PlatePost/Convex and Vercel administrators

A Production Convex deploy key and a Vercel credential were exposed in chat. They must be treated as compromised.

- [ ] Revoke and rotate the exposed Convex Production deploy key at the Convex project.
- [ ] Revoke and rotate the exposed Vercel credential at Vercel.
- [ ] Confirm neither value exists in repository history, Vercel variables, Convex variables, logs, tickets, or local `.env*` files.
- [ ] Grant named developer/team access instead of sharing credentials in chat.
- [ ] Generate fresh, separate development values for the service key, admin session secret, cursor secret, and webhook secret.
- [ ] Keep deploy keys out of this repository and out of agent-run commands.

**Stop condition:** do not connect or deploy this repository with either chat-exposed credential.

### 2. Connect PlatePost development safely after the hold is lifted

**Owner:** PlatePost engineering

This repository's `main` branch is the canonical JellyHunt code handoff. Hosting topology, the exact existing Vercel project, and shared Convex integration remain unconfirmed. PlatePost may deploy this dedicated application or deliberately embed it in the main PlatePost app; either path must preserve the namespaced data model and route contracts.

- [x] Record the canonical JellyHunt delivery repository and branch: `brandonshi10/platepostjelly`, `main`.
- [x] Merge implementation PR #3 and dependency-error PR #4 into `main`.
- [ ] Assign the PlatePost deployment owner, explicitly lift the deployment hold, and identify the exact existing Vercel team/project without creating a duplicate.
- [ ] Grant developer access to the PlatePost Convex project through the team, not through a Production deploy key.
- [ ] Identify the development and Preview Convex deployments and map each Vercel environment to the correct URL/deployment.
- [ ] Review the full Convex integration boundary against PlatePost: `convex/schema.ts`, `convex/jellyhunt/*`, `convex/legacySchema.ts`, old root function modules, HTTP routes, and crons. Preserve every PlatePost table/index/function/route/webhook and verify all names are collision-free.
- [ ] Decide explicitly whether the transitional generic legacy tables/functions are excluded or deliberately retained. Prove v1 compatibility remains on the namespaced workflow path, then merge only the reviewed tables/functions/bindings.
- [ ] Configure fresh development-only environment values from `.env.example` in both Vercel and Convex as appropriate.
- [ ] Keep `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=false` and `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=false`; set `JELLYHUNT_ENVIRONMENT_IDENTITY` explicitly to `development` for this environment.
- [ ] Run Convex generation/typecheck against the approved development deployment and resolve every error.
- [ ] Deploy a Vercel Preview with `JELLYHUNT_DATA_SOURCE=convex`; fixture mode must be absent.
- [ ] Confirm the configured Vercel value is a public Mapbox token, not a Vercel access token.
- [ ] Prove one admin-created/edited mission appears on `/human-social`, v1 `GET /missions`, and v2 `GET /missions`/detail without a code deployment.
- [ ] Prove pausing the mission removes it from public discovery while preserving its revisions, submissions, events, and audit history.

**Acceptance evidence:** a reviewed schema PR, development deployment ID, Preview URL, environment mapping, Convex typecheck output, and an admin-to-map/API recording or test log.

### 3. Create the canonical campaign and mission data

**Owners:** PlatePost operations and Jelly content/places

The checked-in 16-mission file is migration input, not live data.

- [ ] Create the program configuration and a current development campaign, including the all-time launch epoch and campaign dates.
- [ ] Run `pnpm migrate:legacy-jellyhunt` as a dry run against development.
- [ ] Review the target deployment printed by the importer.
- [ ] Run `pnpm migrate:legacy-jellyhunt --apply` only after the dry run is approved.
- [ ] Keep every imported mission `draft` and `manual` until reviewed.
- [ ] Verify each title, description, instructions, category, difficulty, emoji, neighborhood, sort order, website, and app-link behavior.
- [ ] Verify each address, coordinate, timezone, hours/showtimes, schedule, geofence, and canonical Jelly place/restaurant ID.
- [ ] Verify each proof rule, approval mode, reward amount/token/decimals, campaign ownership, and immutable published revision.
- [ ] Configure non-zero campaign and mission reward allocations before accepting a submission.
- [ ] Decide and implement required daily/user caps and reward-account capacity enforcement; the schema supports scope types, but the canonical intake currently reserves campaign and mission scopes.
- [ ] Publish a small development pilot before activating all reviewed missions.
- [ ] Confirm the all-time leaderboard begins at this tool's launch/import boundary and current-season standings use only the current campaign.

**Acceptance evidence:** approved mission inventory, zero frontend/mobile production mission constants, successful admin edit/publish/pause tests, and documented budget allocations.

### 4. Finish Jelly identity and partner APIs

**Owner:** Jelly backend, reviewed jointly with PlatePost

#### Mission token

- [ ] Implement an authenticated Jelly endpoint that issues a maximum-five-minute bearer token.
- [ ] Include `sub`, `session_id`, `jti`, `iat`, `exp`, `iss`, `aud=platepost-jellyhunt`, and `scope`.
- [ ] Support `jellyhunt:read` and `jellyhunt:submit` scopes.
- [ ] Publish rotating JWKS over HTTPS and provide the issuer URL.
- [ ] Test wrong audience/issuer, expired/long-lived token, missing scope, subject spoofing, logout/revocation behavior, and key rotation.
- [ ] Confirm no PlatePost/Jelly partner secret ships in iOS or Android.

#### Place and post data

- [ ] Implement cursor-paginated `GET /partner/v1/jellyhunt/places/{placeId}/jellies` with canonical place IDs, public-safe post projections, expiring media, and stable cursor behavior.
- [ ] Implement exact-post preflight at the configured `JELLY_PARTNER_PREFLIGHT_URL`. It must return the canonical post ID and owner/participant eligibility before PlatePost commits a uniqueness claim or reward reservation.
- [ ] Implement `POST /partner/v1/jellyhunt/submissions/verify` with component evidence for exact post, author, participant eligibility, state/readiness, type/duration, visibility, moderation, deletion, publication time, canonical place, and trusted post coordinates.
- [ ] Include `complete` / `incomplete` / `unavailable` evidence status, stable reason codes, provenance, and evidence timestamps. Jelly supplies facts; PlatePost owns the approval decision.
- [ ] Provide a canonical public-profile/username eligibility contract for leaderboard projection.
- [ ] Confirm generic topics, hashtags, or client-writable `xdata` are never authoritative proof of place membership.
- [ ] Agree timeout, rate-limit, retry, cache/media-expiry, and outage behavior.
- [ ] Share versioned positive and negative fixtures with PlatePost.

#### Reward intents

- [ ] Implement idempotent reward attempts at `POST /partner/v1/jellyhunt/reward-intents/{intentId}/attempts` using the `Idempotency-Key` header.
- [ ] Implement `GET /partner/v1/jellyhunt/reward-intents/{intentId}` for accepted, pending, sent, confirmed-no-transfer, and uncertain lookup.
- [ ] Optional hardening before automating reconciliation: replace the accepted restricted operator decision with a server-verified full Jelly receipt or authoritative confirmed-no-transfer proof.
- [ ] Guarantee at most one successful transfer across every attempt for one intent.
- [ ] Resolve the recipient wallet from the Jelly user; never accept a wallet from PlatePost or the app.
- [ ] Atomically revalidate the post/recipient/immutable eligibility guard inside every transfer-capable attempt.
- [ ] Return a receipt containing the exact reward intent, submission, mission, Jelly post, recipient user, amount, token, decimals, and canonical transaction ID.
- [ ] Add a restricted reward-account capacity endpoint with available balance, per-transfer maximum, daily remaining amount, token, and decimals.
- [ ] Default rewards to private; public visibility requires explicit campaign policy and auditable consent.
- [ ] Prove that dropped responses, timeouts, replays, and a later attempt cannot create duplicate transfers.

**Acceptance evidence:** both teams run the same fixtures, an outage never rejects a user, a post-ID squatting attempt leaves no durable claim/reservation, and repeated reward calls produce no more than one transfer.

### 5. Integrate the native JellyJelly app

**Owner:** Kris / Jelly app engineering

Use [`openapi/jellyhunt-v2.yaml`](../openapi/jellyhunt-v2.yaml) as the executable contract. Do not build new native work against v1.

- [ ] Fetch `GET /campaigns/current` and `GET /missions`; do not hardcode campaigns, missions, locations, copy, schedules, rewards, or map coordinates.
- [ ] Render mission detail and place data, including viewer availability/status when a mission token is present.
- [ ] Call `PUT /missions/{missionId}/participation` before opening the composer, using the displayed revision.
- [ ] Carry the returned participation ID, locked revision, deadline, and canonical place ID through the composer.
- [ ] After Jelly publication, call `POST /missions/{missionId}/submissions` once with the canonical post ID and a client-generated `Idempotency-Key`.
- [ ] Treat a replay as success and a privacy-safe `submission_conflict` as non-enumerable; do not invent a duplicate-recovery path from error text.
- [ ] Poll `GET /submissions/{submissionId}` or consume `/me/events` while verification, review, or payout is pending.
- [ ] Render server-provided `displayStatus`, `publicMessage`, `nextAction`, and `canResubmit`. Keep approval separate from reward delivery.
- [ ] Show current-season and all-time “most approved” leaderboards using the returned Jelly usernames.
- [ ] Render mission/place-linked Jelly posts without persisting expired signed media URLs.
- [ ] Send analytics for map open, mission view/start, publish, submit, approve/reject, and reward without logging tokens, exact coordinates, or private evidence.
- [ ] Add support handling for `reward_uncertain`; never offer a payout retry to the user.

**Acceptance evidence:** a development Jelly user discovers a mission, starts it, publishes/submits one post, sees the same status as PlatePost admin, appears in the correct leaderboard after approval, and receives exactly one development reward.

### 6. Prove the end-to-end workflow

**Owners:** PlatePost, Jelly backend, Jelly app, and operations

Run these once against the connected development/Preview environment:

- [ ] Public visitor: mission discovery, filters, marker/detail drawer, hours, directions, geolocation denial/success, Editorial Map, Passport handoff, and app-store links.
- [ ] Identity: valid optional viewer, required read/submit scopes, expired token, wrong subject/audience/issuer, and owner-only resource isolation.
- [ ] Participation: idempotent replay, revision lock, deadline, paused/expired mission, and stale revision.
- [ ] Submission: idempotent replay, same-key/different-body rejection, concurrent intake, owner mismatch, missing post, reused post, prior mission completion, and dependency outage.
- [ ] Verification: automatic approval, manual review, incomplete evidence, unavailable evidence, wrong place, outside geofence, deleted/private/moderated post, and stale worker lease.
- [ ] Approval: sibling-attempt guard, one completion, one all-time increment, one current-season increment, and username refresh.
- [ ] Reward: eligible send, exact replay, full receipt match, confirmed failure, timeout/unknown result, watchdog expiration, pre-payout ineligibility reversal, and no automatic retry from `uncertain`.
- [ ] Admin: create/edit/publish/pause, budget-cap revisions, approve/reject, reverify, retry confirmed failure, restricted manual uncertain sent/failed reconciliation, and audit attribution.
- [ ] Compatibility: frozen v1 success/error fixtures still pass against the same records.
- [ ] Failure recovery: Jelly API down, Convex down, Mapbox token missing, Vercel rollback, and “pause all missions.”

**Acceptance evidence:** request IDs, audit IDs, submission/event history, one canonical reward receipt, leaderboard results, screenshots, and operator sign-off are attached to the launch ticket.

### 7. Migrate legacy dedupe and payout history

**Owners:** Jelly backend, PlatePost data engineering, and operations

Production automatic rewards must remain disabled until every old writer and payout worker shares the new deduplication boundary.

- [ ] Inventory every legacy JellyHunt submission writer, Supabase table, payout job, and retry path.
- [ ] Choose a UTC cutover watermark and stable mission-ID mapping.
- [ ] At the watermark, stop legacy JellyHunt writes and payout workers without applying a broad fence to shared Pets/Wobbles data.
- [ ] Drain in-flight work and manually resolve every pending or uncertain legacy payout.
- [ ] Export stable user, mission, post, status, amount/token, transaction ID/hash, and timestamps.
- [ ] Import the legacy uniqueness rows into `jellyhuntLegacyDedupeRecords`, preserve migration provenance in the audit/evidence package, and populate the canonical post/user-mission/reward/transaction boundaries.
- [ ] Reconcile counts/hashes and require zero orphan successful transactions.
- [ ] Keep Production v1 submission writes disabled (`410 Gone`). If a temporary pre-Production v1 writer remains, keep it server-only and routed through the same canonical mutations.
- [ ] Remove all independent payout paths before enabling v2 automatic rewards.

**Acceptance evidence:** no legacy post, completion, reward intent, or transaction can be created or paid again through PlatePost.

### 8. Finish product, security, and operations acceptance

**Owners:** PlatePost product/engineering/operations with Jelly review

- [ ] Compare desktop/mobile screenshots with `jellyjelly.com/jellyhunt` using real Mapbox and the development mission catalog.
- [ ] Test current Chrome, Safari, Firefox, iOS, and Android layouts.
- [ ] Test keyboard navigation, focus restoration, screen-reader labels, reduced motion, color contrast, and empty/loading/error states.
- [ ] Verify current-season/all-time tabs, tie rankings, pagination, username changes, ineligible profiles, and an empty new-tool leaderboard.
- [ ] Decide whether Jelly Library/profile editing remains native-only, becomes a later PlatePost phase, or is retired.
- [ ] Add admin login rate limiting, failed-login monitoring, and Vercel WAF/platform controls.
- [ ] Define PlatePost/Jelly on-call owners and alerts for verification failures, queue age, uncertain/failed rewards, budget remaining, and partner errors.
- [ ] Define retention for audit, precise location, Jelly IDs, media URLs, and payout receipts.
- [ ] Exercise pause-all, reward kill switch, Vercel rollback, partner outage, and key-rotation runbooks.
- [ ] Prepare support copy for rejection, delayed verification, confirmed reward failure, uncertain reward, and post-payment moderation.

## Deployment checklist

### Preview

- [ ] A PlatePost owner explicitly lifts the current GitHub-only deployment hold.
- [ ] The exact existing PlatePost Vercel team/project is recorded and linked; no duplicate project is created.
- [ ] Credential rotation is complete.
- [ ] PlatePost schema merge is reviewed and development Convex is connected.
- [ ] Fresh development-only variables are configured in Convex and Vercel; the Preview reward worker has `JELLYHUNT_ENVIRONMENT_IDENTITY=preview`.
- [ ] Fixture mode is absent; automatic rewards remain disabled until the controlled payout test.
- [ ] Mission data is imported as reviewed drafts and a small pilot is published.
- [ ] Unit, contract, Convex, OpenAPI, lint, build, and Convex typecheck gates pass once.
- [ ] Admin-to-map/v1/v2 and native end-to-end acceptance pass.
- [ ] A controlled development reward proves exact-once behavior and the worker is disabled again after the test.

### Production

- [ ] Security/privacy, partner contracts, legacy cutover, budgets/capacity, and runbooks are approved.
- [ ] Production uses fresh credentials, a Production Mapbox token, the reviewed Production Convex/Vercel mapping, and `JELLYHUNT_ENVIRONMENT_IDENTITY=production`.
- [ ] `JELLYHUNT_DATA_SOURCE` is `convex` or unset.
- [ ] Initial missions are reviewed and published in stages.
- [ ] Automatic rewards stay off for launch unless a named human approval explicitly sets both required flags.
- [ ] PlatePost and Jelly operators monitor the pilot and can pause missions/rewards immediately.
- [ ] Jelly native points at the approved v2 base URL; no shared secret ships in the app.
- [ ] Legacy v1 retirement/redirect timing is documented after the pilot is stable.

## Do not do these

- Do not use either credential exposed in chat; rotate them first.
- Do not deploy this repository's unmerged full schema over PlatePost's real schema without the merge review.
- Do not hardcode Production missions in PlatePost or Jelly clients.
- Do not enable `JELLYHUNT_DATA_SOURCE=fixture` in Preview or Production.
- Do not put any service, partner, admin, reward, or deploy credential in `NEXT_PUBLIC_*`.
- Do not trust a client-supplied Jelly user, username, wallet, reward amount, recipient, or payout idempotency identity.
- Do not use topics or client-writable metadata as authoritative restaurant/place evidence.
- Do not automatically retry `reward_uncertain`.
- Do not mark an uncertain reward sent or failed from unsupported operator text. The accepted initial manual workflow requires a named operator's documented Jelly lookup, a confirmed transaction ID or confirmed-no-transfer reason, and an audit trail; any automated reconciliation additionally requires server-verified proof.
- Do not test payouts against Production before the partner and legacy-cutover gates pass.
- Do not apply broad Supabase balance/audit restrictions that could affect Pets or Wobbles.
- Do not create, link, or deploy a Vercel project while the GitHub-only deployment hold is active.
