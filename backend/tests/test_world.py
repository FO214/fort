"""Zombie simulation with a fake clock: no sockets, no sleeping."""
import math
import random
from dataclasses import dataclass

import pytest

from app.mapdata import MapData, load_map
from app.world import ATTACK, CHASE, IDLE, WALKER, World


@dataclass
class Dummy:
    id: str
    x: float
    y: float


def run(world, targets, seconds, t0=0.0, dt=0.05):
    """Step the world; returns (end time, every bite that landed)."""
    bites, t = [], t0
    for _ in range(round(seconds / dt)):
        t += dt
        bites += world.step(dt, t, targets)
    return t, bites


def test_zombie_walks_at_its_speed_and_stops_in_reach():
    w = World()
    z = w.spawn(WALKER, 0, 10)
    ada = Dummy("ada", 0, 0)
    run(w, [ada], 2.0)
    assert z.state == CHASE and z.target == "ada"
    assert z.y == pytest.approx(10 - WALKER.speed * 2.0, abs=0.01)
    assert z.x == pytest.approx(0, abs=1e-6)
    run(w, [ada], 20.0, t0=2.0)
    assert z.state == ATTACK
    assert 0.5 < math.hypot(z.x, z.y) <= WALKER.reach_m       # in reach, not on top of her


def test_bites_come_after_a_windup_then_on_a_cadence():
    w = World()
    w.spawn(WALKER, 0, 1.0)                                    # already in reach
    ada = Dummy("ada", 0, 0)
    _, bites = run(w, [ada], WALKER.windup_s - 0.1)
    assert bites == []                                          # the first bite is telegraphed
    _, bites = run(w, [ada], 3.0, t0=WALKER.windup_s - 0.1)
    assert len(bites) == 3 and all(b.target_id == "ada" for b in bites)


def test_zombie_chases_the_nearest_target_and_switches():
    w = World()
    z = w.spawn(WALKER, 0, 0)
    ada, bo = Dummy("ada", 0, 12), Dummy("bo", 0, -8)
    run(w, [ada, bo], 0.5)
    assert z.target == "bo"
    bo.y = -40                                                  # Bo runs; Ada is now closer
    run(w, [ada, bo], 0.5, t0=0.5)
    assert z.target == "ada"


def test_no_targets_means_idle():
    w = World()
    z = w.spawn(WALKER, 5, 5)
    _, bites = run(w, [], 2.0)
    assert bites == [] and z.state == IDLE and z.target is None and (z.x, z.y) == (5, 5)


def test_horde_does_not_stack_on_one_spot():
    w = World()
    zs = [w.spawn(WALKER, 0, 10) for _ in range(8)]            # all spawned on one point
    run(w, [Dummy("ada", 0, 0)], 4.0)
    gaps = [math.hypot(a.x - b.x, a.y - b.y) for i, a in enumerate(zs) for b in zs[i + 1:]]
    assert min(gaps) > WALKER.body_m * 0.6


def test_damage_and_kill():
    w = World()
    z = w.spawn(WALKER, 0, 0)
    hit, killed = w.damage(z.id, 2)
    assert hit is z and not killed and z.hp == WALKER.hp - 2
    hit, killed = w.damage(z.id, 99)
    assert killed and z.id not in w.zombies and w.killed == 1
    assert w.damage(z.id, 1) == (None, False)                  # already gone


def test_snapshot_row_shape():
    w = World()
    z = w.spawn(WALKER, 1.23456, -7.891)
    run(w, [Dummy("ada", 0, 0)], 0.05)
    row = w.snapshot()[0]
    assert row[0] == z.id and row[1] == WALKER.code and row[4] == WALKER.hp
    assert row[5] == CHASE and row[6] == "ada"
    assert row[2] == round(z.x, 2) and row[3] == round(z.y, 2)


# ------------------------------------------------------------------ spawning

def test_arena_ring_spawns_keep_clear_of_every_player():
    arena = load_map("arena")
    rng = random.Random(7)
    players = [(0.0, 0.0), (6.0, 2.0), (-5.0, 8.0)]
    for _ in range(200):
        x, y = arena.spawn_position(rng, players, players[0])
        nearest = min(math.hypot(x - px, y - py) for px, py in players)
        assert nearest >= arena.spawn_min_m * 0.85
        assert math.hypot(x, y) <= arena.spawn_max_m + 1e-6     # ...but still near the squad


def test_fixed_spawn_points_are_used_when_a_map_has_them():
    m = MapData.from_dict({
        "id": "hall", "start": [0, 0], "helicopter": {"x": 0, "y": 40},
        "spawn": {"mode": "points", "min_m": 10},
        "spawn_points": [[0, 3], [0, 20], [15, 0], [-30, -30]],
    })
    rng = random.Random(1)
    seen = set()
    for _ in range(100):
        x, y = m.spawn_position(rng, [(0.0, 0.0)], (0.0, 0.0))
        nearest = min(m.spawn_points, key=lambda p: math.hypot(p[0] - x, p[1] - y))
        seen.add(nearest)
    assert (0, 3) not in seen                                   # too close to the player
    assert seen <= {(0, 20), (15, 0), (-30, -30)} and len(seen) >= 2


def test_arena_takes_the_hosts_fix_as_origin_but_a_surveyed_map_keeps_its_own():
    arena = load_map("arena")
    assert arena.origin is None
    anchored = arena.with_origin(43.4723, -80.5449)
    assert anchored.origin == (43.4723, -80.5449) and arena.origin is None
    x, y = anchored.to_local(*anchored.to_latlon(12, -4))
    assert (round(x, 2), round(y, 2)) == (12, -4)
    assert anchored.with_origin(1, 2) is anchored
