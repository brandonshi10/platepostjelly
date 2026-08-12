# JellyHunt Shareable Preview Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy PlatePost JellyHunt to a dedicated Convex project and a dedicated Vercel project on real mission data, reachable at a shareable preview URL, with rewards provably disabled.

**Architecture:** Two standalone services, neither shared with the PlatePost menu platform. A new Convex project holds the `jellyhunt*` tables; a new Vercel project serves the Next.js app with `JELLYHUNT_DATA_SOURCE=convex`. One code change is required first: the `jellyhuntProgramConfig` singleton that leaderboards depend on has no creation path in the codebase.

**Tech Stack:** Next.js 15, React 19, TypeScript, Convex, Mapbox GL, Vitest, pnpm 9.

**Spec:** [2026-07-27-jellyhunt-preview-deployment-design.md](../specs/2026-07-27-jellyhunt-preview-deployment-design.md)

## Global Constraints

- Work in `~/platepostjelly` on a branch off `main`. Do not push to `main` without Brandon's approval.
- Never reuse the Convex production deploy key or Vercel credential exposed in chat. Every secret in this deployment is freshly generated.
- No secret may be placed in a `NEXT_PUBLIC_*` variable.
- `PLATEPOST_CONVEX_SERVICE_KEY` must hold the **same value** in Vercel and in Convex. A mismatch fails closed as `unauthorized`.
- `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=false`, `JELLYHUNT_ENVIRONMENT_IDENTITY=development`, `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=false` in every environment.
- `JELLYHUNT_VERIFICATION_AUTORUN_ENABLED=false` — Jelly partner endpoints do not exist; scheduling verification against them produces failures with no diagnostic value.
- `JELLYHUNT_DATA_SOURCE=convex`. Fixture mode must never be set in a deployed environment.
- Leave `JELLY_MISSION_JWKS_URL`, `JELLY_MISSION_TOKEN_ISSUER`, `JELLY_PARTNER_*`, `JELLYHUNT_API_KEY`, `JELLY_LEGACY_API_TOKEN`, `JELLY_REWARD_*`, and `JELLYHUNT_WEBHOOK_SECRET_*` unset.
- Convex functions in `convex/jellyhunt/` use `mutationGeneric`/`queryGeneric` from `convex/server`, not `./_generated/server`. Follow that pattern.
- Tests in `tests/convex/` reach functions through `anyApi.jellyhunt.*`, never the typed generated `api` object. Importing the typed `api` breaks `pnpm build`. See `docs/PLATEPOST_INTEGRATION.md`.
- Every mission stays `draft` until hand-verified. Only verified missions are published.
- Reward token code is the literal `"JELLY-MY-JELLY"`. Mission lifecycle values are `draft` / `active` / `paused` / `archived`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `convex/jellyhunt/campaigns.ts` | Campaign lifecycle. Gains the program-config singleton writer, because the singleton is program-scoped and campaigns are the only existing service-key-guarded lifecycle module. | Modify |
| `tests/convex/jellyhunt-campaigns.test.ts` | Campaign mutation tests. Gains coverage for the new mutation. | Modify |
| `.env.local` (untracked) | Local service-key and Convex URL for running the importer. | Create |
| `docs/superpowers/plans/2026-07-28-jellyhunt-preview-deployment.md` | This plan. | Created |

No new files. The one code change belongs in an existing module.

---

## Task 1: Add the program-config singleton writer

The `jellyhuntProgramConfig` singleton is read by `convex/jellyhunt/leaderboards.ts` (`loadProgramConfig`, throws `leaderboard_program_config_not_found`) and by `convex/jellyhunt/approvals.ts`. Nothing in the codebase inserts it — `grep -rn 'insert("jellyhuntProgramConfig"' convex/` returns nothing. Tests seed it directly through `ctx.db.insert` inside `convex-test`, which is not available in a real deployment. Without this task, both leaderboard tabs throw on a fresh deployment.

**Files:**
- Modify: `convex/jellyhunt/campaigns.ts` (append after `selectCurrentCampaign`)
- Test: `tests/convex/jellyhunt-campaigns.test.ts`

**Interfaces:**
- Consumes: `requireServiceKey` from `./security`, `createPublicId` from `./publicIds`, `recordAuditEvent` from `./audit` — all already imported at the top of `campaigns.ts`.
- Produces: `ensureProgramConfig(serviceKey: string, actorId: string, leaderboardLaunchEpoch: number, requestId?: string) => Promise<string>` returning the singleton's `publicId`. Idempotent: calling it twice returns the same `publicId` and does not modify the existing row. Task 3 calls it.

