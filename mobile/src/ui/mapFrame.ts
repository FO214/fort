/**
 * Where the full-screen map puts the floor: map metres to pixels and back.
 * MapView draws with `to`; a tap on the map comes back through `from`.
 *
 * Pure maths, no React, so tests can work out where to tap.
 */
import type { MapInfo } from '../net/types';

export interface Extent { minX: number; maxX: number; minY: number; maxY: number }

/** Everything a full map draws, so all of it fits. */
export function mapExtent(map: Pick<MapInfo, 'outline' | 'walls' | 'paths' | 'helicopter' | 'start'>): Extent {
  const pts: [number, number][] = [...(map.outline ?? []), ...(map.walls ?? []).flatMap((w) => [[w[0], w[1]], [w[2], w[3]]] as [number, number][]),
    ...(map.paths ?? []).flat(), [map.helicopter.x, map.helicopter.y], map.start];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, maxX, minY, maxY };
}

export const FULL_MAP_PAD = 22;

export interface Fit {
  /** Pixels per metre. */
  s: number; ox: number; oy: number;
  to: (x: number, y: number) => [number, number];
  from: (px: number, py: number) => [number, number];
  /** The same mapping as an SVG matrix, for drawing shapes in metres. */
  matrix: string;
}

/** The floor fitted to a width × height box, north up, centred. */
export function fitFull(e: Extent, width: number, height: number, pad = FULL_MAP_PAD): Fit {
  const s = Math.min((width - pad * 2) / Math.max(e.maxX - e.minX, 1), (height - pad * 2) / Math.max(e.maxY - e.minY, 1));
  const ox = (width - (e.maxX - e.minX) * s) / 2, oy = (height - (e.maxY - e.minY) * s) / 2;
  return {
    s, ox, oy,
    to: (x, y) => [ox + (x - e.minX) * s, oy + (e.maxY - y) * s],
    from: (px, py) => [e.minX + (px - ox) / s, e.maxY - (py - oy) / s],
    matrix: `matrix(${s} 0 0 ${-s} ${ox - e.minX * s} ${oy + e.maxY * s})`,
  };
}
