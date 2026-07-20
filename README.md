# PlatePost Jellyhunt

PlatePost Jellyhunt is designed to become the operational home for Jellyhunt missions. In the target deployment, PlatePost will host the consumer map and admin experience, while Convex will store editable missions, locations, submissions, deduplication records, review state, reward attempts, and audit history. Jelly remains the source of truth for people, Jelly posts, restaurant and location proof, balances, and the final Jelly-My-Jelly tip.

The public experience is branded **PlatePost x JellyJelly: Human Social!**

## What is in this repository

- A full-screen consumer mission map at `/human-social`; `/map` redirects there. Its street grid, pin language, masthead, slide-out navigation, theme toggle, mission drawer, Passport shell, and Editorial Map follow the original Jellyhunt experience.
- A persistent, Jellyhunt-styled Mapbox renderer when a public token is configured, plus the matching coordinate-based fallback when it is not. Filtering updates markers without rebuilding the map.
- Search, category and completion-state filters, browser geolocation, distance, hours, mission details, JellyJelly camera deep links, and direct iOS/Android store links.
- A versioned mission API for the JellyJelly app.
- An authenticated submission API for Jelly-to-PlatePost calls.
- A protected admin dashboard for atomic mission/location edits, timezone-aware schedules, immutable proof review, approval/rejection, reward retry/reconciliation, and audit history.
- Convex schemas and workflow functions for locations, missions, submissions, deduplication, verification, admin review, reward attempts, and audit events.
- Mission revision numbers plus immutable submission and reward snapshots, so later admin edits cannot change the proof or payout terms for an existing attempt.
- A 10-second timeout around every outbound Jelly verification and reward request, with conservative review/reconciliation states.
- A local-only 16-mission fixture source for visual and interaction testing without PlatePost Convex access.
- Contract, map-domain/UI, admin-session/time, authentication, repository, HTTP timeout, Convex validation, workflow-guard, guarded migration, app-link, and Convex security tests.

## System boundary

| PlatePost and Convex own | Jelly owns |
| --- | --- |
| Mission and location configuration | Canonical Jelly user identity |
| Publishing, pausing, scheduling, and map ordering | Jelly posts and authorship |
| Submission intake and state | Restaurant tag or topic proof |
| One non-rejected submission per user/mission | Trusted post geolocation proof |
| Prevention of Jelly-post reuse | Jelly-My-Jelly balances |
| Admin review and rejection reasons | Final tip transaction and transaction ID |
| Reward-attempt state and reconciliation | Partner or legacy API behavior |
| Native-facing Jellyhunt API and audit history | |

Mission content must not be embedded in the PlatePost production frontend or JellyJelly clients. Published mission records come from Convex. Static catalog data in this repository is limited to a local-only 16-mission visual fixture and the guarded 16-record migration input. Fixture mode is disabled in production; published production records are loaded only from Convex.

## Current implementation status

| Area | Status |
| --- | --- |
| Consumer map and responsive mission explorer | Implemented and fixture-verified; needs live Mapbox/Convex acceptance |
| Public mission API and authenticated user status | Implemented |
| Authenticated submission intake | Implemented |
| Native Mission API v2 contract | Proposed and ready for PlatePost/Jelly engineering review; not implemented yet |
| Convex mission/location schema and workflow state | Implemented; needs deployment against the PlatePost development project |
| Jelly verification and reward integration | Adapter code exists; production partner contracts and credentials are still required |
| Signed admin session and private admin APIs | Implemented |
| Admin mission and review dashboard | Implemented locally; needs live Convex and browser acceptance |
| Production deployment | Not completed |

See [Next steps](docs/NEXT_STEPS.md) for the exact launch blockers.

## Jellyhunt parity and scope

In local fixture mode, the PlatePost page recreates the original Jellyhunt map hierarchy and visual language with all 16 legacy pins: a full-screen branded NYC street map, JellyJelly HQ, floating masthead, nearest-cross-street chip, zoom/location controls, Dark and Wobbles themes, slide-out navigation, bottom mission drawer, search/filtering and a scrollable mission chooser, geolocation and distance, hours, directions, JellyJelly camera handoff, Passport, Editorial mission guide, and app-store links. The same UI renders the active mission inventory returned by Convex in production; production does not use the fixture catalog.