- [ ] **Step 1: Write the failing test**

Append a new top-level `describe` to `tests/convex/jellyhunt-campaigns.test.ts`. Every import it needs — `campaigns` (line 16), `createJellyhuntTestConvex`, `TEST_SERVICE_KEY`, `vi`, `describe`, `it`, `expect`, `beforeEach`, `afterEach` — already exists in that file.

The `beforeEach` stub is required, not decoration. `requireServiceKey` compares against `process.env.PLATEPOST_CONVEX_SERVICE_KEY`; without the stub it is undefined, every call throws `unauthorized`, and the test would pass its negative case while failing its positive one for the wrong reason.

```typescript
describe("ensureProgramConfig", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the singleton, is idempotent, and requires the service key", async () => {
    const t = createJellyhuntTestConvex();
    const epoch = Date.parse("2026-07-01T00:00:00Z");

    await expect(
      t.mutation(campaigns.ensureProgramConfig, {
        serviceKey: "wrong-key",
        actorId: "operator",
        leaderboardLaunchEpoch: epoch,
      }),
    ).rejects.toThrow(/unauthorized/);

    const first = await t.mutation(campaigns.ensureProgramConfig, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      leaderboardLaunchEpoch: epoch,
    });
    expect(first).toMatch(/^cfg_/);

    const second = await t.mutation(campaigns.ensureProgramConfig, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      leaderboardLaunchEpoch: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(second).toBe(first);

    const rows = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntProgramConfig").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].leaderboardLaunchEpoch).toBe(epoch);
    expect(rows[0].singletonKey).toBe("default");
  });
});
```

If `campaigns`, `createJellyhuntTestConvex`, or `TEST_SERVICE_KEY` are not already imported in this file, match the import style used by the existing tests in it — `campaigns` comes from `anyApi.jellyhunt.campaigns`, the helpers from `./helpers/setup`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/platepostjelly && pnpm test:convex -- -t "ensureProgramConfig"
```

Expected: FAIL. The mutation does not exist, so `convex-test` cannot resolve `campaigns.ensureProgramConfig`.

- [ ] **Step 3: Write the minimal implementation**

Append to `convex/jellyhunt/campaigns.ts`:

```typescript
/**
 * Admin/service-only: create the program-config singleton if it is absent.
 *
 * `jellyhuntProgramConfig` is read by the leaderboards and approvals
 * modules but had no creation path, so a fresh deployment threw
 * `leaderboard_program_config_not_found` on both leaderboard tabs. This is
 * idempotent by design: a second call returns the existing `publicId` and
 * never rewrites `leaderboardLaunchEpoch`, because moving the epoch after
 * completions exist would silently restate all-time standings.
 */
export const ensureProgramConfig = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    requestId: v.optional(v.string()),
    leaderboardLaunchEpoch: v.number(),
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = args.actorId.trim();

    const existing = await ctx.db
      .query("jellyhuntProgramConfig")
      .withIndex("by_singleton_key", (q: any) => q.eq("singletonKey", "default"))
      .unique();
    if (existing) return existing.publicId;

    const now = Date.now();
    const publicId = createPublicId("cfg");
    await ctx.db.insert("jellyhuntProgramConfig", {
      publicId,
      singletonKey: "default",
      leaderboardLaunchEpoch: args.leaderboardLaunchEpoch,
      leaderboardRevision: 0,
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "program_config.created",
      entityType: "program_config",
      entityId: publicId,
      nextState: { publicId, leaderboardLaunchEpoch: args.leaderboardLaunchEpoch },
      requestId: args.requestId,
    });

    return publicId;
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/platepostjelly && pnpm test:convex -- -t "ensureProgramConfig"
```

Expected: PASS.

- [ ] **Step 5: Run the full regression gates**

```bash
cd ~/platepostjelly && pnpm test && pnpm test:convex && pnpm lint && pnpm build
```

Expected: all pass. `cfg` is already in the `PREFIXES` list in `convex/jellyhunt/publicIds.ts`, so `createPublicId("cfg")` is valid and needs no change there.

- [ ] **Step 6: Commit**

```bash
cd ~/platepostjelly && git add convex/jellyhunt/campaigns.ts tests/convex/jellyhunt-campaigns.test.ts
git commit -m "fix: add missing program-config singleton writer

