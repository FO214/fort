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
    assert ev == [{"t": "wave", "n": 1, "count": m.wave_size(1), "cleared": False, "phase": "journey"}]
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
    assert ev == [{"t": "wave", "n": 1, "cleared": True, "next_in": 4, "phase": "journey"}]
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


# ------------------------------------------------------------------ the helicopter

def kill_all(world):
    for zid in list(world.zombies):
        world.damage(zid, 99)


def test_arriving_starts_the_holdout_after_a_short_grace():
    m, world = make(grace_s=1, spawn_gap_s=0.1, hold_grace_s=3, rest_s=2)
    t, _ = run(m, T0 + 2)
    journey_wave = m.wave
    followers = len(world.zombies)
    assert m.arrive(t) == [{"t": "phase", "phase": "holdout", "hold": [0, 2]}]
    assert m.arrive(t) == []                                     # only once
    t, ev = run(m, t + 2.9, t)
    assert ev == [] and len(world.zombies) == followers          # what followed them is still there
    t, ev = run(m, t + 0.3, t)
    assert ev == [{"t": "wave", "n": journey_wave + 1, "count": m.wave_size(journey_wave + 1),
                   "cleared": False, "phase": "holdout", "hold": [0, 2]}]


def test_two_holdout_waves_then_the_final_wave():
    m, world = make(grace_s=1, spawn_gap_s=0.05, hold_grace_s=1, rest_s=2, wave_max_s=5)
    t, _ = run(m, T0 + 1.5)
    m.arrive(t)
    t, _ = run(m, t + 2, t)                                      # holdout wave 1 is in
    assert m.phase == "holdout" and m.hold_done == 0
    t, ev = run(m, t + 20, t)                                    # nobody clears it: it does not time out
    assert ev == [] and m.hold_done == 0

    kill_all(world)
    t, ev = run(m, t + 0.1, t)
    assert ev == [{"t": "wave", "n": m.wave, "cleared": True, "next_in": 2, "phase": "holdout",
                   "hold": [1, 2]}]
    t, ev = run(m, t + 3, t)                                     # rest, then holdout wave 2
    assert [e["hold"] for e in ev] == [[1, 2]] and m.to_spawn == 0

    kill_all(world)
    t, ev = run(m, t + 0.1, t)
    assert [e["t"] for e in ev] == ["wave", "phase", "wave"]
    assert ev[0]["cleared"] and ev[0]["hold"] == [2, 2]
    assert ev[1] == {"t": "phase", "phase": "final"}
    assert ev[2]["phase"] == "final" and not ev[2]["cleared"]
    # The final wave opens bigger than an ordinary wave of that number.
    assert ev[2]["count"] == int(m.wave_size(m.wave) * 1.3 + 0.5) > m.wave_size(m.wave)


def test_the_final_wave_keeps_coming():
    m, world = make(players=4, grace_s=0, spawn_gap_s=0.05, hold_grace_s=0, rest_s=0, holdout_waves=1)
    m.arrive(T0)
    t, _ = run(m, T0 + 2)
    kill_all(world)
    t, _ = run(m, t + 3, t)
    assert m.phase == "final" and len(world.zombies) == m.wave_total
    floor = int(m.wave_total * 0.6 + 0.5)
    for _ in range(4):                                           # wipe them out again and again
        kill_all(world)
        t, ev = run(m, t + 3, t)
        assert ev == [] and len(world.zombies) == floor          # never fewer than this for long
    assert m.phase == "final"


