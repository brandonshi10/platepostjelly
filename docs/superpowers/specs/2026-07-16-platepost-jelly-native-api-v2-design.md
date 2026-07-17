# PlatePost ↔ JellyJelly Native Mission API v2 Design

**Status:** Approved for local and development implementation; Production integration gates remain
**Date:** 2026-07-16
**Owners:** PlatePost mission platform, JellyJelly identity/content/wallet platform
**Primary native consumer:** JellyJelly iOS and Android, implemented by Kris and the Jelly engineering team

**Approved extension:** The [JellyHunt Leaderboard and PlatePost Native Integration Design](2026-07-16-jellyhunt-leaderboard-native-integration-design.md) supersedes this document's earlier leaderboard score, route, persistence, launch-history, legacy-ranking, and physical shared-Convex table/function namespace assumptions. The generic data-model names below are logical names mapped to `jellyhunt*` physical names by that extension. Mission, submission, reward, and webhook rules in this document remain binding except where the extension explicitly tightens legacy cutover policy.

## Executive decision

PlatePost and Convex will be the canonical mission platform. They own editable campaigns, mission and map configuration, submission intake, deduplication, review, reward orchestration, status history, budgets, and the native-facing API. Jelly remains authoritative for users, sessions, Jelly posts and media, canonical place association, trusted post-location evidence, wallet balances, and the final Jelly-My-Jelly tip transaction.

The current `/api/v1/jellyhunt` routes remain available during migration. They are not the final direct-native contract because v1 accepts caller-supplied user IDs, exposes internal fields and Convex IDs, lacks mission/submission detail and history, and has no stable content or webhook contract.

The clean native contract will be rooted at:

```text
https://<platepost-host>/api/v2/jellyhunt
```

The design requires three changes on the Jelly side before production launch:

1. A short-lived, PlatePost-audience mission token that PlatePost can validate without receiving Jelly's HS256 signing secret.
2. Canonical place, place-indexed Jelly content, and component-level mission-proof endpoints.
3. A reward-intent API with guarded versioned attempts, authoritative lookup, full-tuple receipts, capacity reporting, and at-most-one successful transfer per intent.

Until those contracts exist, PlatePost may use the current Jelly endpoints only as the explicitly limited development bridge described below. Legacy Jelly post detail is useful evidence, but legacy topics and `xdata` are not authoritative restaurant or location proof.

## Goals

- Eliminate hardcoded missions from the PlatePost map, JellyJelly app, Passport, editorial map, and admin previews.
- Give the JellyJelly app one stable API for campaign configuration, missions, places, user status, submission history, rejection details, and reward state.
- Derive the Jelly user from signed authentication on every personalized request.
- Preserve the status of a user's submission after a mission is paused, archived, or ended.
- Make “approved” and “reward sent” separate, truthful states.
- Guarantee idempotent submission and reward behavior under retries and concurrent requests.
- Pull canonical users, posts, place associations, post proof, and final tip receipts from Jelly-owned APIs.
- Keep signed/expiring Jelly media URLs out of long-lived Convex records.
- Notify the Jelly backend when mission, submission, or reward state changes.
- Preserve v1 until Jelly has adopted v2 and production telemetry proves it is safe to retire.

## Non-goals

- PlatePost will not become a Jelly identity provider, media host, social graph, or wallet.
- The native app will not receive Convex service keys, PlatePost admin credentials, Jelly partner credentials, or a long-lived shared API key.
- PlatePost will not infer authoritative restaurant proof from a title, transcript, AI topic, or client-writable `xdata` value.
- PlatePost will not blindly retry a payout whose result is uncertain.
- The public API will not expose internal fraud rules, exact verification notes, raw upstream responses, business wallet credentials, or precise verified GPS evidence.

## Findings from the current systems

### Current JellyHunt website

The live website is a visual reference, not a reliable data contract:

- Map and detail missions come from a browser `MISSIONS` constant in `jellyjelly-website/src/routes/jellyhunt/+page@.svelte`.
- Passport uses a second, inconsistent mission array in the same file.
- The page has a database-backed mission route but does not use it for its primary map.
- The Library picker reads all of the user's Jellies and does not filter by a canonical place association.
- The current submit route accepts client GPS and a client-constructed post URL without validating post authorship or place proof.
- The legacy three-state UI (`pending`, `approved`, `rejected`) can show approval even when the Jelly payout later fails.
- Current camera handoff uses a custom URI and has no reliable native callback or Android/desktop universal-link flow.

All PlatePost map, Passport, editorial, admin-preview, and native views must instead render the same Convex mission record.

### Current Jelly API capabilities

The current Jelly API provides useful building blocks:

| Need | Current Jelly route | Safe use |
| --- | --- | --- |
| Validate an active Jelly session | `GET /auth/session` with a Jelly access token | Development identity bridge only. This route validates the token's bound active session. |
| Resolve the current user | `GET /user` with the same access token | Derive canonical `user.userid`; never accept a body/query user ID instead. |
| Resolve a public user | `GET /user/{user_id}` | Public profile decoration with a short cache and deletion handling. |
| Fetch an exact Jelly | `GET /v3/jelly/{jelly_id}` | Post existence, ID, author field, visibility/media metadata, topics, and `xdata`; legacy proof remains manual-review evidence. |
| List a user's public Jellies | `GET /v3/jelly?user_id=...` | User library/content display, not place proof. |
| Search public Jellies | `GET /v3/jelly/search` | Generic title/summary/user/topic discovery, not restaurant association. |
| Send a legacy tip | `POST /crypto/send` | Migration-only manual payout. It has no documented idempotency key or lookup contract. |

Important limitations confirmed in the legacy source:

- Jelly access JWTs currently use HS256, audience `authenticated`, and no issuer. Sharing the signing secret with PlatePost would also give PlatePost the ability to mint Jelly tokens and is prohibited.
- `/v3/jelly/search` filters generic AI-assigned topic codes, not canonical restaurants or places.
- `xdata` is explicitly an opaque, client-defined string.
- The legacy API exposes no canonical restaurant/place resource, place-indexed Jelly feed, or generic trusted post-location field.
- Exact Jelly lookup is access-based and does not itself guarantee that a post is ready, undeleted, within the mission window, or linked to a place. PlatePost must not infer those conditions from a successful HTTP response.
- `POST /crypto/send` does not accept a documented idempotency key and is unsafe to retry after a dropped response.
- Legacy payout success returns both a local integer `transaction_id` and an on-chain `transaction_hash`. The transitional PlatePost adapter must treat `transaction_hash` as the canonical receipt and retain the integer only as an optional legacy ledger reference.
- The authenticated legacy payout credential owns the funding wallet. A funding wallet migrated to Jelly crypto v2 is rejected by `/crypto/send`, while the v2 wallet flow requires interactive PIN/signature/nonce material and is not a valid unattended PlatePost payout integration.
- Legacy public search currently has a known `sort_by=views` implementation defect. PlatePost integrations must not use that sort mode until Jelly fixes and contract-tests it.

### Current PlatePost implementation

The existing Convex workflow already has strong foundations:

- Atomic mission/location writes.
- Mission revision snapshots.
- Exact retry deduplication, one live user/mission attempt, and global post-reuse prevention.
- Immutable mission, proof, location, and reward terms on each submission.
- Conservative legacy verification that routes incomplete proof to review.
- One reward attempt with a processing watchdog and an uncertain state.

The native contract still needs stable public IDs, signed viewer identity, detail/history resources, cursor pagination, request idempotency records, split review/reward state, status events, budgets/reservations, authoritative place content, signed webhooks, and unique transaction reconciliation.

## Source-of-truth ownership

| Resource or decision | Canonical owner | PlatePost behavior |
| --- | --- | --- |
| Jelly user and active session | Jelly | Validate signed identity and store only the canonical foreign user ID needed for workflow correlation. |
| Public username/avatar | Jelly | Fetch and cache briefly; do not make cached profile data authoritative. |
| Campaign, map viewport, dates, and rules | PlatePost/Convex | Editable in PlatePost admin and returned to all clients. |
| Mission task, schedule, reward terms, and lifecycle | PlatePost/Convex | Canonical, revisioned, and snapshotted on submission. |
| Canonical Jelly place identity | Jelly | PlatePost stores a `jellyPlaceId` foreign key and a reviewed mission-time display snapshot. |
| Mission place/map snapshot | PlatePost/Convex | Store name, address, coordinates, timezone, and hours needed to render and preserve historical terms. Refresh from Jelly explicitly; do not change old submissions. |
| Jelly post, author, media, moderation, and deletion | Jelly | Resolve by ID and store only immutable verification snapshots plus the foreign post ID. |
| Trusted post-to-place association and post GPS | Jelly | Consume through partner proof; independently compare with the immutable PlatePost snapshot. |
| Submission, review, deduplication, and status history | PlatePost/Convex | Canonical for JellyHunt. |
| Mission/campaign/user reward limits and reservations | PlatePost/Convex | Atomically reserve and account for advertised rewards. |
| Wallet balance and final token transfer | Jelly | Execute through the partner reward API and return a canonical receipt/transaction ID. |
| Native-readable mission/submission/reward status | PlatePost API | Derived from canonical PlatePost workflow and Jelly receipts. |

PlatePost may store a place snapshot because a mission must remain renderable and auditable even if Jelly later changes a place name or coordinates. The `jellyPlaceId` remains the cross-platform canonical relation.

## Version and compatibility strategy

### v1

`/api/v1/jellyhunt` remains a compatibility surface while v2 is built. Existing v1 response shapes and HTTP statuses remain unchanged. Safe additive changes may add:

- Stable `publicId` fields alongside current Convex IDs.
- Mission revision and `updatedAt`.
- Mission detail and user/submission history resources.
- Optional request idempotency.
- Request IDs and normalized error codes.

v1 must not silently remove `user_id`/`jellyUserId`, change number amounts to decimal strings, replace its response envelope, change `201` to `202`, or turn its unpaginated catalog into a truncated default page.
Before any dual-write change, the team freezes executable fixtures for every current v1 success and error response. During migration, the split v2 fields are authoritative for workflow behavior. A separate `legacyStatusProjection` compatibility discriminator is copied from each existing row and updated in the same shared transition mutation so the v1 adapter can preserve its exact single-status representation:

| Existing v1 status | v2 submission status | v2 reward status |
| --- | --- | --- |
| `submitted` | `submitted` | `not_eligible` |
| `verifying` | `verifying` | `not_eligible` |
| `needs_review` | `needs_review` | `not_eligible` |
| `approved` | `approved` | `queued` |
| `rejected` | `rejected` | `not_eligible` |
| `reward_queued` | `approved` | `queued`, or `processing` when the linked current reward attempt is `processing` |
| `reward_sent` | `approved` | `sent` |
| `reward_failed` | `approved` | `failed` |
| `reward_uncertain` | `approved` | `uncertain` |

Backfill validates row counts, copies the original value into `legacyStatusProjection`, and validates every mapping before v1 reads switch to the adapter. The adapter returns that projection, not a lossy reverse inference from the two v2 fields. Thus legacy `approved` and `reward_queued` remain distinguishable even though both can correspond to v2 submission `approved` plus reward `queued`. For a new v2 record, queue creation projects `reward_queued` atomically; `approved` is not externally observable as a separate v1 phase. A terminal linked attempt that disagrees with the v1 projection is quarantined for reconciliation rather than guessed. During the pre-cutover compatibility window, all v1 and v2 writes use one shared Convex transition mutation; there is no independent dual-write path. At the UTC watermark, v1 write routes switch permanently to `410 legacy_write_disabled` as specified in Phase 7. Rollback disables v2 routes while retaining the additive split fields and read adapter, but never re-enables v1 writes or erases new audit history.

### v2

v2 is the direct-native contract. It:

- Uses stable public resource IDs rather than Convex document IDs.
- Requires a Jelly mission bearer token for personalized reads and writes.
- Never accepts `user_id` in a query or `jellyUserId` in a request body.
- Requires `Idempotency-Key` for submission creation.
- Uses cursor pagination for growing collections.
- Uses decimal strings for token amounts.
- Separates verification, review, and reward state.
- Returns `202 Accepted` for a newly queued asynchronous submission.
- Uses a consistent success/error envelope and request ID.

## Authentication and authorization

### Public requests

Campaign configuration, available mission discovery, publicly visible mission detail, place detail, place-linked public Jellies, and an explicitly privacy-reviewed leaderboard may be anonymous. If an optional `Authorization` header is present but invalid, PlatePost returns `401`; it never silently downgrades the request to anonymous.

### Target native authentication

Jelly adds:

```http
POST https://api.jellyjelly.com/auth/mission-token
Authorization: Bearer <current-jelly-access-token>
```

The endpoint validates the active Jelly session and returns a short-lived asymmetrically signed token. It sends `Cache-Control: no-store`:

```json
{
  "status": "success",
  "token": "<jwt>",
  "expiresIn": 300
}
```

Required claims:

```json
{
  "iss": "https://api.jellyjelly.com",
  "aud": "platepost-jellyhunt",
  "sub": "canonical-jelly-user-uuid",
  "scope": "jellyhunt:read jellyhunt:submit",
  "iat": 1784210000,
  "exp": 1784210300,
  "jti": "unique-token-id",
  "session_id": "active-jelly-session-id"
}
```