jellyhuntProgramConfig is read by leaderboards and approvals but nothing
created it outside convex-test, so a real deployment threw
leaderboard_program_config_not_found on both leaderboard tabs."
```

---

## Task 2: Create the Convex project and deploy the schema

**Files:** none modified in the repository. This task produces a deployed Convex environment and an untracked `.env.local`.

**Interfaces:**
- Produces: a Convex deployment URL used as `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL` by Tasks 3–6, and a service key value reused verbatim in Tasks 3–6.

- [ ] **Step 1: Generate the fresh secrets**

```bash
cd ~/platepostjelly && for name in PLATEPOST_CONVEX_SERVICE_KEY JELLYHUNT_ADMIN_SESSION_SECRET JELLYHUNT_CURSOR_SECRET; do
  printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
done
```

Record the three values. They are used in Tasks 2, 3, and 5 and must match exactly across Convex and Vercel.

**Ask Brandon** for the `/admin` username and password before continuing. Do not invent them and do not reuse the PlatePost `test`/`test` development credentials — this admin reads `JELLYHUNT_ADMIN_*`, not PlatePost's generic values.

- [ ] **Step 2: Create the Convex project**

```bash
cd ~/platepostjelly && npx convex dev --once --configure=new
```

This opens a browser for login. Brandon must complete it. Choose the PlatePost Convex team and a new project named `jellyhunt`. **Do not** select the existing `youthful-corgi-373` project — that hosts the live restaurant menus.

Expected: the command writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`, pushes the schema, and prints the deployment URL.

- [ ] **Step 3: Confirm you are pointed at the new project, not the menus**

```bash
cd ~/platepostjelly && grep CONVEX .env.local
```

Expected: the deployment name is the new `jellyhunt` project. STOP if it contains `youthful-corgi-373` or `neat-armadillo-434`.

- [ ] **Step 4: Set the Convex environment variables**

Substitute the service key generated in Step 1.

```bash
cd ~/platepostjelly
npx convex env set PLATEPOST_CONVEX_SERVICE_KEY '<service key from step 1>'
npx convex env set JELLYHUNT_ENVIRONMENT_IDENTITY development
npx convex env set JELLYHUNT_AUTOMATIC_REWARDS_ENABLED false
npx convex env set JELLYHUNT_PRODUCTION_REWARDS_APPROVED false
npx convex env set JELLYHUNT_VERIFICATION_AUTORUN_ENABLED false
npx convex env set JELLYHUNT_MAX_REWARD_AMOUNT 10000
npx convex env list
```

Expected: `npx convex env list` shows exactly those six names and no `JELLY_PARTNER_*`, `JELLY_REWARD_*`, or webhook secrets.

- [ ] **Step 5: Add the local-only values needed by the importer**

Append to `.env.local` (untracked; confirm with `git status --short` that it does not appear):

```dotenv
CONVEX_URL=<deployment URL from step 2>
PLATEPOST_CONVEX_SERVICE_KEY=<service key from step 1>
JELLYHUNT_DATA_SOURCE=convex
```

Remove the `JELLYHUNT_DATA_SOURCE=fixture` line written during the earlier local run if it is still present.

- [ ] **Step 6: Run the Convex typecheck gate**

```bash
cd ~/platepostjelly && pnpm typecheck:convex
```

Expected: passes. A Next.js build does not validate Convex independently, so this gate is not optional. If it fails on the pre-namespacing `convex/audit.ts`, `convex/missions.ts`, or `convex/submissions.ts` files, read the "Known gap surfaced by turning on real typecheck" section of `docs/PLATEPOST_INTEGRATION.md` before changing anything — those files are a documented known issue, and fixing them is not in this plan's scope. Report the failure to Brandon rather than working around it.

- [ ] **Step 7: Commit nothing, record everything**

`.env.local` is untracked and must stay that way. Record the deployment URL and project name in the task notes for Tasks 3–6.

---

## Task 3: Create the program config and the current campaign

`createMissionWithLocation` calls `currentCampaign(ctx)` and throws when no campaign is current, so this task must complete before any mission import.

**Files:** none modified. This task writes data to the Convex deployment from Task 2.

**Interfaces:**
- Consumes: `ensureProgramConfig` from Task 1; the service key and deployment from Task 2.
- Produces: a campaign `publicId` (prefix `cam_`) marked current, used implicitly by Tasks 4 and 5.

- [ ] **Step 1: Create the program config singleton**

