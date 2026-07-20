# JellyHunt Convex Foundation and Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the existing v1 behavior, publish executable v2 contracts, and replace generic standalone Convex tables/functions with a safely mergeable `jellyhunt*` foundation for campaigns, places, missions, and immutable revisions.

**Architecture:** Next.js remains the HTTPS boundary and consumes generated Convex references through a server-only repository. A namespaced Convex module exports tables and functions that can be merged into PlatePost’s existing schema, router, and cron registry without deleting unrelated surfaces. Contract fixtures land before implementation so v1 compatibility and v2 privacy are executable.

**Tech Stack:** Node.js 18+, pnpm 9.15.4, Next.js 15.5.20, TypeScript 5.7, Convex 1.27.1, Zod 3.24, Vitest 2.1, OpenAPI 3.1, `@redocly/cli`, `convex-test`, `jose`, `json-canonicalize`.

## Global Constraints

- Follow every constraint in [the migration roadmap](2026-07-16-jellyhunt-convex-migration-roadmap.md).
- Existing v1 fields, statuses, and HTTP codes are frozen. New public IDs and revisions may be additive only.
- v1 malformed JSON remains the existing `500 submission_failed`; v2 malformed JSON is `400 invalid_json` and creates no idempotency record.
- Any valid optional v2 bearer includes viewer state automatically; no bearer omits viewer state. An invalid bearer returns `401` rather than downgrading to anonymous.
- Public IDs require the resource prefix and otherwise remain opaque; Jelly IDs are trimmed but never lowercased.
- Root PlatePost schema/router/cron changes are merges, never replacements.
- This plan may target local or development Convex only. It never invokes `convex deploy` with a Production key.

---

### Task 1: Freeze v1 Compatibility Before Refactoring

**Files:**
- Create: `tests/contracts/jellyhunt-v1/manifest.json`
- Create: `tests/contracts/jellyhunt-v1/missions-anonymous.200.json`
- Create: `tests/contracts/jellyhunt-v1/missions-authenticated.200.json`
- Create: `tests/contracts/jellyhunt-v1/submission-created.201.json`
- Create: `tests/contracts/jellyhunt-v1/submission-malformed.500.json`
- Create: `tests/jellyhunt-v1-compatibility.test.ts`
- Modify: `src/lib/jellyhunt/contracts.ts`

**Interfaces:**
- Consumes: current v1 handlers under `app/api/v1/jellyhunt/`.
- Produces: `projectLegacyV1<T>(value: T): unknown`, used by compatibility tests to compare frozen legacy fields while allowing documented additive keys.

- [ ] **Step 1: Write the failing compatibility test**

```ts
import { describe, expect, it } from "vitest";
import manifest from "./contracts/jellyhunt-v1/manifest.json";
import { projectLegacyV1 } from "@/src/lib/jellyhunt/contracts";

describe("frozen JellyHunt v1 contract", () => {
  it("freezes legacy fields and statuses while permitting additive public IDs", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/missions-anonymous.200.json");
    expect(manifest.version).toBe("jellyhunt-v1-frozen-2026-07-16");
    expect(projectLegacyV1(fixture.default)).toEqual(fixture.default.legacyProjection);
  });

  it("freezes malformed JSON as the existing 500 response", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-malformed.500.json");
    expect(fixture.default.status).toBe(500);
    expect(fixture.default.body).toEqual({ error: "submission_failed" });
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `pnpm exec vitest run tests/jellyhunt-v1-compatibility.test.ts`

Expected: FAIL because the manifest, fixtures, and `projectLegacyV1` do not exist.

- [ ] **Step 3: Add the manifest and projection function**

```json
{
  "version": "jellyhunt-v1-frozen-2026-07-16",
  "frozenRoutes": [
    "GET /api/v1/jellyhunt/missions",
    "POST /api/v1/jellyhunt/submissions"
  ],
  "additiveKeys": ["publicId", "revision"],
  "malformedJsonStatus": 500
}
```

```ts
const V1_ADDITIVE_KEYS = new Set(["publicId", "revision"]);

