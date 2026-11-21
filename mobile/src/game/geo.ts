/** Mirrors backend/app/geo.py so the reticle predicts what the server will rule. */
const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1), p2 = rad(lat2);
  const dphi = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const x = Math.sin(dl) * Math.cos(p2);
  const y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(x, y)) + 360) % 360;
}

/** Signed smallest difference a - b in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = ((a - b + 180) % 360 + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

export function dynamicGateDeg(cone: number, accS: number, accT: number, dist: number, cap = 40): number {
  const slop = deg(Math.atan2(Math.max(accS, 0) + Math.max(accT, 0), Math.max(dist, 1)));
  return Math.min(cone + slop, Math.max(cap, cone));
}

export function offsetM(lat: number, lon: number, northM: number, eastM: number): [number, number] {
  return [lat + deg(northM / R), lon + deg(eastM / (R * Math.cos(rad(lat))))];
}
