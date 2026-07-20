# Changelog

All notable changes to PlatePost JellyHunt are recorded here. The project has not completed its first production release.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

#### PlatePost-hosted consumer and admin experiences

- Added the **PlatePost x JellyJelly: Human Social!** consumer experience at `/human-social` and a `/map` redirect.
- Recreated the current JellyHunt visual hierarchy and interactions: full-screen NYC map, neon roads and labels, glowing mission pins, JellyJelly HQ, cross-street chip, mission finder, bottom mission drawer, Dark/Wobbles themes, geolocation, distance, hours, directions, and Jelly camera handoff.
- Added Mapbox GL rendering with a matching coordinate-based local fallback and graceful missing-token behavior.
- Added search and category/completion filters, Passport and Editorial Map surfaces, responsive/mobile behavior, accessibility controls, reduced-motion support, and direct JellyJelly iOS/Android links.
- Added live current-season/all-time “most approved” leaderboard tabs backed by v2, including Jelly usernames and loading, empty, error, and retry states.
- Added a signed-session PlatePost admin at `/admin` for mission/place creation and editing, scheduling, lifecycle controls, optimistic-revision campaign/mission reward caps, proof review, reward exceptions, and audit history.
- Added a local-only 16-mission visual fixture plus a guarded, dry-run-first migration catalog. Fixture mode cannot run in Production.

#### Canonical Convex ownership

- Added collision-safe `jellyhunt*` tables and indexes for program configuration, campaigns, reviewed places, missions, immutable mission revisions, participations, submissions, events, HTTP idempotency, legacy dedupe, reward budgets/reservations/intents/attempts, webhook inbox/delivery, audit history, public profiles, approved completions, and leaderboard entries/events.
- Added draft mission creation/editing, immutable publishing, lifecycle transitions, catalog revisions, schedule checks, and service-key authorization.
- Added revision-locked participation start with one active participation per user/mission and a bounded completion window.
- Added owner-visible resubmission controls after rejection under the locked mission revision, original submission window, and configured maximum-attempt limit; no separate participation-expiry worker or resubmission hold is used in this release.
- Added atomic submission intake with exact-post ownership preflight, global Jelly-post uniqueness, user/mission dedupe, immutable proof/reward snapshots, reservation creation, and durable HTTP idempotency replay.
- Added append-only owner event streams and owner-scoped participation, mission, submission, and timeline projections.
- Added campaign/mission reward reservation accounting and transitions for approval, rejection, payment, and reversal.
- Added approved-completion materialization and current-season/all-time “most approved” leaderboards using eligible Jelly usernames.

#### APIs

- Added and contract-tested the v1 compatibility routes for mission discovery, user status, submissions, admin sessions, mission operations, submission review, and audit history.
- Added request IDs and privacy-safe v1 error handling while retaining the stable `mission_already_submitted` and `jelly_post_reused` conflict codes.
- Implemented the OpenAPI 3.1 native v2 surface under `/api/v2/jellyhunt`:
  - current campaign;
  - mission list/detail and place-detail projections;
  - mission/place-linked Jelly feeds;
  - participation start/detail;
  - idempotent submission creation and owner-only submission detail/events;
  - `/me` summary, missions, submissions, and event history;
  - current-season and all-time leaderboards.
- Added five-minute Jelly mission-token verification using remote JWKS, fixed audience `platepost-jellyhunt`, issuer checks, `jellyhunt:read` / `jellyhunt:submit` scopes, and token-derived identity.
- Added signed, expiring pagination cursors bound to resource, query, snapshot, and owner when applicable.
- Added public/private cache policies, semantic ETags, stable success/error envelopes, status projection, and privacy-safe `submission_conflict` handling for v2.

#### Jelly evidence and reward workflows

- Added exact Jelly post preflight with an authoritative partner path and conservative exact-post legacy fallback.
- Added component evidence parsing and policy checks for exact post, author, participant eligibility, post state/type/duration, visibility, moderation/deletion, publication window, canonical place, trusted coordinates, geofence accuracy, and distance consistency.
- Added leased verification work, automatic/manual routing, stale-attempt protection, and conservative `needs_review` behavior for incomplete or unavailable evidence. Generic topics or client-writable metadata cannot auto-approve a mission.
- Added canonical approval, rejection, pre-payment reversal, and post-payment moderation behavior with sibling-attempt and double-completion protection.
- Added immutable reward intent/attempt contracts, full receipt-tuple validation, partner lookup, and server-generated idempotency headers.
- Added a pre-payout Jelly evidence recheck; authoritative ineligibility confirms no transfer and reverses the completion, while unavailable evidence fails safely without paying.
- Added scheduled reward dispatch and a processing watchdog. Automatic rewards are off by default; Production has a second explicit approval gate.
- Added safe worker-result storage that discards arbitrary upstream payout bodies and retains only allowlisted state, validated transaction receipt fields, and audit data. The initial release keeps uncertain reconciliation as a restricted, audited operator workflow.
- Added signed reward-webhook ingestion with current/previous secret overlap and event/body deduplication.

