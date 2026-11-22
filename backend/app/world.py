"""The zombies. The server is the only place they exist: it spawns them, walks
them toward players and decides when they bite. Phones draw what the
snapshots report and never move a zombie themselves.

No I/O and no clock in here. `step` is handed `dt` and `now`, so tests drive
it with fake time.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Protocol, Sequence

from .nav import Nav

IDLE, CHASE, ATTACK = 0, 1, 2          # zombie state codes on the wire
REPLAN_S = 0.3                         # how often a zombie reconsiders its route round walls


@dataclass(frozen=True)
class ZombieType:
    key: str
    code: int                 # what goes in the snapshot array
    hp: int
    speed: float              # metres per second
    damage: int               # health taken per bite
    attack_interval_s: float
    windup_s: float           # pause between reaching a player and the first bite
    reach_m: float
    body_m: float             # personal space, for un-stacking the horde


WALKER = ZombieType(key="walker", code=0, hp=6, speed=1.2, damage=1, attack_interval_s=1.0,
                    windup_s=0.6, reach_m=1.5, body_m=0.8)
TYPES: dict[str, ZombieType] = {WALKER.key: WALKER}


class Target(Protocol):
    """Anything a zombie can chase. Rooms pass their players."""
    id: str
    x: float
    y: float


@dataclass
class Zombie:
    id: int
    type: ZombieType
    x: float
    y: float
    hp: int
    state: int = IDLE
    target: Optional[str] = None
    next_attack: float = 0.0
    waypoint: Optional[tuple[float, float]] = None      # next corner on the way round a wall
    replan_at: float = 0.0

    def wire(self) -> list:
        """`[id, type, x, y, hp, state, target]`, as compact as JSON gets."""
        return [self.id, self.type.code, round(self.x, 2), round(self.y, 2), self.hp,
                self.state, self.target]


@dataclass(frozen=True)
class Bite:
    zombie: Zombie
    target_id: str


class World:
    def __init__(self, nav: Optional[Nav] = None) -> None:
        self.nav = nav                     # None on an open map: zombies walk straight
        self.zombies: dict[int, Zombie] = {}
        self._next_id = 1
        self.killed = 0

    # ---- population ----------------------------------------------------------
    def spawn(self, ztype: ZombieType, x: float, y: float, scale: float = 1.0) -> Zombie:
        z = Zombie(id=self._next_id, type=ztype, x=x, y=y, hp=max(1, round(ztype.hp * scale)))
        self._next_id += 1
        self.zombies[z.id] = z
        return z

    def damage(self, zid: int, amount: int) -> tuple[Optional[Zombie], bool]:
        """Returns the zombie that was hit (None if it is already gone) and
        whether that killed it."""
        z = self.zombies.get(zid)
        if z is None:
            return None, False
        z.hp = max(0, z.hp - amount)
        if z.hp == 0:
            del self.zombies[zid]
            self.killed += 1
            return z, True
        return z, False

    def clear(self) -> None:
        self.zombies.clear()

    def within(self, x: float, y: float, radius: float) -> list[Zombie]:
        return [z for z in self.zombies.values() if math.hypot(z.x - x, z.y - y) <= radius]

    # ---- simulation ----------------------------------------------------------
    def step(self, dt: float, now: float, targets: Sequence[Target],
             speed_scale: float = 1.0) -> list[Bite]:
        """Advance every zombie by `dt` seconds. Returns the bites that landed;
        the caller owns what a bite does to a player."""
        bites: list[Bite] = []
        if not targets:
            for z in self.zombies.values():
                z.state, z.target = IDLE, None
            return bites

        for z in self.zombies.values():
            tgt = min(targets, key=lambda t: (t.x - z.x) ** 2 + (t.y - z.y) ** 2)
            dx, dy = tgt.x - z.x, tgt.y - z.y
            dist = math.hypot(dx, dy)
            switched = z.target != tgt.id
            z.target = tgt.id
            # A zombie already biting keeps biting if it is jostled slightly
            # out of reach; otherwise a crowd would reset its own wind-up.
            reach = z.type.reach_m * (1.15 if z.state == ATTACK and not switched else 1.0)
            if dist > reach:
                z.state = CHASE
                step = z.type.speed * speed_scale * dt
                aim = self._aim(z, (tgt.x, tgt.y), now, switched)
                if aim is None:
                    # Nothing in the way: stop just inside reach rather than standing on the player.
                    move = min(step, dist - z.type.reach_m * 0.8)
                    z.x += dx / dist * move
                    z.y += dy / dist * move
                else:
                    ax, ay = aim[0] - z.x, aim[1] - z.y
                    far = math.hypot(ax, ay)
                    if far <= step:
                        z.x, z.y = aim
                        z.replan_at = 0.0          # reached the corner: pick the next one now
                    else:
                        z.x += ax / far * step
                        z.y += ay / far * step
            else:
                if z.state != ATTACK or switched:
                    z.state = ATTACK
                    z.next_attack = now + z.type.windup_s
                elif now >= z.next_attack:
                    z.next_attack = now + z.type.attack_interval_s
                    bites.append(Bite(z, tgt.id))

        self._separate()
        return bites

    def _aim(self, z: Zombie, target: tuple[float, float], now: float,
             switched: bool) -> Optional[tuple[float, float]]:
        """The corner this zombie should walk to, or None to go straight at
        its target. Routes are reconsidered a few times a second, not every
        tick, which keeps a big wave cheap."""
        if self.nav is None:
            return None
        if switched or now >= z.replan_at:
            wp = self.nav.waypoint((z.x, z.y), target)
            z.waypoint = None if wp == target else wp
            z.replan_at = now + REPLAN_S + (z.id % 5) * 0.02      # spread the work out
        return z.waypoint

    def _separate(self) -> None:
        """Push overlapping zombies apart so a wave reads as a crowd, not one
        zombie with thirty health bars."""
        zs = list(self.zombies.values())
        for i, a in enumerate(zs):
            for b in zs[i + 1:]:
                dx, dy = b.x - a.x, b.y - a.y
                need = (a.type.body_m + b.type.body_m) / 2
                d2 = dx * dx + dy * dy
                if d2 >= need * need:
                    continue
                d = math.sqrt(d2)
                if d < 1e-6:                      # exactly stacked: split along a fixed axis
                    dx, dy, d = 1.0, 0.0, 1.0
                push = (need - d) / 2
                ux, uy = dx / d, dy / d
                self._nudge(a, -ux * push, -uy * push)
                self._nudge(b, ux * push, uy * push)

    def _nudge(self, z: Zombie, dx: float, dy: float) -> None:
        """Move a zombie aside, unless that would shove it through a wall."""
        to = (z.x + dx, z.y + dy)
        if self.nav is None or self.nav.clear((z.x, z.y), to):
            z.x, z.y = to

    def snapshot(self) -> list[list]:
        return [z.wire() for z in self.zombies.values()]
