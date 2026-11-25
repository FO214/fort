/**
 * Where this phone is on the map.
 *
 * GPS is the source of truth. Indoors it is noisy (often 10–30 m) and slow,
 * so between fixes the estimate is carried by step tracking: each detected
 * step moves it ~0.7 m along the current heading. Every fix then pulls the
 * estimate toward itself, harder when the fix claims good accuracy and softer
 * when it does not, and never faster than a person can move.
 *
 * Pure logic with an injected clock (seconds), so it can be tested without
 * a phone.
 */
import { fromLocal, toLocal } from './geo';

export const STEP_M = 0.7;
const MIN_FIX_ACC_M = 3;          // nobody's GPS is better than this indoors, whatever it claims
const MAX_SPEED_MPS = 3;          // a fix may not drag the estimate faster than a jog
const Q_STEP_M2 = 0.08;           // uncertainty added per step (stride length, heading error)
// Uncertainty added per second. This sets how hard each GPS fix pulls: little
// when standing still (so indoor GPS noise does not slide the world around),
// more when walking, most when fixes keep disagreeing in the same direction
// (we have moved and the steps were missed).
const Q_STILL_M2_PER_S = 0.03;
const Q_WALKING_M2_PER_S = 0.2;
const Q_DISPLACED_M2_PER_S = 1.0;
const WALKING_WINDOW_S = 2;       // a step this recently means "walking"
const BIAS_KEEP = 0.8;            // memory of the running average of fix-minus-estimate
const DISPLACED_FRACTION = 0.6;   // that average beyond this share of the fix's accuracy means "moved"
const START_VAR_M2 = 15 * 15;     // before the first fix we only know "near the start point"
// What is drawn eases toward the estimate: quickly for a step (you did move),
// slowly for a GPS correction (you probably did not, the estimate just got better).
const STEP_EASE_S = 0.15;
const GPS_EASE_S = 1.5;

export interface Frame {
  /** Latitude/longitude of map (0, 0); null when the map has no anchor yet. */
  origin: [number, number] | null;
  rotation_deg: number;
  start: [number, number];
}

export interface Estimate { x: number; y: number; acc: number; hasFix: boolean }

export class PositionTracker {
  private frame: Frame = { origin: null, rotation_deg: 0, start: [0, 0] };
  private x = 0;
  private y = 0;
  private variance = START_VAR_M2;
  private hasFix = false;
  private lastFixT = 0;
  private lastT = 0;
  private lastStepT = -Infinity;
  private biasX = 0;
  private biasY = 0;
  private displaced = false;
  // How far the drawn position still trails the estimate, per cause.
  private stepLagX = 0;
  private stepLagY = 0;
  private gpsLagX = 0;
  private gpsLagY = 0;
  private viewT = 0;

  /** Call when a mission starts: where the map sits in the real world. */
  setFrame(frame: Frame, t: number): void {
    this.frame = { ...frame };
    this.x = frame.start[0];
    this.y = frame.start[1];
    this.stepLagX = this.stepLagY = this.gpsLagX = this.gpsLagY = 0;
    this.variance = START_VAR_M2;
    this.hasFix = false;
    this.lastFixT = this.lastT = this.viewT = t;
    this.lastStepT = -Infinity;
    this.biasX = this.biasY = 0;
    this.displaced = false;
  }

  get origin(): [number, number] | null { return this.frame.origin; }
  get rotation(): number { return this.frame.rotation_deg; }

