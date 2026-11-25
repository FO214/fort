/**
 * Turns raw sensor events into "where am I and where is the gun pointing".
 * One instance for the whole app; the lobby and the game both hold it open,
 * so GPS is already warm when the mission starts.
 *
 * Two ways to know: AR tracking, once the phone has seen one of the map's
 * markers (arPose.ts), and otherwise GPS, steps and the compass. Both are fed
 * all the time; `pose()` gives the AR answer while it has one.
 */
import { useEffect } from 'react';
import { net } from '../net/client';
import type { MapInfo } from '../net/types';
import { isSim, simHandle, startSensors, type SensorEvent, type SimHandle, type Stop } from '../sensors';
import { useStore } from '../store';
import { ArTracker, cameraMatrix, markerMatrix, toMap } from './arPose';
import { fromLocal, norm360 } from './geo';
import { OrientationTracker } from './orientation';
import { PositionTracker } from './position';
import { StepDetector } from './steps';

const SEND_EVERY_MS = 125;        // 8 Hz to the server
const FRESH_FIX_S = 15;           // a lobby fix this recent seeds the mission position
const SHOT_MUTE_S = 0.25;         // recoil is not a footstep
const ADOPT_EVERY_S = 0.25;       // how often GPS tracking is moved to where AR says we are
/** Further than this from the map and GPS is not describing a player in this building. */
export const OFF_MAP_M = 2000;

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
  /** Degrees the view is tilted sideways, positive with its right side raised. */
  roll: number;
}

class Tracking {
  readonly position = new PositionTracker();
  readonly orientation = new OrientationTracker();
  readonly steps = new StepDetector();
  readonly ar = new ArTracker();
  private adoptedT = -Infinity;
  /** Newest raw GPS fix, kept so the host can anchor the map with it. */
  lastFix: { lat: number; lon: number; acc: number; t: number } | null = null;
  private stop: Stop | null = null;
  private holders = 0;

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
    this.ar.setAnchors(map.anchors ?? []);
    this.position.setFrame({ origin: map.origin, rotation_deg: map.rotation_deg, start: map.start }, t);
    const f = this.lastFix;
    if (f && t - f.t < FRESH_FIX_S) this.position.onGps(f.lat, f.lon, f.acc, t);
  }

  /**
   * Free play: start measuring from here, before there is a map. The
   * newest fix becomes (0, 0), x east and y north; the walk is recorded in
   * those metres and the server makes the map in them, so the mission's
   * frame turns out the same one.
   */
  beginWalk(): [number, number] | null {
    const f = this.lastFix;
    if (!f) return null;
    const t = clock();
    this.position.setFrame({ origin: [f.lat, f.lon], rotation_deg: 0, start: [0, 0] }, t);
    this.position.onGps(f.lat, f.lon, f.acc, t);
    return [f.lat, f.lon];
  }

  /** The gun just fired; do not mistake the jolt for a step. */
  noteShot(): void { this.steps.mute(clock() + SHOT_MUTE_S); }

  /**
   * Where we are and where the gun points. The position is eased so that
   * corrections slide rather than jump. The same pose is drawn, aimed with
   * and reported to the server, so all three always agree.
   */
  pose(): Pose {
    const t = clock();
    const ar = this.ar.pose(t);
    if (ar) return { x: ar.x, y: ar.y, acc: ar.acc, hasFix: true, heading: ar.heading, pitch: ar.pitch, roll: ar.roll };
    const p = this.position.view(t);
    const o = this.orientation.get();
    return {
      x: p.x, y: p.y, acc: p.acc, hasFix: p.hasFix,
      heading: o.heading == null ? null : norm360(o.heading - this.position.rotation),
      pitch: o.pitch, roll: o.roll,
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
      case 'up':
        this.orientation.onUp(e.x, e.y, e.z, t);
        return;
      case 'pitch':
        this.orientation.setPitch(e.deg);
        return;
      case 'roll':
        this.orientation.setRoll(e.deg);
        return;
      case 'arFrame': {
        this.ar.onFrame(e.m, e.state, t);
        const p = t - this.adoptedT >= ADOPT_EVERY_S ? this.ar.pose(t) : null;
        if (p) { this.position.adopt(p.x, p.y, p.acc, t); this.adoptedT = t; }
        return;
      }
      case 'arMarker':
        this.ar.onMarker(e.id, e.m, t);
        return;
      case 'arReset':
        this.ar.onReset();
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

  // The map's markers, as soon as a map is picked: a marker seen in the lobby already counts.
  const map = useStore((s) => s.map);
  useEffect(() => tracking.ar.setAnchors(map?.anchors ?? []), [map]);

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
  /**
   * AR tracking puts the camera at a map position. The pretend AR session is
   * turned and shifted from the map (`SIM_AR`); the first call sees the map's
   * first marker, which is what lines the two up.
   */
  arPose: (x: number, y: number, mapHeading: number, pitch?: number) => void;
}

/** How the simulator's pretend AR frame sits on the map: an arbitrary turn and shift. */
export const SIM_AR = { theta: 37, tx: 4, ty: -6 };

if (isSim()) {
  const sim = simHandle() as SimMapHandle;
  sim.at = (x, y, opts = {}) => {
    const o = tracking.position.origin;
    if (!o) throw new Error('no map origin yet');
    const [lat, lon] = fromLocal(x, y, o[0], o[1], tracking.position.rotation);
    sim.fix(lat, lon, opts.acc ?? 3, opts.snap ?? false);
  };
  sim.aim = (mapHeading, pitch) => sim.face(mapHeading + tracking.position.rotation, pitch);
  // Map to pretend-AR: undo SIM_AR's shift, then its turn.
  const toAr = (x: number, y: number): [number, number] => {
    const back = { theta: -SIM_AR.theta, tx: 0, ty: 0 };
    return toMap(back, x - SIM_AR.tx, y - SIM_AR.ty);
  };
  sim.arPose = (x, y, mapHeading, pitch = 0) => {
    if (!tracking.ar.anchored) {
      const a = useStore.getState().map?.anchors?.[0];
      if (!a) throw new Error('this map has no AR markers');
      const [u, v] = toAr(a.x, a.y);
      sim.arMarker(a.id, markerMatrix(u, v, a.facing - SIM_AR.theta));
    }
    const [u, v] = toAr(x, y);
    sim.arFrame(cameraMatrix(u, v, mapHeading - SIM_AR.theta, pitch));
  };
}
