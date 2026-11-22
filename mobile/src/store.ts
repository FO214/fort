import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ZombieBuffer } from './game/zombies';
import type { EndedMsg, GunClass, LobbyPlayer, MapChoice, MapInfo, MissionState, PlayerSnap, RoomPhase, ServerMsg, Settings } from './net/types';

export type AppPhase = 'menu' | 'join' | 'lobby' | 'playing' | 'summary';
export type Connection = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface FeedItem { key: string; at: number; text: string; detail?: string; tone: 'good' | 'bad' | 'plain' }
export interface ShotFeedback { key: number; at: number; kind: 'hit' | 'kill' | 'miss'; reason: string }
export interface Damage { key: number; at: number; dir: number | null; damage: number; hp: number }

export interface Session { code: string; playerId: string; token: string }

/**
 * Zombies arrive ten times a second and are drawn every frame, so they live
 * outside React state: the AR layer reads this buffer directly.
 */
export const zombies = new ZombieBuffer();

interface State {
  phase: AppPhase;
  name: string;
  serverUrl: string;
  connection: Connection;
  error: string | null;

  session: Session | null;
  hostId: string | null;
  classes: Record<string, GunClass>;
  settings: Settings | null;
  roster: LobbyPlayer[];
  roomPhase: RoomPhase;
  map: MapInfo | null;
  /** Every map the server offers, for the host's picker in the lobby. */
  maps: MapChoice[];
  serverOffset: number;        // seconds to add to Date.now()/1000 to get server time

  /** Bumped by every `started`, so the tracker knows to re-anchor the map. */
  missionSeq: number;
  mission: MissionState;
  /** Hold-to-extract during the final wave. */
  extract: { progress: number; need: number; holders: string[] };
  squad: PlayerSnap[];
  zombieCount: number;
  ammo: number;
  reloadingUntil: number;
  shots: ShotFeedback[];
  damages: Damage[];
  feed: FeedItem[];
  ended: EndedMsg | null;

  gpsAcc: number | null;       // newest reported GPS accuracy, null before the first fix
  hasCompass: boolean;
  sensorError: string | null;
  /** The player's physical gun: none, waiting for its first trigger pull, or paired and connected. */
  gun: 'none' | 'pairing' | 'paired';
  /** Call after sending pair_gun; shows "pairing" until a gun answers or the window closes. */
  startPairing: () => void;

  setName: (n: string) => void;
  setServerUrl: (u: string) => void;
  setPhase: (p: AppPhase) => void;
  setError: (e: string | null) => void;
  setConnection: (c: Connection) => void;
  setGpsAcc: (a: number) => void;
  setHasCompass: (v: boolean) => void;
  setSensorError: (e: string | null) => void;
  handle: (m: ServerMsg) => void;
  leave: () => void;
  hydrate: () => Promise<void>;
}

const KEY = 'loonie.prefs.v2';
const DEFAULT_URL = 'ws://localhost:8000/ws';
const NO_MISSION: MissionState = { phase: 'journey', wave: 0, left: 0, total: 0, hold: [0, 2] };
const NO_EXTRACT = { progress: 0, need: 2, holders: [] as string[] };

/**
 * Where to find the game server before the user has set one.
 * A `?server=` in the page address wins (tests), then a build-time
 * EXPO_PUBLIC_SERVER_URL. Otherwise, on the web, use the machine that served
 * the page: phones opening http://<laptop-ip>:8081 then reach
 * ws://<laptop-ip>:8000/ws with no setup. Native has no page origin.
 */