  /** A GPS fix. `snap` jumps straight to it (tests placing a player). The
   * first fix of a mission always does. */
  onGps(lat: number, lon: number, acc: number, t: number, snap = false): void {
    if (this.frame.origin == null) {
      // The host had no fix when the mission started, so nothing ties the map
      // to the world. Treat this phone's first fix as the start point.
      const [sx, sy] = this.frame.start;
      this.frame.origin = fromLocal(-sx, -sy, lat, lon, this.frame.rotation_deg);
    }
    this.advance(t);
    const [fx, fy] = toLocal(lat, lon, this.frame.origin[0], this.frame.origin[1], this.frame.rotation_deg);
    const r = Math.max(acc, MIN_FIX_ACC_M) ** 2;

    if (!this.hasFix || snap) {
      this.x = fx; this.y = fy;
      this.variance = r;
      this.hasFix = true;
      this.lastFixT = t;
      this.biasX = this.biasY = 0;
      this.displaced = false;
      this.stepLagX = this.stepLagY = this.gpsLagX = this.gpsLagY = 0;
      return;
    }

    const dx = fx - this.x, dy = fy - this.y;
    const d = Math.hypot(dx, dy);
    let k = this.variance / (this.variance + r);
    // A fix that implies we moved faster than a person can is softened: it
    // still pulls, but only as far as we could plausibly have walked.
    const dt = Math.min(Math.max(t - this.lastFixT, 0.05), 5);
    const allowed = MAX_SPEED_MPS * dt;
    if (d > 1e-6 && k * d > allowed) k = allowed / d;
    this.ease(t);
    this.x += dx * k;
    this.y += dy * k;
    this.gpsLagX += dx * k;
    this.gpsLagY += dy * k;
    this.variance *= 1 - k;
    this.lastFixT = t;

    // Noise points a different way every fix and averages out; a real move
    // keeps pointing the same way.
    this.biasX = this.biasX * BIAS_KEEP + dx * (1 - k) * (1 - BIAS_KEEP);
    this.biasY = this.biasY * BIAS_KEEP + dy * (1 - k) * (1 - BIAS_KEEP);
    this.displaced = Math.hypot(this.biasX, this.biasY) > DISPLACED_FRACTION * Math.max(acc, MIN_FIX_ACC_M);
  }

  /** One detected step along `mapHeading` (degrees, 0 = +y, clockwise). */
  onStep(mapHeading: number, t: number): void {
    this.advance(t);
    const a = (mapHeading * Math.PI) / 180;
    const sx = Math.sin(a) * STEP_M, sy = Math.cos(a) * STEP_M;
    this.ease(t);
    this.x += sx;
    this.y += sy;
    this.stepLagX += sx;
    this.stepLagY += sy;
    this.variance += Q_STEP_M2;
    this.lastStepT = t;
  }

  /** Best estimate right now. `acc` is its 1-sigma radius in metres. */
  estimate(t: number): Estimate {
    this.advance(t);
    return { x: this.x, y: this.y, acc: Math.sqrt(this.variance), hasFix: this.hasFix };
  }

  /**
   * The estimate, eased, for drawing and aiming: a step or a GPS correction
   * then slides the world instead of jerking it.
   */
  view(t: number): Estimate {
    const e = this.estimate(t);
    this.ease(t);
    return { ...e, x: e.x - this.stepLagX - this.gpsLagX, y: e.y - this.stepLagY - this.gpsLagY };
  }

  /** Let the drawn position catch up for the time that has passed. */
  private ease(t: number): void {
    const dt = t - this.viewT;
    if (dt <= 0) return;
    this.viewT = t;
    const keepStep = Math.exp(-dt / STEP_EASE_S), keepGps = Math.exp(-dt / GPS_EASE_S);
    this.stepLagX *= keepStep; this.stepLagY *= keepStep;
    this.gpsLagX *= keepGps; this.gpsLagY *= keepGps;
  }

  private advance(t: number): void {
    const dt = t - this.lastT;
    if (dt <= 0) return;
    this.lastT = t;
    const q = this.displaced ? Q_DISPLACED_M2_PER_S : t - this.lastStepT < WALKING_WINDOW_S ? Q_WALKING_M2_PER_S : Q_STILL_M2_PER_S;
    this.variance = Math.min(this.variance + q * dt, 60 * 60);
  }
}
