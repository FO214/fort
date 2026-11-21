/**
 * One WebSocket to the game server. Reconnects with the session token if
 * the link drops mid-mission, so a dead zone costs a few seconds, not the game.
 */
import { useStore } from '../store';
import type { ServerMsg, Settings } from './types';

type First = { t: 'create'; name: string; settings: Partial<Settings> } | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; player_id: string; token: string };

class NetClient {
  private ws: WebSocket | null = null;
  private byUser = false;
  private retry = 0;
  // Starts from the clock so a page reload mid-mission never reuses a number
  // the server has already seen (it drops repeats).
  private seq = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;

  get isOpen() { return this.ws?.readyState === WebSocket.OPEN; }

  connect(url: string, first: First): Promise<void> {
    this.byUser = false;
    this.clearTimer();
    this.ws?.close();
    const store = useStore.getState();
    store.setConnection(this.retry ? 'reconnecting' : 'connecting');
    store.setError(null);

    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch (e) { store.setConnection('closed'); reject(e); return; }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(first));
      ws.onmessage = (ev) => {
        let m: ServerMsg;
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (!settled && (m.t === 'welcome' || m.t === 'error')) {
          settled = true;
          if (m.t === 'welcome') { this.retry = 0; resolve(); } else { this.byUser = true; reject(new Error(m.msg)); }
        }
        useStore.getState().handle(m);
      };
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        const st = useStore.getState();
        if (!settled) { settled = true; st.setConnection('closed'); reject(new Error('Could not reach the server')); return; }
        if (this.byUser || !st.session) { st.setConnection('closed'); return; }
        st.setConnection('reconnecting');
        this.scheduleResume(url);
      };
    });
  }

  private scheduleResume(url: string) {
    const s = useStore.getState().session;
    if (!s) return;
    const delay = Math.min(8000, 800 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.connect(url, { t: 'resume', code: s.code, player_id: s.playerId, token: s.token })
        .catch(() => { /* onclose reschedules */ });
    }, delay);
  }

  send(obj: Record<string, unknown>) {
    if (this.isOpen) this.ws!.send(JSON.stringify(obj));
  }

  pos(x: number, y: number, acc: number, heading: number, pitch: number) {
    const r = (v: number, d: number) => Math.round(v * d) / d;
    this.send({ t: 'pos', x: r(x, 100), y: r(y, 100), acc: r(acc, 10), heading: r(heading, 10), pitch: r(Math.max(-90, Math.min(90, pitch)), 10) });
  }

  /** One trigger pull: the zombies under the crosshair (nearest first) and where the gun pointed. */
  fire(hits: number[], heading: number): number {
    const seq = ++this.seq;
    this.send({ t: 'fire', seq, hits: hits.slice(0, 8), heading: Math.round(heading * 10) / 10 });
    return seq;
  }

  reload() { this.send({ t: 'reload' }); }
  ready(ready: boolean) { this.send({ t: 'ready', ready }); }
  setClass(cls: string) { this.send({ t: 'set_class', cls }); }
  /** Host only. The fix (if any) anchors a map that has no fixed place in the world. */
  start(fix?: { lat: number; lon: number } | null) { this.send(fix ? { t: 'start', lat: fix.lat, lon: fix.lon } : { t: 'start' }); }
  /** Host only: back to the lobby (aborts a running mission). */
  reset() { this.send({ t: 'reset' }); }

  close() {
    this.byUser = true;
    this.clearTimer();
    this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.seq = Date.now();
    this.retry = 0;
    useStore.getState().setConnection('closed');
  }

  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
}

export const net = new NetClient();