Requirements:

- Maximum token lifetime: five minutes.
- Algorithm: RS256, ES256, or EdDSA; never Jelly's shared HS256 root secret.
- Jelly publishes rotating public keys with `kid` at `https://api.jellyjelly.com/.well-known/jwks.json` and keeps the prior verification key available for at least the maximum token lifetime.
- PlatePost validates signature, issuer, audience, expiry, not-before, scope, and subject.
- PlatePost derives the user ID exclusively from `sub`.
- Jelly refuses token issuance for disabled, deleted, banned, or inactive-session users.
- A user token never authorizes admin or service-to-service partner endpoints.
- The native client obtains a new mission token when the token is expired; no PlatePost refresh token exists.
- Launch accepts a maximum five-minute logout/revocation lag for an already-issued token. If immediate revocation becomes required, Jelly adds token introspection or a short-lived `jti` denylist; PlatePost does not lengthen the token lifetime.

### Development identity bridge

Before the mission-token endpoint exists, a non-production environment may set an explicit `legacy_introspection` auth mode:

1. The native/web client sends its current Jelly access token as `Authorization: Bearer`.
2. PlatePost forwards that token to `GET /auth/session` and requires a `200` response, proving the bound Jelly session is active.
3. PlatePost forwards the same token to `GET /user` and derives the subject from `user.userid`.
4. PlatePost discards the token after the request and never logs or persists it.

Both calls must succeed. A public `GET /user/{id}` lookup is not authentication. PlatePost must not share Jelly's HS256 signing secret or accept a user ID supplied by the caller. This bridge is for development/pilot only and is removed after mission-token adoption.

### Service and webhook authentication

- PlatePost-to-Jelly partner calls use a restricted, rotated server credential stored only in Convex environment variables.
- Jelly-to-PlatePost and PlatePost-to-Jelly webhooks use independent HMAC secrets with timestamp validation.
- Current Jelly API tokens use the literal `Authorization: Token <key>` scheme; they are never treated as native user bearer tokens.

## Resource IDs and field conventions

- Public IDs are generated once and never change:
  - Campaign: `cam_...`
  - Place: `plc_...`
  - Mission: `mis_...`
  - Participation: `par_...`
  - Submission: `sub_...`
  - Reward: `rwd_...`
  - Event: `evt_...`
- v2 never exposes Convex `_id` values.
- Jelly user UUIDs, Jelly ULIDs, and Jelly place IDs are opaque foreign IDs. Trim surrounding whitespace, but do not lowercase arbitrary IDs. Parse UUID/ULID formats only where the Jelly contract guarantees that format.
- All timestamps are RFC 3339 UTC strings.
- Reward amounts are positive canonical decimal strings in human-token units, such as `"60"` or `"0.000001"`, not atomic-unit integers and never floating-point JSON numbers. `JELLY-MY-JELLY` currently has 6 decimals; implementations use decimal/integer arithmetic, reject more than 6 fractional digits, and convert to atomic units only at the Jelly transfer boundary.
- Coordinates are JSON numbers; client location also includes capture time and accuracy.
- Collection cursors are opaque and must not be constructed by clients.
- Mission `revision` is a monotonic integer. A material task, proof, place, schedule, or reward edit increments it.
- All responses include `X-Request-Id`. Anonymous cacheable resources emit a weak semantic ETag computed from stable public fields and resource/catalog revisions; volatile envelope fields such as `requestId` and `generatedAt` are excluded. Personalized resources omit ETag under the cache rules below.

## Common response envelopes

Success:

```json
{
  "data": {},
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-07-16T20:00:00Z"
  },
  "links": {}
}
```

Paginated success adds:

```json
{
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-07-16T20:00:00Z",
    "page": {
      "limit": 20,
      "nextCursor": "opaque-or-null",
      "hasMore": false
    }
  }
}
```

### Common cursor contract

Every collection cursor is opaque and either server-stored or HMAC-authenticated. Its logical binding is:

```json
{
  "version": 1,
  "resource": "me_submissions",
  "subjectHash": "present-for-personalized-routes",
  "queryHash": "sha256-of-normalized-filters-sort-and-limit",
  "snapshot": "catalog-revision-or-as-of-watermark",
  "lastSortValues": ["2026-08-05T19:00:00Z", "sub_01..."],
  "issuedAt": "2026-08-05T19:00:01Z",
  "expiresAt": "2026-08-06T19:00:01Z"
}
```

- Bind every cursor to route/resource, authenticated subject where applicable, normalized filters, sort mode, and page size. Every order has a stable public-ID tie-breaker.
- Mission/map cursors bind to `catalogRevision`; mutable personal histories bind to an `asOf` high-water snapshot. `/me/events` instead binds subject plus the last user sequence and may include newly appended events.
- Jelly partner place-feed cursors bind to `jellyPlaceId`, normalized filters, and the Jelly feed revision.
- A malformed, expired, wrong-subject, query-mismatched, or stale-snapshot cursor returns `400 invalid_cursor` with safe `restartRequired: true` and, for a changed catalog, the latest `catalogRevision`. Clients restart at page one and never inspect cursor contents.
- `nextCursor` is null exactly when `hasMore` is false.
Error:

```json
{
  "error": {
    "code": "mission_not_available",
    "message": "This mission is not currently accepting submissions.",
    "requestId": "req_01...",
    "retryable": false,
    "details": []
  }
}
```

Public messages are safe for users. Internal verification notes, upstream bodies, credentials, and exact fraud signals are never returned.

## Cache rules

- Every authenticated or personalized response, including authenticated mission detail, `include=viewer`, `/me/*`, and submission detail, sends `Cache-Control: private, no-store` and `Vary: Authorization`. It is never stored by a CDN or shared browser cache.
- Personalized responses omit ETag by default. If conditional requests are later enabled, the validator must include both the public resource revision and the viewer-state revision.
- Anonymous campaign, mission, place, leaderboard, and Jelly-feed responses may use short public caching with ETag and `stale-while-revalidate` where upstream media expiry permits it.
- Authentication errors and mission-token responses are never cached.

## API surface

### Public or optionally personalized

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/campaigns/current` | Campaign branding, dates, rules, map viewport, app links, and catalog revision. |
| `GET` | `/missions` | Cursor-paginated mission summaries for map/list discovery. |
| `GET` | `/missions/{missionId}` | Complete mission detail. An authenticated request may include `viewer`. |
| `GET` | `/missions/{missionId}/jellies` | Normalized public Jellies linked by Jelly to the mission's canonical place. |
| `GET` | `/places/{placeId}` | Reviewed PlatePost place snapshot and canonical Jelly place relation. |
| `GET` | `/places/{placeId}/jellies` | Same place-linked Jelly feed independent of one mission. |
| `GET` | `/leaderboards/current-season` | Public current-campaign standings ranked by approved mission count. |
| `GET` | `/leaderboards/all-time` | Public standings ranked by approvals recorded since the PlatePost JellyHunt launch epoch. |

### Authenticated Jelly user

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/me` | Canonical subject and campaign-level summary. |
| `GET` | `/me/missions` | Current and historical mission participation, including ended missions. |
| `GET` | `/me/submissions` | Cursor-paginated submission history and filters. |
| `GET` | `/me/events` | Lightweight ordered polling feed for mission/submission/reward changes. |
| `GET` | `/participations/{participationId}` | Owner-only immutable started mission snapshot and current controls. |
| `GET` | `/submissions/{submissionId}` | Owner-only user-safe submission, review, and reward detail. |
| `GET` | `/submissions/{submissionId}/events` | Owner-only cursor-paginated status timeline. |
| `PUT` | `/missions/{missionId}/participation` | Idempotently mark the authenticated user as having started the mission. |
| `POST` | `/missions/{missionId}/submissions` | Create an idempotent asynchronous submission for the authenticated subject. |

Admin resources remain separate, cookie/SSO protected, and are not part of the Jelly native contract.

## Campaign configuration

`GET /campaigns/current` replaces hardcoded campaign dates, reward naming, map bounds, and store links. Convex enforces exactly one `isCurrent` campaign per environment. Its public status is `upcoming`, `active`, or `ended`; if none is selected, the endpoint returns `404 campaign_not_found` rather than guessing from dates:

```json
{
  "data": {
    "id": "cam_01...",
    "revision": 12,
    "catalogRevision": 34,
    "title": "PlatePost x JellyJelly: Human Social!",
    "shortTitle": "JellyHunt",
    "status": "active",
    "startsAt": "2026-08-01T04:00:00Z",
    "endsAt": "2026-09-01T03:59:59Z",
    "claimsCloseAt": "2026-09-08T03:59:59Z",
    "timeZone": "America/New_York",
    "rewardToken": {
      "code": "JELLY-MY-JELLY",
      "displayName": "Jelly-My-Jelly"
    },
    "map": {
      "center": { "latitude": 40.7218, "longitude": -73.9914 },
      "bounds": {
        "south": 40.711,
        "west": -74.004,
        "north": 40.734,
        "east": -73.978
      },
      "defaultZoom": 13
    },
    "links": {
      "rules": "https://platepost.io/human-social/rules",
      "iosApp": "https://apps.apple.com/...",
      "androidApp": "https://play.google.com/...",
      "support": "https://platepost.io/human-social/support"
    }
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-07-16T20:00:00Z"
  },
  "links": {
    "missions": "/api/v2/jellyhunt/missions?campaignId=cam_01..."
  }
}
```

`claimsCloseAt` is the final private deadline for timely-started participants to resolve reviews or permitted resubmissions; it may extend beyond public campaign end. Campaign `revision` changes when campaign configuration changes. `catalogRevision` changes when any published mission or place representation in that campaign changes, allowing native clients to invalidate the whole map catalog. The map viewport is computed and reviewed from the published places; it is not embedded in native code.

## Mission resources

### Mission list

```http
GET /api/v2/jellyhunt/missions
  ?campaignId=cam_01...
  &availability=available,upcoming
  &category=Pizza
  &difficulty=easy
  &latitude=40.72
  &longitude=-73.99
  &radiusMeters=5000
  &include=viewer
  &cursor=<opaque>
  &limit=20
```

- Default limit: `20`; maximum: `100`.
- Deterministic order: `curated` uses configured sort order then public ID; `nearby` uses distance then sort order/public ID; `updated` uses update time then public ID.
- `include=viewer` requires bearer authentication and makes the response private/no-store.
- Anonymous catalog responses support ETag and short CDN caching.
- `availability` may include `available`, `upcoming`, or `ended` anonymously. `paused` requires authentication and returns only missions in which that subject already participated.
- Optional `sort=curated|nearby|updated` defaults to `curated`. `nearby` requires coordinates.

Every mission-list item has a frozen native map summary; it is not an arbitrary subset of detail:

