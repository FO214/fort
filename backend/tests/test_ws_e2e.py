"""Four real WebSocket clients against a live uvicorn server: create, join,
loadout, start, move, aim, fire, die, respawn, end."""
import asyncio
import json
import socket
import time

import pytest
import uvicorn
import websockets

from app.geo import offset_m
from app.main import app

LAT, LON = 43.4723, -80.5449


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.inbox: list[dict] = []
        self.id = None
        self.token = None
        self.code = None

    async def send(self, **msg):
        await self.ws.send(json.dumps(msg))

    async def recv(self, timeout=3.0) -> dict:
        raw = await asyncio.wait_for(self.ws.recv(), timeout)
        m = json.loads(raw)
        self.inbox.append(m)
        return m

    async def until(self, kind, timeout=5.0, pred=None, **match) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            m = await self.recv(timeout=max(0.05, deadline - time.time()))
            if m["t"] == kind and all(m.get(k) == v for k, v in match.items()) \
                    and (pred is None or pred(m)):
                return m
        raise AssertionError(f"never saw {kind} {match}")

    async def snapshot_where(self, pid, pred, timeout=5.0) -> dict:
        def ok(m):
            p = next((q for q in m["players"] if q["id"] == pid), None)
            return p is not None and pred(p)
        return await self.until("snapshot", timeout=timeout, pred=ok)

    async def pos(self, north, east, heading, acc=3.0):
        lat, lon = offset_m(LAT, LON, north, east)
        await self.send(t="pos", lat=lat, lon=lon, acc=acc, heading=heading,
                        heading_acc=5, ts=time.time())


@pytest.fixture
async def server():
    port = free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    srv = uvicorn.Server(config)
    task = asyncio.create_task(srv.serve())
    while not srv.started:
        await asyncio.sleep(0.02)
    yield f"ws://127.0.0.1:{port}/ws"
    srv.should_exit = True
    await task


async def connect(url) -> Client:
    ws = await websockets.connect(url, max_queue=None)   # never apply backpressure in tests
    return Client(ws)


@pytest.mark.asyncio
async def test_four_players_full_match(server):
    host = await connect(server)
    await host.send(t="create", name="Ada", settings={"mode": "ffa", "duration_s": 120,
                                                       "respawn_s": 2, "spawn_protect_s": 0.5})
    w = await host.until("welcome")
    host.id, host.token, host.code = w["player_id"], w["token"], w["code"]
    assert len(host.code) == 4 and "light" in w["weapons"]

    others = []
    for name in ["Bo", "Cy", "Di"]:
        c = await connect(server)
        await c.send(t="join", code=host.code, name=name)
        w = await c.until("welcome")
        c.id, c.token, c.code = w["player_id"], w["token"], w["code"]
        others.append(c)
    bo, cy, di = others

    lobby = await host.until("lobby")
    while len(lobby["players"]) < 4:
        lobby = await host.until("lobby")
    assert {p["name"] for p in lobby["players"]} == {"Ada", "Bo", "Cy", "Di"}
    assert lobby["host_id"] == host.id

    # Loadout + ready.
    await bo.send(t="set_weapon", weapon="light")
    await di.send(t="set_weapon", weapon="heavy")
    for c in [host, *others]:
        await c.send(t="ready", ready=True)
    lobby = await host.until("lobby")
    while not all(p["ready"] for p in lobby["players"]):
        lobby = await host.until("lobby")

    # Non-host can't start.
    await bo.send(t="start")
    err = await bo.until("error")
    assert "host" in err["msg"]

    await host.send(t="start")
    for c in [host, *others]:
        st = await c.until("started")
        assert st["ends_at"] > st["now"]

    # Everyone reports a position. Ada at origin facing north; Bo 15 m north;
    # Cy 15 m east; Di 40 m south.
    for _ in range(3):
        await host.pos(0, 0, heading=0)
        await bo.pos(15, 0, heading=180)
        await cy.pos(0, 15, heading=270)
        await di.pos(-40, 0, heading=0)
        await asyncio.sleep(0.12)

    snap = await host.snapshot_where(host.id, lambda p: p["lat"] is not None)
    me = next(p for p in snap["players"] if p["id"] == host.id)
    assert me["hp"] == 8
    await asyncio.sleep(0.6)          # let spawn protection lapse

    # Ada shoots Bo: hit. Everyone sees it; Bo's HP drops.
    await host.send(t="fire", seq=1, target_id=bo.id, ts=time.time())
    fired = await host.until("fired", player_id=host.id)
    assert fired["reason"] == "hit", fired
    hit = await bo.until("hit", target_id=bo.id)
    assert hit["hp"] == 4 and hit["shooter_id"] == host.id   # Bo runs Light: 6 HP - 2
    assert abs(hit["dir"]) < 2       # Bo faces south, Ada is south of Bo -> dead ahead

    # Ada shoots Cy while still facing north: off target.
    await asyncio.sleep(0.5)
    await host.send(t="fire", seq=2, target_id=cy.id, ts=time.time())
    fired = await host.until("fired", player_id=host.id, seq=2)
    assert fired["reason"] == "off_target"

    # Bo (light, full auto, 1 dmg) empties into Ada until she dies.
    seq = 0
    killed = None
    for _ in range(12):
        seq += 1
        await bo.send(t="fire", seq=seq, target_id=host.id, ts=time.time())
        await asyncio.sleep(0.13)
    killed = await host.until("killed", target_id=host.id, timeout=6)
    assert killed["shooter"] == "Bo"
    snap = await cy.snapshot_where(host.id, lambda p: not p["alive"])
    ada = next(p for p in snap["players"] if p["id"] == host.id)
    assert ada["deaths"] == 1

    # Respawn after 2 s.
    resp = await host.until("respawned", player_id=host.id, timeout=5)
    assert resp["hp"] == 8

    # Resume: Cy drops and reconnects with the token, keeps identity + score.
    await cy.ws.close()
    cy2 = await connect(server)
    await cy2.send(t="resume", code=host.code, player_id=cy.id, token=cy.token)
    w = await cy2.until("welcome")
    assert w["player_id"] == cy.id
    await cy2.snapshot_where(cy.id, lambda p: p["connected"])

    # Host ends the match; results rank Bo first.
    await host.send(t="end")
    ended = await di.until("ended")
    assert ended["results"][0]["name"] == "Bo" and ended["results"][0]["kills"] == 1

    for c in [host, bo, cy2, di]:
        await c.ws.close()


@pytest.mark.asyncio
async def test_bad_code_and_bad_message(server):
    c = await connect(server)
    await c.send(t="join", code="ZZZZ", name="Nope")
    err = await c.until("error")
    assert "code" in err["msg"]
    c2 = await connect(server)
    await c2.send(t="create", name="Solo")
    await c2.until("welcome")
    await c2.send(t="pos", lat="x")
    err = await c2.until("error")
    assert err["msg"] == "Bad message"
    await c2.ws.close()
