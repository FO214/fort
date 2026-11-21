"""The mission director: decides when zombies arrive and how many.

Like the world it has no clock of its own. The room calls `tick(now)` and
broadcasts whatever events come back.
"""
from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass, fields
from typing import Any, Callable, Optional

from .mapdata import MapData, Point
from .world import WALKER, World

Event = dict[str, Any]


@dataclass
class Tuning:
    """Every pacing and balance number in one place. `LOONIE_TUNING` (a JSON
    object in the environment) overrides any of them, which is how the
    end-to-end tests run a whole mission in seconds."""
    grace_s: float = 6.0             # quiet time after the mission starts
    rest_s: float = 7.0              # breather after a wave is cleared
    wave_max_s: float = 50.0         # on the journey, the next wave comes anyway after this
    spawn_gap_s: float = 0.7         # zombies of one wave trickle in, not all at once
    wave_base: float = 2.0           # wave size = (base + growth * n) * squad factor
    wave_growth: float = 1.5
    squad_base: float = 0.6          # squad factor = base + per_player * players
    squad_per_player: float = 0.4
    max_zombies: int = 40            # hard cap on zombies alive at once
    zombie_speed: float = 1.0        # multipliers on the zombie type's own numbers
    zombie_hp: float = 1.0

    @classmethod
    def from_env(cls) -> "Tuning":
        raw = os.environ.get("LOONIE_TUNING")
        if not raw:
            return cls()
        data = json.loads(raw)
        known = {f.name: f.type for f in fields(cls)}
        unknown = set(data) - set(known)
        if unknown:
            raise ValueError(f"LOONIE_TUNING has unknown keys: {sorted(unknown)}")
        return cls(**data)


class Mission:
    """One run of the mission, from the moment the host presses start."""

    def __init__(self, world: World, game_map: MapData, tuning: Tuning, players: int,
                 now: float, rng: Optional[random.Random] = None) -> None:
        self.world = world
        self.map = game_map
        self.t = tuning
        self.rng = rng or random.Random()
        self.players = max(1, players)
        self.phase = "journey"
        self.started_at = now
        self.wave = 0                       # number of the wave in progress, 0 before the first
        self.wave_total = 0                 # zombies that wave started with
        self.to_spawn = 0                   # of those, how many have not appeared yet
        self.wave_started_at = now
        self.next_spawn_at = now
        self.next_wave_at: Optional[float] = now + tuning.grace_s

    # ---- sizing --------------------------------------------------------------
    def wave_size(self, n: int) -> int:
        squad = self.t.squad_base + self.t.squad_per_player * self.players
        return max(1, int((self.t.wave_base + self.t.wave_growth * n) * squad + 0.5))

    @property
    def remaining(self) -> int:
        """Zombies of the current wave still to deal with."""
        return self.to_spawn + len(self.world.zombies)

    # ---- driving ---------------------------------------------------------------
    def tick(self, now: float, living: list[Point],
             pick_anchor: Optional[Callable[[], Optional[Point]]] = None) -> list[Event]:
        """`living` are the positions zombies must keep clear of when they
        spawn. `pick_anchor` chooses who the next zombie is aimed at."""
        events: list[Event] = []

        if self.to_spawn > 0 and now >= self.next_spawn_at and len(self.world.zombies) < self.t.max_zombies:
            anchor = pick_anchor() if pick_anchor else None
            x, y = self.map.spawn_position(self.rng, living, anchor)
            self.world.spawn(WALKER, x, y, self.t.zombie_hp)
            self.to_spawn -= 1
            self.next_spawn_at = now + self.t.spawn_gap_s

        cleared = self.wave > 0 and self.remaining == 0
        if cleared and self.next_wave_at is None:
            self.next_wave_at = now + self.t.rest_s
            events.append({"t": "wave", "n": self.wave, "cleared": True,
                           "next_in": self.t.rest_s})

        overdue = (self.wave > 0 and self.to_spawn == 0
                   and now - self.wave_started_at >= self.t.wave_max_s)
        if (self.next_wave_at is not None and now >= self.next_wave_at) or overdue:
            events.append(self._start_wave(now))
        return events

    def _start_wave(self, now: float) -> Event:
        self.wave += 1
        self.wave_total = self.wave_size(self.wave)
        self.to_spawn = self.wave_total
        self.wave_started_at = now
        self.next_spawn_at = now
        self.next_wave_at = None
        return {"t": "wave", "n": self.wave, "count": self.wave_total, "cleared": False}

    def state(self) -> dict[str, Any]:
        return {"phase": self.phase, "wave": self.wave, "left": self.remaining,
                "total": self.wave_total}