```bash
cd ~/platepostjelly && npx convex run jellyhunt/campaigns:ensureProgramConfig '{
  "serviceKey": "<service key>",
  "actorId": "brandon@platepost.io",
  "leaderboardLaunchEpoch": 1782950400000
}'
```

`1782950400000` is `2026-07-01T00:00:00Z`. Expected: a `cfg_…` string.

- [ ] **Step 2: Create the campaign**

Map bounds are derived from the 16 real missions (latitude 40.7138–40.7301, longitude −74.0006 to −73.9819) with a small margin so edge pins are not flush against the viewport.

```bash
cd ~/platepostjelly && npx convex run jellyhunt/campaigns:createCampaign '{
  "serviceKey": "<service key>",
  "actorId": "brandon@platepost.io",
  "slug": "jellyhunt-preview-2026",
  "title": "PlatePost x JellyJelly: Human Social!",
  "shortTitle": "JellyHunt",
  "status": "active",
  "startsAt": 1782950400000,
  "endsAt": 1798761600000,
  "timeZone": "America/New_York",
  "rewardTokenCode": "JELLY-MY-JELLY",
  "rewardTokenDisplayName": "Jelly My Jelly",
  "map": {
    "centerLatitude": 40.72195,
    "centerLongitude": -73.99125,
    "boundsSouth": 40.7108,
    "boundsWest": -74.0036,
    "boundsNorth": 40.7331,
    "boundsEast": -73.9789,
    "defaultZoom": 14
  },
  "links": {
    "iosApp": "https://apps.apple.com/us/app/jellyjelly-human-social/id6505022038",
    "androidApp": "https://play.google.com/store/apps/details?id=app.jellyjelly.prod"
  }
}'
```

`1798761600000` is `2027-01-01T00:00:00Z`. Expected: a `cam_…` string. `createCampaign` never makes a campaign current on its own.

- [ ] **Step 3: Make it the current campaign**

```bash
cd ~/platepostjelly && npx convex run jellyhunt/campaigns:selectCurrentCampaign '{
  "serviceKey": "<service key>",
  "actorId": "brandon@platepost.io",
  "campaignPublicId": "<cam_ id from step 2>"
}'
```

- [ ] **Step 4: Verify the campaign is discoverable**

```bash
cd ~/platepostjelly && npx convex run jellyhunt/campaigns:getCurrentCampaign '{}'
```

Expected: the campaign object, not `campaign_not_found`.

---

## Task 4: Import the 16 missions as drafts

**Files:** none modified. Reads `migrations/legacy-jellyhunt-missions.json`.

**Interfaces:**
- Consumes: the current campaign from Task 3; `CONVEX_URL` and `PLATEPOST_CONVEX_SERVICE_KEY` from `.env.local`.
- Produces: 16 missions with `status: "draft"`, `approvalMode: "manual"`, `currentRevision: 1`, each with a place at `reviewStatus: "reviewed"`.

- [ ] **Step 1: Dry run**

```bash
cd ~/platepostjelly && pnpm migrate:legacy-jellyhunt
```

Expected: prints the target deployment origin, then `DRY RUN: 16 mission(s) missing; 0 existing slug(s) skipped.` and a `[dry-run] Would create <slug> as draft/manual` line per mission.

- [ ] **Step 2: Confirm the target deployment before applying**

Read the `Connecting to Convex deployment:` line. STOP unless it matches the `jellyhunt` deployment URL from Task 2. This is the last checkpoint before data is written.

- [ ] **Step 3: Apply**

```bash
cd ~/platepostjelly && pnpm migrate:legacy-jellyhunt --apply
```

Expected: 16 `[created] <slug>` lines.

- [ ] **Step 4: Verify every mission is a draft and nothing is public**

```bash
cd ~/platepostjelly && npx convex run jellyhunt/admin:listAdminMissions '{"serviceKey": "<service key>"}'
```

Expected: 16 missions, every one `status: "draft"` and `approvalMode: "manual"`. Slugs: `scarrs-pizza`, `limprimerie`, `trapizzino`, `the-good-company`, `conbud`, `economy-candy`, `russ-and-daughters-cafe`, `cafe-integral`, `the-pastry-box`, `librae-bakery`, `hester-street-fair`, `morgensterns`, `ssam-bar-bang-bar`, `dimes`, `beverlys`, `comedy-cellar`.

- [ ] **Step 5: Re-run the dry run to prove the importer is idempotent**

```bash
cd ~/platepostjelly && pnpm migrate:legacy-jellyhunt
```

