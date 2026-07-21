# PlatePost JellyHunt

PlatePost JellyHunt is the mission platform designed for PlatePost to host for JellyJelly. PlatePost will host the consumer map and operations dashboard; namespaced Convex records hold the editable mission catalog and workflow state; Jelly remains authoritative for identity, posts, restaurant/place evidence, trusted post location, balances, and the final `JELLY-MY-JELLY` transfer.

The public experience is branded **PlatePost x JellyJelly: Human Social!** and lives at `/human-social`.

> **Delivery status (2026-07-20):** the application, Convex model, compatibility API, and native v2 routes are merged into `main` in the canonical JellyHunt delivery repository, [`brandonshi10/platepostjelly`](https://github.com/brandonshi10/platepostjelly). The current handoff is GitHub-only and deployment is intentionally paused. This repository is not linked to a Vercel project, PlatePost's shared Convex project has not been changed, and Production has not been touched. Real Jelly mission-token, evidence, place-feed, and at-most-once reward endpoints are still required before production use.

## What is built

- A responsive, full-screen JellyHunt map at `/human-social`; `/map` redirects to it.
- Visual and interaction parity with the current JellyHunt experience: neon NYC map treatment, glowing mission pins and JellyJelly HQ, mission finder, mission drawer, Dark/Wobbles themes, geolocation, distance, hours, directions, Passport, Editorial Map, and JellyJelly camera handoff.
- Mapbox GL when a public Mapbox token is configured, with a coordinate-based local fallback when it is not.
- iOS and Android JellyJelly store links.
- Live current-season and all-time leaderboard tabs backed by the v2 APIs, showing most-approved counts and Jelly usernames with loading, empty, error, and retry states.
- A protected PlatePost admin at `/admin` for creating, editing, scheduling, publishing, pausing, and archiving missions and mission locations without a code release, including optimistic-revision campaign and mission reward caps.
- A review queue and audit trail for verification, approval/rejection, confirmed reward failures, and quarantined uncertain rewards. Uncertain-reward reconciliation intentionally remains a restricted, audited operator decision for the initial release.
- Collision-safe `jellyhunt*` Convex tables for campaigns, places, missions and immutable revisions, participations, submissions, events, idempotency, deduplication, budgets, reward intents/attempts, profiles, approved completions, leaderboards, webhooks, and audit events.
- A contract-guarded v1 read/admin compatibility surface plus a pre-cutover development submission route; Production v1 writes are disabled.
- An implemented native v2 API for mission discovery, locations, participation, submission intake, owner status/history, and current-season/all-time “most approved” leaderboards with Jelly usernames.
- Strict Jelly post preflight and evidence policy, immutable proof/reward snapshots, geofence checks, automatic/manual review routing, pre-payout revalidation, and conservative outage handling.
- Reward dispatch and watchdog workers that are disabled by default, verify full receipts, and never automatically retry an uncertain transfer.
- A local-only 16-mission fixture and guarded legacy migration source. Neither is a production runtime data source.

## Current status

| Area | Repository status | What remains outside the repository |
| --- | --- | --- |
| GitHub handoff | Implementation [PR #3](https://github.com/brandonshi10/platepostjelly/pull/3) and dependency-error [PR #4](https://github.com/brandonshi10/platepostjelly/pull/4) are merged into `main` | PlatePost review and ownership assignment |
| Consumer map and live leaderboards | Implemented and fixture-tested | Live Mapbox + PlatePost development Convex browser acceptance |
| Admin mission/review dashboard | Implemented | Connect to PlatePost development Convex and complete operator acceptance |
| Canonical Convex model/workflows | Implemented under namespaced `jellyhunt*` tables | Merge review against PlatePost's real schema, deployment, configuration, and seed data |
| v1 compatibility API | Reads/admin and pre-cutover write are implemented and contract-guarded; Production write returns `410 Gone` | Live development acceptance and eventual read-retirement plan |
| Native v2 API | Route handlers, contracts, auth verification, reads, writes, status/event history, and leaderboards implemented | Jelly mission-token/JWKS, partner APIs, shared environment, and native app integration |
| Jelly evidence integration | Strict preflight/verification clients and policy implemented; legacy exact-post fallback is conservative | Authoritative Jelly partner endpoints and agreed fixtures |
| Jelly rewards | Intent, lease, receipt validation, pre-payout recheck, watchdog, uncertain-state quarantine, and manual operator reconciliation implemented | At-most-once Jelly service, capacity controls, funded development account, explicit production approval, and optional proof-backed reconciliation automation |
| Deployment | Intentionally paused; no Vercel project was linked or created | PlatePost must explicitly resume deployment and complete every gate in [Next Steps](docs/NEXT_STEPS.md) |

## Ownership boundary

| PlatePost / Convex own | Jelly owns |
| --- | --- |
| Campaign and editable mission configuration | Canonical Jelly user identity and username |
| Reviewed mission place snapshots, coordinates, timezone, hours, and geofence | Canonical restaurant/place IDs and place-linked Jelly content |
| Mission revisions and availability | Jelly posts, authorship, state, visibility, moderation, and deletion |
| Participation, submission intake, idempotency, and deduplication | Trusted post coordinates and evidence provenance |
| Verification outcome, manual review, completion, and resubmission policy | `JELLY-MY-JELLY` balance and recipient-wallet resolution |
| Campaign/mission reward reservations and reward-intent state | The final at-most-once transfer and canonical transaction receipt |
| Current-season/all-time approved-completion rankings | Public-profile eligibility and canonical display username |
| Native-facing APIs, audit, events, and reconciliation state | Partner API availability and rate-limit behavior |

PlatePost stores the reviewed place snapshot needed to run a mission; it does not become the source of truth for Jelly posts, live restaurant content, a user's wallet, or a payout transaction.

This repository does not use Supabase for JellyHunt workflow state. Any legacy Supabase tables shared with other Jelly products must remain untouched until a separately reviewed, JellyHunt-specific migration/cutover is approved.

## Canonical data flow

1. A PlatePost operator creates or edits a mission and place in `/admin`.
2. Convex stores the draft. Publishing creates an immutable mission revision; only active, in-window missions appear on the public map and mission APIs.
3. The PlatePost map, v1 compatibility route, and v2 native routes read the same canonical records. Production clients do not contain mission constants.
4. Jelly issues a short-lived mission token. PlatePost derives the user only from its verified `sub` claim.
5. The app starts a revision-locked participation, publishes a Jelly post, and submits the canonical post ID with an HTTP idempotency key.
6. PlatePost verifies exact post ownership before committing uniqueness/reservation state, then stores the immutable submission snapshot and schedules evidence verification.
7. Jelly supplies component evidence for post state, visibility, moderation, authorship, canonical place, and trusted coordinates. PlatePost calculates the geofence result and owns the approve/reject/review decision.
8. Approval creates one completion, updates both leaderboards, and creates one immutable reward intent.
9. Before any transfer, PlatePost rechecks Jelly evidence. Jelly executes the transfer at most once and returns a receipt that PlatePost validates against the complete immutable tuple.
10. Owner-only status and event APIs let the Jelly app show verification, approval, rejection, reward-pending, reward-sent, reward-failed, and reward-uncertain states without guessing.

Jelly outages or incomplete evidence do not reject a user. Ambiguous payout responses become `uncertain` and are never retried automatically. For the initial release, a restricted PlatePost operator may reconcile that state only after checking Jelly, and every decision is audited; server-verified reconciliation remains a recommended hardening step before automating the workflow.

## Routes

### Pages and v1 compatibility

| Method and route | Audience | Purpose |
| --- | --- | --- |
| `GET /human-social` | Public | Consumer map and mission explorer |
| `GET /map` | Public | Redirect to `/human-social` |
| `GET /admin` | PlatePost operators | Mission management, proof review, reward exceptions, and audit |
| `POST/DELETE /api/v1/jellyhunt/admin/session` | PlatePost operators | Create or clear the signed admin session |
| `GET/POST/PUT/PATCH /api/v1/jellyhunt/admin/missions` | PlatePost operators | List, create, edit, publish/pause/archive missions and places |
| `GET/PATCH /api/v1/jellyhunt/admin/submissions` | PlatePost operators | Review/reverify, retry a confirmed failure, and perform audited manual uncertain-reward reconciliation |
| `GET /api/v1/jellyhunt/admin/audit` | PlatePost operators | Read workflow audit history |
| `GET /api/v1/jellyhunt/missions` | Public or Jelly server | Active catalog; authenticated `user_id` adds compatibility status |
| `POST /api/v1/jellyhunt/submissions` | Jelly server | Pre-cutover/development compatibility intake; intentionally `410 Gone` in Production |

v1 personalized reads and writes are server-to-server only. Never ship `JELLYHUNT_API_KEY` in a mobile app. Production v1 submission writes are intentionally retired with `410 Gone`; new native and Production writes use v2.

### Native API v2

All routes are under `/api/v2/jellyhunt`. The complete executable contract is [OpenAPI 3.1](openapi/jellyhunt-v2.yaml).

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /campaigns/current` | Public; optional bearer | Current campaign and app configuration |
| `GET /missions` | Public; optional bearer | Mission discovery, filters, location summaries, optional viewer state |
| `GET /missions/{missionId}` | Public; optional bearer | Mission, place, schedule, reward, requirements, optional viewer state |
| `GET /missions/{missionId}/jellies` | Public | Jelly posts related to the mission's canonical place |
| `GET /places/{placeId}` | Public | Reviewed place snapshot |
| `GET /places/{placeId}/jellies` | Public | Cursor-paginated Jelly place feed |
| `PUT /missions/{missionId}/participation` | `jellyhunt:submit` | Idempotently start and lock a mission revision |
| `GET /participations/{participationId}` | `jellyhunt:read`, owner only | Participation terms and deadline |
| `POST /missions/{missionId}/submissions` | `jellyhunt:submit` | Idempotent exact-post preflight and submission intake |
| `GET /submissions/{submissionId}` | `jellyhunt:read`, owner only | Current verification, decision, completion, and reward state |
| `GET /submissions/{submissionId}/events` | `jellyhunt:read`, owner only | Paginated submission timeline |
| `GET /me` | `jellyhunt:read` | Current user's JellyHunt summary |
| `GET /me/missions` | `jellyhunt:read` | Paginated mission participation/status history |
| `GET /me/submissions` | `jellyhunt:read` | Paginated submission history |
| `GET /me/events` | `jellyhunt:read` | Paginated cross-submission event stream |
| `GET /leaderboards/current-season` | Public | Most approved missions in the current campaign |
| `GET /leaderboards/all-time` | Public | Most approved missions since this PlatePost tool's launch |

Authenticated v2 routes accept a five-minute Jelly-signed bearer token with audience `platepost-jellyhunt`; they never accept caller-supplied Jelly identity. Submission creation also requires `Idempotency-Key`. Pagination cursors are signed and bound to the resource, viewer, query, and snapshot.

## Local setup

### Prerequisites

- Node.js 18.18+; Node.js 20 LTS is recommended.
- pnpm 9.
- A public Mapbox token for the live renderer.
- PlatePost developer access only when connecting a reviewed development deployment.

### Run the consumer experience locally

```bash
pnpm install
```

Create `.env.local`:

```dotenv
JELLYHUNT_DATA_SOURCE=fixture
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=<public Mapbox token, optional locally>
```

Then:

```bash
pnpm dev
```

Open [http://localhost:3000/human-social](http://localhost:3000/human-social). Fixture mode is rejected when `NODE_ENV=production`.

### Run with Convex

Copy `.env.example` to `.env.local` and use either an isolated local/anonymous Convex deployment or a PlatePost development deployment that has completed the schema-merge checklist in [PlatePost Integration Status](docs/PLATEPOST_INTEGRATION.md).

```bash
pnpm install
pnpm convex
```

Run `pnpm dev` in a second terminal. Although this is the canonical JellyHunt code repository, its full Convex schema has not been merged into PlatePost's shared schema. Do not point it at PlatePost's shared project until a PlatePost engineer has reviewed how `jellyhuntTables` will be merged into the real `convex/schema.ts`. Never use a Production deploy key for local integration.

## Configuration

[`.env.example`](.env.example) is the names-only source of truth. Key groups are:

- **Convex connection:** `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, optional `CONVEX_URL`, and the server-only `PLATEPOST_CONVEX_SERVICE_KEY`.
- **Public map:** `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`. A Vercel credential is not a Mapbox token.
- **Admin:** `JELLYHUNT_ADMIN_USERNAME`, `JELLYHUNT_ADMIN_PASSWORD`, and `JELLYHUNT_ADMIN_SESSION_SECRET`.
- **v1 compatibility:** server-only `JELLYHUNT_API_KEY`.
- **v2 identity/cursors:** `JELLY_MISSION_JWKS_URL`, `JELLY_MISSION_TOKEN_ISSUER`, and `JELLYHUNT_CURSOR_SECRET`.
- **Jelly partner API:** `JELLY_API_BASE_URL`, `JELLY_PARTNER_API_BASE_URL`, `JELLY_PARTNER_PREFLIGHT_URL`, `JELLY_PARTNER_API_KEY`, and bounded timeout.
- **Verification/rewards:** verification scheduling, reward safety flags, webhook secrets, and the maximum mission reward.
- **Legacy fallback/migration:** Jelly legacy and reward tokens. These are not the target production contract.

Variables used by the Next.js server belong in Vercel; variables read by Convex actions belong in the matching Convex deployment. Some partner values are needed in both because submission preflight/place-feed requests run in Next.js while verification and payout workers run in Convex. No secret belongs in a `NEXT_PUBLIC_*` variable.

This standalone JellyHunt app does not use UploadThing, Resend, Manus AI, or Firecrawl. If it is merged into PlatePost's main application, preserve that application's existing service configuration; do not add those credentials solely for JellyHunt. This admin reads the `JELLYHUNT_ADMIN_*` variables, not PlatePost's generic development `ADMIN_USERNAME=test` / `ADMIN_PASSWORD=test` values.

### Reward safety flags

Automatic rewards are off unless `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=true` **and** `JELLYHUNT_ENVIRONMENT_IDENTITY` is explicitly one of `development`, `preview`, or `production`. A missing or misspelled identity fails closed. When identity is `production`, the worker also requires `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=true`. New environments must start with both approval flags false.

`JELLYHUNT_VERIFICATION_AUTORUN_ENABLED` controls verification scheduling only; it does not enable payouts. The reward watchdog moves expired processing leases to `uncertain` and never schedules another transfer.

### Credential incident

A Production Convex deploy key and a Vercel credential were exposed in chat while this project was being built. Treat both as compromised:

- Rotate/revoke them in Convex and Vercel before any use.
- Do not copy either value into `.env.local`, Vercel, Convex, logs, issues, or commits.
- Use named developer access and fresh development credentials for integration.
- Keep Production deployment and reward enablement as reviewed human/CI actions.

No chat-supplied credential is required to run the fixture experience.

## Import the legacy catalog

`migrations/legacy-jellyhunt-missions.json` inventories the 16 legacy JellyHunt stops for migration. It is not loaded by the website or API.

```bash
pnpm migrate:legacy-jellyhunt
pnpm migrate:legacy-jellyhunt --apply
```

The first command is a dry run. Apply only against a reviewed development deployment. Import records as draft/manual, then human-review each address, coordinate, canonical Jelly place ID, restaurant requirement, timezone, hours, geofence, schedule, reward, and budget before publishing.

Legacy submission and transaction history is a separate migration. Production rewards must remain disabled until those records are imported into the same post/user/mission/reward/transaction deduplication boundary.

## Verification

Use one final verification pass after implementation or integration changes:

```bash
pnpm test
pnpm test:contracts
pnpm test:convex
pnpm validate:openapi
pnpm lint
pnpm build
```

A Next.js build does not validate Convex independently. Run the Convex typecheck/code generation gate against an isolated or approved development deployment before release.

## Deployment status and eventual outline

Deployment is intentionally paused. GitHub `main` is the current handoff artifact; do not create or link a Vercel project until a PlatePost owner explicitly resumes deployment. When that happens:

1. Rotate the exposed Convex and Vercel credentials.
2. Identify PlatePost's exact existing Vercel team/project and decide whether this dedicated repository is deployed directly or embedded into the main PlatePost application. Do not create a duplicate project, and review the JellyHunt tables against PlatePost's existing Convex schema before connecting it.
3. Connect a PlatePost development Convex deployment with developer access—not a pasted deploy key.
4. Configure fresh development-only Vercel and Convex environment values with rewards disabled.
5. Deploy a Preview, import reviewed draft missions, and prove that one admin edit appears on `/human-social`, v1, and v2 without a code release.
6. Complete Jelly mission-token, place/evidence, profile, reward, and capacity integrations.
7. Run the complete end-to-end and rollback checklist in [Next Steps](docs/NEXT_STEPS.md).
8. Promote to Production only after security, data migration, budget, payout, and operator approvals.

If a web release fails, roll back Vercel. If mission/workflow state is unsafe, pause affected missions rather than deleting records. Never retry a reward in `uncertain` state until Jelly confirms whether a transfer occurred.

## Handoff

### PlatePost team

The completed code handoff is on GitHub `main`. PlatePost owns the decision to resume deployment, selection of the existing Vercel project, Convex schema merge, environment mapping, mission import/review, admin operation, budget setup, monitoring, and hosting. Start with [Next Steps](docs/NEXT_STEPS.md) and [PlatePost Integration Status](docs/PLATEPOST_INTEGRATION.md).

### Kris / Jelly app

Build against the implemented v2 OpenAPI contract:

1. Obtain a short-lived Jelly mission token.
2. Load campaign and mission/place details; do not hardcode mission data.
3. Start a participation before opening the composer.
4. Publish the Jelly, then submit its canonical post ID once with an idempotency key.
5. Render the server's submission, reward, and event status; never infer payment from approval.
6. Show current-season and all-time approved-completion leaderboards using returned usernames.
7. Treat `uncertain` as support/reconciliation, not as a retry prompt.

Jelly backend engineering must provide the mission-token/JWKS and partner APIs described in [Next Steps](docs/NEXT_STEPS.md). The mobile app must never contain a PlatePost service key, Jelly partner key, reward credential, or caller-controlled reward/identity field.

## Documentation

- [API reference](docs/API.md)
- [OpenAPI 3.1 contract](openapi/jellyhunt-v2.yaml)
- [Architecture](docs/ARCHITECTURE.md)
- [PlatePost integration status](docs/PLATEPOST_INTEGRATION.md)
- [Next steps and launch gates](docs/NEXT_STEPS.md)
- [Changelog](CHANGELOG.md)
- [Native Mission API v2 design](docs/superpowers/specs/2026-07-16-platepost-jelly-native-api-v2-design.md)
