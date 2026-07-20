# Changelog

All notable changes to PlatePost Jellyhunt are recorded here. The project has not yet completed its first production release.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (Tasks 5-7: Native Workflows)

- Submission approval, pre-payment reversal, and post-payment moderation mutations with idempotent decision replay and double-completion guards (`convex/jellyhunt/approvals.ts`).
- Indexed leaderboard queries by scope (all-time, per-campaign) with pagination and profile refresh (`convex/jellyhunt/leaderboards.ts`).
- Pure reward-attempt builders, response parsers, and receipt validators (`convex/jellyhunt/rewardContracts.ts`).
- Transport abstraction for reward execution and status lookup (`convex/jellyhunt/jellyRewardClient.ts`).
- Reward lease lifecycle (queued to sent/uncertain/failed) with env-flag kill switch (`convex/jellyhunt/rewards.ts`).
- Webhook signature verification with current + previous key overlap and event dedup by ID + body hash (`convex/jellyhunt/webhooks.ts`).
- HTTP route registration for `/jellyhunt/webhooks/rewards` and root entrypoints (`convex/http.ts`, `convex/crons.ts`).
- v2 HTTP API layer: typed errors, response envelope, route handler wrapper, and Convex repository (`src/lib/jellyhunt/v2/`).
- 17 Next.js App Router route files under `app/api/v2/jellyhunt/` for campaigns, missions, participations, submissions, leaderboards, and rewards. Campaigns/current and leaderboard routes are fully functional; others are stubs pending earlier Convex modules.
- 41 new tests across approvals (11), leaderboards (5), rewards (15), webhooks (6), and legacy adapter (4). All 60 tests passing.

### Added (Tasks 1-4: Foundation)

- PlatePost-hosted consumer experience branded **PlatePost x JellyJelly: Human Social!** at `/human-social`.
- `/map` redirect to the canonical consumer route.
- Mapbox GL mission map with a coordinate-based fallback for local development and graceful degradation.
- Original Jellyhunt full-screen visual system in local fixture mode: NYC street grid, all 16 legacy status-aware pins, JellyJelly HQ, floating masthead, cross-street chip, zoom/location controls, Dark/Wobbles themes, slide-out menu, and bottom mission drawer. Production renders the active Convex inventory.
- Responsive Passport progress shell, Editorial mission guide, privacy-safe leaderboard contract state, and how-to-play view.
- Mission markers and details with search, category/status filters, geolocation, distance, timezone-aware hours, overnight-hours support, directions, and JellyJelly camera deep links.
- Direct JellyJelly iOS and Android store links with environment overrides.
- Versioned `GET /api/v1/jellyhunt/missions` endpoint.
- Authenticated user-specific mission status via the optional `user_id` query.
- Authenticated `POST /api/v1/jellyhunt/submissions` endpoint with Zod validation.
- Explicit local fixture mode that is unavailable in production.
- Schema-validated and inventoried one-time migration data for the 16 legacy Jellyhunt missions; it still requires human content approval and is not imported by the runtime.
- Guarded legacy importer with dry-run default, explicit `--apply`, existing-slug skips, and hard enforcement of draft/manual records.
- Convex tables and indexes for locations, missions, submissions, reward attempts, and audit events.
- Monotonic mission revisions and immutable submission snapshots for proof terms, place/geofence, approval mode, and reward terms.
- Immutable reward-attempt snapshots so mission edits cannot alter a queued, reconciled, or retried payout.
- Editable mission fields for lifecycle, scheduling, approval mode, restaurant tag, reward, category, difficulty, emoji, neighborhood, price, hours, showtimes, sort order, venue website, and location/geofence data.
- Convex-side validation for IANA timezones, hours/showtimes, geofence limits, reward ceilings, website URLs, schedules, and automatic-mission partner requirements.
- Submission deduplication for exact retries, one non-rejected user/mission completion, and global Jelly-post reuse prevention.
- Internal Convex verification workflow that loads the user, post, mission, restaurant tag, location, and geofence from stored records.
- A 10-second timeout for every outbound Jelly verification and reward call.
- Preferred Jelly partner verification mode and conservative legacy `GET /v3/jelly/<postId>` fallback.
- Manual and automatic approval paths, admin review mutations, rejection reasons, verification retry, and audit events.
- Signed 12-hour HTTP-only admin sessions with SameSite=Strict cookies and same-origin mutation checks.
- Protected admin HTTP routes for mission/location create/read/update, lifecycle controls, submission review, safe retries, and audit history. Operational records are paused or archived rather than deleted.
- Protected admin dashboard with atomic mission/location editing, lifecycle controls, timezone-aware schedule inputs, immutable proof snapshots, claimed/verified GPS and distance, Jelly post links, audit activity, reward exceptions, and logout.
- Explicit uncertain-reward reconciliation that requires either a confirmed Jelly transaction ID or a confirmed failure reason before the state can change.
- Internal reward workflow that derives recipient, post, token, amount, and idempotency key from Convex.
- Preferred idempotent partner reward mode and migration-only legacy `POST /crypto/send` support.
- Scheme-aware legacy reward authentication with a dedicated `JELLY_REWARD_API_TOKEN`, `Token` default, and backward-compatible bearer fallback.
- Reward states for queued, processing, sent, confirmed failed, and uncertain outcomes.
- Safe retry rule that permits retrying only confirmed failed rewards.
- Server-only Convex repository and shared mission-contract mapping.
- Fail-closed Jelly server key and Convex service-key checks.
- Contract, domain, map UI, admin-session/time, authentication, repository, HTTP timeout, Convex validation, workflow-guard, guarded migration, app-link, and Convex security tests.
- Non-interactive ESLint configuration and a `pnpm lint` command that fails on warnings.
- End-to-end architecture design and implementation plan.
- Proposed PlatePost ↔ JellyJelly Native Mission API v2 contract covering signed identity, revision-locked mission participation, campaigns, mission/place detail, place-linked Jelly feeds, durable HTTP idempotency, separate approval/reward states, owner history, budgets/reservation watchdogs, evidence-only partner verification, reward intents with guarded attempts, polling, and signed webhooks.
- Independent API-contract reviews and corrections for personalized cache isolation, privacy-safe dedupe errors, full payout-receipt tuple validation, bidirectional webhook inbox/outbox behavior, legacy v1 state mapping, and a mandatory legacy submission/transaction cutover fence before automatic v2 rewards.
- Complete setup, API, architecture, deployment, ownership, security, migration, and launch documentation.

