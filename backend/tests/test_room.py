"""Room rules with a fake clock: no sockets, no sleeping."""
import math
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


# ------------------------------------------------------------------ knocked, bleed-out, revive

def knock(r, p, t):
    """Stand a zombie on `p` until they go down. Returns (time, zombie)."""
    z = r.world.spawn(WALKER, p.x, p.y + 1.0)
    for _ in range(2000):
        if p.state != "alive":
            return t, z
        t += 0.05
        r.tick(t)
    raise AssertionError(f"{p.name} never went down")


def test_zombies_finish_a_knocked_player_unless_someone_stops_them():
    r, a, b = make_room(bleed_bites=8)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 60, 60)                                # too far away to matter
    t, z = knock(r, a, T0)
    assert a.state == "knocked" and a.bleed == 1.0 and a.knocks == 1
    assert z.target == a.id                             # it stays on her
    t, ev = run(r, 4.5, t)                              # four more bites, one a second
    drains = [e for e in ev if e["t"] == "hurt"]
    assert [e["bleed"] for e in drains] == [0.875, 0.75, 0.625, 0.5]
    assert all(e["hp"] == 0 and e["dmg"] == 0 for e in drains)
    t, ev = run(r, 4.02, t)
    assert a.state == "dead" and a.bleed == 0
    assert {"t": "dead", "player_id": a.id, "name": "Ada"} in ev
    assert r.phase == "playing"                         # Bo is still standing
    t, _ = run(r, 0.5, t)
    assert z.target == b.id                             # the dead are left alone


def test_knocked_player_is_safe_while_no_zombie_reaches_them():
    r, a, b = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 3, 0)
    t, z = knock(r, a, T0)
    r.world.damage(z.id, 99)                            # Bo shoots it off her
    t, ev = run(r, 60, t)
    assert a.state == "knocked" and a.bleed == 1.0      # waits as long as it takes


def test_revive_takes_a_three_second_hold_and_brings_them_back_at_half_health():
    r, a, b = make_room(revive_s=3)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 2, 0)
    t, z = knock(r, a, T0)
    r.world.damage(z.id, 99)
    assert r.revive(b.id, a.id, True, t) == []
    t, ev = run(r, 1.5, t)
    assert a.revive_by == b.id and a.revive_progress == pytest.approx(0.5, abs=0.02)
    wire = next(p for p in r.snapshot(t)["p"] if p["id"] == a.id)
    assert wire["st"] == "knocked" and wire["rb"] == b.id and 0.45 < wire["rv"] < 0.55
    t, ev = run(r, 1.6, t)
    assert ev == [{"t": "revived", "player_id": a.id, "name": "Ada", "by": b.id,
                   "by_name": "Bo", "hp": 4}]
    assert a.state == "alive" and a.hp == 4 and a.revive_by is None and b.reviving is None
    assert b.revives == 1


def test_each_revive_brings_back_less_health():
    r, a, b = make_room(revive_s=1)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 2, 0)
    t, healths = T0, []
    for _ in range(4):
        t, z = knock(r, a, t)
        r.world.damage(z.id, 99)
        r.revive(b.id, a.id, True, t)
        t, _ = run(r, 1.2, t)
        healths.append(a.hp)
    assert healths == [4, 3, 2, 2]                      # 50 %, 30 %, 20 %, 20 % of 8, rounded up


def test_letting_go_starts_the_revive_over():
    r, a, b = make_room(revive_s=3)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 2, 0)
    t, z = knock(r, a, T0)
    r.world.damage(z.id, 99)
    r.revive(b.id, a.id, True, t)
    t, _ = run(r, 2, t)
    r.revive(b.id, a.id, False, t)
    assert a.revive_by is None and a.revive_progress == 0
    r.revive(b.id, a.id, True, t)
    t, _ = run(r, 2, t)
    assert a.state == "knocked"                         # two seconds is not three


def test_no_revive_with_a_zombie_on_top_of_them():
    r, a, b = make_room(revive_s=1, bleed_bites=1000)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 9, 0)                                   # in reach with GPS slack, but the zombie prefers Ada
    t, z = knock(r, a, T0)
    r.revive(b.id, a.id, True, t)
    t, _ = run(r, 3, t)
    assert a.state == "knocked" and a.revive_progress == 0 and a.revive_by == b.id
    r.world.damage(z.id, 99)                            # clear the area...
    t, ev = run(r, 1.1, t)
    assert a.state == "alive" and kinds(ev) == ["revived"]   # ...and the same hold now works


def test_getting_bitten_breaks_the_revive_you_were_doing():
    r, a, b = make_room(revive_s=3)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 9, 0)
    t, z = knock(r, a, T0)
    r.world.damage(z.id, 99)
    r.revive(b.id, a.id, True, t)
    t, _ = run(r, 1, t)
    assert a.revive_progress > 0.3
    r.world.spawn(WALKER, 9, 1.0)                      # one gets to Bo
    t, ev = run(r, 0.8, t)
    assert "hurt" in kinds(ev) and b.reviving is None
    assert a.revive_by is None and a.revive_progress == 0 and a.state == "knocked"


