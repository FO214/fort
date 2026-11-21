/** Wire types. Mirrors backend/app/models.py and the events in room.py. */

export type RoomPhase = 'lobby' | 'playing' | 'ended';
export type MissionPhase = 'journey' | 'holdout' | 'final' | 'extracted' | 'wiped';
export type PlayerState = 'alive' | 'knocked' | 'dead';

export interface GunClass {
  id: string; name: string; damage: number; fire_interval_s: number; magazine: number;
  reload_s: number; spread_deg: number; range_m: number; automatic: boolean; hp: number;
}

export interface Settings { max_players: number; map: string }

export interface LobbyPlayer { id: string; name: string; cls: string; ready: boolean; connected: boolean }

export interface MapInfo {
  id: string; name: string;
  /** Latitude/longitude of map (0, 0), or null until the host's fix anchors it. */
  origin: [number, number] | null;
  /** Compass bearing of the map's +y axis. */
  rotation_deg: number;
  start: [number, number];
  helicopter: { x: number; y: number; radius_m: number; qr: string };
  walls: unknown[];
}

/** `[id, type, x, y, hp, state, target]` */
export type ZombieRow = [number, number, number, number, number, number, string | null];
export const Z_IDLE = 0, Z_CHASE = 1, Z_ATTACK = 2;

/** One player's slice of a snapshot. */
export interface PlayerSnap {
  id: string; x: number; y: number; acc: number;
  /** Map heading the gun points along. */
  h: number;
  hp: number; max: number; st: PlayerState; ammo: number;
  /** Server time the reload finishes, 0 when not reloading. */
  rl: number;
  k: number;
  on: boolean;
}

export interface MissionState { phase: MissionPhase; wave: number; left: number; total: number }

export interface Result { id: string; name: string; cls: string; kills: number; damage: number; shots: number; state: PlayerState }

export interface EndedMsg {
  t: 'ended'; outcome: 'extracted' | 'wiped'; results: Result[]; wave: number; kills: number; duration_s: number;
}

export type ServerMsg =
  | { t: 'welcome'; player_id: string; token: string; code: string; host_id: string; classes: Record<string, GunClass>; map: MapInfo }
  | { t: 'lobby'; code: string; host_id: string; phase: RoomPhase; settings: Settings; players: LobbyPlayer[] }
  | { t: 'started'; now: number; map: MapInfo; mission: MissionState }
  | { t: 'snap'; now: number; ph: MissionPhase; wave: [number, number, number]; z: ZombieRow[]; p: PlayerSnap[] }
  | { t: 'fired'; player_id: string; seq: number; reason: string; ammo: number; hits: [number, number][] }
  | { t: 'zhit'; id: number; hp: number; by: string; dmg: number }
  | { t: 'zkill'; id: number; by: string; x: number; y: number }
  | { t: 'hurt'; player_id: string; hp: number; dmg: number; dir: number; by: number }
  | { t: 'knocked'; player_id: string; name: string }
  | { t: 'wave'; n: number; cleared: boolean; count?: number; next_in?: number }
  | { t: 'reload'; player_id: string; until: number }
  | { t: 'reloaded'; player_id: string; ammo: number }
  | EndedMsg
  | { t: 'pong'; ts: number; now: number }
  | { t: 'error'; msg: string; detail?: unknown };