Expected: `0 mission(s) missing; 16 existing slug(s) skipped.` and no field changes.

---

## Task 5: Verify and publish the pilot missions

Publish four. `updateMissionStatus` rejects activation unless `currentRevision >= 1` and the place is `reviewed`; the importer satisfies both, so activation is a status change only.

**Files:** none modified.

**Interfaces:**
- Consumes: missions from Task 4.
- Produces: four missions at `status: "active"`, visible on `/human-social`, v1 `GET /missions`, and v2 `GET /missions`. Twelve remain drafts.

- [ ] **Step 1: Choose and verify four missions by hand**

Suggested pilot: `scarrs-pizza`, `economy-candy`, `russ-and-daughters-cafe`, `morgensterns` — four well-known, long-established Lower East Side businesses, which keeps the "is it still open" check tractable.

For each, check against the live web:
- The business is currently open and operating at the stated address.
- The address matches the business.
- Latitude and longitude land on that building (paste `<lat>,<lng>` into a map).
- Hours are plausible; the imported array is Sunday-first, seven entries, `HH:MM-HH:MM`.
- `geofenceRadiusMeters` suits the block. Imported default is 75.
- `timeZone` is `America/New_York`.
- Title, description, category, difficulty, emoji, neighborhood, price, and `rewardAmount` read correctly.

Record what you checked and what you found for each mission. If a fact cannot be confirmed, do not publish that mission — substitute another.

One field cannot be verified at all: the **canonical Jelly place ID**. Jelly has not published the place contract, so `jellyRestaurantId` is absent from every record in the migration file and `cleanLocation` derives the place identity from `restaurantTag` instead. This means a published pilot mission has no authoritative way to prove a post really happened at that restaurant. It is why pilot missions stay on manual approval, and it is the single largest reason this deployment is a demonstration rather than a live program. Note it explicitly in the Task 7 Step 9 report.

- [ ] **Step 2: Fix anything wrong before publishing**

Use `jellyhunt/admin:updateMissionWithLocation` for corrections. Do not edit `migrations/legacy-jellyhunt-missions.json` — it is migration input, not live data, and the importer skips existing slugs so edits there would have no effect.

- [ ] **Step 3: Publish the four**

For each verified mission, using its `publicId` from Task 4 Step 4:

```bash
cd ~/platepostjelly && npx convex run jellyhunt/admin:updateMissionStatus '{
  "serviceKey": "<service key>",
  "actorId": "brandon@platepost.io",
  "missionId": "<mis_ id>",
  "status": "active"
}'
```

- [ ] **Step 4: Verify the split**

```bash
cd ~/platepostjelly && npx convex run jellyhunt/admin:listAdminMissions '{"serviceKey": "<service key>"}'
```

Expected: exactly 4 `active`, 12 `draft`.

---

## Task 6: Create the Vercel project and deploy

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: a preview URL serving `/human-social` and `/admin`.

- [ ] **Step 1: Check the Mapbox token before relying on it**

The token in `~/video-discovery/.env.local` is a public `pk.` token on Brandon's Mapbox account. Confirm in the Mapbox account dashboard whether it carries URL restrictions. If it does, either add the preview host to its allowlist or create a JellyHunt-specific public token. Note that reusing it bills JellyHunt preview traffic to the same Mapbox account as the live menus.

- [ ] **Step 2: Create the Vercel project**

```bash
cd ~/platepostjelly && npx vercel link
```

Create a **new** project (suggested name `jellyhunt`) under Brandon's team, linked to the `platepostjelly` repository. Do not link to the existing `video-discovery` project.

- [ ] **Step 3: Set the Vercel environment variables**

Set each for Preview and Production. Values must match Task 2 exactly where shared.

```bash
cd ~/platepostjelly
for env in preview production; do
  npx vercel env add NEXT_PUBLIC_CONVEX_URL "$env"
  npx vercel env add NEXT_PUBLIC_CONVEX_SITE_URL "$env"
  npx vercel env add CONVEX_URL "$env"
  npx vercel env add PLATEPOST_CONVEX_SERVICE_KEY "$env"
  npx vercel env add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN "$env"
  npx vercel env add JELLYHUNT_DATA_SOURCE "$env"
  npx vercel env add JELLYHUNT_ADMIN_USERNAME "$env"
  npx vercel env add JELLYHUNT_ADMIN_PASSWORD "$env"
  npx vercel env add JELLYHUNT_ADMIN_SESSION_SECRET "$env"
  npx vercel env add JELLYHUNT_CURSOR_SECRET "$env"
  npx vercel env add NEXT_PUBLIC_JELLY_IOS_APP_URL "$env"
  npx vercel env add NEXT_PUBLIC_JELLY_ANDROID_APP_URL "$env"
done
```