#### Documentation and tests

- Added OpenAPI schemas, v1/v2 compatibility fixtures, Jelly partner fixtures, implementation/design records, and focused tests for routes, contracts, map behavior, Convex workflows, evidence policy, owner privacy, rewards, and admin compatibility.
- Added complete setup, environment, security, deployment, ownership, native-app handoff, and launch-gate documentation.

### Changed

- Moved the intended JellyHunt production source of truth from Supabase/frontend constants to PlatePost's namespaced Convex records.
- Unified production mission discovery around the same published mission/place records; static mission content is restricted to local fixture and guarded migration inputs.
- Made mission edits operational: publishing a new revision updates the map and APIs without a frontend or mobile release while preserving locked terms for existing participants/submissions.
- Defined PlatePost as owner of mission configuration and workflow decisions, while Jelly remains authoritative for users, usernames, posts, place evidence, trusted location, balances, and final transfers.
- Separated verification, decision/completion, and reward states so clients do not treat approval as payment.
- Reworked the public map toward the current JellyHunt desktop/mobile appearance and removed blur-heavy surfaces that produced browser compositing artifacts.
- Kept v1 reads as a compatibility surface while making v2 the direct-native target for Kris/Jelly engineering; v1 submission writes are pre-cutover/development-only and return `410 Gone` in Production.
- Changed all-time leaderboard semantics to begin with this PlatePost tool's launch/import boundary; current season is scoped to the active campaign.
- Recorded the initial-release operating decisions: uncertain rewards remain a restricted, audited manual reconciliation workflow; participation rows are not expired by a background sweeper; rejected users may resubmit within the existing mission attempt/window rules.

### Fixed

- Public v2 discovery and leaderboard routes now return a retryable `503 dependency_unavailable` response when the shared PlatePost Convex deployment is missing or unreachable, instead of presenting the integration gap as a generic internal error.

### Security

- All non-public Convex operations require `PLATEPOST_CONVEX_SERVICE_KEY`; public clients cannot call workflow mutations directly.
- Native identity is derived from a verified Jelly token subject, never from a body/query user ID.
- Reward recipient, wallet, amount, token, and idempotency identity are server-derived from immutable Convex records.
- Credential-bearing non-loopback Jelly endpoints require HTTPS.
- Jelly dependency outages do not reject users, and incomplete/untrusted evidence cannot auto-approve.
- A reward in `uncertain` state is never automatically retried.
- Automatic reward dispatch requires `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=true` and an explicit `JELLYHUNT_ENVIRONMENT_IDENTITY=development|preview|production`; missing or misspelled identities fail closed, and Production additionally requires `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=true`.
- Production fixture fallback is disabled and no production credential is included in source control.
- Production Convex and Vercel credentials exposed through chat are explicitly treated as compromised and must be rotated before use.

### Integration required before Production

- PlatePost has not yet reviewed/merged this standalone `jellyhunt*` schema into its canonical application or connected a shared development Convex deployment.
- The 16 legacy missions require human review and draft import; legacy submissions and payout receipts require a separate dedupe-safe cutover.
- Jelly must supply the mission-token endpoint/JWKS and authoritative place-feed, exact-post preflight, component evidence, profile eligibility, reward-intent/lookup, and reward-capacity contracts.
- Manual uncertain-reward reconciliation is accepted for the initial release and must remain restricted to trained operators with audit review. A server-verified Jelly receipt/confirmed-no-transfer gate remains recommended before this workflow is automated.
- Campaign/mission budget allocations and any required daily/user/capacity limits must be configured and accepted with development data.
- The PlatePost admin, public map, v1, and v2 flows require live development and browser acceptance.
- Admin login rate limiting/WAF policy, monitoring, alerts, retention, support, rollback, and pause runbooks require operator ownership.
- Production Mapbox, Convex, Vercel, and Jelly settings are not configured in source control.
- No production payout or Production deployment has been performed.
