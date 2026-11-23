/**
 * What the game needs from the phone, and whether it has it.
 *
 *   camera    the live view behind the HUD
 *   location  where the player is in the building
 *   motion    where the blaster points and when the player steps (optional:
 *             the game still runs on GPS and compass without it)
 *
 * Nothing here triggers an OS prompt on its own. The lobby shows the
 * briefing first, and `request` runs when the player taps Allow.
 *
 * In a browser the page asks as each sensor is first used, so everything
 * reads as granted. `?perm=ask` on the web build stands in for a phone that
 * has not been asked yet, for tests.
 */
import * as ExpoCamera from 'expo-camera';
import * as Location from 'expo-location';
import * as Sensors from 'expo-sensors';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

export type Grant = 'granted' | 'denied' | 'undetermined';
export type PermissionKey = 'camera' | 'location' | 'motion';

export interface PermissionState {
  camera: Grant; location: Grant; motion: Grant;
  /** A denied permission the OS will not ask about again: only Settings can fix it. */
  blocked: boolean;
}

/** The two the mission cannot run without. */
export const REQUIRED: readonly PermissionKey[] = ['camera', 'location'];
export const permissionsReady = (p: PermissionState | null) => !!p && REQUIRED.every((k) => p[k] === 'granted');

const ALL_GRANTED: PermissionState = { camera: 'granted', location: 'granted', motion: 'granted', blocked: false };
const simulated = () => Platform.OS === 'web' && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('perm') === 'ask';

interface Raw { status: string; canAskAgain?: boolean }
const grant = (r: Raw | null): Grant => (r?.status === 'granted' ? 'granted' : r?.status === 'denied' ? 'denied' : 'undetermined');

async function read(ask: boolean): Promise<PermissionState> {
  // One at a time, so the OS shows one prompt after another rather than a pile.
  const location: Raw = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
  const camera: Raw = ask ? await ExpoCamera.Camera.requestCameraPermissionsAsync() : await ExpoCamera.Camera.getCameraPermissionsAsync();
  let motion: Raw | null = null;
  try {
    if (await Sensors.DeviceMotion.isAvailableAsync()) {
      motion = ask ? await Sensors.DeviceMotion.requestPermissionsAsync() : await Sensors.DeviceMotion.getPermissionsAsync();
    }
  } catch { /* no motion sensor */ }
  const required = [camera, location];
  return {
    camera: grant(camera), location: grant(location), motion: motion ? grant(motion) : 'granted',
    blocked: required.some((r) => r.status === 'denied' && r.canAskAgain === false),
  };
}

export function usePermissions(): { state: PermissionState | null; request: () => Promise<void>; openSettings: () => void } {
  const [state, setState] = useState<PermissionState | null>(
    Platform.OS === 'web' ? (simulated() ? { camera: 'undetermined', location: 'undetermined', motion: 'undetermined', blocked: false } : ALL_GRANTED) : null,
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let gone = false;
    read(false).then((s) => { if (!gone) setState(s); }).catch(() => { if (!gone) setState(ALL_GRANTED); });
    return () => { gone = true; };
  }, []);

  const request = useCallback(async () => {
    if (Platform.OS === 'web') { setState(ALL_GRANTED); return; }
    try { setState(await read(true)); } catch { /* leave the state as it was */ }
  }, []);

  const openSettings = useCallback(() => { Linking.openSettings().catch(() => {}); }, []);
  return { state, request, openSettings };
}
