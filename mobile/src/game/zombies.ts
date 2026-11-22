/**
 * Zombies as this phone sees them.
 *
 * The server sends positions ten times a second. Drawing them straight would
 * stutter, so snapshots are buffered and the phone draws the world as it was
 * ~100 ms ago, sliding each zombie between the two snapshots either side of
 * that moment.
 *
 * The same numbers place a zombie on screen and decide whether the crosshair
 * is on it, so what you see is what you can hit.
 *
 * Pure logic: no React, no sensors.
 */
import { Z_CHASE, type GunClass, type ZombieRow } from '../net/types';
import { angleDiffDeg, bearingXY, deg, norm360, rad } from './geo';

export const INTERP_DELAY_S = 0.1;
export const EYE_M = 1.4;                 // height the gun is held at
export const ZOMBIE_HEIGHT_M = 1.8;
export const ZOMBIE_HALF_WIDTH_M = 0.35;
export const CAMERA_HFOV_DEG = 66;        // phone main camera, landscape, filling the screen
const AIM_VERTICAL_PAD_DEG = 4;
/** How long a shot zombie takes to fall and fade. */
export const DEATH_FX_S = 0.75;
/** A zombie has to move this far between snapshots for its heading to be believed. */
const MOVED_M = 0.04;
const KEEP_SNAPSHOTS = 8;

export interface ZView {
  id: number; type: number; x: number; y: number; hp: number; maxHp: number; state: number;
  target: string | null;
  /** Seconds since this phone first saw it (for fading in). */
  age: number;
  /** Seconds since it was last shot (for the hit flash), Infinity if never. */
  hitAge: number;
  /** Map heading it is walking along, for drawing it from the right side. Null until it has been seen to move. */
  heading: number | null;
}

export interface Corpse {
  id: number; type: number; x: number; y: number;
  /** How far through dying it is, 0 to 1. */
  age: number;
  /** The way it was facing when it was shot. */
  heading: number | null;
}

interface Snap { t: number; rows: Map<number, ZombieRow> }

export class ZombieBuffer {
  private snaps: Snap[] = [];
  private maxHp = new Map<number, number>();
  private firstSeen = new Map<number, number>();
  private hitAt = new Map<number, number>();
  private heading = new Map<number, number>();
  private corpses: { id: number; type: number; x: number; y: number; at: number; heading: number | null }[] = [];

  push(t: number, rows: ZombieRow[]): void {
    const map = new Map<number, ZombieRow>();
    const before = this.snaps[this.snaps.length - 1]?.rows;
    for (const r of rows) {
      map.set(r[0], r);
      if (!this.firstSeen.has(r[0])) { this.firstSeen.set(r[0], t); this.maxHp.set(r[0], r[4]); }
      // Which way it is walking. Only while it chases: a zombie that has
      // stopped to bite gets jostled by the crowd, and that is not a turn.
      const was = before?.get(r[0]);
      if (was && r[5] === Z_CHASE && Math.hypot(r[2] - was[2], r[3] - was[3]) >= MOVED_M) {
        const to = bearingXY(was[2], was[3], r[2], r[3]), from = this.heading.get(r[0]);
        this.heading.set(r[0], from == null ? to : norm360(from + angleDiffDeg(to, from) * 0.6));
      }
    }
    this.snaps.push({ t, rows: map });
    if (this.snaps.length > KEEP_SNAPSHOTS) this.snaps.shift();
    for (const id of [...this.firstSeen.keys()]) {
      if (!this.snaps.some((s) => s.rows.has(id))) { this.firstSeen.delete(id); this.maxHp.delete(id); this.hitAt.delete(id); this.heading.delete(id); }
    }
  }

  onHit(id: number, t: number): void { this.hitAt.set(id, t); }

  onKill(id: number, x: number, y: number, t: number): void {
    const type = this.latestRow(id)?.[1] ?? 0;
    this.corpses.push({ id, type, x, y, at: t, heading: this.heading.get(id) ?? null });
    // Stop drawing it the moment the server says it is dead, not 100 ms later.
    for (const s of this.snaps) s.rows.delete(id);
  }

  clear(): void {
    this.snaps = []; this.corpses = [];
    this.maxHp.clear(); this.firstSeen.clear(); this.hitAt.clear(); this.heading.clear();
  }

  /** Zombies in the newest snapshot, uninterpolated. */
  latest(): ZombieRow[] {
    const s = this.snaps[this.snaps.length - 1];
    return s ? [...s.rows.values()] : [];
  }

  get count(): number { return this.snaps[this.snaps.length - 1]?.rows.size ?? 0; }

