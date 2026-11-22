"""Map files. A map is a flat plane in metres plus the things placed on it:
where the squad starts, where the helicopter is, and where zombies come from.

Two kinds of map share one file format:

* The open arena: no walls, no fixed place in the world. Zombies spawn in a
  ring around the squad and walk in straight lines.
* A building: an outline and walls in metres, a corridor graph for zombies
  to follow, fixed spawn points, and an origin that pins it to real
  latitude/longitude.

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

from .geo import dist_xy, from_local, to_local
from .nav import Nav

MAPS_DIR = Path(__file__).resolve().parent.parent / "maps"

Point = tuple[float, float]


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
    nav: Optional[Nav] = field(default=None, compare=False, repr=False)

    # ---- construction ----------------------------------------------------
    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MapData":
        h = d["helicopter"]
        sp = d.get("spawn") or {}
        origin = d.get("origin")
        walls = [(float(w[0]), float(w[1]), float(w[2]), float(w[3])) for w in d.get("walls", [])]
        graph = d.get("graph") or None
        nav = None
        if walls or graph:
            # Raises if a corridor edge runs through a wall: catch a bad map at load, not mid-game.
            nav = Nav(walls, (graph or {}).get("nodes"), [tuple(e) for e in (graph or {}).get("edges", [])])
        return cls(
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
            outline=[(float(p[0]), float(p[1])) for p in d.get("outline", [])],
            walls=walls,
            labels=[{"text": str(lb["text"]), "x": float(lb["x"]), "y": float(lb["y"])} for lb in d.get("labels", [])],
            graph=graph,
            nav=nav,
        )

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
    def spawn_position(self, rng: random.Random, players: Sequence[Point],
                       around: Optional[Point] = None) -> Point:
        """Somewhere for a zombie to appear: never on top of a player, and
        close enough that it reaches the squad while the wave still matters.

        `around` is the point the wave is pressing on (a player, or the
        helicopter during the hold); it defaults to the map start."""
        centre = around or (players[0] if players else self.start)

        def clearance(p: Point) -> float:
            return min((dist_xy(p[0], p[1], q[0], q[1]) for q in players), default=math.inf)

        if self.spawn_mode == "points" and self.spawn_points:
            far_enough = [p for p in self.spawn_points if clearance(p) >= self.spawn_min_m]
            if far_enough:
                # Prefer the nearer half (by corridor, not through walls) so
                # zombies do not spend the whole wave walking in.
                walk = self.nav.route_length if self.nav else (lambda p, q: dist_xy(p[0], p[1], q[0], q[1]))
                far_enough.sort(key=lambda p: walk(p, centre))
                pick = rng.choice(far_enough[: max(1, (len(far_enough) + 1) // 2)])
            else:
                pick = max(self.spawn_points, key=clearance)
            jittered = (pick[0] + rng.uniform(-1.0, 1.0), pick[1] + rng.uniform(-1.0, 1.0))
            if self.nav and not self.nav.clear(pick, jittered):
                return pick                    # the nudge would have put it inside a wall
            return jittered

        best: Optional[Point] = None
        best_clear = -1.0
        for _ in range(12):
            a = rng.uniform(0.0, 2 * math.pi)
            r = rng.uniform(self.spawn_min_m, self.spawn_max_m)
            p = (centre[0] + math.sin(a) * r, centre[1] + math.cos(a) * r)
            c = clearance(p)
            if c >= self.spawn_min_m * 0.85:
                return p
            if c > best_clear:
                best, best_clear = p, c
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
    """Id and display name of every map, for the lobby's picker."""
    return [{"id": mid, "name": load_map(mid).name} for mid in available_maps()]
