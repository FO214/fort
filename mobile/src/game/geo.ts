/**
 * Geometry. Mirrors backend/app/geo.py.
 *
 * The map is a flat plane in metres, x right and y up. Headings are
 * compass-style: 0 points along +y and angles grow clockwise. A map's
 * rotation is the real compass bearing of its +y axis.
 */
const R = 6_371_008.8;
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

/** Signed smallest difference a - b in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = ((a - b + 180) % 360 + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

export const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Map heading from point 1 to point 2, in [0, 360). */
export function bearingXY(x1: number, y1: number, x2: number, y2: number): number {
  return norm360(deg(Math.atan2(x2 - x1, y2 - y1)));
}

export const distXY = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);

/** Latitude/longitude to map metres around an origin. */
export function toLocal(lat: number, lon: number, originLat: number, originLon: number, rotationDeg = 0): [number, number] {
  const north = rad(lat - originLat) * R;
  const east = rad(lon - originLon) * R * Math.cos(rad(originLat));
  const r = rad(rotationDeg);
  return [east * Math.cos(r) - north * Math.sin(r), east * Math.sin(r) + north * Math.cos(r)];
}

/** Inverse of `toLocal`. */
export function fromLocal(x: number, y: number, originLat: number, originLon: number, rotationDeg = 0): [number, number] {
  const r = rad(rotationDeg);
  const east = x * Math.cos(r) + y * Math.sin(r);
  const north = -x * Math.sin(r) + y * Math.cos(r);
  return [originLat + deg(north / R), originLon + deg(east / (R * Math.cos(rad(originLat))))];
}
