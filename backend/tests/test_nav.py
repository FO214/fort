"""Walls, line of sight and corridor routes. The test building is two rooms
side by side with one door between them:

    y=10 +-----------+-----------+
         |           |           |
         |   west    |   east    |
         |          door         |      door gap: x = 10, y from 4 to 6
         |           |           |
    y=0  +-----------+-----------+
        x=0         x=10        x=20
"""
import math
import random
from dataclasses import dataclass

import pytest

from app import mapdata
from app.mapdata import MapData
from app.mission import Tuning
from app.models import Settings
from app.nav import Nav, segments_cross
from app.room import GameError, Room
from app.world import ATTACK, WALKER, World

WALLS = [
    [0, 0, 20, 0], [20, 0, 20, 10], [20, 10, 0, 10], [0, 10, 0, 0],     # outside
    [10, 0, 10, 4], [10, 6, 10, 10],                                    # dividing wall with a door
]
NODES = {"west": [5, 5], "door": [10, 5], "east": [15, 5], "ne": [18, 9]}
EDGES = [["west", "door"], ["door", "east"], ["east", "ne"]]
TWO_ROOMS = {
    "id": "tworooms", "name": "Two rooms", "origin": [43.0, -81.0], "rotation_deg": 30,
    "start": [3, 5], "helicopter": {"x": 17, "y": 5, "radius_m": 2},
    "outline": [[0, 0], [20, 0], [20, 10], [0, 10]],
    "walls": WALLS, "labels": [{"text": "West room", "x": 5, "y": 8}],
    "graph": {"nodes": NODES, "edges": EDGES},
    "spawn": {"mode": "points", "min_m": 6}, "spawn_points": [[18, 8], [18, 2], [2, 2]],
}


@dataclass
class Dummy:
    id: str
    x: float
    y: float


@pytest.fixture
def nav():
    return Nav(WALLS, NODES, [tuple(e) for e in EDGES])


@pytest.fixture
def tworooms(monkeypatch):
    """Make the test building loadable by id, as if it were a file in maps/."""
    monkeypatch.setitem(mapdata._cache, "tworooms", MapData.from_dict(TWO_ROOMS))
    return mapdata._cache["tworooms"]


# ------------------------------------------------------------------ geometry

def test_crossing_is_strict():
    assert segments_cross((0, 0), (2, 2), (0, 2), (2, 0))
    assert not segments_cross((0, 0), (1, 1), (0, 2), (2, 0.5))         # stops short
    assert not segments_cross((0, 0), (2, 0), (0, 1), (2, 1))           # parallel
    assert not segments_cross((0, 0), (2, 0), (1, 0), (1, 5))           # only touches the wall's end


def test_line_of_sight(nav):
    assert nav.clear((2, 2), (8, 8))                                    # same room
    assert not nav.clear((5, 2), (15, 2))                               # wall between the rooms
    assert nav.clear((5, 5), (15, 5))                                   # straight through the door
    assert not nav.clear((5, 9), (15, 7))                               # diagonal misses the door
    assert not nav.clear((5, 5), (5, 15))                               # out through the outside wall


# ------------------------------------------------------------------ routes

def test_route_goes_through_the_door(nav):
    frm, to = (5, 1), (15, 1)                                           # opposite corners, wall between
    assert nav.waypoint(frm, to) == (10, 5)                             # head for the door first
    assert nav.waypoint((10, 5), to) == to                              # from the door: straight in
    assert nav.waypoint((2, 2), (8, 8)) == (8, 8)                       # nothing in the way: no detour
    # Walking distance is measured along the corridor, so it is longer than the
    # 10 m through the wall (and a little longer than the best corner-cutting path).
    assert 12.8 <= nav.route_length(frm, to) <= 18.0


def test_corners_are_cut_when_the_next_one_is_already_in_view(nav):
    # From the west room's middle the door is visible, and so is the east node beyond it.
    assert nav.waypoint((5, 5), (18, 9.5)) in ((15, 5), (18, 9), (18, 9.5))
    # From a corner of the west room only the door is.
    assert nav.waypoint((1, 9), (18, 9)) == (10, 5)


def hops(nav, frm, to, limit=8):
    """Follow waypoints from `frm` until the route says "go straight at it"."""
    trail = [frm]
    for _ in range(limit):
        wp = nav.waypoint(trail[-1], to)
        if wp == to:
            return trail
        trail.append(wp)
    raise AssertionError(f"never got a straight run at {to}: {trail}")


def test_a_player_whose_gps_is_inside_a_wall_is_still_reached(nav):
    stuck = (25, 5)                                                     # GPS says: outside the building
    # From the next room: through the door, to the corridor node nearest them, then straight at them.
    trail = hops(nav, (2, 9.5), stuck)
    assert trail == [(2, 9.5), (10, 5), (18, 9)]
    assert hops(nav, (18, 9), stuck) == [(18, 9)]                       # last stretch ignores the wall


