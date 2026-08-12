/**
 * A real map for people whose interactive map cannot start.
 *
 * Mapbox GL needs WebGL and a web worker. When either is unavailable — an old
 * device, a locked-down browser, a slow cold load — the page used to fall back
 * to a hand-drawn grid of street names floating in an empty field, which tells
 * a filmer nothing about where to go.
 *
 * The Static Images API is just a PNG: no WebGL, no worker, no JavaScript. This
 * module computes the view that frames a set of venues, builds that image URL,
 * and projects each venue onto the image. The projection has to match Mapbox's
 * own Web Mercator exactly, or the pins sit off the buildings they name.
 */

const TILE_SIZE = 512;
const MAX_STATIC_DIMENSION = 1280; // Mapbox rejects anything larger.

export type MapPoint = { latitude: number; longitude: number };
export type StaticMapView = { latitude: number; longitude: number; zoom: number };

function lonToWorldX(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToWorldY(latitude: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE * 2 ** zoom;
}

function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * 2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * The centre and zoom that fit every point inside width x height, leaving
 * `padding` pixels of breathing room on each edge.
 */
export function fitStaticMapView(
  points: MapPoint[],
  width: number,
  height: number,
  padding = 64,
): StaticMapView {
  if (!points.length) return { latitude: 40.7228, longitude: -73.9881, zoom: 12 };

  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  // Measure the span at zoom 0, then scale: world pixels double per zoom level.
  const spanX = lonToWorldX(maxLon, 0) - lonToWorldX(minLon, 0);
  const spanY = latToWorldY(minLat, 0) - latToWorldY(maxLat, 0);
  const availableX = Math.max(1, width - padding * 2);
  const availableY = Math.max(1, height - padding * 2);

  let zoom = 14;
  if (spanX > 0 || spanY > 0) {
    const zoomX = spanX > 0 ? Math.log2(availableX / spanX) : Infinity;
    const zoomY = spanY > 0 ? Math.log2(availableY / spanY) : Infinity;
    zoom = Math.min(zoomX, zoomY);
  }
  zoom = Math.max(1, Math.min(17, zoom));

  const centreY = (latToWorldY(minLat, zoom) + latToWorldY(maxLat, zoom)) / 2;
  return {
    latitude: worldYToLat(centreY, zoom),
    longitude: (minLon + maxLon) / 2,
    zoom,
  };
}

/** Where a point lands on the image, as a percentage of its width and height. */
export function projectOntoStaticMap(
  point: MapPoint,
  view: StaticMapView,
  width: number,
  height: number,
): { left: number; top: number } {
  const centreX = lonToWorldX(view.longitude, view.zoom);
  const centreY = latToWorldY(view.latitude, view.zoom);
  const x = lonToWorldX(point.longitude, view.zoom) - centreX + width / 2;
  const y = latToWorldY(point.latitude, view.zoom) - centreY + height / 2;
  return { left: (x / width) * 100, top: (y / height) * 100 };
}

/**
 * Attribution and the Mapbox wordmark stay on: the Static Images terms require
 * them, and the interactive map shows them too.
 */
export function staticMapUrl(
  view: StaticMapView,
  width: number,
  height: number,
  token: string,
  style: "dark-v11" | "light-v11" = "dark-v11",
): string {
  const w = Math.max(1, Math.min(MAX_STATIC_DIMENSION, Math.round(width)));
  const h = Math.max(1, Math.min(MAX_STATIC_DIMENSION, Math.round(height)));
  const lon = view.longitude.toFixed(5);
  const lat = view.latitude.toFixed(5);
  const zoom = view.zoom.toFixed(2);
  return (
    `https://api.mapbox.com/styles/v1/mapbox/${style}/static/` +
    `${lon},${lat},${zoom},0/${w}x${h}@2x` +
    `?access_token=${encodeURIComponent(token)}`
  );
}
