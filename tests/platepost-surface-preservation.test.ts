import { describe, expect, it } from "vitest";
import { jellyhuntTables } from "../convex/jellyhunt/schema";

/**
 * Guards the "merge without overwriting PlatePost" rule from Task 4 of the
 * JellyHunt Convex foundation plan: spreading `jellyhuntTables` into a root
 * Convex schema must never make a pre-existing, non-JellyHunt table
 * disappear.
 *
 * This standalone repository's own pre-migration `convex/schema.ts` only
 * ever defined the generic tables this task intentionally replaces with
 * namespaced `jellyhunt*` equivalents (see `convex/jellyhunt/schema.ts`), so
 * there is no real foreign PlatePost table to preserve here yet. What this
 * test proves instead is the *mechanism*: given a "before" table-name
 * manifest and an "after" table-name manifest, `findDisappearedForeignTables`
 * correctly flags any table that vanished and is neither namespaced
 * `jellyhunt*` nor on the explicit, reviewed legacy-replacement allowlist.
 *
 * IMPORTANT for the canonical PlatePost repository: `LEGACY_REPLACED_TABLES`
 * below is specific to *this* standalone repo's own pre-namespacing generic
 * JellyHunt tables. Before this preservation test is reused there, the
 * "before" manifest MUST be recaptured from PlatePost's real, current
 * `convex/schema.ts` (their actual production table set — users, orders, or
 * whatever else PlatePost already owns), and `LEGACY_REPLACED_TABLES` must
 * NOT be used to wave away the disappearance of any genuine PlatePost table.
 * Only this repo's own generic JellyHunt tables belong on that allowlist.
 */

/** The table names this standalone repo's schema.ts defined before Task 4 namespaced them. */
const BEFORE_MIGRATION_MANIFEST = ["locations", "missions", "submissions", "rewardAttempts", "auditEvents"] as const;

/**
 * Generic standalone tables intentionally retired by this task in favor of
 * their namespaced `jellyhunt*` equivalents. Recapture/replace this list
 * (do not simply reuse it) when adapting this test for the canonical
 * PlatePost repository.
 */
const LEGACY_REPLACED_TABLES = new Set<string>(BEFORE_MIGRATION_MANIFEST);

function findDisappearedForeignTables(before: readonly string[], after: readonly string[]): string[] {
  const afterSet = new Set(after);
  return before.filter((name) => {
    if (afterSet.has(name)) return false; // still present, nothing to flag
    if (name.startsWith("jellyhunt")) return false; // renamed into the namespace, not "disappeared"
    if (LEGACY_REPLACED_TABLES.has(name)) return false; // reviewed, intentional retirement
    return true; // a non-JellyHunt table vanished with no reviewed explanation
  });
}

describe("PlatePost surface preservation across the JellyHunt schema merge", () => {
  it("captures the exact pre-migration standalone manifest this task retires", () => {
    expect(BEFORE_MIGRATION_MANIFEST).toEqual(["locations", "missions", "submissions", "rewardAttempts", "auditEvents"]);
  });

  it("flags a real non-JellyHunt table that disappears without a reviewed explanation", () => {
    const before = [...BEFORE_MIGRATION_MANIFEST, "somePlatePostTableThatMustSurvive"];
    const after = Object.keys(jellyhuntTables); // simulates the merged root schema losing that foreign table

    const disappeared = findDisappearedForeignTables(before, after);

    expect(disappeared).toEqual(["somePlatePostTableThatMustSurvive"]);
  });

  it("does not flag a foreign table that survives the merge", () => {
    const before = [...BEFORE_MIGRATION_MANIFEST, "somePlatePostTableThatMustSurvive"];
    const after = [...Object.keys(jellyhuntTables), "somePlatePostTableThatMustSurvive"];

    expect(findDisappearedForeignTables(before, after)).toEqual([]);
  });

  it("finds no unreviewed disappearance in this repo's actual before/after schema manifests", () => {
    const after = Object.keys(jellyhuntTables);

    const disappeared = findDisappearedForeignTables(BEFORE_MIGRATION_MANIFEST, after);

    expect(disappeared).toEqual([]);
  });

  it("confirms the standalone schema no longer defines any generic pre-namespacing physical table", () => {
    const after = new Set(Object.keys(jellyhuntTables));

    for (const legacyName of BEFORE_MIGRATION_MANIFEST) {
      expect(after.has(legacyName)).toBe(false);
    }
  });
});
