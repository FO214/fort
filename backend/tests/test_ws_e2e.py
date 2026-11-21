"""Real WebSocket clients against a live uvicorn server."""
import asyncio
import json
import math
import socket
import time

import pytest
import uvicorn
import websockets

from app import main
from app.mission import Tuning
from app.models import CLASSES

FAST = Tuning(grace_s=0.3, rest_s=0.6, spawn_gap_s=0.1, zombie_speed=3.0)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    """A phone. Tracks the newest snapshot so tests can aim at what it sees."""

    def __init__(self, ws):
        self.ws = ws
        self.inbox: list[dict] = []
        self.id = None
        self.token = None
        self.code = None
        self.snap: dict = {}
        self.x = self.y = 0.0
        self.seq = 0

    async def send(self, **msg):
        await self.ws.send(json.dumps(msg))

    async def recv(self, timeout=3.0) -> dict:
        raw = await asyncio.wait_for(self.ws.recv(), timeout)
        m = json.loads(raw)
        self.inbox.append(m)
        if m["t"] == "snap":
            self.snap = m
        return m

    async def until(self, kind, timeout=5.0, pred=None, **match) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                m = await self.recv(timeout=max(0.05, deadline - time.time()))
            except asyncio.TimeoutError:
                break
            if m["t"] == kind and all(m.get(k) == v for k, v in match.items()) \
                    and (pred is None or pred(m)):
                return m
        raise AssertionError(f"never saw {kind} {match}")

    async def fresh_snap(self) -> dict:
        """Throw away whatever queued up while this phone was not reading, then
        wait for the next snapshot, so aim is taken at current positions."""
        while True:
            try:
                await self.recv(timeout=0.001)
            except asyncio.TimeoutError:
                break
        return await self.until("snap")

    def me(self, snap=None) -> dict:
        return next(p for p in (snap or self.snap)["p"] if p["id"] == self.id)

    async def pos(self, x, y, heading=0.0, acc=3.0):
        self.x, self.y = x, y
        await self.send(t="pos", x=x, y=y, acc=acc, heading=heading, pitch=0)

    async def shoot_nearest(self) -> dict:
        """Face the nearest zombie in the newest snapshot and pull the trigger."""
        z = min(self.snap["z"], key=lambda r: math.hypot(r[2] - self.x, r[3] - self.y))
        heading = math.degrees(math.atan2(z[2] - self.x, z[3] - self.y)) % 360
        self.seq += 1
        await self.send(t="fire", seq=self.seq, hits=[z[0]], heading=heading)
        return await self.until("fired", player_id=self.id, seq=self.seq)


@pytest.fixture
async def server(monkeypatch):
    monkeypatch.setattr(main.hub.rooms, "tuning", FAST)
    port = free_port()
    config = uvicorn.Config(main.app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.02)
    yield f"ws://127.0.0.1:{port}/ws"
    srv.should_exit = True
    await task
    main.hub.rooms.rooms.clear()
    main.hub.sockets.clear()


async def connect(url) -> Client:
    ws = await websockets.connect(url, max_queue=None)   # never apply backpressure in tests
    return Client(ws)


async def squad(url, names):
    """Host creates, the rest join. Returns the clients in order."""
    host = await connect(url)
    await host.send(t="create", name=names[0])
    w = await host.until("welcome")
    host.id, host.token, host.code = w["player_id"], w["token"], w["code"]
    clients = [host]
    for name in names[1:]:
        c = await connect(url)
        await c.send(t="join", code=host.code, name=name)
        w = await c.until("welcome")
        c.id, c.token, c.code = w["player_id"], w["token"], w["code"]
        clients.append(c)
    lobby = await host.until("lobby", pred=lambda m: len(m["players"]) == len(names))
    assert [p["name"] for p in lobby["players"]] == list(names)
    return clients, w


