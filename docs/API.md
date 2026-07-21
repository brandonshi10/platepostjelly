# Jellyhunt API

This document describes the implemented v1 compatibility API and the implemented native v2 API. v1 remains available for the existing Jelly server integration, but it is not the direct-native target because personalized calls use a transitional shared key and caller-supplied identity. New Jelly app work should use the v2 OpenAPI contract and short-lived Jelly-signed mission tokens after the target PlatePost/Jelly development environment is connected.

> **Hosting status:** no live PlatePost base URL has been published; deployment is intentionally paused. Until the shared Convex functions are installed, public v2 discovery and leaderboard routes return retryable `503 dependency_unavailable` responses.

## Base URL and version

The v1 compatibility endpoints are under:

```text
https://<platepost-host>/api/v1/jellyhunt
```

The mission response also includes `"apiVersion": "1.0"`. Additive fields may be introduced within v1. Removing or changing a field requires a new version.

## Authentication

### Anonymous reads

`GET /missions` without `user_id` is public and returns public mission configuration only.

### Jelly server calls

User-specific mission reads and all submission writes require:

```http
x-jellyhunt-api-key: <JELLYHUNT_API_KEY>
```

The handler fails closed when the request header is absent, the value is wrong, or the server environment variable is not configured.

This is a transitional server-to-server credential. Do not embed it in the JellyJelly iOS or Android application. New native requests use the implemented v2 routes with a short-lived Jelly-signed mission token; keep v1 behind Jelly or PlatePost server infrastructure during migration.

## Error envelope

