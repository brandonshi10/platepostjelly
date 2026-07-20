import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sampleMissionsResponse } from "../src/lib/jellyhunt/sample-data";

const source = readFileSync("app/human-social/jellyhunt-explorer.tsx", "utf8");
const styles = readFileSync("app/human-social/jellyhunt.css", "utf8");

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

  it("keeps the fallback map visible until the live map is ready", () => {
    expect(source).toContain("!mapboxActive || !mapLoaded");
    expect(source).toContain("Loading live map…");
    expect(source).toContain('className={`hunt-mapbox${mapLoaded ? " is-loaded" : ""}`}');
    expect(styles).toContain(".hunt-mapbox.is-loaded");
  });

  it("exposes the map, filters, pins, and theme controls to keyboard users", () => {
    expect(source).toContain('href="#jellyhunt-map"');
    expect(source).toContain('id="jellyhunt-map"');
    expect(source).toContain('aria-controls="hunt-filters"');
    expect(source).toContain('id="hunt-filters"');
    expect(source).toContain('aria-pressed={mission.id === selectedMission?.id}');
    expect(source).toContain('type="search"');
    expect(source).toContain('name="missionSearch"');
    expect(source).toContain('role="group"');
    expect(source).toContain('aria-pressed={theme === "dark"}');
  });

  it("restores the original masthead and full-width mission drawer hierarchy", () => {
    expect(source).toContain("hunt-brand-mark");
    expect(source).toContain("PlatePost x JellyJelly: Human Social!");
    expect(source).toContain("<h1>JELLYHUNT</h1>");
    expect(source).toContain("hunt-drawer-handle");
    expect(source).toContain("hunt-detail-grid");
    expect(source).toContain("hunt-detail-venue");
  });

  it("renders live most-approved rankings for the current season and all time", () => {
    expect(source).toContain("/api/v2/jellyhunt/leaderboards/current-season?limit=25");
    expect(source).toContain("/api/v2/jellyhunt/leaderboards/all-time?limit=25");
    expect(source).toContain("Current season");
    expect(source).toContain("All time");
    expect(source).toContain("standing.username");
    expect(source).toContain("standing.approvedMissionCount");
    expect(source).not.toContain("The city leaderboard is getting ready.");
  });
  it("previews the complete 16-mission legacy map in local fixture mode", () => {
    expect(sampleMissionsResponse.missions).toHaveLength(16);
    expect(sampleMissionsResponse.missions.map((mission) => mission.location.name)).toEqual(
      expect.arrayContaining(["Scarr's Pizza", "Comedy Cellar"]),
    );
  });
});
