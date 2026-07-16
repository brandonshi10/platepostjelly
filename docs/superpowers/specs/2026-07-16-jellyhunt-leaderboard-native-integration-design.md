# JellyHunt Leaderboard and PlatePost Native Integration Design

**Status:** Approved design awaiting written-spec review
**Date:** 2026-07-16
**Owners:** PlatePost mission platform and JellyJelly identity/content platform

## Executive decision

PlatePost will own the complete JellyHunt mission system in its existing Vercel and Convex environment. Convex will be the source of truth for campaigns, mission and location configuration, participation, submissions, deduplication, review decisions, reward orchestration, user-visible status, audit history, and leaderboard totals. Jelly remains authoritative for authenticated users, canonical usernames, Jelly posts, canonical places, trusted post/location evidence, and final Jelly-My-Jelly transfers.

The public PlatePost experience and Jelly native app will consume the same PlatePost mission records and APIs. No production mission, location, status, username, or leaderboard entry may be hardcoded in either client.

The leaderboard ranks people by approved mission count. It provides two scopes:

- **This season:** approvals associated with the current PlatePost campaign.
- **All time:** approvals recorded from the launch of the new PlatePost JellyHunt tool onward.

Legacy approval history is not imported into all-time standings because this is a new tool. The API and UI must disclose the PlatePost launch epoch for that scope.

## Relationship to the native v2 contract

The [PlatePost ↔ JellyJelly Native Mission API v2 Design](2026-07-16-platepost-jelly-native-api-v2-design.md) remains authoritative for identity, mission, participation, submission, proof, reward, webhook, and migration safety. This extension supersedes its earlier leaderboard metric/routes and defines the physical namespaced layout required inside PlatePost's shared Convex project. Generic v2 table names are logical names only; the physical shared-project names in the namespace map below are binding.

## Current system evidence

The current PlatePost repository already contains:

- The `/human-social` PlatePost x JellyJelly consumer experience.
- The original JellyHunt-style map, mission drawer, mission filters, Passport shell, Editorial Map, Dark/Wobbles themes, and Jelly app handoff.
- A protected mission/submission admin.
- v1 mission and submission routes.
- Convex mission, location, submission, reward-attempt, and audit tables.
- A guarded 16-record mission migration catalog.
- A proposed native Mission API v2 contract.

The current leaderboard menu destination is deliberately a placeholder. The current Convex schema does not store campaigns, durable approval timestamps, canonical Jelly usernames, approved-completion ledger rows, or materialized leaderboard entries.

The existing seeded JellyHunt compatibility surface lives in `jellyjelly-website` and currently reads or writes Supabase JellyHunt tables:

- `GET /api/jellyhunt/missions`
- `GET /api/jellyhunt/progress`
- `POST /api/jellyhunt/submit`
- `POST|PATCH /api/jellyhunt/verify`
- `GET /api/jellyhunt/leaderboard`

The Django Jelly legacy API remains useful for Jelly sessions, users, public profiles, Jelly posts, media, and migration-only tipping. Its generic topics and client-writable `xdata` are not authoritative restaurant proof, and its legacy transfer route is not a safe idempotent PlatePost reward contract.

## Goals

1. Let Jelly fetch every live mission and location needed to build a native mission map, picker, detail screen, composer handoff, progress view, and status history.
2. Replace the public leaderboard placeholder with current-season and all-time standings showing canonical Jelly usernames.
3. Count each approved user/mission completion exactly once, independently from later reward delivery.
4. Preserve the original JellyHunt consumer experience while replacing hardcoded and Supabase mission sources with PlatePost Convex.
5. Keep existing JellyHunt clients working through a frozen compatibility adapter during migration.
6. Give PlatePost engineers and AI agents an exact, safe path for merging this repository into PlatePost's existing website and Convex database.

## Non-goals

- PlatePost does not become the source of truth for Jelly accounts, usernames, posts, places, media, or wallets.
- The browser cannot submit a username, reward amount, recipient, Jelly place proof, approval decision, or leaderboard total.
- All-time standings do not include pre-PlatePost JellyHunt history.
- Leaderboard position is not based on coins, reward amount, views, likes, or client-reported completion.
- This design does not authorize deploying the standalone `convex/` directory over PlatePost's shared Convex project.

## Deployment and repository topology

PlatePost already has Vercel. The integration must extend that project rather than create a competing Vercel project.

The standalone repository's current Convex schema uses generic table names such as `locations`, `missions`, and `submissions`. Deploying it directly to PlatePost's shared Convex project could replace or remove PlatePost tables, functions, and HTTP routes, including the existing Manus webhook. Before a shared deployment:

1. Merge the web experience into PlatePost's canonical repository.
2. Mount the operator surface under `/admin/jellyhunt` or PlatePost's existing admin navigation rather than replacing `/admin`.
3. Move Convex functions under `convex/jellyhunt/`.
4. Merge table definitions into PlatePost's existing schema using `jellyhunt*` names.
5. Merge HTTP routes into PlatePost's existing Convex router without replacing it.
6. Preserve PlatePost's root layout, global styles, upload/menu services, brand workflow, and Manus webhook.
7. Use PlatePost's existing Preview and Production Vercel/Convex environments with separate credentials.

The standalone repository's `convex/http.ts` is a Jelly request helper, not PlatePost's HTTP router. Move it to a namespaced helper such as `convex/jellyhunt/jellyHttpClient.ts` before merging. Scope JellyHunt styles under the consumer/admin roots rather than copying broad global selectors into PlatePost. Rotate the Vercel credential previously pasted into chat if it was live; it must not be committed or reused as a Mapbox token.

## Authoritative shared-Convex namespace map

