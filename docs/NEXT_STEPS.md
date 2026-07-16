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

### 4. Agree on the Jelly verification contract

**Owners:** Jelly and PlatePost

The legacy API can read a post and broad topics/`xdata`, but it does not guarantee a restaurant entity or trusted generic post coordinates. Production verification therefore needs a documented Jelly-owned contract.

Minimum request fields from PlatePost:

```json
{
  "submission_id": "platepost-submission-id",
  "mission_id": "platepost-mission-id",
  "user_id": "jelly-user-id",
  "post_id": "jelly-post-id",
  "restaurant_tag": "configured-tag",
  "location": {
    "jelly_restaurant_id": "optional-jelly-location-id",
    "latitude": 40.7163,
    "longitude": -73.9914,
    "geofence_radius_meters": 75
  }
}
```

Minimum response fields from Jelly:

```json
{
  "outcome": "verified",
  "summary": "Authorship, restaurant, and location verified",
  "reason": null,
  "latitude": 40.7164,
  "longitude": -73.9915,
  "distance_meters": 18
}
```

- [ ] Define authentication, timeout, retry, and rate-limit behavior.
- [ ] Define which Jelly field proves authorship.
- [ ] Define restaurant proof and whether a mission tag is server-generated or client-writable.
- [ ] Define trusted location source and precision.
- [ ] Require trusted coordinates plus a non-negative distance for `verified`, and contract-test missing, negative, mismatched, and outside-geofence evidence.
- [ ] Define deleted, private, moderated, edited, or unavailable post behavior.
- [ ] Define stable reason codes and contract tests.
- [ ] Configure `JELLY_PARTNER_VERIFY_URL` and `JELLY_PARTNER_API_KEY` in development Convex; automatic missions remain blocked until both exist.
- [ ] Confirm every credential-bearing partner and legacy endpoint uses HTTPS; allow loopback HTTP only in non-production development.

**Acceptance evidence:** PlatePost fixtures cover verified, author mismatch, restaurant mismatch, missing/negative/mismatched distance, outside geofence, deleted post, rate limit, the implemented 10-second timeout, non-HTTPS configuration, and Jelly outage. A successful legacy response always enters manual review, and incomplete or unavailable proof never pays automatically.

### 5. Agree on an idempotent Jelly reward contract

**Owners:** Jelly and PlatePost

The legacy `POST /crypto/send` endpoint does not document idempotency. That makes blind retries unsafe.

The partner reward endpoint must:

- [ ] Accept a stable `Idempotency-Key`.
- [ ] Return the same transaction for repeated requests with that key.
- [ ] Accept recipient, post, token, amount, and note derived from Convex.
- [ ] Return a canonical Jelly transaction ID.
- [ ] Expose a lookup/reconciliation method by idempotency key.
- [ ] Confirm a worker that remains `processing` for two minutes becomes uncertain and can be reconciled without another send.
- [ ] Document insufficient balance, invalid recipient, rate limit, timeout, and server error behavior.
- [ ] Use a restricted reward account with agreed per-mission and daily limits, plus a PlatePost campaign budget cap.

**Acceptance evidence:** sending the same test reward request twice results in one tip, PlatePost stores one canonical transaction ID and no raw payout body, and a simulated dropped or abandoned worker can be reconciled without sending another reward.

Until that exists, legacy ambiguous responses must stay `reward_uncertain` and require manual Jelly confirmation.

### 6. Normalize API errors and freeze v1

**Owners:** PlatePost with Jelly review

- [ ] Verify the implemented `409 mission_already_submitted` and `409 jelly_post_reused` responses against development Convex.
- [ ] Keep configuration and transport errors at `503`.
- [ ] Add request IDs to error responses and logs.
- [ ] Add route tests for `400`, `401`, `409`, `500`, and `503`.
- [ ] Confirm timestamp, hours, timezone, enum, and optional-field behavior with Kris.
- [ ] Publish an OpenAPI document or shared contract fixtures after v1 review.

**Acceptance evidence:** Jelly's integration tests consume versioned fixtures and do not depend on undocumented fields or error strings.

### 7. Replace the transitional native authentication

**Owners:** Jelly and PlatePost

`JELLYHUNT_API_KEY` is suitable only for server-to-server use.

- [ ] Choose a short-lived Jelly-signed JWT or an authenticated Jelly backend proxy.
- [ ] Include subject/user ID, audience, issuer, expiry, and key ID.
- [ ] Publish a JWKS or agree on secure key rotation.
- [ ] Ensure PlatePost derives `jellyUserId` from the verified token instead of trusting the JSON body.
- [ ] Add replay, wrong-audience, expired-token, and key-rotation tests.

**Acceptance evidence:** no long-lived PlatePost secret ships in the mobile binary, and one user cannot submit on behalf of another.

## Native JellyJelly work

**Owner:** Kris / Jelly engineering

After v1 and auth are frozen:

- [ ] Fetch `GET /api/v1/jellyhunt/missions` instead of hardcoding missions.
- [ ] Render location, category, difficulty, schedule, reward, and status.
- [ ] Open the camera with `mission_id` attached to the Jelly post workflow.
- [ ] Submit the canonical post ID after publish succeeds.
- [ ] Refresh status while verification/review/reward is pending.
- [ ] Show rejection reasons and allow a new post after rejection.
- [ ] Treat `reward_uncertain` as “being reconciled,” not “retry payout.”
- [ ] Support additive v1 fields and a future v2 without crashing.
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
- [ ] Rollback and pause runbooks exercised.
- [ ] Native app release points at the production v1 base URL.
- [ ] PlatePost and Jelly operators monitor the pilot.

## Do not do these

- Do not hardcode production missions in this repository or JellyJelly clients.
- Do not enable `JELLYHUNT_DATA_SOURCE=fixture` in a deployed environment.
- Do not put any server credential in `NEXT_PUBLIC_*`.
- Do not let the browser call private Convex mutations with a shared secret.
- Do not accept reward amount, recipient, or idempotency key from an untrusted caller.
- Do not automatically retry `reward_uncertain`.
- Do not test payouts against production while the partner contract is unsettled.
