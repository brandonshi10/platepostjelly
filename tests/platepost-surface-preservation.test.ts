import { describe, expect, it } from "vitest";
import { legacyJellyhuntTables } from "../convex/legacySchema";
import { jellyhuntTables } from "../convex/jellyhunt/schema";

/**
 * Guards the "merge without overwriting PlatePost" rule: the standalone v1
 * routes and Convex functions still use the generic tables. They must coexist
 * with the v2 namespaced tables until those adapters are retired behind the
 * signed cutover watermark. Dropping them makes Convex typechecking and
 * deployment fail even when isolated v2 tests pass.
 *
 * The canonical PlatePost merge must add its own pre-merge table manifest to
 * this same preservation gate before the JellyHunt spreads are applied.
 */
const BEFORE_MIGRATION_MANIFEST = ["locations", "missions", "submissions", "rewardAttempts", "auditEvents"] as const;

function findDisappearedForeignTables(before: readonly string[], after: readonly string[]): string[] {
  const afterSet = new Set(after);
  return before.filter((name) => {
    if (afterSet.has(name)) return false;
    if (name.startsWith("jellyhunt")) return false;
    return true;
  });
}

describe("PlatePost surface preservation across the JellyHunt schema merge", () => {
  it("captures the exact pre-migration standalone manifest", () => {
    expect(BEFORE_MIGRATION_MANIFEST).toEqual(["locations", "missions", "submissions", "rewardAttempts", "auditEvents"]);
  });

  it("flags a real non-JellyHunt table that disappears", () => {
    const before = [...BEFORE_MIGRATION_MANIFEST, "somePlatePostTableThatMustSurvive"];
    const after = Object.keys({ ...legacyJellyhuntTables, ...jellyhuntTables });

    expect(findDisappearedForeignTables(before, after)).toEqual(["somePlatePostTableThatMustSurvive"]);
  });

  it("does not flag a foreign table that survives the merge", () => {
    const before = [...BEFORE_MIGRATION_MANIFEST, "somePlatePostTableThatMustSurvive"];
    const after = [...Object.keys({ ...legacyJellyhuntTables, ...jellyhuntTables }), "somePlatePostTableThatMustSurvive"];

    expect(findDisappearedForeignTables(before, after)).toEqual([]);
  });

  it("preserves every v1 table while the namespaced v2 tables are added", () => {
    const after = Object.keys({ ...legacyJellyhuntTables, ...jellyhuntTables });

    expect(findDisappearedForeignTables(BEFORE_MIGRATION_MANIFEST, after)).toEqual([]);
  });

  it("keeps the exact v1 physical table inventory available to legacy modules", () => {
    const after = new Set(Object.keys(legacyJellyhuntTables));

    for (const legacyName of BEFORE_MIGRATION_MANIFEST) {
      expect(after.has(legacyName)).toBe(true);
    }
  });
});