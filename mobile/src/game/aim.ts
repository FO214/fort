/**
 * Client-side aim resolution. Mirrors the server's rule so the reticle only
 * promises a hit the server will actually grant. The server still decides.
 */
import type { PlayerPub, SensorFix, Weapon } from '../net/types';
import { angleDiffDeg, bearingDeg, dynamicGateDeg, haversineM } from './geo';

export interface Candidate {
  id: string; name: string; team: PlayerPub['team'];
  dist: number; bearing: number; off: number; gate: number;
  inRange: boolean; inGate: boolean; lockable: boolean;
}

export function isEnemy(me: PlayerPub, p: PlayerPub, mode: 'ffa' | 'teams'): boolean {
  if (p.id === me.id) return false;
  if (mode === 'teams' && me.team && me.team === p.team) return false;
  return true;
}

export function computeCandidates(
  me: PlayerPub, fix: SensorFix, players: PlayerPub[], weapon: Weapon, mode: 'ffa' | 'teams',
): Candidate[] {
  if (fix.heading == null) return [];
  const out: Candidate[] = [];
  for (const p of players) {
    if (!isEnemy(me, p, mode) || !p.alive || p.lat == null || p.lon == null) continue;
    const dist = haversineM(fix.lat, fix.lon, p.lat, p.lon);
    const bearing = bearingDeg(fix.lat, fix.lon, p.lat, p.lon);
    const off = angleDiffDeg(bearing, fix.heading);
    const gate = dynamicGateDeg(weapon.cone_deg, fix.acc, p.acc ?? 10, dist);
    const inRange = dist <= weapon.range_m;
    const inGate = Math.abs(off) <= gate;
    out.push({ id: p.id, name: p.name, team: p.team, dist, bearing, off, gate, inRange, inGate, lockable: inRange && inGate });
  }
  return out.sort((a, b) => Math.abs(a.off) - Math.abs(b.off));
}

export interface LockState { targetId: string | null; since: number; progress: number; locked: boolean }

/** Advance the lock state machine by one frame. */
export function stepLock(prev: LockState, best: Candidate | undefined, now: number, acquireMs: number): LockState {
  if (!best || !best.lockable) return { targetId: null, since: 0, progress: 0, locked: false };
  if (prev.targetId !== best.id) return { targetId: best.id, since: now, progress: 0, locked: false };
  const progress = Math.min(1, (now - prev.since) / Math.max(1, acquireMs));
  return { targetId: best.id, since: prev.since, progress, locked: progress >= 1 };
}
