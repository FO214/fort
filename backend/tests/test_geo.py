import math

from app.geo import angle_diff_deg, bearing_deg, dynamic_gate_deg, haversine_m, offset_m

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
    assert abs(bearing_deg(lat, lon, *n) - 0) < 0.1 or abs(bearing_deg(lat, lon, *n) - 360) < 0.1
    assert abs(bearing_deg(lat, lon, *e) - 90) < 0.1
    assert abs(bearing_deg(lat, lon, *s) - 180) < 0.1
    assert abs(bearing_deg(lat, lon, *w) - 270) < 0.1


def test_angle_diff_wraps():
    assert angle_diff_deg(10, 350) == 20
    assert angle_diff_deg(350, 10) == -20
    assert angle_diff_deg(0, 180) == 180
    assert abs(angle_diff_deg(90, 90)) == 0


def test_dynamic_gate_widens_with_uncertainty_and_range():
    # Perfect fix: gate ≈ cone.
    assert abs(dynamic_gate_deg(10, 0, 0, 30) - 10) < 1e-6
    # 5 m + 5 m of uncertainty at 30 m adds atan(10/30) ≈ 18.4°.
    g = dynamic_gate_deg(10, 5, 5, 30)
    assert abs(g - (10 + math.degrees(math.atan2(10, 30)))) < 1e-6
    # Same uncertainty at 100 m is much tighter.
    assert dynamic_gate_deg(10, 5, 5, 100) < g
    # Never wider than the cap.
    assert dynamic_gate_deg(10, 50, 50, 5) == 40