The public page remains anonymous until Jelly and PlatePost connect signed identity. Anonymous visitors see an app handoff instead of false Passport progress; the personalized Passport renders only when authenticated user status is supplied by the server contract. The Editorial Map remains public. The live leaderboard intentionally shows a contract-required state rather than invented player data. Jelly web authentication, the Jelly Library picker/post selection, canonical profiles, and live standings remain Jelly/PlatePost integration work; completing a mission currently hands off to JellyJelly.

The local fixture mirrors all 16 legacy stops for visual acceptance only. Production parity still depends on human-reviewing the migration catalog, importing it into development Convex as draft/manual records, and explicitly activating approved missions.

## Local setup

### Prerequisites

- Node.js 18.18 or newer; Node.js 20 LTS is recommended.
- pnpm 9.
- A Convex account and developer access to the PlatePost Convex project for real-data development.
- A public Mapbox token for the production-style map.

### Install and run with fixtures

This is the fastest way to inspect the consumer experience without external credentials. The non-production fixture mirrors all 16 legacy missions so map density and interactions can be compared directly; production Convex still starts empty and must be populated through the guarded, human-reviewed migration.

```bash
pnpm install
```

Create `.env.local`:

```dotenv
JELLYHUNT_DATA_SOURCE=fixture
```

Then run:

```bash
pnpm dev
```

