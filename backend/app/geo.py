"""Geodesy helpers. Everything is in degrees and metres; headings are
compass bearings (0 = north, clockwise)."""
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


def dynamic_gate_deg(cone_deg: float, acc_shooter_m: float, acc_target_m: float,
                     dist_m: float, cap_deg: float = 40.0) -> float:
    """How far off boresight a shot may be and still count.

    The weapon's cone is the design intent; the second term is the angular
    size of the combined GPS uncertainty at this range, so a shot that is
    physically indistinguishable from on-target is not thrown away. Capped so
    a bad fix can't turn a rifle into a flamethrower.
    """
    slop = math.degrees(math.atan2(max(acc_shooter_m, 0) + max(acc_target_m, 0), max(dist_m, 1.0)))
    return min(cone_deg + slop, max(cap_deg, cone_deg))


def offset_m(lat: float, lon: float, north_m: float, east_m: float) -> tuple[float, float]:
    """Move a point by metres north/east. Good enough at play scale."""
    dlat = north_m / EARTH_RADIUS_M
    dlon = east_m / (EARTH_RADIUS_M * math.cos(math.radians(lat)))
    return lat + math.degrees(dlat), lon + math.degrees(dlon)
