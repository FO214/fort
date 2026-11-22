/**
 * The horde, heard: how loud and how high the zombie groan should be, from
 * how far away the nearest zombie is and how fast it is closing.
 *
 *   loudness   how close it is. Silent beyond earshot, a murmur at range,
 *              and the last few metres do the shouting.
 *   pitch      whether it is closing: a Doppler shift, up as it comes at
 *              you and down as it falls behind. At walking pace the real
 *              shift is a third of a percent, which nobody can hear, so
 *              sound here travels at 14 m/s instead of 343.
 *
 * No audio in this file: it is arithmetic, so it can be tested. game/sound.ts
 * plays the result.
 */

/** Beyond this the horde is not heard at all. */
export const EARSHOT_M = 25;
/** This close it is as loud as it gets. */
export const FULL_AT_M = 2;
/** The speed of sound, for Doppler purposes. Slow, so that walking speed is audible. */
export const DOPPLER_SOUND_MPS = 14;
/** How far the pitch may move, as a playback rate. */
export const RATE_MIN = 0.8, RATE_MAX = 1.3;
/** Faster than anyone here moves: a bigger change in distance is a different zombie or a GPS jump, not speed. */
const MAX_CLOSING_MPS = 6;
/** How quickly the pitch follows a change of speed, in seconds. */
const SMOOTH_S = 0.5;

export interface Voice { volume: number; rate: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The groan for a zombie `dist` metres away closing at `closing` m/s (negative: it is falling behind). */
export function hordeVoice(dist: number, closing: number): Voice {
  const near = clamp((EARSHOT_M - dist) / (EARSHOT_M - FULL_AT_M), 0, 1);
  const v = clamp(closing, -MAX_CLOSING_MPS, MAX_CLOSING_MPS);
  return { volume: near * near, rate: clamp(DOPPLER_SOUND_MPS / (DOPPLER_SOUND_MPS - v), RATE_MIN, RATE_MAX) };
}

/** The nearest of `zombies` to a point, in metres; null when there are none. */
export function nearestDistance(zombies: readonly { x: number; y: number }[], x: number, y: number): number | null {
  let best: number | null = null;
  for (const z of zombies) {
    const d = Math.hypot(z.x - x, z.y - y);
    if (best == null || d < best) best = d;
  }
  return best;
}

/**
 * Listens to the nearest zombie over time. Feed it the distance a few times
 * a second; it works out the closing speed and returns the voice to play, or
 * null for silence.
 */
export class HordeEar {
  private last: { dist: number; t: number } | null = null;
  private closing = 0;

  hear(dist: number | null, t: number): Voice | null {
    if (dist == null || dist >= EARSHOT_M) { this.last = null; this.closing = 0; return null; }
    if (this.last && t > this.last.t) {
      const dt = t - this.last.t;
      const raw = (this.last.dist - dist) / dt;
      // The nearest zombie changes when one dies or another overtakes it, and
      // GPS can move the player metres in one fix. Neither is anything moving.
      if (Math.abs(raw) <= MAX_CLOSING_MPS) this.closing += (raw - this.closing) * (1 - Math.exp(-dt / SMOOTH_S));
    }
    this.last = { dist, t };
    return hordeVoice(dist, this.closing);
  }

  reset(): void { this.last = null; this.closing = 0; }
}
