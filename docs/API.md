# Jellyhunt API

This document describes the HTTP API currently exposed by the PlatePost Jellyhunt Next.js application. It is the contract Kris and the Jelly team can use to build the native mission map.

## Base URL and version

All current endpoints are under:

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

This is a transitional server-to-server credential. Do not embed it in the JellyJelly iOS or Android application. Before native production, replace it with a short-lived Jelly-signed user token or proxy calls through an authenticated Jelly backend.

## Error envelope

HTTP errors use this shape:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Valid Jelly server authentication is required."
  }
}
```

Validation responses may add `error.details`.

| Status | Meaning |
| --- | --- |
| `400` | Schema-invalid fields; admin login parse errors. |
| `401` | Missing, invalid, or unconfigured Jelly server authentication. |
| `409` | `mission_already_submitted` or `jelly_post_reused`. |
| `500` | Unexpected submission failure. |
| `503` | Convex is unconfigured, its service key is unconfigured, or the data source is unavailable. |

Duplicate user/mission and reused-post conflicts have stable `409` codes. Remaining Convex business-rule errors can still be reported as `503 convex_request_failed`, and malformed submission JSON can reach the generic `500` path instead of the intended `400`; those cases still need normalization.

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
      "id": "mission-convex-id",
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
        "id": "location-convex-id",
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
      "missionId": "mission-convex-id",
      "status": "needs_review",
      "submissionId": "submission-convex-id",
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

Creates or returns an idempotent mission submission, then schedules Jelly verification.

### Request

```http
POST /api/v1/jellyhunt/submissions
Content-Type: application/json
x-jellyhunt-api-key: <server-key>
```

```json
{
  "missionId": "mission-convex-id",
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
    "submissionId": "submission-convex-id",
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

Mission and location create/update use combined Convex mutations, so each pair of records is written atomically. Each full edit increments the mission `revision`; public v1 does not currently expose that internal revision number.

Lifecycle body:

```json
{
  "missionId": "mission-convex-id",
  "status": "paused"
}
```

### Admin submission routes

`GET /api/v1/jellyhunt/admin/submissions?status=<state>` lists submissions, joined current mission/location display data, the immutable proof/reward snapshot accepted at submission time, claimed and verified coordinates/distance, verification summary, and the most recent sanitized reward attempt. Omit `status` or use `all` for every state. Raw partner payout bodies are not stored or returned. Review decisions and payouts must use the snapshot, not mutable current mission fields.

`PATCH /api/v1/jellyhunt/admin/submissions` accepts one of:

```json
{ "action": "approve", "submissionId": "submission-convex-id" }
```

```json
{
  "action": "reject",
  "submissionId": "submission-convex-id",
  "reason": "The post does not show the required restaurant."
}
```

```json
{ "action": "retry_verification", "submissionId": "submission-convex-id" }
```

```json
{ "action": "retry_reward", "submissionId": "submission-convex-id" }
```

```json
{
  "action": "reconcile_reward_sent",
  "submissionId": "submission-convex-id",
  "transactionId": "confirmed-jelly-transaction-id"
}
```

```json
{
  "action": "reconcile_reward_failed",
  "submissionId": "submission-convex-id",
  "reason": "Jelly confirmed no transaction was created."
}
```


Only a `needs_review` submission can be approved or rejected directly. A rejected proof must be reverified, and approval/reverification/reward queueing is blocked when another non-rejected attempt exists for the same user and mission.

The backend allows reward retry only after a confirmed `reward_failed` result. A `reward_uncertain` attempt cannot be retried. A two-minute processing watchdog also moves an abandoned worker to `reward_uncertain`. After checking Jelly, an operator must reconcile it as sent with the canonical transaction ID or as failed with a documented confirmation reason; that decision is audited.

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

The PlatePost consumer page includes a Passport progress shell, Editorial mission guide, and privacy-safe leaderboard contract state. It does not invent authenticated player data: Jelly web auth, Jelly Library/post selection, canonical profiles, personal progress, and live leaderboard standings require signed Jelly identity and progress contracts. The current completion handoff is the JellyJelly camera deep link.

## Future native endpoints

The following design targets are not implemented public contracts yet:

- `GET /missions/:id`
- `GET /progress?user_id=...`
- `GET /leaderboard`

Do not build a production native dependency on an endpoint until it is documented as implemented and verified in the target environment.
