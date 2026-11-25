/**
 * Where this phone is on the map, from AR world tracking (ARKit / ARCore).
 *
 * AR tracking follows the phone to a few centimetres from the camera and the
 * motion sensors, with no GPS. What it cannot know is where its own frame
 * sits on the map: it starts wherever the session started. A printed marker
 * hung at a known spot (a map `anchor`) settles that. Seeing one gives its
 * position and facing in the AR frame; the map says where it really is; the
 * difference is a turn and a shift that carry every later camera pose onto
 * the map. Seeing a marker again (or another one) corrects any drift.
 *
 * The native module only hands over raw 4x4 matrices, so all of this is
 * plain maths, tested without a phone. Conventions (both ARKit and ARCore):
 *   - column-major, 16 numbers: m[12], m[13], m[14] is the position;
 *   - world: right-handed, metres, +y up (gravity-aligned);
 *   - camera: looks down its own -z, +x to the right of the sensor image;
 *   - image anchor: the image lies in its x-z plane, +y out of its face,
 *     +z towards the image's bottom edge.
 * The AR floor is (u, v) = (x, -z), so a heading there reads like a map
 * heading: 0 along +v, clockwise.
 *
 * Pure logic with an injected clock (seconds), like position.ts.
 */
import type { MapAnchor } from '../net/types';
import { angleDiffDeg, deg, norm360, rad } from './geo';

export type Mat4 = readonly number[];
export type ArState = 'normal' | 'limited' | 'none';

/** The camera on the AR floor. */
export interface ArCamera {
  u: number; v: number;
  /** Floor heading the camera looks along (0 = +v, clockwise). */
  heading: number;
  /** Degrees above level. */
  pitch: number;
  /** Degrees the view is turned about its line of sight, positive with the screen's right side raised. */
  roll: number;
}

/** A marker as the phone saw it, on the AR floor. */
export interface ArMarker { u: number; v: number; facing: number }

/** AR floor to map: turn by `theta` (degrees clockwise), then shift by (tx, ty). */
export interface Align { theta: number; tx: number; ty: number }

export interface ArMapPose { x: number; y: number; heading: number; pitch: number; roll: number; acc: number }

/** Tilted further than this the gun is pointed at the floor or the ceiling: no heading, no roll to speak of. */
const STEEP = 0.94;                 // sin(70°)
/** As orientation.ts: further over than this is a phone being put away. */
const MAX_ROLL_DEG = 35;
/** No frame for this long and the AR pose is not believed: fall back to GPS. */
export const AR_STALE_S = 1;
/** A correction from a new marker sighting is eased out over about this long. */
const REANCHOR_EASE_S = 0.4;
/** 1-sigma position error reported to the server, by tracking quality. */
const ACC_M: Record<ArState, number> = { normal: 0.3, limited: 1, none: 5 };

const heading = (du: number, dv: number) => norm360(deg(Math.atan2(du, dv)));

/** The camera's place, heading, pitch and roll. `lastHeading` is kept when it points straight up or down. */
export function cameraFromMatrix(m: Mat4, lastHeading = 0): ArCamera {
  // Forward is -z; on the floor that is (u, v) = (-m8, m10).
  const fu = -m[8], fy = -m[9], fv = m[10];
  const flat = Math.hypot(fu, fv);
  const pitch = deg(Math.asin(Math.max(-1, Math.min(1, fy))));
  let roll = 0;
  if (Math.abs(fy) < STEEP) {
    // Screen right and up are the camera's x and y, or both reversed in the other landscape grip.
    const ry = m[1], uy = m[5];
    roll = uy >= 0 ? deg(Math.atan2(ry, uy)) : deg(Math.atan2(-ry, -uy));
    roll = Math.max(-MAX_ROLL_DEG, Math.min(MAX_ROLL_DEG, roll));
  }
  return { u: m[12], v: -m[14], heading: flat > 1 - STEEP ? heading(fu, fv) : lastHeading, pitch, roll };
}

/**
 * A marker's place and facing. On a wall its facing is the way its face
 * points; flat on the floor or a table it is the way its top edge points.
 */
export function markerFromMatrix(m: Mat4): ArMarker {
  const nu = m[4], nv = -m[6];                      // +y, out of the face
  const facing = Math.hypot(nu, nv) >= 0.5 ? heading(nu, nv) : heading(-m[8], m[10]);   // else the top edge, -z
  return { u: m[12], v: -m[14], facing };
}

/** The turn and shift that put `seen` exactly on `anchor`. */
export function alignFromMarker(seen: ArMarker, anchor: Pick<MapAnchor, 'x' | 'y' | 'facing'>): Align {
  const theta = norm360(anchor.facing - seen.facing);
  const [rx, ry] = turn(theta, seen.u, seen.v);
  return { theta, tx: anchor.x - rx, ty: anchor.y - ry };
}

/** An AR floor point on the map. */
export function toMap(a: Align, u: number, v: number): [number, number] {
  const [x, y] = turn(a.theta, u, v);
  return [x + a.tx, y + a.ty];
}

