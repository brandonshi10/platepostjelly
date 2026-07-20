import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleMissionsResponse } from "../src/lib/jellyhunt/sample-data";

const source = readFileSync("app/human-social/jellyhunt-explorer.tsx", "utf8");

describe("consumer map UI safety", () => {
  it("renders admin-managed marker content as text, never HTML", () => {
    expect(source).not.toContain(".innerHTML");
    expect(source).toContain("entry.label.textContent");
    expect(source).toContain("mission.emoji");
  });

  it("preserves an intentional closed detail card", () => {
    expect(source).not.toContain("if (!selectedId && filteredMissions[0])");
    expect(source).toContain("if (selectedId && !filteredMissions.some");
  });

  it("does not advertise a loading Mapbox instance with no missions", () => {
    expect(source).toMatch(/mapboxActive\s*=\s*Boolean\(mapboxToken\)[\s\S]*missions\.length/);
  });

  it("uses the original Jellyhunt full-screen map hierarchy", () => {
    expect(source).toContain("hunt-map-screen");
    expect(source).toContain("hunt-map-header");
    expect(source).toContain("hunt-zoom-controls");
    expect(source).toContain("hunt-theme-toggle");
    expect(source).toContain("hunt-menu-panel");
    expect(source).toContain("JELLYHUNT");
    expect(source).toContain("PlatePost × JellyJelly");
    expect(source).toContain("/wobbles/wobble_product.png");
    expect(source).toContain("hunt-mapbox-hq");
    expect(source).toContain("hunt-filter-results");
    expect(source).toContain('role="dialog"');
    expect(source).toContain("data-selected");
    expect(source).not.toContain("hunt-sidebar");
  });

  it("previews the complete 16-mission legacy map in local fixture mode", () => {
    expect(sampleMissionsResponse.missions).toHaveLength(16);
    expect(sampleMissionsResponse.missions.map((mission) => mission.location.name)).toEqual(
      expect.arrayContaining(["Scarr's Pizza", "Comedy Cellar"]),
    );
  });
});
