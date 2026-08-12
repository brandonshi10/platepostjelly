# JellyHunt NYC Catalog, Dish Missions, and PlatePost Branding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JellyHunt's 16 one-mission-per-restaurant scavenger hunt with 40 verified NYC venues carrying three to five named dish missions each, shown as one map pin per venue, wearing PlatePost's brand.

**Architecture:** A restaurant becomes a *place* that several missions point at. Convex already models this — `jellyhuntMissions.placeId` is a foreign key — but no mutation can create a second mission at an existing place, so Task 1 adds one. Display grouping is derived from the `location.id` every mission already returns; nothing new is stored. Shot type rides fields the mission revision already has, plus one additive field on the public contract that is hidden from Jelly's v1 API.

**Tech Stack:** Next.js 15, React 19, TypeScript, Convex, Mapbox GL, Zod, Vitest, pnpm.

**Spec:** [2026-08-10-jellyhunt-nyc-catalog-branding-design.md](../specs/2026-08-10-jellyhunt-nyc-catalog-branding-design.md)

## Global Constraints

- Work in `~/platepostjelly` on branch `feat/jellyhunt-nyc-catalog` off `main`. Do not push to `main` without Brandon's approval.
- **No Convex schema change.** `convex/jellyhunt/schema.ts` is not edited by any task in this plan. A JellyHunt field that is not declared in a validator has taken the restaurant platform down twice.
- Convex functions in `convex/jellyhunt/` use `mutationGeneric`/`queryGeneric` from `convex/server`, **not** `./_generated/server`.
- Tests in `tests/convex/` reach functions through `anyApi.jellyhunt.*`, **never** the typed generated `api` object. Importing the typed `api` breaks `pnpm build`.
- Reward token code is the literal `"JELLY-MY-JELLY"`. It is a `z.literal` in `src/lib/jellyhunt/contracts.ts` and must not change.
- **Reward is 10 JELLY per mission.** A venue's cap is the sum of its missions, never a hardcoded 50.
- Mission lifecycle values are `draft` / `active` / `paused` / `archived`. **Every imported mission is created `draft` and `manual`.** No task in this plan publishes a mission except Task 11, and only after hand verification.
- `JELLYHUNT_AUTOMATIC_REWARDS_ENABLED=false`, `JELLYHUNT_PRODUCTION_REWARDS_APPROVED=false`, `JELLYHUNT_VERIFICATION_AUTORUN_ENABLED=false` stay set. No task enables rewards.
- Shot type vocabulary is exactly five values, lowercase: `dish`, `spread`, `action`, `display`, `ritual`.
- **Slugs must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`** — `cleanMission` (`convex/jellyhunt/admin.ts:170`) throws `invalid_mission_slug` otherwise. No accents, no apostrophes, no underscores, no trailing hyphen. Ssäm Bar becomes `ssam-bar`, Scarr's becomes `scarrs`, Morgenstern's becomes `morgensterns`.
- `cleanMission` spreads its input (`admin.ts:157`), so a new field added to `missionInput` reaches `requirements()` without further plumbing. Confirmed, not assumed.
- PlatePost brand values: blue `#4576ef`, navy `#071126`, typeface Manrope. Assets in `~/PlatePost Brand Assets/`.
- Local `.env.local` currently has `JELLYHUNT_DATA_SOURCE=fixture` (set during design review so the map had something to show). **Set it back to `convex` before Task 6** or the importer and the map will disagree about where data lives.
- Full gates, run before every commit that touches code: `pnpm test && pnpm test:contracts && pnpm test:convex && pnpm lint && pnpm build`. `pnpm typecheck:convex` additionally for Convex changes.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `convex/jellyhunt/admin.ts` | Admin mutations. Gains `createMissionAtPlace` so several missions can share one restaurant, and threads `shotType` into mission requirements. | Modify |
| `src/lib/jellyhunt/shot-types.ts` | The five shot types, their durations, and their filming instructions. Single source of truth, imported by contract, admin UI, and map. | Create |
| `src/lib/jellyhunt/contracts.ts` | Public mission contract. Gains optional `shotType`, registered as a v1-additive key so Jelly's legacy payload is unchanged. | Modify |
| `src/lib/jellyhunt/venues.ts` | Groups missions into venues by `location.id` and computes a venue's reward cap. Pure, no I/O. | Create |
| `migrations/nyc-catalog-2026-08.json` | The 40-venue catalog: venue records each holding 3–5 missions. Migration input, not live data. | Create |
| `scripts/import-nyc-catalog.mjs` | Dry-run-first, idempotent importer for the above. Creates one place per venue, then its missions. | Create |
| `scripts/archive-dropped-venues.mjs` | Archives the four venues that do not fit the dish model. | Create |
| `app/human-social/jellyhunt-explorer.tsx` | Map and detail panel. One pin per venue; panel lists that venue's missions. | Modify |
| `app/human-social/jellyhunt.css` | Visual styling. Rebrand to PlatePost palette and Manrope; add venue-sheet mission rows. | Modify |
| `app/admin/admin-dashboard.tsx` | Operator UI. Shot-type selector and venue grouping. | Modify |
| `tests/convex/jellyhunt-admin.test.ts` | Convex admin coverage. Gains `createMissionAtPlace`. | Modify |
| `tests/jellyhunt-shot-types.test.ts` | Shot-type vocabulary and duration rules. | Create |
| `tests/jellyhunt-venues.test.ts` | Venue grouping and cap arithmetic. | Create |
| `tests/jellyhunt-v1-compatibility.test.ts` | Proves `shotType` never reaches the v1 projection. | Modify |
| `tests/contracts/jellyhunt-v1/missions.200.json` | Versioned v1 fixture. Gains `shotType` in the body and not in `legacyProjection`. | Modify |

---

## Task 1: Let several missions share one restaurant

`createMissionWithLocation` calls `ensureUniqueJellyPlace(ctx, location.jellyPlaceId)` (`convex/jellyhunt/admin.ts:642`), and `cleanLocation` derives `jellyPlaceId` from `restaurantTag` (`admin.ts:201`). Creating a second mission at Supermoon Bakehouse therefore throws `place_already_linked_to_jelly_place_id`. **Nothing else in this plan works until this task lands.**

The uniqueness rule is correct and stays — one place per restaurant is exactly what venue grouping wants. What's missing is a way to attach a mission to a place that already exists.

**Files:**
- Modify: `convex/jellyhunt/admin.ts` (append after `createMissionWithLocation`, which ends at line 733)
- Test: `tests/convex/jellyhunt-admin.test.ts`

**Interfaces:**
- Consumes: `requireServiceKey` from `./security`, `createPublicId` from `./publicIds`, `recordAuditEvent` from `./audit` — all already imported at the top of `admin.ts`. Also the file-local `cleanMission`, `currentCampaign`, `ensureUniqueSlug`, `rewardTerms`, `requirements`, `placeSnapshot`, `legacyDisplay`, `applyMissionBudgets`, `bumpCatalog`, `missionInput`, `budgetInput`.
- Produces: `createMissionAtPlace({ serviceKey, actorId, locationId, mission, budgets })` returning `{ missionId: string, locationId: string }` — the same return shape as `createMissionWithLocation`. `locationId` is a place **public** id (`plc_…`). Task 6's importer calls it.

- [ ] **Step 1: Write the failing test**

Append to `tests/convex/jellyhunt-admin.test.ts`. Match the imports and helpers already in that file — `admin` from `anyApi.jellyhunt.admin`, `createJellyhuntTestConvex` and `TEST_SERVICE_KEY` from `./helpers/setup`. If the file seeds a current campaign in a `beforeEach`, reuse it; `createMissionAtPlace` calls `currentCampaign(ctx)` and throws without one.

The `vi.stubEnv` is required, not decoration: `requireServiceKey` compares against `process.env.PLATEPOST_CONVEX_SERVICE_KEY`, and without the stub every call throws `unauthorized`, so the negative case would pass for the wrong reason.

```typescript
describe("createMissionAtPlace", () => {
  beforeEach(() => {
    vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("attaches a second mission to an existing place and rejects a bad service key", async () => {
    const t = createJellyhuntTestConvex();
    await seedCurrentCampaign(t);

    const first = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: missionFixture({ slug: "supermoon-ube-eclair", sortOrder: 0 }),
      location: {
        name: "Supermoon Bakehouse",
        address: "120 Rivington St",
        latitude: 40.7188,
        longitude: -73.9877,
        geofenceRadiusMeters: 75,
        timeZone: "America/New_York",
      },
    });
    expect(first.locationId).toMatch(/^plc_/);

    await expect(
      t.mutation(admin.createMissionAtPlace, {
        serviceKey: "wrong-key",
        actorId: "operator",
        locationId: first.locationId,
        mission: missionFixture({ slug: "supermoon-corn-cookie", sortOrder: 1 }),
      }),
    ).rejects.toThrow(/unauthorized/);

    const second = await t.mutation(admin.createMissionAtPlace, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      locationId: first.locationId,
      mission: missionFixture({ slug: "supermoon-corn-cookie", sortOrder: 1 }),
    });

    expect(second.locationId).toBe(first.locationId);
    expect(second.missionId).not.toBe(first.missionId);

    const places = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntPlaces").collect(),
    );
    expect(places).toHaveLength(1);

    const missions = await t.run(async (ctx: any) =>
      ctx.db.query("jellyhuntMissions").collect(),
    );
    expect(missions).toHaveLength(2);
    expect(missions[0].placeId).toStrictEqual(missions[1].placeId);
    expect(missions.every((m: any) => m.currentRevision === 1)).toBe(true);
    expect(missions.every((m: any) => m.status === "draft")).toBe(true);
  });

  it("rejects an unknown place and a duplicate slug", async () => {
    const t = createJellyhuntTestConvex();
    await seedCurrentCampaign(t);

    await expect(
      t.mutation(admin.createMissionAtPlace, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "operator",
        locationId: "plc_does_not_exist",
        mission: missionFixture({ slug: "orphan", sortOrder: 0 }),
      }),
    ).rejects.toThrow(/place_not_found/);

    const first = await t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: missionFixture({ slug: "dupe", sortOrder: 0 }),
      location: {
        name: "Le Fournil",
        address: "115 2nd Ave",
        latitude: 40.7285,
        longitude: -73.9873,
        geofenceRadiusMeters: 75,
        timeZone: "America/New_York",
      },
    });

    await expect(
      t.mutation(admin.createMissionAtPlace, {
        serviceKey: TEST_SERVICE_KEY,
        actorId: "operator",
        locationId: first.locationId,
        mission: missionFixture({ slug: "dupe", sortOrder: 1 }),
      }),
    ).rejects.toThrow(/slug/);
  });
});
```