```json
{
  "data": {
    "missions": [
      {
        "id": "mis_01...",
        "campaignId": "cam_01...",
        "revision": 7,
        "title": "The Scarr's Cheese Pull",
        "availability": {
          "state": "available",
          "startsAt": "2026-08-01T16:00:00Z",
          "endsAt": "2026-08-31T23:00:00Z",
          "acceptingSubmissions": true,
          "reasonCode": null
        },
        "reward": {
          "amount": "60",
          "token": "JELLY-MY-JELLY",
          "displayName": "Jelly-My-Jelly"
        },
        "display": {
          "category": "Pizza",
          "difficulty": "easy",
          "emoji": "🍕",
          "neighborhood": "Lower East Side",
          "price": "$",
          "sortOrder": 1
        },
        "place": {
          "id": "plc_01...",
          "jellyPlaceId": "jpl_01...",
          "name": "Scarr's Pizza",
          "address": "35 Orchard St, New York, NY",
          "latitude": 40.7163,
          "longitude": -73.9914,
          "timeZone": "America/New_York"
        },
        "links": {
          "self": "/api/v2/jellyhunt/missions/mis_01...",
          "start": "https://platepost.io/human-social/missions/mis_01.../start"
        },
        "updatedAt": "2026-07-16T19:00:00Z"
      }
    ]
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-07-16T20:00:00Z",
    "catalogRevision": 34,
    "page": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

Anonymous items omit `viewer`. With `include=viewer`, each item adds the same safe viewer summary defined by mission detail. `place.latitude`, `place.longitude`, and `place.jellyPlaceId` are required so Jelly can render the native map and bind the composer without another discovery lookup.

Lifecycle visibility is fixed:

| Internal/lifecycle state | Anonymous discovery | Anonymous detail | Authenticated participant/history |
| --- | --- | --- | --- |
| `draft` | omitted | `404` | omitted; admin only |
| active before start (`upcoming`) | included by default/filter | visible | visible |
| active in window (`available`) | included by default/filter | visible | visible |
| `paused` | omitted | `404` | visible only after start/submission, with `acceptingSubmissions: false` |
| active after end (`ended`) | only with explicit `ended` filter | visible | visible in history |
| `archived` | omitted | `404` | immutable history snapshot only; canonical detail remains `404` |

An authenticated nonparticipant gets the same `404` as an anonymous caller for paused/archived mission detail. Admin preview is a separate protected resource.

### Mission object

```json
{
  "id": "mis_01...",
  "campaignId": "cam_01...",
  "slug": "scarrs-cheese-pull",
  "revision": 7,
  "title": "The Scarr's Cheese Pull",
  "description": "Order one slice and film the cheese pull.",
  "instructions": [
    "Visit the venue during the mission window.",
    "Record and publish the requested Jelly.",
    "Attach the venue when JellyJelly asks for a place."
  ],
  "availability": {
    "state": "available",
    "startsAt": "2026-08-01T16:00:00Z",
    "endsAt": "2026-08-31T23:00:00Z",
    "acceptingSubmissions": true,
    "reasonCode": null
  },
  "reward": {
    "amount": "60",
    "token": "JELLY-MY-JELLY",
    "displayName": "Jelly-My-Jelly"
  },
  "requirements": {
    "post": {
      "allowedPostTypes": ["video"],
      "authorshipPolicy": "canonical_owner",
      "prompt": "Film the cheese pull and your first reaction.",
      "minDurationSeconds": 5,
      "maxDurationSeconds": 90,
      "requiredVisibility": "public"
    },
    "place": {
      "attachmentRequired": true
    },
    "location": {
      "required": true,
      "trustedSource": "jelly_post"
    },
    "schedule": {
      "mustBeWithinMissionWindow": true,
      "mustBeDuringVenueHours": false
    },
    "resubmission": {
      "allowedAfterRejection": true,
      "maxAttempts": 3
    }
  },
  "display": {
    "category": "Pizza",
    "difficulty": "easy",
    "emoji": "🍕",
    "neighborhood": "Lower East Side",
    "price": "$",
    "sortOrder": 1
  },
  "place": {
    "id": "plc_01...",
    "jellyPlaceId": "jpl_01...",
    "name": "Scarr's Pizza",
    "address": "35 Orchard St, New York, NY",
    "latitude": 40.7163,
    "longitude": -73.9914,
    "timeZone": "America/New_York",
    "hours": {
      "monday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "tuesday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "wednesday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "thursday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "friday": [{ "opensAt": "12:00", "closesAt": "00:00" }],
      "saturday": [{ "opensAt": "12:00", "closesAt": "00:00" }],
      "sunday": [{ "opensAt": "12:00", "closesAt": "23:00" }]
    }
  },
  "viewer": {
    "participationStatus": "not_started",
    "participationId": null,
    "missionRevision": null,
    "submissionDeadlineAt": null,
    "resubmissionDeadlineAt": null,
    "displayStatus": "not_started",
    "submissionStatus": null,
    "rewardStatus": "not_eligible",
    "latestSubmissionId": null,
    "startedAt": null,
    "canStart": true,
    "canSubmit": false,
    "canResubmit": false,
    "nextAction": "start_mission",
    "publicMessage": "Visit the place and start this mission in JellyJelly.",
    "updatedAt": null
  },
  "links": {
    "self": "/api/v2/jellyhunt/missions/mis_01...",
    "participation": null,
    "jellies": "/api/v2/jellyhunt/missions/mis_01.../jellies",
    "start": "https://platepost.io/human-social/missions/mis_01.../start",
    "directions": "https://www.google.com/maps/dir/?api=1&destination=40.7163,-73.9914"
  },
  "updatedAt": "2026-07-16T19:00:00Z"
}
```

`viewer` is omitted when unauthenticated. When a participation exists, it supplies `participationId`, locked `missionRevision`, both deadlines, and `links.participation`; clients fetch that immutable snapshot before rendering instructions or composing a post. Internal `approvalMode`, restaurant/tag matching values, exact geofence threshold, budget, and verification policy are not public fields. Hours are keyed by local weekday, may contain multiple intervals, and use the place timezone. An interval whose `closesAt` is less than or equal to `opensAt` closes on the following day; an empty weekday array means closed.

## User and mission status model

v2 represents submission/review and reward delivery separately.

### Participation status, revision lock, and recovery

The mission-level viewer state is `not_started` or `started`. Durable participation records use `started`, `expired`, or `replaced`; a replaced record includes `replacementParticipationId`. At most one `started` participation exists per Jelly subject and mission.

```http
PUT /api/v2/jellyhunt/missions/{missionId}/participation
Authorization: Bearer <jelly-mission-token>
Content-Type: application/json
```

```json
{ "expectedMissionRevision": 7 }
```

The first successful call returns `201`; an exact replay against the same active revision returns `200`:

```json
{
  "data": {
    "id": "par_01...",
    "status": "started",
    "missionId": "mis_01...",
    "missionRevision": 7,
    "jellyPlaceId": "jpl_01...",
    "startedAt": "2026-08-05T18:10:00Z",
    "submissionDeadlineAt": "2026-08-06T18:10:00Z",
    "resubmissionDeadlineAt": null,
    "canStart": false,
    "canSubmit": true,
    "canResubmit": false
  },
  "links": {
    "self": "/api/v2/jellyhunt/participations/par_01..."
  }
}
```

PUT behavior is deterministic:

- No active participation plus `expectedMissionRevision` equal to the current startable revision creates one.
- The same subject, mission, and active revision returns the existing record without changing `startedAt`.
- A different expected revision while an active participation exists returns `409 participation_revision_locked` and a safe link to the existing participation; PlatePost never silently moves the user to new terms.
- When `submissionDeadlineAt` passes with no live submission or resubmission window, a sweeper marks the record `expired`. A later valid start creates the current revision and marks the prior history record `replaced`.
- `canStart` is true only when no active participation exists and the current mission is startable. `canSubmit` is true only when a started participation is inside its initial or resubmission deadline, current safety controls permit intake, the attempt limit is not reached, and no live attempt exists.

PlatePost stores the complete revisioned task, proof, place, schedule, and reward terms. A material admin edit creates a new immutable revision; it never mutates started terms. The default initial submission grace is 24 hours, capped by the snapshotted mission end. A safety/legal pause blocks intake on every revision and requires an audited cancellation, review, or compensation path.

An authenticated mission detail always describes the current catalog revision. Its `viewer` and `links.participation` identify any locked participation. After start—and especially after app restart or a later mission edit—the client renders the owner-only snapshot, not the current mission:

```http
GET /api/v2/jellyhunt/participations/{participationId}
Authorization: Bearer <jelly-mission-token>
```

Another owner receives `404 participation_not_found`. The response is private/no-store:

```json
{
  "data": {
    "id": "par_01...",
    "status": "started",
    "missionId": "mis_01...",
    "missionRevision": 7,
    "isCurrentMissionRevision": false,
    "startedAt": "2026-08-05T18:10:00Z",
    "submissionDeadlineAt": "2026-08-06T18:10:00Z",
    "resubmissionDeadlineAt": null,
    "attemptsUsed": 1,
    "maxAttempts": 3,
    "latestSubmissionId": "sub_01...",
    "terms": {
      "title": "The Scarr's Cheese Pull",
      "description": "Order one slice and film the cheese pull.",
      "instructions": ["Visit the venue.", "Publish the requested Jelly."],
      "missionWindow": {
        "startsAt": "2026-08-01T16:00:00Z",
        "endsAt": "2026-08-31T23:00:00Z"
      },
      "reward": {
        "amount": "60",
        "token": "JELLY-MY-JELLY",
        "displayName": "Jelly-My-Jelly"
      },
      "requirements": {
        "post": {
          "allowedPostTypes": ["video"],
          "authorshipPolicy": "canonical_owner",
          "prompt": "Film the cheese pull and your first reaction.",
          "minDurationSeconds": 5,
          "maxDurationSeconds": 90,
          "requiredVisibility": "public"
        },
        "place": { "attachmentRequired": true },
        "location": { "required": true, "trustedSource": "jelly_post" },
        "schedule": {
          "mustBeWithinMissionWindow": true,
          "mustBeDuringVenueHours": false
        },
        "resubmission": { "allowedAfterRejection": true, "maxAttempts": 3 }
      },
      "place": {
        "id": "plc_01...",
        "jellyPlaceId": "jpl_01...",
        "name": "Scarr's Pizza",
        "address": "35 Orchard St, New York, NY",
        "latitude": 40.7163,
        "longitude": -73.9914,
        "timeZone": "America/New_York"
      }
    },
    "currentControls": {
      "acceptingSubmissions": true,
      "reasonCode": null
    },
    "canStart": false,
    "canSubmit": false,
    "canResubmit": false,
    "nextAction": "wait_for_review",
    "publicMessage": "Your Jelly is waiting for review.",
    "updatedAt": "2026-08-05T18:42:20Z"
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T18:42:21Z"
  },
  "links": {
    "mission": "/api/v2/jellyhunt/missions/mis_01...",
    "latestSubmission": "/api/v2/jellyhunt/submissions/sub_01..."
  }
}
```

The `terms` object is the complete immutable mission snapshot schema: instructions, mission window, reward, all structured requirements, display data, and reviewed place/hours. It remains readable after the canonical mission is archived.

A rejection does not collide with the 24-hour start deadline. When resubmission is allowed and `attemptsUsed < maxAttempts`, PlatePost creates a same-amount `resubmission_hold` and sets `resubmissionDeadlineAt = min(rejectedAt + 24 hours, campaign.claimsCloseAt)`. The same locked revision remains effective even after public mission end. `canResubmit` is true only during that window, while safety controls permit intake and no newer attempt is live. A new attempt consumes the hold; expiry, `attempt_limit_reached`, or claims closure releases it transactionally. The old rejected attempt remains immutable.

### Verification and decision status

- `verification.status` is `pending`, `in_progress`, `complete`, or `unavailable`.
- `decision.status` is `pending`, `approved`, or `rejected`.
- `complete` means Jelly evidence was recorded; it does not itself mean approved. `unavailable` cannot pair with an approved decision when the missing component is required.

### Submission status

- `submitted` — PlatePost accepted the immutable attempt.
- `verifying` — Jelly proof is being checked.
- `needs_review` — verification completed or was unavailable and an operator decision is required.
- `approved` — the completion was approved. This does not mean the token transfer is complete.
- `rejected` — the attempt is final and did not qualify, or a paid completion was later removed by the restricted post-payment moderation operation. A new post may be submitted only when `canResubmit` is true; it is always false for a paid moderated completion.

### Reward status

- `not_eligible` — the submission is not approved.
- `queued` — an approved, budget-reserved reward is queued.
- `processing` — Jelly may be executing the transfer.
- `sent` — Jelly returned a canonical successful receipt/transaction. This remains immutable when post-payment moderation later rejects the submission and reverses its ranking completion.
- `failed` — Jelly confirmed no transfer was created; operator retry may be possible.
- `uncertain` — Jelly may have processed the transfer; lookup/reconciliation is required and no blind retry is allowed.

### Derived display status

- `not_started`
- `in_progress`
- `submitted`
- `under_review`
- `approved_reward_pending`
- `rewarded`
- `rewarded_removed_from_rankings`
- `rejected`
- `support_needed`
The server derives those values exactly:

| Participation/submission/reward condition | `displayStatus` |
| --- | --- |
| no participation | `not_started` |
| started, no submission | `in_progress` |
| submission `submitted` | `submitted` |
| submission `verifying` or `needs_review` | `under_review` |
| submission `approved` + reward `queued` or `processing` | `approved_reward_pending` |
| submission `approved` + reward `sent` | `rewarded` |
| submission `rejected` + reward `sent` + reason `post_became_ineligible_after_reward` | `rewarded_removed_from_rankings` |
| submission `rejected` + reward `not_eligible` | `rejected` |
| submission `approved` + reward `failed` or `uncertain` | `support_needed` |

Clients render the server-provided `displayStatus`, `publicMessage`, and `nextAction`; they do not reimplement the transition table.

Closed `nextAction` values are `start_mission`, `publish_jelly`, `submit_post`, `wait_for_verification`, `wait_for_review`, `wait_for_reward`, `view_reward`, `submit_new_post`, `contact_support`, and `none`.

Safe client reason codes are `manual_review_required`, `verification_delayed`, `post_not_found`, `post_not_eligible`, `post_became_ineligible`, `post_became_ineligible_after_reward`, `author_mismatch`, `place_mismatch`, `outside_mission_area`, `attempt_limit_reached`, `resubmission_window_closed`, `reward_delayed`, `reward_failed`, and `reward_reconciling`. Availability reason codes are `campaign_upcoming`, `mission_upcoming`, `mission_paused`, `mission_ended`, and `reward_capacity_exhausted`. Unknown additive reason codes render the supplied `publicMessage`.

### Allowed transitions

| Submission status | Reward status | Allowed next state |
| --- | --- | --- |
| `submitted` | `not_eligible` | `verifying` or `needs_review` |
| `verifying` | `not_eligible` | `needs_review`, `approved`, or `rejected` |
| `needs_review` | `not_eligible` | `approved` or `rejected` |
| `approved` | `queued` | reward `processing`, or the canonical audited approval-reversal mutation produces submission `rejected` + reward `not_eligible` when the pre-payout Jelly recheck fails |
| `approved` | `processing` | reward `sent`, `failed`, or `uncertain` |
| `approved` | `sent` | only the restricted named-operator post-payment moderation mutation may produce submission `rejected` + reward `sent`; reward receipt/reservation fields do not change |
| `approved` | `failed` | reward `queued` after a confirmed operator retry |
| `approved` | `uncertain` | reward `sent` or `failed` only after Jelly lookup/reconciliation |
| `rejected` | `not_eligible` | no mutation of the old attempt; the user may create a new attempt with a new Jelly post |
| `rejected` | `sent` | terminal paid-moderation state; no resubmission, reward retry, release, or clawback |

A failed pre-payout recheck after approval is not an ordinary rejection. The same Convex transaction reverses the durable approved-completion fact and both affected leaderboard projections, emits `post_became_ineligible`, and records the audit/outbox event before returning. Replaying that reversal is idempotent.

The exact owner-status fixture after post-payment moderation is:

```json
{
  "submissionStatus": "rejected",
  "rewardStatus": "sent",
  "displayStatus": "rewarded_removed_from_rankings",
  "reasonCode": "post_became_ineligible_after_reward",
  "publicMessage": "Reward sent; completion later removed from rankings.",
  "canResubmit": false,
  "nextAction": "contact_support"
}
```

The paid receipt, transaction identity, `approvedAt`, and rewarded history remain present in the full submission resource. The completion is reversed for both eligible standings, and `canStart`, `canSubmit`, and `canResubmit` are false. The frozen v1 adapter retains its last `reward_sent` projection because v1 has no safe representation for this new v2-only state; v1 never drives standings and remains on its retirement path.

Status events are append-only. An old submission is never rewritten into a new attempt.

## End-to-end native mission flow

1. JellyJelly fetches `/campaigns/current` and `/missions`; it does not ship mission constants.
2. The user opens a mission detail and the app fetches `/missions/{missionId}` with a fresh mission token.
3. The PlatePost HTTPS start link `https://platepost.io/human-social/missions/{missionId}/start` is the universal/app link. It opens the JellyJelly mission composer when installed and otherwise shows the PlatePost desktop/QR plus iOS and Android choices. The old bare custom scheme remains a temporary fallback only.
4. JellyJelly calls `PUT /missions/{missionId}/participation` when the user confirms Start, preserving `startedAt` and the `in_progress` status.
5. PlatePost returns `participationId`, locked `missionRevision`, and `submissionDeadlineAt`; JellyJelly passes those plus `jellyPlaceId` into its post composer. It does not accept proof or reward terms from the URL.
6. The user records and publishes in JellyJelly. Jelly returns the canonical post ID only after the post record is created.
7. JellyJelly calls `POST /missions/{missionId}/submissions` with the participation ID, locked revision, post ID, and an idempotency key. PlatePost derives the user from the mission token and snapshots the participation terms.
8. PlatePost verifies through Jelly, records review and reward transitions, and emits an ordered webhook/event.
9. JellyJelly refreshes `/submissions/{submissionId}` after a push/webhook signal or polls `/me/events` while work is pending.
10. The app displays approval separately from reward settlement and links a sent reward to the canonical Jelly transaction receipt.

