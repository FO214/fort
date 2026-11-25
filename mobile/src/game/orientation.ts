/**
 * Which way the gun points: compass heading and up/down pitch.
 *
 * The compass knows where north is but is slow and jittery. The motion
 * sensor's attitude is fast and smooth but drifts and has no idea where
 * north is. So turning is taken from the attitude and the compass slowly
 * corrects the drift.
 *
 * Pure logic with an injected clock (seconds).
 */
import { angleDiffDeg, deg, norm360 } from './geo';

const COMPASS_TAU_S = 3;          // how quickly the compass corrects attitude drift
const SNAP_DEG = 45;              // further off than this is a jump (calibration), not drift
const ATTITUDE_STALE_S = 0.5;     // no attitude for this long: fall back to the bare compass
const PITCH_TAU_S = 0.06;
/** Slower than pitch: gravity also carries every footstep's jolt. */
const ROLL_TAU_S = 0.15;
/** Tilted further than this, it is a phone being put away, not a gun being held. */
const MAX_ROLL_DEG = 35;
/** Pointed this steeply up or down, the screen's sideways tilt no longer means anything. */
const ROLL_NEEDS = 0.35;

/**
 * How far the phone, held in landscape, is tilted about the camera's line of
 * sight, in degrees: positive when its right-hand side (as the player sees
 * the screen) is raised. `ux`, `uy`, `uz`: up along the phone's x, y and z axes.
 *
 * In landscape one of those axes is the screen's up. If +x is (top edge to
 * the player's left), screen-right is -y; if -x, screen-right is +y. Either
 * way it reduces to the formula below, so it does not need to know which way
 * round the phone sits on the gun. Null when it is too steep to tell.
 */
export function rollFromUp(ux: number, uy: number, uz = 0): number | null {
  const len = Math.hypot(ux, uy, uz);
  if (!(len > 0)) return null;
  const x = ux / len, y = uy / len;
  // Not landscape any more (or looking straight up or down): no roll to speak of.
  if (Math.abs(x) < ROLL_NEEDS) return null;
  return deg(Math.atan2(-Math.sign(x) * y, Math.abs(x)));
}

/**
 * Camera elevation in degrees from the attitude angles (radians): 0 looking
 * at the horizon, positive looking up.
 *
 * With the usual Z-X-Y Euler order the back camera's direction has a vertical
 * component of -cos(beta)·cos(gamma). Lying flat on a table (beta = gamma = 0)
 * that is -1: the camera looks straight down. Because only cosines are
 * involved, this does not depend on which way round the phone is held in
 * landscape, or on which sign convention the platform uses for the angles.
 */
export function pitchFromAttitude(beta: number, gamma: number): number {
  const v = -Math.cos(beta) * Math.cos(gamma);
  return deg(Math.asin(Math.max(-1, Math.min(1, v))));
}

/**
 * Up, along the phone's x, y and z axes, from W3C attitude angles (radians):
 * the vertical parts of those axes in R = Rz(alpha)·Rx(beta)·Ry(gamma).
 */
export function upFromAttitude(beta: number, gamma: number): { x: number; y: number; z: number } {
  return { x: -Math.cos(beta) * Math.sin(gamma), y: Math.sin(beta), z: Math.cos(beta) * Math.cos(gamma) };
}

export interface Pose { heading: number | null; pitch: number; roll: number }

export class OrientationTracker {
  private heading: number | null = null;
  private pitch = 0;
  private pitchT = 0;
  private roll = 0;
  private rollT = 0;
  private lastAlpha: number | null = null;
  private lastAttitudeT = -Infinity;
  private lastCompass: number | null = null;
  private lastCompassT = 0;
  // Platforms disagree on whether yaw grows clockwise. Start from the iOS
  // convention (counter-clockwise) and learn the truth from the compass.
  private yawVote = -2;
  private turnedYaw = 0;
  private turnedCompass = 0;
  /**
   * Degrees added to every compass reading. Indoors, steel and wiring bend
   * the compass, often by the same amount across a room; the player can say
   * which way they really face (`calibrate`) and this keeps that correction.
   */
  private trim = 0;