function defaultServerUrl(): string {
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  const fromQuery = loc?.search ? new URLSearchParams(loc.search).get('server') : null;
  if (fromQuery) return fromQuery;
  // Written out in full so Expo can inline it at build time.
  const fromBuild = process.env.EXPO_PUBLIC_SERVER_URL;
  if (fromBuild) return fromBuild;
  if (loc?.hostname) return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:8000/ws`;
  return DEFAULT_URL;
}

let feedback = 0;
const feedItem = (text: string, tone: FeedItem['tone'], detail?: string): FeedItem =>
  ({ key: `f${++feedback}`, at: Date.now() / 1000, text, detail, tone });

export const useStore = create<State>((set, get) => ({
  phase: 'menu',
  name: '',
  serverUrl: defaultServerUrl(),
  connection: 'idle',
  error: null,
  session: null,
  hostId: null,
  classes: {},
  settings: null,
  roster: [],
  roomPhase: 'lobby',
  map: null,
  maps: [],
  serverOffset: 0,
  missionSeq: 0,
  mission: NO_MISSION,
  extract: NO_EXTRACT,
  squad: [],
  zombieCount: 0,
  ammo: 0,
  reloadingUntil: 0,
  shots: [],
  damages: [],
  feed: [],
  ended: null,
  gpsAcc: null,
  hasCompass: false,
  sensorError: null,
  gun: 'none',

  setName: (name) => { set({ name }); persist(get); },
  setServerUrl: (serverUrl) => { set({ serverUrl }); persist(get); },
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error }),
  setConnection: (connection) => set({ connection }),
  setGpsAcc: (gpsAcc) => set({ gpsAcc }),
  setHasCompass: (hasCompass) => set({ hasCompass }),
  setSensorError: (sensorError) => set({ sensorError }),
  startPairing: () => {
    set({ gun: 'pairing' });
    // The server's window is 10 s; give up on screen a moment after.
    setTimeout(() => { if (get().gun === 'pairing') set({ gun: 'none' }); }, 11000);
  },

  handle: (m) => {
    const s = get();
    const now = Date.now() / 1000;
    const myId = s.session?.playerId;
    switch (m.t) {
      case 'welcome': {
        const session = { code: m.code, playerId: m.player_id, token: m.token };
        set({ session, hostId: m.host_id, classes: m.classes, map: m.map, maps: m.maps ?? [], error: null, connection: 'open' });
        persist(get, session);
        return;
      }
      case 'lobby': {
        const next: Partial<State> = { hostId: m.host_id, settings: m.settings, roster: m.players, roomPhase: m.phase };
        // In the lobby the host may switch maps. Mid-mission `started` owns the map (it carries the anchor).
        if (m.phase === 'lobby' && m.map) next.map = m.map;
        if (m.phase === 'lobby' && (s.phase === 'playing' || s.phase === 'summary')) {
          // Host sent everyone back to the lobby (play again, or an abort).
          next.phase = 'lobby'; next.ended = null;
          zombies.clear();
        }
        if (s.phase === 'menu' || s.phase === 'join') next.phase = m.phase === 'playing' ? 'playing' : m.phase === 'ended' ? 'summary' : 'lobby';
        set(next);
        return;
      }
      case 'started': {
        const me = s.roster.find((p) => p.id === myId);
        const cls = me ? s.classes[me.cls] : undefined;
        const fresh = s.phase !== 'playing';       // a reconnect re-sends `started` mid-mission
        if (fresh) zombies.clear();
        set({
          phase: 'playing', roomPhase: 'playing', map: m.map, mission: m.mission, serverOffset: m.now - now,
          missionSeq: s.missionSeq + 1, ended: null,
          ...(fresh ? { ammo: cls?.magazine ?? 0, reloadingUntil: 0, shots: [], damages: [], feed: [], squad: [], zombieCount: 0, extract: NO_EXTRACT } : {}),
        });
        return;
      }
      case 'snap': {
        // Smooth the clock offset so one delayed packet doesn't jerk the world.
        const target = m.now - now;
        const serverOffset = s.serverOffset === 0 ? target : s.serverOffset + (target - s.serverOffset) * 0.1;
        zombies.push(m.now, m.z);
        const me = m.p.find((p) => p.id === myId);
        const next: Partial<State> = {
          squad: m.p, serverOffset, zombieCount: m.z.length,
          mission: { phase: m.ph, wave: m.wave[0], left: m.wave[1], total: m.wave[2], hold: m.hold },
          extract: { progress: m.ex[0], need: m.ex[1], holders: m.ex[2] },
        };
        if (me) { next.ammo = me.ammo; next.reloadingUntil = me.rl; }
        if (s.phase !== 'playing' && s.roomPhase === 'playing') next.phase = 'playing';
        set(next);
        return;
      }
      case 'fired': {
        if (m.player_id !== myId) return;
        const killed = m.hits.some(([, hp]) => hp <= 0);
        const kind = killed ? 'kill' : m.reason === 'hit' ? 'hit' : 'miss';
        const shot: ShotFeedback = { key: ++feedback, at: now, kind, reason: m.reason };
        set({ ammo: m.ammo, shots: [...s.shots.slice(-5), shot] });
        return;
      }
      case 'zhit':
        zombies.onHit(m.id, now + s.serverOffset);
        return;
      case 'zkill':
        zombies.onKill(m.id, m.x, m.y, now + s.serverOffset);
        return;
      case 'hurt': {
        if (m.player_id !== myId) return;
        const d: Damage = { key: ++feedback, at: now, dir: m.dir, damage: m.dmg, hp: m.hp };
        set({ damages: [...s.damages.slice(-5), d] });
        return;
      }
      case 'knocked':
        set({ feed: [...s.feed.slice(-5), feedItem(m.player_id === myId ? 'You' : m.name, 'bad', 'knocked')] });
        return;
      case 'revived':
        set({ feed: [...s.feed.slice(-5), feedItem(m.by === myId ? 'You' : m.by_name, 'good', `revived ${m.player_id === myId ? 'you' : m.name}`)] });
        return;
      case 'dead':
        set({ feed: [...s.feed.slice(-5), feedItem(m.player_id === myId ? 'You' : m.name, 'bad', m.player_id === myId ? 'are dead' : 'is dead')] });
        return;
      case 'phase': {
        const item = m.phase === 'holdout' ? feedItem('Helicopter reached', 'good', `hold for ${m.hold?.[1] ?? 2} waves`)
          : m.phase === 'final' ? feedItem('Final wave', 'bad', 'extract now') : null;
        set({ mission: { ...s.mission, phase: m.phase, hold: m.hold ?? s.mission.hold }, ...(item ? { feed: [...s.feed.slice(-5), item] } : {}) });
        return;
      }
      case 'extract':
        set({ extract: { progress: m.progress, need: m.need, holders: m.holders } });
        return;
      case 'wave': {
        const label = m.phase === 'final' ? 'Final wave' : `Wave ${m.n}`;
        set({ feed: [...s.feed.slice(-5), m.cleared ? feedItem(label, 'good', 'cleared') : feedItem(label, 'plain', `${m.count ?? ''} incoming`)] });
        return;
      }
      case 'gun':
        set({ gun: m.on ? 'paired' : 'none' });
        return;
      case 'reload':
        if (m.player_id === myId) set({ reloadingUntil: m.until });
        return;
      case 'reloaded':
        if (m.player_id === myId) set({ ammo: m.ammo, reloadingUntil: 0 });
        return;
      case 'ended':
        zombies.clear();
        set({ phase: 'summary', roomPhase: 'ended', ended: m });
        return;
      case 'error':
        set({ error: m.msg });
        return;
      default:
        return;
    }
  },

  leave: () => {
    zombies.clear();
    set({
      phase: 'menu', session: null, hostId: null, roster: [], settings: null, roomPhase: 'lobby',
      ended: null, feed: [], shots: [], damages: [], squad: [], mission: NO_MISSION, extract: NO_EXTRACT, zombieCount: 0,
      error: null, connection: 'idle', gun: 'none',
    });
    persist(get, null);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { name?: string; serverUrl?: string; session?: Session | null };
      const pinned = typeof window !== 'undefined' && !!window.location?.search && new URLSearchParams(window.location.search).has('server');
      set({ name: p.name ?? '', serverUrl: pinned ? get().serverUrl : p.serverUrl ?? get().serverUrl });
      if (p.session) set({ session: p.session });
    } catch { /* first run */ }
  },
}));

async function persist(get: () => State, session?: Session | null) {
  const s = get();
  const payload = { name: s.name, serverUrl: s.serverUrl, session: session === undefined ? s.session : session };
  try { await AsyncStorage.setItem(KEY, JSON.stringify(payload)); } catch { /* storage unavailable */ }
}

export const selectMe = (s: State) => s.squad.find((p) => p.id === s.session?.playerId);
export const selectMyLobby = (s: State) => s.roster.find((p) => p.id === s.session?.playerId);
export const selectClass = (s: State) => { const me = selectMyLobby(s); return me ? s.classes[me.cls] : undefined; };
export const serverNow = () => Date.now() / 1000 + useStore.getState().serverOffset;

// Debug/e2e hook: lets a test read client state on the web build.
if (typeof window !== 'undefined') {
  const w = window as unknown as { __loonieStore?: unknown; __loonieZombies?: unknown };
  w.__loonieStore = useStore;
  w.__loonieZombies = zombies;
}