def test_revive_range_allows_for_gps_error_but_not_the_whole_building():
    r, a, b = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0, acc=3)
    place(r, b, 12, 0, acc=3)                           # 4 m + 3 + 3 = 10 m: too far
    t, z = knock(r, a, T0)
    r.world.damage(z.id, 99)
    with pytest.raises(GameError, match="far"):
        r.revive(b.id, a.id, True, t)
    place(r, b, 9, 0, acc=3)
    r.revive(b.id, a.id, True, t)
    assert a.revive_by == b.id
    r.revive(b.id, a.id, False, t)
    # Poor GPS on both phones: standing together can read as 25 m apart.
    place(r, a, 0, 0, acc=20)
    place(r, b, 25, 0, acc=20)                          # 4 + min(40, 25) = 29 m
    r.revive(b.id, a.id, True, t)
    assert a.revive_by == b.id
    place(r, b, 40, 0, acc=20)                          # walked off: the hold drops on the next tick
    r.tick(t + 0.05)
    assert a.revive_by is None


def test_only_the_standing_can_revive_and_only_the_knocked_need_it():
    r, a, b, c = make_room(names=("Ada", "Bo", "Cy"))
    r.start(a.id, T0)
    for p in (a, b, c):
        place(r, p, 0, 0)
    assert r.revive(b.id, a.id, True, T0) == [] and b.reviving is None     # Ada is fine
    assert r.revive(b.id, b.id, True, T0) == [] and b.reviving is None     # not yourself
    place(r, b, 30, 30); place(r, c, 30, 30)
    t, z = knock(r, a, T0)
    r.world.damage(z.id, 99)
    place(r, b, 1, 0); place(r, c, 0, 1)
    r.revive(b.id, a.id, True, t)
    r.revive(c.id, a.id, True, t)                       # Bo already has her
    assert a.revive_by == b.id and c.reviving is None
    assert r.revive(a.id, b.id, True, t) == [] and a.reviving is None      # knocked players cannot


# ------------------------------------------------------------------ the helicopter

def test_reaching_the_helicopter_starts_the_holdout():
    r, a, b = make_room()
    started = r.start(a.id, T0)
    hx, hy = started["map"]["helicopter"]["x"], started["map"]["helicopter"]["y"]
    place(r, a, 0, 0)
    place(r, b, 0, 0)
    assert r.tick(T0 + 0.05) == [] and r.mission.phase == "journey"
    place(r, b, hx + 7.4, hy, acc=3)                    # radius 6 m + 1.5 m of GPS slack
    assert r.tick(T0 + 0.1) == [{"t": "phase", "phase": "holdout", "hold": [0, 2]}]
    assert r.snapshot(T0 + 0.1)["ph"] == "holdout" and r.snapshot(T0 + 0.1)["hold"] == [0, 2]


def test_arrival_radius_grows_with_gps_error_only_so_far():
    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 30 - 15, acc=18)                     # 6 m + 9 m of slack
    r.tick(T0 + 0.05)
    assert r.mission.phase == "holdout"

    r, a, _ = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 30 - 17, acc=60)                     # slack is capped at 10 m: 16 m in all
    r.tick(T0 + 0.05)
    assert r.mission.phase == "journey"


def test_a_phone_that_never_reported_does_not_count_as_arrived():
    r = Room("TEST", Settings(map="arena"), now=T0, tuning=Tuning(**QUIET))
    a = r.add_player("Ada")
    r.start(a.id, T0)
    a.x, a.y = 0, 30                                    # on the helicopter, but nobody told us so
    r.tick(T0 + 0.05)
    assert r.mission.phase == "journey"


def test_host_can_say_we_are_here():
    r, a, b = make_room()
    r.start(a.id, T0)
    place(r, a, 0, 0); place(r, b, 0, 0)
    with pytest.raises(GameError):
        r.arrived(b.id, T0 + 1)
    assert r.arrived(a.id, T0 + 1) == [{"t": "phase", "phase": "holdout", "hold": [0, 2]}]
    assert r.arrived(a.id, T0 + 2) == []


def to_final(r, a, t, players):
    """Fast-forward a quiet room to the final wave."""
    for p in players:
        place(r, p, 0, 30)
    r.arrived(a.id, t)
    for _ in range(2000):
        if r.mission.phase == "final":
            break
        t += 0.05
        r.tick(t)
        r.world.clear()                                 # every holdout wave falls at once
        r.mission.to_spawn = 0
    else:
        raise AssertionError("never reached the final wave")
    r.world.clear()
    return t


HELI = dict(hold_grace_s=0, rest_s=0, spawn_gap_s=10_000, extract_s=4)