def test_a_corridor_edge_through_a_wall_is_rejected_at_load():
    with pytest.raises(ValueError, match="through a wall"):
        Nav(WALLS, {"a": [5, 2], "b": [15, 2]}, [("a", "b")])
    with pytest.raises(ValueError, match="does not exist"):
        Nav(WALLS, {"a": [5, 2]}, [("a", "nowhere")])


def test_open_maps_have_no_nav():
    assert mapdata.load_map("arena").nav is None


# ------------------------------------------------------------------ zombies in a building

def walk(world, targets, seconds, t=0.0, dt=0.05):
    path = []
    for _ in range(round(seconds / dt)):
        t += dt
        world.step(dt, t, targets)
        path.append([(z.x, z.y) for z in world.zombies.values()])
    return t, path


def test_zombie_walks_round_through_the_door_not_through_the_wall(nav):
    w = World(nav)
    z = w.spawn(WALKER, 15, 1.5)                                        # east room, far corner
    ada = Dummy("ada", 5, 1.5)                                          # west room, level with it
    t, path = walk(w, [ada], 14)
    assert z.state == ATTACK and math.dist((z.x, z.y), (5, 1.5)) <= WALKER.reach_m * 1.2
    # Every step of the way was a legal move: it never passed through a wall.
    pts = [(15, 1.5)] + [p[0] for p in path]
    assert all(nav.clear(a, b) for a, b in zip(pts, pts[1:]))
    assert any(abs(x - 10) < 0.3 and 4 < y < 6 for x, y in pts)        # it used the door
    assert t * WALKER.speed > 12                                        # and so walked further than 10 m


def test_without_a_map_the_same_zombie_walks_straight():
    w = World()
    z = w.spawn(WALKER, 15, 1.5)
    walk(w, [Dummy("ada", 5, 1.5)], 3)
    assert z.y == pytest.approx(1.5) and z.x == pytest.approx(15 - 3 * WALKER.speed, abs=0.05)


def test_crowding_does_not_shove_zombies_through_walls(nav):
    w = World(nav)
    for i in range(10):
        w.spawn(WALKER, 9.6, 2 + i * 0.05)                              # packed against the dividing wall
    walk(w, [Dummy("ada", 2, 2)], 4)
    assert all(z.x < 10 for z in w.zombies.values())                    # nobody was pushed into the east room


# ------------------------------------------------------------------ the room on a building map

def test_host_picks_the_map_in_the_lobby(tworooms):
    r = Room("T", Settings(), now=0, tuning=Tuning(grace_s=10_000))
    a, b = r.add_player("Ada"), r.add_player("Bo")
    assert r.lobby_state()["map"]["id"] == "arena"
    with pytest.raises(GameError, match="host"):
        r.set_map(b.id, "tworooms")
    with pytest.raises(GameError, match="Unknown map"):
        r.set_map(a.id, "atlantis")
    r.set_map(a.id, "tworooms")
    lobby = r.lobby_state()
    assert lobby["settings"]["map"] == "tworooms" and lobby["map"]["name"] == "Two rooms"
    assert lobby["map"]["walls"] == [list(map(float, w)) for w in WALLS]
    assert lobby["map"]["outline"][2] == [20, 10] and lobby["map"]["labels"][0]["text"] == "West room"
    r.start(a.id, 1)
    with pytest.raises(GameError, match="locks"):
        r.set_map(a.id, "arena")


def test_a_surveyed_building_keeps_its_own_place_in_the_world(tworooms):
    r = Room("T", Settings(map="tworooms"), now=0, tuning=Tuning(grace_s=10_000))
    a = r.add_player("Ada")
    started = r.start(a.id, 1, lat=10.0, lon=20.0)                      # the host's fix is not the origin here
    assert started["map"]["origin"] == [43.0, -81.0] and started["map"]["rotation_deg"] == 30
    assert (a.x, a.y) == (3, 5)                                         # everyone begins in the start room


def test_zombies_spawn_at_the_buildings_spawn_points_and_come_through_the_door(tworooms):
    r = Room("T", Settings(map="tworooms"), now=0, rng=random.Random(2),
             tuning=Tuning(grace_s=0.5, spawn_gap_s=0.2, wave_max_s=10_000))
    a = r.add_player("Ada")
    r.start(a.id, 0)
    r.update_pos(a.id, 3, 5, 3, 90, 0)                                  # west room
    t, seen, hurt = 0.0, set(), False
    while t < 25 and not hurt:
        t += 0.05
        hurt = any(e["t"] == "hurt" for e in r.tick(t))
        seen |= {(round(z.x), round(z.y)) for z in r.world.zombies.values()}
    assert hurt                                                         # they got to her
    # They appeared at the far spawn points (the one beside her is too close)...
    assert not any(x <= 4 and y <= 4 for x, y in list(seen)[:1])
    spawned_east = [p for p in seen if p[0] >= 16]
    assert spawned_east
    # ...and nobody was ever inside the dividing wall away from the door.
    assert not any(x == 10 and (y < 4 or y > 6) for x, y in seen)


