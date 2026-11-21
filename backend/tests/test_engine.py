"""Engine tests with a fake clock — no sockets, no sleeping."""
import pytest

from app.engine import GameError, Room
from app.geo import offset_m
from app.models import WEAPONS, Settings

LAT, LON = 43.4723, -80.5449


def make_room(mode="ffa", **kw):
    r = Room("TEST", Settings(mode=mode, **kw), now=1000.0)
    a = r.add_player("Ada")
    b = r.add_player("Bo")
    return r, a, b


def place(r, p, north_m, east_m, heading, ts, acc=3.0):
    lat, lon = offset_m(LAT, LON, north_m, east_m)
    r.update_pos(p.id, lat, lon, acc, heading, 5.0, ts, ts)


def start(r, a, now=1000.0):
    r.start(a.id, now)


def test_lobby_and_start_rules():
    r = Room("X", Settings(), now=0)
    a = r.add_player("Ada")
    with pytest.raises(GameError):
        r.start(a.id, 1)                       # need two players
    b = r.add_player("Ada")                    # name collision de-duped
    assert b.name == "Ada 2"
    with pytest.raises(GameError):
        r.start(b.id, 1)                       # only host starts
    r.start(a.id, 1)
    assert r.phase == "playing" and r.ends_at == 1 + r.settings.duration_s
    with pytest.raises(GameError):
        r.add_player("Late")


def test_direct_hit_in_cone():
    r, a, b = make_room()
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)      # Ada faces north
    place(r, b, 20, 0, heading=180, ts=1002.0)   # Bo 20 m due north
    events = r.fire(a.id, 1, b.id, 1002.0, 1002.0)
    kinds = [e["t"] for e in events]
    assert kinds[0] == "fired" and events[0]["reason"] == "hit"
    assert "hit" in kinds
    hit = next(e for e in events if e["t"] == "hit")
    assert hit["hp"] == 8 - WEAPONS["regular"].damage
    assert abs(hit["dir"]) < 1.0                 # came from straight ahead of Bo
    assert a.ammo == WEAPONS["regular"].magazine - 1


def test_off_target_misses_but_still_costs_ammo():
    r, a, b = make_room()
    start(r, a)
    place(r, a, 0, 0, heading=90, ts=1002.0)     # Ada faces east
    place(r, b, 20, 0, heading=0, ts=1002.0)     # Bo is north
    events = r.fire(a.id, 1, b.id, 1002.0, 1002.0)
    assert events[0]["reason"] == "off_target"
    assert events[0]["off"] > events[0]["gate"]
    assert b.hp == 8 and a.ammo == WEAPONS["regular"].magazine - 1


def test_gps_uncertainty_widens_the_gate():
    r, a, b = make_room()
    start(r, a)
    # 18° off with tight 1 m fixes misses: gate = 11° + atan(2/20) ≈ 16.7°.
    place(r, a, 0, 0, heading=18, ts=1002.0, acc=1.0)
    place(r, b, 20, 0, heading=0, ts=1002.0, acc=1.0)
    assert r.fire(a.id, 1, b.id, 1002.0, 1002.0)[0]["reason"] == "off_target"
    # ...but with ±4 m fixes the gate opens to ≈ 32.8° and the same shot lands.
    place(r, a, 0, 0, heading=18, ts=1003.0, acc=4.0)
    place(r, b, 20, 0, heading=0, ts=1003.0, acc=4.0)
    assert r.fire(a.id, 2, b.id, 1003.0, 1003.0)[0]["reason"] == "hit"


def test_out_of_range():
    r, a, b = make_room()
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 90, 0, heading=0, ts=1002.0)      # regular range is 70 m
    assert r.fire(a.id, 1, b.id, 1002.0, 1002.0)[0]["reason"] == "range"


def test_fire_rate_and_magazine_and_reload():
    r, a, b = make_room()
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 10, 0, heading=0, ts=1002.0)
    w = WEAPONS["regular"]
    assert r.fire(a.id, 1, b.id, 1002.0, 1002.0)[0]["reason"] == "hit"
    assert r.fire(a.id, 2, b.id, 1002.1, 1002.1)[0]["reason"] == "cooldown"
    t = 1002.0
    seq = 3
    for _ in range(w.magazine - 1):
        t += w.fire_interval_s
        ev = r.fire(a.id, seq, b.id, t, t)
        seq += 1
        # Bo dies partway through; later shots report no_target. Fine.
    assert a.ammo == 0 and a.reloading_until > t
    assert ev[-1]["t"] == "reload"
    assert r.fire(a.id, seq, b.id, t + 0.5, t + 0.5)[0]["reason"] == "reloading"
    assert r.tick(t + w.reload_s + 0.01)[0]["t"] == "reloaded"
    assert a.ammo == w.magazine