def test_extraction_needs_two_players_holding_together():
    r, a, b, c, d = make_room(names=("Ada", "Bo", "Cy", "Di"), **HELI)
    r.start(a.id, T0)
    r.set_extract(a.id, True)
    assert not a.extracting                             # not before the final wave
    t = to_final(r, a, T0, (a, b, c, d))

    r.set_extract(a.id, True)
    t, ev = run(r, 2, t)
    assert [e for e in ev if e["t"] == "extract"] == [
        {"t": "extract", "progress": 0.0, "holders": [a.id], "need": 2}]
    assert r.mission.extract_progress == 0              # one phone on the QR is not enough

    r.set_extract(b.id, True)
    t, ev = run(r, 2, t)
    assert r.mission.extract_progress == pytest.approx(0.5, abs=0.02)
    assert r.snapshot(t)["ex"][1:] == [2, [a.id, b.id]]
    assert r.fire(a.id, 1, [], 0, t)[0]["reason"] == "extracting" and a.ammo == 10   # hands are busy
    assert r.fire(c.id, 1, [], 0, t)[0]["reason"] == "miss"                          # the others defend

    r.set_extract(b.id, False)                          # Bo lets go: paused, not lost
    t, _ = run(r, 2, t)
    assert r.mission.extract_progress == pytest.approx(0.5, abs=0.02)

    r.set_extract(d.id, True)                           # any two will do
    t, ev = run(r, 2.2, t)
    ended = ev[-1]
    assert r.phase == "ended" and ended["outcome"] == "extracted"
    assert {x["name"]: x["state"] for x in ended["results"]} == dict.fromkeys(["Ada", "Bo", "Cy", "Di"], "alive")
    assert not a.extracting


def test_a_solo_player_extracts_alone():
    r, a = make_room(names=("Ada",), **HELI)
    r.start(a.id, T0)
    t = to_final(r, a, T0, (a,))
    r.set_extract(a.id, True)
    t, ev = run(r, 4.2, t)
    assert ev[-1]["outcome"] == "extracted"


def test_a_knocked_holder_drops_off_the_bar():
    r, a, b = make_room(**{**HELI, "extract_s": 60}, bleed_bites=1000)
    r.start(a.id, T0)
    t = to_final(r, a, T0, (a, b))
    place(r, b, 5, 30)                                  # a few steps from Ada
    r.set_extract(a.id, True)
    r.set_extract(b.id, True)
    t, _ = run(r, 1, t)
    assert r.mission.extract_progress > 0.01
    t, z = knock(r, b, t)                               # also proves holders are not immune
    held = r.mission.extract_progress
    assert not b.extracting
    t, _ = run(r, 1, t)
    assert r.mission.extract_progress == held           # Ada alone cannot finish it while Bo lives
    r.set_extract(b.id, True)
    assert not b.extracting                             # and the knocked cannot hold


def test_the_last_one_alive_may_extract_alone():
    r, a, b = make_room(**HELI, bleed_bites=2)
    r.start(a.id, T0)
    t = to_final(r, a, T0, (a, b))
    place(r, b, 40, 80)                                 # Bo wanders off and dies out there
    t, z = knock(r, b, t)
    t, _ = run(r, 3, t)
    assert b.state == "dead"
    r.world.clear()
    r.set_extract(a.id, True)
    t, ev = run(r, 4.2, t)
    ended = ev[-1]
    assert ended["outcome"] == "extracted"
    assert {x["name"]: x["state"] for x in ended["results"]} == {"Ada": "alive", "Bo": "dead"}


def test_whole_mission_start_to_helicopter():
    r, a, b = make_room(grace_s=1, rest_s=1, hold_grace_s=1, spawn_gap_s=0.1, extract_s=2,
                        revive_s=1, wave_max_s=10_000)
    r.start(a.id, T0)
    place(r, a, 0, 0)
    place(r, b, 1, 0)
    seen, t, seq = [], T0, 0

    def play(seconds, shoot=True):
        nonlocal t, seq
        for _ in range(round(seconds / 0.05)):
            t += 0.05
            for e in r.tick(t):
                seen.append(e)
            if shoot and r.phase == "playing":
                for p in (a, b):
                    zs = sorted(r.world.zombies.values(), key=lambda z: (z.x - p.x) ** 2 + (z.y - p.y) ** 2)
                    if zs and p.state == "alive":
                        seq += 1
                        h = math.degrees(math.atan2(zs[0].x - p.x, zs[0].y - p.y)) % 360
                        seen.extend(r.fire(p.id, seq, [zs[0].id], h, t))

    play(12)                                            # journey: at least one wave fought off
    assert any(e["t"] == "wave" and e["cleared"] and e["phase"] == "journey" for e in seen)
    place(r, a, 0, 29)
    place(r, b, 1, 29)
    play(30)                                            # holdout, then into the final wave
    phases = [e["phase"] for e in seen if e["t"] == "phase"]
    assert phases == ["holdout", "final"]
    assert [e["hold"] for e in seen if e["t"] == "wave" and e["cleared"] and e["phase"] == "holdout"] \
        == [[1, 2], [2, 2]]
    assert r.phase == "playing" and a.state == b.state == "alive"
    r.set_extract(a.id, True)
    r.set_extract(b.id, True)
    play(2.5, shoot=False)
    assert r.phase == "ended" and seen[-1]["outcome"] == "extracted"
    assert seen[-1]["kills"] == a.kills + b.kills > 10
