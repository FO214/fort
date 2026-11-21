/**
 * Position + heading, from whichever source the platform has:
 *   native  → expo-location (fused GPS + compass)
 *   web     → navigator.geolocation + deviceorientation
 *   sim     → window.__loonieSim, driven by tests (web with ?sim=1)
 * All three emit the same SensorFix shape. Swapping this module for an
 * ARCore Geospatial / camera-bearing source later is the intended upgrade path.
 */
import { Platform } from 'react-native';
import type { SensorFix } from '../net/types';
import { useStore } from '../store';

export type Listener = (fix: SensorFix) => void;
export type Stop = () => void;

declare global {
  interface Window { __loonieSim?: SimHandle }
}

export interface SimHandle {
  fix: SensorFix;
  listeners: Set<Listener>;
  set: (partial: Partial<SensorFix>) => void;
}

const nowS = () => Date.now() / 1000;

/**
 * The compass reports where the phone's TOP EDGE points (iOS headingOrientation
 * stays portrait; expo-location doesn't remap on Android either). In the game's
 * landscape lock — LANDSCAPE_LEFT, home button on the right — the top edge sits
 * 90° counter-clockwise from the camera, so camera = reported + 90.
 * If a real-device check shows north 180° out, this is the number to flip.
 */
export const LANDSCAPE_LEFT_HEADING_OFFSET = 90;
let headingOffset = 0;
export function setHeadingOffset(deg: number) { headingOffset = deg; }
const corrected = (raw: number) => (((raw + headingOffset) % 360) + 360) % 360;

export function isSim(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sim') === '1' || !!window.__loonieSim;
}

export function simHandle(): SimHandle {
  if (!window.__loonieSim) {
    const h: SimHandle = {
      fix: { lat: 43.4723, lon: -80.5449, acc: 3, heading: 0, headingAcc: 5, ts: nowS() },
      listeners: new Set(),
      set(partial) {
        h.fix = { ...h.fix, ...partial, ts: nowS() };
        h.listeners.forEach((l) => l(h.fix));
      },
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
  listener(h.fix);
  return () => h.listeners.delete(listener);
}

function startWeb(listener: Listener): Stop {
  let fix: SensorFix = { lat: 0, lon: 0, acc: 50, heading: null, headingAcc: null, ts: nowS() };
  let haveFix = false;
  const emit = () => { if (haveFix) listener({ ...fix, ts: nowS() }); };
  const watch = navigator.geolocation?.watchPosition(
    (p) => { fix = { ...fix, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? 10 }; haveFix = true; emit(); },
    () => { /* denied: stay without a fix */ },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
  const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
    let h: number | null = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.alpha != null && (e as DeviceOrientationEvent).absolute) h = (360 - e.alpha) % 360;
    if (h != null) { fix = { ...fix, heading: corrected(h), headingAcc: 10 }; emit(); }
  };
  window.addEventListener('deviceorientationabsolute', onOrient as EventListener);
  window.addEventListener('deviceorientation', onOrient as EventListener);
  return () => {
    if (watch != null) navigator.geolocation.clearWatch(watch);
    window.removeEventListener('deviceorientationabsolute', onOrient as EventListener);
    window.removeEventListener('deviceorientation', onOrient as EventListener);
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
  let fix: SensorFix = { lat: 0, lon: 0, acc: 50, heading: null, headingAcc: null, ts: nowS() };
  let haveFix = false;
  let lastEmit = 0;
  const emit = (force = false) => {
    const t = Date.now();
    if (!haveFix || (!force && t - lastEmit < 80)) return;
    lastEmit = t;
    listener({ ...fix, ts: nowS() });
  };
  const posSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 250, distanceInterval: 0 },
    (p) => { fix = { ...fix, lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy ?? 10 }; haveFix = true; emit(true); },
  );
  const headSub = await Location.watchHeadingAsync((h) => {
    const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
    // iOS reports degrees of error; Android reports a 0–3 quality level.
    const acc = h.accuracy > 3 ? h.accuracy : [25, 15, 8, 4][Math.max(0, Math.min(3, Math.round(h.accuracy)))];
    fix = { ...fix, heading: corrected(heading), headingAcc: acc };
    emit();
  });
  return () => { posSub.remove(); headSub.remove(); };
}
