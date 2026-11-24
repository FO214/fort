"""Map files. A map is a flat plane in metres plus the things placed on it:
where the squad starts, where the helicopter is, and where zombies come from.

Three kinds of map share one format:

* The open arena: no walls, no fixed place in the world. Zombies spawn in a
  ring around the squad and walk in straight lines.
* A building: an outline and walls in metres, a corridor graph for zombies
  to follow, fixed spawn points, and an origin that pins it to real
  latitude/longitude. Tables, counters, pillars and the like can be added as
  `obstacles`; then zombies steer over a grid of open floor (see grid.py)
  instead of the hand-drawn graph.
* A walked area, for free play anywhere: no file. The host walks the space
  before the game and the walk becomes the map (`MapData.from_walk`).

Map file keys (all distances in metres, x right and y up):

    id, name            identifier and display name
    origin              [lat, lon] of map (0, 0), or null
    rotation_deg        compass bearing of the +y axis
    start               [x, y] where the squad begins
    helicopter          {x, y, radius_m, qr}
    outline             [[x, y], ...] building footprint, for drawing
    walls               [[x1, y1, x2, y2], ...] things zombies cannot walk through
    labels              [{"text", "x", "y"}, ...] room names, for drawing
    graph               {"nodes": {name: [x, y]}, "edges": [[a, b], ...]}
    obstacles           [[[x, y], ...], ...] polygons zombies walk round (tables, pillars...)
    nav                 "grid" to steer over open floor even without obstacles
    spawn               {"mode": "ring" | "points", "min_m", "max_m"}
    spawn_points        [[x, y], ...] used when mode is "points"
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Optional, Sequence

from .geo import angle_diff_deg, bearing_xy, dist_xy, from_local, to_local
from .grid import GridNav, resample
from .nav import Nav

MAPS_DIR = Path(__file__).resolve().parent.parent / "maps"

Point = tuple[float, float]
Viewer = tuple[float, float, float]          # a player's x, y and the map heading their camera faces

# A zombie's body is about 0.8 m across. Any nearer a wall than this and its
# sprite is drawn half inside the wall.
WALL_CLEAR_M = 0.5
# The camera sees about 33° either side of where it points. A little more, so
# a zombie does not appear the moment the player turns their head.
VIEW_HALF_DEG = 45.0
# Further than this a newly appeared zombie is a speck; it does not matter if it is seen.
SIGHT_M = 45.0
JITTER_M = 1.0
# Free play: the map is somewhere the host walked.
WALK_ID = "walked"
WALK_NAME = "Walked area"
MIN_WALK_M = 20.0
WALK_SPAWN_EVERY_M = 3.0
WALK_SPAWN_MIN_M = 9.0
JITTER_TRIES = 4
RING_TRIES = 24
SPAWN_CANDIDATES = 48         # spawn points weighed per zombie, at most


DRAW_TOLERANCE_M = 0.3       # a drawn path may stray this far from the walk


def simplify(path: Sequence[Point], tol: float) -> list[Point]:
    """The fewest points that keep the line within `tol` of `path` (Douglas-Peucker)."""
    if len(path) < 3:
        return list(path)
    keep = [False] * len(path)
    keep[0] = keep[-1] = True
    stack = [(0, len(path) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, ay), (bx, by) = path[i], path[j]
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        worst, at = 0.0, -1
        for k in range(i + 1, j):
            px, py = path[k]
            d = abs(dy * (px - ax) - dx * (py - ay)) / span if span else math.hypot(px - ax, py - ay)
            if d > worst:
                worst, at = d, k
        if worst > tol:
            keep[at] = True
            stack += [(i, at), (at, j)]
    return [p for p, k in zip(path, keep) if k]


def inside(poly: Sequence[Point], p: Point) -> bool:
    """Is `p` inside the polygon? (Even-odd rule.)"""
    odd = False
    for (x1, y1), (x2, y2) in zip(poly, list(poly[1:]) + list(poly[:1])):
        if (y1 > p[1]) != (y2 > p[1]) and p[0] < x1 + (p[1] - y1) * (x2 - x1) / (y2 - y1):
            odd = not odd
    return odd


@dataclass
class Helicopter:
    x: float
    y: float
    radius_m: float = 6.0
    qr: str = "LOONIE:HELI"


@dataclass
class MapData:
    id: str
    name: str
    start: Point
    helicopter: Helicopter
    origin: Optional[Point] = None           # (lat, lon) of map (0, 0), or None
    rotation_deg: float = 0.0                # compass bearing of the +y axis
    spawn_mode: str = "ring"                 # ring: around the squad · points: fixed
    spawn_min_m: float = 14.0
    spawn_max_m: float = 20.0
    spawn_points: list[Point] = field(default_factory=list)
    outline: list[Point] = field(default_factory=list)
    walls: list[tuple[float, float, float, float]] = field(default_factory=list)
    labels: list[dict[str, Any]] = field(default_factory=list)
    graph: Optional[dict[str, Any]] = None
    obstacles: list[list[Point]] = field(default_factory=list)
    paths: list[list[Point]] = field(default_factory=list)     # a walked area: where the host walked
    nav: Optional[Nav] = field(default=None, compare=False, repr=False)

    # ---- construction ----------------------------------------------------
    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MapData":
        h = d["helicopter"]
        sp = d.get("spawn") or {}
        origin = d.get("origin")
        walls = [(float(w[0]), float(w[1]), float(w[2]), float(w[3])) for w in d.get("walls", [])]
        graph = d.get("graph") or None
        outline = [(float(p[0]), float(p[1])) for p in d.get("outline", [])]
        obstacles = [[(float(p[0]), float(p[1])) for p in poly] for poly in d.get("obstacles", [])]
        nav: Optional[Nav] = None
        if obstacles or d.get("nav") == "grid":
            nav = GridNav.from_building(walls, obstacles, outline)
        elif walls or graph:
            # Raises if a corridor edge runs through a wall: catch a bad map at load, not mid-game.
            nav = Nav(walls, (graph or {}).get("nodes"), [tuple(e) for e in (graph or {}).get("edges", [])])
        m = cls(
            id=d["id"], name=d.get("name", d["id"]),
            start=(float(d["start"][0]), float(d["start"][1])),
            helicopter=Helicopter(float(h["x"]), float(h["y"]), float(h.get("radius_m", 6.0)),
                                  str(h.get("qr", "LOONIE:HELI"))),
            origin=(float(origin[0]), float(origin[1])) if origin else None,
            rotation_deg=float(d.get("rotation_deg", 0.0)),
            spawn_mode=sp.get("mode", "points" if d.get("spawn_points") else "ring"),
            spawn_min_m=float(sp.get("min_m", 14.0)),
            spawn_max_m=float(sp.get("max_m", 20.0)),
            spawn_points=[(float(p[0]), float(p[1])) for p in d.get("spawn_points", [])],
            outline=outline,
            walls=walls,
            obstacles=obstacles,
            labels=[{"text": str(lb["text"]), "x": float(lb["x"]), "y": float(lb["y"])} for lb in d.get("labels", [])],
            graph=graph,
            nav=nav,
        )
        for p in m.spawn_points:
            # Like the corridor check: a bad spawn point is a map bug, so refuse to load it.
            if not m.sensible_spot(p):
                raise ValueError(f"spawn point {list(p)} is outside the building or against a wall")
        return m

    @classmethod
    def from_walk(cls, paths: Sequence[Sequence[Point]], origin: Point,
                  helicopter: Optional[Point] = None, name: str = WALK_NAME) -> "MapData":
        """A map made by walking it. `paths` are where the host walked, in
        metres from `origin` (x east, y north); each is one stretch of
        walking, so a break in recording is not a corridor. The squad starts
        where the walk started; the helicopter goes where the host said, or
        else as far along the walk as it gets."""
        walk = [[(float(p[0]), float(p[1])) for p in path] for path in paths if len(path) >= 2]
        length = sum(math.dist(a, b) for path in walk for a, b in zip(path, path[1:]))
        if length < MIN_WALK_M:
            raise ValueError(f"Walk at least {MIN_WALK_M:.0f} m of the area first")
        nav = GridNav.from_paths(walk)
        start = walk[0][0]
        if helicopter is not None:
            heli = nav.snap(helicopter) or helicopter
        else:
            # Walking distances are measured to their end point, so measure them all to the start: one route tree.
            heli = max((p for path in walk for p in path), key=lambda p: nav.route_length(p, start))
        spots = [p for path in walk for p in resample(path, WALK_SPAWN_EVERY_M)]
        return cls(
            id=WALK_ID, name=name, start=start, helicopter=Helicopter(heli[0], heli[1]),
            origin=origin, rotation_deg=0.0, spawn_mode="points", spawn_min_m=WALK_SPAWN_MIN_M,
            spawn_points=[p for p in spots if nav.is_open(p)], paths=walk, nav=nav,
        )

    @property
    def walk_length_m(self) -> float:
        return sum(math.dist(a, b) for path in self.paths for a, b in zip(path, path[1:]))

    def with_origin(self, lat: float, lon: float) -> "MapData":
        """A copy anchored to a real-world point. Maps that already have an
        origin keep it: the building does not move because the host did."""
        if self.origin is not None:
            return self
        return replace(self, origin=(lat, lon))

    # ---- wire ------------------------------------------------------------
    def public(self) -> dict[str, Any]:
        h = self.helicopter
        return {
            "id": self.id, "name": self.name,
            "origin": list(self.origin) if self.origin else None,
            "rotation_deg": self.rotation_deg,
            "start": list(self.start),
            "helicopter": {"x": h.x, "y": h.y, "radius_m": h.radius_m, "qr": h.qr},
            "outline": [list(p) for p in self.outline],
            "walls": [list(w) for w in self.walls],
            "labels": self.labels,
            "obstacles": [[list(p) for p in poly] for poly in self.obstacles],
            # Phones draw these on the minimap every frame: send only the points the shape needs.
            "paths": [[[round(p[0], 2), round(p[1], 2)] for p in simplify(path, DRAW_TOLERANCE_M)] for path in self.paths],
        }

    # ---- coordinates -------------------------------------------------------
    def to_local(self, lat: float, lon: float) -> Point:
        if self.origin is None:
            raise ValueError("map has no origin")
        return to_local(lat, lon, self.origin[0], self.origin[1], self.rotation_deg)

    def to_latlon(self, x: float, y: float) -> Point:
        if self.origin is None:
            raise ValueError("map has no origin")
        return from_local(x, y, self.origin[0], self.origin[1], self.rotation_deg)

    # ---- spawning ----------------------------------------------------------
    def sensible_spot(self, p: Point) -> bool:
        """Somewhere a zombie could actually stand: inside the building (if
        the map has one) and not half inside a wall."""
        if self.outline and not inside(self.outline, p):
            return False
        return self.nav is None or self.nav.standable(p, WALL_CLEAR_M)

    def in_view(self, p: Point, viewers: Sequence[Viewer]) -> bool:
        """Would a player see a zombie appear at `p`? Only if it is in front
        of their camera, not too far off, and not behind a wall."""
        for vx, vy, heading in viewers:
            if dist_xy(vx, vy, p[0], p[1]) > SIGHT_M:
                continue
            if abs(angle_diff_deg(bearing_xy(vx, vy, p[0], p[1]), heading)) > VIEW_HALF_DEG:
                continue
            if self.nav is not None and not self.nav.clear((vx, vy), p):
                continue
            return True
        return False

    def spawn_position(self, rng: random.Random, players: Sequence[Point],
                       around: Optional[Point] = None, viewers: Sequence[Viewer] = ()) -> Point:
        """Somewhere for a zombie to appear: never on top of a player, close
        enough that it reaches the squad while the wave still matters, on
        open floor, and (whenever there is a choice) out of sight, so it
        walks in from somewhere instead of popping into existence on screen.

        `around` is the point the wave is pressing on (a player, or the
        helicopter during the hold); it defaults to the map start. `viewers`
        are the players who might watch it appear."""
        centre = around or (players[0] if players else self.start)

        def clearance(p: Point) -> float:
            return min((dist_xy(p[0], p[1], q[0], q[1]) for q in players), default=math.inf)

        if self.spawn_mode == "points" and self.spawn_points:
            far_enough = [p for p in self.spawn_points if clearance(p) >= self.spawn_min_m]
            if len(far_enough) > SPAWN_CANDIDATES:
                # A big walked area has hundreds; a fair sample keeps each spawn cheap.
                far_enough = rng.sample(far_enough, SPAWN_CANDIDATES)
            if far_enough:
                unseen = [p for p in far_enough if not self.in_view(p, viewers)]
                pool = unseen or far_enough
                # Prefer the nearer half (by corridor, not through walls) so
                # zombies do not spend the whole wave walking in.
                walk = self.nav.route_length if self.nav else (lambda p, q: dist_xy(p[0], p[1], q[0], q[1]))
                pool.sort(key=lambda p: walk(p, centre))
                pick = rng.choice(pool[: max(1, (len(pool) + 1) // 2)])
            else:
                pick = max(self.spawn_points, key=clearance)
            # Spread a wave out a little, but never into a wall, through one,
            # or out of the building.
            for _ in range(JITTER_TRIES):
                jittered = (pick[0] + rng.uniform(-JITTER_M, JITTER_M), pick[1] + rng.uniform(-JITTER_M, JITTER_M))
                if self.sensible_spot(jittered) and (self.nav is None or self.nav.clear(pick, jittered)):
                    return jittered
            return pick

        # Ring: try a few spots and keep the best. Standing room beats being
        # out of sight, which beats keeping a little more distance.
        best: Optional[Point] = None
        best_rank: tuple[bool, bool, bool, float] = (False, False, False, -1.0)
        for _ in range(RING_TRIES):
            a = rng.uniform(0.0, 2 * math.pi)
            r = rng.uniform(self.spawn_min_m, self.spawn_max_m)
            p = (centre[0] + math.sin(a) * r, centre[1] + math.cos(a) * r)
            c = clearance(p)
            rank = (self.sensible_spot(p), c >= self.spawn_min_m * 0.85, not self.in_view(p, viewers), c)
            if all(rank[:3]):
                return p
            if rank > best_rank:
                best, best_rank = p, rank
        assert best is not None
        return best


_cache: dict[str, MapData] = {}


def load_map(map_id: str) -> MapData:
    if map_id not in _cache:
        path = MAPS_DIR / f"{map_id}.json"
        if not path.is_file():
            raise KeyError(map_id)
        _cache[map_id] = MapData.from_dict(json.loads(path.read_text()))
    return _cache[map_id]


def available_maps() -> list[str]:
    return sorted(set(p.stem for p in MAPS_DIR.glob("*.json")) | set(_cache))


def map_choices() -> list[dict[str, str]]:
    """Id and display name of every map, for the lobby's picker. The last
    is free play: whatever area the host walks."""
    return [{"id": mid, "name": load_map(mid).name} for mid in available_maps()] + [{"id": WALK_ID, "name": "Walk it"}]
