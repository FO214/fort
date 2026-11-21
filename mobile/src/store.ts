import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlayerPub, Result, SensorFix, ServerMsg, Settings, Weapon } from './net/types';

export type AppPhase = 'menu' | 'join' | 'lobby' | 'playing' | 'summary';
export type Connection = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface FeedItem { key: string; at: number; shooter: string; target: string; weapon: string; mine: 'kill' | 'death' | null }
export interface ShotFeedback { key: number; at: number; kind: 'hit' | 'kill' | 'miss'; reason: string; off?: number; gate?: number; dist?: number }
export interface Damage { key: number; at: number; dir: number | null; damage: number; hp: number; shooter: string }

export interface Session { code: string; playerId: string; token: string }

interface State {
  phase: AppPhase;
  name: string;
  serverUrl: string;
  connection: Connection;
  error: string | null;

  session: Session | null;
  hostId: string | null;
  weapons: Record<string, Weapon>;
  settings: Settings | null;
  players: PlayerPub[];
  roomPhase: 'lobby' | 'playing' | 'ended';
  endsAt: number;
  serverOffset: number;        // seconds to add to Date.now()/1000 to get server time

  fix: SensorFix | null;
  sensorError: string | null;
  ammo: number;
  reloadingUntil: number;
  shots: ShotFeedback[];
  damages: Damage[];
  feed: FeedItem[];
  deadUntil: number | null;
  results: Result[] | null;
  teamsResult: { alpha: number; bravo: number } | null;
  durationS: number;

  setName: (n: string) => void;
  setServerUrl: (u: string) => void;
  setPhase: (p: AppPhase) => void;
  setError: (e: string | null) => void;
  setConnection: (c: Connection) => void;
  setFix: (f: SensorFix) => void;
  setSensorError: (e: string | null) => void;
  handle: (m: ServerMsg) => void;
  leave: () => void;
  hydrate: () => Promise<void>;
}

const KEY = 'loonie.prefs.v1';
const DEFAULT_URL = 'ws://localhost:8000/ws';

/**
 * Where to find the match server before the user has set one.
 * A build-time EXPO_PUBLIC_SERVER_URL wins. Otherwise, on the web, use the
 * machine that served the page: phones opening http://<laptop-ip>:8081 then
 * reach ws://<laptop-ip>:8000/ws with no setup. Native has no page origin.
 */