The start link never carries a user ID, reward amount, proof tag, geofence, or arbitrary callback URL. This prevents link tampering and open redirects.

## Submission creation

```http
POST /api/v2/jellyhunt/missions/{missionId}/submissions
Authorization: Bearer <jelly-mission-token>
Idempotency-Key: <client-generated UUID or ULID>
Content-Type: application/json
```

Request:

```json
{
  "participationId": "par_01...",
  "missionRevision": 7,
  "jellyPostId": "01K...",
  "clientLocation": {
    "latitude": 40.7164,
    "longitude": -73.9915,
    "accuracyMeters": 12,
    "capturedAt": "2026-08-05T18:42:10Z"
  }
}
```

Rules:

- The subject comes only from the verified bearer token.
- `missionId` comes only from the path.
- `participationId`, `missionRevision`, and `jellyPostId` are required. The participation must belong to the token subject and path mission, remain inside `submissionDeadlineAt`, and exactly match its immutable revision.
- Client coordinates are an untrusted claim. PlatePost never treats them as Jelly-owned location proof.
- The client may not send a reward amount, proof tag, place ID, approval mode, user ID, post URL, or alternate mission terms.
- `Idempotency-Key` is required. PlatePost rejects unknown body fields, validates the schema, computes SHA-256 over RFC 8785 JSON Canonicalization Scheme bytes, and retains that request hash with the exact original response.
- Same key and same subject/method/path/request returns the original HTTP status, body, and `Location` with `Idempotent-Replayed: true`.
- The key is scoped to the authenticated subject, HTTP method, and normalized path. Within that scope, the same key with a different canonical request returns `409 idempotency_key_reused`; a different scope is independent.
- The normalized path is the router-resolved v2 path with RFC 3986 dot segments removed, unreserved characters decoded, percent-hex uppercased, and a trailing slash removed except at root. Query parameters are absent from this write route. Replays keep the exact original JSON body (including its original meta request ID) and `Location`; the transport gets a new `X-Request-Id` plus `Idempotency-Original-Request-Id`.
- Accepted responses and deterministic 4xx responses finalize the record; transient `429`/`5xx` outcomes do not. An in-progress record has a 60-second `processingExpiresAt` lease; a concurrent request receives `409 idempotency_in_progress` with `Retry-After`. After lease expiry, a reclaim mutation first proves transactionally that no submission or reservation committed. If durable rows exist it finalizes from them; only proven absence permits the original handler to run again. Full response replay is guaranteed through the retention window; an expired tombstone returns `409 idempotency_record_expired` and never becomes a new request.
- Before creating a reservation, PlatePost performs a bounded exact-Jelly preflight to confirm that the post exists and belongs to the authenticated subject. A Jelly outage returns retryable `503 dependency_unavailable` without accepting or rejecting the submission and without reserving capacity; full place/location/policy evaluation remains asynchronous.
- A Jelly post can be used by only one JellyHunt submission globally. v2 returns generic `409 submission_conflict` for every uniqueness conflict and never reveals whether another user or mission previously used the post; the exact conflict is internal audit data. v1 keeps its legacy error behavior for compatibility.
- A user can have only one non-rejected attempt per mission.
- A rejected attempt may be followed by a new attempt using the same participation revision, a different Jelly post, and a new idempotency key only while `canResubmit` is true; otherwise PlatePost returns `409 attempt_limit_reached` or `409 participation_expired` as applicable.
- Mission revision, place/proof requirements, reward terms, and reservation are captured atomically.

New response:

```http
HTTP/1.1 202 Accepted
Location: /api/v2/jellyhunt/submissions/sub_01...
```

```json
{
  "data": {
    "id": "sub_01...",
    "missionId": "mis_01...",
    "attempt": 1,
    "jellyPost": {
      "id": "01K...",
      "watchUrl": "https://jellyjelly.com/watch/01K..."
    },
    "submissionStatus": "submitted",
    "reward": {
      "status": "not_eligible",
      "amount": "60",
      "token": "JELLY-MY-JELLY",
      "transactionId": null
    },
    "displayStatus": "submitted",
    "publicMessage": "Your Jelly was submitted and is being checked.",
    "canResubmit": false,
    "submittedAt": "2026-08-05T18:42:11Z",
    "updatedAt": "2026-08-05T18:42:11Z"
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T18:42:11Z"
  },
  "links": {
    "self": "/api/v2/jellyhunt/submissions/sub_01...",
    "mission": "/api/v2/jellyhunt/missions/mis_01...",
    "events": "/api/v2/jellyhunt/submissions/sub_01.../events"
  }
}
```

## Submission detail and history

`GET /submissions/{submissionId}` is owner-only. It returns safe component status and embeds at most the newest 20 timeline entries, ordered by `sequence ASC` within that page:

```json
{
  "data": {
    "id": "sub_01...",
    "mission": {
      "id": "mis_01...",
      "revision": 7,
      "title": "The Scarr's Cheese Pull"
    },
    "attempt": 1,
    "jellyPost": {
      "id": "01K...",
      "watchUrl": "https://jellyjelly.com/watch/01K..."
    },
    "submissionStatus": "needs_review",
    "verification": {
      "status": "complete",
      "attempts": 1,
      "reasonCode": "manual_review_required",
      "checkedAt": "2026-08-05T18:42:20Z"
    },
    "decision": {
      "status": "pending",
      "reasonCode": null,
      "message": null,
      "decidedAt": null
    },
    "reward": {
      "id": null,
      "status": "not_eligible",
      "amount": "60",
      "token": "JELLY-MY-JELLY",
      "transactionId": null,
      "sentAt": null
    },
    "displayStatus": "under_review",
    "publicMessage": "Your Jelly is waiting for review.",
    "canResubmit": false,
    "nextAction": "wait_for_review",
    "timeline": [
      {
        "sequence": 1,
        "type": "submission.created",
        "submissionStatus": "submitted",
        "rewardStatus": "not_eligible",
        "displayStatus": "submitted",
        "occurredAt": "2026-08-05T18:42:11Z"
      },
      {
        "sequence": 2,
        "type": "verification.started",
        "submissionStatus": "verifying",
        "rewardStatus": "not_eligible",
        "displayStatus": "under_review",
        "occurredAt": "2026-08-05T18:42:12Z"
      },
      {
        "sequence": 3,
        "type": "verification.needs_review",
        "submissionStatus": "needs_review",
        "rewardStatus": "not_eligible",
        "displayStatus": "under_review",
        "reasonCode": "manual_review_required",
        "occurredAt": "2026-08-05T18:42:20Z"
      }
    ],
    "submittedAt": "2026-08-05T18:42:11Z",
    "updatedAt": "2026-08-05T18:42:20Z"
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T18:42:21Z"
  },
  "links": {
    "mission": "/api/v2/jellyhunt/missions/mis_01...",
    "events": "/api/v2/jellyhunt/submissions/sub_01.../events"
  }
}
```

The native response does not expose exact verified coordinates, fraud thresholds, internal summaries, operator identity, raw reward errors, or business wallet data.

Every timeline entry carries the three after-state fields `submissionStatus`, `rewardStatus`, and `displayStatus`; clients never interpret a generic `status` field. `GET /submissions/{submissionId}/events?cursor=<opaque>&limit=50` defaults to 50, allows at most 100, orders by `sequence DESC`, and uses `nextCursor` to page toward older events.

`GET /me/submissions` supports:

```text
missionId, submissionStatus, rewardStatus, updatedAfter, cursor, limit
```

It includes ended and archived missions, defaults to 20, allows at most 100, and orders by `updatedAt DESC, submissionId ASC`. `GET /me/missions?campaignId=<id>&participationStatus=<status>&cursor=<opaque>&limit=20` returns the latest attempt plus `canSubmit`, `canResubmit`, and `nextAction` for every relevant campaign mission. It defaults to 20 items, allows at most 100, and orders deterministically by `updatedAt DESC, missionId ASC`. `participationStatus` is `not_started` or `started`. This fixes the current behavior where user status disappears once a mission is no longer active.

`GET /me/events?after=<opaque>&limit=50` provides an ordered, lightweight polling feed. It defaults to 50, allows at most 100, and orders by the authenticated user's monotonic event sequence ascending after the cursor. Event sequence is scoped to the authenticated user and permits the app to refresh only affected resources.

`GET /leaderboards/current-season?cursor=<opaque>&limit=20` and `GET /leaderboards/all-time?cursor=<opaque>&limit=20` default to 20 and allow at most 100. They rank by non-reversed approved user/mission completions, independently from reward delivery. Equal totals share competition rank and use canonical username plus stable public entry ID for deterministic presentation. The all-time epoch is the launch of the new PlatePost tool, not pre-PlatePost history. Neither route exposes Jelly user IDs.

### Personal resource fixtures

`GET /me?campaignId=<optional>` uses the selected current campaign when omitted:

```json
{
  "data": {
    "subject": {
      "jellyUserId": "canonical-jelly-user-uuid"
    },
    "campaign": {
      "id": "cam_01...",
      "status": "active",
      "statusCounts": {
        "notStarted": 8,
        "inProgress": 2,
        "submitted": 1,
        "underReview": 1,
        "approvedRewardPending": 0,
        "rewarded": 3,
        "rejected": 1,
        "supportNeeded": 0
      },
      "confirmedRewards": {
        "amount": "180",
        "token": "JELLY-MY-JELLY"
      },
      "latestEventSequence": 42,
      "updatedAt": "2026-08-05T19:00:00Z"
    }
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T19:00:01Z"
  },
  "links": {
    "missions": "/api/v2/jellyhunt/me/missions?campaignId=cam_01...",
    "submissions": "/api/v2/jellyhunt/me/submissions?campaignId=cam_01...",
    "events": "/api/v2/jellyhunt/me/events"
  }
}
```

`confirmedRewards` counts only canonical sent receipts. PlatePost does not duplicate Jelly profile fields.

`GET /me/missions` items combine the current catalog summary with the viewer's locked participation:

```json
{
  "data": {
    "missions": [
      {
        "mission": {
          "id": "mis_01...",
          "revision": 8,
          "title": "The Scarr's Cheese Pull",
          "availability": {
            "state": "available",
            "acceptingSubmissions": true,
            "reasonCode": null
          },
          "reward": { "amount": "60", "token": "JELLY-MY-JELLY" },
          "display": {
            "emoji": "🍕",
            "category": "Pizza",
            "difficulty": "easy",
            "neighborhood": "Lower East Side"
          },
          "place": {
            "id": "plc_01...",
            "name": "Scarr's Pizza",
            "latitude": 40.7163,
            "longitude": -73.9914
          }
        },
        "participationStatus": "started",
        "participation": {
          "id": "par_01...",
          "missionRevision": 7,
          "startedAt": "2026-08-05T18:10:00Z",
          "submissionDeadlineAt": "2026-08-06T18:10:00Z",
          "resubmissionDeadlineAt": null
        },
        "latestSubmission": {
          "id": "sub_01...",
          "attempt": 1,
          "submissionStatus": "needs_review",
          "rewardStatus": "not_eligible",
          "displayStatus": "under_review",
          "updatedAt": "2026-08-05T18:42:20Z"
        },
        "canStart": false,
        "canSubmit": false,
        "canResubmit": false,
        "nextAction": "wait_for_review",
        "reasonCode": "manual_review_required",
        "publicMessage": "Your Jelly is waiting for review.",
        "updatedAt": "2026-08-05T18:42:20Z",
        "links": {
          "mission": "/api/v2/jellyhunt/missions/mis_01...",
          "participation": "/api/v2/jellyhunt/participations/par_01...",
          "latestSubmission": "/api/v2/jellyhunt/submissions/sub_01..."
        }
      }
    ]
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T19:00:01Z",
    "page": { "limit": 20, "nextCursor": null, "hasMore": false }
  }
}
```

For `not_started`, `participation`, `latestSubmission`, and their links are null.

`GET /me/submissions` returns summaries; imported history uses `source: legacy` and may have null `participationId`:

```json
{
  "data": {
    "submissions": [
      {
        "id": "sub_01...",
        "source": "native",
        "attempt": 1,
        "participationId": "par_01...",
        "mission": {
          "id": "mis_01...",
          "revision": 7,
          "title": "The Scarr's Cheese Pull"
        },
        "jellyPost": {
          "id": "01K...",
          "watchUrl": "https://jellyjelly.com/watch/01K..."
        },
        "submissionStatus": "approved",
        "reward": {
          "id": "rwd_01...",
          "status": "processing",
          "amount": "60",
          "token": "JELLY-MY-JELLY",
          "transactionId": null,
          "sentAt": null
        },
        "displayStatus": "approved_reward_pending",
        "reasonCode": null,
        "publicMessage": "Approved. Your reward is being sent.",
        "canResubmit": false,
        "nextAction": "wait_for_reward",
        "submittedAt": "2026-08-05T18:42:11Z",
        "updatedAt": "2026-08-05T19:00:00Z",
        "links": {
          "self": "/api/v2/jellyhunt/submissions/sub_01...",
          "events": "/api/v2/jellyhunt/submissions/sub_01.../events",
          "mission": "/api/v2/jellyhunt/missions/mis_01..."
        }
      }
    ]
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T19:00:01Z",
    "page": {
      "limit": 20,
      "nextCursor": "opaque-or-null",
      "hasMore": true
    }
  }
}
```

`GET /me/events` uses a subject-global monotonic sequence. Initial event types are `jellyhunt.participation.started`, `jellyhunt.participation.expired`, `jellyhunt.participation.replaced`, `jellyhunt.submission.created`, `jellyhunt.submission.status_changed`, `jellyhunt.reward.status_changed`, and viewer-relevant mission paused/updated events:

```json
{
  "data": {
    "events": [
      {
        "id": "evt_01...",
        "sequence": 42,
        "type": "jellyhunt.reward.status_changed",
        "entity": {
          "type": "reward_intent",
          "id": "rwd_01...",
          "sequence": 3
        },
        "changes": {
          "participationStatus": "started",
          "submissionStatus": "approved",
          "rewardStatus": "sent",
          "displayStatus": "rewarded",
          "reasonCode": null,
          "publicMessage": "Your reward was sent."
        },
        "occurredAt": "2026-08-05T19:00:00Z",
        "links": {
          "submission": "/api/v2/jellyhunt/submissions/sub_01..."
        }
      }
    ]
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T19:00:01Z",
    "page": {
      "limit": 50,
      "nextCursor": "opaque-after-sequence-42",
      "hasMore": false
    }
  }
}
```

Events are notifications; clients refresh the linked resource. All nullable fields shown above are explicit JSON nulls, not omitted, except optional additive fields introduced by later minor versions.

## Place-linked Jelly content

`GET /places/{placeId}` is anonymous, semantically ETagged, and never exposes a geofence or any user's verified coordinates:

```json
{
  "data": {
    "id": "plc_01...",
    "revision": 9,
    "jellyPlaceId": "jpl_01...",
    "name": "Scarr's Pizza",
    "address": "35 Orchard St, New York, NY",
    "latitude": 40.7163,
    "longitude": -73.9914,
    "timeZone": "America/New_York",
    "hours": {
      "monday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "tuesday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "wednesday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "thursday": [{ "opensAt": "12:00", "closesAt": "23:00" }],
      "friday": [{ "opensAt": "12:00", "closesAt": "00:00" }],
      "saturday": [{ "opensAt": "12:00", "closesAt": "00:00" }],
      "sunday": [{ "opensAt": "12:00", "closesAt": "23:00" }]
    },
    "source": {
      "system": "jelly",
      "revision": 9,
      "updatedAt": "2026-07-16T19:00:00Z",
      "syncedAt": "2026-07-16T19:05:00Z"
    },
    "updatedAt": "2026-07-16T19:05:00Z"
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-07-16T20:00:00Z"
  },
  "links": {
    "self": "/api/v2/jellyhunt/places/plc_01...",
    "jellies": "/api/v2/jellyhunt/places/plc_01.../jellies",
    "directions": "https://www.google.com/maps/dir/?api=1&destination=40.7163,-73.9914"
  }
}
```

```http
GET /api/v2/jellyhunt/missions/{missionId}/jellies?cursor=<opaque>&limit=20
```

PlatePost resolves the mission's `jellyPlaceId`, calls the Jelly partner place-content endpoint, and normalizes the result:

```json
{
  "data": {
    "jellies": [
      {
        "id": "01K...",
        "postType": "video",
        "author": {
          "id": "user-uuid",
          "username": "ari",
          "displayName": "Ari",
          "avatarUrl": "https://..."
        },
        "title": "Best slice on Orchard",
        "summary": "...",
        "thumbnailUrl": "https://...signed...",
        "mediaExpiresAt": "2026-08-05T19:45:00Z",
        "watchUrl": "https://jellyjelly.com/watch/01K...",
        "postedAt": "2026-08-05T18:30:00Z"
      }
    ],
    "source": "jelly",
    "sourceStatus": "live"
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-05T18:45:00Z",
    "page": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  },
  "links": {}
}
```

Rules:

- PlatePost stores Jelly IDs, not long-lived signed media URLs.
- Cache lifetime must not exceed the upstream URL expiry; refresh on demand.
- If a place is not linked, return `200` with an empty array and `sourceStatus: "place_not_linked"`; never guess by text, generic topics, or `xdata`.
- If Jelly is unavailable and a valid stale cache exists, return the cache with `sourceStatus: "stale"` and its age. Without a safe cache, return `503 dependency_unavailable`.
- A mission list does not embed place feeds, avoiding an N+1 Jelly call for every marker.

## Required Jelly partner APIs

These are Jelly-owned APIs that PlatePost consumes. They are prerequisites for production automatic verification and restaurant/place feeds.

### Canonical place

```http
GET /partner/v1/jellyhunt/places/{jellyPlaceId}
Authorization: Bearer <platepost-partner-credential>
```

```json
{
  "place": {
    "id": "jpl_01...",
    "revision": 9,
    "status": "active",
    "name": "Scarr's Pizza",
    "address": "35 Orchard St, New York, NY",
    "latitude": 40.7163,
    "longitude": -73.9914,
    "timeZone": "America/New_York",
    "updatedAt": "2026-07-16T19:00:00Z"
  }
}
```

PlatePost imports/refreshes this into a reviewed snapshot. A Jelly place update never mutates an already-created submission snapshot.

### Place-indexed public Jellies

```http
GET /partner/v1/jellyhunt/places/{jellyPlaceId}/jellies?cursor=<opaque>&limit=20
Authorization: Bearer <platepost-partner-credential>
```

```json
{
  "place": {
    "id": "jpl_01...",
    "revision": 9
  },
  "jellies": [
    {
      "id": "01K...",
      "revision": 4,
      "state": "ready",
      "visibility": "public",
      "moderationStatus": "clear",
      "postType": "video",
      "durationSeconds": 31.4,
      "author": {
        "id": "canonical-jelly-user-uuid",
        "username": "ari",
        "displayName": "Ari",
        "avatarUrl": "https://..."
      },
      "title": "Best slice on Orchard",
      "summary": "A first bite at Scarr's.",
      "thumbnailUrl": "https://...signed...",
      "mediaExpiresAt": "2026-08-05T19:45:00Z",
      "watchUrl": "https://jellyjelly.com/watch/01K...",
      "placeAssociation": {
        "placeId": "jpl_01...",
        "source": "server_place_relation",
        "associatedAt": "2026-08-05T18:30:00Z"
      },
      "postedAt": "2026-08-05T18:30:00Z",
      "updatedAt": "2026-08-05T18:31:00Z"
    }
  ],
  "page": {
    "limit": 20,
    "nextCursor": null,
    "hasMore": false
  },
  "generatedAt": "2026-08-05T18:45:00Z"
}
```

The feed orders by `postedAt DESC, jellyId ASC` and returns only ready, public, non-deleted, moderation-clear Jellies with a server-owned association to that exact place. It never derives association from topics, transcript, title, or client `xdata`. Signed media expiry is explicit. An active place with no posts returns `200` and an empty array; an unknown place returns `404 jelly_place_not_found`. The cursor binds the place ID, normalized filters, and feed revision.

### Exact post ownership preflight

Before PlatePost creates a submission, uniqueness claim, or reservation, it calls:

```http
POST /partner/v1/jellyhunt/posts/{postId}/preflight
Authorization: Bearer <platepost-partner-credential>
Content-Type: application/json
```

```json
{
  "submissionId": "sub_01...",
  "userId": "canonical-jelly-user-uuid",
  "authorshipPolicy": "canonical_owner"
}
```

```json
{
  "preflightVersion": "1",
  "ownershipStatus": "matched",
  "reasonCodes": [],
  "post": {
    "id": "01K...",
    "canonicalOwnerUserId": "canonical-jelly-user-uuid",
    "eligibleParticipantIds": ["canonical-jelly-user-uuid"],
    "postType": "video",
    "durationSeconds": 31.4,
    "state": "processing",
    "visibility": "public",
    "moderationStatus": "clear",
    "deletedAt": null,
    "postedAt": "2026-08-05T18:30:00Z",
    "placeId": "jpl_01...",
    "observedAt": "2026-08-05T18:42:10Z"
  }
}
```

`ownershipStatus` is `matched` or `mismatched`. Unknown posts return `404 post_not_found`; an unavailable lookup returns retryable `503 dependency_unavailable`. Launch missions use `authorshipPolicy: canonical_owner`, so only `canonicalOwnerUserId == userId` may submit. `eligibleParticipantIds` is provided for a future explicitly reviewed collaborative policy but does not grant eligibility under the launch policy. A matched preflight may report a still-processing post; readiness and all other mission requirements remain subject to component verification.

### Component-level mission verification

```http
POST /partner/v1/jellyhunt/submissions/verify
Authorization: Bearer <platepost-partner-credential>
Idempotency-Key: verify:<submissionPublicId>:<attempt>
Content-Type: application/json
```

Request terms come from the immutable PlatePost submission snapshot:

```json
{
  "submissionId": "sub_01...",
  "verificationAttempt": 1,
  "missionId": "mis_01...",
  "missionRevision": 7,
  "userId": "canonical-jelly-user-uuid",
  "postId": "01K...",
  "expectedPlaceId": "jpl_01...",
  "postRequirements": {
    "allowedPostTypes": ["video"],
    "authorshipPolicy": "canonical_owner",
    "minDurationSeconds": 5,
    "maxDurationSeconds": 90,
    "requiredVisibility": "public"
  },
  "missionWindow": {
    "startsAt": "2026-08-01T16:00:00Z",
    "endsAt": "2026-08-31T23:00:00Z"
  },
  "placeSnapshot": {
    "latitude": 40.7163,
    "longitude": -73.9914,
    "geofenceRadiusMeters": 75
  }
}
```

Response:

```json
{
  "verificationId": "jvr_01...",
  "evidenceVersion": "1",
  "evidenceStatus": "complete",
  "reasonCodes": [],
  "post": {
    "id": "01K...",
    "canonicalOwnerUserId": "canonical-jelly-user-uuid",
    "eligibleParticipantIds": ["canonical-jelly-user-uuid"],
    "postType": "video",
    "durationSeconds": 31.4,
    "state": "ready",
    "visibility": "public",
    "moderationStatus": "clear",
    "postedAt": "2026-08-05T18:30:00Z",
    "deletedAt": null,
    "observedAt": "2026-08-05T18:42:19Z"
  },
  "proof": {
    "author": {
      "policy": "canonical_owner",
      "matched": true,
      "canonicalOwnerUserId": "canonical-jelly-user-uuid",
      "eligibleParticipantIds": ["canonical-jelly-user-uuid"],
      "source": "jelly_post_record"
    },
    "place": {
      "matched": true,
      "actualPlaceId": "jpl_01...",
      "source": "server_place_relation"
    },
    "location": {
      "matched": true,
      "source": "trusted_post_gps",
      "latitude": 40.7164,
      "longitude": -73.9915,
      "accuracyMeters": 11,
      "capturedAt": "2026-08-05T18:29:20Z",
      "distanceMeters": 18
    }
  },
  "checkedAt": "2026-08-05T18:42:20Z"
}
```