| Standalone or logical v2 name | Physical PlatePost shared-project name |
| --- | --- |
| `locations` / `places` | `jellyhuntPlaces` |
| Program-level leaderboard epoch/revision | `jellyhuntProgramConfig` |
| `campaigns` | `jellyhuntCampaigns` |
| `missions` | `jellyhuntMissions` |
| `missionRevisions` | `jellyhuntMissionRevisions` |
| `participations` | `jellyhuntParticipations` |
| `submissions` | `jellyhuntSubmissions` |
| `submissionEvents` | `jellyhuntSubmissionEvents` |
| `idempotencyRecords` | `jellyhuntIdempotencyRecords` |
| `rewardBudgets` | `jellyhuntRewardBudgets` |
| `rewardReservations` | `jellyhuntRewardReservations` |
| `rewardIntents` | `jellyhuntRewardIntents` |
| `rewardAttempts` | `jellyhuntRewardAttempts` |
| `webhookInbox` | `jellyhuntWebhookInbox` |
| `webhookEvents` | `jellyhuntWebhookEvents` |
| `webhookDeliveries` | `jellyhuntWebhookDeliveries` |
| `auditEvents` | `jellyhuntAuditEvents` |
| New canonical profile projection | `jellyhuntPublicProfiles` |
| New approval ledger | `jellyhuntApprovedCompletions` |
| New materialized standings | `jellyhuntLeaderboardEntries` |
| New projection audit/replay events | `jellyhuntLeaderboardEvents` |
| Legacy replay quarantine/tombstones | `jellyhuntLegacyDedupeRecords` |

Move the standalone modules `missions.ts`, `submissions.ts`, `workflow.ts`, `jelly.ts`, `audit.ts`, `security.ts`, and `validation.ts` under `convex/jellyhunt/` and update all generated references accordingly. Rename the standalone request helper `convex/http.ts` to `convex/jellyhunt/jellyHttpClient.ts`; PlatePost's existing root `convex/http.ts` remains the sole HTTP router and receives merged JellyHunt routes.

Before any shared development deployment, export or inspect PlatePost's current schema, function tree, indexes, environment names, and HTTP routes; produce a reviewed before/after diff; and prove that no pre-existing table, index, function, route, cron, or Manus webhook disappears. Then run Convex generation/typecheck and the complete PlatePost test/build suite. A clean diff and passing gates are required before `convex deploy` or a Vercel preview points at the merged deployment.

## Binding integration manifest

This repository is the reviewed JellyHunt delivery package. Before it is merged or connected to PlatePost's shared database, PlatePost and Jelly record a non-secret integration manifest in the canonical target repository at `docs/PLATEPOST_INTEGRATION.md`. The manifest binds:

- This source repository URL, branch, and exact commit.
- The canonical PlatePost target repository URL and pre-merge commit.
- Existing Vercel team/project identifiers, production domain, and preview-domain pattern.
- PlatePost Convex project plus the branch-to-development, Preview, and Production deployment mapping.
- Jelly website baseline repository/commit, Jelly legacy API repository/commit, and Jelly native repository/release commit.
- PlatePost v1 and v2 base URLs, Jelly partner base URL, and every webhook receiver path.
- Reviewed mission-manifest checksum, schema/router before-and-after hashes, global leaderboard launch epoch, and UTC legacy cutover watermark.
- Named PlatePost, Jelly backend, Jelly native, product, operations, security, and rollback approvers.

The user has confirmed that Vercel already exists, but no chat credential substitutes for these identifiers. Shared deployment and native release remain blocked until the manifest is complete and approved; local implementation and contract tests may proceed in this delivery repository.

## Source-of-truth ownership

| Resource or decision | Canonical owner | PlatePost behavior |
| --- | --- | --- |
| Jelly user and session | Jelly | Validate signed identity and retain only the canonical Jelly user ID for correlation. |
| Public username | Jelly | Fetch through a trusted server contract and cache as a public display projection. |
| Campaign and season | PlatePost/Convex | Configure in PlatePost admin and expose through the native API. |
| Mission task and reward terms | PlatePost/Convex | Store, revision, validate, publish, and snapshot on participation/submission. |
| Mission map location | PlatePost/Convex | Store the reviewed display snapshot and a canonical `jellyPlaceId` foreign key. |
| Jelly place association and post evidence | Jelly | Return server-owned, component-level evidence to PlatePost. |
| Participation and submission state | PlatePost/Convex | Enforce deadlines, deduplication, review, resubmission, and history. |
| Approval decision | PlatePost/Convex | Create the durable approved-completion fact and leaderboard updates. |
| Reward transfer | Jelly | Execute the immutable PlatePost intent with idempotency and lookup guarantees. |
| Leaderboard score and rank | PlatePost/Convex | Materialize from durable approved-completion facts. |

## Namespaced Convex data model

### `jellyhuntProgramConfig`

- One environment-scoped singleton with the immutable `leaderboardLaunchEpoch` and global all-time `leaderboardRevision`.
- The launch epoch is set before the first countable approval and cannot change after a completion exists.
- The all-time rebuild includes only non-reversed completions with `countsTowardLeaderboard: true` and `approvedAt >= leaderboardLaunchEpoch`.

### `jellyhuntCampaigns`

- Stable public campaign ID and slug.
- Title, status, start/end dates, timezone, map viewport, branding, rules, and app links.
- `isCurrent`, `catalogRevision`, and campaign-scoped `leaderboardRevision`.
- Campaign identity is immutable after publication; changing seasons selects a different current campaign and never reassigns an existing mission, participation, or submission.
- Exactly one current campaign per environment.

### `jellyhuntMissions`

- Existing mission fields plus a required `campaignId`.
- Stable public ID, immutable numeric revision, lifecycle, prompt, structured requirements, reward display terms, and reviewed location relation.
- Existing legacy numeric ID and slug are retained as migration aliases, not public primary keys.

### `jellyhuntSubmissions`

- Existing submission snapshot fields plus `campaignId`, public submission ID, and separate submission/reward statuses.
- Durable nullable `approvedAt` and `approvalDecisionId`.
- `approvedAt` remains populated when reward state changes to queued, processing, sent, failed, or uncertain.
- A deliberate fraud/moderation or failed eligibility recheck before payment uses the audited pre-payout approval-reversal operation; a sent reward uses the separate post-payment moderation operation below. Ordinary rejection and reward-status transitions cannot clear an approval.

