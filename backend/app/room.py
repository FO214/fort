"""One squad's game: the lobby, the players, and the mission they are on.

No I/O in here. The server layer feeds it messages and a clock, and it hands
back events to broadcast, which keeps it unit-testable with fake time.
"""
from __future__ import annotations

import math
import random
import secrets
import time
from dataclasses import dataclass
from typing import Any, Optional

from .geo import angle_diff_deg, bearing_xy, dist_xy
from .mapdata import MapData, Point, load_map
from .mission import REVIVE_HEALTH, Mission, Tuning
from .models import CLASSES, DEFAULT_CLASS, Settings
from .world import Bite, World

Event = dict[str, Any]

ABSENT_AFTER_S = 20.0          # a dropped phone stops counting as a squad member after this
MAX_TICK_S = 0.25              # a stalled server must not teleport the horde

# How much a claimed hit may disagree with what the server knows. The phone
# judged the shot against its own newest position and zombies drawn ~100 ms in
# the past, so some disagreement is honest. This only has to stop nonsense.
ZOMBIE_HALF_WIDTH_M = 0.35
POS_SLACK_M = 1.5
ANGLE_SLACK_DEG = 6.0
RANGE_SLACK_M = 3.0


@dataclass
class Player:
    id: str
    name: str
    token: str
    cls: str = DEFAULT_CLASS
    ready: bool = False
    connected: bool = True
    disconnected_at: float = 0.0
    # mission state
    hp: int = 8
    state: str = "alive"                # alive | knocked | dead
    ammo: int = 10
    reloading_until: float = 0.0
    last_fire_ts: float = 0.0
    fire_seq: int = -1
    x: float = 0.0
    y: float = 0.0
    acc: float = 10.0
    heading: float = 0.0
    pitch: float = 0.0
    has_fix: bool = False               # False until the phone reports a position
    kills: int = 0
    damage: int = 0
    shots: int = 0
    # knocked / revive
    bleed: float = 1.0                  # bleed-out bar while knocked: 1 full, 0 dead
    knocks: int = 0                     # times knocked this mission
    revives: int = 0                    # teammates this player has picked up
    reviving: Optional[str] = None      # id of the teammate this player is holding Revive on
    revive_by: Optional[str] = None     # while knocked: who is reviving us
    revive_progress: float = 0.0        # ...and how far along, 0..1
    extracting: bool = False            # holding to extract with the helicopter QR in view

    @property
    def max_hp(self) -> int:
        return CLASSES[self.cls].hp

    def present(self, now: float) -> bool:
        return self.connected or now - self.disconnected_at < ABSENT_AFTER_S

    def lobby(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "cls": self.cls, "ready": self.ready,
                "connected": self.connected}

    def wire(self) -> dict[str, Any]:
        """This player's slice of a snapshot."""
        return {"id": self.id, "x": round(self.x, 2), "y": round(self.y, 2),
                "acc": round(self.acc, 1), "h": round(self.heading, 1),
                "hp": self.hp, "max": self.max_hp, "st": self.state,
                "ammo": self.ammo, "rl": self.reloading_until, "k": self.kills,
                "on": self.connected, "bl": round(self.bleed, 3),
                "rv": round(self.revive_progress, 3), "rb": self.revive_by,
                "ex": self.extracting}


class GameError(Exception):
    pass


