import { useEffect } from 'react';
import { net } from '../net/client';
import { startSensors } from '../sensors';
import { useStore } from '../store';

const SEND_EVERY_MS = 250;      // 4 Hz to the server
const KEEPALIVE_MS = 900;       // resend the last fix if the sensors go quiet

/** Streams position + heading into the store and to the server while mounted. */
export function useGameLoop(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let lastSent = 0;
    const stop = startSensors((f) => {
      useStore.getState().setFix(f);
      const t = Date.now();
      if (t - lastSent >= SEND_EVERY_MS) { lastSent = t; net.pos(f); }
    });
    const keep = setInterval(() => {
      const f = useStore.getState().fix;
      if (f && Date.now() - lastSent > KEEPALIVE_MS) { lastSent = Date.now(); net.pos(f); }
    }, 300);
    return () => { stop(); clearInterval(keep); };
  }, [active]);
}
