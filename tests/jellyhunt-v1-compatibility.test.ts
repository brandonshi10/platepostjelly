import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./contracts/jellyhunt-v1/manifest.json";
import { projectLegacyV1 } from "../src/lib/jellyhunt/contracts";

describe("frozen JellyHunt v1 contract", () => {
  it("freezes legacy fields and statuses while permitting additive public IDs", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/missions-anonymous.200.json");
    expect(manifest.version).toBe("jellyhunt-v1-frozen-2026-07-16");
    expect(projectLegacyV1(fixture.default.body)).toEqual(fixture.default.legacyProjection);
  });

  it("never leaks shotType into the legacy v1 projection", () => {
    const projected = projectLegacyV1({
      apiVersion: "1.0",
      missions: [{ id: "mis_1", title: "Ube Eclair", shotType: "dish" }],
    }) as { missions: Array<Record<string, unknown>> };

    expect(projected.missions[0]).not.toHaveProperty("shotType");
    expect(projected.missions[0].title).toBe("Ube Eclair");
  });

  it("actually applies the legacy projection in the v1 missions route", () => {
    // The projection function passing its unit test proved nothing on its own:
    // for a while nothing called it, and every additive field reached Jelly's
    // frozen payload. shotType landed on each mission object before this was
    // caught by querying the running route. Assert the wiring, not just the
    // helper.
    const route = readFileSync("app/api/v1/jellyhunt/missions/route.ts", "utf8");
    expect(route).toContain("projectLegacyV1");
    expect(route).toMatch(/projectLegacyV1\(\s*await getMissionResponse\(/);
  });

  it("freezes malformed JSON as the existing 500 response", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-malformed.500.json");
    expect(fixture.default.status).toBe(500);
    expect(fixture.default.body).toEqual({
      error: {
        code: "submission_failed",
        message: "The submission could not be completed.",
      },
    });
  });

  it("freezes 409 jelly_post_reused conflict shape", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-conflict-post-reused.409.json");
    expect(fixture.default.status).toBe(409);
    expect(fixture.default.body).toEqual({
      error: {
        code: "jelly_post_reused",
        message: "This Jelly post has already been used for a mission.",
      },
    });
  });

  it("freezes 409 mission_already_submitted conflict shape", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-conflict-already-submitted.409.json");
    expect(fixture.default.status).toBe(409);
    expect(fixture.default.body).toEqual({
      error: {
        code: "mission_already_submitted",
        message: "This user has already submitted this mission.",
      },
    });
  });

  it("freezes 401 unauthorized shape", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-unauthorized.401.json");
    expect(fixture.default.status).toBe(401);
    expect(fixture.default.body.error.code).toBe("unauthorized");
  });

  it("freezes 400 invalid_submission shape", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/submission-invalid.400.json");
    expect(fixture.default.status).toBe(400);
    expect(fixture.default.body.error.code).toBe("invalid_submission");
  });

  it("freezes 503 unavailable shape", async () => {
    const fixture = await import("./contracts/jellyhunt-v1/missions-unavailable.503.json");
    expect(fixture.default.status).toBe(503);
    expect(fixture.default.body.error.code).toBe("convex_not_configured");
  });

  it("permits requestId as an additive key", () => {
    expect(manifest.additiveKeys).toContain("requestId");
    expect(projectLegacyV1({ apiVersion: "1.0", requestId: "req_123" })).toEqual({
      apiVersion: "1.0",
    });
  });
});