HTTP errors use this shape:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Valid Jelly server authentication is required."
  },
  "requestId": "7a8836db-1f70-4f8f-aaf9-9155ecaebda0"
}
```

Validation responses may add `error.details`.

| Status | Meaning |
| --- | --- |
| `400` | Schema-invalid fields; admin login parse errors. |
| `401` | Missing, invalid, or unconfigured Jelly server authentication. |
| `409` | `mission_already_submitted` or `jelly_post_reused`. |
| `410` | `legacy_write_disabled` for v1 submission writes in Production; use v2. |
| `500` | Unexpected submission failure. |
| `503` | Convex is unconfigured, its service key is unconfigured, or the data source is unavailable. |

Duplicate user/mission and reused-post conflicts retain stable `409` codes. v1 responses include a request ID in both the body and `X-Request-Id`; schema-invalid payloads use the frozen `400` envelope, configuration/transport failures use `503`, and unexpected failures use a privacy-safe `500`. The v1 contract tests remain the compatibility guard while Jelly migrates to v2.

## GET /missions

Returns active missions whose optional start/end window includes the current time. Records are ordered by `sortOrder`.

### Anonymous request

```http
GET /api/v1/jellyhunt/missions
```

The server passes a current-time value rounded down to the minute to the deterministic Convex query, then rechecks each result against the exact time. A scheduled mission start can therefore appear up to one minute after its timestamp; expired missions are removed by the exact check.

Anonymous responses use:

```http
Cache-Control: public, s-maxage=30, stale-while-revalidate=120
```

### User-specific request

```http
GET /api/v1/jellyhunt/missions?user_id=jelly-user-123
x-jellyhunt-api-key: <server-key>
```

An authenticated user-specific response adds `userStatus` and uses `private, no-store`.

Do not send `user_id` without the header; that returns `401`.

### Response

```json
{
  "apiVersion": "1.0",
  "generatedAt": "2026-07-15T20:00:00.000Z",
  "missions": [
    {
      "id": "mis_example",
      "slug": "sushi-first-bite",
      "title": "Post a Jelly at Demo Sushi",
      "description": "Order a signature plate and capture the first bite.",
      "status": "active",
      "approvalMode": "manual",
      "rewardAmount": 250,
      "rewardToken": "JELLY-MY-JELLY",
      "restaurantTag": "demo-sushi",
      "category": "Sushi",
      "difficulty": "easy",
      "emoji": "🍣",
      "neighborhood": "Lower East Side",
      "price": "$$",
      "hours": [
        "11:00-22:00",
        "11:00-22:00",
        "11:00-22:00",
        "11:00-22:00",
        "11:00-23:00",
        "12:00-23:00",
        "closed"
      ],
      "sortOrder": 1,
      "location": {
        "id": "plc_example",
        "jellyRestaurantId": "jelly-restaurant-id",
        "name": "Demo Sushi",
        "address": "35 Orchard St, New York, NY",
        "latitude": 40.7163,
        "longitude": -73.9914,
        "geofenceRadiusMeters": 75,
        "timeZone": "America/New_York"
      }
    }
  ],
  "userStatus": [
    {
      "missionId": "mis_example",
      "status": "needs_review",
      "submissionId": "sub_example",
      "jellyPostId": "jelly-post-id"
    }
  ]
}
```

`userStatus` is omitted from anonymous responses. It is also omitted when the caller does not request a user.

### Mission fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Convex mission ID; use this for submission and deep links. |
| `slug` | string | Human-readable unique identifier. |
| `title` | string | Display title. |
| `description` | string | Completion instructions. |
| `status` | enum | Public responses currently contain `active` missions only. Admin state also supports `draft`, `paused`, and `archived`. |
| `approvalMode` | enum | `manual` or `automatic`. Convex allows automatic missions only when partner verification is configured. |
| `rewardAmount` | number | Positive Jelly-My-Jelly amount controlled by Convex and capped by `JELLYHUNT_MAX_REWARD_AMOUNT`. |
| `rewardToken` | string | Currently always `JELLY-MY-JELLY`. |
| `startsAt`, `endsAt` | ISO-8601 string | Optional publication window. |
| `restaurantTag` | string | Proof value Jelly must validate. |
| `category` | string | Consumer filter label. |
| `difficulty` | enum | `easy`, `medium`, `hard`, or `legendary`. |
| `emoji` | string | Marker and card icon. |
| `neighborhood`, `price` | string | Display metadata. |
| `hours` | string[7] | Monday through Sunday. Each value is `HH:MM-HH:MM` in the location timezone or `closed`. Overnight ranges such as `18:00-01:00` are valid. |
| `venueType` | string | Optional display behavior such as `shows`. |
| `showtimes` | string[] | Optional `HH:MM` values. |
| `sortOrder` | integer | Non-negative map/list ordering. |
| `websiteUrl` | URL | Optional venue URL. |
| `location` | object | PlatePost's mission-specific place and map placement. |

Latitude must be between -90 and 90; longitude must be between -180 and 180.

### User status values

- `not_started`
- `submitted`
- `verifying`
- `needs_review`
- `approved`
- `rejected`
- `reward_queued`
- `reward_sent`
- `reward_failed`
- `reward_uncertain`

A status record may include `rejectionReason` or `rewardTransactionId`.

## POST /submissions

This compatibility write is available only before cutover and in non-Production development. When `NODE_ENV=production`, it returns `410 legacy_write_disabled` before parsing or creating a submission. Production and native clients must use the v2 participation and submission flow.

Creates or returns an idempotent mission submission, then schedules Jelly verification.

### Request

```http
POST /api/v1/jellyhunt/submissions
Content-Type: application/json
x-jellyhunt-api-key: <server-key>
```

```json
{
  "missionId": "mis_example",
  "jellyUserId": "canonical-jelly-user-id",
  "jellyPostId": "canonical-jelly-post-id",
  "latitude": 40.7164,
  "longitude": -73.9915
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `missionId` | Yes | ID returned by `GET /missions`. |
| `jellyUserId` | Yes | Canonical Jelly user ID; PlatePost does not create user records. |
| `jellyPostId` | Yes | Canonical Jelly post ID. A post cannot be reused for another mission. |
| `latitude`, `longitude` | No | Client-claimed coordinates. Supply both or neither. These are not trusted proof. |

### Response

```http
HTTP/1.1 201 Created
```

```json
{
  "submission": {
    "submissionId": "sub_example",
    "status": "submitted",
    "idempotent": false
  }
}
```

If the exact `missionId + jellyUserId + jellyPostId` request already exists, Convex returns the existing submission with `idempotent: true`. A different post for an already-active user/mission, or reuse of one post across missions, is rejected. The former returns `409 mission_already_submitted`; the latter returns `409 jelly_post_reused`.

In explicit local fixture mode, the response also contains `fixture: true`; no Convex state or Jelly call is created.

### Verification behavior

After insert, Convex schedules an internal action. Production verification must establish all of the following from Jelly-owned data:

1. The post exists and is eligible.
2. The post author is `jellyUserId`.
3. The post contains the mission's restaurant proof.
4. Trusted post coordinates satisfy the location geofence when required.

Client latitude/longitude and client-writable post metadata are claims, not trusted proof. Outbound Jelly calls have a 10-second timeout. If Jelly is unavailable or the legacy response cannot prove the requirements, the safe result is `needs_review`, not an automatic rejection or payout. A successful legacy post response always requires manual review; only confirmed invalid conditions such as an explicit author mismatch are rejected directly.

## Operator-only admin API

These routes are implemented for the PlatePost admin. They are not part of the JellyJelly native contract.

### Admin authentication

`POST /api/v1/jellyhunt/admin/session` accepts JSON or form data:

```json
{
  "username": "platepost-operator",
  "password": "server-configured-password"
}
```

A successful JSON login returns `{ "ok": true }`; a successful form login redirects to `/admin`. The response sets a signed `jellyhunt_admin` cookie for 12 hours with `HttpOnly`, `SameSite=Strict`, path `/`, and `Secure` in production.

`DELETE /api/v1/jellyhunt/admin/session` clears the cookie.

Login and all mutation requests require a same-origin `Origin` header when one is present. Errors include `401 invalid_admin_credentials`, `403 untrusted_origin`, and `503 admin_not_configured`.

### Admin mission routes

All calls below require the signed admin cookie.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/jellyhunt/admin/missions` | List every mission, including its location and non-public lifecycle state. |
| `POST` | `/api/v1/jellyhunt/admin/missions` | Create a location and mission together. |
| `PUT` | `/api/v1/jellyhunt/admin/missions` | Fully update an existing location and mission. |
| `PATCH` | `/api/v1/jellyhunt/admin/missions` | Change only mission lifecycle status. |

Create body:

```json
{
  "location": {
    "name": "Demo Sushi",
    "address": "35 Orchard St, New York, NY",
    "jellyRestaurantId": "jelly-restaurant-id",
    "latitude": 40.7163,
    "longitude": -73.9914,
    "geofenceRadiusMeters": 75,
    "timeZone": "America/New_York"
  },
  "mission": {
    "slug": "sushi-first-bite",
    "title": "Post a Jelly at Demo Sushi",
    "description": "Capture the first bite.",
    "status": "draft",
    "approvalMode": "manual",
    "restaurantTag": "demo-sushi",
    "rewardAmount": 250,
    "category": "Sushi",
    "difficulty": "easy",
    "emoji": "🍣",
    "neighborhood": "Lower East Side",
    "price": "$$",
    "hours": [
      "11:00-22:00",
      "11:00-22:00",
      "11:00-22:00",
      "11:00-22:00",
      "11:00-23:00",
      "12:00-23:00",
      "closed"
    ],
    "sortOrder": 1
  }
}
```

An update uses the same nested objects and adds root-level `missionId` and `locationId`. Optional mission fields are `venueType`, `showtimes`, `websiteUrl`, `startsAt`, and `endsAt`. The raw admin API accepts Unix-millisecond schedules; the dashboard interprets its date/time controls in the mission location's IANA timezone before conversion. The public mission API maps timestamps to ISO-8601 strings.

Mission, location, and optional budget-cap changes use one Convex mutation. `GET` returns a `budgetContext` plus each mission's campaign/mission allocation, committed amounts, remaining capacity, revision, and capacity status. An optional root `budgets` object accepts canonical decimal-string `campaignAllocatedAmount` / `missionAllocatedAmount` and optimistic `expectedCampaignRevision` / `expectedMissionRevision` values. Allocations cannot fall below reserved + paid; drafts may remain unfunded, but active create/update/activation requires capacity for at least one reward. Each published edit advances the canonical mission revision; v1 keeps that revision internal.

Lifecycle body:

```json
{
  "missionId": "mis_example",
  "status": "paused"
}
```

### Admin submission routes

`GET /api/v1/jellyhunt/admin/submissions?status=<state>` lists submissions, joined current mission/location display data, the immutable proof/reward snapshot accepted at submission time, claimed and verified coordinates/distance, verification summary, and the most recent sanitized reward attempt. Omit `status` or use `all` for every state. Raw partner payout bodies are not stored or returned. Review decisions and payouts must use the snapshot, not mutable current mission fields.

`PATCH /api/v1/jellyhunt/admin/submissions` accepts one of:

```json
{ "action": "approve", "submissionId": "sub_example" }
```

```json
{
  "action": "reject",
  "submissionId": "sub_example",
  "reason": "The post does not show the required restaurant."
}
```

```json
{ "action": "retry_verification", "submissionId": "sub_example" }
```

```json
{ "action": "retry_reward", "submissionId": "sub_example" }
```

```json
{
  "action": "reconcile_reward_sent",
  "submissionId": "sub_example",
  "transactionId": "confirmed-jelly-transaction-id"
}
```

```json
{
  "action": "reconcile_reward_failed",
  "submissionId": "sub_example",
  "reason": "Jelly confirmed no transaction was created."
}
```


Only a `needs_review` submission can be approved or rejected directly. Verification can be requested again only while a submission is `submitted` or `needs_review`. Rejection is final for that attempt; when `canResubmit` is true, the Jelly user starts a new attempt with a new eligible post. Approval, verification queueing, and reward queueing remain blocked when a conflicting non-rejected sibling exists for the same user and mission.

The backend allows reward retry only after a confirmed `reward_failed` result. A `reward_uncertain` attempt cannot be retried automatically, and a two-minute watchdog moves abandoned processing to that quarantine state. For the initial release, the reconciliation actions remain restricted operator controls: the operator checks Jelly, enters the confirmed transaction ID or no-transfer reason, and the decision is audited. Server-verified receipt/no-transfer reconciliation remains recommended before automating this workflow.

### Admin audit route

`GET /api/v1/jellyhunt/admin/audit` returns the latest audit events. The Convex query defaults to 100 events and caps direct query requests at 500.

### Admin errors

Admin routes use the same `error` envelope and may return:

- `400 invalid_admin_request` with field errors.
- `401 admin_unauthorized`.
- `403 untrusted_origin`.
- `409 admin_conflict`.
- `500 admin_request_failed`.
- `503` for missing/unavailable Convex configuration.

Admin list responses expose operational Convex records and are intentionally not a stable public API. They must not be consumed by JellyJelly clients.


## Native client behavior

- Fetch the mission list on launch and refresh; do not ship mission constants in the app.
- Use `mission.id` in `jellyjelly://camera?mission_id=<id>`.
- Render unknown additive fields defensively.
- Treat `reward_uncertain` as a reconciliation state, not as a failed reward the user should retry.
- Do not infer an earned reward from client state; use the server status.
- Do not expose the transitional server API key in a mobile binary.

The PlatePost consumer page includes a Passport progress shell, Editorial mission guide, and live current-season/all-time leaderboard tabs backed by the v2 “most approved” endpoints. Standings show only eligible canonical Jelly usernames; the page provides loading, empty, error, and retry states instead of invented data. Jelly Library/post selection and signed personal Passport progress remain Jelly integration work. The current completion handoff is the JellyJelly camera deep link.

## v2 native API (implemented; external integration pending)

The clean native contract is published as an executable OpenAPI 3.1 document at
[`openapi/jellyhunt-v2.yaml`](../openapi/jellyhunt-v2.yaml), validated by
`pnpm validate:openapi` (Redocly) and exercised by `pnpm test:contracts`. It
implements the route list, schemas, auth model, and error catalog approved in
the [Native Mission API v2 design](superpowers/specs/2026-07-16-platepost-jelly-native-api-v2-design.md)
and the [Leaderboard and native-integration design](superpowers/specs/2026-07-16-jellyhunt-leaderboard-native-integration-design.md).

The corresponding `app/api/v2/jellyhunt/*` route handlers are implemented for
every operation below, including authenticated owner reads, participation and
submission writes, status/event history, and both leaderboards. They are ready
for development integration, not Production: the target PlatePost Convex
deployment, Jelly mission-token/JWKS, authoritative place/evidence APIs, and
at-most-once reward service still need to be connected and accepted. v1 remains
the compatibility surface during that migration.

### Base URL and auth

```text
https://<platepost-host>/api/v2/jellyhunt
```

Personalized routes require a short-lived Jelly mission bearer token:

```http
Authorization: Bearer <jelly-mission-token>
```

validated against the `jellyMissionToken` HTTP bearer security scheme
(`components.securitySchemes.jellyMissionToken` in the OpenAPI document). v2
never accepts a caller-supplied `user_id`/`jellyUserId`; the subject always
comes from the verified token. An optional-but-present bearer token that
fails validation returns `401`, never a silent anonymous downgrade.

### Operations

| Method | Route | operationId | Auth |
| --- | --- | --- | --- |
| `GET` | `/campaigns/current` | `getCurrentCampaign` | Public |
| `GET` | `/missions` | `listMissions` | Public, optional viewer |
| `GET` | `/missions/{missionId}` | `getMission` | Public, optional viewer |
| `GET` | `/missions/{missionId}/jellies` | `getMissionJellies` | Public |
| `GET` | `/places/{placeId}` | `getPlace` | Public |
| `GET` | `/places/{placeId}/jellies` | `getPlaceJellies` | Public |
| `PUT` | `/missions/{missionId}/participation` | `startMissionParticipation` | Bearer |
| `GET` | `/participations/{participationId}` | `getParticipation` | Bearer, owner-only |
| `POST` | `/missions/{missionId}/submissions` | `createMissionSubmission` | Bearer |
| `GET` | `/submissions/{submissionId}` | `getSubmission` | Bearer, owner-only |
| `GET` | `/submissions/{submissionId}/events` | `listSubmissionEvents` | Bearer, owner-only |
| `GET` | `/me` | `getMe` | Bearer |
| `GET` | `/me/missions` | `listMyMissions` | Bearer |
| `GET` | `/me/submissions` | `listMySubmissions` | Bearer |
| `GET` | `/me/events` | `listMyEvents` | Bearer |
| `GET` | `/leaderboards/current-season` | `getCurrentSeasonLeaderboard` | Public |
| `GET` | `/leaderboards/all-time` | `getAllTimeLeaderboard` | Public |

### Conventions

- Public resource IDs are opaque strings with a stable resource prefix and a
  non-empty suffix: campaign `cam_`, place `plc_`, mission `mis_`,
  participation `par_`, submission `sub_`, reward `rwd_`, event `evt_`.
  Convex `_id` values are never exposed.
- Reward amounts are positive decimal strings matching `^[0-9]+(?:\.[0-9]+)?$`
  (e.g. `"60"`, `"0.000001"`), never floating-point JSON numbers.
- Every success envelope has `data` and `meta` (`apiVersion: "2.0"`,
  `requestId`, `generatedAt`, plus optional `catalogRevision`,
  `leaderboardRevision`, and `page`); every error envelope has `error` and
  `meta`. See `components.schemas.Error`/`Meta` in the OpenAPI document.
- Public response schemas set `additionalProperties: false`; no
  Convex/wallet/geofence/`approvalMode`/`jellyUserId` field is ever returned
  from a public (non-owner) route.
- Submission creation requires `Idempotency-Key` and returns `202 Accepted`
  for the newly queued attempt.
- Submission/review status and reward delivery are separate fields
  (`submissionStatus`, `rewardStatus`); clients render the server-derived
  `displayStatus`, `publicMessage`, and `nextAction` rather than
  reimplementing the transition table. The frozen paid-moderation fixture
  (`rewarded_removed_from_rankings` / `post_became_ineligible_after_reward` /
  `canResubmit: false` / `nextAction: contact_support`) is pinned in
  `tests/contracts/jellyhunt-v2/submission-detail-paid-moderated.200.json`.

### Fixtures

Versioned request/response fixtures live in
[`tests/contracts/jellyhunt-v2/`](../tests/contracts/jellyhunt-v2/), indexed
by `manifest.json` (`apiVersion`, `successFixtures`, `errorStatuses`).
`tests/jellyhunt-v2-fixtures.test.ts` validates every fixture against its
OpenAPI response schema, scans public fixtures for forbidden internal keys,
and pins the exact paid-moderation owner-status fixture. Jelly-owned partner
API examples (canonical place, place-indexed Jellies, post preflight,
component verification, reward-intent attempts/lookup, reward-account
capacity) are recorded separately in
[`tests/contracts/jelly-partner-v1/`](../tests/contracts/jelly-partner-v1/)
for the partner-integration contract tests.

### Migration relationship to v1

v1 reads remain the implemented compatibility surface while Jelly adopts the
v2 API. `tests/jellyhunt-v1-compatibility.test.ts` guards its response shapes
and statuses; v1 is retired only after the shared Convex deployment, native
integration, legacy dedupe/transaction cutover, and monitored pilot complete.
Both versions must read and write the same canonical namespaced Convex workflow
during the transition.