/** Turn a floor vector clockwise by `theta` degrees (compass-style). */
function turn(theta: number, u: number, v: number): [number, number] {
  const c = Math.cos(rad(theta)), s = Math.sin(rad(theta));
  return [u * c + v * s, -u * s + v * c];
}

// ------------------------------------------------------------------ matrices (tests, simulator)

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mat = (x: V3, y: V3, z: V3, p: V3): number[] => [...x, 0, ...y, 0, ...z, 0, ...p, 1];
const floorDir = (h: number): V3 => [Math.sin(rad(h)), 0, -Math.cos(rad(h))];     // a floor heading, in x y z

/** The matrix AR tracking would report for a camera there. `flip`: held the other landscape way round. */
export function cameraMatrix(u: number, v: number, headingDeg: number, pitchDeg = 0, rollDeg = 0,
  opts: { height?: number; flip?: boolean } = {}): number[] {
  const h = rad(headingDeg), p = rad(pitchDeg);
  const fwd: V3 = [Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p)];
  const back: V3 = [-fwd[0], -fwd[1], -fwd[2]];
  let right = floorDir(headingDeg + 90);
  let up = cross(back, right);
  // Raising the right side turns right towards up.
  const c = Math.cos(rad(rollDeg)), s = Math.sin(rad(rollDeg));
  [right, up] = [right.map((r, i) => r * c + up[i] * s) as V3, up.map((q, i) => q * c - right[i] * s) as V3];
  if (opts.flip) { right = right.map((r) => -r) as V3; up = up.map((q) => -q) as V3; }
  return mat(right, up, back, [u, opts.height ?? 1.4, -v]);
}

/** The matrix AR image detection would report for a marker hung on a wall there, its face towards `facing`. */
export function markerMatrix(u: number, v: number, facing: number, height = 1.5): number[] {
  const out = floorDir(facing);
  const right = floorDir(facing - 90);              // the image's right, seen from the front
  return mat(right, out, cross(right, out), [u, height, -v]);
}

// ------------------------------------------------------------------ the tracker

export class ArTracker {
  private anchors = new Map<string, MapAnchor>();
  private align: Align | null = null;
  /** The last marker seen, so a new map (lobby to mission) can be anchored without looking again. */
  private sighting: { id: string; seen: ArMarker } | null = null;
  private cam: ArCamera | null = null;
  private state: ArState = 'none';
  private frameT = -Infinity;
  // What is left of the last re-anchoring jump, and when it was taken.
  private lagX = 0; private lagY = 0; private lagH = 0; private lagT = 0;

  /** The map's markers. Keeps the alignment if the marker last seen is still on the map. */
  setAnchors(anchors: readonly MapAnchor[]): void {
    this.anchors = new Map(anchors.map((a) => [a.id, a]));
    const a = this.sighting && this.anchors.get(this.sighting.id);
    this.align = a && this.sighting ? alignFromMarker(this.sighting.seen, a) : null;
    this.lagX = this.lagY = this.lagH = 0;
  }

  /** The AR session started over: its frame is a new one, and nothing seen before holds. */
  onReset(): void {
    this.align = null; this.sighting = null; this.cam = null; this.state = 'none'; this.frameT = -Infinity;
    this.lagX = this.lagY = this.lagH = 0;
  }

  onFrame(m: Mat4, state: ArState, t: number): void {
    this.cam = cameraFromMatrix(m, this.cam?.heading);
    this.state = state;
    this.frameT = t;
  }

  /** A marker was seen. False if it is not one of this map's. */
  onMarker(id: string, m: Mat4, t: number): boolean {
    const anchor = this.anchors.get(id);
    if (!anchor) return false;
    const seen = markerFromMatrix(m);
    const next = alignFromMarker(seen, anchor);
    if (this.align && this.cam) {
      // Already on the map: slide to the corrected place rather than jump.
      const before = this.place(this.align, this.cam), after = this.place(next, this.cam);
      const k = this.lagLeft(t);
      this.lagX = this.lagX * k + before.x - after.x;
      this.lagY = this.lagY * k + before.y - after.y;
      this.lagH = this.lagH * k + angleDiffDeg(before.heading, after.heading);
      this.lagT = t;
    }
    this.align = next;
    this.sighting = { id, seen };
    return true;
  }

  get anchored(): boolean { return this.align != null; }

  /** The camera on the map, or null when AR cannot say (not anchored, lost, or gone quiet). */
  pose(t: number): ArMapPose | null {
    if (!this.align || !this.cam || this.state === 'none' || t - this.frameT > AR_STALE_S) return null;
    const p = this.place(this.align, this.cam);
    const k = this.lagLeft(t);
    return {
      x: p.x + this.lagX * k, y: p.y + this.lagY * k, heading: norm360(p.heading + this.lagH * k),
      pitch: this.cam.pitch, roll: this.cam.roll, acc: ACC_M[this.state],
    };
  }

  private place(a: Align, c: ArCamera): { x: number; y: number; heading: number } {
    const [x, y] = toMap(a, c.u, c.v);
    return { x, y, heading: norm360(c.heading + a.theta) };
  }

  private lagLeft(t: number): number { return Math.exp(-Math.max(0, t - this.lagT) / REANCHOR_EASE_S); }
}