Jelly reports evidence, not the mission decision. `evidenceStatus` is `complete`, `incomplete`, or `unavailable`; `reasonCodes` describe missing or negative evidence. PlatePost independently evaluates the immutable mission policy and alone computes `approved`, `needs_review`, or `rejected`. It verifies the returned post ID, canonical owner under the locked authorship policy, post type, duration, place ID, readiness, visibility, deletion/moderation, timestamps, coordinates, distance, and geofence. Missing, negative, inconsistent, or client-derived location evidence cannot yield automatic approval. A dependency outage follows the retry/review matrix below and never rejects the user solely because Jelly was down.

Stable Jelly verification reason codes include:

- `post_not_found`
- `post_not_ready`
- `post_deleted`
- `post_not_public`
- `post_moderated`
- `post_outside_mission_window`
- `post_type_mismatch`
- `duration_out_of_range`
- `author_mismatch`
- `place_mismatch`
- `location_unavailable`
- `location_untrusted`
- `outside_geofence`
- `dependency_unavailable`

PlatePost maps those to a smaller, safe public reason/message catalog.
The policy matrix is binding:

| Jelly evidence | PlatePost behavior | Approval rule |
| --- | --- | --- |
| `post_not_ready`, or `post_not_found` during the first 15 minutes after submission | Remain `verifying`; retry with bounded exponential backoff. After the window, move to `needs_review`. | Cannot approve until an exact authoritative post exists and is ready. |
| `dependency_unavailable` | Remain `verifying` while retries fit the review SLA; then `needs_review` with `verification_delayed`. | Operators may expedite retries but cannot substitute client evidence for Jelly evidence. |
| `post_deleted`, `post_not_public`, `post_moderated`, `post_outside_mission_window`, `author_mismatch`, or `place_mismatch` | Repeat one authoritative read to rule out propagation delay, then reject with a safe reason. | A named operator may re-run verification after an appeal, but cannot override a current authoritative negative. |
| `location_unavailable` or `location_untrusted` when trusted location is required | Retry for 15 minutes, then `needs_review`. | Cannot approve until Jelly returns trusted location. Client coordinates are never a substitute. |
| `outside_geofence` | Reject when trusted coordinates and accuracy make the result unambiguous; borderline accuracy/tolerance goes to `needs_review`. | A named operator may apply only the documented geofence tolerance to trusted Jelly coordinates. |
| Complete positive evidence for every required component | Apply mission policy and automatic/manual approval mode. | `approved` records `evidenceVersion`, `verificationId`, and `approvalCheckedAt`. |

Immediately before every reward attempt capable of initiating a transfer—including attempt `N+1`—PlatePost requests fresh readiness, visibility, deletion/moderation, canonical-owner, and place evidence. A new authoritative negative invokes the canonical approval-reversal mutation from the approved leaderboard extension: while the intent is queued, has no active worker lease, and no transfer-capable attempt has been accepted, that one mutation cancels the intent, releases or converts `approved_reserved`, changes the submission to `rejected` with `post_became_ineligible`, reverses the completion, updates both leaderboard projections/revisions, and emits `approval.revoked`. The worker lease may select only a queued intent backed by `approved_reserved`, so Convex transaction conflicts serialize the lease against reversal. This local check is advisory against races: the Jelly reward operation must repeat the guard atomically as specified below. Once a reward is `processing` or `uncertain`, PlatePost returns `reconciliation_required` and changes none of the approval, completion, projection, intent, or reservation state until Jelly proves no transfer occurred. After `sent`, the extension's named-operator post-payment moderation mutation keeps the paid reservation, receipt, transaction identity, and reward status immutable while atomically rejecting the submission with a public-safe reason, reversing its completion and standings, and emitting an owner-visible “reward sent; removed from rankings” status with no resubmission or second reward. It never automatically claws back or retries the payment.

### Reward intent and idempotent payout attempts

PlatePost creates one immutable `rewardIntentId` for each approved submission. A retry does not reuse one forever-failed request, and a new attempt does not create a second logical reward:

```http
POST /partner/v1/jellyhunt/reward-intents/{rewardIntentId}/attempts
Authorization: Bearer <platepost-reward-credential>
Idempotency-Key: reward:<rewardIntentId>:attempt:<attemptNumber>
Content-Type: application/json
```

```json
{
  "attemptNumber": 1,
  "submissionId": "sub_01...",
  "missionId": "mis_01...",
  "recipientUserId": "canonical-jelly-user-uuid",
  "jellyPostId": "01K...",
  "amount": "60",
  "token": "JELLY-MY-JELLY",
  "eligibilityGuard": {
    "authorshipPolicy": "canonical_owner",
    "canonicalOwnerUserId": "canonical-jelly-user-uuid",
    "requiredPostState": "ready",
    "requiredVisibility": "public",
    "requiredModerationStatus": "clear",
    "expectedPlaceId": "jpl_01..."
  },
  "note": "Thanks for completing The Scarr's Cheese Pull",
  "visibility": "private",
  "participantConsentId": null
}
```

Jelly resolves the recipient's eligible wallet from `recipientUserId`; PlatePost never chooses or sends a wallet address. `visibility` defaults to `private`. It may be `public` only when the campaign explicitly enables public rewards and the participant supplied auditable consent, identified by `participantConsentId`.

A `201` sent response or `202` accepted response uses the same receipt shape:

```json
{
  "rewardIntent": {
    "id": "rwd_01...",
    "status": "sent",
    "submissionId": "sub_01...",
    "missionId": "mis_01...",
    "jellyPostId": "01K...",
    "recipientUserId": "canonical-jelly-user-uuid",
    "amount": "60",
    "token": "JELLY-MY-JELLY",
    "decimals": 6,
    "latestAttemptNumber": 1,
    "transactionId": "canonical-jelly-transaction-id",
    "transactionHash": "optional-chain-hash",
    "acceptedAt": "2026-08-05T18:59:58Z",
    "sentAt": "2026-08-05T19:00:00Z",
    "updatedAt": "2026-08-05T19:00:00Z"
  },
  "attempt": {
    "number": 1,
    "status": "sent",
    "idempotencyKey": "reward:rwd_01...:attempt:1",
    "eligibility": {
      "postRevision": 4,
      "checkedAt": "2026-08-05T18:59:58Z"
    },
    "retryable": false,
    "final": true,
    "confirmedNoTransfer": false
  }
}
```

PlatePost reconciles every non-final result through:

```http
GET /partner/v1/jellyhunt/reward-intents/{rewardIntentId}
Authorization: Bearer <platepost-reward-credential>
```

The lookup returns the immutable intent terms, current `accepted | pending | sent | failed` status, canonical receipt when sent, and all attempts with `number`, `status`, `retryable`, `final`, `confirmedNoTransfer`, safe `reasonCode`, and timestamps. A `404 reward_intent_not_found` includes `confirmedAbsent` and `recheckAfter`; absence is not retry-safe until Jelly returns `confirmedAbsent: true` after its documented reconciliation window.
```json
{
  "rewardIntent": {
    "id": "rwd_01...",
    "status": "pending",
    "submissionId": "sub_01...",
    "missionId": "mis_01...",
    "jellyPostId": "01K...",
    "recipientUserId": "canonical-jelly-user-uuid",
    "amount": "60",
    "token": "JELLY-MY-JELLY",
    "decimals": 6,
    "transactionId": null,
    "transactionHash": null,
    "updatedAt": "2026-08-05T18:59:59Z"
  },
  "attempts": [
    {
      "number": 1,
      "status": "pending",
      "eligibility": {
        "postRevision": 4,
        "checkedAt": "2026-08-05T18:59:58Z"
      },
      "retryable": false,
      "final": false,
      "confirmedNoTransfer": false,
      "reasonCode": null,
      "acceptedAt": "2026-08-05T18:59:58Z",
      "updatedAt": "2026-08-05T18:59:59Z"
    }
  ]
}
```

A not-found body is explicit:

```json
{
  "error": {
    "code": "reward_intent_not_found",
    "confirmedAbsent": false,
    "recheckAfter": "2026-08-05T19:00:10Z"
  }
}
```

Jelly also exposes restricted reward-account capacity:

```http
GET /partner/v1/jellyhunt/reward-account/capacity?token=JELLY-MY-JELLY
Authorization: Bearer <platepost-reward-credential>
```

```json
{
  "token": "JELLY-MY-JELLY",
  "decimals": 6,
  "availableAmount": "25000",
  "perTransactionLimit": "500",
  "dailyRemaining": "10000",
  "enabled": true,
  "asOf": "2026-08-05T18:55:00Z"
}
```

The capacity response is operational evidence, not a substitute for PlatePost's campaign reservations. Amounts must be positive decimal strings with no more fractional digits than `decimals`.

Partner reward outcomes are closed and implementable:

| Outcome | HTTP and behavior |
| --- | --- |
| Sent synchronously | `201`; intent and attempt are final `sent`. |
| Accepted for processing | `202`; intent is `accepted` or `pending`; PlatePost records `processing` and polls lookup. |
| Exact replay or already-settled intent | `200`; returns the original attempt or the one canonical sent receipt. |
| Invalid JSON/schema/amount precision | `400`; `accepted: false`, no side effect. |
| Invalid/restricted credential | `401` or `403`; no side effect. |
| Key/payload mismatch, immutable-intent mismatch, or invalid attempt sequence | `409`; no new side effect. |
| Invalid/ineligible recipient, post guard failure, unsupported token, invalid amount, or insufficient funds | `422`; final for that attempt with `confirmedNoTransfer: true`. |
| Rate limited before acceptance | `429` with `Retry-After` and `accepted: false`; PlatePost checks lookup, then replays the same attempt key. |
| Dependency/server error or transport timeout | `5xx` or no response; outcome is `uncertain` until lookup, with no blind retry. |

Binding safety rules:

- Jelly durably stores the intent and attempt before initiating a transfer.
- Within the same serialized reward operation and before any transfer side effect, Jelly atomically re-reads the post and validates canonical owner, readiness, visibility, deletion/moderation, place, recipient, and the immutable payout tuple. This guard runs for every attempt. A failure returns `422 post_ineligible`, `final: true`, and `confirmedNoTransfer: true` and creates no transfer.
- One `rewardIntentId` can produce at most one successful transfer across every attempt. If any attempt already sent, every later call returns that same canonical receipt and creates nothing.
- Replaying the same attempt key and identical payload returns its original result. Reusing it with a different payload returns `409 idempotency_key_reused`.
- PlatePost replays the same attempt number only after lookup confirms that request was absent. It creates attempt `N+1` only after attempt `N` is final and Jelly explicitly returns `confirmedNoTransfer: true`.
- `sent` is final only after the transfer exists in Jelly's canonical ledger and satisfies Jelly's documented chain-finality policy. A transaction ID is globally stable and unique.
- Before recording `sent`, PlatePost compares reward intent ID, submission ID, mission ID, Jelly post ID, recipient user ID, amount, token, and transaction ID from lookup/receipt/webhook to its immutable snapshot. Any mismatch is `uncertain`, alerts operators, and never advances the reservation to paid.
- Jelly returns only safe reason codes: `recipient_not_found`, `recipient_ineligible`, `post_ineligible`, `unsupported_token`, `invalid_amount`, `insufficient_funds`, `rate_limited`, `dependency_unavailable`, and `transfer_failed`.
- The credential is restricted to the JellyHunt reward account, supported token, amount ceilings, and rate limits.
- PlatePost does not store restaurant account passwords or log raw payout bodies.

The existing `/crypto/send` route may be used only for a manual development pilot. Its request-body idempotency value is not enforced. A timeout or dropped response becomes `uncertain`; it is never automatically retried. Production automatic payouts require the intent/attempt contract above.

## Reward budgets and reservations

PlatePost must enforce reward capacity independently of the Jelly wallet:

