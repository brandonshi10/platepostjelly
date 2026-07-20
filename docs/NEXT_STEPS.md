# Next Steps

Last updated: 2026-07-16

The consumer map and core contracts are in place. The work below is what remains before PlatePost can operate Jellyhunt end to end with real users and rewards.

## Launch blockers, in order

### 1. Secure credentials and access

**Owners:** PlatePost

- [ ] Rotate the Vercel credential that was pasted into chat if it was live.
- [ ] Add the repository to the PlatePost Vercel team.
- [ ] Add Brandon and the implementation engineers as developers on the PlatePost Convex project.
- [ ] Create or select a non-production Convex deployment; do not test against production.
- [ ] Generate independent values for `PLATEPOST_CONVEX_SERVICE_KEY`, `JELLYHUNT_API_KEY`, the admin password, and the admin session secret.
- [ ] Store each value only in the environment that needs it.
- [ ] Run a repository and deployment secret scan before the first push/deploy.

**Acceptance evidence:** the development deployment is reachable, no credential appears in Git history or browser bundles, and the leaked Vercel credential is no longer valid.

### 2. Generate and deploy Convex against PlatePost development

**Owners:** PlatePost

- [ ] Configure `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `PLATEPOST_CONVEX_SERVICE_KEY`.
- [ ] Set `JELLYHUNT_MAX_REWARD_AMOUNT` to the operations-approved per-mission ceiling in the Convex environment.
- [ ] Implement and configure PlatePost-enforced daily and campaign reward-budget caps; reject or hold approvals once either aggregate cap is reached.
- [ ] Run `pnpm convex` to generate bindings and upload the schema/functions.
- [ ] Resolve every Convex generation and TypeScript error.
- [ ] Seed real development locations and missions that reproduce the existing Jellyhunt catalog.
- [ ] Confirm fixture mode is disabled for all Vercel Preview and Production environments.
- [ ] Verify that draft, active, paused, archived, scheduled, and sorted missions behave as expected.

**Acceptance evidence:** editing one mission in Convex changes `/human-social` and `GET /api/v1/jellyhunt/missions` without a new web deployment.

### 3. Finish and validate the protected admin workflow

**Owners:** PlatePost

The server routes and dashboard are implemented locally. Validate each control against the PlatePost development Convex deployment:

- [ ] Admin login/logout using the implemented signed HTTP-only session.
- [ ] Decide whether the shared admin account is acceptable for launch; prefer PlatePost SSO and named roles for production.
- [ ] Add login rate limiting, failed-login monitoring, and Vercel WAF/platform protection before exposing the admin publicly; the app does not implement rate limiting.
- [ ] Location create/edit: Jelly restaurant ID, address, coordinates, timezone, and geofence.
- [ ] Verify the implemented atomic mission+location create and update mutations against development Convex.
- [ ] Verify dashboard schedule inputs round-trip correctly through the location IANA timezone, including daylight-saving transitions.
- [ ] Submit a mission, then edit its restaurant tag, location/geofence, approval mode, title, and reward; prove verification and payout still use the immutable submission/reward snapshots.
- [ ] Confirm the implemented IANA timezone, clock-time, 50-kilometer geofence cap, and server-side maximum reward validation; agree on a lower operational geofence/reward policy if needed.
- [ ] Mission create/edit: title, description, restaurant tag, category, difficulty, emoji, hours, showtimes, schedule, reward, order, and approval mode.
- [ ] Publish, pause, archive, and restore.
- [ ] Submission queue filters and proof summary.
- [ ] Approve with one queued reward or reject with a required reason.
- [ ] Retry verification.
- [ ] Retry only confirmed failed rewards.
- [ ] Verify uncertain rewards have no retry button and can be reconciled only as sent with a confirmed Jelly transaction ID or failed with a documented confirmation reason.
- [ ] Audit history for every mutation.

**Acceptance evidence:** a browser test covers login, mission create/edit/publish, submission approval/rejection, logout, and an unauthenticated request receiving `401`. The browser never sees `PLATEPOST_CONVEX_SERVICE_KEY`.

### 4. Agree on the Jelly evidence and place contract

**Owners:** Jelly and PlatePost

The legacy API can read an exact post plus broad topics/`xdata`, but it does not guarantee a canonical restaurant relation, trusted generic post coordinates, or complete eligibility. Legacy evidence therefore remains manual-review-only.

The production Jelly partner contract must provide:

- [ ] Canonical place detail and cursor-paginated public Jellies linked by a server-owned place relation.
- [ ] Component evidence for exact post, author, readiness, visibility, deletion, moderation, publication time, canonical place, and trusted post location.
- [ ] `evidenceStatus: complete|incomplete|unavailable` and stable evidence reason codes; Jelly does not return PlatePost's approve/reject decision.
- [ ] Provenance and evidence timestamps for each component.
- [ ] Authentication, HTTPS-only production transport, timeout, retry, and rate-limit behavior.
- [ ] Exact `POST /partner/v1/jellyhunt/posts/{postId}/preflight` ownership metadata, including canonical owner, eligible participants, post type, duration, state, visibility, moderation, deletion, and canonical place, before PlatePost creates a uniqueness claim or reward reservation.
- [ ] The retry/review/rejection matrix from the [Native Mission API v2 design](superpowers/specs/2026-07-16-platepost-jelly-native-api-v2-design.md), including delayed/not-ready posts and Jelly outages.
- [ ] A pre-payout eligibility recheck for deletion, moderation, visibility, author, and place changes.
- [ ] Contract fixtures for positive evidence, author/place mismatch, missing/untrusted/negative/outside-geofence location, deleted/private/moderated post, propagation delay, rate limit, and outage.
- [ ] Confirmation that generic topics or client-writable `xdata` can never prove restaurant/place membership.

Configure the partner URLs and restricted credential in development Convex only after the schema is approved. Automatic missions remain blocked until all required Jelly evidence is authoritative.

**Acceptance evidence:** Jelly and PlatePost consume the same versioned fixtures. Missing or unavailable required evidence cannot be approved, Jelly downtime does not reject a user, and a post-ID squatting attempt creates neither a reservation nor a permanent uniqueness claim.

### 5. Agree on Jelly reward intents and guarded payout attempts

**Owners:** Jelly and PlatePost

The legacy `POST /crypto/send` endpoint does not enforce request-body idempotency. That makes blind retries unsafe and limits it to a manual development pilot.

The production Jelly partner contract must:

- [ ] Create one immutable reward intent per approved PlatePost submission.
- [ ] Accept versioned attempt keys such as `reward:<rewardIntentId>:attempt:<N>`.
- [ ] Guarantee at most one successful transfer across every attempt for a reward intent.
- [ ] Replay the same attempt result for the same key/payload and reject key/payload mismatches.
- [ ] Permit attempt `N+1` only after lookup says attempt `N` is final with `confirmedNoTransfer: true`.
- [ ] Expose reward-intent lookup with accepted, pending, sent, failed, and confirmed-absence behavior.
- [ ] Return and let PlatePost verify the full immutable tuple: reward intent, submission, mission, Jelly post, recipient, amount, token, and canonical transaction ID.
- [ ] Resolve the recipient wallet from the Jelly user; PlatePost never supplies a wallet address.
- [ ] Expose a restricted reward-account capacity endpoint with token precision, available amount, transaction ceiling, and daily remaining amount.
- [ ] Document invalid/ineligible recipient, unsupported token, invalid precision/amount, insufficient funds, rate limit with `Retry-After`, dependency failure, timeout, and chain-finality behavior.
- [ ] Default reward visibility to private; public rewards require campaign policy and auditable participant consent.
- [ ] Atomically revalidate the post/recipient/immutable payout guard inside every transfer-capable Jelly attempt, including retries; guard failure must confirm no transfer.
- [ ] Treat amounts as human-token decimal strings, use the authoritative 6 decimals for `JELLY-MY-JELLY`, and never use binary floating point.
- [ ] Prove a dropped response, timeout, retry, and failed first attempt cannot create a duplicate transfer.

**Acceptance evidence:** one logical test reward with multiple replays/guarded attempts produces at most one transfer, a sent receipt matches the full immutable tuple, and PlatePost stores one canonical transaction ID without raw payout bodies.

Until that contract exists, legacy ambiguous responses stay `reward_uncertain` and require manual Jelly confirmation.

- [ ] Correct the transitional legacy adapter to treat `/crypto/send` `transaction_hash` as the canonical receipt; keep integer `transaction_id` only as an optional legacy ledger reference.
- [ ] Remove any claim that a body `idempotency_key` makes legacy `/crypto/send` idempotent; the endpoint ignores it.
- [ ] Confirm the development funding wallet is intentionally managed and not migrated to crypto v2. A migrated v1 wallet returns `409`, and the interactive v2 PIN/signature/nonce flow is not a PlatePost service payout API.

### 6. Normalize API errors, preserve v1, and approve v2

**Owners:** PlatePost with Jelly review

- [ ] Freeze executable v1 success/error fixtures, including `409 mission_already_submitted` and `409 jelly_post_reused`, before storage changes.
- [ ] Make v2 return privacy-safe `409 submission_conflict` for global post/attempt uniqueness conflicts.
- [ ] Backfill and test the exact v1-to-v2 submission/reward status mapping; route both versions through shared Convex mutations.
- [ ] Keep configuration and transport errors at `503`.
- [ ] Add request IDs to error responses and logs.
- [ ] Add route tests for `400`, `401`, `404`, `409`, `422`, `429`, `500`, and `503`.
- [ ] Preserve v1 response shapes and statuses while it remains the compatibility surface.
- [ ] Review and approve the [Native Mission API v2 design](superpowers/specs/2026-07-16-platepost-jelly-native-api-v2-design.md) with Kris, PlatePost, and Jelly backend engineering.
- [ ] Publish OpenAPI 3.1 and shared v2 success/error/webhook fixtures only after design approval.

**Acceptance evidence:** Jelly's integration tests consume versioned fixtures and do not depend on undocumented fields or error strings.

### 7. Implement the dedicated Jelly mission token

**Owners:** Jelly and PlatePost

`JELLYHUNT_API_KEY` is suitable only for server-to-server use. The proposed v2 target is a five-minute asymmetrically signed Jelly token with audience `platepost-jellyhunt`.

- [ ] Add Jelly `POST /auth/mission-token` for an authenticated active Jelly session.
- [ ] Include subject/user ID, `iss`, `aud`, scope, issue/expiry, session ID, unique token ID, and `kid`.
- [ ] Publish a rotating Jelly JWKS and validate signature, issuer, audience, expiry, scope, and subject in PlatePost.
- [ ] Ensure PlatePost derives the Jelly user exclusively from verified `sub`; remove caller-supplied identity from v2.
- [ ] Add wrong-audience, wrong-issuer, insufficient-scope, expired-token, subject-spoof, logout, and key-rotation tests.

**Acceptance evidence:** no long-lived PlatePost secret ships in the mobile binary, and one user cannot submit or read status on behalf of another.

## Native JellyJelly work

**Owner:** Kris / Jelly engineering

After the v2 contract and mission-token authentication are frozen:

- [ ] Fetch `GET /api/v2/jellyhunt/campaigns/current` and `/missions` instead of hardcoding campaign or mission data.
- [ ] Render mission detail, place/hours, category, difficulty, schedule, reward, availability, and viewer status.
- [ ] Use the PlatePost HTTPS universal start link, then call `PUT /missions/{missionId}/participation` with the displayed mission revision and pass the returned participation ID, locked revision, deadline, and canonical Jelly place ID into the Jelly composer.
- [ ] Submit the participation ID, locked revision, and canonical post ID to `POST /missions/{missionId}/submissions` with a client idempotency key after publish succeeds.
- [ ] Read `/submissions/{id}` and `/me/events` while verification, review, or reward work is pending.
- [ ] Show safe rejection reasons and allow a new post only when `canResubmit` is true.
- [ ] Display approved/reward-pending separately from confirmed `reward_sent`; treat `uncertain` as reconciliation, never a client retry.
- [ ] Render place-linked Jelly content from the normalized PlatePost endpoint without persisting signed media URLs.
- [ ] Add analytics for map opened, mission viewed, Jelly started, submitted, approved, rejected, and rewarded without logging secrets or precise location unnecessarily.

**Acceptance evidence:** a development user completes a mission in the native app, sees the same mission state as the PlatePost admin, and receives exactly one development reward.

## Product parity decisions

**Owners:** Jelly product and PlatePost

The original full-screen map visual system, Passport shell, and Editorial mission guide are recreated. Decide the disposition of the remaining identity-dependent surfaces before calling the entire old page replaced:

- [ ] Decide whether the Jelly Library picker belongs in the native posting flow only or needs a PlatePost web equivalent.
- [ ] Decide whether embedded Jelly web authentication is retired in favor of native SSO/deep-link handoff.
- [ ] Connect the shipped Passport shell to signed Jelly user status, and decide whether canonical profile editing remains native-only.
- [x] Ship a PlatePost Editorial Map mission guide over the same Convex/API records as the map.
- [ ] Finalize the live leaderboard contract. The shipped page remains privacy-safe and displays no invented standings until signed/aggregate data is available.
- [ ] Document redirects and retirement timing for jellyjelly.com/jellyhunt after the PlatePost pilot.

**Acceptance evidence:** the launch brief names every legacy feature as shipped, native-only, later phase, or retired; no stakeholder assumes it is hidden in the current consumer map.

## Existing Jellyhunt migration

Production Convex starts empty. The local-only fixture mirrors all 16 schema-validated and inventoried legacy stops for visual acceptance, but it is not a production seed and cannot run in production.

**Owners:** PlatePost and Jelly content/operations

- [x] Inventory all 16 missions currently hardcoded on jellyjelly.com/jellyhunt.
- [ ] Review the checked-in 16-record migration catalog, run `pnpm migrate:legacy-jellyhunt` as a dry run against development, then run `pnpm migrate:legacy-jellyhunt --apply` only after approval.
- [ ] Assign a PlatePost location, coordinates, timezone, geofence, restaurant tag, category, hours, reward, approval mode, and sort order.
- [ ] Resolve locations that the legacy API cannot map to a canonical Jelly restaurant.
- [ ] Import as drafts first.
- [ ] Confirm the importer skipped existing slugs, created only missing `draft`/`manual` records, and performed no publish or reward action.
- [ ] Human-review addresses, coordinates, provisional restaurant tags, 75-meter geofences, New York timezone assumptions, opening hours, copy, schedules, and reward amounts before activation.
- [ ] Have operations review copy, coordinates, schedules, and reward amounts.
- [ ] Publish a small pilot set before the full catalog.
- [ ] Remove or redirect the legacy hardcoded mission source after PlatePost is proven.

**Acceptance evidence:** the PlatePost mission count and reviewed field values match the migration sheet, and Jelly clients contain no production mission constants.

## Legacy submission and reward cutover

**Owners:** PlatePost, Jelly backend, and operations

Production v2 rewards must remain disabled until legacy completions share the same deduplication boundary.

- [ ] Inventory every legacy JellyHunt submission writer and payout worker.
- [ ] Map legacy mission identifiers to stable PlatePost mission IDs, prepare shared dedupe import tooling, and choose a UTC cutover watermark.
- [ ] At the watermark, atomically stop every legacy submission write and pause every legacy payout worker before export.
- [ ] Drain in-flight work and manually reconcile every pending or uncertain `/crypto/send` result.
- [ ] Export the stable snapshot and import exact Jelly post ID, Jelly subject, mission, status, amount/token, transaction ID/hash, and timestamps as `source: legacy`.
- [ ] Populate the same v2 global post, user/mission, reward-intent, and transaction uniqueness indexes; imported records are never re-paid.
- [ ] Reconcile counts and hashes and require zero orphan successful transactions.
- [ ] Keep production v1 writes disabled. Any temporary backend fallback must call v2 with a derived/verified Jelly subject; caller-controlled identity never reaches rewards.
- [ ] Remove every independent payout path and keep production automatic rewards off until the signed cutover report passes.

**Acceptance evidence:** a legacy post, user/mission completion, or transaction cannot be submitted or paid again through v2, and no post-watermark write bypasses PlatePost deduplication.

## Map, accessibility, and browser acceptance

**Owners:** PlatePost

- [ ] Supply a valid public Mapbox token; the Vercel token is not a map token.
- [ ] Test desktop and mobile layouts on current Chrome, Safari, and Firefox.
- [ ] Capture side-by-side desktop and mobile screenshots against `jellyjelly.com/jellyhunt` using both the local fallback and a real Mapbox token; approve all intentional differences.
- [ ] Verify that opening and closing the mission finder and mission drawer, and switching Dark/Wobbles themes, never produces black compositing rectangles on desktop or mobile, with both the fallback map and live Mapbox.
- [ ] Test keyboard navigation, visible focus, screen-reader labels, reduced motion, and color contrast.
- [ ] Test marker selection, search, category/status filters, geolocation success/denial, directions, camera deep link, and both app-store links.
- [ ] Test empty, no-results, missing-token, Convex-down, and slow-network states.
- [ ] Confirm mission coordinates and timezone behavior outside New York if the program expands.

**Acceptance evidence:** the public map works on target devices and a no-token or geolocation-denied user can still discover and open mission details.

## Operations and observability

**Owners:** PlatePost and Jelly

- [ ] Define PlatePost and Jelly on-call contacts.
- [ ] Alert on verification error rate, review queue age, failed rewards, uncertain rewards, and reward spend.
- [ ] Add a reconciliation view or report for `reward_uncertain`.
- [ ] Add an emergency “pause all active missions” runbook.
- [ ] Define audit-log, precise-location, and Jelly ID retention.
- [ ] Define who may approve rewards and whether high-value missions require a second reviewer.
- [ ] Back up/export critical mission and payout records according to PlatePost policy.
- [ ] Write support copy for rejected, delayed, failed, and uncertain rewards.

**Acceptance evidence:** a named operator can diagnose a test failure from request/audit IDs, pause a mission, reconcile a reward, and document the outcome.

## Deployment and go-live checklist

### Preview

- [ ] All unit tests pass.
- [ ] `pnpm lint` passes with zero warnings.
- [ ] `pnpm build` passes.
- [ ] Convex generation/typecheck passes.
- [ ] Preview uses development Convex and development Jelly credentials.
- [ ] No fixture source is enabled.
- [ ] Admin edit-to-map/API passes.
- [ ] Submission-to-verification passes.
- [ ] Manual review-to-one-reward passes.
- [ ] Automatic verified-to-one-reward passes.
- [ ] A rejected older attempt cannot be approved or reverified after a newer attempt becomes live.
- [ ] Ambiguous legacy reward becomes `reward_uncertain`.
- [ ] A stale reward-processing lease becomes `reward_uncertain` without another payout call.

### Production

- [ ] Security and privacy review completed.
- [ ] Production partner contracts approved.
- [ ] Production Mapbox token configured.
- [ ] Production Convex environment configured without copied development secrets.
- [ ] Point the importer at Production only after approval, confirm the printed Convex origin, dry-run, then explicitly apply; verify all imported records remain draft/manual.
- [ ] Initial missions reviewed and published.
- [ ] Lower the configured reward ceiling below a draft reward and verify activation fails closed.
- [ ] Per-mission, daily, and campaign reward limits plus available balance confirmed.
- [ ] Legacy submission/transaction cutover report approved and all independent legacy payout workers disabled before automatic v2 rewards.
- [ ] Rollback and pause runbooks exercised.
- [ ] Native app release points at the approved production v2 base URL; v1 remains compatibility-only and no secret API key ships in the app.
- [ ] PlatePost and Jelly operators monitor the pilot.

## Do not do these

- Do not hardcode production missions in this repository or JellyJelly clients.
- Do not enable `JELLYHUNT_DATA_SOURCE=fixture` in a deployed environment.
- Do not put any server credential in `NEXT_PUBLIC_*`.
- Do not let the browser call private Convex mutations with a shared secret.
- Do not accept reward amount, recipient, or idempotency key from an untrusted caller.
- Do not automatically retry `reward_uncertain`.
- Do not test payouts against production while the partner contract is unsettled.
