/**
 * Raw sensor events, from whichever source the platform has:
 *   native  → expo-location (GPS + compass) and expo-sensors (attitude, accelerometer)
 *   web     → navigator.geolocation + deviceorientation + devicemotion
 *   sim     → window.__loonieSim, driven by tests (web with ?sim=1)
 * All three emit the same events. Turning them into a position and a heading
 * is the job of game/tracking.ts.
 */
import { Platform } from 'react-native';
import { useStore } from '../store';

export type SensorEvent =
  /** A GPS fix. `snap` (simulator only) means "jump there". */
  | { k: 'gps'; lat: number; lon: number; acc: number; snap?: boolean }
  /** Compass bearing the back camera faces, already corrected for landscape. */
  | { k: 'compass'; bearing: number; acc: number | null }
  /** Device attitude in radians. */
  | { k: 'attitude'; alpha: number; beta: number; gamma: number }
  /** Magnitude of acceleration including gravity, m/s². */
  | { k: 'accel'; magnitude: number }
  /** Simulator only: one step taken / camera pitch set directly. */
  | { k: 'step' }
  | { k: 'pitch'; deg: number };

export type Listener = (e: SensorEvent) => void;
export type Stop = () => void;

declare global {
  interface Window { __loonieSim?: SimHandle }
}

export interface SimHandle {
  listeners: Set<Listener>;
  /** The last GPS fix and facing, replayed to anything that subscribes later. */
  last: { gps: SensorEvent & { k: 'gps' }; compass: SensorEvent & { k: 'compass' }; pitch: number };
  emit: (e: SensorEvent) => void;
  /** Report a GPS fix. */
  fix: (lat: number, lon: number, acc?: number, snap?: boolean) => void;
  /** Point the camera along a compass bearing, optionally tilted. */
  face: (bearing: number, pitch?: number) => void;
  /** Take n steps along the current heading. */
  step: (n?: number) => void;
}

/**
 * The compass reports where the phone's TOP EDGE points, on both platforms
 * (iOS leaves headingOrientation at portrait; expo-location on Android does
 * not remap either). The game is played in landscape, where the top edge
 * points sideways, so the camera faces 90° to one side of the reported
 * bearing. Which side depends on which way round the phone sits on the gun:
 *
 *   top edge to the player's left  → camera = reported + 90
 *   top edge to the player's right → camera = reported - 90
 *
 * The motion sensor settles it from gravity (see `offsetFromGravity`). Until
 * its first sample, and on phones without one, the screen's orientation is
 * used instead (`setHeadingOffset`, called by the game screen).
 */
let headingOffset = 0;
export function setHeadingOffset(deg: number) { headingOffset = deg; }
const corrected = (raw: number) => (((raw + headingOffset) % 360) + 360) % 360;

/**
 * Gravity along the phone's x axis (m/s², positive when its right-hand edge
 * points at the floor) says which landscape it is held in. Expo reports
 * gravity pointing at the ground on both iOS and Android.
 */
export function offsetFromGravity(gx: number, gy: number): number | null {
  if (Math.abs(gx) < 4 || Math.abs(gx) < Math.abs(gy)) return null;    // not clearly landscape
  return gx > 0 ? -90 : 90;
}

export function isSim(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sim') === '1' || !!window.__loonieSim;
}

export function simHandle(): SimHandle {
  if (!window.__loonieSim) {
    const h: SimHandle = {
      listeners: new Set(),
      last: {
        gps: { k: 'gps', lat: 43.4723, lon: -80.5449, acc: 3 },
        compass: { k: 'compass', bearing: 0, acc: 5 },
        pitch: 0,
      },
      emit(e) {
        if (e.k === 'gps') h.last.gps = { ...e, snap: undefined };
        if (e.k === 'compass') h.last.compass = e;
        if (e.k === 'pitch') h.last.pitch = e.deg;
        h.listeners.forEach((l) => l(e));
      },
      fix(lat, lon, acc = 3, snap = false) { h.emit({ k: 'gps', lat, lon, acc, snap }); },
      face(bearing, pitch) {
        h.emit({ k: 'compass', bearing: ((bearing % 360) + 360) % 360, acc: 5 });
        if (pitch != null) h.emit({ k: 'pitch', deg: pitch });
      },
      step(n = 1) { for (let i = 0; i < n; i++) h.emit({ k: 'step' }); },
    };
    window.__loonieSim = h;
  }
  return window.__loonieSim;
}