def test_play_again_forgets_nothing_about_the_building(tworooms):
    r = Room("T", Settings(map="tworooms"), now=0, tuning=Tuning(grace_s=10_000))
    a = r.add_player("Ada")
    r.start(a.id, 1)
    r.reset(a.id)
    assert r.map.id == "tworooms" and r.world.nav is tworooms.nav
    r.start(a.id, 5)
    assert r.world.nav is tworooms.nav


# ------------------------------------------------------------------ every map we ship

def _inside(outline, p):
    odd = False
    for (xi, yi), (xj, yj) in zip(outline, outline[-1:] + outline[:-1]):
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi:
            odd = not odd
    return odd


@pytest.mark.parametrize("map_id", mapdata.available_maps())
def test_shipped_maps_are_sound(map_id):
    m = mapdata.load_map(map_id)                       # loading already rejects edges through walls
    assert m.id == map_id and m.name
    heli = (m.helicopter.x, m.helicopter.y)
    assert math.dist(m.start, heli) > m.helicopter.radius_m * 2, "the squad must not start on the helicopter"
    if m.spawn_mode == "points":
        assert len(m.spawn_points) >= 3
    if m.outline:
        places = {"start": m.start, "helicopter": heli}
        places.update({f"spawn {i}": p for i, p in enumerate(m.spawn_points)})
        places.update({f"node {k}": v for k, v in (m.nav.nodes if m.nav else {}).items()})
        outside = [name for name, p in places.items() if not _inside(m.outline, p)]
        assert not outside, f"outside the building: {outside}"
    if m.nav and m.nav.nodes:
        # The squad can walk from the start to the helicopter along the corridors,
        # and every spawn point can reach both.
        nav = m.nav
        a, b = nav.nearest_node(m.start), nav.nearest_node(heli)
        assert a == b or b in nav.next_hop[a]
        for p in m.spawn_points:
            s = nav.nearest_node(p)
            assert s == a or a in nav.next_hop[s], f"spawn point {p} cannot reach the start"
            # A spawn point shut inside a room would send its zombie through a wall.
            assert any(nav.clear(p, n) for n in nav.nodes.values()), f"spawn point {p} is walled in"
        for name, p in (("start", m.start), ("helicopter", heli)):
            assert any(nav.clear(p, n) for n in nav.nodes.values()), f"the {name} is walled in"
    if m.origin:
        lat, lon = m.to_latlon(*m.start)
        back = m.to_local(lat, lon)
        assert math.dist(back, m.start) < 0.01


def test_schmeichel_matches_the_walkthrough():
    """The layout the video shows: helicopter in the atrium between the two
    real entrances, one straight concourse, the squad starting in the café at
    the far end of the north wing."""
    m = mapdata.load_map("schmeichel")
    nav = m.nav
    heli = (m.helicopter.x, m.helicopter.y)
    west_entrance, south_east_entrance = (-3.5, -4.6), (30.1, -19.6)        # OSM entrance nodes
    assert 12 < math.dist(heli, west_entrance) < 20
    assert 18 < math.dist(heli, south_east_entrance) < 30
    assert math.dist(heli, m.to_local(43.0072, -81.2764)) < 30               # the video's own GPS tag, +-30 m
    assert 50 < math.dist(m.start, heli) < 65                                # about seven column bays
    assert nav.clear(m.start, heli)                                          # you can see straight down the concourse
    # The rooms east of the concourse are closed: no line of sight through the dark wall.
    concourse, in_the_rooms = nav.nodes["concourse_mid"], (m.labels[1]["x"], m.labels[1]["y"])
    assert m.labels[1]["text"] == "Rooms" and not nav.clear(concourse, in_the_rooms)
    # The side corridor is the only way to the east exit doors.
    assert nav.next_hop["concourse_mid"]["exit_doors"] == "concourse_south"
    assert nav.next_hop["junction"]["exit_doors"] == "side_corridor"


def test_schmeichel_sits_where_the_real_building_is():
    m = mapdata.load_map("schmeichel")
    # North-west corner of the footprint, from OpenStreetMap way 1300081894.
    lat, lon = m.to_latlon(-15.0, 62.5)
    assert lat == pytest.approx(43.0078337, abs=2e-6) and lon == pytest.approx(-81.2765121, abs=2e-6)
    # The footprint is about 2,970 square metres.
    o = m.outline
    area = abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(o, o[1:] + o[:1]))) / 2
    assert 2900 < area < 3050
