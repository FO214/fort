"""Wave pacing with a fake clock."""
import json
import random

import pytest

from app.mapdata import load_map
from app.mission import Mission, Tuning
from app.world import World

T0 = 1000.0


def make(players=1, **tuning):
    world = World()
    m = Mission(world, load_map("arena"), Tuning(**tuning), players, T0, random.Random(3))
    return m, world


def run(m, until, t=T0, dt=0.05, living=((0.0, 0.0),)):
    events = []
    while t < until:
        t += dt
        events += m.tick(t, list(living))
    return t, events


def test_grace_then_first_wave_trickles_in():
    m, world = make(grace_s=5, spawn_gap_s=0.5)
    t, ev = run(m, T0 + 4.9)
    assert ev == [] and m.wave == 0 and not world.zombies
    t, ev = run(m, T0 + 5.2, t)
    assert ev == [{"t": "wave", "n": 1, "count": m.wave_size(1), "cleared": False}]
    assert len(world.zombies) == 1                              # one now, the rest staggered
    t, ev = run(m, T0 + 5.2 + 0.5 * m.wave_size(1), t)
    assert len(world.zombies) == m.wave_size(1) and m.to_spawn == 0


def test_waves_grow_and_scale_with_squad_size():
    solo, _ = make(players=1)
    full, _ = make(players=4)
    assert [solo.wave_size(n) for n in (1, 2, 3)] == [4, 5, 7]
    assert [full.wave_size(n) for n in (1, 2, 3)] == [8, 11, 14]
    assert all(full.wave_size(n) > solo.wave_size(n) for n in range(1, 8))
    assert all(solo.wave_size(n + 1) >= solo.wave_size(n) for n in range(1, 8))


def test_clearing_a_wave_earns_a_rest_then_the_next_wave():
    m, world = make(grace_s=1, rest_s=4, spawn_gap_s=0.1)
    t, _ = run(m, T0 + 3)
    assert m.wave == 1 and m.to_spawn == 0
    for zid in list(world.zombies):
        world.damage(zid, 99)
    t, ev = run(m, t + 0.1, t)
    assert ev == [{"t": "wave", "n": 1, "cleared": True, "next_in": 4}]
    t, ev = run(m, t + 3.5, t)
    assert ev == [] and m.wave == 1                              # still resting
    t, ev = run(m, t + 1.0, t)
    assert [e["n"] for e in ev] == [2] and m.wave == 2


def test_an_ignored_wave_does_not_stall_the_journey():
    m, world = make(grace_s=1, wave_max_s=10, spawn_gap_s=0.1)
    t, _ = run(m, T0 + 3)
    first = len(world.zombies)
    t, ev = run(m, T0 + 12, t)                                   # nobody shoots anything
    assert [e["n"] for e in ev if not e["cleared"]] == [2]
    t, _ = run(m, t + 3, t)
    assert len(world.zombies) == first + m.wave_size(2)
    assert m.remaining == len(world.zombies)


def test_zombie_cap_holds_spawns_back():
    m, world = make(grace_s=0, spawn_gap_s=0.05, max_zombies=3, wave_base=10)
    t, _ = run(m, T0 + 5)
    assert len(world.zombies) == 3 and m.to_spawn > 0
    world.damage(next(iter(world.zombies)), 99)
    t, _ = run(m, t + 0.2, t)
    assert len(world.zombies) == 3                               # the freed slot is refilled


def test_tuning_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("LOONIE_TUNING", json.dumps({"grace_s": 1, "max_zombies": 5}))
    t = Tuning.from_env()
    assert t.grace_s == 1 and t.max_zombies == 5 and t.rest_s == Tuning().rest_s
    monkeypatch.setenv("LOONIE_TUNING", json.dumps({"grace": 1}))
    with pytest.raises(ValueError, match="unknown keys"):
        Tuning.from_env()
    monkeypatch.delenv("LOONIE_TUNING")
    assert Tuning.from_env() == Tuning()