export async function requestPermissions(): Promise<{ location: boolean; camera: boolean }> {
  if (Platform.OS === 'web') return { location: true, camera: true };
  const Location = await import('expo-location');
  const Camera = await import('expo-camera');
  const loc = await Location.requestForegroundPermissionsAsync();
  const cam = await Camera.Camera.requestCameraPermissionsAsync();
  return { location: loc.status === 'granted', camera: cam.status === 'granted' };
}

export function startSensors(listener: Listener): Stop {
  if (Platform.OS === 'web') return isSim() ? startSim(listener) : startWeb(listener);
  let stopped = false;
  let stop: Stop = () => { stopped = true; };
  startNative(listener)
    .then((s) => { if (stopped) s(); else stop = s; })
    .catch((e: unknown) => useStore.getState().setSensorError(e instanceof Error ? e.message : String(e)));
  return () => stop();
}

function startSim(listener: Listener): Stop {
  const h = simHandle();
  h.listeners.add(listener);
  listener(h.last.gps);
  listener(h.last.compass);
  listener({ k: 'pitch', deg: h.last.pitch });
  return () => h.listeners.delete(listener);
}

function startWeb(listener: Listener): Stop {
  const watch = navigator.geolocation?.watchPosition(
    (p) => listener({ k: 'gps', lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? 10 }),
    () => useStore.getState().setSensorError('Location permission needed'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
  const toRad = Math.PI / 180;
  const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
    let h: number | null = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.alpha != null && e.absolute) h = (360 - e.alpha) % 360;
    if (h != null) listener({ k: 'compass', bearing: corrected(h), acc: 10 });
    if (e.alpha != null && e.beta != null && e.gamma != null) {
      listener({ k: 'attitude', alpha: e.alpha * toRad, beta: e.beta * toRad, gamma: e.gamma * toRad });
    }
  };
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (a && a.x != null && a.y != null && a.z != null) listener({ k: 'accel', magnitude: Math.hypot(a.x, a.y, a.z) });
  };
  window.addEventListener('deviceorientationabsolute', onOrient as EventListener);
  window.addEventListener('deviceorientation', onOrient as EventListener);
  window.addEventListener('devicemotion', onMotion);
  return () => {
    if (watch != null) navigator.geolocation.clearWatch(watch);
    window.removeEventListener('deviceorientationabsolute', onOrient as EventListener);
    window.removeEventListener('deviceorientation', onOrient as EventListener);
    window.removeEventListener('devicemotion', onMotion);
  };
}

async function startNative(listener: Listener): Promise<Stop> {
  const Location = await import('expo-location');
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    useStore.getState().setSensorError('Location permission needed');
    return () => {};
  }
  useStore.getState().setSensorError(null);
  const posSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 500, distanceInterval: 0 },
    (p) => listener({ k: 'gps', lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? 10 }),
  );
  const headSub = await Location.watchHeadingAsync((h) => {
    const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
    // iOS reports degrees of error; Android reports a 0–3 quality level.
    const acc = h.accuracy > 3 ? h.accuracy : [25, 15, 8, 4][Math.max(0, Math.min(3, Math.round(h.accuracy)))];
    listener({ k: 'compass', bearing: corrected(heading), acc });
  });

  // Attitude (smooth turning, pitch) and accelerometer (steps). The game
  // still runs on GPS and compass alone if the motion sensor is missing.
  let motionSub: { remove: () => void } | null = null;
  try {
    const { DeviceMotion } = await import('expo-sensors');
    if (await DeviceMotion.isAvailableAsync()) {
      await DeviceMotion.requestPermissionsAsync().catch(() => null);
      DeviceMotion.setUpdateInterval(20);
      motionSub = DeviceMotion.addListener((m) => {
        if (m.rotation) listener({ k: 'attitude', alpha: m.rotation.alpha, beta: m.rotation.beta, gamma: m.rotation.gamma });
        const a = m.accelerationIncludingGravity;
        if (a) {
          const offset = offsetFromGravity(a.x, a.y);
          if (offset != null) headingOffset = offset;
          listener({ k: 'accel', magnitude: Math.hypot(a.x, a.y, a.z) });
        }
      });
    }
  } catch { /* no motion sensor: compass-only heading, level pitch, no step tracking */ }

  return () => { posSub.remove(); headSub.remove(); motionSub?.remove(); };
}
