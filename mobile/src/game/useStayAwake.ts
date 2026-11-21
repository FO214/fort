import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Keeps the screen on while mounted. A phone on a gun goes long stretches
 * without a touch. Browsers may refuse a wake lock (no user gesture yet, tab
 * in the background); that is not worth an error.
 */
export function useStayAwake(tag: string): void {
  useEffect(() => {
    let active = false;
    let gone = false;
    activateKeepAwakeAsync(tag).then(() => {
      active = true;
      if (gone) deactivateKeepAwake(tag).catch(() => {});
    }).catch(() => {});
    return () => {
      gone = true;
      if (active) deactivateKeepAwake(tag).catch(() => {});
    };
  }, [tag]);
}
