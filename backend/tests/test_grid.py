"""Open floor: zombies walking round furniture, and free play on a walked area.

The building is the same two rooms as test_nav, with a table in the west room:

    y=10 +-----------+-----------+
         |   +---+   |           |
         |   |tbl|  door         |     table: x 4..6, y 2..8
         |   +---+   |           |     door gap: x = 10, y from 4 to 6
    y=0  +-----------+-----------+
"""
import math
import random

import pytest

from app import mapdata
from app.grid import GridNav
from app.mapdata import MapData
from app.mission import Tuning
from app.models import Settings
from app.room import GameError, Room
from app.world import WALKER, World
from tests.test_nav import TWO_ROOMS, WALLS, Dummy

TABLE = [[4, 2], [6, 2], [6, 8], [4, 8]]
FURNISHED = {**TWO_ROOMS, "id": "furnished", "graph": None, "obstacles": [TABLE]}


def chase(world, target, seconds=40.0, dt=0.05):
    """Run the world until a zombie bites `target`; returns every position it stood on."""
    trail, t = [], 0.0
    while t < seconds:
        t += dt
        if world.step(dt, t, [target]):
            return trail, True
        trail += [(z.x, z.y) for z in world.zombies.values()]
    return trail, False


def in_table(p, pad=0.0):
    return 4 - pad < p[0] < 6 + pad and 2 - pad < p[1] < 8 + pad


def test_obstacles_make_a_floor_grid_with_the_furniture_left_out():
    m = MapData.from_dict(FURNISHED)
    assert isinstance(m.nav, GridNav)
    assert m.nav.is_open((2, 5)) and m.nav.is_open((15, 5))
    assert not m.nav.is_open((5, 5))                       # under the table
    assert not m.nav.is_open((10, 2))                      # in the dividing wall
    assert not m.nav.is_open((10.2, 8))                    # against it
    assert m.nav.is_open((10, 5))                          # in the doorway
    assert not m.nav.clear((2, 5), (8, 5))                 # straight through the table
    assert m.nav.clear((2, 1), (8, 1))                     # past it
    with pytest.raises(ValueError, match="spawn point"):   # a spawn point on the table will not load
        MapData.from_dict({**FURNISHED, "spawn_points": [[5, 5], [18, 2], [2, 2]]})


def test_a_zombie_walks_round_the_table_and_through_the_door():
    m = MapData.from_dict(FURNISHED)
    w = World(m.nav)
    w.spawn(WALKER, 16, 5)                                 # east room
    trail, bit = chase(w, Dummy("p", 2.0, 5.0))           # just west of the table
    assert bit
    assert not any(in_table(p) for p in trail), "walked over the table"
    crossings = [p for p in trail if 9.5 < p[0] < 10.5]
    assert crossings and all(3.9 < p[1] < 6.1 for p in crossings), "came through the wall, not the door"


L_WALK = [[(0, 0), (20, 0), (20, 20)]]       # along a corridor, round a corner, up another


def test_a_walked_area_is_open_only_where_someone_walked():
    nav = GridNav.from_paths(L_WALK)
    assert nav.is_open((10, 0)) and nav.is_open((20, 10)) and nav.is_open((10, 0.6))
    assert not nav.is_open((10, 10))                       # the room in the corner was never walked
    assert not nav.clear((5, 0), (20, 15))                 # so nothing cuts across it


def test_zombies_on_a_walked_area_follow_the_walk_round_the_corner():
    m = MapData.from_walk(L_WALK, (43.0, -81.0))
    w = World(m.nav)
    w.spawn(WALKER, 20, 19)
    trail, bit = chase(w, Dummy("p", 1.0, 0.0))
    assert bit
    assert all(m.nav.is_open(p) for p in trail), "left the walked floor"
    assert any(p[0] > 19 and p[1] < 2 for p in trail), "cut the corner instead of going round it"


