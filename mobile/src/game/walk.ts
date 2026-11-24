/**
 * Free play: recording the area before the game. The host walks everywhere
 * zombies may go, and the walk becomes the map. The server opens the floor
 * near where they walked and nothing else (backend/app/grid.py), so walls,
 * furniture and the road are left out without anyone drawing them.
 *
 * Pure logic: positions in, the walk out.
 */
export type XY = [number, number];

/** A new point every this far, so standing still does not pile up points. */
export const WALK_SAMPLE_M = 0.75;
/** A jump this big between two samples is GPS catching up, not walking: start a new stretch. */
export const WALK_JUMP_M = 12;
/** The server will not make a map from less (MIN_WALK_M in mapdata.py). */
export const MIN_WALK_M = 20;
/** And will not take more (MAX_WALK_POINTS in room.py), or more stretches than this. */
const MAX_POINTS = 4000;
const MAX_STRETCHES = 20;

const round = (v: number) => Math.round(v * 100) / 100;

export class WalkRecorder {
  readonly paths: XY[][] = [];
  helicopter: XY | null = null;
  private points = 0;
  private walked = 0;

  /** The walker's position now. */
  add(x: number, y: number): void {
    if (this.points >= MAX_POINTS) return;
    const path = this.paths[this.paths.length - 1];
    const last = path?.[path.length - 1];
    const d = last ? Math.hypot(x - last[0], y - last[1]) : Infinity;
    if (last && d < WALK_SAMPLE_M) return;
    if (!path || d > WALK_JUMP_M) {
      if (this.paths.length >= MAX_STRETCHES) return;
      this.paths.push([[round(x), round(y)]]);
    } else {
      path.push([round(x), round(y)]);
      this.walked += d;
    }
    this.points++;
  }

  /** "The helicopter sign is here." */
  markHelicopter(x: number, y: number): void { this.helicopter = [round(x), round(y)]; }

  /** Metres walked so far. */
  get length(): number { return this.walked; }

  get enough(): boolean { return this.walked >= MIN_WALK_M; }

  /** What the server is sent: only stretches long enough to be a line. */
  result(): { paths: XY[][]; helicopter: XY | null } {
    return { paths: this.paths.filter((p) => p.length >= 2), helicopter: this.helicopter };
  }
}

/** Metres walked along a map's recorded paths. */
export const walkLength = (paths: XY[][] | undefined): number =>
  (paths ?? []).reduce((sum, p) => sum + p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0), 0);
