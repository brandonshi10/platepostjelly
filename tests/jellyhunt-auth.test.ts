import { describe, expect, it } from "vitest";
import * as domain from "../src/lib/jellyhunt/domain";

const auth = domain as typeof domain & {
  isValidServerKey: (provided: string | null | undefined, expected: string | null | undefined) => boolean;
};

describe("Jellyhunt server authentication", () => {
  it("fails closed when the server key is not configured", () => {
    expect(auth.isValidServerKey("anything", undefined)).toBe(false);
  });

  it("requires an exact non-empty key match", () => {
    expect(auth.isValidServerKey("jelly-secret", "jelly-secret")).toBe(true);
    expect(auth.isValidServerKey("jelly-secret ", "jelly-secret")).toBe(false);
    expect(auth.isValidServerKey("", "")).toBe(false);
  });
});