### `jellyhuntPublicProfiles`

- Internal canonical `jellyUserId`.
- Canonical `username`, normalized username, Jelly profile revision when available, account state, `refreshedAt`, and `publicEligible`.
- Indexes by Jelly user ID and normalized username.
- Browser/API submission payloads cannot write this table.

### `jellyhuntApprovedCompletions`

- Stable public completion ID.
- Internal Jelly user ID, campaign ID, mission ID, winning submission ID, approval decision ID, and `approvedAt`.
- Required `source: live|legacy` and `countsTowardLeaderboard` fields. The canonical live approval mutation writes `source: live` and `countsTowardLeaderboard: true`; every legacy import writes `source: legacy` and `countsTowardLeaderboard: false` explicitly rather than relying on an implicit default.
- Unique logical key `jellyUserId + campaignId + missionId`, with composite indexes by that key, approval decision ID, and winning submission ID.
- Optional audited `reversedAt` and reversal reason.
- This ledger, not reward state or aggregate counters, is the source of truth for leaderboard reconstruction.
- A recurring mission in a later season receives a new campaign-bound mission ID, so a user may earn a new completion. Reusing one mission ID across campaigns is invalid.

### `jellyhuntLeaderboardEntries`

- Scope key: `campaign:<campaignId>` or `all_time`.
- Internal Jelly user ID and approved mission count.
- `rankSortScore`, equal to the negative approved mission count, plus denormalized `normalizedUsername`, stable public entry ID, `scoreReachedAt`, public eligibility, profile revision, and update timestamp. `normalizedUsername` is `username.trim().normalize("NFKC").toLocaleLowerCase("en-US")`; punctuation is preserved.
- Unique logical key `scopeKey + jellyUserId`.
- Ascending index order: `scopeKey`, `publicEligible`, `rankSortScore`, `normalizedUsername`, stable public entry ID. Public queries bind `publicEligible: true`; the negative score permits mixed logical order—score descending and username ascending—in one Convex index.

### `jellyhuntLeaderboardEvents`

- Append-only increment, reversal, profile-refresh, rebuild, and publication events.
- Carries correlation/request IDs and before/after counts.
- Supports audit, replay, projection repair, and revision invalidation.

### `jellyhuntLegacyDedupeRecords`

- Source row identifier, record kind `post|transaction|quarantine`, nullable canonical post/transaction identifier, legacy user/mission correlation, source hash, and import timestamp.
- Unique indexes for each non-null canonical post ID, transaction ID, and transaction hash.
- Quarantine reason, affected user/mission payout-hold key, operator resolution, and `resolvedAt`.
- Legacy rows never contribute to leaderboard projections.

## Approval and projection transaction

When an eligible submission receives its first final approval, one Convex mutation must:

1. Re-read the submission and all conflicting sibling attempts.
2. Confirm the approval transition is current and permitted.
3. Query `jellyhuntApprovedCompletions` through the composite Jelly user/campaign/mission index before writing approval state.
4. Treat the operation as an idempotent replay only when both the immutable `approvalDecisionId` and `winningSubmissionId` match the existing completion; return that existing result without changing counters or reward state.
5. If any other completion occupies the key, commit a `quarantined_conflict` record plus audit/outbox event while leaving the losing submission's status, `approvedAt`, approval decision, reservation, and reward intent unchanged. The HTTP layer returns the mapped conflict only after that mutation commits.
6. Set the durable `approvedAt` and immutable approval decision ID.
7. Insert the completion ledger row with explicit live/countable provenance.
8. Increment or create `campaign:<submission.campaignId>`; never use whichever campaign happens to be current when approval runs.
9. Increment or create the all-time leaderboard entry only when the completion is countable and falls on or after the global launch epoch.
10. Move the submission's reservation to `approved_reserved` and create or confirm its one queued reward intent, when the locked mission terms include a reward.
11. Increment both affected leaderboard revisions and append audit/outbox events.
12. Commit every change atomically before reward processing begins.

Every live automatic, manual, admin, and reconciliation approval path calls this one canonical mutation. The historical cutover import never calls it. A dedicated server-only import mutation may materialize legacy submission/completion facts with `source: legacy`, `countsTowardLeaderboard: false`, and the original timestamps only while the signed import window is open; closing that window is irreversible in Production. The import mutation categorically cannot increment a leaderboard projection, allocate or reserve budget, create a reward intent, or emit a payout-dispatch event. No other production mutation may set `approvedAt` or create a reward intent. A late live approval after season rollover remains in the immutable submission campaign and appears in all-time only when it is countable and on or after the global launch epoch; it never increments the new current season.

Approval counts even when the later reward is queued, processing, failed, or uncertain. A reward transition never changes leaderboard totals.

An explicit fraud/moderation or failed pre-payout eligibility recheck after approval must use the canonical approval-reversal mutation. It re-reads and locks the active completion, submission, reward intent, reservation, and worker-lease state. When the intent is still queued, no worker lease is active, and no transfer-capable attempt has been accepted, the same mutation first changes the intent to `canceled` and releases or converts `approved_reserved` under the locked resubmission policy, then transitions the submission to rejected with `post_became_ineligible`, marks the completion reversed, decrements the immutable submission-campaign and eligible all-time projections, increments their revisions, and appends public-safe status plus audit/outbox events. The reward worker's lease mutation may select only a queued intent backed by `approved_reserved`, so Convex transaction conflicts serialize leasing against reversal and a worker cannot pay the rejected submission.

If the intent is `processing` or `uncertain`, or any transfer-capable attempt might have been accepted, the reversal mutation returns `reconciliation_required` and leaves approval, completion, score, intent, and reservation unchanged. After Jelly proves that no transfer occurred, the same mutation can cancel and reverse atomically. Counters may never become negative, and re-running the same completed reversal is idempotent.

