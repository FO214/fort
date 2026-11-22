import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ZombieBuffer } from './game/zombies';
import type { EndedMsg, GameMode, GunClass, LobbyPlayer, MapChoice, MapInfo, MissionState, PlayerSnap, RoomPhase, ServerMsg, Settings } from './net/types';

export type AppPhase = 'menu' | 'join' | 'lobby' | 'playing' | 'summary';
export type Connection = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface FeedItem { key: string; at: number; text: string; detail?: string; tone: 'good' | 'bad' | 'plain' }
/** A mission-level moment worth a banner: a wave starting, the objective changing. */
export interface Banner { key: string; at: number; title: string; detail?: string; tone: 'objective' | 'danger' | 'neutral' }
/**
 * The player's physical gun.
 *   none      never paired
 *   pairing   the 10 s window is open, waiting for a trigger pull
 *   paired    a gun answered and is connected
 *   timeout   the window closed with no gun
 *   lost      a paired gun dropped off the network
 */
export type GunLink = 'none' | 'pairing' | 'paired' | 'timeout' | 'lost';
export interface Prefs {
  haptics: boolean; sound: boolean; hudScale: number;
  /** The furthest wave this phone has reached in endless mode. */
  bestEndlessWave: number;
}
export const HUD_SCALES = [0.9, 1, 1.12] as const;
/** The server's pairing window (backend/app/devices.py, PAIR_WINDOW_S). */
export const PAIR_WINDOW_S = 10;
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
  /** Which way this run is played. The lobby's choice until a run starts, then the run's own. */
  mode: GameMode;
  /** Server time the run began, 0 if the server did not say. */
  startedAt: number;
  /** The endless record before this run's result came in, so the results can say "new best". */
  previousBest: number;
  /** Hold-to-extract during the final wave. */
  extract: { progress: number; need: number; holders: string[] };
  squad: PlayerSnap[];
  zombieCount: number;
  ammo: number;
  reloadingUntil: number;
  shots: ShotFeedback[];
  damages: Damage[];
  feed: FeedItem[];
  banner: Banner | null;
  ended: EndedMsg | null;
  /**
   * False from the moment the host starts until this player has turned the
   * phone, mounted it and counted in. A phone that rejoins a mission already
   * under way skips straight to the HUD.
   */
  deployed: boolean;
  setDeployed: (v: boolean) => void;

  gpsAcc: number | null;       // newest reported GPS accuracy, null before the first fix
  hasCompass: boolean;
  sensorError: string | null;
  gun: GunLink;
  /** `Date.now() / 1000` at which the pairing window closes. */
  pairingUntil: number;
  /** Call after sending pair_gun; shows "pairing" until a gun answers or the window closes. */
  startPairing: () => void;
  /** `Date.now() / 1000` when the link to the server dropped, 0 while it is up. */
  lostAt: number;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  /** Set when the host leaves and the server hands the mission to someone else. */
  hostNote: string | null;
  setHostNote: (n: string | null) => void;
  /** The design-system gallery is open (a QA screen, not part of the game). */
  gallery: boolean;
  setGallery: (v: boolean) => void;

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

/** `?profile=name` keeps a second simulated phone in the same browser from sharing this one's saved session. */
const PROFILE = typeof window !== 'undefined' && !!window.location?.search ? new URLSearchParams(window.location.search).get('profile') : null;
const KEY = PROFILE ? `loonie.prefs.v2:${PROFILE}` : 'loonie.prefs.v2';
const DEFAULT_PREFS: Prefs = { haptics: true, sound: true, hudScale: 1, bestEndlessWave: 0 };
/** Tests and the walkthrough can skip the deploy sequence with `?deploy=skip`. */
const SKIP_DEPLOY = typeof window !== 'undefined' && !!window.location?.search
  && new URLSearchParams(window.location.search).get('deploy') === 'skip';
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
const bannerOf = (title: string, tone: Banner['tone'], detail?: string): Banner =>
  ({ key: `b${++feedback}`, at: Date.now() / 1000, title, detail, tone });