Open [http://localhost:3000/human-social](http://localhost:3000/human-social). Fixture mode is intentionally disabled when `NODE_ENV=production`.

### Run with a PlatePost Convex development deployment

Copy `.env.example` to `.env.local`, then fill in development values:

```bash
pnpm install
pnpm convex
```

In a second terminal:

```bash
pnpm dev
```

`pnpm convex` runs `convex dev`, generates the local Convex client bindings, and synchronizes functions with the selected development deployment. Do not point local work at production.

If TypeScript reports that `convex/_generated/*` is missing, the checkout has not been generated against a Convex deployment yet. Run `pnpm convex` after PlatePost grants project access; those bindings cannot be validated against the team deployment offline.

For the Next.js server, configure:

- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_URL` when a separate server-only Convex URL is desired
- `PLATEPOST_CONVEX_SERVICE_KEY`
- `JELLYHUNT_API_KEY`
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
- `JELLYHUNT_ADMIN_USERNAME`, `JELLYHUNT_ADMIN_PASSWORD`, and `JELLYHUNT_ADMIN_SESSION_SECRET`

In the matching Convex deployment, configure:

- `PLATEPOST_CONVEX_SERVICE_KEY` with the same value used by the Next.js server
- Jelly verification and reward credentials described in [Environment variables](#environment-variables)

Never expose a Convex service key, Jelly credential, admin password, or reward credential through a `NEXT_PUBLIC_*` variable.

### Import the legacy Jellyhunt catalog

The repository includes a one-time migration catalog at `migrations/legacy-jellyhunt-missions.json` and a guarded importer. The JSON is source material for Convex only; the website and API never load it at runtime.

Point `CONVEX_URL` and `PLATEPOST_CONVEX_SERVICE_KEY` at the PlatePost **development** deployment, then preview the plan:

```bash
pnpm migrate:legacy-jellyhunt
```

After reviewing the dry-run output, apply missing drafts explicitly:

```bash
pnpm migrate:legacy-jellyhunt --apply
```

The importer prints the target Convex origin, requires exactly 16 records, refuses any record that is not `draft` and `manual`, skips existing slugs without changing them, and calls the atomic mission/location mutation. It cannot publish a mission or initiate a reward. Addresses, coordinates, restaurant tags, the provisional 75-meter geofences, New York timezone assumptions, opening hours, copy, schedules, and reward amounts still require human approval before activation.

## Environment variables

The checked-in [`.env.example`](.env.example) contains names only and no secrets.

### Next.js / Vercel

| Variable | Required | Purpose |
| --- | --- | --- |
| `CONVEX_DEPLOYMENT` | For Convex CLI | Development deployment selector. |
| `NEXT_PUBLIC_CONVEX_URL` | For Convex data | Public Convex deployment URL used by the app tooling. |
| `CONVEX_URL` | Optional | Server-only override for Convex calls. |
| `PLATEPOST_CONVEX_SERVICE_KEY` | Yes for private operations | Shared server-to-Convex credential. Must also exist in Convex. |
| `JELLYHUNT_API_KEY` | Yes for Jelly integration | Transitional server key required by user-specific reads and submission writes. |
| `JELLYHUNT_DATA_SOURCE` | Local development only | Set to `fixture` only for local UI work; use `convex` or leave unset in deployed environments. |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Yes for production map | Public Mapbox browser token. |
| `JELLYHUNT_ADMIN_USERNAME` | For protected admin | Admin login username. |
| `JELLYHUNT_ADMIN_PASSWORD` | For protected admin | Admin login password. |
| `JELLYHUNT_ADMIN_SESSION_SECRET` | For protected admin | Long random value used to sign HTTP-only sessions. |
| `NEXT_PUBLIC_JELLY_IOS_APP_URL` | Optional | Override the direct JellyJelly App Store URL. |
| `NEXT_PUBLIC_JELLY_ANDROID_APP_URL` | Optional | Override the direct JellyJelly Play Store URL. |

### Convex

| Variable | Required | Purpose |
| --- | --- | --- |
| `PLATEPOST_CONVEX_SERVICE_KEY` | Yes | Authenticates server-only Next.js calls to private Convex functions. |
| `JELLY_API_BASE_URL` | Recommended | HTTPS base URL for the approved Jelly API environment; defaults to `https://api.jellyjelly.com`. Loopback HTTP is allowed only outside production. |
| `JELLYHUNT_MAX_REWARD_AMOUNT` | Recommended | Server-side mission reward ceiling; defaults to `10000`. Full mission saves and activation both revalidate the current ceiling. |
| `JELLY_PARTNER_VERIFY_URL` | Preferred | HTTPS URL for the production partner verification endpoint. |
| `JELLY_PARTNER_REWARD_URL` | Preferred | HTTPS URL for the idempotent production reward endpoint. |
| `JELLY_PARTNER_API_KEY` | Preferred | Server credential for the partner endpoints. |
| `JELLY_LEGACY_API_TOKEN` | Migration only | Token used to read legacy Jelly posts; also a fallback reward credential. |
| `JELLY_REWARD_API_TOKEN` | Migration only | Preferred dedicated legacy `/crypto/send` credential. |
| `JELLY_REWARD_AUTH_SCHEME` | Optional | `Token` or `Bearer`; defaults to `Token` for API/legacy tokens. |
| `JELLY_REWARD_BEARER_TOKEN` | Compatibility only | Older bearer-token fallback. Prefer `JELLY_REWARD_API_TOKEN`. |


PlatePost currently enforces the per-mission reward ceiling above, but it does **not** yet enforce aggregate daily or campaign spend caps. Those controls are an explicit launch blocker in [Next steps](docs/NEXT_STEPS.md).

This standalone Jellyhunt repository does not currently use UploadThing, Resend, Manus AI, or Firecrawl. Those services remain requirements of the main PlatePost application only if this code is merged there. The main PlatePost `ADMIN_USERNAME`/`ADMIN_PASSWORD` variables are also not read here; Jellyhunt uses the three `JELLYHUNT_ADMIN_*` variables above, and deployed credentials must not use the development value `test`.

The previously shared `vck_...` value is a Vercel credential, not a Mapbox token. It must not be committed or placed in a browser-visible variable. Rotate it if it was live.

## Routes

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Internal overview | Project boundary and links. |
| `/human-social` | Public | Consumer mission map. |
| `/map` | Public | Redirect to the canonical consumer map. |
| `/admin` | PlatePost operators | Mission and review operations; production use requires protected server-backed controls. |
| `POST/DELETE /api/v1/jellyhunt/admin/session` | PlatePost operators | Create or clear the signed admin session. |
| `GET/POST/PUT/PATCH /api/v1/jellyhunt/admin/missions` | PlatePost operators | List, create, fully edit, and change lifecycle state. |
| `GET/PATCH /api/v1/jellyhunt/admin/submissions` | PlatePost operators | Review, reject, reverify, reconcile uncertain outcomes, and safely retry confirmed reward failures. |
| `GET /api/v1/jellyhunt/admin/audit` | PlatePost operators | Read workflow audit history. |
| `GET /api/v1/jellyhunt/missions` | Public or Jelly server | Active missions; authenticated `user_id` requests also receive user status. |
| `POST /api/v1/jellyhunt/submissions` | Jelly server | Validate and create a mission submission. |

The complete contract, examples, status values, and error behavior are in [API reference](docs/API.md).

## Data and workflow

1. A PlatePost operator creates a location and mission in the admin.
2. Convex stores the mission and publishes active, in-window records.
3. The PlatePost map and JellyJelly native app read the same mission contract.
4. Jelly sends `missionId`, canonical `jellyUserId`, `jellyPostId`, and optional claimed coordinates to PlatePost.
5. Convex checks mission availability, blocks post reuse, enforces one non-rejected user/mission submission, and snapshots the mission revision, proof requirements, location/geofence, and reward.
6. An internal Convex action asks Jelly to verify authorship, restaurant proof, and trusted location proof against that immutable snapshot. A verified partner result must include trusted coordinates and a non-negative distance that agrees with PlatePost's calculation.
7. Manual missions enter review; automatic missions may advance only after complete partner verification. Missing or inconsistent location proof enters review, outside-geofence proof is rejected, and rejected proof must be reverified before approval.
8. Approval rechecks sibling attempts, creates one reward attempt with copied snapshot terms, and calls Jelly to execute the tip. A two-minute processing watchdog moves abandoned work to reconciliation instead of retrying it.
9. PlatePost stores only the allowlisted result, transaction ID, and safe error summary, then writes an audit event; arbitrary payout response bodies are discarded.

The reward amount, recipient, post, and idempotency key are loaded from Convex by the internal workflow. They must never be accepted from a public reward request.

## Testing

```bash
pnpm test
pnpm lint
pnpm build
```

Unit tests and `pnpm build` validate the Next.js application and HTTP routes. The web TypeScript configuration intentionally excludes `convex`, so a successful Next.js build does **not** validate Convex functions; `pnpm convex` is a separate required gate.

Convex generation and deployment additionally require PlatePost access:

```bash
pnpm convex
```

Before production, also run the end-to-end checks in [Next steps](docs/NEXT_STEPS.md), including an admin edit appearing on both the public map and the API without a code deployment.

## Deployment

### Convex

1. Obtain developer access to the PlatePost Convex project.
2. Select a non-production deployment for validation.
3. Add the Convex environment variables listed above.
4. Run `pnpm convex` and resolve all generation or type errors.
5. Dry-run and explicitly apply the guarded 16-record legacy importer, then review every draft location, coordinate, proof tag, schedule, and reward.
6. Exercise submission, verification, review, reward, and audit state with test Jelly accounts.
7. Deploy to production only after the reward contract and reconciliation policy are approved.

### Vercel / PlatePost

1. Import this repository into the PlatePost Vercel team.
2. Set the Next.js environment variables separately for Preview and Production.
3. Keep `JELLYHUNT_DATA_SOURCE` unset or `convex`; never enable fixture mode.
4. Add the production domain and verify `/human-social`, the API, and protected admin behavior.
5. Promote only after the acceptance checklist passes.

Rollback the Vercel deployment first if a web release fails. For data or workflow issues, pause affected missions in Convex rather than deleting records, and do not retry rewards marked `uncertain` until Jelly confirms the transaction outcome.

## Native JellyJelly handoff

v1's anonymous mission catalog may be read publicly, but personalized v1 reads and all v1 writes remain transitional server-to-server surfaces. A mobile app must not ship `JELLYHUNT_API_KEY`, trust caller-supplied user IDs, or treat approval as proof of payment.

The proposed v2 contract gives Kris revision-locked mission start, config/detail, place-linked Jelly content, signed user identity, idempotent submission creation, owner-only paginated status history, separate approval and reward state, polling events, and signed backend webhooks. Jelly must also provide the mission token, canonical place/evidence APIs, and at-most-once reward-intent contract. Legacy post and transaction history must enter the same deduplication boundary before direct-native production rewards.

## Documentation

- [API reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Next steps and launch gates](docs/NEXT_STEPS.md)
- [Changelog](CHANGELOG.md)
- [End-to-end design](docs/superpowers/specs/2026-07-15-jellyhunt-end-to-end-design.md)
- [Native Mission API v2 design](docs/superpowers/specs/2026-07-16-platepost-jelly-native-api-v2-design.md)
- [Implementation plan](docs/superpowers/plans/2026-07-15-platepost-jellyhunt.md)