When authoritative fraud/moderation evidence arrives after `rewardStatus: sent`, a separate named-operator post-payment moderation mutation keeps the immutable reward intent, successful receipt, transaction identity, and `paid` reservation unchanged; it never claws back, releases, retries, or creates a reward. In the same transaction it retains the historical `approvedAt`, sets submission status to `rejected` with public-safe reason `post_became_ineligible_after_reward`, marks the completion reversed, decrements every scope in which that completion counted, increments those revisions, and appends audit/outbox plus owner status events. The owner response presents “Reward sent; completion later removed from rankings,” with `canResubmit: false` and a support path. This operation is idempotent and cannot make a counter negative.

Projection repair recomputes entries from non-reversed approved-completion rows and compares the result with stored totals before applying changes. It never derives approvals from reward receipts or client state.

## Canonical username flow

Jelly guarantees that participating users have a username. PlatePost nevertheless treats the Jelly server as the only authority for its value.

1. PlatePost resolves and caches the canonical username during authenticated participation or submission processing. The pilot bridge uses Jelly's `GET /user/{userId}` and reads `data.user.username`; the production partner contract may replace transport but not ownership semantics.
2. Approval does not accept a username argument from the client or admin.
3. Jelly profile-change webhooks or a scheduled refresh apply every username sort-key, account-state, deletion/moderation, and `publicEligible` transition. One transaction updates every affected scope entry and increments each affected leaderboard revision, even when only index membership changes, so ETags, ranks, and cursors invalidate safely.
4. Leaderboard reads join the materialized score with the cached profile in Convex; they do not make one Jelly request per row.
5. A transient Jelly profile outage does not block mission discovery, approval, or score accounting.
6. An entry without a verified public username remains withheld from public responses until the profile projection is repaired; PlatePost never displays an invented fallback.
7. Public responses never expose Jelly user IDs.

## Native mission discovery API