Add these two helpers to the same file if it does not already have equivalents. `missionFixture` supplies every required field of `missionInput` (`admin.ts:39-59`); `hours` must be exactly seven entries or `toStructuredHours` will not build a valid place.

```typescript
function missionFixture(overrides: Record<string, unknown> = {}) {
  return {
    slug: "fixture-mission",
    title: "Fixture Mission",
    description: "Film the thing.",
    status: "draft",
    approvalMode: "manual",
    restaurantTag: "supermoon-bakehouse",
    rewardAmount: 10,
    category: "Bakery",
    difficulty: "easy",
    emoji: "🥐",
    neighborhood: "Lower East Side",
    price: "$$",
    hours: [
      "08:00-18:00", "08:00-18:00", "08:00-18:00", "08:00-18:00",
      "08:00-19:00", "08:00-19:00", "08:00-18:00",
    ],
    sortOrder: 0,
    ...overrides,
  };
}

async function seedCurrentCampaign(t: any) {
  const now = Date.now();
  await t.run(async (ctx: any) => {
    await ctx.db.insert("jellyhuntCampaigns", {
      publicId: "cam_test",
      slug: "test-campaign",
      title: "Test Campaign",
      shortTitle: "Test",
      status: "active",
      isCurrent: true,
      startsAt: now - 1000,
      endsAt: now + 100_000_000,
      timeZone: "America/New_York",
      rewardTokenCode: "JELLY-MY-JELLY",
      rewardTokenDisplayName: "Jelly My Jelly",
      catalogRevision: 0,
      leaderboardRevision: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}
```

If `tests/convex/jellyhunt-admin.test.ts` already defines a campaign seeder or mission fixture, use the existing one rather than adding a second — read the file before appending.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/platepostjelly && pnpm test:convex -- -t "createMissionAtPlace"
```

Expected: FAIL. `convex-test` cannot resolve `admin.createMissionAtPlace` because the mutation does not exist.

- [ ] **Step 3: Write the minimal implementation**

Append to `convex/jellyhunt/admin.ts`, immediately after `createMissionWithLocation`:

```typescript
/**
 * Admin/service-only: create a mission at a place that already exists.
 *
 * `createMissionWithLocation` creates a place per mission and enforces one
 * place per `jellyPlaceId`, so it cannot express "five dishes at one
 * restaurant". That uniqueness rule is correct and stays; this mutation is
 * the missing second half — it attaches an additional mission to a place
 * that has already been created and reviewed.
 *
 * The place is reused as-is. Its coordinates, hours, geofence, and review
 * status are never rewritten here, because a later mission must not be able
 * to silently move a venue that earlier missions were verified against.
 */
