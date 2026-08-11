import { describe, expect, it } from "vitest";
import {
  fitStaticMapView,
  projectOntoStaticMap,
  staticMapUrl,
} from "../src/lib/jellyhunt/static-map";

// Real published venues, corner to corner across the pilot cohort.
const SCARRS = { latitude: 40.715786, longitude: -73.991625 };
const AMOR_LOCO = { latitude: 40.757913, longitude: -73.98389 };
const SHUKA = { latitude: 40.727059, longitude: -74.002781 };

describe("static map view", () => {
  it("frames every venue inside the image", () => {
    const w = 1200;
    const h = 800;
    const view = fitStaticMapView([SCARRS, AMOR_LOCO, SHUKA], w, h, 64);

    for (const point of [SCARRS, AMOR_LOCO, SHUKA]) {
      const { left, top } = projectOntoStaticMap(point, view, w, h);
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThan(100);
      expect(top).toBeGreaterThan(0);
      expect(top).toBeLessThan(100);
    }
  });

  it("respects the padding it is given", () => {
    const w = 1000;
    const h = 1000;
    const padding = 100;
    const view = fitStaticMapView([SCARRS, AMOR_LOCO, SHUKA], w, h, padding);
    const positions = [SCARRS, AMOR_LOCO, SHUKA].map((p) =>
      projectOntoStaticMap(p, view, w, h),
    );
    // Nothing should sit inside the padded margin.
    const marginPct = (padding / w) * 100;
    for (const { left, top } of positions) {
      expect(left).toBeGreaterThanOrEqual(marginPct - 0.01);
      expect(left).toBeLessThanOrEqual(100 - marginPct + 0.01);
      expect(top).toBeGreaterThanOrEqual(marginPct - 0.01);
      expect(top).toBeLessThanOrEqual(100 - marginPct + 0.01);
    }
  });

  it("puts the view centre at the centre of the image", () => {
    const w = 900;
    const h = 600;
    const view = fitStaticMapView([SCARRS, AMOR_LOCO], w, h);
    const centre = projectOntoStaticMap(
      { latitude: view.latitude, longitude: view.longitude },
      view,
      w,
      h,
    );
    expect(centre.left).toBeCloseTo(50, 6);
    expect(centre.top).toBeCloseTo(50, 6);
  });

  it("puts north above south and east right of west", () => {
    const w = 1000;
    const h = 1000;
    const view = fitStaticMapView([SCARRS, AMOR_LOCO, SHUKA], w, h);
    const north = projectOntoStaticMap(AMOR_LOCO, view, w, h);
    const south = projectOntoStaticMap(SCARRS, view, w, h);
    const west = projectOntoStaticMap(SHUKA, view, w, h);
    expect(north.top).toBeLessThan(south.top);
    expect(west.left).toBeLessThan(south.left);
  });

  it("falls back to a sane view with no venues", () => {
    const view = fitStaticMapView([], 800, 600);
    expect(view.latitude).toBeCloseTo(40.7228, 3);
    expect(view.zoom).toBeGreaterThan(0);
  });

  it("handles a single venue without dividing by zero", () => {
    const view = fitStaticMapView([SCARRS], 800, 600);
    expect(Number.isFinite(view.zoom)).toBe(true);
    expect(view.zoom).toBeLessThanOrEqual(17);
    const { left, top } = projectOntoStaticMap(SCARRS, view, 800, 600);
    expect(left).toBeCloseTo(50, 4);
    expect(top).toBeCloseTo(50, 4);
  });

  it("builds a URL Mapbox will accept and keeps attribution on", () => {
    const view = { latitude: 40.72, longitude: -73.99, zoom: 12.3456 };
    const url = staticMapUrl(view, 4000, 3000, "pk.test-token");
    expect(url).toContain("/styles/v1/mapbox/dark-v11/static/");
    expect(url).toContain("-73.99000,40.72000,12.35,0/");
    // Clamped to Mapbox's 1280px ceiling, aspect preserved by the caller.
    expect(url).toContain("/1280x1280@2x");
    expect(url).toContain("access_token=pk.test-token");
    expect(url).not.toContain("logo=false");
    expect(url).not.toContain("attribution=false");
  });

  it("uses the light style for the Wobbles theme", () => {
    const url = staticMapUrl({ latitude: 40.72, longitude: -73.99, zoom: 12 }, 100, 100, "t", "light-v11");
    expect(url).toContain("/styles/v1/mapbox/light-v11/static/");
  });
});