@pytest.mark.asyncio
async def test_four_phones_fight_a_wave(server):
    (ada, bo, cy, di), welcome = await squad(server, ["Ada", "Bo", "Cy", "Di"])
    assert set(welcome["classes"]) == set(CLASSES) and welcome["map"]["id"] == "arena"

    # Loadout and ready show up for everyone.
    await bo.send(t="set_class", cls="light")
    await di.send(t="set_class", cls="heavy")
    for c in (ada, bo, cy, di):
        await c.send(t="ready", ready=True)
    lobby = await cy.until("lobby", pred=lambda m: all(p["ready"] for p in m["players"]))
    assert {p["name"]: p["cls"] for p in lobby["players"]} == \
        {"Ada": "regular", "Bo": "light", "Cy": "regular", "Di": "heavy"}

    # Only the host starts. Her GPS fix anchors the arena for the whole squad.
    await bo.send(t="start")
    assert "host" in (await bo.until("error"))["msg"]
    await ada.send(t="start", lat=43.4723, lon=-80.5449)
    for c in (ada, bo, cy, di):
        st = await c.until("started")
        assert st["map"]["origin"] == [43.4723, -80.5449]
        assert st["map"]["helicopter"] == {"x": 0, "y": 30, "radius_m": 6, "qr": "LOONIE:HELI"}

    # Each phone reports its own position; everyone sees everyone.
    spots = {ada: (0, 0), bo: (4, 0), cy: (0, 4), di: (-4, 0)}
    for c, (x, y) in spots.items():
        await c.pos(x, y)
    snap = await di.until("snap", pred=lambda m: {(p["x"], p["y"]) for p in m["p"]}
                          == set(spots.values()))
    assert {(p["x"], p["y"]) for p in snap["p"]} == set(spots.values())
    assert bo.id in {p["id"] for p in snap["p"]} and di.me(snap)["max"] == CLASSES["heavy"].hp

    # The first wave arrives: 8 zombies for four players, identical on every phone.
    wave = await ada.until("wave", cleared=False)
    assert wave == {"t": "wave", "n": 1, "count": 8, "cleared": False}
    a = await ada.until("snap", pred=lambda m: len(m["z"]) == 8)
    b = await bo.until("snap", pred=lambda m: m["now"] == a["now"])
    assert a["z"] == b["z"] and a["ph"] == "journey"
    assert all(len(row) == 7 for row in a["z"])

    # The squad shoots the wave down. Every phone hears every kill.
    kills, turn = 0, 0
    shooters = [ada, bo, cy, di]
    deadline = time.time() + 20
    while kills < 8 and time.time() < deadline:
        s = shooters[turn % 4]
        turn += 1
        if not (await s.fresh_snap())["z"]:
            continue
        fired = await s.shoot_nearest()
        if fired["reason"] == "hit" and fired["hits"][0][1] == 0:
            kills += 1
    assert kills == 8
    cleared = await cy.until("wave", cleared=True, timeout=10)
    assert cleared["n"] == 1
    assert sum(1 for m in cy.inbox if m["t"] == "zkill") == 8
    snap = await cy.until("snap")
    assert sum(p["k"] for p in snap["p"]) == 8

    # Resume: Cy's phone drops and reconnects with its token, into the running mission.
    await cy.ws.close()
    cy2 = await connect(server)
    await cy2.send(t="resume", code=ada.code, player_id=cy.id, token=cy.token)
    assert (await cy2.until("welcome"))["player_id"] == cy.id
    assert (await cy2.until("started"))["mission"]["phase"] == "journey"
    cy2.id = cy.id
    snap = await cy2.until("snap")
    assert cy2.me(snap)["on"] is True and (cy2.me(snap)["x"], cy2.me(snap)["y"]) == (0, 4)

    # A wrong token gets nowhere.
    bad = await connect(server)
    await bad.send(t="resume", code=ada.code, player_id=cy.id, token="nope")
    assert "resume" in (await bad.until("error"))["msg"]

    # Host aborts back to the lobby.
    await ada.send(t="reset")
    lobby = await di.until("lobby", phase="lobby")
    assert not any(p["ready"] for p in lobby["players"])

    for c in (ada, bo, cy2, di, bad):
        await c.ws.close()


@pytest.mark.asyncio
async def test_solo_player_gets_bitten_knocked_and_wiped(server):
    (ada,), _ = await squad(server, ["Ada"])
    await ada.send(t="start")
    await ada.until("started")
    await ada.pos(0, 0, heading=0)
    hurt = await ada.until("hurt", timeout=15)
    assert hurt["player_id"] == ada.id and hurt["hp"] == 7 and -180 <= hurt["dir"] <= 180
    await ada.until("knocked", player_id=ada.id, timeout=15)
    ended = await ada.until("ended", timeout=5)
    assert ended["outcome"] == "wiped" and ended["results"][0]["name"] == "Ada"

    # The room remembers the result for a phone that reconnects late.
    await ada.ws.close()
    again = await connect(server)
    await again.send(t="resume", code=ada.code, player_id=ada.id, token=ada.token)
    await again.until("welcome")
    assert (await again.until("ended"))["outcome"] == "wiped"
    await again.ws.close()


@pytest.mark.asyncio
async def test_bad_code_and_bad_message(server):
    c = await connect(server)
    await c.send(t="join", code="ZZZZ", name="Nope")
    err = await c.until("error")
    assert "code" in err["msg"]
    c2 = await connect(server)
    await c2.send(t="create", name="Solo")
    await c2.until("welcome")
    await c2.send(t="pos", x="north")
    err = await c2.until("error")
    assert err["msg"] == "Bad message"
    await c2.send(t="set_team", team="alpha")            # the PvP protocol is gone
    assert (await c2.until("error"))["msg"] == "Bad message"
    await c2.ws.close()