class Room:
    def __init__(self, code: str, settings: Settings, now: Optional[float] = None,
                 tuning: Optional[Tuning] = None, rng: Optional[random.Random] = None):
        self.code = code
        self.settings = settings
        self.tuning = tuning or Tuning()
        self.rng = rng or random.Random()
        self.phase: str = "lobby"          # lobby | playing | ended
        self.host_id: Optional[str] = None
        self.players: dict[str, Player] = {}
        self.created_at = now if now is not None else time.time()
        try:
            self.map: MapData = load_map(settings.map)
        except KeyError:
            raise GameError("Unknown map") from None
        self.world = World(self.map.nav)
        self.mission: Optional[Mission] = None
        self.started_at = 0.0
        self.last_tick = 0.0
        self.ended: Optional[Event] = None

    # ---------------------------------------------------------------- lobby
    def add_player(self, name: str) -> Player:
        if self.phase != "lobby":
            raise GameError("Mission already started")
        if len(self.players) >= self.settings.max_players:
            raise GameError("Squad is full")
        base = name.strip()[:20] or "Player"
        taken = {p.name for p in self.players.values()}
        final, n = base, 2
        while final in taken:
            final, n = f"{base} {n}", n + 1
        p = Player(id=secrets.token_hex(4), name=final, token=secrets.token_urlsafe(16))
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

    def set_class(self, pid: str, cls: str) -> None:
        if cls not in CLASSES:
            raise GameError("Unknown class")
        if self.phase != "lobby":
            raise GameError("Loadout locks when the mission starts")
        self._p(pid).cls = cls

    def set_map(self, pid: str, map_id: str) -> None:
        """Host picks where the mission is played."""
        if pid != self.host_id:
            raise GameError("Only the host can change the map")
        if self.phase != "lobby":
            raise GameError("The map locks when the mission starts")
        try:
            self.map = load_map(map_id)
        except KeyError:
            raise GameError("Unknown map") from None
        self.settings = self.settings.model_copy(update={"map": map_id})
        self.world = World(self.map.nav)

    def start(self, pid: str, now: float, lat: Optional[float] = None,
              lon: Optional[float] = None) -> Event:
        if pid != self.host_id:
            raise GameError("Only the host can start")
        if self.phase != "lobby":
            raise GameError("Mission already started")
        game_map = load_map(self.settings.map)
        if lat is not None and lon is not None:
            game_map = game_map.with_origin(lat, lon)
        self.map = game_map
        self.world = World(game_map.nav)
        self.mission = Mission(self.world, game_map, self.tuning, len(self.players), now, self.rng)
        self.phase = "playing"
        self.started_at = self.last_tick = now
        self.ended = None
        for p in self.players.values():
            w = CLASSES[p.cls]
            p.hp, p.state = w.hp, "alive"
            p.ammo, p.reloading_until, p.last_fire_ts, p.fire_seq = w.magazine, 0.0, 0.0, -1
            p.x, p.y = game_map.start
            p.acc, p.heading, p.pitch, p.has_fix = 10.0, 0.0, 0.0, False
            p.kills = p.damage = p.shots = p.knocks = p.revives = 0
            p.bleed, p.reviving, p.revive_by, p.revive_progress, p.extracting = 1.0, None, None, 0.0, False
        return self.started_event(now)

    def started_event(self, now: float) -> Event:
        assert self.mission is not None
        return {"t": "started", "now": now, "map": self.map.public(),
                "mission": self.mission.state()}

    def reset(self, pid: str) -> None:
        """Back to the lobby. Mid-mission this aborts the run."""
        if pid != self.host_id:
            raise GameError("Only the host can do that")
        self.phase = "lobby"
        self.mission = None
        self.ended = None
        self.map = load_map(self.settings.map)       # a mission may have anchored it; start clean
        self.world = World(self.map.nav)
        for p in self.players.values():
            p.ready = False

    # -------------------------------------------------------------- playing
    def update_pos(self, pid: str, x: float, y: float, acc: float, heading: float,
                   pitch: float) -> None:
        p = self._p(pid)
        p.x, p.y = x, y
        p.acc = max(acc, 1.0)
        p.heading = heading % 360.0
        p.pitch = pitch
        p.has_fix = True

    def fire(self, pid: str, seq: int, hits: list[int], heading: float, now: float) -> list[Event]:
        """Resolve one trigger pull. The first event is always `fired`, so a
        miss still makes noise and the shooter's HUD can say why."""
        if self.phase != "playing":
            raise GameError("No mission running")
        p = self._p(pid)
        if p.state != "alive":
            return []
        if seq <= p.fire_seq:
            return []                      # duplicate / out of order
        p.fire_seq = seq
        w = CLASSES[p.cls]

        if p.extracting:
            return [self._fired(p, seq, "extracting")]   # both hands are busy
        if p.reloading_until > now:
            return [self._fired(p, seq, "reloading")]
        if p.ammo <= 0:
            self._start_reload(p, now)
            return [self._fired(p, seq, "empty"),
                    {"t": "reload", "player_id": p.id, "until": p.reloading_until}]
        if now - p.last_fire_ts < w.fire_interval_s * 0.85:
            return [self._fired(p, seq, "cooldown")]

        p.last_fire_ts = now
        p.ammo -= 1
        p.shots += 1
        p.heading = heading % 360.0

        reason = "miss"
        struck: list[list[int]] = []
        after: list[Event] = []
        for zid in hits[:1]:               # one bullet, one zombie: the nearest blocks
            z = self.world.zombies.get(zid)
            if z is None:
                reason = "gone"
                continue
            dist = dist_xy(p.x, p.y, z.x, z.y)
            if dist > w.range_m + RANGE_SLACK_M:
                reason = "range"
                continue
            off = abs(angle_diff_deg(bearing_xy(p.x, p.y, z.x, z.y), p.heading))
            gate = (w.spread_deg + ANGLE_SLACK_DEG
                    + math.degrees(math.atan2(ZOMBIE_HALF_WIDTH_M + POS_SLACK_M, max(dist, 0.5))))
            if off > gate:
                reason = "off_target"
                continue
            zx, zy = z.x, z.y
            _, killed = self.world.damage(zid, w.damage)
            p.damage += w.damage
            reason = "hit"
            struck.append([zid, z.hp])
            after.append({"t": "zhit", "id": zid, "hp": z.hp, "by": p.id, "dmg": w.damage})
            if killed:
                p.kills += 1
                after.append({"t": "zkill", "id": zid, "by": p.id, "x": round(zx, 2),
                              "y": round(zy, 2)})

        if p.ammo == 0:
            self._start_reload(p, now)
            after.append({"t": "reload", "player_id": p.id, "until": p.reloading_until})
        return [self._fired(p, seq, reason, struck), *after]

    def reload(self, pid: str, now: float) -> list[Event]:
        p = self._p(pid)
        if self.phase != "playing" or p.state != "alive":
            return []
        if p.reloading_until > now or p.ammo >= CLASSES[p.cls].magazine:
            return []
        self._start_reload(p, now)
        return [{"t": "reload", "player_id": p.id, "until": p.reloading_until}]

    def revive(self, pid: str, target_id: str, on: bool, now: float) -> list[Event]:
        """A player presses or releases Revive for a knocked teammate. The
        hold itself is timed in `tick`."""
        if self.phase != "playing":
            return []
        p = self._p(pid)
        if not on:
            self._stop_reviving(p)
            return []
        tgt = self.players.get(target_id)
        if p.state != "alive" or tgt is None or tgt.id == p.id or tgt.state != "knocked":
            return []
        if tgt.revive_by not in (None, p.id):
            return []                      # someone else already has them
        if p.reviving == tgt.id:
            return []                      # already holding: a repeated message changes nothing
        if not self._in_revive_range(p, tgt):
            raise GameError("Too far away to revive")
        self._stop_reviving(p)
        p.reviving, tgt.revive_by, tgt.revive_progress = tgt.id, p.id, 0.0
        return []

    def set_extract(self, pid: str, on: bool) -> None:
        """A player starts or stops holding to extract. Only means anything
        during the final wave, and only for someone still standing."""
        p = self._p(pid)
        ok = (self.phase == "playing" and self.mission is not None
              and self.mission.phase == "final" and p.state == "alive")
        p.extracting = bool(on) and ok

    def arrived(self, pid: str, now: float) -> list[Event]:
        """Host's "we're here" button, for when GPS will not admit it."""
        if pid != self.host_id:
            raise GameError("Only the host can do that")
        if self.phase != "playing" or self.mission is None:
            return []
        return self.mission.arrive(now)

    def tick(self, now: float) -> list[Event]:
        """Advance the mission. Call at 20 Hz."""
        if self.phase != "playing" or self.mission is None:
            return []
        dt = min(max(now - self.last_tick, 0.0), MAX_TICK_S)
        self.last_tick = now
        events: list[Event] = []

        for p in self.players.values():
            if p.reloading_until and p.reloading_until <= now:
                p.ammo = CLASSES[p.cls].magazine
                p.reloading_until = 0.0
                events.append({"t": "reloaded", "player_id": p.id, "ammo": p.ammo})

        squad = [p for p in self.players.values() if p.present(now)]
        for bite in self.world.step(dt, now, self._zombie_targets(squad), self.tuning.zombie_speed):
            events.extend(self._bite(bite, now))
        events.extend(self._advance_revives(dt, now))

        standing = [p for p in squad if p.state == "alive"]
        if squad and not standing:
            events.extend(self._finish("wiped", now))
            return events

        m = self.mission
        if m.phase == "journey" and any(self._at_helicopter(p) for p in standing):
            events.extend(m.arrive(now))

        keep_clear: list[Point] = [(p.x, p.y) for p in squad if p.state != "dead"]
        events.extend(m.tick(now, keep_clear, lambda: self._spawn_anchor(standing)))

        if m.phase == "final":
            holders = [p.id for p in standing if p.extracting]
            # Two must hold together. A solo player, or the last one not dead, may do it alone.
            need = max(1, min(2, sum(1 for p in squad if p.state != "dead")))
            events.extend(m.extract(dt, holders, need))
            if m.phase == "extracted":
                events.extend(self._finish("extracted", now))
        return events

    def snapshot(self, now: float) -> dict[str, Any]:
        m = self.mission
        return {
            "t": "snap", "now": now,
            "ph": m.phase if m else self.phase,
            "wave": [m.wave, m.remaining, m.wave_total] if m else [0, 0, 0],
            "hold": [m.hold_done, m.t.holdout_waves] if m else [0, 0],
            "ex": [round(m.extract_progress, 3), m.extract_need, m.extract_holders] if m else [0, 1, []],
            "z": self.world.snapshot(),
            "p": [p.wire() for p in self.players.values()],
        }

    def lobby_state(self) -> dict[str, Any]:
        return {
            "t": "lobby", "code": self.code, "host_id": self.host_id,
            "phase": self.phase, "settings": self.settings.model_dump(),
            "players": [p.lobby() for p in self.players.values()],
            "map": self.map.public(),
        }

    # -------------------------------------------------------------- internals
    def _p(self, pid: str) -> Player:
        p = self.players.get(pid)
        if p is None:
            raise GameError("Unknown player")
        return p

    def _start_reload(self, p: Player, now: float) -> None:
        p.reloading_until = now + CLASSES[p.cls].reload_s

    def _fired(self, p: Player, seq: int, reason: str,
               hits: Optional[list[list[int]]] = None) -> Event:
        return {"t": "fired", "player_id": p.id, "seq": seq, "reason": reason,
                "ammo": p.ammo, "hits": hits or []}

    def _zombie_targets(self, squad: list[Player]) -> list[Player]:
        """Zombies go for the nearest player who is not dead, knocked or not."""
        return [p for p in squad if p.state != "dead"]

    # ---- helicopter ------------------------------------------------------
    def _at_helicopter(self, p: Player) -> bool:
        """Close enough to count as arrived. The radius grows with how unsure
        the phone is of its position, within reason."""
        if not p.has_fix:
            return False
        h = self.map.helicopter
        slack = min(p.acc * 0.5, self.tuning.arrive_slack_cap_m)
        return dist_xy(p.x, p.y, h.x, h.y) <= h.radius_m + slack

    # ---- knocked and revive ------------------------------------------------
    def _in_revive_range(self, p: Player, tgt: Player) -> bool:
        # Two phones' GPS errors add up, so standing next to a teammate can
        # look like metres apart. Be generous by what both phones admit to.
        slack = min(p.acc + tgt.acc, self.tuning.revive_slack_cap_m)
        return dist_xy(p.x, p.y, tgt.x, tgt.y) <= self.tuning.revive_range_m + slack

    def _stop_reviving(self, p: Player) -> None:
        tgt = self.players.get(p.reviving) if p.reviving else None
        if tgt is not None and tgt.revive_by == p.id:
            tgt.revive_by, tgt.revive_progress = None, 0.0
        p.reviving = None

    def _advance_revives(self, dt: float, now: float) -> list[Event]:
        events: list[Event] = []
        for p in list(self.players.values()):
            if not p.reviving:
                continue
            tgt = self.players.get(p.reviving)
            if (tgt is None or tgt.state != "knocked" or p.state != "alive"
                    or not p.present(now) or not self._in_revive_range(p, tgt)):
                self._stop_reviving(p)
                continue
            if self.world.within(tgt.x, tgt.y, self.tuning.revive_clear_m):
                tgt.revive_progress = 0.0          # zombies on top of them: clear the area first
                continue
            tgt.revive_progress += dt / max(self.tuning.revive_s, 0.01)
            if tgt.revive_progress >= 1.0:
                share = REVIVE_HEALTH[min(tgt.knocks, len(REVIVE_HEALTH)) - 1]
                tgt.state, tgt.hp = "alive", max(1, math.ceil(tgt.max_hp * share))
                tgt.bleed = 1.0
                p.revives += 1
                self._stop_reviving(p)
                events.append({"t": "revived", "player_id": tgt.id, "name": tgt.name,
                               "by": p.id, "by_name": p.name, "hp": tgt.hp})
        return events

    def _spawn_anchor(self, standing: list[Player]) -> Optional[Point]:
        """Each zombie is aimed at a random standing player, so the whole
        squad feels pressure rather than whoever happens to be nearest."""
        if not standing:
            return None
        p = self.rng.choice(standing)
        return (p.x, p.y)

    def _bite(self, bite: Bite, now: float) -> list[Event]:
        p = self.players.get(bite.target_id)
        z = bite.zombie
        if p is None or p.state == "dead":
            return []
        # Where the bite came from relative to where the victim is facing, so
        # the HUD can draw the damage wedge without doing any geometry.
        direction = round(angle_diff_deg(bearing_xy(p.x, p.y, z.x, z.y), p.heading), 1)

        if p.state == "knocked":
            # Already down: each bite drains the bleed-out bar instead.
            p.bleed = max(0.0, p.bleed - 1.0 / max(self.tuning.bleed_bites, 1))
            events: list[Event] = [{"t": "hurt", "player_id": p.id, "hp": 0, "dmg": 0,
                                    "dir": direction, "by": z.id, "bleed": round(p.bleed, 3)}]
            if p.bleed <= 0.0:
                p.state = "dead"
                reviver = self.players.get(p.revive_by) if p.revive_by else None
                if reviver is not None:
                    self._stop_reviving(reviver)
                events.append({"t": "dead", "player_id": p.id, "name": p.name})
            return events

        p.hp = max(0, p.hp - z.type.damage)
        self._stop_reviving(p)                 # taking a hit breaks the revive you were doing
        events = [{"t": "hurt", "player_id": p.id, "hp": p.hp, "dmg": z.type.damage,
                   "dir": direction, "by": z.id}]
        if p.hp == 0:
            p.state = "knocked"
            p.knocks += 1
            p.bleed = 1.0
            p.reloading_until = 0.0
            p.extracting = False
            events.append({"t": "knocked", "player_id": p.id, "name": p.name})
        return events

    def _finish(self, outcome: str, now: float) -> list[Event]:
        if self.phase == "ended":
            return []
        self.phase = "ended"
        m = self.mission
        ranked = sorted(self.players.values(), key=lambda p: (-p.kills, -p.damage, p.name))
        for p in self.players.values():
            p.reviving, p.revive_by, p.revive_progress, p.extracting = None, None, 0.0, False
        self.ended = {
            "t": "ended", "outcome": outcome,
            "results": [{"id": p.id, "name": p.name, "cls": p.cls, "kills": p.kills,
                         "damage": p.damage, "shots": p.shots, "state": p.state,
                         "knocks": p.knocks, "revives": p.revives}
                        for p in ranked],
            "wave": m.wave if m else 0,
            "kills": self.world.killed,
            "duration_s": round(now - self.started_at, 1),
        }
        self.world.clear()
        return [self.ended]


# ---------------------------------------------------------------- room table

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"   # no I/O — confusable in a lobby


class RoomManager:
    def __init__(self, tuning: Optional[Tuning] = None) -> None:
        self.rooms: dict[str, Room] = {}
        self.tuning = tuning or Tuning()

    def create(self, settings: Settings, now: Optional[float] = None) -> Room:
        while True:
            code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))
            if code not in self.rooms:
                break
        room = Room(code, settings, now, self.tuning)
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
