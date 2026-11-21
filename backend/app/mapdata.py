"""Map files. A map is a flat plane in metres plus the things placed on it:
where the squad starts, where the helicopter is, and where zombies come from.

The open arena is the only map for now. A real building adds walls, a
corridor graph and fixed spawn points in the same file format (build step 5).
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Optional, Sequence

from .geo import dist_xy, from_local, to_local

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
    walls: list[Any] = field(default_factory=list)
    graph: Optional[dict[str, Any]] = None

    # ---- construction ----------------------------------------------------
    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MapData":
        h = d["helicopter"]
        sp = d.get("spawn") or {}
        origin = d.get("origin")
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
            walls=list(d.get("walls", [])),
            graph=d.get("graph"),
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
            "walls": self.walls,
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
                # Prefer the nearer half so zombies do not spend the whole wave walking in.
                far_enough.sort(key=lambda p: dist_xy(p[0], p[1], centre[0], centre[1]))
                pick = rng.choice(far_enough[: max(1, (len(far_enough) + 1) // 2)])
            else:
                pick = max(self.spawn_points, key=clearance)
            return (pick[0] + rng.uniform(-1.0, 1.0), pick[1] + rng.uniform(-1.0, 1.0))

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
    return sorted(p.stem for p in MAPS_DIR.glob("*.json"))
