# JellyHunt Shareable Preview Deployment — Design

Date: 2026-07-27
Status: Approved for planning
Owner: Brandon Shi (PlatePost)

## Goal

Deploy PlatePost JellyHunt to real infrastructure on real data, reachable at a
shareable preview URL, so the Jelly team (Kris) can click through the consumer
map and the operator admin and can build the native app against a live v2 API.

Rewards remain disabled. No real user can complete a mission end to end, because
the Jelly partner APIs that would make that possible do not exist yet.

## Scope

This design covers launch gates 2 and 3 of [`docs/NEXT_STEPS.md`](../../NEXT_STEPS.md),
adapted for a standalone deployment.

**In scope**

- A new, dedicated Convex project for JellyHunt.
- A new, dedicated Vercel project deploying this repository.
- Campaign and program configuration.
- Import of the 16 legacy missions as reviewed drafts.
- A published pilot of 3–4 verified missions.
- Real Mapbox rendering.
- Verification that operators can change the live map without a code release.

**Out of scope**

- Gate 1 credential rotation. This is Brandon's action in the Convex and Vercel
  dashboards and cannot be performed from this repository. See "Credential
  rotation" below.
- Gates 4–7: Jelly mission tokens, place/evidence APIs, reward transfer APIs,
  native app integration, and legacy dedupe/payout migration. All are blocked on
  the Jelly backend and app teams.
- Any production deployment.
- A custom `platepost.io` subdomain.
- Merging the JellyHunt schema into PlatePost's main Convex project.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Hosting model | Standalone Vercel project + standalone Convex project | Zero blast radius against the live restaurant menus. Avoids dropping ~30 `jellyhunt*` tables into `youthful-corgi-373` and avoids the known `convex/_generated/api.d.ts` regeneration trap in the main repository. |
| Audience | Unlisted `*.vercel.app` preview URL | Shareable with Jelly immediately. Defers custom-subdomain DNS, which on `platepost.io` has no wildcard and takes hosts offline if the subdomain is not registered first. |
| Mission publishing | Draft-first, then a small verified pilot | Publishing all 16 unreviewed would present unverified addresses and coordinates to Jelly as real. Verifying all 16 fully is impossible today because canonical Jelly place IDs do not exist. |
| Rewards | Hard off | `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=false`, `JELLYHUNT_ENVIRONMENT_IDENTITY=development`, `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=false`. No transfer path can execute. |
| Approval mode | Manual for pilot missions | Automatic verification depends on Jelly evidence endpoints that do not exist. Manual keeps the review queue exercised and honest. |

## Architecture

Two independent services, neither shared with the PlatePost menu platform.

```
Vercel project "jellyhunt"            Convex project "jellyhunt"
  Next.js 15 app                        jellyhunt* tables
  /human-social  (public map)  ──────►  campaigns, places, missions,
  /admin         (operators)            revisions, participations,
  /api/v1/...    (compatibility)        submissions, events, budgets,
  /api/v2/...    (native contract)      reward intents, leaderboards,
                                        audit
        │
        └── Mapbox GL (public token)
```

`JELLYHUNT_DATA_SOURCE=convex`. The fixture data source is not used in any
deployed environment; the application rejects it when `NODE_ENV=production`.

### Environment variable split

Values read by the Next.js server belong in Vercel. Values read by Convex actions
belong in the Convex deployment. Names come from [`.env.example`](../../../.env.example),
which stays the source of truth.

**Vercel (all environments used by this project)**

