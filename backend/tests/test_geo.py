import math

import pytest

from app.geo import (angle_diff_deg, bearing_deg, bearing_xy, dist_xy, from_local, haversine_m,
                     offset_m, to_local)

UW = (43.4723, -80.5449)   # somewhere on the UW ring road


def test_haversine_known_distance():
    lat, lon = UW
    lat2, lon2 = offset_m(lat, lon, 100, 0)
    assert abs(haversine_m(lat, lon, lat2, lon2) - 100) < 0.05
    lat3, lon3 = offset_m(lat, lon, 0, 30)
    assert abs(haversine_m(lat, lon, lat3, lon3) - 30) < 0.05


def test_bearing_cardinals():
    lat, lon = UW
    n = offset_m(lat, lon, 50, 0)
    e = offset_m(lat, lon, 0, 50)
    s = offset_m(lat, lon, -50, 0)
    w = offset_m(lat, lon, 0, -50)
    assert abs(angle_diff_deg(bearing_deg(lat, lon, *n), 0)) < 0.1
    assert abs(angle_diff_deg(bearing_deg(lat, lon, *e), 90)) < 0.1
    assert abs(angle_diff_deg(bearing_deg(lat, lon, *s), 180)) < 0.1
    assert abs(angle_diff_deg(bearing_deg(lat, lon, *w), 270)) < 0.1


def test_angle_diff_wraps():
    assert angle_diff_deg(350, 10) == -20
    assert angle_diff_deg(10, 350) == 20
    assert angle_diff_deg(180, 0) == 180
    assert angle_diff_deg(0, 180) == 180
    assert angle_diff_deg(725, 5) == 0


def test_map_bearing_is_compass_style():
    assert bearing_xy(0, 0, 0, 10) == 0          # +y is straight ahead
    assert bearing_xy(0, 0, 10, 0) == 90         # +x is to the right
    assert bearing_xy(0, 0, 0, -10) == 180
    assert bearing_xy(0, 0, -10, 0) == 270
    assert dist_xy(0, 0, 3, 4) == 5


def test_latlon_to_map_metres_unrotated():
    lat, lon = UW
    x, y = to_local(*offset_m(lat, lon, 40, -15), lat, lon)
    assert x == pytest.approx(-15, abs=0.02)
    assert y == pytest.approx(40, abs=0.02)


def test_rotated_map_points_plus_y_along_its_bearing():
    lat, lon = UW
    # A building whose "up" on the floor plan faces due east (bearing 90).
    x, y = to_local(*offset_m(lat, lon, 0, 25), lat, lon, rotation_deg=90)
    assert x == pytest.approx(0, abs=0.02)
    assert y == pytest.approx(25, abs=0.02)
    # Walking north there is walking to the plan's left.
    x, y = to_local(*offset_m(lat, lon, 10, 0), lat, lon, rotation_deg=90)
    assert x == pytest.approx(-10, abs=0.02)
    assert y == pytest.approx(0, abs=0.02)


@pytest.mark.parametrize("rotation", [0, 37, 90, 211])
def test_map_round_trip(rotation):
    lat, lon = UW
    for x, y in [(0, 0), (12.5, -30), (-48, 7)]:
        back = to_local(*from_local(x, y, lat, lon, rotation), lat, lon, rotation)
        assert math.hypot(back[0] - x, back[1] - y) < 0.01