def test_extraction_needs_enough_holders_and_pauses_without_them():
    m, world = make(grace_s=0, hold_grace_s=0, rest_s=0, holdout_waves=1, spawn_gap_s=0.01, extract_s=10)
    assert m.extract(1.0, ["a", "b"], 2) == []                   # not at the helicopter yet
    m.arrive(T0)
    t, _ = run(m, T0 + 1)
    kill_all(world)
    run(m, t + 0.2, t)
    assert m.phase == "final"

    assert m.extract(1.0, ["a"], 2) == [{"t": "extract", "progress": 0.0, "holders": ["a"], "need": 2}]
    assert m.extract(1.0, ["a"], 2) == [] and m.extract_progress == 0          # one is not enough
    ev = m.extract(1.0, ["a", "b"], 2)
    assert ev == [{"t": "extract", "progress": 0.1, "holders": ["a", "b"], "need": 2}]
    for _ in range(4):
        assert m.extract(1.0, ["a", "b"], 2) == []               # steady hold: no chatter
    assert m.extract_progress == pytest.approx(0.5)
    assert m.extract(1.0, ["b"], 2)[0]["holders"] == ["b"]       # one lets go
    assert m.extract_progress == pytest.approx(0.5)              # paused, not reset
    m.extract(1.0, ["b", "a"], 2)
    for _ in range(4):
        m.extract(1.0, ["b", "a"], 2)
    assert m.extract_progress == pytest.approx(1.0) and m.phase == "extracted"


def test_tuning_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("LOONIE_TUNING", json.dumps({"grace_s": 1, "max_zombies": 5}))
    t = Tuning.from_env()
    assert t.grace_s == 1 and t.max_zombies == 5 and t.rest_s == Tuning().rest_s
    monkeypatch.setenv("LOONIE_TUNING", json.dumps({"grace": 1}))
    with pytest.raises(ValueError, match="unknown keys"):
        Tuning.from_env()
    monkeypatch.delenv("LOONIE_TUNING")
    assert Tuning.from_env() == Tuning()


# ------------------------------------------------------------------ endless

def make_endless(players=1, **tuning):
    world = World()
    m = Mission(world, load_map("arena"), Tuning(**tuning), players, T0, random.Random(3), mode="endless")
    return m, world


def test_endless_is_one_phase_and_the_waves_never_stop():
    m, world = make_endless(grace_s=1, rest_s=2, spawn_gap_s=0.05)
    assert m.phase == "endless" and m.state()["phase"] == "endless"
    t = T0
    for n in range(1, 9):
        t, ev = run(m, t + 3, t)
        assert m.wave == n and m.phase == "endless"
        assert {"t": "wave", "n": n, "count": m.wave_size(n), "cleared": False, "phase": "endless"} in ev
        for zid in list(world.zombies):
            world.damage(zid, 999)
        t, ev = run(m, t + 0.1, t)
        assert ev == [{"t": "wave", "n": n, "cleared": True, "next_in": 2, "phase": "endless"}]


def test_endless_has_no_helicopter_to_reach_and_nothing_to_extract_on():
    m, _ = make_endless(grace_s=1)
    run(m, T0 + 2)
    assert m.arrive(T0 + 2) == [] and m.phase == "endless"       # standing on the pad changes nothing
    assert m.extract(1.0, ["a", "b"], 2) == [] and m.extract_progress == 0.0
    assert m.phase == "endless"


def test_endless_zombies_get_tougher_wave_by_wave_and_mission_zombies_do_not():
    m, world = make_endless(grace_s=1, rest_s=1, spawn_gap_s=0.05, endless_hp_growth=0.5)
    t, hp = T0, []
    for _ in range(3):
        t, _ = run(m, t + 2.5, t)
        hp.append(max(z.hp for z in world.zombies.values()))
        for zid in list(world.zombies):
            world.damage(zid, 999)
        t, _ = run(m, t + 0.1, t)
    assert hp == [6, 9, 12]                                      # +50% of a walker's 6 each wave

    plain, _ = make(grace_s=1)
    plain.wave = 9
    assert plain.zombie_hp_scale() == 1.0


def test_an_ignored_endless_wave_does_not_hold_the_next_one_back():
    m, world = make_endless(grace_s=1, wave_max_s=6, spawn_gap_s=0.1)
    t, _ = run(m, T0 + 3)
    assert m.wave == 1
    t, ev = run(m, T0 + 8, t)                                    # nobody shot anything
    assert m.wave == 2 and len(world.zombies) > m.wave_size(1)
