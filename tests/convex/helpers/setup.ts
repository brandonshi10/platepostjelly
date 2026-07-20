import { convexTest } from "convex-test";
import schema from "../../../convex/schema";

/**
 * Hand-built `convex-test` module map.
 *
 * Real Convex codegen has now run in this repository
 * (`convex/_generated/` exists and is committed), but two things still
 * keep the tests in this directory on `anyApi.jellyhunt.*` (from
 * `convex/server`) instead of the real generated `api`/`internal` objects:
 *
 * 1. `convex-test`'s *default* module discovery does not work here either
 *    way: `convexTest(schema)` (no second argument) falls back to
 *    `import.meta.glob("../../../convex/**\/*.*s")` resolved relative to
 *    `convex-test`'s own installed location inside `node_modules`, not to
 *    this project's `convex/` directory, so it can never find this
 *    project's function files. `convexTest(schema, modules)` accepts an
 *    explicit module map instead, which is what this file builds.
 * 2. `convex/_generated/api.d.ts` type-references *every* top-level Convex
 *    module, including the pre-namespacing `convex/audit.ts`,
 *    `convex/missions.ts`, and `convex/submissions.ts` files, which still
 *    query/insert against generic table names `convex/schema.ts` retired
 *    in favor of the namespaced `jellyhunt*` tables. Importing the typed
 *    `api` object anywhere reachable by the root `tsconfig.json` (this
 *    `tests/` directory included) pulls those broken files into the same
 *    TypeScript program and fails `pnpm build`. See
 *    `docs/PLATEPOST_INTEGRATION.md` ("Known gap surfaced by turning on
 *    real typecheck") for the full explanation and why fixing those three
 *    files is out of this task's scope. `anyApi` sidesteps that: it is
 *    untyped, so it never triggers that type-checking chain, while still
 *    resolving to the exact same real functions at runtime through the
 *    module map below.
 *
 * The module map's keys only need to share one consistent prefix with a
 * synthetic `_generated` marker entry (`convex-test` uses that marker to
 * work out the prefix); they do not need to mirror real filesystem paths.
 * Only Convex function *modules* that are the direct target of an
 * `anyApi.*` reference need an entry — files they import normally (e.g.
 * `./security`, `./audit`, `./publicIds`, `./validators`) resolve through
 * ordinary ES module imports once their parent module loads.
 */
const modules: Record<string, () => Promise<unknown>> = {
  "convex/_generated/server.js": () => Promise.resolve({}),
  "convex/jellyhunt/campaigns.ts": () => import("../../../convex/jellyhunt/campaigns"),
  "convex/jellyhunt/places.ts": () => import("../../../convex/jellyhunt/places"),
  "convex/jellyhunt/missions.ts": () => import("../../../convex/jellyhunt/missions"),
  "convex/jellyhunt/audit.ts": () => import("../../../convex/jellyhunt/audit"),
  "convex/jellyhunt/approvals.ts": () => import("../../../convex/jellyhunt/approvals"),
  "convex/jellyhunt/leaderboards.ts": () => import("../../../convex/jellyhunt/leaderboards"),
  "convex/jellyhunt/rewards.ts": () => import("../../../convex/jellyhunt/rewards"),
  "convex/jellyhunt/webhooks.ts": () => import("../../../convex/jellyhunt/webhooks"),
  "convex/jellyhunt/participations.ts": () => import("../../../convex/jellyhunt/participations"),
  "convex/jellyhunt/events.ts": () => import("../../../convex/jellyhunt/events"),
  "convex/jellyhunt/profiles.ts": () => import("../../../convex/jellyhunt/profiles"),
  "convex/jellyhunt/verification.ts": () => import("../../../convex/jellyhunt/verification"),
  "convex/jellyhunt/idempotency.ts": () => import("../../../convex/jellyhunt/idempotency"),
  "convex/jellyhunt/submissions.ts": () => import("../../../convex/jellyhunt/submissions"),
  "convex/jellyhunt/budgets.ts": () => import("../../../convex/jellyhunt/budgets"),
  "convex/jellyhunt/ownerReads.ts": () => import("../../../convex/jellyhunt/ownerReads"),
};

export function createJellyhuntTestConvex() {
  return convexTest(schema, modules);
}

export const TEST_SERVICE_KEY = "test-only-service-key-9f3c2b1a";
