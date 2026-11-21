"""Room rules with a fake clock: no sockets, no sleeping."""
import random

import pytest

from app.mission import Tuning
from app.models import CLASSES, Settings
from app.room import ABSENT_AFTER_S, GameError, Room
from app.world import WALKER

T0 = 1000.0
QUIET = dict(grace_s=10_000)          # no waves unless a test asks for them


def make_room(names=("Ada", "Bo"), **tuning):
    r = Room("TEST", Settings(), now=T0, tuning=Tuning(**{**QUIET, **tuning}),
             rng=random.Random(5))
    return (r, *[r.add_player(n) for n in names])


def place(r, p, x, y, heading=0.0, acc=3.0):
    r.update_pos(p.id, x, y, acc, heading, 0.0)


def run(r, seconds, t, dt=0.05):
    events = []
    for _ in range(round(seconds / dt)):
        t += dt
        events += r.tick(t)
    return t, events


def kinds(events):
    return [e["t"] for e in events]


# ------------------------------------------------------------------ lobby

def test_lobby_rules():
    r = Room("X", Settings(), now=0)
    a = r.add_player("Ada")
    b = r.add_player("Ada")                    # name collision de-duped
    assert b.name == "Ada 2" and r.host_id == a.id
    with pytest.raises(GameError, match="host"):
        r.start(b.id, 1)
    r.add_player("Cy")
    r.add_player("Di")
    with pytest.raises(GameError, match="full"):
        r.add_player("Eve")                    # four is a full squad
    r.set_class(b.id, "heavy")
    with pytest.raises(GameError):
        r.set_class(b.id, "bazooka")
    started = r.start(a.id, 1)
    assert r.phase == "playing" and started["t"] == "started"
    assert started["map"]["id"] == "arena" and started["mission"]["phase"] == "journey"
    assert b.hp == CLASSES["heavy"].hp and b.ammo == CLASSES["heavy"].magazine
    with pytest.raises(GameError):
        r.add_player("Late")
    with pytest.raises(GameError):
        r.set_class(b.id, "light")             # loadout is locked now


def test_solo_start_is_allowed():
    r = Room("X", Settings(), now=0)
    a = r.add_player("Ada")
    r.start(a.id, 1)
    assert r.phase == "playing"


def test_unknown_map_is_refused():
    with pytest.raises(GameError, match="map"):
        Room("X", Settings(map="atlantis"), now=0)


def test_host_fix_anchors_the_arena():
    r, a, _ = make_room()
    started = r.start(a.id, T0, lat=43.4723, lon=-80.5449)
    assert started["map"]["origin"] == [43.4723, -80.5449]
    assert started["map"]["helicopter"]["qr"] == "LOONIE:HELI"


def test_players_start_at_the_map_start_until_they_report():
    r, a, b = make_room()
    r.start(a.id, T0)
    assert (a.x, a.y) == r.map.start and not a.has_fix
    place(r, a, 4, -2, heading=370)
    assert (a.x, a.y, a.heading, a.has_fix) == (4, -2, 10, True)


# ------------------------------------------------------------------ shooting

def test_a_shot_on_target_hurts_the_zombie():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    z = r.world.spawn(WALKER, 0, 10)                    # dead ahead
    ev = r.fire(a.id, 1, [z.id], 0.0, T0 + 1)
    assert kinds(ev) == ["fired", "zhit"]
    assert ev[0]["reason"] == "hit" and ev[0]["hits"] == [[z.id, WALKER.hp - 2]]
    assert ev[1] == {"t": "zhit", "id": z.id, "hp": WALKER.hp - 2, "by": a.id, "dmg": 2}
    assert a.ammo == CLASSES["regular"].magazine - 1 and a.shots == 1 and a.damage == 2


def test_killing_a_zombie_is_announced_and_credited():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    z = r.world.spawn(WALKER, 0, 10)
    t, ev = T0 + 1, []
    for seq in range(1, 4):                             # 6 hp / 2 damage
        ev = r.fire(a.id, seq, [z.id], 0.0, t)
        t += 0.5
    assert kinds(ev) == ["fired", "zhit", "zkill"]
    assert ev[2] == {"t": "zkill", "id": z.id, "by": a.id, "x": 0, "y": 10}
    assert z.id not in r.world.zombies and a.kills == 1
    late = r.fire(a.id, 9, [z.id], 0.0, t)              # someone else's bullet got there first
    assert late[0]["reason"] == "gone" and a.ammo == CLASSES["regular"].magazine - 4


def test_empty_trigger_pull_is_a_miss_that_costs_a_round():
    r, a, _ = make_room()
    r.start(a.id, T0)
    ev = r.fire(a.id, 1, [], 45.0, T0 + 1)
    assert ev == [{"t": "fired", "player_id": a.id, "seq": 1, "reason": "miss",
                   "ammo": CLASSES["regular"].magazine - 1, "hits": []}]
    assert a.heading == 45.0                            # the shot tells us where the gun points


def test_claimed_hit_must_match_where_the_gun_points():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    z = r.world.spawn(WALKER, 0, 10)                    # due north
    ev = r.fire(a.id, 1, [z.id], 90.0, T0 + 1)          # ...but the gun points east
    assert ev[0]["reason"] == "off_target" and z.hp == WALKER.hp
    # A few degrees off is honest disagreement (the phone is a snapshot ahead).
    assert r.fire(a.id, 2, [z.id], 12.0, T0 + 2)[0]["reason"] == "hit"


def test_out_of_range():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    z = r.world.spawn(WALKER, 0, 60)                    # regular reaches 35 m
    assert r.fire(a.id, 1, [z.id], 0.0, T0 + 1)[0]["reason"] == "range"
    assert z.hp == WALKER.hp