All routes are rooted at `/api/v2/jellyhunt`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/campaigns/current` | Current campaign, map viewport, dates, branding, app links, and catalog revision. |
| `GET` | `/missions` | Cursor-paginated mission map/list discovery. |
| `GET` | `/missions/{missionId}` | Full mission detail with optional authenticated viewer state. |
| `GET` | `/places/{placeId}` | Reviewed public place snapshot and canonical Jelly place relation. |
| `GET` | `/missions/{missionId}/jellies` | Ready public Jellies linked by Jelly to the canonical place. |
| `PUT` | `/missions/{missionId}/participation` | Idempotently start a mission and lock its revision/deadline. |
| `GET` | `/participations/{participationId}` | Owner-only immutable mission snapshot and current controls. |
| `POST` | `/missions/{missionId}/submissions` | Create an idempotent asynchronous submission. |
| `GET` | `/submissions/{submissionId}` | Owner-only verification, decision, reward, and display status. |
| `GET` | `/submissions/{submissionId}/events` | Owner-only append-only timeline. |
| `GET` | `/me` | Campaign-level user summary. |
| `GET` | `/me/missions` | Current and historical mission participation. |
| `GET` | `/me/submissions` | Submission history and filters. |
| `GET` | `/me/events` | Ordered polling feed for state changes. |

`GET /missions` supports `campaignId`, availability, category, difficulty, latitude, longitude, `radiusMeters`, sort, cursor, and limit. Anonymous reads are short-cache public resources. `include=viewer` requires a Jelly mission bearer token and makes the response private and non-cacheable.

Mission detail includes:

- Stable IDs, slug, revision, title, description, and instructions.
- Availability, dates, `acceptingSubmissions`, and a safe reason code.
- Reward amount as a decimal string, token, and display name.
- Structured post, place, location, schedule, and resubmission requirements.
- Category, difficulty, emoji, neighborhood, price, and curated order.
- PlatePost place ID, canonical `jellyPlaceId`, name, address, coordinates, timezone, and hours.
- Optional viewer participation, submission, reward, next-action, and deadline state.
- Self, participation, Jelly feed, start, and directions links.

Internal approval mode, exact fraud/geofence thresholds, budgets, partner credentials, and verification policy are never returned to the native client.

## Native mission-selection journey

1. Jelly fetches `/campaigns/current` and `/missions`; it ships no mission constants.
2. Jelly renders its native map/list from PlatePost place coordinates and mission display fields.
3. The user selects a mission and Jelly fetches `/missions/{missionId}` with a fresh mission token.
4. Jelly calls `PUT /missions/{missionId}/participation` when the user confirms Start.
5. PlatePost returns `participationId`, locked `missionRevision`, `jellyPlaceId`, and `submissionDeadlineAt`.
6. Jelly passes those identifiers into its composer and attaches the canonical place.
7. After publication, Jelly sends the `jellyPostId`, participation ID, and locked mission revision to PlatePost using an idempotency key.
8. PlatePost fetches canonical Jelly evidence, verifies requirements, and updates the submission asynchronously.
9. Signed PlatePost webhooks terminate at Jelly's backend, never in the mobile app. Jelly may send a push hint containing only a safe resource reference; the app then refreshes the affected PlatePost owner resource with a fresh mission token.

The Jelly client never supplies reward terms, approval state, username, proof decisions, or leaderboard totals.

## Submission and user-visible status

PlatePost returns separate fields for verification, decision, submission, reward, and display state. Jelly clients render only the documented safe display state and next action.

The user-visible lifecycle includes:

- Not started.
- In progress.
- Submitted.
- Verifying.
- Under review.
- Approved, reward pending.
- Rewarded.
- Rejected with a safe reason and optional resubmission action.
- Support needed for an uncertain reward or operator-held case.

Status history remains available after a mission ends or is archived. Revisions are locked when participation starts so an admin edit cannot change the terms of an in-progress or submitted mission.

## Leaderboard API

Two public resources serve both PlatePost web and Jelly native clients:

- `GET /api/v2/jellyhunt/leaderboards/current-season`
- `GET /api/v2/jellyhunt/leaderboards/all-time`

Both accept `cursor` and `limit`. The default limit is 20 and maximum is 100. Responses use short public caching, a semantic ETag, `leaderboardRevision`, and `stale-while-revalidate`. The all-time cursor and ETag bind `scopeKey: all_time` and the global revision. The current-season handler first resolves the selected campaign, then binds its cursor and ETag to the concrete `scopeKey: campaign:<campaignId>` and that campaign's revision in addition to route, normalized query, page size, and last sort values. Changing `isCurrent` therefore invalidates an old current-season cursor even when two campaigns happen to share the same numeric revision.

The current-season route returns `404 campaign_not_found` when no current campaign is selected. Rank is computed only over `publicEligible: true` entries, so withheld profiles do not create visible rank gaps. Cursor state includes `eligibleItemsSeen`, last displayed rank, last score, normalized username, and stable public entry ID. If the first item on the next page has the prior score, it reuses the prior rank; otherwise its competition rank is `eligibleItemsSeen + 1`. Because a cursor is revision-bound, the next page can continue a shared-rank group exactly; a changed leaderboard returns `400 invalid_cursor` with `restartRequired: true`.

Example:

```json
{
  "data": {
    "scope": "current_season",
    "rankingBasis": "approved_missions",
    "campaign": {
      "id": "cam_01...",
      "title": "JellyHunt NYC — Season 1",
      "startsAt": "2026-08-01T04:00:00Z",
      "endsAt": "2026-09-01T03:59:59Z"
    },
    "standings": [
      {
        "rank": 1,
        "username": "ari",
        "approvedMissionCount": 12
      },
      {
        "rank": 2,
        "username": "mika",
        "approvedMissionCount": 10
      }
    ]
  },
  "meta": {
    "apiVersion": "2.0",
    "requestId": "req_01...",
    "generatedAt": "2026-08-12T20:00:00Z",
    "leaderboardRevision": 84,
    "page": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

The all-time response uses `scope: all_time`, omits `campaign`, and includes `startsAt` equal to the PlatePost tool launch epoch.

### Ranking rules

1. Score is the number of non-reversed approved-completion rows in scope.
2. One user/mission completion counts at most once.
3. Pending, verifying, under-review, rejected, duplicate, and client-only records do not count.
4. Reward amount and reward delivery do not affect score.
5. Equal totals share competition rank: scores `12, 12, 10` produce ranks `1, 1, 3`.
6. Entries inside one equal-score group are ordered by normalized canonical username, then stable public entry ID.
7. All-time begins at the documented PlatePost launch epoch.
8. Only `publicEligible: true` entries with a canonical public username participate in public ordering and rank.

## Consumer leaderboard experience

The existing Leaderboard destination in `/human-social` becomes a live city scorecard while retaining the original JellyHunt visual language.

- Tabs labeled **This season** and **All time**.
- Copy under All time identifies the PlatePost JellyHunt launch boundary.
- The top three use prominent rank cards consistent with the existing Dark and Wobbles themes.
- Remaining users appear in a compact ranked list.
- Each entry shows rank, canonical Jelly username, and approved mission count.
- The first page loads only when the panel opens so the map is not delayed.
- Load more uses the opaque cursor.
- Loading, empty, unavailable, retry, and end-of-list states are explicit.
- No fixture or invented user data may appear in production.
- A leaderboard failure does not block mission discovery, the map, or mission detail.
- Tabs, controls, and results support keyboard use, visible focus, screen readers, reduced motion, and mobile layouts.

## Original JellyHunt parity

The integration is not complete until the Convex-backed experience preserves the original useful JellyHunt behavior:

- Full-screen mission map and all reviewed seeded stops.
- Mission markers, selection, drawer/detail, reward, prompt, hours, distance, and directions.
- Search and category/status filtering.
- Dark and Wobbles themes.
- Location permission success and denial handling.
- Passport progress based only on authenticated PlatePost status.
- Editorial Map from the same mission records.
- Live leaderboard from the new projection.
- Jelly app links and native mission start/composer handoff.
- Empty, no-results, missing-map-token, Convex-unavailable, and Jelly-unavailable states.

The PlatePost web page, admin preview, public APIs, and Jelly native client must render the same published mission revision.

## Seeded legacy migration and compatibility

The original sources disagree and none is automatically authoritative:

- The live Jelly website mission API reads Supabase `jellyhunt_missions` rows.
- The pinned original page contains separate `MISSIONS`, `MISSIONS_DATA`, and `MISSIONS_MAP` constants.
- The legacy SQL schema does not supply a slug or a complete checked-in production seed.
- The current 16-record PlatePost JSON was derived for visual/migration planning and is not production truth.

### Reviewed mission provenance manifest

Before development import, export the live Supabase mission rows and reconcile them field by field against the three constant arrays at Jelly website commit `5c2fe90b95c84da493ed36896eaa27310c34799f`. Produce one reviewed manifest containing the Supabase record ID, original array ID, stable PlatePost public ID, new PlatePost slug alias, every mission/place field, canonical Jelly place ID, source/provenance per field, reviewer, review timestamp, and SHA-256 checksum. Generated slugs are new PlatePost aliases, never represented as legacy values.

Only that reviewed manifest may be imported:

1. Dry-run the exact checksum against PlatePost development Convex.
2. Import draft/manual records and verify the stable public-ID mapping and every field.
3. Complete map/admin/API acceptance in development.
4. Commit the reviewed manifest and checksum without credentials.
5. Dry-run the same checksum against Production, then explicitly import draft/manual records.
6. Re-review the Production records before publishing a pilot.

Convex data does not move with a Vercel deployment. Development and Production imports are separate, explicit, audited operations over the same reviewed manifest.

### Historical replay safety without legacy scoring

At a documented UTC cutover:

1. Activate the pre-deployed JellyHunt-specific Supabase data-plane fence described below, disable the matching submission, verification/approval/status, business-wallet credential, tip, and payout routes/jobs, and keep PlatePost writes and rewards disabled until the signed fence receipt passes acceptance.
2. Revoke the old JellyHunt business-wallet passwords/tokens after reconciliation; never import those credentials into Convex.
3. Drain in-flight JellyHunt work and reconcile every pending, failed, uncertain, skipped, and successful legacy transfer.
4. Export legacy Jelly user, legacy mission, exact Jelly post ID, submission status, reward intent, transaction ID/hash, and timestamps after the write fence.
5. Import history as `source: legacy` with `countsTowardLeaderboard: false`.
6. Create global tombstones for every verified exact Jelly post ID and successful transaction ID/hash so they cannot be submitted or paid again.
7. Do not place pre-launch user/legacy-mission pairs in the new campaign's live uniqueness key. A user may complete the new campaign-bound PlatePost mission with a new Jelly post and earn a new-tool leaderboard completion.
8. A null identifier produces no uniqueness claim. A duplicate, conflicting, or unreconciled post/transaction identifier enters `jellyhuntLegacyDedupeRecords` quarantine. Affected user/mission attempts may be submitted, but automatic payout remains held for manual reconciliation until the quarantine is cleared.
9. Require matching source/import counts and hashes, zero orphan successful transactions, and zero unresolved payout-capable quarantine rows before automatic rewards are enabled.
10. Keep every independent legacy JellyHunt writer disabled. Any temporary backend adapter delegates to the same PlatePost mutation using a verified Jelly subject.

#### Database-enforced legacy writer fence

The Jelly website repository must ship and rehearse a Supabase migration before cutover; route flags alone are not a fence. At the watermark, one database transaction takes an access-exclusive lock on the JellyHunt-only submission and credential tables, waits for pre-existing writers to drain, activates an immutable singleton cutover record, removes the authenticated `submissions_user_insert` policy/grant, and enables fail-closed `BEFORE INSERT OR UPDATE OR DELETE` triggers on `jellyhunt_submissions` and `jellyhunt_business_wallets` that raise `legacy_write_disabled`. The trigger applies to the shared campaign/shop service-role client as well as authenticated clients; the service credential itself is not revoked because unrelated PlatePost-site Pets/Wobbles code still uses it. The transaction also deactivates JellyHunt business-wallet records and emits a signed fence receipt containing the watermark, migration checksum, affected objects, and operator identity.

The cutover coordinator first pauses the legacy verify/retry routes, drains in-flight requests, and revokes the JellyHunt business-account passwords, access tokens, and active sessions at Jelly; it then immediately executes the database fence transaction. These are ordered safety barriers, not a claimed cross-system transaction. Credential/session revocation is required because the legacy `PATCH /api/jellyhunt/verify` path can call `/crypto/send` after a read and cannot be stopped by a write trigger alone. Production PlatePost rewards remain off until Jelly confirms credential/session revocation and every ambiguous transfer is reconciled. Rollback may restore the web presentation, but it never removes this data-plane fence or re-enables legacy payout credentials.

The cutover migration must not install a broad write trigger on `jellyhunt_balances` or `jellyhunt_tip_audit_log`, because Pets/Wobbles still use those shared tables. Instead, all legacy JellyHunt approval paths are stopped at the submission admission point and external payout authority is revoked; any narrower audit-row guard must identify JellyHunt rows by a reviewed source/submission discriminator. Acceptance runs after the watermark and proves all of the following:

- A direct authenticated Supabase insert into `jellyhunt_submissions` fails with `legacy_write_disabled`.
- Direct insert/update/delete attempts through the shared service-role client fail on both fenced JellyHunt tables, including requests from a deliberately stale legacy deployment.
- Stale wallet `POST`/`PATCH` and wallet-session routes cannot create, reactivate, mutate, or obtain usable JellyHunt payout authority.
- Stale `POST` and `PATCH /api/jellyhunt/verify` requests cannot reach a successful `/crypto/send`; the instrumented Jelly ledger records zero post-fence legacy transfers.
- Read-only export and reconciliation remain available.
- Pets/Wobbles balance increments, purchases, refunds, shields, and audit writes still pass unchanged.

`jellyhunt_balances` and `jellyhunt_tip_audit_log` have Pets/Wobbles consumers. Do not freeze, drop, truncate, or globally revoke access to those shared tables. Fence the JellyHunt data-plane admission points, routes, credentials, and workers described above, then regression-test Pets/Wobbles balances, purchases, refunds, shields, and audit behavior.

### Jelly website route disposition

The Jelly website compatibility surface is distinct from PlatePost v1 and has its own authentication and payloads.

| Existing Jelly website surface | Migration behavior | Final behavior |
| --- | --- | --- |
| `/jellyhunt` | Pinned commit is the visual/functional comparison baseline; it continues using its constants during side-by-side acceptance. | `308` redirect to PlatePost `/human-social` after acceptance. |
| `GET /api/jellyhunt/missions` | Frozen fixture, then server-side PlatePost read adapter if an old client still requires it. | Retire after v2 adoption. |
| `GET /api/jellyhunt/progress` | Frozen fixture mapped from PlatePost owner status through verified Jelly identity. | Retire after v2 adoption. |
| `POST /api/jellyhunt/submit` | Frozen fixture; temporary adapter may call the one PlatePost submission mutation and preserve the old response. | `410 legacy_write_disabled` after the client migration deadline. |
| `POST|PATCH /api/jellyhunt/verify` | No proxy payout authority; disable at the UTC write fence. | `410 legacy_write_disabled`; PlatePost admin is the only review/reward orchestrator. |
| `GET /api/jellyhunt/leaderboard` | Keep the frozen Supabase response only while the old page is live. It remains legacy-only and may expose its historical `user_id`, avatar, coin, and sequential-rank shape. | `410 legacy_leaderboard_retired` when `/jellyhunt` redirects. New clients use v2, which never exposes user IDs. |
| `GET /api/jellyhunt/admin/submissions` | Read-only reconciliation access until the signed cutover report is complete. | `410`; use PlatePost admin. |
| `GET /api/jellyhunt/admin/wallets` and `/wallet-details` | Read-only reconciliation access; never return secrets to a browser response. | `410` after credential revocation. |
| Wallet create/update and wallet-session mutations | Disable at the write fence. | `410`; no Supabase payout credential authority. |
| `GET /api/jellyhunt/admin/audit` | Read-only archival export through the retention window. | Archived report; new events live in PlatePost audit. |
| `/admin_jellyhunt` | Read-only reconciliation link during cutover. | Redirect to PlatePost `/admin/jellyhunt`. |

Every method and error response in this matrix receives an executable fixture and retirement test. The legacy leaderboard is deliberately retired rather than silently remapped because its public user ID, coin score, and sequential rank conflict with the approved v2 privacy and scoring contract.

### PlatePost v1 disposition

PlatePost `/api/v1/jellyhunt/*` is a separate compatibility contract:

| PlatePost route | Behavior |
| --- | --- |
| `GET /api/v1/jellyhunt/missions` | Preserve its frozen response while reading the shared namespaced Convex mission records. |
| `POST /api/v1/jellyhunt/submissions` | Pre-cutover compatibility only: route through the same canonical v2 mutation and verified subject bridge, never an independent writer. At the UTC watermark it returns `410 legacy_write_disabled` and is never re-enabled. |
| `/api/v1/jellyhunt/admin/*` | Remains PlatePost's protected adapter during implementation, then mounts under the canonical PlatePost `/admin/jellyhunt` experience. |

No Jelly website fixture is reused as a PlatePost v1 fixture; both suites run independently through retirement.

### Original JellyHunt baseline disposition

Against pinned Jelly website commit `5c2fe90b95c84da493ed36896eaa27310c34799f`:

- **Preserved on PlatePost web:** full-screen map, reviewed mission markers, mission drawer, hours/directions, search/filtering, Dark/Wobbles themes, Passport shell, Editorial Map, leaderboard destination, and app-store links.
- **Changed intentionally:** missions come from Convex instead of constants; a Passport stamp appears only after approval rather than pending submission; leaderboard score is approved mission count rather than coins; reward state is separate from approval.
- **Native-only:** Jelly authentication, Jelly Library/post selection, composer, canonical profile/activity, post publication, and push handling.
- **Retired:** browser Supabase mission writes, browser/admin payout credentials, Supabase verification/tipping authority, hardcoded production mission arrays, and the legacy coin-ranked leaderboard.

Status mapping is explicit: legacy `pending` becomes submitted/under-review and is not stamped; legacy `approved` becomes approved with a separate reward state and is stamped; legacy `rejected` remains rejected with PlatePost-controlled resubmission eligibility.

Desktop and mobile side-by-side screenshots, keyboard flows, and functional acceptance use that pinned commit. The comparison records every intentional difference and requires PlatePost/Jelly product approval before the old route redirects.

## Failure and recovery behavior

- Missing Convex configuration fails closed; production never falls back to fixtures.
- Convex unavailability returns a stable `503 dependency_unavailable`; the map and leaderboard show independent retry states.
- Jelly profile unavailability never invents a username and does not discard an approval.
- Jelly verification unavailability moves the submission to review/support, not approval or rejection by guess.
- Reward uncertainty never triggers an automatic transfer retry.
- Duplicate submission and post-use conflicts are enforced transactionally in Convex.
- A stale leaderboard cursor returns `400 invalid_cursor` with `restartRequired: true`.
- Projection mismatch alerts operators and is repaired from the approved-completion ledger.
- Pausing a mission prevents new starts/submissions but preserves existing owner history.

## Security and privacy

- v2 public leaderboard responses contain username, rank, and approved mission count only.
- Jelly user IDs, email, wallet, coordinates, post evidence, and moderation details remain private.
- Native personalized routes require short-lived Jelly mission tokens; a shared API key cannot ship in a mobile binary.
- Next.js and Convex service credentials remain server-only and never use `NEXT_PUBLIC_*` names.
- Jelly partner calls use narrowly scoped, rotated server credentials.
- Admin decisions use named sessions where PlatePost supports them and append immutable audit records.
- Public responses do not expose raw Convex errors or Jelly response bodies.

## Test-first verification

### Domain and projection tests

- First approval inserts one completion and increments both scopes.
- Replaying the same approval returns the existing result without incrementing.
- Concurrent approvals for the same user/mission produce one completion.
- Concurrent approvals for different missions do not lose increments.
- Rejection, review, and duplicate records never count.
- Reward queued, sent, failed, and uncertain transitions do not change score.
- Explicit reversal decrements both scopes exactly once.
- A reversal racing a reward-worker lease either cancels/releases and reverses atomically or returns `reconciliation_required`; it never leaves a payable rejected submission.
- Post-payment moderation removes the completion from both eligible standings while retaining the paid reservation, immutable receipt, transaction identity, and owner-visible rewarded history; it cannot resubmit or create another reward.
- Projection rebuild matches the ledger.
- A late approval after rollover increments its immutable submission campaign and all-time, never the new current campaign.
- Pre-epoch and `countsTowardLeaderboard: false` legacy rows are excluded from all-time.
- The migration-only legacy import cannot increment standings, reserve budget, create a reward intent, or emit payout work, and cannot run after its signed Production window closes.
- A new campaign-bound mission permits a fresh completion even when the user completed the legacy or prior-season counterpart.
- A completion conflict commits quarantine plus audit/outbox evidence before the API returns a conflict.
- Equal scores receive shared competition ranks and deterministic username order, including when a tie crosses a page boundary.
- A same-decision/different-submission replay is quarantined without setting the losing submission's approval or reward state.
- Username, account-state, moderation, and public-eligibility changes update index membership and invalidate every affected scope revision.
- Selecting a new current campaign invalidates old current-season ETags and cursors even when campaign revisions match numerically.

### API contract tests

- Mission list filters, pagination, public caching, and authenticated viewer isolation.
- Mission detail includes every composer/location field and omits private policy fields.
- Participation locks revision and deadline.
- Submission idempotency and privacy-safe conflicts.
- User resources preserve approval and reward state independently.
- Both leaderboard scopes validate against exact JSON fixtures.
- Public leaderboard responses never expose Jelly user IDs.
- Invalid and stale cursors fail predictably.
- Frozen v1/legacy fixtures remain unchanged.

### UI tests

- Opening Leaderboard fetches the current-season first page once.
- Switching scopes renders independent cached results.
- Loading, empty, retry, results, and load-more states render correctly.
- The map remains usable when leaderboard loading fails.
- Top-three and remaining standings render usernames, shared ranks, and counts.
- Original map, filters, detail drawer, Passport, Editorial Map, themes, and app links remain functional.

### Shared PlatePost integration tests

- Existing PlatePost pages and admin routes still render.
- The reviewed mission manifest produces identical development and Production field/public-ID checksums while remaining draft/manual after import.
- Null, duplicate, and conflicting legacy post/transaction identifiers enter deterministic quarantine and cannot enable automatic payout.
- Pets/Wobbles balances, purchases, refunds, shields, and audit flows remain unchanged when JellyHunt writers are fenced.
- The activated Supabase fence rejects direct authenticated writes and stale service-role writes while preserving read-only exports and shared Pets/Wobbles operations.
- PlatePost's Manus webhook and other Convex HTTP routes remain registered.
- Convex generation/typecheck succeeds against the merged schema.
- One admin edit changes the web map and mission API without a Vercel redeploy.
- One native-style journey discovers, starts, submits, reviews, approves, ranks, and rewards exactly once.
- Preview and Production use separate Convex deployments and credentials.
- The reviewed integration manifest binds the exact source/target commits and deployment mapping used by the test.
- `pnpm install`, `pnpm exec convex dev --once --typecheck enable`, `pnpm test`, `pnpm lint`, `pnpm build`, and the added `pnpm test:e2e` all exit zero in the canonical PlatePost repository.
- The Jelly native repository runs the consumer-driven contract command recorded in the integration manifest against the same OpenAPI/fixture revision.

## Documentation and AI handoff

Implementation updates these files as part of the same feature:

- `README.md`: current architecture, native mission journey, leaderboard behavior, existing-Vercel deployment, and shared-Convex warning.
- `CHANGELOG.md`: schema, contract, API, UI, migration, compatibility, and safety changes.
- `docs/API.md`: implemented mission/status/leaderboard endpoints and exact examples.
- `docs/ARCHITECTURE.md`: namespaced topology, profile ownership, completion ledger, and materialized projections.
- `docs/NEXT_STEPS.md`: ordered PlatePost database, credential, migration, Jelly contract, and acceptance checklist.
- `docs/PLATEPOST_INTEGRATION.md`: exact merge paths, environment variables, Convex generation, migration, preview validation, and production promotion.
- `AGENTS.md`: repository boundaries, current implementation status, required commands, safe edit areas, and explicit prohibitions for PlatePost engineers and AI agents.
- `openapi/jellyhunt-v2.yaml`: executable OpenAPI 3.1 contract for campaign, mission, place, participation, submission, personal status, event, and leaderboard resources.
- `tests/contracts/jellyhunt-v2/`: shared request/response/error fixtures consumed by PlatePost and Jelly native contract tests.
- `docs/runbooks/JELLYHUNT_CUTOVER.md`: transactional Supabase trigger/policy fence, stale-deployment probes, Jelly credential/session revocation, history/tombstone import, reconciliation, and signed cutover report.
- `docs/runbooks/JELLYHUNT_ROLLBACK.md`: web rollback, mission pause, writer-fence preservation, and reward-safety procedure.
- `docs/runbooks/JELLYHUNT_LEADERBOARD_REBUILD.md`: ledger comparison, dry-run diff, projection repair, revision bump, and audit procedure.

The handoff must state that Vercel already exists and that the remaining infrastructure task is safely merging and connecting the namespaced JellyHunt backend to PlatePost's development Convex deployment. It must not instruct anyone to deploy the standalone schema over the shared project.

## Rollout order

1. Namespace and merge the Convex/web code into PlatePost development.
2. Add campaigns, stable IDs, split statuses, public profile projections, approved-completion ledger, and leaderboard projections.
3. Implement mission discovery/detail, participation, submission, personal status, and leaderboard APIs with contract tests.
4. Import and review the 16 seeded missions as drafts.
5. Connect the original JellyHunt-style web experience to live Convex data and the leaderboard API.
6. Complete Jelly mission-token, profile, post/place evidence, reward-intent, lookup, and webhook contracts.
7. Build the Jelly native mission chooser and composer handoff against v2.
8. Fence legacy writers, run end-to-end Preview acceptance, and publish a small pilot.
9. Promote to Production only after reconciliation, security, accessibility, and operator runbooks pass.

## Definition of done

The feature is complete only when:

- PlatePost admin controls live campaigns, missions, and locations without code deployment.
- PlatePost web and Jelly native clients read the same published mission revisions.
- Jelly users can discover, start, post to, and inspect status for a mission through PlatePost APIs.
- Approved completions update current-season and all-time standings exactly once.
- The public leaderboard shows canonical Jelly usernames and approved mission counts with no private identifiers.
- The original JellyHunt map, mission, Passport, Editorial Map, leaderboard, and app-link experiences pass browser acceptance using Convex data.
- The seeded Supabase/legacy workflow cannot create a second submission or payout after cutover.
- README, changelog, architecture, API, PlatePost integration, AI-agent, and next-steps documentation match the deployed system.
- PlatePost's existing website, admin, Convex functions, and Manus webhook remain intact.
