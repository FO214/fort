"""Geometry helpers.

Two coordinate systems are in play:

* Real world: degrees of latitude/longitude, compass bearings (0 = north,
  clockwise).
* The map: a flat plane in metres, x to the right and y up. A map's
  `rotation_deg` is the compass bearing its +y axis points along, so with
  rotation 0 the map is x east / y north. Headings on the map use the same
  clockwise-from-+y convention as a compass.
"""
from __future__ import annotations

import math

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial compass bearing from point 1 to point 2, in [0, 360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlmb = math.radians(lon2 - lon1)
    x = math.sin(dlmb) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlmb)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def angle_diff_deg(a: float, b: float) -> float:
    """Signed smallest difference a - b, in (-180, 180]."""
    d = (a - b + 180.0) % 360.0 - 180.0
    return 180.0 if d == -180.0 else d


def offset_m(lat: float, lon: float, north_m: float, east_m: float) -> tuple[float, float]:
    """Move a point by metres north/east. Good enough at play scale."""
    dlat = north_m / EARTH_RADIUS_M
    dlon = east_m / (EARTH_RADIUS_M * math.cos(math.radians(lat)))
    return lat + math.degrees(dlat), lon + math.degrees(dlon)


# ------------------------------------------------------------------ map plane

def bearing_xy(x1: float, y1: float, x2: float, y2: float) -> float:
    """Map heading from point 1 to point 2, in [0, 360). 0 = +y, clockwise."""
    return (math.degrees(math.atan2(x2 - x1, y2 - y1)) + 360.0) % 360.0


def dist_xy(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def to_local(lat: float, lon: float, origin_lat: float, origin_lon: float,
             rotation_deg: float = 0.0) -> tuple[float, float]:
    """Latitude/longitude to map metres. Flat-earth around the origin, which
    is exact to millimetres over one building."""
    north = math.radians(lat - origin_lat) * EARTH_RADIUS_M
    east = math.radians(lon - origin_lon) * EARTH_RADIUS_M * math.cos(math.radians(origin_lat))
    r = math.radians(rotation_deg)
    return (east * math.cos(r) - north * math.sin(r),
            east * math.sin(r) + north * math.cos(r))


def from_local(x: float, y: float, origin_lat: float, origin_lon: float,
               rotation_deg: float = 0.0) -> tuple[float, float]:
    """Inverse of `to_local`."""
    r = math.radians(rotation_deg)
    east = x * math.cos(r) + y * math.sin(r)
    north = -x * math.sin(r) + y * math.cos(r)
    return offset_m(origin_lat, origin_lon, north, east)