function defaultServerUrl(): string {
  // Written out in full so Expo can inline it at build time.
  const fromBuild = process.env.EXPO_PUBLIC_SERVER_URL;
  if (fromBuild) return fromBuild;
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  if (loc?.hostname) return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:8000/ws`;
  return DEFAULT_URL;
}

let feedback = 0;

export const useStore = create<State>((set, get) => ({
  phase: 'menu',
  name: '',
  serverUrl: defaultServerUrl(),
  connection: 'idle',
  error: null,
  session: null,
  hostId: null,
  weapons: {},
  settings: null,
  players: [],
  roomPhase: 'lobby',
  endsAt: 0,
  serverOffset: 0,
  fix: null,
  sensorError: null,
  ammo: 0,
  reloadingUntil: 0,
  shots: [],
  damages: [],
  feed: [],
  deadUntil: null,
  results: null,
  teamsResult: null,
  durationS: 0,

  setName: (name) => { set({ name }); persist(get); },
  setServerUrl: (serverUrl) => { set({ serverUrl }); persist(get); },
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error }),
  setConnection: (connection) => set({ connection }),
  setFix: (fix) => set({ fix }),
  setSensorError: (sensorError) => set({ sensorError }),

  handle: (m) => {
    const s = get();
    const now = Date.now() / 1000;
    switch (m.t) {
      case 'welcome': {
        const session = { code: m.code, playerId: m.player_id, token: m.token };
        set({ session, hostId: m.host_id, weapons: m.weapons, error: null, connection: 'open' });
        persist(get, session);
        return;
      }
      case 'lobby': {
        const next: Partial<State> = { hostId: m.host_id, settings: m.settings, players: m.players, roomPhase: m.phase };
        if (m.phase === 'lobby' && s.phase !== 'lobby' && s.phase !== 'menu' && s.phase !== 'join') {
          // Host reset the room after a match.
          next.phase = 'lobby'; next.results = null;
        }
        if (s.phase === 'menu' || s.phase === 'join') next.phase = m.phase === 'playing' ? 'playing' : m.phase === 'ended' ? 'summary' : 'lobby';
        set(next);
        return;
      }
      case 'started': {
        const me = s.players.find((p) => p.id === s.session?.playerId);
        const w = me ? s.weapons[me.weapon] : undefined;
        set({
          phase: 'playing', roomPhase: 'playing', endsAt: m.ends_at, serverOffset: m.now - now,
          settings: m.settings, ammo: w?.magazine ?? 0, reloadingUntil: 0, shots: [], damages: [], feed: [],
          deadUntil: null, results: null,
        });
        return;
      }
      case 'snapshot': {
        // Smooth the clock offset so one delayed packet doesn't jerk the timer.
        const target = m.now - now;
        const serverOffset = s.serverOffset === 0 ? target : s.serverOffset + (target - s.serverOffset) * 0.2;
        const me = m.players.find((p) => p.id === s.session?.playerId);
        const next: Partial<State> = { players: m.players, endsAt: m.ends_at, serverOffset, roomPhase: m.phase };
        if (me) {
          next.ammo = me.ammo;
          next.reloadingUntil = me.reloading_until;
          next.deadUntil = me.alive ? null : me.respawn_at || -1;
        }
        if (m.phase === 'playing' && s.phase !== 'playing') next.phase = 'playing';
        set(next);
        return;
      }
      case 'fired': {
        if (m.player_id !== s.session?.playerId) return;
        const kind = m.reason === 'hit' ? 'hit' : 'miss';
        const shot: ShotFeedback = { key: ++feedback, at: now, kind, reason: m.reason, off: m.off, gate: m.gate, dist: m.dist };
        set({ ammo: m.ammo, shots: [...s.shots.slice(-5), shot] });
        return;
      }
      case 'hit': {
        if (m.target_id === s.session?.playerId) {
          const shooter = s.players.find((p) => p.id === m.shooter_id)?.name ?? '???';
          const d: Damage = { key: ++feedback, at: now, dir: m.dir, damage: m.damage, hp: m.hp, shooter };
          set({ damages: [...s.damages.slice(-5), d] });
        }
        return;
      }
      case 'killed': {
        const mine = m.shooter_id === s.session?.playerId ? 'kill' : m.target_id === s.session?.playerId ? 'death' : null;
        const item: FeedItem = { key: `${m.at}-${m.target_id}`, at: now, shooter: m.shooter, target: m.target, weapon: m.weapon, mine };
        const next: Partial<State> = { feed: [...s.feed.slice(-5), item] };
        if (mine === 'kill') {
          const last = s.shots[s.shots.length - 1];
          next.shots = [...s.shots.slice(0, -1), { ...(last ?? { key: ++feedback, at: now, reason: 'hit' }), kind: 'kill' as const }];
        }
        if (mine === 'death') next.deadUntil = m.respawn_at || -1;
        set(next);
        return;
      }
      case 'respawned': {
        if (m.player_id === s.session?.playerId) {
          const me = s.players.find((p) => p.id === m.player_id);
          const w = me ? s.weapons[me.weapon] : undefined;
          set({ deadUntil: null, ammo: w?.magazine ?? s.ammo, reloadingUntil: 0 });
        }
        return;
      }
      case 'reload':
        if (m.player_id === s.session?.playerId) set({ reloadingUntil: m.until });
        return;
      case 'reloaded':
        if (m.player_id === s.session?.playerId) set({ ammo: m.ammo, reloadingUntil: 0 });
        return;
      case 'ended':
        set({ phase: 'summary', roomPhase: 'ended', results: m.results, teamsResult: m.teams, durationS: m.duration_s });
        return;
      case 'error':
        set({ error: m.msg });
        return;
      default:
        return;
    }
  },

  leave: () => {
    set({
      phase: 'menu', session: null, hostId: null, players: [], settings: null, roomPhase: 'lobby',
      results: null, feed: [], shots: [], damages: [], deadUntil: null, error: null, connection: 'idle',
    });
    persist(get, null);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { name?: string; serverUrl?: string; session?: Session | null };
      set({ name: p.name ?? '', serverUrl: p.serverUrl ?? get().serverUrl });
      if (p.session) set({ session: p.session });
    } catch { /* first run */ }
  },
}));

async function persist(get: () => State, session?: Session | null) {
  const s = get();
  const payload = { name: s.name, serverUrl: s.serverUrl, session: session === undefined ? s.session : session };
  try { await AsyncStorage.setItem(KEY, JSON.stringify(payload)); } catch { /* storage unavailable */ }
}

export const selectMe = (s: State) => s.players.find((p) => p.id === s.session?.playerId);
export const selectWeapon = (s: State) => { const me = selectMe(s); return me ? s.weapons[me.weapon] : undefined; };
export const serverNow = () => Date.now() / 1000 + useStore.getState().serverOffset;

// Debug/e2e hook: lets a test read client state on the web build.
if (typeof window !== 'undefined') (window as unknown as { __loonieStore?: unknown }).__loonieStore = useStore;