### Changed

- Made Convex the intended production source of truth for missions and mission-specific locations.
- Removed production dependence on frontend mission constants; static mission data is restricted to explicit non-production fixture mode.
- Defined PlatePost as owner of mission operations, submission state, deduplication, review, reward orchestration, and audit history.
- Defined Jelly as owner of canonical users, Jelly posts, restaurant/location proof, balances, and final tip transactions.
- Kept anonymous mission discovery public while requiring server authentication for user status and all submission writes.
- Normalized duplicate user/mission and reused-post conflicts to stable `409 mission_already_submitted` and `409 jelly_post_reused` responses.
- Standardized the native-facing contract as API version `1.0`.
- Passed a caller-derived current time rounded to the minute into the deterministic public Convex mission query, followed by an exact visibility recheck in Next.js.
- Standardized operating hours as seven Monday-to-Sunday values using `HH:MM-HH:MM` or `closed`.
- Expanded submission states to include verification, manual review, reward processing, failure, and reconciliation.
- Reworked Mapbox into a persistent Jellyhunt-branded map with production HQ/selected-pin treatments, marker diffing, full failure cleanup, and a scrollable mission chooser for dense locations.
- Made camera handoff state-aware, added complete reward-state filtering, preserved Passport stamps through reward reconciliation, and added truthful anonymous Passport/app handoff.
- Added dialog focus trapping, Escape/focus restoration, mobile filter access, Wobbles contrast fixes, reduced-motion handling, and the original Ranchers/Outfit/JetBrains/Quicksand type system.
- Replaced blur-heavy mission finder, detail drawer, and theme-toggle surfaces with stable near-opaque, non-blurred treatments to prevent black compositing regions on mobile and desktop browsers.
- Revalidated the complete mission, including the current reward ceiling and partner-verification requirement, whenever an operator activates it.

### Security

- Verification and reward functions are internal Convex actions; callers provide only a stored submission or reward-attempt ID.
- Reward amount and recipient are never accepted as action arguments from the browser or public API.
- All externally callable non-public Convex queries and mutations require `PLATEPOST_CONVEX_SERVICE_KEY`; scheduled verification/reward functions use Convex internal actions.
- Missing API secrets fail closed instead of disabling authentication.
- Jelly credentials and payout credentials remain Convex server environment variables.
- Ambiguous legacy reward outcomes become `reward_uncertain` and are never automatically retried.
- Verified partner decisions now require trusted coordinates and a non-negative distance that agrees with PlatePost's calculation; missing or inconsistent evidence enters review.
- Credential-bearing Jelly endpoints require HTTPS outside non-production loopback development.
- Rejected proof must be reverified before approval, and sibling checks prevent multiple live or rewarded attempts for one user and mission.
- A two-minute reward-processing watchdog moves abandoned work to reconciliation instead of resending or remaining stuck.
- Raw upstream payout response bodies are discarded; only allowlisted status, transaction ID, and safe error fields are retained.
- Production fixture fallback is disabled.
- The example environment file contains no project deployment, credential, or secret values.
- Development log files are ignored so local paths and preview details are not accidentally committed.

### Known gaps before production

- Visual and discovery-map parity is implemented against the local 16-mission fixture, including the Passport and Editorial Map shells; production still needs live Mapbox/Convex acceptance. Signed personal progress, Jelly Library/post selection, canonical profile data, and live leaderboard standings still require the Jelly identity/progress contract.
- Jelly and PlatePost must decide whether those account/content surfaces remain native-only, become later PlatePost phases, or are retired.
- The 16 legacy missions still require an approved production import; the matching 16-mission local fixture is visual test data only.

- PlatePost Convex developer access is still required for code generation, deployment, seeding, and live workflow validation.
- Jelly and PlatePost must finalize canonical place/content and component-evidence partner contracts; legacy topics/`xdata` remain non-authoritative.
- Jelly must provide the reviewed reward-intent/attempt, lookup, full-tuple receipt, and capacity contracts.
- The protected admin UI must pass live create/edit/publish/review/reward browser acceptance against development Convex.
- Admin login rate limiting, failed-login monitoring, and Vercel WAF/platform protection are not implemented in the application.
- v1 duplicate/reused-post conflicts retain their stable `409` codes; proposed v2 uses generic `submission_conflict` to avoid cross-user disclosure. Remaining v1 business-rule and malformed-JSON errors still need final HTTP normalization.
- The transitional shared Jelly API key must be replaced before direct native-app requests.
- Production Mapbox, Vercel, Convex, and Jelly environment values are not configured in source control.
- Legacy submissions and transactions have not yet been imported/reconciled into the v2 deduplication boundary; production automatic v2 rewards remain blocked.
- No production deployment or real reward test has been completed.
