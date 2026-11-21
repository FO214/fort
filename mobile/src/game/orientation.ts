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

export interface Pose { heading: number | null; pitch: number }

export class OrientationTracker {
  private heading: number | null = null;
  private pitch = 0;
  private pitchT = 0;
  private lastAlpha: number | null = null;
  private lastAttitudeT = -Infinity;
  private lastCompass: number | null = null;
  private lastCompassT = 0;
  // Platforms disagree on whether yaw grows clockwise. Start from the iOS
  // convention (counter-clockwise) and learn the truth from the compass.
  private yawVote = -2;
  private turnedYaw = 0;
  private turnedCompass = 0;

  reset(): void {
    this.heading = null; this.pitch = 0; this.lastAlpha = null; this.lastAttitudeT = -Infinity;
    this.lastCompass = null; this.yawVote = -2; this.turnedYaw = this.turnedCompass = 0;
  }

  /** Compass bearing the camera faces, in degrees. */
  onCompass(bearing: number, t: number): void {
    const b = norm360(bearing);
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

  /** Tests and the simulator set pitch directly. */
  setPitch(pitch: number): void { this.pitch = pitch; }

  get(): Pose { return { heading: this.heading, pitch: this.pitch }; }

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
