/**
 * Step detection from the accelerometer.
 *
 * Works on the magnitude of acceleration (gravity included), so it does not
 * matter how the phone is mounted. A walking step is a slow bump of a few
 * m/s² once or twice a second that lasts a good fraction of that second; a
 * Nerf plunger firing is a sharp spike a few milliseconds long. Requiring the
 * bump to last tells them apart, and the game also mutes detection briefly
 * after each shot.
 *
 * Pure logic with an injected clock (seconds).
 */
const GRAVITY_TAU_S = 1.0;        // slow baseline that follows gravity
const SMOOTH_TAU_S = 0.02;        // takes the fizz off the raw signal, nothing more
const RISE_MPS2 = 0.9;            // bump height that counts as a step
const REARM_MPS2 = 0.25;          // must fall back below this before the next step
const MIN_BUMP_S = 0.07;          // a footfall lasts; a plunger jolt is over in milliseconds
const MIN_STEP_GAP_S = 0.3;       // nobody steps faster than ~3 Hz

export class StepDetector {
  private baseline: number | null = null;
  private smooth = 0;
  private armed = true;
  private aboveSince: number | null = null;
  private lastT = 0;
  private lastStepT = -Infinity;
  private mutedUntil = -Infinity;

  /** Ignore bumps until `t` (the gun just fired). */
  mute(until: number): void { this.mutedUntil = Math.max(this.mutedUntil, until); }

  /** Feed one sample of |acceleration| in m/s². Returns true on a step. */
  onAccel(magnitude: number, t: number): boolean {
    if (this.baseline == null) { this.baseline = magnitude; this.lastT = t; return false; }
    const dt = Math.min(Math.max(t - this.lastT, 0), 0.2);
    this.lastT = t;
    this.baseline += (magnitude - this.baseline) * (1 - Math.exp(-dt / GRAVITY_TAU_S));
    this.smooth += (magnitude - this.baseline - this.smooth) * (1 - Math.exp(-dt / SMOOTH_TAU_S));

    if (this.smooth < REARM_MPS2) { this.armed = true; this.aboveSince = null; return false; }
    if (this.smooth < RISE_MPS2) { this.aboveSince = null; return false; }
    if (this.aboveSince == null) this.aboveSince = t;
    if (!this.armed || t - this.aboveSince < MIN_BUMP_S) return false;
    this.armed = false;                 // one step per bump, counted or not
    if (t < this.mutedUntil || t - this.lastStepT < MIN_STEP_GAP_S) return false;
    this.lastStepT = t;
    return true;
  }
}
