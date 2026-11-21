export type Team = 'alpha' | 'bravo' | null;
export type Mode = 'ffa' | 'teams';
export type Phase = 'lobby' | 'playing' | 'ended';

export interface Weapon {
  id: string; name: string; damage: number; fire_interval_s: number; magazine: number;
  reload_s: number; cone_deg: number; range_m: number; automatic: boolean; acquire_ms: number; hp: number;
}

export type Aim = 'gps' | 'manual';
export interface Settings { mode: Mode; aim: Aim; duration_s: number; respawn_s: number; spawn_protect_s: number; max_players: number }

export interface PlayerPub {
  id: string; name: string; team: Team; weapon: string; ready: boolean; connected: boolean;
  hp: number; max_hp: number; alive: boolean; kills: number; deaths: number; ammo: number;
  reloading_until: number; respawn_at: number; invuln_until: number;
  lat: number | null; lon: number | null; acc: number | null; heading: number | null;
}

export type ServerMsg =
  | { t: 'welcome'; player_id: string; token: string; code: string; host_id: string; weapons: Record<string, Weapon> }
  | { t: 'lobby'; code: string; host_id: string; phase: Phase; settings: Settings; players: PlayerPub[] }
  | { t: 'started'; ends_at: number; now: number; settings: Settings }
  | { t: 'snapshot'; now: number; phase: Phase; ends_at: number; players: PlayerPub[] }
  | { t: 'fired'; player_id: string; seq: number; reason: string; ammo: number; target_id?: string; off?: number; gate?: number; dist?: number }
  | { t: 'hit'; shooter_id: string; target_id: string; damage: number; hp: number; dir: number | null }
  | { t: 'killed'; shooter_id: string; target_id: string; shooter: string; target: string; weapon: string; at: number; respawn_at: number }
  | { t: 'respawned'; player_id: string; hp: number; invuln_until: number }
  | { t: 'reload'; player_id: string; until: number }
  | { t: 'reloaded'; player_id: string; ammo: number }
  | { t: 'ended'; results: Result[]; teams: { alpha: number; bravo: number } | null; duration_s: number }
  | { t: 'pong'; ts: number; now: number }
  | { t: 'error'; msg: string; detail?: unknown };

export interface Result { id: string; name: string; team: Team; weapon: string; kills: number; deaths: number; place: number }

export interface SensorFix { lat: number; lon: number; acc: number; heading: number | null; headingAcc: number | null; ts: number }
