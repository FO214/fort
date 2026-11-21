import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setHeadingOffset } from '../sensors';

/**
 * The mission is played sideways, phone on the gun. Lock to landscape (either
 * way round, whichever the mount needs) and tell the compass which way the
 * camera now faces relative to the phone's top edge. On a phone with a motion
 * sensor, gravity refines this within a frame; this is the fallback.
 */
export function useLandscape(): void {
  useEffect(() => {
    if (Platform.OS === 'web') {
      const apply = () => {
        const angle = typeof screen !== 'undefined' ? screen.orientation?.angle ?? 0 : 0;
        // 90: turned counter-clockwise, top edge to the left. 270: the other way.
        setHeadingOffset(angle === 90 ? 90 : angle === 270 ? -90 : 0);
      };
      apply();
      const target = typeof screen !== 'undefined' ? screen.orientation : undefined;
      target?.addEventListener?.('change', apply);
      return () => { target?.removeEventListener?.('change', apply); setHeadingOffset(0); };
    }

    let sub: ScreenOrientation.Subscription | null = null;
    let gone = false;
    const apply = (o: ScreenOrientation.Orientation) => {
      // LANDSCAPE_LEFT is the interface turned so the phone's top edge is on
      // the player's right; LANDSCAPE_RIGHT is the mirror image.
      if (o === ScreenOrientation.Orientation.LANDSCAPE_LEFT) setHeadingOffset(-90);
      else if (o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) setHeadingOffset(90);
    };
    (async () => {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      if (gone) return;
      apply(await ScreenOrientation.getOrientationAsync().catch(() => ScreenOrientation.Orientation.UNKNOWN));
      sub = ScreenOrientation.addOrientationChangeListener((e) => apply(e.orientationInfo.orientation));
    })();
    return () => {
      gone = true;
      sub?.remove();
      setHeadingOffset(0);
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);
}