1. Campaign, mission, day, verified-user, and live-submission limits are stored in Convex. Mission start does not reserve capacity.
2. Activation requires a valid reward amount, allocated campaign/mission capacity, a configured Jelly reward integration, and a successful capacity check. PlatePost rechecks Jelly capacity periodically, but never treats that volatile balance as permission to break an existing reservation.
3. Submission creation first enforces authentication, account eligibility/rate limits, one live attempt, global post uniqueness, mission availability, and remaining capacity. The same Convex transaction then creates the submission and a full `pending_verification` reservation for the immutable reward snapshot.
4. Each reservation has `reviewDeadlineAt`; the campaign default is 72 hours and must be disclosed in user-facing terms. Verification/review workers have shorter leases, but lease expiry never releases money.
5. A verified rejection with another attempt available converts the reservation to `resubmission_hold` through `resubmissionDeadlineAt`; the next attempt reuses it and expiry releases it. A final rejection or audited operator cancellation moves it to `released`. An unverified timeout, Jelly outage, worker failure, or mere review-deadline expiry does not reject the user and does not release it.
6. `needs_review` remains reserved. If any review exceeds its deadline, or the unresolved-reservation threshold is reached, a watchdog pauses new submissions for that mission, alerts operators, and surfaces `verification_delayed` to affected users.
7. Approval moves the same reservation to `approved_reserved`, then reward execution moves it through `processing` or `uncertain`; these states are never released automatically.
8. `sent` moves the reservation to `paid`. A Jelly-confirmed `failed` attempt remains reserved while an operator retries or completes an audited compensation/release workflow.
9. When unreserved capacity reaches zero, the mission returns `acceptingSubmissions: false`, new submissions receive `409 reward_capacity_exhausted`, and operators are alerted.

Reservation states are `pending_verification`, `resubmission_hold`, `approved_reserved`, `processing`, `uncertain`, `paid`, and `released`. Convex mutations enforce counters, limits, and state transitions transactionally under concurrency. A read-then-write balance increment is insufficient. Monitoring covers reservation age, unresolved ratio, worker lease age, PlatePost allocation, and Jelly capacity.

`reward_sent` is set only after a canonical Jelly receipt. A PlatePost display balance or leaderboard never substitutes for the actual Jelly transaction record.

## Deduplication and concurrency

The database enforces four independent invariants:

1. **HTTP idempotency:** within one subject/method/normalized-path scope, the same `Idempotency-Key` plus the same RFC 8785 canonical request returns the exact stored original response; a different request in that scope conflicts.
2. **One live user/mission attempt:** only one non-rejected attempt exists for a user and mission.
3. **Global Jelly-post reuse:** one Jelly post can fund at most one JellyHunt submission; v2 exposes only `submission_conflict`.
4. **One reward intent:** one reward intent exists per approved submission, attempt keys are unique per intent/attempt number, and canonical Jelly transaction IDs are globally unique.

Indexes and transactional mutations—not client checks—enforce these invariants. Failed and uncertain workers use leases/watchdogs. Verification receives the submission ID only and reloads immutable terms from Convex.

## Webhooks and polling

### PlatePost to Jelly

PlatePost sends backend notifications to the Jelly-owned receiver:

```http
POST https://api.jellyjelly.com/partner/v1/jellyhunt/events
Content-Type: application/json
X-PlatePost-Event-Id: evt_01...
X-PlatePost-Timestamp: 1784210000
X-PlatePost-Key-Id: ppwh_2026_07
X-PlatePost-Signature: v1=<hex HMAC-SHA256(keyId + "." + timestamp + "." + rawBody)>
```

Supported event types are:

- `jellyhunt.mission.published`
- `jellyhunt.mission.updated`
- `jellyhunt.mission.paused`
- `jellyhunt.submission.status_changed`
- `jellyhunt.reward.status_changed`

Envelope:

```json
{
  "id": "evt_01...",
  "type": "jellyhunt.submission.status_changed",
  "version": "1",
  "occurredAt": "2026-08-05T18:42:20Z",
  "entity": {
    "type": "submission",
    "id": "sub_01...",
    "sequence": 4
  },
  "subject": {
    "jellyUserId": "canonical-jelly-user-uuid"
  },
  "data": {
    "submissionId": "sub_01...",
    "participationId": "par_01...",
    "missionId": "mis_01...",
    "submissionStatus": "needs_review",
    "rewardStatus": "not_eligible",
    "previousDisplayStatus": "submitted",
    "displayStatus": "under_review",
    "reasonCode": "manual_review_required",
    "publicMessage": "Your Jelly is waiting for review.",
    "nextAction": "wait_for_review",
    "updatedAt": "2026-08-05T18:42:20Z"
  }
}
```

Required data by type is closed for version 1:

| Event | Required `entity`, `subject`, and `data` |
| --- | --- |
| mission published/updated/paused | entity `mission`; subject `null`; `missionId`, `campaignId`, mission `revision`, `catalogRevision`, availability state, `acceptingSubmissions`, `updatedAt` |
| submission status changed | entity `submission`; Jelly subject required; `submissionId`, `participationId`, `missionId`, `submissionStatus`, `rewardStatus`, previous/current `displayStatus`, nullable safe `reasonCode`, `publicMessage`, `nextAction`, `updatedAt` |
| reward status changed | entity `reward_intent`; Jelly subject required; `rewardIntentId`, `submissionId`, `missionId`, `rewardStatus`, current `displayStatus`, nullable canonical `transactionId`, safe `publicMessage`, `nextAction`, `updatedAt` |

These payloads are self-contained notifications for Jelly's backend to route a push to the named subject. The backend does not call an owner-only PlatePost endpoint. The authenticated native client fetches the linked v2 resource after receiving the push; mission events may also be refreshed through the public mission API.

Jelly validates the key ID, signature over the exact raw body, matching header/body event ID, schema, and absolute clock skew no greater than five minutes. It transactionally stores event ID and body hash before side effects and returns `204 No Content`; an exact duplicate also returns `204`, a reused ID with different bytes returns `409 event_id_reused`, an invalid key/signature returns `401`, and a stale/future timestamp or invalid body returns `400`. Current and previous keys overlap for the full 24-hour delivery-retry window, and inbox dedupe records remain at least 30 days.

Delivery is at least once. PlatePost retries non-2xx responses with bounded exponential backoff for up to 24 hours and records every delivery. `entity.sequence` is monotonic within `(entity.type, entity.id)`; Jelly ignores an older event delivered after a newer one. Native clients without push use `/me/events`.

### Jelly to PlatePost

Jelly sends partner notifications to this internal endpoint, never to a native route:

```http
POST /api/internal/v1/jellyhunt/jelly-events
Content-Type: application/json
X-Jelly-Event-Id: jevt_01...
X-Jelly-Timestamp: 1784210000
X-Jelly-Key-Id: jwh_2026_07
X-Jelly-Signature: v1=<hex HMAC-SHA256(keyId + "." + timestamp + "." + rawBody)>
```

The HMAC uses the independent Jelly-to-PlatePost webhook secret selected by `X-Jelly-Key-Id`; the key ID is bound into the signed input. The envelope is:

```json
{
  "id": "jevt_01...",
  "type": "jelly.reward.settled",
  "occurredAt": "2026-08-05T19:00:00Z",
  "entity": {
    "type": "reward_intent",
    "id": "rwd_01...",
    "sequence": 3
  },
  "data": {
    "rewardIntentId": "rwd_01...",
    "attemptNumber": 1,
    "status": "sent",
    "submissionId": "sub_01...",
    "missionId": "mis_01...",
    "jellyPostId": "01K...",
    "recipientUserId": "canonical-jelly-user-uuid",
    "amount": "60",
    "token": "JELLY-MY-JELLY",
    "transactionId": "canonical-jelly-transaction-id",
    "transactionHash": "optional-chain-hash",
    "settledAt": "2026-08-05T19:00:00Z"
  }
}
```

Supported types are `jelly.post.ready`, `jelly.post.updated`, `jelly.post.deleted`, `jelly.place.updated`, and `jelly.reward.settled`. `sequence` is monotonic within `(entity.type, entity.id)`, not globally. A reward settlement status is `sent` or confirmed `failed`; failed data requires `transactionId: null`, `confirmedNoTransfer: true`, and a safe `reasonCode`. A pending update remains available through reward-intent lookup.

PlatePost validates the key ID, raw-body signature, matching header/body event ID, strict schema, and an absolute timestamp skew no greater than five minutes, rejecting both old and far-future timestamps. The current and previous HMAC keys overlap for at least Jelly's maximum delivery-retry window. PlatePost durably inserts the event ID and raw-body hash into a transactional inbox before scheduling work, then returns `204 No Content`. Event IDs and hashes are retained for at least 30 days. An exact duplicate returns `204`; a reused event ID with different bytes returns `409 event_id_reused`; invalid key IDs/signatures return `401`; stale/future timestamps or invalid bodies return `400`. Jelly retries non-2xx responses with bounded exponential backoff.

Events trigger verification, cache invalidation, place-refresh review, or reward reconciliation. The worker fetches the authoritative Jelly partner resource before a final state transition. Events never directly overwrite immutable mission/submission snapshots and still pass normal Convex sequence, uniqueness, and transition checks.

## Error catalog

| HTTP | Stable codes |
| --- | --- |
| `400` | `invalid_json`, `invalid_request`, `invalid_cursor` |
| `401` | `authentication_required`, `invalid_token`, `token_expired` |
| `403` | `account_restricted`, `insufficient_scope`, `forbidden` |
| `404` | `campaign_not_found`, `mission_not_found`, `place_not_found`, `participation_not_found`, `submission_not_found` |
| `409` | `mission_not_available`, `mission_revision_changed`, `participation_revision_locked`, `participation_expired`, `attempt_limit_reached`, `submission_conflict`, `idempotency_in_progress`, `idempotency_key_reused`, `idempotency_record_expired`, `reward_capacity_exhausted`, `state_conflict` |
| `422` | `jelly_post_not_eligible` |
| `429` | `rate_limited` with `Retry-After` |
| `500` | `internal_error` |
| `502` | `dependency_invalid_response` |
| `503` | `dependency_unavailable`, `service_unconfigured` with optional `Retry-After` |

Do not return raw Convex error text or Jelly response bodies. `404 submission_not_found` is used both for an absent submission and a submission owned by another user, preventing ownership enumeration.

## Data-model changes in Convex

### `campaigns`

- Stable public ID, title/branding, status, dates, timezone, rules/support/app links.
- Map center/bounds/default zoom.
- Catalog revision and timestamps.

### `places`

- Stable public ID and canonical `jellyPlaceId`.
- Reviewed name/address/coordinates/timezone/hours snapshot.
- Jelly source revision, last sync time, review status, timestamps.

### `missions` and `missionRevisions`

- Stable public ID and campaign relation; immutable revision rows for task, structured requirements, place, schedule, hours, reward, and user-visible instructions.
- Current published revision, budget allocation, `acceptingSubmissions`/capacity state, and revision-retention deadline.
- Indexes by campaign/availability/sort/updated time and mission/revision.

### `participations`

- Stable public ID, Jelly subject, mission ID, immutable mission revision/snapshot, `startedAt`, `submissionDeadlineAt`, nullable `resubmissionDeadlineAt`, attempts used/max, status `started|expired|replaced`, and nullable replacement participation ID.
- Unique live subject/mission relation plus append-only events when an expired start is replaced by a newer revision.

### `submissions`

- Stable public ID, attempt number, source, and immutable Jelly subject/post IDs.
- Separate `submissionStatus` and `rewardStatus` (with a temporary derived legacy status for v1).
- Existing immutable mission/place/proof/reward snapshots.
- Explicit submitted, verification-started/completed, decided, reward-queued/processing/sent, and updated timestamps.
- Safe public reason/message fields distinct from internal notes.
- Verification lease/attempt and reward relation.
- Indexes for owner history, mission/user, post uniqueness, status queues, and updated time.

### `submissionEvents`

- Submission relation, owner ID, monotonic sequence, event type, safe public status/reason, timestamp.
- Internal metadata kept separately and never returned through `/me/events`.

### `approvedCompletions`, `publicProfiles`, and `leaderboardEntries`

- One durable, non-reversed approved-completion fact per Jelly subject and mission; reward state never supplies or removes this fact.
- A short-lived public profile projection sourced only from Jelly's canonical username contract.
- Materialized current-campaign and all-time counts updated atomically with approval, backed by an append-only projection event and rebuildable from approved completions.
- Public ordering, shared-rank pagination, launch epoch, profile refresh, and reversal rules follow the approved leaderboard extension linked above.

### `idempotencyRecords`

- Subject, method, normalized path, key hash, RFC 8785 canonical request hash, state, `processingExpiresAt`, original request ID, and resource ID.
- Exact original HTTP status, JSON body bytes, replay-safe headers including `Location`, creation/finalization times, and expiry.
- Unique subject + method + normalized path + key index. Finalization is atomic with accepted submission and reward reservation.
- Full responses remain for the later of 180 days or campaign end plus 90 days. After purge, a key/request tombstone remains for the audit-retention period; replay returns `409 idempotency_record_expired` and never creates a new submission.

### `rewardBudgets` and `rewardReservations`

- Campaign/mission/day/user dimensions, allocated/reserved/paid/released amounts, revision, timestamps.
- One reservation per submission with a transactional state machine.

### `rewardIntents` and `rewardAttempts`

- One stable PlatePost reward intent per approved submission with local status `queued|processing|uncertain|sent|failed|canceled`, the immutable mission/submission/post/recipient/amount/token tuple, and unique canonical Jelly transaction ID. `canceled` is allowed only before any transfer-capable attempt is accepted or after Jelly confirms no transfer.
- Attempt number, unique intent/attempt idempotency key, processing lease, Jelly attempt status, `confirmedNoTransfer`, safe error code, and timestamps.
- At most one sent attempt per intent; a new attempt requires a final prior attempt with `confirmedNoTransfer: true`.

### `webhookInbox`, `webhookEvents`, and `webhookDeliveries`

