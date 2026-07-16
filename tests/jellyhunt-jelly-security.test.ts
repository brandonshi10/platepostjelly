import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type JellySafetyModule = {
  evaluatePartnerLocationProof: (input: {
    outcome: "verified" | "needs_review" | "rejected";
    coordinates?: { latitude: number; longitude: number };
    suppliedDistanceMeters?: number;
    location: {
      latitude: number;
      longitude: number;
      geofenceRadiusMeters: number;
    };
  }) => { outcome: "verified" | "needs_review" | "rejected"; distanceMeters?: number; reason?: string };
  requireCredentialedEndpoint: (input: string, environment: string) => string;
};

async function loadJellySafety(): Promise<Partial<JellySafetyModule>> {
  try {
    return (await import("../convex/jelly-security")) as JellySafetyModule;
  } catch {
    return {};
  }
}

describe("Jelly partner security guards", () => {
  it("fails verified proof closed when trusted location evidence is incomplete", async () => {
    const safety = await loadJellySafety();
    expect(safety.evaluatePartnerLocationProof).toBeTypeOf("function");

    const withoutCoordinates = safety.evaluatePartnerLocationProof!({
      outcome: "verified",
      suppliedDistanceMeters: 10,
      location: { latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75 },
    });
    const withoutDistance = safety.evaluatePartnerLocationProof!({
      outcome: "verified",
      coordinates: { latitude: 40.7164, longitude: -73.9915 },
      location: { latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75 },
    });

    expect(withoutCoordinates.outcome).toBe("needs_review");
    expect(withoutDistance.outcome).toBe("needs_review");
  });

  it("rejects negative or coordinate-inconsistent partner distances", async () => {
    const safety = await loadJellySafety();
    expect(safety.evaluatePartnerLocationProof).toBeTypeOf("function");

    const location = { latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75 };
    const coordinates = { latitude: 40.7164, longitude: -73.9915 };

    expect(safety.evaluatePartnerLocationProof!({
      outcome: "verified",
      coordinates,
      suppliedDistanceMeters: -1,
      location,
    }).outcome).toBe("needs_review");

    expect(safety.evaluatePartnerLocationProof!({
      outcome: "verified",
      coordinates,
      suppliedDistanceMeters: 2_000,
      location,
    }).outcome).toBe("needs_review");
  });

  it("uses calculated trusted distance to enforce the geofence", async () => {
    const safety = await loadJellySafety();
    expect(safety.evaluatePartnerLocationProof).toBeTypeOf("function");

    const result = safety.evaluatePartnerLocationProof!({
      outcome: "verified",
      coordinates: { latitude: 40.7263, longitude: -73.9914 },
      suppliedDistanceMeters: 1_112,
      location: { latitude: 40.7163, longitude: -73.9914, geofenceRadiusMeters: 75 },
    });

    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("outside_geofence");
    expect(result.distanceMeters).toBeGreaterThan(1_000);
  });

  it("requires HTTPS for credential-bearing production endpoints", async () => {
    const safety = await loadJellySafety();
    expect(safety.requireCredentialedEndpoint).toBeTypeOf("function");

    expect(safety.requireCredentialedEndpoint!("https://partner.example/verify", "production"))
      .toBe("https://partner.example/verify");
    expect(() => safety.requireCredentialedEndpoint!("http://partner.example/verify", "production"))
      .toThrow(/HTTPS/);
    expect(() => safety.requireCredentialedEndpoint!("file:///tmp/token", "development"))
      .toThrow(/HTTP/);
  });

  it("does not persist arbitrary payout response bodies", () => {
    const source = readFileSync("convex/jelly.ts", "utf8");
    expect(source).not.toContain("responseText.slice");
    expect(source).not.toMatch(/responseJson\s*:/);
  });
});
