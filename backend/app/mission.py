"""The mission director: decides when zombies arrive and how many.

Like the world it has no clock of its own. The room calls `tick(now)` and
broadcasts whatever events come back.
"""
from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass, fields
from typing import Any, Callable, Optional, Sequence

from .mapdata import MapData, Point, Viewer
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
    # the helicopter
    arrive_slack_cap_m: float = 10.0 # arrival radius grows by half the GPS accuracy, up to this
    holdout_waves: int = 2           # waves to survive at the helicopter
    hold_grace_s: float = 4.0        # quiet time between arriving and the first of them
    final_factor: float = 1.3        # the final wave opens this much bigger than the next wave would be
    final_pressure: float = 0.6      # ...and is topped up to this share of its size until you leave
    extract_s: float = 12.0          # how long the hold-to-extract takes
    # knocked players
    bleed_bites: int = 8             # bites a knocked player survives before dying
    revive_s: float = 3.0            # how long a teammate must hold Revive
    revive_range_m: float = 4.0      # ...from this close (plus GPS slack)
    revive_slack_cap_m: float = 25.0 # the two phones' GPS accuracies are added to the range, up to this
    revive_clear_m: float = 4.0      # no zombie may be this close to the knocked player
    # endless mode
    endless_hp_growth: float = 0.06  # each endless wave's zombies have this much more health than the last

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


# How much health a revived player comes back with: first time, second, later.
REVIVE_HEALTH = (0.5, 0.3, 0.2)