def test_kill_death_respawn_and_protection():
    r, a, b = make_room(respawn_s=4)
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 10, 0, heading=0, ts=1002.0)
    t = 1002.0
    seq = 1
    while b.alive:
        t += 1.0
        events = r.fire(a.id, seq, b.id, t, t)
        seq += 1
    killed = next(e for e in events if e["t"] == "killed")
    assert killed["shooter"] == "Ada" and killed["target"] == "Bo"
    assert a.kills == 1 and b.deaths == 1 and not b.alive
    assert r.fire(a.id, seq, b.id, t + 1, t + 1)[0]["reason"] == "no_target"
    assert r.tick(t + 3.9) == []
    ev = r.tick(t + 4.0)
    assert ev[0]["t"] == "respawned" and b.alive and b.hp == 8
    # Spawn protection absorbs the next shot.
    assert r.fire(a.id, seq + 1, b.id, t + 4.5, t + 4.5)[0]["reason"] == "protected"
    assert r.fire(a.id, seq + 2, b.id, t + 6.0, t + 6.0)[0]["reason"] == "hit"


def test_no_friendly_fire_in_teams():
    r, a, b = make_room(mode="teams")
    r.set_team(a.id, "alpha")
    r.set_team(b.id, "alpha")
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 10, 0, heading=0, ts=1002.0)
    assert r.fire(a.id, 1, b.id, 1002.0, 1002.0)[0]["reason"] == "friendly"
    r2, c, d = make_room(mode="teams")
    assert {c.team, d.team} == {"alpha", "bravo"}   # auto-balanced


def test_lag_compensation_rewinds_target():
    r, a, b = make_room()
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 20, 0, heading=0, ts=1002.0)     # Bo in front at t=1002
    place(r, b, 0, 30, heading=0, ts=1002.8)     # Bo sprinted east by t=1002.8
    # Shooter's trigger pull is stamped 1002.1; the server hears it at 1002.9.
    ev = r.fire(a.id, 1, b.id, 1002.1, 1002.9)
    assert ev[0]["reason"] == "hit"
    # A pull stamped after the move misses.
    ev = r.fire(a.id, 2, b.id, 1002.9, 1003.5)
    assert ev[0]["reason"] == "off_target"


def test_duplicate_seq_ignored_and_match_end():
    r, a, b = make_room(duration_s=60)
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 10, 0, heading=0, ts=1002.0)
    assert r.fire(a.id, 5, b.id, 1002.0, 1002.0)[0]["reason"] == "hit"
    assert r.fire(a.id, 5, b.id, 1003.0, 1003.0) == []
    assert r.fire(a.id, 4, b.id, 1003.0, 1003.0) == []
    assert r.tick(1059.9) == []
    ev = r.tick(1060.0)
    assert ev[0]["t"] == "ended" and r.phase == "ended"
    assert ev[0]["results"][0]["name"] == "Ada" and ev[0]["results"][0]["place"] == 1
    with pytest.raises(GameError):
        r.fire(a.id, 6, b.id, 1061.0, 1061.0)


def test_reset_returns_room_to_lobby():
    r, a, b = make_room(duration_s=60)
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 10, 0, heading=0, ts=1002.0)
    r.fire(a.id, 1, b.id, 1002.0, 1002.0)
    with pytest.raises(GameError):
        r.reset(a.id)                      # not while playing
    r.tick(1060.0)
    with pytest.raises(GameError):
        r.reset(b.id)                      # host only
    r.reset(a.id)
    assert r.phase == "lobby" and a.kills == 0 and r.results == []
    r.start(a.id, 1100.0)                  # can play again
    assert r.phase == "playing"


def test_manual_reload_refills_a_partial_magazine():
    r, a, b = make_room()
    start(r, a)
    place(r, a, 0, 0, heading=0, ts=1002.0)
    place(r, b, 10, 0, heading=0, ts=1002.0)
    r.fire(a.id, 1, b.id, 1002.0, 1002.0)
    assert a.ammo == WEAPONS["regular"].magazine - 1
    ev = r.reload(a.id, 1003.0)
    assert ev[0]["t"] == "reload"
    assert r.reload(a.id, 1003.5) == []                       # already reloading
    assert r.fire(a.id, 2, b.id, 1003.5, 1003.5)[0]["reason"] == "reloading"
    assert r.tick(1003.0 + WEAPONS["regular"].reload_s) [0]["t"] == "reloaded"
    assert a.ammo == WEAPONS["regular"].magazine
    assert r.reload(a.id, 1010.0) == []                       # full: nothing to do


def test_manual_aim_ignores_geometry_but_keeps_the_rules():
    r, a, b = make_room(aim="manual")
    start(r, a)
    # No positions at all, and it still lands.
    assert r.fire(a.id, 1, b.id, 1002.0, 1002.0)[0]["reason"] == "hit"
    assert b.hp == 6
    # Friendly fire, protection and cooldown still apply.
    assert r.fire(a.id, 2, b.id, 1002.1, 1002.1)[0]["reason"] == "cooldown"
    r2, c, d = make_room(mode="teams", aim="manual")
    r2.set_team(c.id, "alpha"); r2.set_team(d.id, "alpha")
    start(r2, c)
    assert r2.fire(c.id, 1, d.id, 1002.0, 1002.0)[0]["reason"] == "friendly"