- `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `CONVEX_URL`
- `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` — a public Mapbox token (`pk.`), reused from
  the existing PlatePost Mapbox account. A Vercel access token is not a Mapbox
  token.
- `JELLYHUNT_DATA_SOURCE=convex`
- `JELLYHUNT_ADMIN_USERNAME`, `JELLYHUNT_ADMIN_PASSWORD`, `JELLYHUNT_ADMIN_SESSION_SECRET`
- `JELLYHUNT_CURSOR_SECRET`
- `PLATEPOST_CONVEX_SERVICE_KEY`
- `NEXT_PUBLIC_JELLY_IOS_APP_URL`, `NEXT_PUBLIC_JELLY_ANDROID_APP_URL`

**Convex deployment**

- `JELLYHUNT_ENVIRONMENT_IDENTITY=development`
- `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=false`
- `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=false`
- `JELLYHUNT_VERIFICATION_AUTORUN_ENABLED=false`
- `JELLYHUNT_MAX_REWARD_AMOUNT=10000`
- `PLATEPOST_CONVEX_SERVICE_KEY`

`PLATEPOST_CONVEX_SERVICE_KEY` is the one secret that must hold the **same
value** in Vercel and in Convex. Convex compares against it in
`requireServiceKey` (`convex/jellyhunt/security.ts`); the Next.js repositories
and the mission importer present it. A mismatch fails closed as `unauthorized`,
so every admin write, every v2 write, and the mission import stop working.

`JELLYHUNT_VERIFICATION_AUTORUN_ENABLED` is set to `false` rather than the
`.env.example` default of `true`, because automatic verification calls Jelly
partner endpoints that are not configured. Scheduling verification against
absent endpoints would produce a queue of failures with no diagnostic value.

**Deliberately left unset**

`JELLY_MISSION_JWKS_URL`, `JELLY_MISSION_TOKEN_ISSUER`, `JELLY_PARTNER_*`,
`JELLYHUNT_API_KEY`, `JELLY_LEGACY_API_TOKEN`, `JELLY_REWARD_*`,
`JELLYHUNT_WEBHOOK_SECRET_*`.

These are gate 4 and gate 7 values. Leaving them unset means authenticated v2
routes reject every bearer token, which is the correct and safe behavior for this
milestone: public reads work, writes are impossible.

Every secret is generated fresh for this deployment. No value is copied from the
PlatePost production environment, and no secret is placed in a `NEXT_PUBLIC_*`
variable.

### Credential rotation

A production Convex deploy key and a Vercel credential were exposed in chat while
this repository was built. They grant access to PlatePost's live infrastructure,
not only to JellyHunt.

This design does not depend on either value, and no step reuses them. That is
containment, not remediation. Both must still be revoked and rotated by Brandon
in the Convex and Vercel dashboards. This work can proceed in parallel; it is
recorded here because it is a real open security exposure, not because it blocks
the deployment.

## Data model and content

### Program and campaign

A program configuration and one development campaign are created before any
mission is published, because submission intake reserves budget at campaign
scope and rejects submissions when no allocation exists.

The campaign carries an all-time leaderboard launch epoch set to the campaign
start. All-time standings therefore begin at this tool's launch boundary rather
than claiming to include legacy JellyHunt history, which has not been migrated.

A nominal non-zero reward allocation is configured so intake logic is exercised.
This is safe: `automaticRewardDispatchAllowed` in `convex/jellyhunt/rewards.ts`
returns `false` on its first check when `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED` is
not exactly `"true"`, so an allocation cannot become a transfer. The identity and
production-approval flags are additional gates behind that one, not independent
substitutes for it.

### Mission import

Source: [`migrations/legacy-jellyhunt-missions.json`](../../../migrations/legacy-jellyhunt-missions.json),
16 Lower East Side and East Village missions with real addresses, coordinates,
hours, geofence radii, categories, and reward amounts.

Import runs `pnpm migrate:legacy-jellyhunt` as a dry run first, and the target
deployment printed by the importer is confirmed before `--apply`. Every mission
lands as `draft` with `approvalMode: manual`.

### Mission review

Each mission published in the pilot is checked by hand against reality:

- Address matches the named business and the business is currently open.
- Latitude and longitude land on the correct building.
- Hours are plausible and current.
- Geofence radius suits the block; the imported default is 75 metres.
- Timezone is `America/New_York`.
- Title, description, instructions, category, difficulty, emoji, neighborhood,
  and reward amount read correctly in the public drawer.

**Known gap:** canonical Jelly place IDs cannot be verified. Jelly has not
published the place contract. Pilot missions therefore run with manual approval
and no automatic place evidence. This is recorded on each mission and is the
single largest reason this deployment is a demonstration rather than a live
program.

Missions not in the pilot remain drafts. They are invisible to the public map and
to both API versions, and Brandon can publish any of them from `/admin` without
an engineer.

## Verification

The deployment is not described as working until each of the following has been
observed directly, with the observation recorded.

**Deployment**

1. The preview URL serves `/human-social` with Mapbox raster tiles, not the
   coordinate-grid fallback.
2. `/admin` rejects an incorrect password and accepts the configured one.

**The operator claim** — this is the central test of the entire build.

3. Editing a published mission's title in `/admin` changes it on `/human-social`,
   on v1 `GET /missions`, and on v2 `GET /missions` and mission detail, with no
   code deployment.
4. Pausing a mission removes it from public discovery on all three surfaces while
   its revisions, submissions, events, and audit history survive.

**Safety**

5. Every authenticated v2 route rejects requests without a valid Jelly mission
   token, and no caller-supplied identity is accepted.
6. No reward intent can reach a transfer-capable state. Verified by exercising
   `automaticRewardDispatchAllowed` against the deployed environment values, not
   assumed from the configuration file.

**Regression gates**

7. `pnpm test`, `pnpm test:contracts`, `pnpm test:convex`, `pnpm validate:openapi`,
   `pnpm lint`, and `pnpm build` all pass.
8. `pnpm typecheck:convex` passes against the new development deployment. A
   Next.js build does not validate Convex independently.

Failure of any check stops the milestone rather than being noted as a caveat.

## Actions requiring Brandon

- Create the Convex project under the PlatePost Convex team. The CLI requires an
  interactive browser login and cannot be completed unattended.
- Create or authorize the Vercel project against the `platepostjelly` repository.
- Choose the `/admin` username and password.
- Revoke and rotate the two exposed credentials, independently of this work.

## What this milestone does not deliver

A real Jelly user cannot play. There is no mission token issuer, no post
verification, no place evidence, and no payout path. Approval is manual and no
reward can be sent.

What Kris receives is a live consumer map, a working operator admin, and a
deployed v2 API matching [`openapi/jellyhunt-v2.yaml`](../../../openapi/jellyhunt-v2.yaml)
to build the native client against. Unblocking real play requires gate 4, which
is Jelly backend work.

## Risks

| Risk | Handling |
| --- | --- |
| Preview data mistaken for a live program | Pilot missions are few and explicitly manual-approval. The preview URL is unlisted and rewards are provably off. |
| Unverified mission content shown to a partner | Only hand-checked missions are published; the rest stay drafts. |
| Exposed credentials reused by accident | Every secret in this deployment is freshly generated. No production value is copied. |
| Convex schema drift against PlatePost's main project | Not applicable at this milestone. The projects are separate. A future merge would require the gate 2 schema review. |
| Mapbox token misuse | The token is public by design, but it is reused from the PlatePost menu platform, so preview traffic bills the same Mapbox account. Whether that token carries URL restrictions has not been checked; if it does, the preview host must be added to its allowlist or tiles will fail to load. Both are confirmed during setup, and a JellyHunt-specific token is created instead if either is a problem. |

## References

- [Next steps and launch gates](../../NEXT_STEPS.md)
- [PlatePost integration status](../../PLATEPOST_INTEGRATION.md)
- [Architecture](../../ARCHITECTURE.md)
- [Native Mission API v2 design](2026-07-16-platepost-jelly-native-api-v2-design.md)
