/**
 * Turns raw sensor events into "where am I and where is the gun pointing".
 * One instance for the whole app; the lobby and the game both hold it open,
 * so GPS is already warm when the mission starts.
 */
import { useEffect } from 'react';
import { net } from '../net/client';
import type { MapInfo } from '../net/types';
import { isSim, simHandle, startSensors, type SensorEvent, type SimHandle, type Stop } from '../sensors';
import { useStore } from '../store';
import { fromLocal, norm360 } from './geo';
import { OrientationTracker } from './orientation';
import { PositionTracker } from './position';
import { StepDetector } from './steps';

const SEND_EVERY_MS = 125;        // 8 Hz to the server
const FRESH_FIX_S = 15;           // a lobby fix this recent seeds the mission position
const SHOT_MUTE_S = 0.25;         // recoil is not a footstep
/** Further than this from the map and GPS is not describing a player in this building. */
export const OFF_MAP_M = 2000;
const QR_FRESH_S = 1.2;           // a code counts as "in view" this long after the camera last read it

/** Seconds on a clock that never jumps. */
export const clock = (): number =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;

export interface Pose {
  x: number; y: number;
  /** 1-sigma radius of the position estimate, metres. */
  acc: number;
  /** False until GPS has produced at least one fix this mission. */
  hasFix: boolean;
  /** Map heading the camera faces, or null before the compass reports. */
  heading: number | null;
  pitch: number;
}

class Tracking {
  readonly position = new PositionTracker();
  readonly orientation = new OrientationTracker();
  readonly steps = new StepDetector();
  /** Newest raw GPS fix, kept so the host can anchor the map with it. */
  lastFix: { lat: number; lon: number; acc: number; t: number } | null = null;
  private stop: Stop | null = null;
  private holders = 0;
  private qr: { data: string; at: number; held: boolean } | null = null;

  /** Start listening (if nobody else has). Returns the matching release. */
  acquire(): Stop {
    if (this.holders++ === 0) this.stop = startSensors((e) => this.handle(e));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holders === 0) { this.stop?.(); this.stop = null; }
    };
  }

  /**
   * Stop and start the sensors again, for whoever is holding them. This is
   * the retry after location was refused and has since been allowed.
   */
  restart(): void {
    if (this.holders === 0) return;
    this.stop?.();
    useStore.getState().setSensorError(null);
    this.stop = startSensors((e) => this.handle(e));
  }

  /** A mission started: this is where the map sits in the real world. */
  setFrame(map: MapInfo): void {
    const t = clock();
    this.position.setFrame({ origin: map.origin, rotation_deg: map.rotation_deg, start: map.start }, t);
    const f = this.lastFix;
    if (f && t - f.t < FRESH_FIX_S) this.position.onGps(f.lat, f.lon, f.acc, t);
  }

  /** The camera just read a QR code. */
  noteQr(data: string): void { this.qr = { data, at: clock(), held: false }; }

  /** Is the code with this text in front of the camera right now? */
  qrInView(expected: string): boolean {
    const q = this.qr;
    return !!q && q.data === expected && (q.held || clock() - q.at < QR_FRESH_S);
  }

  /** Is some other code in front of the camera: a QR, but not this one? */
  wrongQrInView(expected: string): boolean {
    const q = this.qr;
    return !!q && q.data !== expected && (q.held || clock() - q.at < QR_FRESH_S);
  }

  /** The gun just fired; do not mistake the jolt for a step. */
  noteShot(): void { this.steps.mute(clock() + SHOT_MUTE_S); }

  /**
   * Where we are and where the gun points. The position is eased so that
   * corrections slide rather than jump. The same pose is drawn, aimed with
   * and reported to the server, so all three always agree.
   */
  pose(): Pose {
    const p = this.position.view(clock());
    const o = this.orientation.get();
    return {
      x: p.x, y: p.y, acc: p.acc, hasFix: p.hasFix,
      heading: o.heading == null ? null : norm360(o.heading - this.position.rotation),
      pitch: o.pitch,
    };
  }

  private handle(e: SensorEvent): void {
    const t = clock();
    switch (e.k) {
      case 'gps': {
        const first = this.lastFix == null;
        this.lastFix = { lat: e.lat, lon: e.lon, acc: e.acc, t };
        this.position.onGps(e.lat, e.lon, e.acc, t, e.snap);
        // The lobby shows GPS quality; only bother React when it changes visibly.
        const shown = useStore.getState().gpsAcc;
        if (first || shown == null || Math.abs(shown - e.acc) >= 1) useStore.getState().setGpsAcc(e.acc);
        return;
      }
      case 'compass':
        if (this.orientation.get().heading == null) useStore.getState().setHasCompass(true);
        this.orientation.onCompass(e.bearing, t);
        return;
      case 'attitude':
        this.orientation.onAttitude(e.alpha, e.beta, e.gamma, t);
        return;
      case 'accel':
        if (this.steps.onAccel(e.magnitude, t)) this.stepForward(t);
        return;
      case 'step':
        this.stepForward(t);
        return;
      case 'pitch':
        this.orientation.setPitch(e.deg);
        return;
      case 'qr':
        // The simulator holds a code in view until it is taken away.
        this.qr = e.data == null ? null : { data: e.data, at: t, held: true };
        return;
    }
  }

  private stepForward(t: number): void {
    const h = this.orientation.get().heading;
    if (h != null) this.position.onStep(norm360(h - this.position.rotation), t);
  }
}

export const tracking = new Tracking();
if (typeof window !== 'undefined') (window as unknown as { __loonieTracking?: unknown }).__loonieTracking = tracking;

/**
 * Keeps the sensors running while mounted; while `sending`, reports to the
 * server. Starting the sensors is what makes the OS ask for location, so
 * `enabled` holds that back until the player has been told why.
 */
export function useTracking(sending: boolean, enabled = true): void {
  useEffect(() => (enabled ? tracking.acquire() : undefined), [enabled]);

  // Each `started` message (a new mission, or a reconnect) re-anchors the map.
  const missionSeq = useStore((s) => s.missionSeq);
  useEffect(() => {
    const map = useStore.getState().map;
    if (missionSeq > 0 && map) tracking.setFrame(map);
  }, [missionSeq]);

  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => {
      const p = tracking.pose();
      // Miles from the building (wrong map picked, or playing from home): nothing useful to report.
      if (Math.abs(p.x) > OFF_MAP_M || Math.abs(p.y) > OFF_MAP_M) return;
      net.pos(p.x, p.y, p.acc, p.heading ?? 0, p.pitch);
    }, SEND_EVERY_MS);
    return () => clearInterval(id);
  }, [sending]);
}

// ------------------------------------------------------------------ test hooks

export interface SimMapHandle extends SimHandle {
  /** Report a GPS fix at a map position (needs a running mission). */
  at: (x: number, y: number, opts?: { acc?: number; snap?: boolean }) => void;
  /** Point the camera along a map heading. */
  aim: (mapHeading: number, pitch?: number) => void;
}

if (isSim()) {
  const sim = simHandle() as SimMapHandle;
  sim.at = (x, y, opts = {}) => {
    const o = tracking.position.origin;
    if (!o) throw new Error('no map origin yet');
    const [lat, lon] = fromLocal(x, y, o[0], o[1], tracking.position.rotation);
    sim.fix(lat, lon, opts.acc ?? 3, opts.snap ?? false);
  };
  sim.aim = (mapHeading, pitch) => sim.face(mapHeading + tracking.position.rotation, pitch);
}
