"""Authoritative match state. No I/O in here — the server layer feeds it
messages and a clock, and it hands back events to broadcast. That keeps it
unit-testable with fake time."""
from __future__ import annotations

import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional

from .geo import angle_diff_deg, bearing_deg, dynamic_gate_deg, haversine_m
from .models import WEAPON_HP, WEAPONS, Settings

Event = dict[str, Any]

POS_HISTORY_S = 10.0          # rewind window kept per player
POS_MATCH_TOLERANCE_S = 2.0   # nearest sample must be this close to count
LAG_COMP_MAX_S = 1.0          # how far back a client's fire timestamp may reach


@dataclass
class Sample:
    ts: float
    lat: float
    lon: float
    acc: float
    heading: Optional[float]
    heading_acc: Optional[float]


@dataclass
class Player:
    id: str
    name: str
    token: str
    team: Optional[str] = None
    weapon: str = "regular"
    ready: bool = False
    connected: bool = True
    hp: int = 8
    alive: bool = True
    kills: int = 0
    deaths: int = 0
    ammo: int = 10
    reloading_until: float = 0.0
    last_fire_ts: float = 0.0
    respawn_at: float = 0.0
    invuln_until: float = 0.0
    fire_seq: int = -1
    history: deque[Sample] = field(default_factory=lambda: deque(maxlen=64))

    # ---- positioning --------------------------------------------------
    @property
    def latest(self) -> Optional[Sample]:
        return self.history[-1] if self.history else None

    def sample_at(self, ts: float) -> Optional[Sample]:
        """Nearest sample to `ts` inside the tolerance, else the newest."""
        if not self.history:
            return None
        best = min(self.history, key=lambda s: abs(s.ts - ts))
        if abs(best.ts - ts) <= POS_MATCH_TOLERANCE_S:
            return best
        return self.history[-1]

    def heading_at(self, ts: float) -> Optional[float]:
        """Newest heading at or before ts; headings arrive with positions."""
        for s in reversed(self.history):
            if s.ts <= ts + 0.05 and s.heading is not None:
                return s.heading
        for s in reversed(self.history):
            if s.heading is not None:
                return s.heading
        return None

    # ---- serialization ---------------------------------------------------
    def public(self) -> dict[str, Any]:
        s = self.latest
        return {
            "id": self.id, "name": self.name, "team": self.team, "weapon": self.weapon,
            "ready": self.ready, "connected": self.connected,
            "hp": self.hp, "max_hp": WEAPON_HP[self.weapon], "alive": self.alive,
            "kills": self.kills, "deaths": self.deaths,
            "ammo": self.ammo, "reloading_until": self.reloading_until,
            "respawn_at": self.respawn_at, "invuln_until": self.invuln_until,
            "lat": s.lat if s else None, "lon": s.lon if s else None,
            "acc": s.acc if s else None, "heading": s.heading if s else None,
        }


class GameError(Exception):
    pass