export const createMissionAtPlace = mutationGeneric({
  args: {
    serviceKey: v.string(),
    actorId: v.string(),
    locationId: v.string(),
    mission: missionInput,
    budgets: budgetInput,
  },
  handler: async (ctx: any, args: any) => {
    requireServiceKey(args.serviceKey);
    const actorId = required(args.actorId, "invalid_actor_id");
    const campaign = await currentCampaign(ctx);
    const mission = cleanMission(args.mission);

    const place = await ctx.db
      .query("jellyhuntPlaces")
      .withIndex("by_public_id", (q: any) => q.eq("publicId", args.locationId))
      .unique();
    if (!place) throw new Error("place_not_found");

    await ensureUniqueSlug(ctx, mission.slug);

    const now = Date.now();
    const missionPublicId = createPublicId("mis");
    const reward = rewardTerms(mission.rewardAmount);
    const missionId = await ctx.db.insert("jellyhuntMissions", {
      publicId: missionPublicId,
      campaignId: campaign._id,
      legacySlug: mission.slug,
      slug: mission.slug,
      status: mission.status,
      approvalMode: mission.approvalMode,
      currentRevision: 1,
      title: mission.title,
      category: mission.category,
      difficulty: mission.difficulty,
      emoji: mission.emoji,
      neighborhood: mission.neighborhood,
      price: mission.price,
      sortOrder: mission.sortOrder,
      placeId: place._id,
      reward,
      acceptingSubmissions: mission.status === "active",
      startsAt: mission.startsAt,
      endsAt: mission.endsAt,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });

    const appliedBudgets = await applyMissionBudgets(
      ctx,
      campaign,
      { _id: missionId, publicId: missionPublicId },
      args.budgets,
      reward.amount,
      mission.status === "active",
      now,
    );
    await ctx.db.patch(missionId, {
      budgetAllocation: appliedBudgets.mission.allocatedAmount,
    });

    await ctx.db.insert("jellyhuntMissionRevisions", {
      publicId: createPublicId("mrv"),
      missionId,
      revision: 1,
      title: mission.title,
      description: mission.description,
      instructions: [mission.description],
      requirements: requirements(mission),
      approvalMode: mission.approvalMode,
      reward,
      place: {
        placeId: place._id,
        jellyPlaceId: place.jellyPlaceId,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        geofenceRadiusMeters: place.geofenceRadiusMeters,
        timeZone: place.timeZone,
      },
      missionWindow: { startsAt: mission.startsAt, endsAt: mission.endsAt },
      legacyDisplay: legacyDisplay(mission),
      createdBy: actorId,
      createdAt: now,
    });

    await bumpCatalog(ctx, campaign, now);
    await recordAuditEvent(ctx, {
      actor: actorId,
      action: "mission.created",
      entityType: "mission",
      entityId: missionId,
      nextState: {
        publicId: missionPublicId,
        status: mission.status,
        revision: 1,
        placeId: place.publicId,
      },
    });
    return { missionId: missionPublicId, locationId: place.publicId };
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/platepostjelly && pnpm test:convex -- -t "createMissionAtPlace"
```

Expected: PASS, both cases.

- [ ] **Step 5: Run the full gates**

```bash
cd ~/platepostjelly && pnpm test && pnpm test:convex && pnpm lint && pnpm build && pnpm typecheck:convex
```

Expected: all pass. `mis` and `mrv` are already in the `PREFIXES` list in `convex/jellyhunt/publicIds.ts`.

- [ ] **Step 6: Commit**

```bash
cd ~/platepostjelly
git add convex/jellyhunt/admin.ts tests/convex/jellyhunt-admin.test.ts
git commit -m "feat: allow several missions to share one place

createMissionWithLocation enforces one place per jellyPlaceId, so a second
mission at the same restaurant threw place_already_linked_to_jelly_place_id.
The rule is correct — one place per restaurant is what venue grouping wants —
so this adds the missing half rather than relaxing it."
```

---

## Task 2: Shot types

Five types, each with its own filming instruction and duration window. The vocabulary lives in one module so the map, the admin UI, and the Convex requirements builder cannot drift apart.

**Files:**
- Create: `src/lib/jellyhunt/shot-types.ts`
- Create: `tests/jellyhunt-shot-types.test.ts`
- Modify: `src/lib/jellyhunt/contracts.ts`
- Modify: `convex/jellyhunt/admin.ts` (`missionInput` at line 39, `requirements` at line 270, `AdminMissionInput` at line 86)
- Modify: `tests/jellyhunt-v1-compatibility.test.ts`
- Modify: `tests/contracts/jellyhunt-v1/missions.200.json`

**Interfaces:**
- Produces: `SHOT_TYPES` (readonly tuple of the five ids), `type ShotType`, `SHOT_TYPE_SPECS: Record<ShotType, ShotTypeSpec>` where `ShotTypeSpec = { id: ShotType; label: string; instruction: string; minDurationSeconds: number; maxDurationSeconds: number }`, and `shotTypeSpec(id: string): ShotTypeSpec | undefined`. Tasks 4, 6, 8, and 10 import these.
- Produces: optional `shotType` on `missionSchema`, stripped from the v1 projection.

- [ ] **Step 1: Write the failing test**

Create `tests/jellyhunt-shot-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  SHOT_TYPES,
  SHOT_TYPE_SPECS,
  shotTypeSpec,
} from "../src/lib/jellyhunt/shot-types";

describe("shot types", () => {
  it("defines exactly the five approved types", () => {
    expect([...SHOT_TYPES]).toEqual(["dish", "spread", "action", "display", "ritual"]);
  });

  it("gives every type a usable instruction and a sane duration window", () => {
    for (const id of SHOT_TYPES) {
      const spec = SHOT_TYPE_SPECS[id];
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.instruction.length).toBeGreaterThan(10);
      expect(spec.minDurationSeconds).toBeGreaterThan(0);
      expect(spec.maxDurationSeconds).toBeGreaterThan(spec.minDurationSeconds);
      expect(spec.maxDurationSeconds).toBeLessThanOrEqual(20);
    }
  });

  it("looks a type up by id and returns undefined for anything else", () => {
    expect(shotTypeSpec("ritual")?.label).toBe("Ritual");
    expect(shotTypeSpec("DISH")).toBeUndefined();
    expect(shotTypeSpec("cinematic")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/platepostjelly && pnpm test tests/jellyhunt-shot-types.test.ts
```

Expected: FAIL — cannot resolve `../src/lib/jellyhunt/shot-types`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/jellyhunt/shot-types.ts`:

```typescript
/**
 * The five kinds of thing a JellyHunt mission asks someone to film.
 *
 * The type drives three things that must agree: what the filmer is told, how
 * long the clip has to be, and what a reviewer checks. Keeping them in one
 * record is why a pastry case and a boba-cooking station stop getting
 * identical instructions.
 */
export const SHOT_TYPES = ["dish", "spread", "action", "display", "ritual"] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export type ShotTypeSpec = {
  id: ShotType;
  label: string;
  instruction: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
};

export const SHOT_TYPE_SPECS: Record<ShotType, ShotTypeSpec> = {
  dish: {
    id: "dish",
    label: "Dish",
    instruction: "One plated item. Hold the phone steady and make a single close pass over it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  spread: {
    id: "spread",
    label: "Spread",
    instruction: "The whole table. Show the scale first, then pan slowly across everything on it.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  action: {
    id: "action",
    label: "Action",
    instruction: "Something being made. Start filming before it starts and don't cut away early.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  display: {
    id: "display",
    label: "Display",
    instruction: "The case or counter. One slow pass, keeping the whole display in frame.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  ritual: {
    id: "ritual",
    label: "Ritual",
    instruction: "The moment people come here for. One take, and film the person doing it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
};

export function shotTypeSpec(id: string): ShotTypeSpec | undefined {
  return (SHOT_TYPE_SPECS as Record<string, ShotTypeSpec>)[id];
}

export function isShotType(value: unknown): value is ShotType {
  return typeof value === "string" && (SHOT_TYPES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/platepostjelly && pnpm test tests/jellyhunt-shot-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add `shotType` to the public contract**

In `src/lib/jellyhunt/contracts.ts`, add the import at the top:

```typescript
import { SHOT_TYPES } from "./shot-types";
```

Add the field to `missionSchema` (currently lines 33-56), immediately after the `emoji` line:

```typescript
  shotType: z.enum(SHOT_TYPES).optional(),
```

And register it as v1-additive, replacing line 95:

```typescript
const V1_ADDITIVE_KEYS = new Set(["publicId", "revision", "requestId", "shotType"]);
```

- [ ] **Step 6: Prove the v1 projection hides it**

Add to `tests/jellyhunt-v1-compatibility.test.ts`:

```typescript
it("never leaks shotType into the legacy v1 projection", () => {
  const projected = projectLegacyV1({
    apiVersion: "1.0",
    missions: [{ id: "mis_1", title: "Ube Eclair", shotType: "dish" }],
  }) as { missions: Array<Record<string, unknown>> };

  expect(projected.missions[0]).not.toHaveProperty("shotType");
  expect(projected.missions[0].title).toBe("Ube Eclair");
});
```

**Then prove the test can fail.** Temporarily remove `"shotType"` from `V1_ADDITIVE_KEYS`, re-run, and confirm the new test goes red. Put it back. A verifier that has never failed on known-bad input is not evidence of anything.

```bash
cd ~/platepostjelly && pnpm test:contracts
```

Expected: PASS with `"shotType"` present; the new test FAILS with it removed.

- [ ] **Step 7: Thread shot type through the Convex admin mutation**

In `convex/jellyhunt/admin.ts`, add to `missionInput` (line 39-59), after the `emoji` line:

```typescript
  shotType: v.optional(v.string()),
```

Add the same field to the `AdminMissionInput` type (line 86):

```typescript
  shotType?: string;
```

Replace the `requirements` function (line 270) so the shot type sets the prompt and the duration window. Keep the existing behavior when no shot type is given, so the 16 legacy missions are unaffected:

```typescript
const SHOT_TYPE_RULES: Record<
  string,
  { instruction: string; minDurationSeconds: number; maxDurationSeconds: number }
> = {
  dish: {
    instruction: "One plated item. Hold the phone steady and make a single close pass over it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  spread: {
    instruction: "The whole table. Show the scale first, then pan slowly across everything on it.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  action: {
    instruction: "Something being made. Start filming before it starts and don't cut away early.",
    minDurationSeconds: 10,
    maxDurationSeconds: 20,
  },
  display: {
    instruction: "The case or counter. One slow pass, keeping the whole display in frame.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
  ritual: {
    instruction: "The moment people come here for. One take, and film the person doing it.",
    minDurationSeconds: 8,
    maxDurationSeconds: 15,
  },
};

function requirements(mission: AdminMissionInput) {
  const rule = mission.shotType ? SHOT_TYPE_RULES[mission.shotType] : undefined;
  if (mission.shotType && !rule) throw new Error("invalid_shot_type");

  return {
    post: {
      allowedPostTypes: ["video"],
      authorshipPolicy: "canonical_owner",
      prompt: rule ? rule.instruction : mission.restaurantTag,
      ...(rule
        ? {
            minDurationSeconds: rule.minDurationSeconds,
            maxDurationSeconds: rule.maxDurationSeconds,
          }
        : {}),
      requiredVisibility: "public",
    },
    place: { attachmentRequired: true },
    location: { required: true, trustedSource: "jelly_post" },
    schedule: { mustBeWithinMissionWindow: true, mustBeDuringVenueHours: false },
    resubmission: { allowedAfterRejection: true, maxAttempts: 3 },
  };
}
```

`SHOT_TYPE_RULES` duplicates the instruction text in `shot-types.ts` deliberately: `convex/` cannot import from `src/`, and inventing a shared build step for five strings costs more than it saves. Task 10 adds a test that the two agree.

- [ ] **Step 8: Test the Convex side**

Add to `tests/convex/jellyhunt-admin.test.ts`:

```typescript
it("writes shot-type instructions and durations onto the mission revision", async () => {
  const t = createJellyhuntTestConvex();
  vi.stubEnv("PLATEPOST_CONVEX_SERVICE_KEY", TEST_SERVICE_KEY);
  await seedCurrentCampaign(t);

  await t.mutation(admin.createMissionWithLocation, {
    serviceKey: TEST_SERVICE_KEY,
    actorId: "operator",
    mission: missionFixture({ slug: "xing-fu-boba-station", shotType: "action" }),
    location: {
      name: "Xing Fu Tang",
      address: "133 2nd Ave",
      latitude: 40.7295,
      longitude: -73.9877,
      geofenceRadiusMeters: 75,
      timeZone: "America/New_York",
    },
  });

  const [revision] = await t.run(async (ctx: any) =>
    ctx.db.query("jellyhuntMissionRevisions").collect(),
  );
  expect(revision.requirements.post.minDurationSeconds).toBe(10);
  expect(revision.requirements.post.maxDurationSeconds).toBe(20);
  expect(revision.requirements.post.prompt).toMatch(/Start filming before it starts/);

  await expect(
    t.mutation(admin.createMissionWithLocation, {
      serviceKey: TEST_SERVICE_KEY,
      actorId: "operator",
      mission: missionFixture({ slug: "bad-shot-type", shotType: "cinematic" }),
      location: {
        name: "Nowhere",
        address: "1 Nowhere St",
        latitude: 40.7,
        longitude: -74,
        geofenceRadiusMeters: 75,
        timeZone: "America/New_York",
      },
    }),
  ).rejects.toThrow(/invalid_shot_type/);

  vi.unstubAllEnvs();
});
```

- [ ] **Step 9: Run the gates**

```bash
cd ~/platepostjelly && pnpm test && pnpm test:contracts && pnpm test:convex && pnpm lint && pnpm build && pnpm typecheck:convex
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
cd ~/platepostjelly
git add src/lib/jellyhunt/shot-types.ts src/lib/jellyhunt/contracts.ts \
  convex/jellyhunt/admin.ts tests/jellyhunt-shot-types.test.ts \
  tests/jellyhunt-v1-compatibility.test.ts tests/convex/jellyhunt-admin.test.ts
git commit -m "feat: five shot types drive filming instructions and duration

A pastry case and a boba-cooking station no longer get identical guidance.
shotType is additive on the public contract and stripped from the v1
projection, so Jelly's legacy payload is byte-identical."
```

---

## Task 3: Group missions into venues

A pure function. No I/O, no React, no Convex — so it can be tested exhaustively and reused by the map, the admin list, and anything later.

**Files:**
- Create: `src/lib/jellyhunt/venues.ts`
- Create: `tests/jellyhunt-venues.test.ts`

**Interfaces:**
- Consumes: `JellyhuntMission` from `./contracts`.
- Produces: `type Venue = { id: string; name: string; address?: string; latitude: number; longitude: number; timeZone: string; neighborhood: string; category: string; emoji: string; missions: JellyhuntMission[]; rewardTotal: number }` and `groupMissionsIntoVenues(missions: JellyhuntMission[]): Venue[]`. Tasks 8 and 10 import both.

- [ ] **Step 1: Write the failing test**

Create `tests/jellyhunt-venues.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { groupMissionsIntoVenues } from "../src/lib/jellyhunt/venues";
import type { JellyhuntMission } from "../src/lib/jellyhunt/contracts";

function mission(overrides: Partial<JellyhuntMission> = {}): JellyhuntMission {
  return {
    id: "mis_1",
    slug: "supermoon-ube-eclair",
    title: "Ube Eclair",
    description: "Film the eclair.",
    status: "active",
    approvalMode: "manual",
    rewardAmount: 10,
    rewardToken: "JELLY-MY-JELLY",
    restaurantTag: "supermoon-bakehouse",
    category: "Bakery",
    difficulty: "easy",
    emoji: "🥐",
    neighborhood: "Lower East Side",
    price: "$$",
    hours: [
      "08:00-18:00", "08:00-18:00", "08:00-18:00", "08:00-18:00",
      "08:00-19:00", "08:00-19:00", "08:00-18:00",
    ],
    sortOrder: 0,
    location: {
      id: "plc_supermoon",
      name: "Supermoon Bakehouse",
      address: "120 Rivington St",
      latitude: 40.7188,
      longitude: -73.9877,
      geofenceRadiusMeters: 75,
      timeZone: "America/New_York",
    },
    ...overrides,
  } as JellyhuntMission;
}

describe("groupMissionsIntoVenues", () => {
  it("collapses missions that share a place into one venue", () => {
    const venues = groupMissionsIntoVenues([
      mission({ id: "mis_1", sortOrder: 0 }),
      mission({ id: "mis_2", slug: "supermoon-corn-cookie", title: "Corn Cookie", sortOrder: 1 }),
      mission({ id: "mis_3", slug: "supermoon-case", title: "Pastry Case Reveal", sortOrder: 2 }),
    ]);

    expect(venues).toHaveLength(1);
    expect(venues[0].id).toBe("plc_supermoon");
    expect(venues[0].name).toBe("Supermoon Bakehouse");
    expect(venues[0].missions.map((m) => m.title)).toEqual([
      "Ube Eclair",
      "Corn Cookie",
      "Pastry Case Reveal",
    ]);
  });

  it("caps a venue at the sum of its missions, not a flat fifty", () => {
    const three = groupMissionsIntoVenues([
      mission({ id: "mis_1", sortOrder: 0 }),
      mission({ id: "mis_2", slug: "b", sortOrder: 1 }),
      mission({ id: "mis_3", slug: "c", sortOrder: 2 }),
    ]);
    expect(three[0].rewardTotal).toBe(30);

    const five = groupMissionsIntoVenues([0, 1, 2, 3, 4].map((i) =>
      mission({ id: `mis_${i}`, slug: `s${i}`, sortOrder: i }),
    ));
    expect(five[0].rewardTotal).toBe(50);
  });

  it("keeps separate places separate and orders venues by their first mission", () => {
    const venues = groupMissionsIntoVenues([
      mission({
        id: "mis_9",
        slug: "fournil-canele",
        sortOrder: 9,
        location: { ...mission().location, id: "plc_fournil", name: "Le Fournil" },
      }),
      mission({ id: "mis_1", sortOrder: 1 }),
    ]);

    expect(venues.map((v) => v.name)).toEqual(["Supermoon Bakehouse", "Le Fournil"]);
  });

  it("takes the pin emoji from the lowest-sortOrder mission", () => {
    const venues = groupMissionsIntoVenues([
      mission({ id: "mis_2", slug: "b", sortOrder: 5, emoji: "🍪" }),
      mission({ id: "mis_1", slug: "a", sortOrder: 1, emoji: "🥐" }),
    ]);
    expect(venues[0].emoji).toBe("🥐");
  });

  it("returns nothing for no missions", () => {
    expect(groupMissionsIntoVenues([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/platepostjelly && pnpm test tests/jellyhunt-venues.test.ts
```

Expected: FAIL — cannot resolve `../src/lib/jellyhunt/venues`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/jellyhunt/venues.ts`:

```typescript
import type { JellyhuntMission } from "./contracts";

/**
 * A restaurant and the missions filmed there.
 *
 * Derived, never stored. Missions already carry the place they belong to, so
 * grouping by `location.id` needs no new database field — which matters,
 * because an undeclared JellyHunt field has taken the restaurant platform
 * down twice.
 */
export type Venue = {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  neighborhood: string;
  category: string;
  emoji: string;
  missions: JellyhuntMission[];
  rewardTotal: number;
};

export function groupMissionsIntoVenues(missions: JellyhuntMission[]): Venue[] {
  const byPlace = new Map<string, JellyhuntMission[]>();

  for (const mission of missions) {
    const existing = byPlace.get(mission.location.id);
    if (existing) existing.push(mission);
    else byPlace.set(mission.location.id, [mission]);
  }

  const venues: Venue[] = [];
  for (const [id, group] of byPlace) {
    const ordered = [...group].sort((a, b) => a.sortOrder - b.sortOrder);
    const lead = ordered[0];
    venues.push({
      id,
      name: lead.location.name,
      address: lead.location.address,
      latitude: lead.location.latitude,
      longitude: lead.location.longitude,
      timeZone: lead.location.timeZone,
      neighborhood: lead.neighborhood,
      category: lead.category,
      emoji: lead.emoji,
      missions: ordered,
      // The cap follows the missions. A three-mission venue is worth 30, not 50.
      rewardTotal: ordered.reduce((sum, mission) => sum + mission.rewardAmount, 0),
    });
  }

  return venues.sort((a, b) => a.missions[0].sortOrder - b.missions[0].sortOrder);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/platepostjelly && pnpm test tests/jellyhunt-venues.test.ts
```

Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
cd ~/platepostjelly
git add src/lib/jellyhunt/venues.ts tests/jellyhunt-venues.test.ts
git commit -m "feat: group missions into venues by place

Derived from the location id every mission already carries, so no schema
change. A venue's cap is the sum of its missions rather than a flat 50."
```

---

## Task 4: Author the catalog — 29 spreadsheet venues

Data authoring, not code. The output is a reviewed JSON file; the importer in Task 6 consumes it.

**Source:** `/Users/brandonshi/Downloads/PlatePost_Jelly_Missions_Map_VERIFIED (2).xlsx`, sheet `Restaurant Map`, the 29 rows where `City = NYC`.

**Files:**
- Create: `migrations/nyc-catalog-2026-08.json`

**Interfaces:**
- Produces: a JSON array of venue records in exactly this shape. Task 6's importer validates against it.

```json
[
  {
    "venue": {
      "slug": "supermoon-bakehouse",
      "name": "Supermoon Bakehouse",
      "address": "120 Rivington St, New York, NY 10002",
      "latitude": 40.7188,
      "longitude": -73.9877,
      "geofenceRadiusMeters": 75,
      "timeZone": "America/New_York",
      "neighborhood": "Lower East Side",
      "category": "Asian-inspired pastry",
      "price": "$$",
      "hours": [
        "08:00-18:00", "08:00-18:00", "08:00-18:00", "08:00-18:00",
        "08:00-19:00", "08:00-19:00", "08:00-18:00"
      ],
      "websiteUrl": "https://supermoonbakehouse.com",
      "sortOrder": 0
    },
    "missions": [
      {
        "slug": "supermoon-bakehouse-ube-eclair",
        "title": "Ube Eclair",
        "shotType": "dish",
        "description": "Film the ube eclair. One plated item, one close pass, hold steady.",
        "difficulty": "easy",
        "emoji": "🥐"
      }
    ]
  }
]
```

- [ ] **Step 1: Extract the 29 NYC rows**

```bash
cd ~/platepostjelly && python3 - <<'PY'
import openpyxl, json
p='/Users/brandonshi/Downloads/PlatePost_Jelly_Missions_Map_VERIFIED (2).xlsx'
wb=openpyxl.load_workbook(p, data_only=True)
rows=list(wb['Restaurant Map'].iter_rows(values_only=True)); hdr=rows[0]
nyc=[dict(zip(hdr,r)) for r in rows[1:] if r[0] and str(r[0]).strip()=='NYC']
print(json.dumps(nyc, indent=2, default=str))
PY
```

Expected: 29 records. Confirm the count before continuing; if the sheet has been edited since 2026-08-10, reconcile with Brandon rather than silently importing a different number.

- [ ] **Step 2: Geocode every address**

Use the Mapbox Geocoding API with the public token already in `.env.local` as `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`. One request per address:

```bash
cd ~/platepostjelly && python3 - <<'PY'
import json, os, urllib.parse, urllib.request
token=[l.split('=',1)[1].strip() for l in open('.env.local') if l.startswith('NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=')][0]
def geocode(addr):
    q=urllib.parse.quote(addr)
    url=f"https://api.mapbox.com/geocoding/v5/mapbox.places/{q}.json?access_token={token}&limit=1&country=us&proximity=-73.99,40.72"
    d=json.load(urllib.request.urlopen(url))
    if not d['features']: return None
    lon,lat=d['features'][0]['center']
    return round(lat,6), round(lon,6), d['features'][0]['place_name']
print(geocode("120 Rivington St, New York, NY 10002"))
PY
```

**Every coordinate must land in Manhattan.** Reject anything outside latitude 40.68–40.88 or longitude −74.03 to −73.90 and geocode that address by hand. A mis-geocoded pin is the single likeliest defect in this task.

- [ ] **Step 3: Research seven days of hours per venue**

`operatingHoursSchema` requires exactly seven entries, Sunday first, each `"HH:MM-HH:MM"` or the literal `"closed"`. The spreadsheet has none. Source them from the venue's own site or its Toast/Google listing.

Do not guess and do not copy a neighbour's hours. If a venue's hours cannot be confirmed, record it and leave that venue out of the Task 11 launch cohort — it can still import as a draft.

- [ ] **Step 4: Write the mission records**

For each venue, take its `Mission 1`–`Mission 5` from the sheet and, for each:

- **Assign a shot type** from `dish`, `spread`, `action`, `display`, `ritual`. The sheet's wording usually decides it: "Live Boba-Cooking Station Shot" is `action`, "Pastry Case Reveal" is `display`, "Soup Dumpling Slurp Close-Up" is `ritual`, "Banchan Spread" is `spread`, a named plate is `dish`.
- **Cut the filler.** Drop missions that ask for nothing filmable — confirmed cases are "Counter-Order Shot" (Chelsea Açaí), "Cash-Only Counter Shot" (King Dumplings), "Domino-Game Hangout Shot" (Titi's). Review all 145 and cut on the same standard. **Every venue keeps at least three.**
- **Write a description** naming the item and what to capture, in the voice of the shot type's instruction.
- **Slug** is `<venue-slug>-<dish-slug>`, lowercase, hyphenated, ASCII. Slugs are globally unique — `ensureUniqueSlug` rejects a collision, so prefixing with the venue is required, not cosmetic.
- **`sortOrder`** is globally unique across the whole catalog and ascending: venue 0 takes 0–4, venue 1 takes 10–14, and so on in tens. Task 3 orders venues by their first mission's `sortOrder`, so the spacing is what keeps venue ordering stable when a mission is later added or cut.
- **Difficulty** reflects how hard the shot is to capture, not the food. A dish you order is `easy`; something requiring timing, like a whisking ritual or a late-night line, is `medium` or `hard`.

- [ ] **Step 5: Validate the file before committing**

```bash
cd ~/platepostjelly && python3 - <<'PY'
import json, re, collections
cat=json.load(open('migrations/nyc-catalog-2026-08.json'))
SHOTS={'dish','spread','action','display','ritual'}
slugs=collections.Counter(); orders=collections.Counter(); problems=[]
assert len(cat)==29, f"expected 29 venues, got {len(cat)}"
for rec in cat:
    v=rec['venue']; ms=rec['missions']
    if not (3<=len(ms)<=5): problems.append(f"{v['slug']}: {len(ms)} missions")
    if len(v['hours'])!=7: problems.append(f"{v['slug']}: {len(v['hours'])} hour entries")
    for h in v['hours']:
        if h!='closed' and not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d',h):
            problems.append(f"{v['slug']}: bad hours {h!r}")
    if not (40.68<=v['latitude']<=40.88 and -74.03<=v['longitude']<=-73.90):
        problems.append(f"{v['slug']}: coords outside Manhattan")
    slugs[v['slug']]+=1
    for m in ms:
        slugs[m['slug']]+=1; orders[m['sortOrder']]+=1
        if m['shotType'] not in SHOTS: problems.append(f"{m['slug']}: bad shotType {m['shotType']!r}")
        if not m.get('description','').strip(): problems.append(f"{m['slug']}: empty description")
problems += [f"duplicate slug {s}" for s,c in slugs.items() if c>1]
problems += [f"duplicate sortOrder {o}" for o,c in orders.items() if c>1]
print("\n".join(problems) if problems else f"OK: {len(cat)} venues, {sum(len(r['missions']) for r in cat)} missions")
PY
```

Expected: `OK: 29 venues, N missions` with N between 87 and 145.

- [ ] **Step 6: Commit**

```bash
cd ~/platepostjelly
git add migrations/nyc-catalog-2026-08.json
git commit -m "data: 29 verified NYC venues with dish missions

Sourced from PlatePost_Jelly_Missions_Map_VERIFIED. Coordinates geocoded
and bounds-checked; hours researched per venue because the sheet has none.
Filler missions cut; every venue keeps at least three."
```

---

## Task 5: Author the catalog — 11 carried-over venues

The eleven venues kept from the current 16 have no dish missions. This task writes them.

**Venues:** L'imprimerie, Trapizzino, Economy Candy, Russ & Daughters Cafe, Café Integral, The Pastry Box, Librae Bakery, Morgenstern's, Ssäm Bar / Bang Bar, Dimes, Beverly's.

Scarr's Pizza is **not** in this list — it appears in Task 4's file, and Task 6 updates the existing mission in place rather than creating a duplicate venue.

**Files:**
- Create: `migrations/nyc-catalog-carryover-2026-08.json` (identical shape to Task 4)

- [ ] **Step 1: Read each venue's existing record**

```bash
cd ~/platepostjelly && SK=$(grep '^PLATEPOST_CONVEX_SERVICE_KEY=' .env.local | cut -d= -f2- | tr -d '"') && \
  npx convex run jellyhunt/admin:listAdminMissions "{\"serviceKey\": \"$SK\"}"
```

These eleven already have **verified coordinates, hours, geofence, neighborhood, and price** in the database. Copy those values verbatim into the new file — do not re-geocode and do not re-research hours. They were checked once already.

- [ ] **Step 2: Research three to five dishes per venue**

Against each venue's live menu, exactly as in Task 4 Step 4 — same slug rule, same `sortOrder` rule continuing where Task 4's file ends, same shot-type assignment, same "at least three" floor.

These are the author's research, not verified data. **They import as drafts and none is published until Brandon has approved them item by item.**

- [ ] **Step 3: Validate**

Re-run the validator from Task 4 Step 5 against this file, changing the expected venue count from 29 to 11 and checking `sortOrder` against Task 4's file as well so the two do not collide:

```bash
cd ~/platepostjelly && python3 - <<'PY'
import json
a=json.load(open('migrations/nyc-catalog-2026-08.json'))
b=json.load(open('migrations/nyc-catalog-carryover-2026-08.json'))
assert len(b)==11, f"expected 11 venues, got {len(b)}"
oa={m['sortOrder'] for r in a for m in r['missions']}
ob={m['sortOrder'] for r in b for m in r['missions']}
sa={m['slug'] for r in a for m in r['missions']} | {r['venue']['slug'] for r in a}
sb={m['slug'] for r in b for m in r['missions']} | {r['venue']['slug'] for r in b}
print("sortOrder collisions:", sorted(oa & ob) or "none")
print("slug collisions:", sorted(sa & sb) or "none")
print(f"OK: {len(b)} venues, {sum(len(r['missions']) for r in b)} missions")
PY
```

Expected: no collisions, 11 venues, 33–55 missions.

- [ ] **Step 4: Present the missions to Brandon for approval**

List every proposed mission grouped by venue, with its shot type. **Do not proceed to Task 6 until he has approved or amended them.** This is the one place in the plan where research is being passed off as catalog data, and it is his call.

- [ ] **Step 5: Commit**

```bash
cd ~/platepostjelly
git add migrations/nyc-catalog-carryover-2026-08.json
git commit -m "data: dish missions for the 11 carried-over venues

Coordinates and hours copied from their existing verified records. Dishes
researched against live menus and approved by Brandon before import."
```

---

## Task 6: The catalog importer

Dry-run first, idempotent, and it prints its target deployment before writing anything. Modelled on `scripts/import-legacy-jellyhunt.mjs`, which already does all three.

**Files:**
- Create: `scripts/import-nyc-catalog.mjs`
- Modify: `package.json` (add the script entry)

**Interfaces:**
- Consumes: `createMissionWithLocation` and `createMissionAtPlace` (Task 1) via `anyApi.jellyhunt.admin`; both catalog files from Tasks 4 and 5.
- Produces: one place per venue and 3–5 draft missions attached to it.

- [ ] **Step 1: Point the local environment back at Convex**

```bash
cd ~/platepostjelly && sed -i '' 's/^JELLYHUNT_DATA_SOURCE=fixture/JELLYHUNT_DATA_SOURCE=convex/' .env.local && grep JELLYHUNT_DATA_SOURCE .env.local
```

Expected: `JELLYHUNT_DATA_SOURCE=convex`. It was set to `fixture` during design review so the map had something to render; leaving it would mean the importer writes to Convex while the map reads a static file.

- [ ] **Step 2: Write the importer**

Create `scripts/import-nyc-catalog.mjs`:

```javascript
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const CATALOG_FILES = [
  "../migrations/nyc-catalog-2026-08.json",
  "../migrations/nyc-catalog-carryover-2026-08.json",
];

const SHOT_TYPES = new Set(["dish", "spread", "action", "display", "ritual"]);
const REWARD_PER_MISSION = 10;

function printUsage() {
  console.log(`Import the NYC dish-mission catalog into Convex.

Usage:
  node scripts/import-nyc-catalog.mjs          # dry run
  node scripts/import-nyc-catalog.mjs --apply  # create missing drafts

Required environment variables:
  CONVEX_URL
  PLATEPOST_CONVEX_SERVICE_KEY

Safety:
  Every mission is created status=draft, approvalMode=manual, 10 JELLY.
  Existing slugs are skipped and never modified. This importer never
  publishes a mission and never initiates a reward.`);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function validateCatalog(records) {
  const slugs = new Set();
  const sortOrders = new Set();

  for (const record of records) {
    const venue = record?.venue;
    const missions = record?.missions;
    if (!venue?.slug) throw new Error("Catalog record is missing venue.slug");
    if (!Array.isArray(missions) || missions.length < 3 || missions.length > 5) {
      throw new Error(`${venue.slug}: expected 3-5 missions, got ${missions?.length}`);
    }
    if (!Array.isArray(venue.hours) || venue.hours.length !== 7) {
      throw new Error(`${venue.slug}: hours must have exactly 7 entries`);
    }
    if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude)) {
      throw new Error(`${venue.slug}: missing coordinates`);
    }
    if (venue.latitude < 40.68 || venue.latitude > 40.88 ||
        venue.longitude < -74.03 || venue.longitude > -73.9) {
      throw new Error(`${venue.slug}: coordinates are not in Manhattan`);
    }
    for (const mission of missions) {
      if (!SHOT_TYPES.has(mission.shotType)) {
        throw new Error(`${mission.slug}: invalid shotType ${mission.shotType}`);
      }
      if (!mission.description?.trim()) {
        throw new Error(`${mission.slug}: empty description`);
      }
      if (slugs.has(mission.slug)) throw new Error(`Duplicate slug: ${mission.slug}`);
      if (sortOrders.has(mission.sortOrder)) {
        throw new Error(`Duplicate sortOrder: ${mission.sortOrder}`);
      }
      slugs.add(mission.slug);
      sortOrders.add(mission.sortOrder);
    }
  }

  return records;
}

function missionPayload(venue, mission) {
  return {
    slug: mission.slug,
    title: mission.title,
    description: mission.description,
    status: "draft",
    approvalMode: "manual",
    restaurantTag: venue.slug,
    rewardAmount: REWARD_PER_MISSION,
    category: venue.category,
    difficulty: mission.difficulty,
    emoji: mission.emoji,
    shotType: mission.shotType,
    neighborhood: venue.neighborhood,
    price: venue.price,
    hours: venue.hours,
    sortOrder: mission.sortOrder,
    ...(venue.websiteUrl ? { websiteUrl: venue.websiteUrl } : {}),
  };
}

async function main() {
  const unknownArgs = process.argv.slice(2)
    .filter((arg) => !["--apply", "--help", "-h"].includes(arg));
  if (unknownArgs.length) throw new Error(`Unknown argument: ${unknownArgs.join(", ")}`);
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const apply = process.argv.includes("--apply");
  const convexUrl = requireEnvironment("CONVEX_URL");
  const serviceKey = requireEnvironment("PLATEPOST_CONVEX_SERVICE_KEY");

  const records = [];
  for (const file of CATALOG_FILES) {
    const path = fileURLToPath(new URL(file, import.meta.url));
    records.push(...JSON.parse(await readFile(path, "utf8")));
  }
  validateCatalog(records);

  const client = new ConvexHttpClient(convexUrl);
  console.log(`Connecting to Convex deployment: ${new URL(convexUrl).origin}`);

  const existing = await client.query(anyApi.jellyhunt.admin.listAdminMissions, { serviceKey });
  const existingSlugs = new Set(existing.map((mission) => mission.slug));

  let created = 0;
  let skipped = 0;

  for (const { venue, missions } of records) {
    const pending = missions.filter((mission) => !existingSlugs.has(mission.slug));
    skipped += missions.length - pending.length;
    for (const mission of missions.filter((m) => existingSlugs.has(m.slug))) {
      console.log(`[skip] ${mission.slug} already exists; no fields will be changed`);
    }
    if (!pending.length) continue;

    if (!apply) {
      console.log(`[dry-run] ${venue.slug}: would create ${pending.length} draft mission(s)`);
      for (const mission of pending) {
        console.log(`  [dry-run] ${mission.slug} (${mission.shotType})`);
      }
      created += pending.length;
      continue;
    }

    // The first mission creates the place; the rest attach to it. An existing
    // venue (Scarr's) already has a place, so createMissionWithLocation would
    // throw place_already_linked_to_jelly_place_id — reuse it instead.
    let locationId = existing.find((m) => m.restaurantTag === venue.slug)?.location?._id;

    for (const mission of pending) {
      if (!locationId) {
        const result = await client.mutation(
          anyApi.jellyhunt.admin.createMissionWithLocation,
          {
            serviceKey,
            actorId: "nyc-catalog-import",
            mission: missionPayload(venue, mission),
            location: {
              name: venue.name,
              address: venue.address,
              latitude: venue.latitude,
              longitude: venue.longitude,
              geofenceRadiusMeters: venue.geofenceRadiusMeters ?? 75,
              timeZone: venue.timeZone,
            },
          },
        );
        locationId = result.locationId;
      } else {
        await client.mutation(anyApi.jellyhunt.admin.createMissionAtPlace, {
          serviceKey,
          actorId: "nyc-catalog-import",
          locationId,
          mission: missionPayload(venue, mission),
        });
      }
      console.log(`[created] ${mission.slug}`);
      created += 1;
    }
  }

  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: ${created} mission(s) ${apply ? "created" : "missing"}; ${skipped} existing slug(s) skipped.`,
  );
  console.log(
    "Every mission is a draft. Addresses, coordinates, hours, and dishes require human review before activation.",
  );
  if (!apply && created) {
    console.log("No data was changed. Re-run with --apply only after reviewing this plan.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 3: Register the script**

Add to `package.json` `scripts`, after `migrate:legacy-jellyhunt`:

```json
"migrate:nyc-catalog": "node scripts/import-nyc-catalog.mjs"
```

- [ ] **Step 4: Dry run**

```bash
cd ~/platepostjelly && set -a && . ./.env.local && set +a && pnpm migrate:nyc-catalog
```

Expected: the target deployment origin, then one `[dry-run]` line per venue and per mission, and a `DRY RUN: N mission(s) missing` summary.

- [ ] **Step 5: Confirm the target deployment before applying**

Read the `Connecting to Convex deployment:` line. **STOP unless it is `https://aware-dolphin-950.convex.cloud`.** If it names `youthful-corgi-373` or `neat-armadillo-434` you are pointed at the live restaurant menus — stop and tell Brandon. This is the last checkpoint before data is written.

- [ ] **Step 6: Apply**

```bash
cd ~/platepostjelly && set -a && . ./.env.local && set +a && pnpm migrate:nyc-catalog --apply
```

Expected: one `[created]` line per mission.

- [ ] **Step 7: Verify the result**

```bash
cd ~/platepostjelly && SK=$(grep '^PLATEPOST_CONVEX_SERVICE_KEY=' .env.local | cut -d= -f2- | tr -d '"') && \
  npx convex run jellyhunt/admin:listAdminMissions "{\"serviceKey\": \"$SK\"}" | python3 -c "
import sys, json, collections
raw=sys.stdin.read(); ms=json.loads(raw[raw.find('['):])
print('missions:', len(ms))
print('by status:', collections.Counter(m['status'] for m in ms))
places=collections.Counter(m['location']['_id'] for m in ms)
print('venues:', len(places))
print('missions per venue:', collections.Counter(places.values()))
bad=[m['slug'] for m in ms if m['rewardAmount']!=10 and m['status']!='archived']
print('wrong reward:', bad or 'none')
"
```

Expected: 40 venues, every venue holding 3–5 missions, every mission `draft`, every reward 10.

- [ ] **Step 8: Re-run the dry run to prove idempotency**

```bash
cd ~/platepostjelly && set -a && . ./.env.local && set +a && pnpm migrate:nyc-catalog
```

Expected: `0 mission(s) missing`, every mission reported as `[skip]`, no field changes.

- [ ] **Step 9: Commit**

```bash
cd ~/platepostjelly
git add scripts/import-nyc-catalog.mjs package.json
git commit -m "feat: NYC catalog importer

Dry-run first, prints its target deployment, idempotent on re-run. Creates
one place per venue then attaches the remaining missions to it, reusing an
existing place where the venue is already in the database."
```

---

## Task 7: Archive the four dropped venues

Conbud, Comedy Cellar, Hester Street Fair, and The Good Company do not fit the dish model. They are archived, not deleted, so revisions, submissions, and audit history survive.

**Files:**
- Create: `scripts/archive-dropped-venues.mjs`

- [ ] **Step 1: Write the script**

Create `scripts/archive-dropped-venues.mjs`:

```javascript
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const DROPPED = ["conbud", "comedy-cellar", "hester-street-fair", "the-good-company"];

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const convexUrl = requireEnvironment("CONVEX_URL");
  const serviceKey = requireEnvironment("PLATEPOST_CONVEX_SERVICE_KEY");
  const client = new ConvexHttpClient(convexUrl);

  console.log(`Connecting to Convex deployment: ${new URL(convexUrl).origin}`);
  const missions = await client.query(anyApi.jellyhunt.admin.listAdminMissions, { serviceKey });
  const targets = missions.filter(
    (mission) => DROPPED.includes(mission.slug) && mission.status !== "archived",
  );

  const missing = DROPPED.filter((slug) => !missions.some((m) => m.slug === slug));
  if (missing.length) console.log(`[note] not found in this deployment: ${missing.join(", ")}`);

  for (const mission of targets) {
    if (!apply) {
      console.log(`[dry-run] would archive ${mission.slug} (currently ${mission.status})`);
      continue;
    }
    await client.mutation(anyApi.jellyhunt.admin.updateMissionStatus, {
      serviceKey,
      actorId: "nyc-catalog-import",
      missionId: mission._id,
      status: "archived",
    });
    console.log(`[archived] ${mission.slug}`);
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${targets.length} mission(s) to archive.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Dry run, then apply**

```bash
cd ~/platepostjelly && set -a && . ./.env.local && set +a
node scripts/archive-dropped-venues.mjs
node scripts/archive-dropped-venues.mjs --apply
```

Expected: four `[dry-run]` lines, then four `[archived]` lines.

- [ ] **Step 3: Verify they are gone from discovery but not from history**

```bash
cd ~/platepostjelly && SK=$(grep '^PLATEPOST_CONVEX_SERVICE_KEY=' .env.local | cut -d= -f2- | tr -d '"') && \
  npx convex run jellyhunt/admin:listAdminMissions "{\"serviceKey\": \"$SK\"}" | python3 -c "
import sys, json
raw=sys.stdin.read(); ms=json.loads(raw[raw.find('['):])
dropped=[m for m in ms if m['slug'] in ('conbud','comedy-cellar','hester-street-fair','the-good-company')]
print('found:', len(dropped))
for m in dropped: print(' ', m['slug'], m['status'])
"
```

Expected: four missions, all `archived`. They still appear in the admin list — that is the point of archiving rather than deleting.

- [ ] **Step 4: Commit**

```bash
cd ~/platepostjelly
git add scripts/archive-dropped-venues.mjs
git commit -m "chore: archive the four venues that do not fit the dish model

A dispensary, a comedy club, a market, and a bar. Archived rather than
deleted so revisions, submissions, and audit history survive."
```

---

## Task 8: One pin per venue, missions inside

The map currently renders one marker per mission (`jellyhunt-explorer.tsx:530-563`) and the detail panel shows a single mission. With 170 missions at 40 addresses that produces five stacked pins per restaurant.

**Files:**
- Modify: `app/human-social/jellyhunt-explorer.tsx`
- Modify: `app/human-social/jellyhunt.css`

**Interfaces:**
- Consumes: `groupMissionsIntoVenues`, `Venue` from `@/src/lib/jellyhunt/venues` (Task 3); `shotTypeSpec` from `@/src/lib/jellyhunt/shot-types` (Task 2).

- [ ] **Step 1: Read the component before changing it**

```bash
cd ~/platepostjelly && sed -n '330,400p;500,600p;760,860p' app/human-social/jellyhunt-explorer.tsx
```

Note the three places that key off missions: the memoised `filteredMissions` and `selectedId` state (around lines 349-372), the Mapbox marker loop (520-563), and the fallback-map pin loop (794-812). All three move to venues. The fallback map is what renders without a Mapbox token and must keep working.

- [ ] **Step 2: Group missions into venues at the top of the component**

Replace the mission-keyed derivations. `selectedId` becomes a venue id; a new `selectedMissionId` tracks the mission chosen inside the venue.

```typescript
import { groupMissionsIntoVenues, type Venue } from "@/src/lib/jellyhunt/venues";
import { shotTypeSpec } from "@/src/lib/jellyhunt/shot-types";

const venues = useMemo(() => groupMissionsIntoVenues(filteredMissions), [filteredMissions]);
const selectedVenue = useMemo(
  () => venues.find((venue) => venue.id === selectedId) ?? null,
  [venues, selectedId],
);
const selectedMission = useMemo(() => {
  if (!selectedVenue) return null;
  return (
    selectedVenue.missions.find((mission) => mission.id === selectedMissionId) ??
    selectedVenue.missions[0]
  );
}, [selectedVenue, selectedMissionId]);
```

When `selectedId` changes, reset `selectedMissionId` to `null` so a newly opened venue shows its first mission rather than a stale one from the previous venue.

- [ ] **Step 3: Render one marker per venue**

In the Mapbox marker loop, iterate `venues` instead of `filteredMissions`. Key the marker map by `venue.id`, position with `[venue.longitude, venue.latitude]`, label with `venue.emoji`, and set the tooltip to `venue.name`. A venue whose every mission is complete shows `✓`; otherwise it shows the emoji and a count badge of remaining missions.

Apply the same change to the fallback-map loop so the token-less path stays correct.

- [ ] **Step 4: List the venue's missions in the detail panel**

The panel keeps the venue header it already has — name, address, distance, open/closed, directions — and gains a mission list beneath it. Each row shows the shot-type label, the mission title, its reward, and its completion state, and selecting a row sets `selectedMissionId`.

```tsx
<ul className="hunt-venue-missions">
  {selectedVenue.missions.map((mission) => {
    const spec = shotTypeSpec(mission.shotType ?? "");
    const status = missionState(mission.id, userStatus);
    return (
      <li key={mission.id}>
        <button
          type="button"
          className="hunt-venue-mission"
          data-selected={mission.id === selectedMission?.id}
          data-complete={isMissionComplete(status)}
          aria-pressed={mission.id === selectedMission?.id}
          onClick={() => setSelectedMissionId(mission.id)}
        >
          <span className="hunt-venue-mission-shot">{spec?.label ?? "Mission"}</span>
          <span className="hunt-venue-mission-title">{mission.title}</span>
          <span className="hunt-venue-mission-reward">{mission.rewardAmount}</span>
        </button>
      </li>
    );
  })}
</ul>
<p className="hunt-venue-total">Up to {selectedVenue.rewardTotal} JELLY here</p>
```

`START MISSION` stays a single button and acts on `selectedMission`, and its label names the mission so it is never ambiguous which of five is about to start. The filming instruction shown beside it is `shotTypeSpec(selectedMission.shotType)?.instruction`, falling back to `selectedMission.description`.

- [ ] **Step 5: Style the mission rows**

Add to `app/human-social/jellyhunt.css`. Colors are deliberately left as the existing tokens here — Task 9 rebrands every token at once, and doing it twice invites drift.

```css
.hunt-venue-missions{display:flex;flex-direction:column;gap:6px;list-style:none;margin:12px 0 0;padding:0}
.hunt-venue-mission{align-items:center;background:rgba(255,255,255,.04);border:1px solid transparent;border-radius:10px;color:inherit;cursor:pointer;display:grid;gap:10px;grid-template-columns:auto 1fr auto;padding:10px 12px;text-align:left;width:100%}
.hunt-venue-mission:hover{background:rgba(255,255,255,.07)}
.hunt-venue-mission[data-selected=true]{border-color:var(--hunt-cyan)}
.hunt-venue-mission[data-complete=true] .hunt-venue-mission-title{opacity:.55;text-decoration:line-through}
.hunt-venue-mission-shot{font-size:10px;letter-spacing:.08em;opacity:.7;text-transform:uppercase}
.hunt-venue-mission-title{font-weight:600}
.hunt-venue-mission-reward{font-variant-numeric:tabular-nums;font-weight:700}
.hunt-venue-total{margin:10px 0 0;opacity:.7;font-size:13px}
```

- [ ] **Step 6: Verify by looking, not by tests passing**

```bash
cd ~/platepostjelly && pnpm dev
```

Open `http://localhost:3000/human-social` and **wait four seconds before reading anything** — menu pages settle well after load. Then confirm by eye:

- 40 pins, not ~170, and no two pins stacked at one address.
- Tapping a pin opens the venue with its missions listed.
- Selecting a mission row changes the instruction text and the `START MISSION` label.
- The venue total equals the sum of the rows, and a three-mission venue reads 30 rather than 50.
- The same holds with `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` removed, which exercises the fallback map.

Take a screenshot at a mobile width (390px) and a desktop width. Green tests are not evidence the map looks right.

- [ ] **Step 7: Run the gates and commit**

```bash
cd ~/platepostjelly && pnpm test && pnpm test:contracts && pnpm lint && pnpm build
git add app/human-social/jellyhunt-explorer.tsx app/human-social/jellyhunt.css
git commit -m "feat: one map pin per venue, missions listed inside

170 missions at 40 addresses produced five stacked pins per restaurant.
Pins are now venues; the panel lists that venue's missions, each selectable
and separately rewarded."
```

---

## Task 9: PlatePost branding

**Files:**
- Modify: `app/human-social/jellyhunt.css`
- Modify: `app/human-social/jellyhunt-explorer.tsx` (header markup and the second call to action)
- Create: `public/fonts/Manrope-Variable.woff2`

- [ ] **Step 1: Self-host Manrope**

The stylesheet currently pulls Inter, JetBrains Mono, Outfit, Quicksand, and Ranchers from Google Fonts in an `@import` on line 1. Replace all five with Manrope, served locally.

```bash
cd ~/platepostjelly && mkdir -p public/fonts
unzip -o ~/"PlatePost Brand Assets/Manrope-VariableFont_wght.ttf.zip" -d /tmp/manrope
ls /tmp/manrope
```

Convert the variable TTF to woff2 and place it at `public/fonts/Manrope-Variable.woff2`. If no converter is available locally, take the woff2 from the Manrope release on Google Fonts — it is the same open-licensed family.

Replace line 1 of `jellyhunt.css` with:

```css
@font-face{font-family:Manrope;src:url("/fonts/Manrope-Variable.woff2") format("woff2-variations");font-weight:400 800;font-display:swap;font-style:normal}
```

- [ ] **Step 2: Rebrand the palette tokens**

Replace the `.hunt-map-screen` custom properties (line 3 of `jellyhunt.css`). Every colour in the file resolves through these, so this one block does most of the work:

```css
.hunt-map-screen{
  --hunt-void:#071126;        /* PlatePost navy */
  --hunt-deep:#0d1c39;
  --hunt-panel:#12244a;
  --hunt-blue:#4576ef;        /* PlatePost blue */
  --hunt-cyan:#5fd0ff;        /* accent, retained so the map is not a listings page */
  --hunt-mint:#3ddc97;
  --hunt-coral:#f4635e;
  --hunt-paper:#f6f8ff;
  --hunt-muted:rgba(226,236,255,.72);
  background:var(--hunt-void);
  color:var(--hunt-paper);
  font-family:Manrope,ui-sans-serif,system-ui,sans-serif;
  inset:0;position:fixed;z-index:100;
}
```

Then search the file for every remaining hard-coded hex and route it through a token: `grep -n '#[0-9a-fA-F]\{6\}' app/human-social/jellyhunt.css`. The mission-difficulty colours at `jellyhunt-explorer.tsx:210-212` are literals in the component and need the same treatment.

- [ ] **Step 3: Set the Mapbox style to match**

The map currently loads a dark style that reads blue-on-black. Confirm which style the component requests and, if it is not already, set it to `mapbox://styles/mapbox/dark-v11` so the tiles sit under a navy chrome rather than fighting it.

- [ ] **Step 4: Rebuild the header**

The `JELLYHUNT` wordmark currently spans a third of the viewport and collides with Mapbox street labels — visible in the design-review screenshot, where "AVE A & ST MARKS PL" runs through it.

Replace it with the PlatePost mark, "PlatePost × Jelly" as the title, and a single line of supporting text. Add the second call to action beside the existing one:

```tsx
<div className="hunt-header-actions">
  <a className="hunt-cta hunt-cta-jelly" href={appLinks.ios} target="_blank" rel="noreferrer">
    Get Jelly
  </a>
  <a className="hunt-cta hunt-cta-platepost" href="https://platepost.io" target="_blank" rel="noreferrer">
    PlatePost
  </a>
</div>
```

```css
.hunt-header-actions{display:flex;gap:8px}
.hunt-cta{border-radius:999px;font-weight:700;font-size:13px;padding:10px 16px;text-decoration:none;white-space:nowrap}
.hunt-cta-jelly{background:var(--hunt-cyan);color:var(--hunt-void)}
.hunt-cta-platepost{background:transparent;border:1px solid var(--hunt-blue);color:var(--hunt-paper)}
```

The logo comes from `~/PlatePost Brand Assets/Logo files/`. Copy the SVG into `public/` and reference it — **do not inline it as a `data:` URI**, because `next/image` returns 400 on `data:` sources.

- [ ] **Step 5: Check contrast against the new ground**

The muted token moved from `rgba(231,240,255,.65)` to `rgba(226,236,255,.72)` because the navy ground is lighter than the near-black it replaced. Verify, don't assume: measure the computed contrast of the muted text, the mission-row labels, and both buttons against their actual backgrounds. Anything under 4.5:1 for body text gets a lighter value.

- [ ] **Step 6: Verify by looking**

With the dev server running, screenshot `/human-social` at 390px and at desktop width, and confirm:

- Navy ground, blue pins, Manrope everywhere. No Outfit, Quicksand, or Ranchers survives — `grep -n "Outfit\|Quicksand\|Ranchers\|JetBrains" app/human-social/jellyhunt.css` returns nothing.
- The PlatePost mark is present and the header no longer collides with map labels at any width.
- Both buttons are visible and reachable, and neither wraps.
- Both leaderboard tabs still render.

- [ ] **Step 7: Run the gates and commit**

```bash
cd ~/platepostjelly && pnpm test && pnpm lint && pnpm build
git add app/human-social/jellyhunt.css app/human-social/jellyhunt-explorer.tsx public/fonts public/
git commit -m "feat: PlatePost branding on the hunt map

Navy and blue ground, self-hosted Manrope replacing five Google-hosted
families, PlatePost mark leading the header, and a second call to action.
The oversized wordmark that collided with map labels is gone."
```

---

## Task 10: Admin — shot type and venue grouping

**Files:**
- Modify: `app/admin/admin-dashboard.tsx`
- Modify: `tests/jellyhunt-shot-types.test.ts`

- [ ] **Step 1: Prove the two copies of the shot-type text agree**

Task 2 duplicated the instructions into `convex/jellyhunt/admin.ts` because `convex/` cannot import from `src/`. Duplication without a test is how they drift.

Add to `tests/jellyhunt-shot-types.test.ts`:

```typescript
import { readFileSync } from "node:fs";

it("keeps the Convex copy of the shot-type rules in step with this module", () => {
  const source = readFileSync("convex/jellyhunt/admin.ts", "utf8");
  for (const id of SHOT_TYPES) {
    const spec = SHOT_TYPE_SPECS[id];
    expect(source).toContain(spec.instruction);
    expect(source).toMatch(
      new RegExp(`minDurationSeconds:\\s*${spec.minDurationSeconds}`),
    );
  }
});
```

Run it, then change one instruction string in `convex/jellyhunt/admin.ts` and confirm the test fails before putting it back.

- [ ] **Step 2: Add the shot-type selector**

In the mission edit form in `app/admin/admin-dashboard.tsx`, add a select bound to the mission's `shotType`, populated from `SHOT_TYPES`, showing each spec's `label`. It is optional — the 16 legacy missions have no shot type and must remain editable.

```tsx
<label className="admin-field">
  <span>Shot type</span>
  <select
    value={draft.shotType ?? ""}
    onChange={(event) =>
      setDraft({ ...draft, shotType: event.target.value || undefined })
    }
  >
    <option value="">— none —</option>
    {SHOT_TYPES.map((id) => (
      <option key={id} value={id}>{SHOT_TYPE_SPECS[id].label}</option>
    ))}
  </select>
</label>
```

Show the selected type's instruction beneath the select, so an operator sees what the filmer will be told without leaving the form.

- [ ] **Step 3: Group the mission list by venue**

170 flat rows is unusable. Group with `groupMissionsIntoVenues` and render each venue as a header — name, mission count, and how many are published — with its missions beneath.

```tsx
{groupMissionsIntoVenues(missions).map((venue) => (
  <section key={venue.id} className="admin-venue">
    <h3>
      {venue.name}
      <span className="admin-venue-count">
        {venue.missions.length} missions ·{" "}
        {venue.missions.filter((m) => m.status === "active").length} published
      </span>
    </h3>
    {venue.missions.map((mission) => renderMissionRow(mission))}
  </section>
))}
```

Reuse whatever row renderer the file already has rather than writing a second one; read the component before adding markup.

- [ ] **Step 4: Verify by looking**

Log into `/admin` with the credentials in `.env.local`. Confirm venues group correctly, the shot-type selector saves and survives a reload, and the counts are right. Change one mission's shot type and confirm the instruction text on `/human-social` changes without a redeploy.

- [ ] **Step 5: Run the gates and commit**

```bash
cd ~/platepostjelly && pnpm test && pnpm lint && pnpm build
git add app/admin/admin-dashboard.tsx tests/jellyhunt-shot-types.test.ts
git commit -m "feat: shot-type editing and venue grouping in admin

Also pins the duplicated Convex copy of the shot-type rules to this module
with a test, since duplication without one is how the two drift apart."
```

---

## Task 11: Publish the pilot ten and prove it works

Every check is observed directly and recorded. A failure stops the milestone; it is not noted as a caveat.

- [ ] **Step 1: Choose ten venues across neighborhoods**

Not ten from one block. A workable spread: Supermoon Bakehouse (LES), Scarr's Pizza (LES), Nan Xiang Soup Dumplings (East Village), Xing Fu Tang (East Village), miss KOREA BBQ (Koreatown), Mitr Thai (Midtown), Amor Loco (Midtown), Shuka (SoHo), Taiyaki NYC (Chinatown), Figo il Gelato (Nolita).

Substitute freely, but keep the spread — the map should read as a city, not a single street.

- [ ] **Step 2: Verify each of the ten by hand**

For every one, against the live web:

- The business is currently open and operating at the stated address.
- The address matches the business.
- Latitude and longitude land on that building. Paste `<lat>,<lng>` into a map and look.
- Hours are plausible, seven entries, Sunday first.
- `geofenceRadiusMeters` suits the block.
- Every dish is genuinely on the current menu.
- Title, description, shot type, category, difficulty, emoji, neighborhood, price, and the 10 JELLY reward read correctly.

Record what you checked and what you found for each. **If a fact cannot be confirmed, do not publish that venue — substitute another.**

- [ ] **Step 3: Publish**

For each verified mission, using its `publicId` from `listAdminMissions`:

```bash
cd ~/platepostjelly && SK=$(grep '^PLATEPOST_CONVEX_SERVICE_KEY=' .env.local | cut -d= -f2- | tr -d '"') && \
npx convex run jellyhunt/admin:updateMissionStatus "{
  \"serviceKey\": \"$SK\",
  \"actorId\": \"brandon@platepost.io\",
  \"missionId\": \"<mis_ id>\",
  \"status\": \"active\"
}"
```

- [ ] **Step 4: Verify the split**

```bash
cd ~/platepostjelly && SK=$(grep '^PLATEPOST_CONVEX_SERVICE_KEY=' .env.local | cut -d= -f2- | tr -d '"') && \
  npx convex run jellyhunt/admin:listAdminMissions "{\"serviceKey\": \"$SK\"}" | python3 -c "
import sys, json, collections
raw=sys.stdin.read(); ms=json.loads(raw[raw.find('['):])
active=[m for m in ms if m['status']=='active']
print(collections.Counter(m['status'] for m in ms))
print('active venues:', len({m['location']['_id'] for m in active}))
"
```

Expected: 10 active venues; everything else `draft` or the four `archived`.

- [ ] **Step 5: Prove an admin edit reaches every surface with no redeploy**

Change a published mission's title in `/admin`, then check all three surfaces without deploying:

```bash
curl -s "http://localhost:3000/api/v1/jellyhunt/missions" | grep -o "<new title>"
curl -s "http://localhost:3000/api/v2/jellyhunt/missions" | grep -o "<new title>"
```

And reload `/human-social`. Expected: the new title on the map, on v1, and on v2. Restore the original title afterwards.

- [ ] **Step 6: Prove the legacy contract is untouched**

```bash
curl -s "http://localhost:3000/api/v1/jellyhunt/missions" | python3 -c "
import sys, json
d=json.load(sys.stdin)
leaked=[m['slug'] for m in d['missions'] if 'shotType' in m]
print('missions leaking shotType into v1:', leaked or 'none')
"
```

Expected: `none`. This is the check that proves Task 2's projection change works against a real response rather than a unit fixture.

- [ ] **Step 7: Prove no reward can move**

```bash
cd ~/platepostjelly && npx convex env get JELLYHUNT_AUTOMATIC_REWARDS_ENABLED
```

Expected: `false`. `automaticRewardDispatchAllowed` in `convex/jellyhunt/rewards.ts` returns false at its first check unless this is exactly the string `"true"`.

- [ ] **Step 8: Leaderboards still load**

Open both leaderboard tabs on `/human-social`. Expected: real standings or an empty state, never `leaderboard_program_config_not_found`.

- [ ] **Step 9: Full regression gates**

```bash
cd ~/platepostjelly && pnpm test && pnpm test:contracts && pnpm test:convex && pnpm validate:openapi && pnpm lint && pnpm build && pnpm typecheck:convex
```

Expected: all pass.

- [ ] **Step 10: Report**

Give Brandon: the ten published venues and their missions, the thirty still draft, the four archived, the observed result of every check above, screenshots of the map and a venue sheet at mobile and desktop widths, and an explicit restatement of what a Jelly user still cannot do — **no mission token, no post verification, no payout.** Approval is manual and no reward can be sent.

---

## Out of scope

- Deploying to Vercel. No Vercel project is linked for `platepostjelly`; standing one up is Tasks 6–7 of `2026-07-28-jellyhunt-preview-deployment.md` and needs Brandon's browser login.
- Chicago and LA venues. The campaign's map bounds are a single Manhattan viewport and there is no city switcher.
- Rotating the credentials exposed in chat in July. Brandon's dashboard action.
- Jelly mission tokens, place and evidence APIs, reward transfer, native app integration. Gates 4–7 of `docs/NEXT_STEPS.md`, all blocked on Jelly.
- Any production deployment.