`JELLYHUNT_DATA_SOURCE` is `convex`. The app-store URLs are the values in `.env.example`.

- [ ] **Step 4: Confirm fixture mode is absent**

```bash
cd ~/platepostjelly && npx vercel env ls | grep -i JELLYHUNT_DATA_SOURCE
```

Then pull and confirm the value is `convex`, not `fixture`. Fixture mode is rejected when `NODE_ENV=production`, so leaving it set would break the deployment outright.

- [ ] **Step 5: Deploy a preview**

```bash
cd ~/platepostjelly && npx vercel deploy
```

Expected: a preview URL. Do not deploy to production.

---

## Task 7: Prove it works

Every check is observed directly and the observation recorded. A failure stops the milestone; it is not noted as a caveat.

**Files:** none modified.

- [ ] **Step 1: The map renders with real Mapbox**

Open `<preview-url>/human-social`. Expected: Mapbox raster tiles, not the coordinate-grid fallback seen without a token, and four mission pins.

- [ ] **Step 2: Admin authentication works and rejects bad input**

Open `<preview-url>/admin`. Expected: a wrong password is rejected; the configured credentials are accepted.

- [ ] **Step 3: The operator claim — an admin edit reaches every surface with no redeploy**

This is the central test of the build. Change a published mission's title in `/admin`, then check all three surfaces without deploying:

```bash
curl -s "<preview-url>/api/v1/jellyhunt/missions" | grep -o "<new title>"
curl -s "<preview-url>/api/v2/jellyhunt/missions" | grep -o "<new title>"
```

And reload `/human-social`. Expected: the new title on the map, on v1, and on v2. Restore the original title afterwards.

- [ ] **Step 4: Pausing removes a mission from discovery but keeps its history**

Pause one published mission in `/admin`. Expected: it disappears from `/human-social`, v1, and v2, while `listAdminMissions` still shows it with its revisions and audit history intact. Re-activate it afterwards.

- [ ] **Step 5: Writes are impossible without a Jelly token**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT "<preview-url>/api/v2/jellyhunt/missions/<mis_id>/participation"
curl -s -o /dev/null -w "%{http_code}\n" "<preview-url>/api/v2/jellyhunt/me"
```

Expected: 401 on both. `JELLY_MISSION_JWKS_URL` is unset, so no bearer token can be verified. Confirm no caller-supplied identity is accepted.

- [ ] **Step 6: No reward can be dispatched**

Verify against the deployed values rather than the config file:

```bash
cd ~/platepostjelly && npx convex env get JELLYHUNT_AUTOMATIC_REWARDS_ENABLED
```

Expected: `false`. `automaticRewardDispatchAllowed` in `convex/jellyhunt/rewards.ts` returns `false` at its first check when this is not exactly the string `"true"`.

- [ ] **Step 7: Leaderboards load instead of throwing**

Open both leaderboard tabs on `/human-social`. Expected: an empty-state, not `leaderboard_program_config_not_found`. This is the check that proves Task 1 was necessary and worked.

- [ ] **Step 8: Full regression gates**

```bash
cd ~/platepostjelly && pnpm test && pnpm test:contracts && pnpm test:convex && pnpm validate:openapi && pnpm lint && pnpm build && pnpm typecheck:convex
```

Expected: all pass.

- [ ] **Step 9: Report**

Give Brandon the preview URL, the four published missions, the twelve drafts, the observed result of each check above, and an explicit restatement of what a Jelly user still cannot do: no mission token, no post verification, no payout. Approval is manual and no reward can be sent.

---

## Out of scope

- Rotating the two credentials exposed in chat. Brandon's action in the Convex and Vercel dashboards. This plan avoids them by generating everything fresh, which is containment, not remediation.
- A custom `platepost.io` subdomain. There is no wildcard DNS; the subdomain must be registered before any host is pointed at it.
- Merging the JellyHunt schema into PlatePost's main Convex project.
- Gates 4–7 of `docs/NEXT_STEPS.md`: Jelly mission tokens, place and evidence APIs, reward transfer APIs, native app integration, legacy dedupe and payout migration.
- Any production deployment.
