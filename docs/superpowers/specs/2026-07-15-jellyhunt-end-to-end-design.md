# Jellyhunt End-to-End PlatePost Design

## Goal

Recreate the working Jellyhunt mission-map flow on PlatePost while moving operational ownership out of the JellyJelly website. PlatePost and Convex own editable missions, map locations, submissions, deduplication, review state, reward attempts, and audit history. Jelly remains the source of truth for Jelly users, Jelly posts, restaurant proof, post-location proof, and the final tip transaction.

The public page is branded **PlatePost x JellyJelly: Human Social!** and works as a standalone consumer map. The same PlatePost API supplies the future native JellyJelly map.

## Product Boundary

### PlatePost owns

- Mission and location creation, editing, scheduling, publishing, pausing, and archiving.
- Map presentation and anonymous mission discovery.
- Submission intake, one-reward-per-user/mission enforcement, post reuse prevention, and state transitions.
- Admin review, rejection reasons, reward orchestration, retries, and audit logs.
- The versioned API contract consumed by the JellyJelly native app.

### Jelly owns

- User authentication and canonical Jelly user IDs.
- Jelly post/video records, authorship, restaurant tags/topics, and trusted post geolocation.
- Jelly-My-Jelly balances and the final tip transaction.
- A partner verification/reward contract or, during migration, authenticated legacy API access.

## Public Map

`/human-social` is the canonical PlatePost-hosted map; `/map` redirects to it. It loads active, in-window missions from `/api/v1/jellyhunt/missions` and never imports mission records from a frontend constant.

The page includes:

- Real Mapbox rendering when `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured.
- A coordinate-accurate fallback map when a Mapbox token is absent so development and accessibility do not collapse.
- Mission markers with available, submitted, approved, rejected, and rewarded states.
- Search and category/status filters.
- Browser geolocation, distance calculation, and a nearby sort.
- Mission cards and a full details drawer with address, hours, availability, difficulty, instructions, reward, and schedule.
- `jellyjelly://camera?mission_id=<id>` deep links plus iOS and Android store fallbacks.
- Explicit loading, empty, configuration, and network-error states.

Anonymous visitors only receive public mission data. User status is returned only to authenticated Jelly/PlatePost server calls.

## Admin

`/admin` uses a signed, HTTP-only PlatePost admin session. Credentials and the signing secret stay in server environment variables. The browser talks to authenticated Next.js route handlers; it never receives the Convex service secret, Jelly credentials, or payout credentials.

The admin supports mission and location creation/editing, lifecycle states, schedules, geofences, categories, difficulty, opening hours, restaurant tags, reward amounts, submission review, rejection reasons, reward status, safe retries, and audit history.

## API

The stable native-facing surface is rooted at `/api/v1/jellyhunt`:

- `GET /missions` — public active mission data; server-authenticated calls may add `user_id` and receive user status.
- `GET /missions/:id` — one mission and its user state when authorized.
- `POST /submissions` — authenticated Jelly-to-PlatePost submission intake.
- `GET /progress?user_id=` — authenticated status and reward summary.
- `GET /leaderboard` — public aggregate standings without private profile fields.
- `/admin/*` — signed admin-session-only mission, submission, reward, and audit operations.

Public mission reads fail closed only for private status data. Every write and every user-specific read requires authentication. A native-app embedded shared secret is transitional; production should exchange a Jelly-signed user token that PlatePost validates server-side.

## Convex Security and Data Flow

Only active mission listing and the public leaderboard are directly public data. Administrative and submission mutations require a server-only `PLATEPOST_CONVEX_SERVICE_KEY`. Jelly verification and reward execution are internal Convex actions; callers provide only a submission ID. Those actions load the submission, mission, location, and reward amount from Convex before contacting Jelly.

Submission flow:

1. Jelly sends the canonical user ID, post ID, mission ID, and optional client coordinates to PlatePost.
2. PlatePost verifies request authentication and validates the payload.
3. Convex checks mission status/schedule, blocks another active submission for the same user/mission, and blocks reuse of a Jelly post.
4. Convex records the submission and schedules internal Jelly verification.
5. Jelly verification confirms authorship, post state, restaurant tag, and trusted geolocation.
6. Automatic missions queue a reward after verification; manual missions enter the admin review queue.
7. Approval creates one reward attempt with a database-derived amount and stable idempotency key.
8. The internal reward action calls Jelly, records the transaction or failure, and updates the submission atomically.

The legacy `POST /crypto/send` endpoint has no idempotency contract. PlatePost therefore never automatically retries an ambiguous network result. A production Jelly partner reward endpoint must honor `Idempotency-Key` before automatic reconciliation is enabled.

## Legacy API Findings

The existing Jelly API provides `GET /user`, `GET /user/<user_id>`, `GET /v3/jelly?user_id=<id>`, `GET /v3/jelly/<post_id>`, `GET /v3/jelly/search?topics=<topic>`, and `POST /crypto/send`.

Post responses expose `topics` and `xdata`, but the legacy API has no restaurant entity, restaurant mention relation, or generic post latitude/longitude. A trusted Jelly partner verification endpoint is required for production-grade proof. During migration, Jelly can encode mission metadata in `xdata`, but PlatePost treats client-writable metadata as a claim rather than trusted proof.

## Error and Retry Policy

- Validation errors return structured `400` responses.
- Missing or invalid authorization returns `401`; insufficient role returns `403`.
- Duplicate user/mission or reused-post attempts return `409` with stable error codes.
- Jelly verification outages leave the submission retryable and never mark the user rejected solely because Jelly was unavailable.
- Reward transport ambiguity is marked `uncertain` and requires reconciliation; confirmed failures may be retried by an admin.
- Every state-changing action writes an audit event with actor, entity, previous state, next state, and safe metadata.

## Testing and Acceptance

Pure contract, schedule, distance, hours, filtering, deduplication, transition, authentication, and adapter behavior is unit tested. Browser verification covers desktop/mobile map discovery, marker selection, filters, geolocation denial, deep links, admin login, mission edits, and review actions.

A production preview is not accepted until no fixture mission source is enabled and a mission edited in `/admin` appears on `/human-social` and the native API without a code deploy.

## Visual Direction

The consumer map keeps the recognizable Jellyhunt night-map energy while making the partnership explicit. The palette uses Midnight `#080B18`, Jelly Blue `#7D9EF2`, Electric Cyan `#61E7FF`, Mint `#74E2BC`, Signal Coral `#FF6B67`, and Paper `#F7F8FC`. The signature element is a mission marker that expands into a route-card without leaving the map. Motion is limited to map movement, marker selection, and one drawer transition, with reduced-motion support.

## Deployment Constraint

The implementation can be built and tested locally, but Convex code generation, data seeding, and deployment require developer access to the PlatePost Convex project. The Vercel token previously shared in chat is not a Mapbox token and must not be placed in `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`; it should be rotated if it was a live credential.