export function projectLegacyV1(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectLegacyV1);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !V1_ADDITIVE_KEYS.has(key))
      .map(([key, child]) => [key, projectLegacyV1(child)]),
  );
}
```

- [ ] **Step 4: Capture responses from current handlers into the four fixtures**

Each fixture must contain `status`, `headers`, `body`, and `legacyProjection`. Replace volatile request IDs and timestamps with the literal values already used by the test request. Do not change a handler to make the fixture prettier.

- [ ] **Step 5: Run focused and full tests**

Run: `pnpm exec vitest run tests/jellyhunt-v1-compatibility.test.ts tests/jellyhunt-contracts.test.ts`

Expected: PASS.

Run: `pnpm test`

Expected: 64 existing tests plus the new compatibility tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/contracts/jellyhunt-v1 tests/jellyhunt-v1-compatibility.test.ts src/lib/jellyhunt/contracts.ts
git commit -m "test: freeze JellyHunt v1 contract"
```

### Task 2: Add Contract and Convex Test Tooling

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.convex.config.ts`
- Create: `scripts/validate-jellyhunt-contracts.mjs`

**Interfaces:**
- Consumes: package scripts and test directories.
- Produces: deterministic commands `test:contracts`, `test:convex`, `validate:openapi`, and `typecheck:convex`.

- [ ] **Step 1: Add a source-level script test**

```ts
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("JellyHunt verification scripts", () => {
  it("defines separate contract and Convex gates", () => {
    expect(packageJson.scripts["test:contracts"]).toBe("vitest run tests/jellyhunt-v1-compatibility.test.ts tests/jellyhunt-v2-openapi.test.ts tests/jellyhunt-v2-fixtures.test.ts");
    expect(packageJson.scripts["test:convex"]).toBe("vitest run --config vitest.convex.config.ts");
    expect(packageJson.scripts["validate:openapi"]).toBe("redocly lint openapi/jellyhunt-v2.yaml");
    expect(packageJson.scripts["typecheck:convex"]).toBe("convex dev --once --typecheck enable");
  });
});
```

- [ ] **Step 2: Verify it fails before package changes**

Run: `pnpm exec vitest run tests/package-scripts.test.ts`

Expected: FAIL because the four scripts are absent.

- [ ] **Step 3: Install pinned compatible tooling**

Run: `pnpm add -D convex-test@0.0.38 @redocly/cli@1.34.3`

Run: `pnpm add jose@5.9.6 json-canonicalize@1.1.1`

Expected: `package.json` and `pnpm-lock.yaml` change without peer-dependency errors.

- [ ] **Step 4: Add the scripts and Convex test configuration**

```json
{
  "test:contracts": "vitest run tests/jellyhunt-v1-compatibility.test.ts tests/jellyhunt-v2-openapi.test.ts tests/jellyhunt-v2-fixtures.test.ts",
  "test:convex": "vitest run --config vitest.convex.config.ts",
  "validate:openapi": "redocly lint openapi/jellyhunt-v2.yaml",
  "typecheck:convex": "convex dev --once --typecheck enable"
}
```

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/convex/**/*.test.ts"],
    pool: "threads",
    isolate: true,
  },
});
```

- [ ] **Step 5: Run the script test and baseline gates**

Run: `pnpm exec vitest run tests/package-scripts.test.ts`

Expected: PASS.

Run: `pnpm test && pnpm lint`

