import { convexTest } from "convex-test";
import schema from "../../../convex/schema";

/**
 * Hand-built `convex-test` module map.
 *
 * This repository has not run Convex codegen yet (no `convex/_generated/`),
 * so `convex-test`'s default module discovery (which looks for a
 * `_generated` directory to find the real function-file prefix) cannot
 * resolve real function references such as `anyApi.jellyhunt.campaigns.*`
 * out of the box. `convexTest(schema, modules)` accepts an explicit module
 * map instead; the keys here only need to share one consistent prefix with
 * a synthetic `_generated` marker entry (`convex-test` uses that marker to
 * work out the prefix), they do not need to mirror real filesystem paths.
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
};

export function createJellyhuntTestConvex() {
  return convexTest(schema, modules);
}

export const TEST_SERVICE_KEY = "test-only-service-key-9f3c2b1a";
