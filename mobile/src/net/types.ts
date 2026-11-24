/** Wire types. Mirrors backend/app/models.py and the events in room.py. */

export type RoomPhase = 'lobby' | 'playing' | 'ended';
export type MissionPhase = 'journey' | 'holdout' | 'final' | 'extracted' | 'wiped' | 'endless';
/**
 * The two ways to play.
 *   mission  walk to the helicopter, hold it, extract
 *   endless  no helicopter: waves keep coming until nobody is standing
 */
export type GameMode = 'mission' | 'endless';
export type PlayerState = 'alive' | 'knocked' | 'dead';

export interface GunClass {
  id: string; name: string; damage: number; fire_interval_s: number; magazine: number;
  reload_s: number; spread_deg: number; range_m: number; automatic: boolean; hp: number;
}

export interface Settings { max_players: number; map: string; mode?: GameMode }

export interface LobbyPlayer { id: string; name: string; cls: string; ready: boolean; connected: boolean }

export interface MapInfo {
  id: string; name: string;
  /** Latitude/longitude of map (0, 0), or null until the host's fix anchors it. */
  origin: [number, number] | null;
  /** Compass bearing of the map's +y axis. */
  rotation_deg: number;
  start: [number, number];
  helicopter: { x: number; y: number; radius_m: number; qr: string };
  /** Building footprint, for drawing. Empty on the open arena. */
  outline: [number, number][];
  /** Wall segments `[x1, y1, x2, y2]`. */
  walls: [number, number, number, number][];
  labels: { text: string; x: number; y: number }[];
  /** Furniture and the like that zombies walk round. */
  obstacles?: [number, number][][];
  /** A walked area (free play): where the host walked, which is the only open floor. */
  paths?: [number, number][][];
}

export interface MapChoice { id: string; name: string }

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
  /** Bleed-out bar while knocked: 1 full, 0 dead. */
  bl: number;
  /** While knocked: how far a teammate's revive has got (0–1) and who it is. */
  rv: number;
  rb: string | null;
  /** Holding to extract. */
  ex: boolean;
}

export interface MissionState {
  phase: MissionPhase; wave: number; left: number; total: number;
  /** Holdout waves `[survived, needed]`. */
  hold?: [number, number];
}

export interface Result { id: string; name: string; cls: string; kills: number; damage: number; shots: number; state: PlayerState; knocks: number; revives: number }

export interface EndedMsg {
  t: 'ended'; outcome: 'extracted' | 'wiped'; results: Result[]; wave: number; kills: number; duration_s: number;
  /** Absent from an older server, which only knows the mission. */
  mode?: GameMode;
}

export type ServerMsg =
  | { t: 'welcome'; player_id: string; token: string; code: string; host_id: string; classes: Record<string, GunClass>; map: MapInfo; maps: MapChoice[] }
  | { t: 'lobby'; code: string; host_id: string; phase: RoomPhase; settings: Settings; players: LobbyPlayer[]; map: MapInfo }
  | { t: 'started'; now: number; map: MapInfo; mission: MissionState;
      /** Server time the run began, and which mode it is. Absent from an older server. */
      at?: number; mode?: GameMode }
  | { t: 'snap'; now: number; ph: MissionPhase; wave: [number, number, number]; hold: [number, number];
      /** Extraction `[progress 0–1, holders needed, ids holding]`. */
      ex: [number, number, string[]]; z: ZombieRow[]; p: PlayerSnap[] }
  | { t: 'fired'; player_id: string; seq: number; reason: string; ammo: number; hits: [number, number][] }
  | { t: 'zhit'; id: number; hp: number; by: string; dmg: number }
  | { t: 'zkill'; id: number; by: string; x: number; y: number }
  | { t: 'hurt'; player_id: string; hp: number; dmg: number; dir: number; by: number; bleed?: number }
  | { t: 'knocked'; player_id: string; name: string }
  | { t: 'revived'; player_id: string; name: string; by: string; by_name: string; hp: number }
  | { t: 'dead'; player_id: string; name: string }
  | { t: 'phase'; phase: MissionPhase; hold?: [number, number] }
  | { t: 'wave'; n: number; cleared: boolean; phase: MissionPhase; hold?: [number, number]; count?: number; next_in?: number }
  | { t: 'extract'; progress: number; holders: string[]; need: number }
  | { t: 'reload'; player_id: string; until: number }
  | { t: 'reloaded'; player_id: string; ammo: number }
  | EndedMsg
  | { t: 'pairing'; until: number }
  | { t: 'gun'; on: boolean }
  | { t: 'trigger'; down: boolean }
  | { t: 'reload_btn' }
  | { t: 'pong'; ts: number; now: number }
  | { t: 'error'; msg: string; detail?: unknown };