let pairTimer: ReturnType<typeof setTimeout> | null = null;

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
  mode: 'mission',
  startedAt: 0,
  previousBest: 0,
  extract: NO_EXTRACT,
  squad: [],
  zombieCount: 0,
  ammo: 0,
  reloadingUntil: 0,
  shots: [],
  damages: [],
  feed: [],
  banner: null,
  ended: null,
  deployed: true,
  gpsAcc: null,
  hasCompass: false,
  sensorError: null,
  gun: 'none',
  pairingUntil: 0,
  lostAt: 0,
  prefs: DEFAULT_PREFS,
  gallery: typeof window !== 'undefined' && !!window.location?.search && new URLSearchParams(window.location.search).get('gallery') === '1',
  setGallery: (gallery) => set({ gallery }),
  hostNote: null,
  setHostNote: (hostNote) => set({ hostNote }),

  setName: (name) => { set({ name }); persist(get); },
  setServerUrl: (serverUrl) => { set({ serverUrl }); persist(get); },
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error }),
  setConnection: (connection) => set((st) => ({
    connection,
    lostAt: connection === 'open' || connection === 'idle' ? 0 : st.lostAt || Date.now() / 1000,
    // Back after a drop, mid-mission: say so. The mission state comes with the next snapshot.
    ...(connection === 'open' && st.connection === 'reconnecting' && st.phase === 'playing'
      ? { banner: bannerOf('Reconnected', 'neutral', 'Back in the mission') } : {}),
  })),
  setDeployed: (deployed) => set({ deployed }),
  setPrefs: (p) => { set((st) => ({ prefs: { ...st.prefs, ...p } })); persist(get); },
  setGpsAcc: (gpsAcc) => set({ gpsAcc }),
  setHasCompass: (hasCompass) => set({ hasCompass }),
  setSensorError: (sensorError) => set({ sensorError }),
  startPairing: () => {
    set({ gun: 'pairing', pairingUntil: Date.now() / 1000 + PAIR_WINDOW_S });
    // The server closes its window at 10 s; say so on screen a moment after.
    if (pairTimer) clearTimeout(pairTimer);
    pairTimer = setTimeout(() => { if (get().gun === 'pairing') set({ gun: 'timeout' }); }, PAIR_WINDOW_S * 1000 + 600);
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
        if (m.phase === 'lobby') next.mode = m.settings.mode ?? 'mission';
        // The host left and the server passed the mission on: tell everyone who has it now.
        if (s.hostId && m.host_id !== s.hostId) {
          const mine = m.host_id === myId;
          const who = m.players.find((p) => p.id === m.host_id)?.name ?? 'Someone else';
          next.hostNote = mine ? 'The host left. You are the host now.' : `The host left. ${who} is the host now.`;
          if (s.phase === 'playing') next.banner = bannerOf(mine ? 'You are the host' : 'Host left', 'neutral', mine ? 'The mission menu is yours' : `${who} is the host now`);
        }
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
        const mode: GameMode = m.mode ?? (m.mission.phase === 'endless' ? 'endless' : 'mission');
        set({
          phase: 'playing', roomPhase: 'playing', map: m.map, mission: m.mission, serverOffset: m.now - now,
          missionSeq: s.missionSeq + 1, ended: null, mode, startedAt: m.at ?? m.now,
          ...(fresh ? {
            ammo: cls?.magazine ?? 0, reloadingUntil: 0, shots: [], damages: [], feed: [], squad: [], zombieCount: 0, extract: NO_EXTRACT,
            // The run's opening line, shown as the HUD comes up.
            banner: mode === 'endless' ? bannerOf('Endless', 'objective', 'Hold out as long as you can') : bannerOf('Reach the helicopter', 'objective', 'Stay together'),
            // Only a start seen from the lobby needs the phone turned and mounted.
            deployed: SKIP_DEPLOY || s.phase !== 'lobby',
          } : {}),
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
        set({ feed: [...s.feed.slice(-5), feedItem(m.player_id === myId ? 'You' : m.name, 'bad', m.player_id === myId ? 'are knocked' : 'is knocked')] });
        return;
      case 'revived':
        set({ feed: [...s.feed.slice(-5), feedItem(m.by === myId ? 'You' : m.by_name, 'good', `revived ${m.player_id === myId ? 'you' : m.name}`)] });
        return;
      case 'dead':
        set({ feed: [...s.feed.slice(-5), feedItem(m.player_id === myId ? 'You' : m.name, 'bad', m.player_id === myId ? 'are dead' : 'is dead')] });
        return;
      case 'phase': {
        const banner = m.phase === 'holdout' ? bannerOf('Hold the zone', 'objective', `Helicopter reached. Survive ${m.hold?.[1] ?? 2} waves.`)
          : m.phase === 'final' ? bannerOf('Final wave', 'danger', 'Extract now') : null;
        set({ mission: { ...s.mission, phase: m.phase, hold: m.hold ?? s.mission.hold }, ...(banner ? { banner } : {}) });
        return;
      }
      case 'extract':
        set({ extract: { progress: m.progress, need: m.need, holders: m.holders } });
        return;
      case 'wave': {
        const label = m.phase === 'final' ? 'Final wave' : `Wave ${m.n}`;
        if (m.cleared) set({ banner: bannerOf(`${label} cleared`, 'neutral', m.next_in ? `Next wave in ${Math.round(m.next_in)} s` : undefined) });
        // The final wave is announced by the phase change; do not say it twice.
        else if (m.phase !== 'final') set({ banner: bannerOf(label, 'objective', m.count ? `${m.count} incoming` : undefined) });
        return;
      }
      case 'gun':
        // Only the gun itself says "paired"; a gun that was paired and drops is "lost".
        if (pairTimer && m.on) { clearTimeout(pairTimer); pairTimer = null; }
        set({ gun: m.on ? 'paired' : s.gun === 'paired' || s.gun === 'lost' ? 'lost' : s.gun });
        return;
      case 'reload':
        if (m.player_id === myId) set({ reloadingUntil: m.until });
        return;
      case 'reloaded':
        if (m.player_id === myId) set({ ammo: m.ammo, reloadingUntil: 0 });
        return;
      case 'ended': {
        zombies.clear();
        // Endless keeps a record on this phone: the furthest wave reached.
        const endless = (m.mode ?? s.mode) === 'endless';
        const best = s.prefs.bestEndlessWave;
        set({
          phase: 'summary', roomPhase: 'ended', ended: m, previousBest: best,
          ...(endless && m.wave > best ? { prefs: { ...s.prefs, bestEndlessWave: m.wave } } : {}),
        });
        if (endless && m.wave > best) persist(get);
        return;
      }
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
      ended: null, feed: [], banner: null, shots: [], damages: [], squad: [], mission: NO_MISSION, extract: NO_EXTRACT, zombieCount: 0,
      mode: 'mission', startedAt: 0,
      error: null, connection: 'idle', lostAt: 0, gun: 'none', deployed: true, hostNote: null,
    });
    persist(get, null);
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { name?: string; serverUrl?: string; session?: Session | null; prefs?: Partial<Prefs> };
      const pinned = typeof window !== 'undefined' && !!window.location?.search && new URLSearchParams(window.location.search).has('server');
      set({ name: p.name ?? '', serverUrl: pinned ? get().serverUrl : p.serverUrl ?? get().serverUrl });
      if (p.prefs) set({ prefs: { ...DEFAULT_PREFS, ...p.prefs } });
      if (p.session) set({ session: p.session });
    } catch { /* first run */ }
  },
}));

async function persist(get: () => State, session?: Session | null) {
  const s = get();
  const payload = { name: s.name, serverUrl: s.serverUrl, prefs: s.prefs, session: session === undefined ? s.session : session };
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
