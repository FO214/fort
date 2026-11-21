/**
 * One WebSocket to the match server. Reconnects with the session token if
 * the link drops mid-match, so a dead zone costs a few seconds, not the game.
 */
import { serverNow, useStore } from '../store';
import type { SensorFix, ServerMsg, Settings } from './types';

type First = { t: 'create'; name: string; settings: Partial<Settings> } | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; player_id: string; token: string };

class NetClient {
  private ws: WebSocket | null = null;
  private byUser = false;
  private retry = 0;
  private seq = 0;
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

  pos(f: SensorFix) {
    this.send({ t: 'pos', lat: f.lat, lon: f.lon, acc: f.acc, heading: f.heading, heading_acc: f.headingAcc, ts: serverNow() });
  }

  fire(targetId: string | null): number {
    const seq = ++this.seq;
    this.send({ t: 'fire', seq, target_id: targetId, ts: serverNow() });
    return seq;
  }

  reload() { this.send({ t: 'reload' }); }
  ready(ready: boolean) { this.send({ t: 'ready', ready }); }
  setWeapon(weapon: string) { this.send({ t: 'set_weapon', weapon }); }
  setTeam(team: 'alpha' | 'bravo') { this.send({ t: 'set_team', team }); }
  settings(settings: Settings) { this.send({ t: 'settings', settings }); }
  start() { this.send({ t: 'start' }); }
  end() { this.send({ t: 'end' }); }

  close() {
    this.byUser = true;
    this.clearTimer();
    this.send({ t: 'leave' });
    this.ws?.close();
    this.ws = null;
    this.seq = 0;
    this.retry = 0;
    useStore.getState().setConnection('closed');
  }

  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
}

export const net = new NetClient();
