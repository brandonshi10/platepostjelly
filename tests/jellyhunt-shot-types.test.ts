import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHOT_TYPES,
  SHOT_TYPE_SPECS,
  isShotType,
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

  it("keeps the Convex copy of the shot-type rules in step with this module", () => {
    // convex/ cannot import from src/, so the instructions and durations are
    // duplicated there. Duplication without a test is how the two drift.
    const source = readFileSync("convex/jellyhunt/admin.ts", "utf8");
    for (const id of SHOT_TYPES) {
      const spec = SHOT_TYPE_SPECS[id];
      expect(source).toContain(spec.instruction);
      expect(source).toMatch(
        new RegExp(`${id}:[\\s\\S]{0,320}?minDurationSeconds:\\s*${spec.minDurationSeconds}`),
      );
      expect(source).toMatch(
        new RegExp(`${id}:[\\s\\S]{0,320}?maxDurationSeconds:\\s*${spec.maxDurationSeconds}`),
      );
    }
  });

  it("narrows unknown values", () => {
    expect(isShotType("dish")).toBe(true);
    expect(isShotType("Dish")).toBe(false);
    expect(isShotType(undefined)).toBe(false);
    expect(isShotType(7)).toBe(false);
  });
});