def test_a_walked_map_starts_where_the_walk_did_and_puts_the_helicopter_at_the_far_end():
    m = MapData.from_walk(L_WALK, (43.0, -81.0))
    assert m.id == mapdata.WALK_ID and m.origin == (43.0, -81.0)
    assert m.start == (0, 0)
    assert math.dist((m.helicopter.x, m.helicopter.y), (20, 20)) < 1
    assert len(m.spawn_points) > 5 and all(m.nav.is_open(p) for p in m.spawn_points)
    pub = m.public()
    assert pub["paths"] == [[[0, 0], [20, 0], [20, 20]]]
    marked = MapData.from_walk(L_WALK, (43.0, -81.0), helicopter=(20, 5))
    assert (marked.helicopter.x, marked.helicopter.y) == (20, 5)
    with pytest.raises(ValueError, match="Walk at least"):
        MapData.from_walk([[(0, 0), (5, 0)]], (43.0, -81.0))


def test_spawns_on_a_walked_area_stay_on_it_and_out_of_sight():
    m = MapData.from_walk(L_WALK, (43.0, -81.0))
    rng = random.Random(3)
    me = (0.0, 0.0, 90.0)                                  # at the start, looking down the corridor
    for _ in range(100):
        p = m.spawn_position(rng, [me[:2]], me[:2], [me])
        assert m.nav.is_open(p)
        assert not m.in_view(p, [me]), p                   # round the corner, not in front of her


def test_free_play_in_the_room():
    r = Room("T", Settings(mode="endless"), now=0, rng=random.Random(1),
             tuning=Tuning(grace_s=0.2, spawn_gap_s=0.1, wave_max_s=10_000))
    a = r.add_player("Ada")
    b = r.add_player("Bo")
    r.set_map(a.id, mapdata.WALK_ID)                       # picked, not walked yet
    with pytest.raises(GameError, match="Walk the area first"):
        r.start(a.id, 0)
    with pytest.raises(GameError, match="host"):
        r.set_area(b.id, (43.0, -81.0), L_WALK)
    with pytest.raises(GameError, match="Walk at least"):
        r.set_area(a.id, (43.0, -81.0), [[(0, 0), (3, 0)]])
    r.set_area(a.id, (43.0, -81.0), L_WALK)
    assert r.lobby_state()["map"]["id"] == mapdata.WALK_ID
    ev = r.start(a.id, 0)
    assert ev["map"]["paths"] and ev["map"]["origin"] == [43.0, -81.0]
    r.update_pos(a.id, 0, 0, 3, 90, 0)
    r.update_pos(b.id, 1, 0, 3, 90, 0)
    t = 0.0
    while t < 3:
        t += 0.05
        r.tick(t)
        assert all(r.map.nav.is_open((z.x, z.y)) for z in r.world.zombies.values())
    assert r.world.zombies
    r.reset(a.id)                                          # play again: the walk is kept
    assert r.map.id == mapdata.WALK_ID


def test_a_mission_needs_the_helicopter_a_walk_away():
    r = Room("T", Settings(mode="mission"), now=0)
    a = r.add_player("Ada")
    r.set_area(a.id, (43.0, -81.0), [[(0, 0), (8, 0), (8, 6), (0, 6), (0, 0.5)]])   # a 28 m lap of a small room
    with pytest.raises(GameError, match="helicopter"):
        r.start(a.id, 0)
    r.set_mode(a.id, "endless")
    r.start(a.id, 0)                                       # endless has no helicopter to reach


def test_the_drawn_walk_keeps_its_shape_with_far_fewer_points():
    wiggly = [[(x * 0.5, (0.1 if x % 2 else -0.1)) for x in range(80)] + [(40, y * 0.5) for y in range(1, 60)]]
    m = MapData.from_walk(wiggly, (43.0, -81.0))
    drawn = m.public()["paths"][0]
    assert len(drawn) <= 6                                  # a corridor and a turn, not 139 points
    assert drawn[0] == [0.0, -0.1] and drawn[-1] == [40.0, 29.5]