class Room:
    def __init__(self, code: str, settings: Settings, now: Optional[float] = None):
        self.code = code
        self.settings = settings
        self.phase: str = "lobby"          # lobby | playing | ended
        self.host_id: Optional[str] = None
        self.players: dict[str, Player] = {}
        self.created_at = now if now is not None else time.time()
        self.started_at: float = 0.0
        self.ends_at: float = 0.0
        self.results: list[dict[str, Any]] = []
        self.feed: deque[dict[str, Any]] = deque(maxlen=12)

    # ---------------------------------------------------------------- lobby
    def add_player(self, name: str) -> Player:
        if self.phase != "lobby":
            raise GameError("Match already started")
        if len(self.players) >= self.settings.max_players:
            raise GameError("Lobby is full")
        base = name.strip()[:20] or "Player"
        taken = {p.name for p in self.players.values()}
        final, n = base, 2
        while final in taken:
            final, n = f"{base} {n}", n + 1
        p = Player(id=secrets.token_hex(4), name=final, token=secrets.token_urlsafe(16))
        if self.settings.mode == "teams":
            a = sum(1 for q in self.players.values() if q.team == "alpha")
            b = sum(1 for q in self.players.values() if q.team == "bravo")
            p.team = "alpha" if a <= b else "bravo"
        self.players[p.id] = p
        if self.host_id is None:
            self.host_id = p.id
        return p

    def remove_player(self, pid: str) -> None:
        self.players.pop(pid, None)
        if self.host_id == pid:
            self.host_id = next(iter(self.players), None)

    def set_ready(self, pid: str, ready: bool) -> None:
        self._p(pid).ready = ready

    def set_team(self, pid: str, team: str) -> None:
        if self.settings.mode != "teams":
            raise GameError("Not a team match")
        self._p(pid).team = team

    def set_weapon(self, pid: str, weapon: str) -> None:
        if weapon not in WEAPONS:
            raise GameError("Unknown weapon")
        if self.phase != "lobby":
            raise GameError("Loadout locks when the match starts")
        self._p(pid).weapon = weapon

    def update_settings(self, pid: str, settings: Settings) -> None:
        if pid != self.host_id:
            raise GameError("Only the host can change settings")
        if self.phase != "lobby":
            raise GameError("Match already started")
        self.settings = settings
        if settings.mode == "teams":
            for i, p in enumerate(self.players.values()):
                if p.team is None:
                    p.team = "alpha" if i % 2 == 0 else "bravo"
        else:
            for p in self.players.values():
                p.team = None

    def start(self, pid: str, now: float) -> None:
        if pid != self.host_id:
            raise GameError("Only the host can start")
        if self.phase != "lobby":
            raise GameError("Match already started")
        if len(self.players) < 2:
            raise GameError("Need at least two players")
        self.phase = "playing"
        self.started_at = now
        self.ends_at = now + self.settings.duration_s
        for p in self.players.values():
            self._spawn(p, now)
            p.kills = p.deaths = 0
        self.feed.clear()

    # -------------------------------------------------------------- playing
    def update_pos(self, pid: str, lat: float, lon: float, acc: float,
                   heading: Optional[float], heading_acc: Optional[float],
                   client_ts: float, now: float) -> None:
        p = self._p(pid)
        # Store on the server clock but keep the client's relative timing so
        # rewinds line up with what the shooter actually saw.
        ts = min(client_ts, now) if abs(client_ts - now) < 5 else now
        p.history.append(Sample(ts, lat, lon, max(acc, 1.0), heading, heading_acc))

    def fire(self, pid: str, seq: int, target_id: Optional[str], client_ts: float,
             now: float) -> list[Event]:
        """Resolve one trigger pull. Returns the events the server should
        broadcast; the first is always `fired` so misses still make noise."""
        if self.phase != "playing":
            raise GameError("Match is not running")
        s = self._p(pid)
        if not s.alive:
            return []
        if seq <= s.fire_seq:
            return []                      # duplicate / out of order
        s.fire_seq = seq
        w = WEAPONS[s.weapon]

        if s.reloading_until > now:
            return [self._shot_event(s, seq, None, "reloading")]
        if s.ammo <= 0:
            self._start_reload(s, now)
            return [self._shot_event(s, seq, None, "empty")]
        if now - s.last_fire_ts < w.fire_interval_s * 0.85:
            return [self._shot_event(s, seq, None, "cooldown")]

        s.last_fire_ts = now
        s.ammo -= 1
        events: list[Event] = []
        reload_started = False
        if s.ammo == 0:
            self._start_reload(s, now)
            reload_started = True

        verdict = self._resolve(s, target_id, client_ts, now)
        events.append(self._shot_event(s, seq, verdict.get("target"), verdict["reason"],
                                       verdict.get("off"), verdict.get("gate"),
                                       verdict.get("dist")))
        if verdict["reason"] == "hit":
            events.extend(self._apply_damage(s, self.players[verdict["target"]], w.damage, now))
        if reload_started:
            events.append({"t": "reload", "player_id": s.id, "until": s.reloading_until})
        return events

    def reload(self, pid: str, now: float) -> list[Event]:
        s = self._p(pid)
        if s.reloading_until > now or s.ammo >= WEAPONS[s.weapon].magazine:
            return []
        self._start_reload(s, now)
        return [{"t": "reload", "player_id": s.id, "until": s.reloading_until}]

    def end(self, pid: str, now: float) -> list[Event]:
        if pid != self.host_id:
            raise GameError("Only the host can end the match")
        return self._finish(now)

    def reset(self, pid: str) -> None:
        if pid != self.host_id:
            raise GameError("Only the host can reset")
        if self.phase == "playing":
            raise GameError("Match is still running")
        self.phase = "lobby"
        self.results = []
        self.feed.clear()
        for p in self.players.values():
            p.ready = False
            p.kills = p.deaths = 0
            p.history.clear()

    def tick(self, now: float) -> list[Event]:
        """Advance timers. Call ~10 Hz."""
        events: list[Event] = []
        if self.phase != "playing":
            return events
        for p in self.players.values():
            if p.reloading_until and p.reloading_until <= now:
                p.ammo = WEAPONS[p.weapon].magazine
                p.reloading_until = 0.0
                events.append({"t": "reloaded", "player_id": p.id, "ammo": p.ammo})
            if not p.alive and p.respawn_at and p.respawn_at <= now:
                self._spawn(p, now)
                events.append({"t": "respawned", "player_id": p.id, "hp": p.hp,
                               "invuln_until": p.invuln_until})
        if now >= self.ends_at:
            events.extend(self._finish(now))
        return events

    def snapshot(self, now: float) -> dict[str, Any]:
        return {
            "t": "snapshot", "now": now, "phase": self.phase,
            "ends_at": self.ends_at, "players": [p.public() for p in self.players.values()],
        }

    def lobby_state(self) -> dict[str, Any]:
        return {
            "t": "lobby", "code": self.code, "host_id": self.host_id,
            "phase": self.phase, "settings": self.settings.model_dump(),
            "players": [p.public() for p in self.players.values()],
        }

    # -------------------------------------------------------------- internals
    def _p(self, pid: str) -> Player:
        p = self.players.get(pid)
        if p is None:
            raise GameError("Unknown player")
        return p

    def _spawn(self, p: Player, now: float) -> None:
        p.hp = WEAPON_HP[p.weapon]
        p.alive = True
        p.ammo = WEAPONS[p.weapon].magazine
        p.reloading_until = 0.0
        p.respawn_at = 0.0
        p.invuln_until = now + self.settings.spawn_protect_s

    def _start_reload(self, p: Player, now: float) -> None:
        p.reloading_until = now + WEAPONS[p.weapon].reload_s

    def _is_enemy(self, a: Player, b: Player) -> bool:
        if a.id == b.id:
            return False
        if self.settings.mode == "teams" and a.team is not None and a.team == b.team:
            return False
        return True

    def _resolve(self, s: Player, target_id: Optional[str], client_ts: float,
                 now: float) -> dict[str, Any]:
        if not target_id:
            return {"reason": "no_target"}
        tg = self.players.get(target_id)
        if tg is None or not tg.alive:
            return {"reason": "no_target"}
        if not self._is_enemy(s, tg):
            return {"reason": "friendly", "target": tg.id}
        if tg.invuln_until > now:
            return {"reason": "protected", "target": tg.id}
        if self.settings.aim == "manual":
            # Indoors there is no usable fix; the shooter chose the target by
            # hand and the server only enforces the non-geometric rules.
            return {"reason": "hit", "target": tg.id}

        # Lag compensation: judge the shot at the moment the shooter pulled
        # the trigger, bounded so a stale clock can't reach into the past.
        t_fire = min(max(client_ts, now - LAG_COMP_MAX_S), now)
        sp, tp = s.sample_at(t_fire), tg.sample_at(t_fire)
        heading = s.heading_at(t_fire)
        if sp is None or tp is None or heading is None:
            return {"reason": "no_fix", "target": tg.id}

        w = WEAPONS[s.weapon]
        dist = haversine_m(sp.lat, sp.lon, tp.lat, tp.lon)
        if dist > w.range_m:
            return {"reason": "range", "target": tg.id, "dist": dist}
        brg = bearing_deg(sp.lat, sp.lon, tp.lat, tp.lon)
        off = abs(angle_diff_deg(brg, heading))
        gate = dynamic_gate_deg(w.cone_deg, sp.acc, tp.acc, dist)
        if off > gate:
            return {"reason": "off_target", "target": tg.id, "off": off, "gate": gate, "dist": dist}
        return {"reason": "hit", "target": tg.id, "off": off, "gate": gate, "dist": dist}

    def _apply_damage(self, s: Player, tg: Player, dmg: int, now: float) -> list[Event]:
        tg.hp = max(0, tg.hp - dmg)
        # Direction the hit came from, relative to the victim's own heading,
        # so the HUD can draw the damage wedge without doing geodesy.
        dir_rel = None
        sl, tl = s.latest, tg.latest
        if sl and tl:
            to_shooter = bearing_deg(tl.lat, tl.lon, sl.lat, sl.lon)
            dir_rel = angle_diff_deg(to_shooter, tl.heading or 0.0)
        events: list[Event] = [{
            "t": "hit", "shooter_id": s.id, "target_id": tg.id, "damage": dmg,
            "hp": tg.hp, "dir": dir_rel,
        }]
        if tg.hp == 0:
            tg.alive = False
            tg.deaths += 1
            s.kills += 1
            tg.respawn_at = now + self.settings.respawn_s if self.settings.respawn_s > 0 else 0.0
            entry = {"t": "killed", "shooter_id": s.id, "target_id": tg.id,
                     "shooter": s.name, "target": tg.name, "weapon": s.weapon, "at": now,
                     "respawn_at": tg.respawn_at}
            self.feed.append(entry)
            events.append(entry)
        return events

    def _shot_event(self, s: Player, seq: int, target: Optional[str], reason: str,
                    off: Optional[float] = None, gate: Optional[float] = None,
                    dist: Optional[float] = None) -> Event:
        e: Event = {"t": "fired", "player_id": s.id, "seq": seq, "reason": reason,
                    "ammo": s.ammo}
        if target:
            e["target_id"] = target
        if off is not None:
            e["off"], e["gate"] = round(off, 1), round(gate or 0, 1)
        if dist is not None:
            e["dist"] = round(dist, 1)
        return e

    def _finish(self, now: float) -> list[Event]:
        if self.phase == "ended":
            return []
        self.phase = "ended"
        self.ends_at = min(self.ends_at, now) if self.ends_at else now
        ranked = sorted(self.players.values(), key=lambda p: (-p.kills, p.deaths, p.name))
        self.results = [{
            "id": p.id, "name": p.name, "team": p.team, "weapon": p.weapon,
            "kills": p.kills, "deaths": p.deaths, "place": i + 1,
        } for i, p in enumerate(ranked)]
        teams = None
        if self.settings.mode == "teams":
            teams = {"alpha": sum(p.kills for p in self.players.values() if p.team == "alpha"),
                     "bravo": sum(p.kills for p in self.players.values() if p.team == "bravo")}
        return [{"t": "ended", "results": self.results, "teams": teams,
                 "duration_s": round(now - self.started_at, 1)}]


# ---------------------------------------------------------------- room table

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"   # no I/O — confusable in a lobby


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create(self, settings: Settings, now: Optional[float] = None) -> Room:
        while True:
            code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))
            if code not in self.rooms:
                break
        room = Room(code, settings, now)
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Optional[Room]:
        return self.rooms.get(code.upper())

    def sweep(self, now: float, idle_s: float = 300.0) -> list[str]:
        """Drop rooms nobody has been connected to for a while."""
        dead = [c for c, r in self.rooms.items()
                if not any(p.connected for p in r.players.values())
                and now - r.created_at > idle_s]
        for c in dead:
            del self.rooms[c]
        return dead