- Inbound Jelly event ID, raw-body hash, key ID, entity/sequence, received/processed/dead-letter timestamps, and safe processing error; insertion precedes side effects.
- Outbound stable event ID, type, entity/sequence, serialized safe payload, endpoint, attempt count, next attempt, response class, and delivered/dead-letter timestamps.

No v2 list query may use unbounded `.collect()` over a growing table or perform one Jelly/Convex request per returned row.

## Security and privacy requirements

- Never commit or expose Vercel, Convex, Jelly partner, reward, admin, Mapbox-secret, or webhook credentials.
- Public Mapbox tokens are the only browser-exposed map credential.
- Precise client and verified location evidence is encrypted/retained only for the documented review window and is not returned to public/native status resources.
- Audit actor, decision, and state changes are retained, but secrets and raw upstream bodies are excluded.
- Admin approval/reconciliation requires named operators; high-value rewards may require a second approval.
- Rate limits apply per IP to public reads and per Jelly subject to authenticated writes.
- Submission and webhook bodies have strict size limits and schema validation.
- Partner calls use HTTPS, deadlines, bounded retries, and circuit breaking.
- Media/profiles honor Jelly deletion/moderation updates and cache invalidation.
- The leaderboard is an approved public product surface and displays only Jelly's canonical public username, competition rank, and approved mission count. It never exposes Jelly user IDs, internal balances, reward totals, or merely client-reported completion.

## Migration plan

### Phase 0 — freeze both contracts

- Approve this design with PlatePost and Jelly engineering.
- Capture executable fixtures for every current v1 success/error/status before changing storage or adapters.
- Publish OpenAPI 3.1 for v2 plus shared request/response/error fixtures.
- Add v1 regression tests and v2 consumer-driven contract tests in both repositories.

### Phase 1 — stable IDs, revisions, and durable history

- Add public IDs to existing campaigns, places, missions, participations, submissions, reward intents, and events.
- Add immutable mission revisions, split status fields, explicit timestamps, idempotency records, and append-only events.
- Backfill the documented v1-to-v2 status mapping, validate counts, switch v1 reads to the derived adapter, and route v1/v2 writes through shared mutations.
- Expose public IDs and revisions additively in v1 without changing its existing fixtures.

### Phase 2 — canonical campaign, map, and read APIs

- Add `/campaigns/current`, mission detail, place detail, cursor pagination, semantic ETags, and request IDs.
- Move every PlatePost map, Passport, editorial, and admin preview to the same Convex records.
- Import the 16 legacy missions as reviewed drafts and link each to a canonical Jelly place before activation.

### Phase 3 — signed identity and personal resources

- Implement Jelly mission-token/JWKS support.
- Add `/me`, `/me/missions`, `/me/submissions`, `/me/events`, owner-only submission detail/events, and revision-locked participation.
- Remove caller-supplied identity from v2.
- Test expiry, wrong audience/issuer/scope, key rotation, subject spoofing, optional invalid bearer behavior, and the accepted five-minute logout lag.

### Phase 4 — Jelly place, content, and proof integration

- Ship Jelly canonical place, exact eligibility, place-content, and component-evidence partner APIs.
- Add normalized mission/place Jelly feeds and cache invalidation.
- Implement the evidence retry/review matrix and pre-payout eligibility recheck.
- Keep legacy exact-post evidence manual-review-only.

### Phase 5 — idempotent submission and budgets

- Implement revision-locked v2 submission creation, persistent HTTP idempotency, and synchronous exact-post ownership preflight.
- Add transactional budget reservations, reservation deadlines, capacity controls, worker leases, and pause/alert watchdogs.
- Add bounded paginated admin queues and prove uniqueness under concurrency.

### Phase 6 — Jelly reward intent and reconciliation, disabled for production

- Ship Jelly reward-intent attempts, lookup, settlement tuple, and restricted capacity endpoint.
- Add transaction-ID uniqueness, automatic lookup, and capacity monitoring.
- Prove dropped responses, confirmed failures, attempt retries, and worker timeouts cannot produce a second transfer.
- Keep the production automatic-reward feature flag off until Phase 7's legacy fence is complete.

### Phase 7 — atomic legacy write fence and reconciliation

- Inventory every legacy JellyHunt submission, verify/approval/status, wallet-credential, tip, and payout route/job, including the hardcoded JellyJelly website flow and PlatePost v1. Fence only JellyHunt writers; shared Pets/Wobbles table consumers remain live and receive regression coverage.
- Map legacy mission keys to stable v2 mission IDs, deploy the shared dedupe import tooling, and choose a UTC cutover watermark.
- Pre-deploy and rehearse a JellyHunt-specific Supabase cutover migration. At the watermark, one transaction takes access-exclusive locks to drain pre-existing submission/credential writers, activates an immutable cutover record, removes the authenticated submission-insert policy/grant, enables fail-closed `BEFORE INSERT OR UPDATE OR DELETE` triggers on `jellyhunt_submissions` and `jellyhunt_business_wallets` for authenticated and service-role callers, deactivates legacy business-wallet records, and emits a signed fence receipt. Do not revoke the shared campaign/shop service credential or broadly block `jellyhunt_balances`/`jellyhunt_tip_audit_log`, because Pets/Wobbles still depend on them.
- First pause legacy verify/retry routes and payout workers, drain in-flight requests, and revoke JellyHunt business-account passwords, tokens, and active sessions at Jelly; then immediately execute the database fence transaction. These are ordered safety barriers, not a claimed distributed transaction. Credential/session revocation closes stale `PATCH /api/jellyhunt/verify` instances that can call `/crypto/send` after a read. Drain in-flight requests and manually reconcile every pending/uncertain transfer; web rollback preserves the database fence and revoked payout authority.
- Export the now-stable legacy snapshot and use a dedicated server-only import mutation to materialize subject, legacy mission, exact Jelly post ID, status, amount/token, transaction ID/hash, and timestamps as `source: legacy` with `countsTowardLeaderboard: false`. The signed Production import window closes irreversibly. That mutation cannot increment standings, allocate or reserve budget, create a reward intent, or emit payout work. Populate global post, reward-intent, and transaction tombstones so imported work is never replayed or paid again. Do not occupy a new campaign's live user/campaign/mission key: a participant may complete the new campaign-bound mission with a new post. Null identifiers create no uniqueness claim; duplicate, conflicting, or unreconciled identifiers remain quarantined and block automatic payout for the affected pair until resolved.
- Reconcile source/import counts and hashes, require zero orphan successful transactions, and retain an auditable cutover report.
- Prove after the watermark that direct authenticated inserts and stale service-role writes fail on both fenced tables; stale wallet create/update/session routes cannot restore payout authority; stale verify/retry requests produce zero successful legacy transfers; read-only export still works; and Pets/Wobbles balances, purchases, refunds, shields, and audit writes still pass.
- Production v1 writes remain disabled after the watermark. Any temporary Jelly backend fallback calls v2 through the same mission-token subject or a narrowly scoped service identity that derives and compares the Jelly subject; caller-controlled `jellyUserId` can never reach automatic rewards.
- The production v2 automatic-reward flag cannot be enabled until these checks pass and no independent legacy payout path remains.

### Phase 8 — webhooks and native rollout

- Enable signed bidirectional webhooks and `/me/events` polling.
- Run v1/v2 shadow reads and compare mission/status results.
- Release v2 reads and submission UI behind a Jelly app feature flag.
- Complete one development mission from native publish through exactly one confirmed reward, then enable production rewards gradually with alarms and a kill switch.

### Phase 9 — legacy retirement

- Redirect or retire the hardcoded JellyJelly website flow after PlatePost production acceptance.
- Add `Deprecation`, `Sunset`, and successor `Link` headers to v1 only after v2 adoption is measured.
- Remove the development auth bridge and shared native-facing key.
- Preserve imported history, dedupe tombstones, receipts, and audit records for their documented retention periods.

## Acceptance criteria

### Mission and UI source of truth

- Editing and publishing one mission in PlatePost admin updates the consumer map, Passport, mission detail, and v2 API without a code deploy.
- No production JellyJelly or PlatePost client contains mission constants, campaign dates, reward names, or map bounds.
- Paused/ended missions follow the audience matrix and remain in the owner's history.
- Starting revision 7 and then publishing revision 8 still evaluates the existing participation against immutable revision 7 until its disclosed deadline.

### Identity

- A body/query user ID is ignored or rejected; the token subject is the only owner.
- Expired, wrong-audience, wrong-issuer, insufficient-scope, and rotated-key cases are contract tested.
- One user cannot read another user's submission by guessing an ID.
- Every authenticated/personalized response is private/no-store; an invalid optional bearer token returns `401` rather than anonymous data.

### Submission and status

- Within one subject/method/normalized-path scope, the same key/canonical request returns the exact original response through the retention window; a request mismatch or expired tombstone cannot create a new submission.
- Concurrent submissions enforce one live user/mission attempt and global post uniqueness.
- Exact Jelly ownership is checked before a reservation/uniqueness claim, and v2 never reveals a cross-user reuse reason.
- Rejected users can submit a new Jelly without changing the old attempt.
- Native status distinguishes started, submitted, under review, approved/reward pending, rewarded, rewarded-but-removed-from-rankings, rejected, failed, and uncertain, including the exact paid-moderation fixture.
- Reservation deadlines pause/alert without silently releasing `needs_review`, `processing`, or `uncertain` rewards.
- Every transition appears once, in order, in detail/history/events.

### Jelly proof and content

- Exact post ID, author, readiness, visibility, deletion/moderation, time window, canonical place, and trusted location are independently validated.
- Generic topics or client `xdata` never produce automatic approval.
- Missing/negative/inconsistent/outside-geofence evidence follows the specified retry/review/rejection matrix; operators cannot replace required Jelly evidence.
- PlatePost rechecks before every payout attempt, and Jelly atomically guards deletion, moderation, canonical owner, visibility, place, and the immutable tuple in the transfer operation.
- Place feeds return only Jelly-linked content, paginate correctly, and refresh expiring media URLs.

### Rewards

- Campaign/mission/day/user limits and reservation states hold under concurrent submissions and approvals.
- One logical reward intent creates at most one Jelly transfer across versioned attempts.
- A new attempt is impossible until Jelly confirms the prior attempt is final with no transfer.
- A timeout/dropped response becomes uncertain and lookup resolves it without blind retry.
- Jelly transaction IDs are unique in Convex.
- `reward_sent` always points to a canonical receipt whose full immutable payout tuple exactly matches PlatePost.
- Post-payment moderation can reverse the completion and every counted standing, but it preserves the paid reservation, receipt, transaction identity, and owner-visible rewarded history and cannot create another reward.

### Webhooks and reliability

- Bad/rotated key IDs, bad signatures, old and far-future timestamps, duplicate/reused event IDs, retries, and out-of-order delivery are tested.
- Jelly outage never rejects a user solely due to downtime and never causes a duplicate payout.
- Every response and audit trail carries a request/event correlation ID.

### Security and privacy

- No secrets appear in Git history, browser bundles, API bodies, audit metadata, or logs.
- Native/public resources omit exact verified GPS, internal proof notes, raw partner responses, and wallet credentials.
- Retention, deletion, moderation, operator roles, and leaderboard consent have documented policies.

### Migration and cutover

- Frozen v1 read fixtures and pre-cutover shared-mutation write fixtures pass; after the watermark, v1 write retirement fixtures return `410 legacy_write_disabled`.
- Imported legacy post and transaction IDs occupy the same v2 uniqueness indexes and are never re-paid; the import path cannot create standings, reservations, reward intents, or payout work and cannot run after its signed window closes.
- Source/import counts and hashes match, every prior successful transaction is reconciled, and no independent legacy writer/payout worker remains before production automatic rewards are enabled.

## Production integration gates

Local and development planning/implementation was authorized on 2026-07-16. Production promotion still requires named PlatePost and Jelly engineering approval of these binding decisions:

1. v2—not a breaking rewrite of v1—is the clean native contract, while frozen v1 fixtures and the exact split-state adapter remain compatible.
2. Jelly issues a five-minute asymmetric mission token with audience `platepost-jellyhunt`.
3. Jelly creates a canonical place relation and place-indexed Jelly feed; legacy topics/`xdata` are not authoritative.
4. Jelly returns component evidence for post, author, place, and trusted location; PlatePost alone makes the mission decision.
5. Jelly implements reward intents, versioned attempts, lookup, full-tuple receipts, and restricted capacity reporting with at-most-one successful transfer per intent.
6. PlatePost exposes revision-locked participation, separate submission/reward status, and paginated ordered history.
7. PlatePost reserves campaign/mission reward capacity transactionally and pauses/alerts on overdue reservations without silent release.
8. PlatePost and Jelly exchange signed, rotated-key, replay-safe status webhooks with transactional inbox/outbox processing.
9. Legacy submissions and transactions are imported into the same dedupe boundary, and legacy writes/payouts are fenced before production automatic rewards.
10. Public/personalized caching, pagination, privacy-safe errors, and idempotency retention follow this contract.

The task-by-task implementation plans may now be executed against local or PlatePost development Convex only. Production deployment, data import, legacy fencing, and automatic rewards remain blocked until the integration manifest records every named approval and acceptance artifact above.