  reset(): void {
    this.trim = 0;
    this.heading = null; this.pitch = 0; this.roll = 0; this.lastAlpha = null; this.lastAttitudeT = -Infinity;
    this.lastCompass = null; this.yawVote = -2; this.turnedYaw = this.turnedCompass = 0;
  }

  /** Compass bearing the camera faces, in degrees. */
  onCompass(bearing: number, t: number): void {
    const b = norm360(bearing + this.trim);
    if (this.lastCompass != null) this.turnedCompass += angleDiffDeg(b, this.lastCompass);
    const dt = Math.min(Math.max(t - this.lastCompassT, 0), 1);
    this.lastCompass = b;
    this.lastCompassT = t;
    this.learnYawSign();

    const attitudeLive = t - this.lastAttitudeT < ATTITUDE_STALE_S;
    if (this.heading == null || !attitudeLive) { this.heading = b; return; }
    const err = angleDiffDeg(b, this.heading);
    if (Math.abs(err) > SNAP_DEG) { this.heading = b; return; }
    this.heading = norm360(this.heading + err * (1 - Math.exp(-dt / COMPASS_TAU_S)));
  }

  /** Device attitude in radians (alpha about vertical, beta, gamma). */
  onAttitude(alpha: number, beta: number, gamma: number, t: number): void {
    const p = pitchFromAttitude(beta, gamma);
    const dt = Math.max(0, t - this.pitchT);
    this.pitchT = t;
    this.pitch += (p - this.pitch) * (dt > 1 ? 1 : 1 - Math.exp(-dt / PITCH_TAU_S));

    const a = deg(alpha);
    if (this.lastAlpha != null && t - this.lastAttitudeT < ATTITUDE_STALE_S) {
      const turned = angleDiffDeg(a, this.lastAlpha);
      this.turnedYaw += turned;
      if (this.heading != null) this.heading = norm360(this.heading + turned * (this.yawVote < 0 ? -1 : 1));
    }
    this.lastAlpha = a;
    this.lastAttitudeT = t;
  }

  /** Which way is up along the phone's x, y and z axes (see `rollFromUp`). */
  onUp(ux: number, uy: number, uz: number, t: number): void {
    const dt = Math.max(0, t - this.rollT);
    this.rollT = t;
    const r = rollFromUp(ux, uy, uz);
    const want = r == null ? 0 : Math.max(-MAX_ROLL_DEG, Math.min(MAX_ROLL_DEG, r));
    this.roll += (want - this.roll) * (dt > 1 ? 1 : 1 - Math.exp(-dt / ROLL_TAU_S));
  }

  /**
   * The player says the camera faces `bearing` (compass degrees) right now:
   * face it at once, and correct the compass by however far off it was.
   */
  calibrate(bearing: number): void {
    const want = norm360(bearing);
    // Measured against the compass itself, not the smoothed heading, which may still be catching up.
    const raw = this.lastCompass != null ? norm360(this.lastCompass - this.trim) : null;
    if (raw != null) this.trim = angleDiffDeg(want, raw);
    this.lastCompass = want;
    this.heading = want;
  }

  get compassTrim(): number { return this.trim; }

  /** Forget a calibration (a new mission). */
  clearTrim(): void { this.trim = 0; }

  /** Tests and the simulator set roll directly. */
  setRoll(roll: number): void { this.roll = roll; }

  /** Tests and the simulator set pitch directly. */
  setPitch(pitch: number): void { this.pitch = pitch; }

  get(): Pose { return { heading: this.heading, pitch: this.pitch, roll: this.roll }; }

  /** Whether the attitude's yaw runs clockwise (+1) or counter-clockwise (-1). */
  get yawSign(): number { return this.yawVote < 0 ? -1 : 1; }

  private learnYawSign(): void {
    // Once both sensors agree the phone really turned, see whether they
    // moved the same way round.
    if (Math.abs(this.turnedYaw) < 20 || Math.abs(this.turnedCompass) < 10) {
      if (Math.abs(this.turnedYaw) > 90 || Math.abs(this.turnedCompass) > 90) this.turnedYaw = this.turnedCompass = 0;
      return;
    }
    const same = this.turnedYaw * this.turnedCompass > 0;
    this.yawVote = Math.max(-6, Math.min(6, this.yawVote + (same ? 1 : -1)));
    this.turnedYaw = this.turnedCompass = 0;
  }
}