  /** The world at server time `now`, drawn `INTERP_DELAY_S` in the past. */
  sample(now: number): ZView[] {
    const n = this.snaps.length;
    if (n === 0) return [];
    const t = now - INTERP_DELAY_S;
    let a = this.snaps[n - 1], b = a;
    for (let i = n - 1; i > 0; i--) {
      if (this.snaps[i - 1].t <= t) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
      a = b = this.snaps[i - 1];
    }
    const span = b.t - a.t;
    const f = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 1;
    const out: ZView[] = [];
    for (const rb of b.rows.values()) {
      const ra = a.rows.get(rb[0]) ?? rb;      // just spawned: no earlier position to slide from
      const id = rb[0];
      out.push({
        id, type: rb[1],
        x: ra[2] + (rb[2] - ra[2]) * f, y: ra[3] + (rb[3] - ra[3]) * f,
        hp: rb[4], maxHp: this.maxHp.get(id) ?? rb[4], state: rb[5], target: rb[6],
        age: Math.max(0, now - (this.firstSeen.get(id) ?? now)),
        hitAge: this.hitAt.has(id) ? Math.max(0, now - this.hitAt.get(id)!) : Infinity,
        heading: this.heading.get(id) ?? null,
      });
    }
    return out;
  }

  /** Zombies that died a moment ago, for the fall. */
  dying(now: number): Corpse[] {
    this.corpses = this.corpses.filter((c) => now - c.at < DEATH_FX_S);
    return this.corpses.map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, age: Math.max(0, now - c.at) / DEATH_FX_S, heading: c.heading }));
  }

  private latestRow(id: number): ZombieRow | undefined {
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const r = this.snaps[i].rows.get(id);
      if (r) return r;
    }
    return undefined;
  }
}

// ------------------------------------------------------------------ camera

export interface Camera {
  x: number; y: number;
  /** Map heading the camera faces. */
  heading: number;
  /** Elevation in degrees, positive looking up. */
  pitch: number;
  width: number; height: number;
  hfov?: number;
}

export interface Placed {
  /** Screen x of the body's centre line. */
  sx: number;
  /** Screen y of the top of the head and of the feet. */
  top: number; bottom: number;
  dist: number;
  /** Degrees right of the crosshair (negative: left). */
  off: number;
}

/** Where a standing figure at (x, y) lands on screen; null if it is behind the camera. */
export function project(x: number, y: number, cam: Camera): Placed | null {
  const dist = Math.max(Math.hypot(x - cam.x, y - cam.y), 0.3);
  const off = angleDiffDeg(bearingXY(cam.x, cam.y, x, y), cam.heading);
  if (Math.abs(off) > 80) return null;
  const focal = (cam.width / 2) / Math.tan(rad((cam.hfov ?? CAMERA_HFOV_DEG) / 2));
  const depth = Math.max(dist * Math.cos(rad(off)), 0.3);
  const horizon = cam.height / 2 + focal * Math.tan(rad(cam.pitch));
  return {
    sx: cam.width / 2 + focal * Math.tan(rad(off)),
    top: horizon - focal * ((ZOMBIE_HEIGHT_M - EYE_M) / depth),
    bottom: horizon + focal * (EYE_M / depth),
    dist, off,
  };
}

// ------------------------------------------------------------------ aiming

export interface Aim { x: number; y: number; heading: number; pitch: number }

/** Is the crosshair on this zombie? */
export function underCrosshair(z: { x: number; y: number }, aim: Aim, spreadDeg: number, rangeM: number): { dist: number } | null {
  const dist = Math.max(Math.hypot(z.x - aim.x, z.y - aim.y), 0.3);
  if (dist > rangeM) return null;
  const off = Math.abs(angleDiffDeg(bearingXY(aim.x, aim.y, z.x, z.y), aim.heading));
  if (off > deg(Math.atan(ZOMBIE_HALF_WIDTH_M / dist)) + spreadDeg) return null;
  const feet = deg(Math.atan(-EYE_M / dist));
  const head = deg(Math.atan((ZOMBIE_HEIGHT_M - EYE_M) / dist));
  const pad = spreadDeg + AIM_VERTICAL_PAD_DEG;
  if (aim.pitch < feet - pad || aim.pitch > head + pad) return null;
  return { dist };
}

/**
 * The zombies a trigger pull would hit, nearest first. The nearest one blocks
 * the rest; the server applies that rule, the list just gives it the order.
 */
export function pickTargets(zombies: { id: number; x: number; y: number }[], aim: Aim, cls: Pick<GunClass, 'spread_deg' | 'range_m'>): number[] {
  const hits: { id: number; dist: number }[] = [];
  for (const z of zombies) {
    const h = underCrosshair(z, aim, cls.spread_deg, cls.range_m);
    if (h) hits.push({ id: z.id, dist: h.dist });
  }
  return hits.sort((a, b) => a.dist - b.dist).map((h) => h.id);
}