Expected: both commands exit zero.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.convex.config.ts tests/package-scripts.test.ts scripts/validate-jellyhunt-contracts.mjs
git commit -m "test: add JellyHunt contract and Convex gates"
```

### Task 3: Publish the Executable Native v2 Contract

**Files:**
- Create: `openapi/jellyhunt-v2.yaml`
- Create: `tests/contracts/jellyhunt-v2/manifest.json`
- Create: `tests/contracts/jellyhunt-v2/*.json`
- Create: `tests/contracts/jelly-partner-v1/*.json`
- Create: `tests/jellyhunt-v2-openapi.test.ts`
- Create: `tests/jellyhunt-v2-fixtures.test.ts`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: the two approved design specs.
- Produces: seventeen named OpenAPI operations and versioned response/error fixtures used by Jelly native and every later plan task.

- [ ] **Step 1: Write the operation-coverage test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REQUIRED = [
  "getCurrentCampaign",
  "listMissions",
  "getMission",
  "getMissionJellies",
  "getPlace",
  "getPlaceJellies",
  "startMissionParticipation",
  "getParticipation",
  "createMissionSubmission",
  "getSubmission",
  "listSubmissionEvents",
  "getMe",
  "listMyMissions",
  "listMySubmissions",
  "listMyEvents",
  "getCurrentSeasonLeaderboard",
  "getAllTimeLeaderboard",
] as const;

describe("JellyHunt v2 OpenAPI", () => {
  it("declares every approved operation exactly once", () => {
    const source = readFileSync("openapi/jellyhunt-v2.yaml", "utf8");
    for (const operationId of REQUIRED) {
      expect(source.match(new RegExp(`operationId: ${operationId}`, "g"))).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/jellyhunt-v2-openapi.test.ts`

Expected: FAIL because `openapi/jellyhunt-v2.yaml` is absent.

- [ ] **Step 3: Create the OpenAPI root and security model**

```yaml
openapi: 3.1.0
info:
  title: PlatePost JellyHunt Native API
  version: 2.0.0
servers:
  - url: https://platepost.io/api/v2/jellyhunt
components:
  securitySchemes:
    jellyMissionToken:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Error:
      type: object
      additionalProperties: false
      required: [error, meta]
      properties:
        error:
          type: object
          additionalProperties: false
          required: [code, message]
          properties:
            code: { type: string }
            message: { type: string }
            restartRequired: { type: boolean }
        meta:
          $ref: '#/components/schemas/Meta'
    Meta:
      type: object
      additionalProperties: false
      required: [apiVersion, requestId, generatedAt]
      properties:
        apiVersion: { const: '2.0' }
        requestId: { type: string }
        generatedAt: { type: string, format: date-time }
paths: {}
```

- [ ] **Step 4: Add every path, request schema, success schema, and stable error response from the approved v2 design**

Use the exact route list and field names in the design. All reward amounts are strings matching `^[0-9]+(?:\\.[0-9]+)?$`; public IDs match only their prefix plus a non-empty opaque suffix; public schemas set `additionalProperties: false`; personalized operations require `jellyMissionToken`.

- [ ] **Step 5: Add the v2 fixture manifest**

```json
{
  "apiVersion": "2.0",
  "successFixtures": [
    "campaign-current.200.json",
    "missions-list-anonymous.200.json",
    "missions-list-viewer.200.json",
    "mission-detail-anonymous.200.json",
    "mission-detail-viewer.200.json",
    "place-detail.200.json",
    "place-jellies.200.json",
    "participation-created.201.json",
    "participation-replay.200.json",
    "submission-accepted.202.json",
    "submission-detail-under-review.200.json",
    "submission-detail-paid-moderated.200.json",
    "submission-events.200.json",
    "me.200.json",
    "me-missions.200.json",
    "me-submissions.200.json",
    "me-events.200.json",
    "leaderboard-current-season.200.json",
    "leaderboard-all-time.200.json"
  ],
  "errorStatuses": [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]
}
```

- [ ] **Step 6: Add fixture validation**

`tests/jellyhunt-v2-fixtures.test.ts` must load the manifest, validate every JSON file against its OpenAPI response schema, assert that public fixtures contain no keys matching `/convex|wallet|geofence|approvalMode|jellyUserId/i`, and assert that `submission-detail-paid-moderated.200.json` exactly contains `rewarded_removed_from_rankings`, `post_became_ineligible_after_reward`, `canResubmit: false`, and `nextAction: contact_support`.

- [ ] **Step 7: Run contract gates**

Run: `pnpm validate:openapi`

Expected: zero Redocly errors.

Run: `pnpm test:contracts`

Expected: v1 freeze, operation coverage, and every fixture pass.

- [ ] **Step 8: Commit**

```bash
git add openapi tests/contracts tests/jellyhunt-v2-openapi.test.ts tests/jellyhunt-v2-fixtures.test.ts docs/API.md
git commit -m "docs: publish executable JellyHunt v2 contract"
```

### Task 4: Create the Namespaced Convex Schema Module

**Files:**
- Create: `convex/jellyhunt/schema.ts`
- Create: `convex/jellyhunt/validators.ts`
- Create: `convex/jellyhunt/publicIds.ts`
- Modify: `convex/schema.ts`
- Create: `tests/convex/jellyhunt-schema.test.ts`
- Create: `tests/platepost-surface-preservation.test.ts`

**Interfaces:**
- Consumes: Convex `defineTable` and the physical table map in the approved leaderboard design.
- Produces: `jellyhuntTables`, `JELLYHUNT_TABLE_NAMES`, prefixed public ID creation/validation, and a root schema merge point.

- [ ] **Step 1: Write the table inventory test**

```ts
import { describe, expect, it } from "vitest";
import { JELLYHUNT_TABLE_NAMES } from "../../convex/jellyhunt/schema";

const EXPECTED = [
  "jellyhuntProgramConfig",
  "jellyhuntPlaces",
  "jellyhuntCampaigns",
  "jellyhuntMissions",
  "jellyhuntMissionRevisions",
  "jellyhuntParticipations",
  "jellyhuntSubmissions",
  "jellyhuntSubmissionEvents",
  "jellyhuntIdempotencyRecords",
  "jellyhuntRewardBudgets",
  "jellyhuntRewardReservations",
  "jellyhuntRewardIntents",
  "jellyhuntRewardAttempts",
  "jellyhuntWebhookInbox",
  "jellyhuntWebhookEvents",
  "jellyhuntWebhookDeliveries",
  "jellyhuntAuditEvents",
  "jellyhuntPublicProfiles",
  "jellyhuntApprovedCompletions",
  "jellyhuntLeaderboardEntries",
  "jellyhuntLeaderboardEvents",
  "jellyhuntLegacyDedupeRecords",
] as const;

describe("JellyHunt namespaced schema", () => {
  it("uses the complete collision-safe physical table inventory", () => {
    expect(JELLYHUNT_TABLE_NAMES).toEqual(EXPECTED);
    expect(EXPECTED.every((name) => name.startsWith("jellyhunt"))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify the red state**

Run: `pnpm exec vitest run tests/convex/jellyhunt-schema.test.ts`

Expected: FAIL because `convex/jellyhunt/schema.ts` does not exist.

- [ ] **Step 3: Add shared validators and public ID rules**

```ts
import { v } from "convex/values";

export const lifecycle = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);

export const submissionStatus = v.union(
  v.literal("submitted"),
  v.literal("verifying"),
  v.literal("needs_review"),
  v.literal("approved"),
  v.literal("rejected"),
);

export const rewardStatus = v.union(
  v.literal("not_eligible"),
  v.literal("queued"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("uncertain"),
  v.literal("canceled"),
);
```

```ts
const PREFIXES = ["cfg", "plc", "cam", "mis", "mrv", "par", "sub", "evt", "rwd", "cmp", "lbe"] as const;
export type JellyhuntPublicPrefix = (typeof PREFIXES)[number];

export function assertPublicId(prefix: JellyhuntPublicPrefix, value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith(`${prefix}_`) || normalized.length <= prefix.length + 1) {
    throw new Error(`invalid_${prefix}_public_id`);
  }
  return normalized;
}
```

- [ ] **Step 4: Define all twenty-two tables and required indexes**

Implement the exact fields and indexes from the approved schema map. Required unique logical keys are enforced through indexed lookup inside canonical mutations: one current campaign, one active participation per user/mission, global Jelly post/tombstone uniqueness, one approved completion per user/campaign/mission, one entry per scope/user, one reward intent per approved submission, unique attempt number per intent, and unique canonical transaction identity.

- [ ] **Step 5: Merge the schema without overwriting PlatePost**

```ts
import { defineSchema } from "convex/server";
import { jellyhuntTables } from "./jellyhunt/schema";

export default defineSchema({
  ...jellyhuntTables,
});
```

In the canonical PlatePost repository, preserve every existing table literal before the spread. The preservation test reads the captured before/after manifests and fails if a non-JellyHunt table disappears.

- [ ] **Step 6: Run schema tests**

Run: `pnpm exec vitest run tests/convex/jellyhunt-schema.test.ts tests/platepost-surface-preservation.test.ts`

Expected: PASS and no generic `locations`, `missions`, `submissions`, `rewardAttempts`, or `auditEvents` physical table remains in the standalone schema.

- [ ] **Step 7: Commit**

```bash
git add convex/jellyhunt convex/schema.ts tests/convex/jellyhunt-schema.test.ts tests/platepost-surface-preservation.test.ts
git commit -m "feat: add namespaced JellyHunt Convex schema"
```

### Task 5: Add Campaign, Place, Mission, and Revision Mutations

**Files:**
- Create: `convex/jellyhunt/security.ts`
- Create: `convex/jellyhunt/campaigns.ts`
- Create: `convex/jellyhunt/places.ts`
- Create: `convex/jellyhunt/missions.ts`
- Create: `convex/jellyhunt/audit.ts`
- Create: `tests/convex/jellyhunt-campaigns.test.ts`
- Create: `tests/convex/jellyhunt-missions.test.ts`

**Interfaces:**
- Consumes: namespaced schema and `PLATEPOST_CONVEX_SERVICE_KEY` for server/admin-only functions.
- Produces: current campaign query, reviewed place CRUD, draft mission CRUD, immutable publish revisions, lifecycle changes, and catalog revision invalidation.

```ts
export type PublishMissionCommand = {
  missionPublicId: string;
  expectedDraftRevision: number;
  actorId: string;
};

export type CurrentCampaignResult = {
  campaignPublicId: string;
  catalogRevision: number;
  leaderboardRevision: number;
  startsAt: number;
  endsAt: number;
  map: { centerLatitude: number; centerLongitude: number; zoom: number };
  appLinks: { ios: string; android: string; universalStartBase: string };
};
```

- [ ] **Step 1: Write failing transaction tests**

Tests must cover:

- `selects exactly one current campaign under concurrent mutations`
- `rejects a second current campaign without clearing the first atomically`
- `publishes an immutable mission revision and increments catalog revision`
- `editing a published mission creates a new draft and never mutates the published revision`
- `pausing a mission blocks new starts but preserves owner history`
- `requires a reviewed canonical Jelly place before activation`
- `records actor request and before/after state in jellyhuntAuditEvents`

- [ ] **Step 2: Run focused tests**

Run: `pnpm exec vitest run --config vitest.convex.config.ts tests/convex/jellyhunt-campaigns.test.ts tests/convex/jellyhunt-missions.test.ts`

Expected: FAIL because the functions are absent.

- [ ] **Step 3: Implement server authorization**

```ts
export function requireServiceKey(provided: string): void {
  const expected = process.env.PLATEPOST_CONVEX_SERVICE_KEY;
  if (!expected || provided.length !== expected.length) throw new Error("unauthorized");
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  if (mismatch !== 0) throw new Error("unauthorized");
}
```

- [ ] **Step 4: Implement current-campaign selection in one mutation**

The mutation queries the existing `isCurrent` index, clears the prior row when the ID differs, sets the requested campaign current, increments both affected catalog revisions, and appends one audit event. It rejects archived campaigns and overlapping campaign identity changes.

- [ ] **Step 5: Implement publish as immutable snapshot creation**

The mutation validates the expected draft revision, current reward ceiling, place review status, campaign ownership, window, structured requirements, and public IDs. It inserts `jellyhuntMissionRevisions`, updates the mission’s published revision pointer and lifecycle, increments campaign `catalogRevision`, and writes audit/outbox state in the same transaction.

- [ ] **Step 6: Run Convex tests**

Run: `pnpm test:convex`

Expected: all schema, campaign, and mission transaction tests pass.

- [ ] **Step 7: Commit**

```bash
git add convex/jellyhunt tests/convex
git commit -m "feat: add JellyHunt campaign and mission revisions"
```

### Task 6: Generate Bindings and Prove the Shared Merge in Development

**Files:**
- Generate: `convex/_generated/api.d.ts`
- Generate: `convex/_generated/api.js`
- Generate: `convex/_generated/dataModel.d.ts`
- Generate: `convex/_generated/server.d.ts`
- Generate: `convex/_generated/server.js`
- Create: `docs/PLATEPOST_INTEGRATION.md`
- Create: `AGENTS.md`
- Modify: `tsconfig.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: a PlatePost development deployment selected through `CONVEX_DEPLOYMENT`; never a Production deploy key.
- Produces: committed generated references, exact integration status, and machine-readable safety rules for future agents.

- [ ] **Step 1: Record the explicit integration state**

`docs/PLATEPOST_INTEGRATION.md` must record the current standalone repository and commit, mark the canonical PlatePost repository/commit and environment IDs as `not_connected`, explain that this blocks shared deployment but not local implementation, and provide the exact checklist for replacing each `not_connected` value with reviewed evidence.

- [ ] **Step 2: Add agent safety rules**

`AGENTS.md` must prohibit standalone schema deployment over PlatePost, chat-sourced credentials, Production fixture mode, client-supplied Jelly identity/reward/username, broad Supabase balance/audit fencing, and automatic retry of an uncertain transfer.

- [ ] **Step 3: Configure a local or PlatePost development deployment outside this plan file**

The operator sets `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` directly in ignored `.env.local`, or runs `pnpm exec convex dev --configure existing --dev-deployment local` for an isolated local deployment. Do not set `CONVEX_DEPLOY_KEY` for this task.

- [ ] **Step 4: Generate and typecheck once**

Run: `pnpm exec convex dev --once --typecheck enable`

Expected: generated files appear, all Convex modules typecheck, and the command identifies a non-Production deployment.

- [ ] **Step 5: Replace string function references with generated references**

Use `api.jellyhunt.campaigns.getCurrent`, `api.jellyhunt.missions.listPublished`, and internal generated references. Remove `tsconfig.json`’s blanket exclusion of `convex`; keep Next’s build config from bundling server functions while `pnpm typecheck:convex` owns backend typechecking.

- [ ] **Step 6: Run the foundation acceptance gates**

Run: `pnpm test:contracts`

Run: `pnpm test:convex`

Run: `pnpm typecheck:convex`

Run: `pnpm test && pnpm lint && pnpm build`

Expected: every command exits zero; existing v1/map/admin routes remain in the Next build output; generated references contain only namespaced JellyHunt modules for this feature.

- [ ] **Step 7: Commit**

```bash
git add convex/_generated docs/PLATEPOST_INTEGRATION.md AGENTS.md tsconfig.json .env.example
git commit -m "build: connect JellyHunt to development Convex"
```

## Foundation Completion Gate

Do not start Plan 2 until all six tasks are committed, `test:contracts`, `test:convex`, `typecheck:convex`, `test`, `lint`, and `build` are green, v1 fixtures remain unchanged, and `docs/PLATEPOST_INTEGRATION.md` confirms the target is local or development—not Production.