def test_one_bullet_hits_one_zombie():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    near, far = r.world.spawn(WALKER, 0, 8), r.world.spawn(WALKER, 0, 12)
    ev = r.fire(a.id, 1, [near.id, far.id], 0.0, T0 + 1)
    assert ev[0]["hits"] == [[near.id, WALKER.hp - 2]] and far.hp == WALKER.hp


def test_fire_rate_magazine_and_reload():
    r, a, _ = make_room()
    r.start(a.id, T0)
    w = CLASSES["regular"]
    assert r.fire(a.id, 1, [], 0, T0 + 1)[0]["reason"] == "miss"
    assert r.fire(a.id, 2, [], 0, T0 + 1.1)[0]["reason"] == "cooldown"
    assert r.fire(a.id, 2, [], 0, T0 + 5)  == []        # duplicate sequence number
    t, seq, ev = T0 + 1, 3, []
    for _ in range(w.magazine - 1):
        t += w.fire_interval_s
        ev = r.fire(a.id, seq, [], 0, t)
        seq += 1
    assert a.ammo == 0 and ev[-1] == {"t": "reload", "player_id": a.id, "until": t + w.reload_s}
    assert r.fire(a.id, seq, [], 0, t + 0.5)[0]["reason"] == "reloading"
    assert {"t": "reloaded", "player_id": a.id, "ammo": w.magazine} in r.tick(t + w.reload_s + 0.01)
    assert a.ammo == w.magazine


def test_manual_reload_only_when_it_makes_sense():
    r, a, _ = make_room()
    r.start(a.id, T0)
    assert r.reload(a.id, T0 + 1) == []                 # magazine already full
    r.fire(a.id, 1, [], 0, T0 + 1)
    ev = r.reload(a.id, T0 + 2)
    assert kinds(ev) == ["reload"]
    assert r.reload(a.id, T0 + 2.1) == []               # already reloading


def test_no_shooting_outside_a_mission():
    r, a, _ = make_room()
    with pytest.raises(GameError):
        r.fire(a.id, 1, [], 0, T0)


# ------------------------------------------------------------------ zombies vs players

def test_bite_reports_which_way_it_came_from():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0, heading=0)                        # facing north
    r.world.spawn(WALKER, 1.0, 0)                       # zombie on her right
    _, ev = run(r, 1.0, T0)
    hurt = [e for e in ev if e["t"] == "hurt"]
    assert len(hurt) == 1
    assert hurt[0]["player_id"] == a.id and hurt[0]["hp"] == 7 and hurt[0]["dmg"] == 1
    assert hurt[0]["dir"] == pytest.approx(90, abs=1)


def test_zero_health_is_knocked_and_knocked_players_cannot_shoot():
    r, a, b = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 50, 50)
    z = r.world.spawn(WALKER, 0, 1.0)
    t, ev = run(r, 12, T0)
    assert a.hp == 0 and a.state == "knocked"
    assert {"t": "knocked", "player_id": a.id, "name": "Ada"} in ev
    assert r.fire(a.id, 1, [z.id], 0, t) == []
    assert r.reload(a.id, t) == []
    assert r.phase == "playing"                         # Bo is still up


def test_everyone_down_is_a_wipe():
    r, a = make_room(names=("Ada",))
    r.start(a.id, T0)
    place(r, a, 0, 0)
    r.world.spawn(WALKER, 0, 1.0)
    t, ev = run(r, 12, T0)
    ended = ev[-1]
    assert r.phase == "ended" and ended["t"] == "ended" and ended["outcome"] == "wiped"
    assert ended["results"][0]["name"] == "Ada" and ended["results"][0]["state"] == "knocked"
    assert r.tick(t + 1) == [] and not r.world.zombies
    assert r.ended is ended


def test_waves_reach_the_squad_on_their_own():
    r, a = make_room(names=("Ada",), grace_s=1, spawn_gap_s=0.2)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    t, ev = run(r, 5, T0)
    assert [e for e in ev if e["t"] == "wave"][0]["count"] == 4
    assert len(r.world.zombies) == 4
    snap = r.snapshot(t)
    assert snap["t"] == "snap" and snap["ph"] == "journey" and snap["wave"] == [1, 4, 4]
    assert all(row[6] == a.id for row in snap["z"])     # all four are after Ada
    me = snap["p"][0]
    assert me["id"] == a.id and me["hp"] == 8 and me["st"] == "alive" and me["ammo"] == 10
    t, ev = run(r, 40, t)                               # she just stands there
    assert a.state == "knocked" and r.phase == "ended"


def test_a_stalled_server_does_not_teleport_the_horde():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    z = r.world.spawn(WALKER, 0, 30)
    r.tick(T0 + 0.05)
    r.tick(T0 + 20)                                     # the process froze for 20 s
    assert z.y > 29                                     # moved one capped step, not 24 m


def test_a_dropped_phone_stops_being_zombie_food_after_a_while():
    r, a, b = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 0, 30)
    z = r.world.spawn(WALKER, 0, 4)
    a.connected, a.disconnected_at = False, T0
    run(r, 1, T0)
    assert z.target == a.id                             # a brief drop changes nothing
    run(r, 1, T0 + ABSENT_AFTER_S + 1)
    assert z.target == b.id                             # gone for good: chase someone present


def test_host_can_abort_and_play_again():
    r, a, b = make_room()
    r.start(a.id, T0)
    r.world.spawn(WALKER, 0, 5)
    with pytest.raises(GameError):
        r.reset(b.id)
    r.reset(a.id)
    assert r.phase == "lobby" and not r.world.zombies and r.mission is None
    assert r.snapshot(T0)["z"] == []
    r.start(a.id, T0 + 10)
    assert r.phase == "playing" and a.hp == 8