class Mission:
    """One run of the mission, from the moment the host presses start.

    Phases: `journey` (walk to the helicopter, waves on the way) → `holdout`
    (survive a fixed number of waves there) → `final` (an endless last wave
    while the squad holds to extract) → `extracted`. The room ends the run
    as `wiped` if nobody is left standing.

    In endless mode there is one phase, `endless`, and it never changes:
    there is nowhere to go and nothing to extract on. Waves arrive around
    the squad wherever it stands, one after another, each bigger and a
    little tougher than the last, until the room ends the run as `wiped`.
    """

    def __init__(self, world: World, game_map: MapData, tuning: Tuning, players: int,
                 now: float, rng: Optional[random.Random] = None, mode: str = "mission") -> None:
        self.world = world
        self.map = game_map
        self.t = tuning
        self.rng = rng or random.Random()
        self.players = max(1, players)
        self.mode = mode
        self.phase = "endless" if mode == "endless" else "journey"
        self.started_at = now
        self.wave = 0                       # number of the wave in progress, 0 before the first
        self.wave_total = 0                 # zombies that wave started with
        self.to_spawn = 0                   # of those, how many have not appeared yet
        self.wave_started_at = now
        self.next_spawn_at = now
        self.next_wave_at: Optional[float] = now + tuning.grace_s
        self.hold_done = 0                  # holdout waves survived
        self.hold_wave_live = False         # a holdout wave is in progress
        self.extract_progress = 0.0         # 0..1
        self.extract_holders: list[str] = []
        self.extract_need = 1

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
             pick_anchor: Optional[Callable[[], Optional[Point]]] = None,
             viewers: Sequence[Viewer] = ()) -> list[Event]:
        """`living` are the positions zombies must keep clear of when they
        spawn. `pick_anchor` chooses who the next zombie is aimed at.
        `viewers` are where players stand and look, so zombies can appear
        out of their sight."""
        events: list[Event] = []

        if self.to_spawn > 0 and now >= self.next_spawn_at and len(self.world.zombies) < self.t.max_zombies:
            anchor = pick_anchor() if pick_anchor else None
            x, y = self.map.spawn_position(self.rng, living, anchor, viewers)
            self.world.spawn(WALKER, x, y, self.zombie_hp_scale())
            self.to_spawn -= 1
            self.next_spawn_at = now + self.t.spawn_gap_s

        if self.phase in ("journey", "endless"):
            # Wave after wave, with a breather once each is cleared. Ignoring a
            # wave does not hold the next one back for ever.
            cleared = self.wave > 0 and self.remaining == 0
            if cleared and self.next_wave_at is None:
                self.next_wave_at = now + self.t.rest_s
                events.append(self._cleared(self.t.rest_s))
            overdue = (self.wave > 0 and self.to_spawn == 0
                       and now - self.wave_started_at >= self.t.wave_max_s)
            if (self.next_wave_at is not None and now >= self.next_wave_at) or overdue:
                events.append(self._start_wave(now))

        elif self.phase == "holdout":
            if self.hold_wave_live and self.remaining == 0:
                self.hold_wave_live = False
                self.hold_done += 1
                if self.hold_done >= self.t.holdout_waves:
                    events.append(self._cleared(0.0))
                    events.extend(self._enter_final(now))
                else:
                    self.next_wave_at = now + self.t.rest_s
                    events.append(self._cleared(self.t.rest_s))
            elif self.next_wave_at is not None and now >= self.next_wave_at:
                self.hold_wave_live = True
                events.append(self._start_wave(now))

        elif self.phase == "final":
            # The last wave never ends: it is topped up until the squad is out.
            floor = max(1, int(self.wave_total * self.t.final_pressure + 0.5))
            if self.remaining < floor:
                self.to_spawn += floor - self.remaining
        return events

    def zombie_hp_scale(self) -> float:
        """How tough this wave's zombies are. Constant in the mission; in
        endless it creeps up, so the run always ends eventually."""
        if self.phase != "endless":
            return self.t.zombie_hp
        return self.t.zombie_hp * (1.0 + self.t.endless_hp_growth * max(0, self.wave - 1))

    def arrive(self, now: float) -> list[Event]:
        """The squad has reached the helicopter. Whatever followed them there
        is still alive; the first holdout wave comes after a short grace."""
        if self.phase != "journey":
            return []
        self.phase = "holdout"
        self.hold_done = 0
        self.hold_wave_live = False
        self.next_wave_at = now + self.t.hold_grace_s
        return [self._phase_event()]

    def extract(self, dt: float, holders: list[str], need: int) -> list[Event]:
        """Advance the extraction while enough players are holding. Returns an
        `extract` event when who is holding changes, and flips the phase to
        `extracted` when the bar is full."""
        if self.phase != "final":
            return []
        events: list[Event] = []
        changed = holders != self.extract_holders or need != self.extract_need
        self.extract_holders, self.extract_need = list(holders), need
        if len(holders) >= need:
            self.extract_progress += dt / max(self.t.extract_s, 0.01)
            if self.extract_progress > 1.0 - 1e-9:        # float dust must not cost a tick
                self.extract_progress = 1.0
        if changed:
            events.append(self.extract_state())
        if self.extract_progress >= 1.0:
            self.phase = "extracted"
        return events

    def extract_state(self) -> Event:
        return {"t": "extract", "progress": round(self.extract_progress, 3),
                "holders": list(self.extract_holders), "need": self.extract_need}

    # ---- internals ---------------------------------------------------------------
    def _enter_final(self, now: float) -> list[Event]:
        self.phase = "final"
        self.extract_progress = 0.0
        self.extract_holders = []
        wave = self._start_wave(now, self.t.final_factor)
        return [self._phase_event(), wave]

    def _start_wave(self, now: float, factor: float = 1.0) -> Event:
        self.wave += 1
        self.wave_total = max(1, int(self.wave_size(self.wave) * factor + 0.5))
        self.to_spawn = self.wave_total
        self.wave_started_at = now
        self.next_spawn_at = now
        self.next_wave_at = None
        return {"t": "wave", "n": self.wave, "count": self.wave_total, "cleared": False,
                **self._where()}

    def _cleared(self, next_in: float) -> Event:
        return {"t": "wave", "n": self.wave, "cleared": True, "next_in": next_in, **self._where()}

    def _where(self) -> dict[str, Any]:
        """Phase, plus holdout progress `[survived, needed]` while holding."""
        d: dict[str, Any] = {"phase": self.phase}
        if self.phase == "holdout":
            d["hold"] = [self.hold_done, self.t.holdout_waves]
        return d

    def _phase_event(self) -> Event:
        return {"t": "phase", **self._where()}

    def state(self) -> dict[str, Any]:
        return {**self._where(), "wave": self.wave, "left": self.remaining,
                "total": self.wave_total}
