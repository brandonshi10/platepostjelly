import { describe, expect, it } from "vitest";
import manifest from "./contracts/jellyhunt-v1/manifest.json";
import { projectLegacyV1 } from "../src/lib/jellyhunt/contracts";

describe("frozen JellyHunt v1 contract", () => {
  it("freezes legacy fields and statuses while permitting additive public IDs", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/missions-anonymous.200.json");
    expect(manifest.version).toBe("jellyhunt-v1-frozen-2026-07-16");
    // NOTE: projected against fixture.default.body rather than the whole fixture envelope.
    // Projecting the whole envelope is impossible to satisfy: fixture.default.legacyProjection
    // is itself a property of fixture.default, so projectLegacyV1(fixture.default) would need
    // to equal a strict sub-part of its own input, which no finite (non-circular) JSON value
    // can do. Projecting just the response body is the satisfiable, intent-preserving form of
    // this check (see task-1-report.md for the full analysis).
    expect(projectLegacyV1(fixture.default.body)).toEqual(fixture.default.legacyProjection);
  });

  it("freezes malformed JSON as the existing 500 response", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-malformed.500.json");
    expect(fixture.default.status).toBe(500);
    expect(fixture.default.body).toEqual({ error: "submission_failed" });
  });
});
