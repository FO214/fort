"""FastAPI + WebSocket server. One socket per phone; the first message must
be `create`, `join`, or `resume`. Rooms simulate at 20 Hz and every second
tick sends a snapshot to the phones in that room."""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import logging
import time
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import TypeAdapter, ValidationError

from . import discovery
from . import models as m
from .devices import Devices
from .mapdata import available_maps, load_map, map_choices
from .mission import Tuning
from .room import GameError, Player, Room, RoomManager

log = logging.getLogger("loonie")

# Every gun connection and button press, one line each, in the server's own
# output: which gun, which button, down or up, how many presses so far, and
# what the server did with it. Its own handler, because uvicorn only prints
# its own loggers.
gunlog = logging.getLogger("loonie.guns")
if not gunlog.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s.%(msecs)03d  %(message)s", datefmt="%H:%M:%S"))
    gunlog.addHandler(_h)
    gunlog.setLevel(logging.INFO)
    gunlog.propagate = False
gun_presses: dict[str, dict[str, int]] = {}      # gun id -> button -> presses since the server started

TICK_S = 0.05                 # simulation step: 20 Hz
SNAPSHOT_EVERY = 2            # snapshots at 10 Hz
DISCONNECT_GRACE_S = 90.0     # keep a dropped player's slot this long for resume

FirstMessage = TypeAdapter(m.Create | m.Join | m.Resume)
InGameMessage = TypeAdapter(
    m.Ready | m.SetClass | m.SetMap | m.SetArea | m.SetMode | m.Start | m.Pos | m.Fire | m.Reload | m.Revive | m.Extract
    | m.Arrived | m.PairGun | m.Leave | m.Reset | m.Ping
)
DeviceMessage = TypeAdapter(m.DeviceBtn | m.DeviceHello)


def classes_payload() -> dict[str, Any]:
    return {k: c.model_dump() for k, c in m.CLASSES.items()}


class Hub:
    """Sockets per room, plus the tick loop that drives every room."""

    def __init__(self) -> None:
        self.rooms = RoomManager(Tuning.from_env())
        self.sockets: dict[str, dict[str, WebSocket]] = {}   # code -> pid -> ws
        self.devices = Devices()
        self.guns: dict[str, WebSocket] = {}                 # gun id -> ws
        self._task: Optional[asyncio.Task[None]] = None
        self._disconnect_at: dict[tuple[str, str], float] = {}
        self._tick = 0

    # ---- lifecycle -----------------------------------------------------
    def start(self) -> None:
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _loop(self) -> None:
        while True:
            started = time.monotonic()
            now = time.time()
            self._tick += 1
            for code, room in list(self.rooms.rooms.items()):
                try:
                    for e in room.tick(now):
                        await self.broadcast(code, e)
                    if room.phase == "playing" and self._tick % SNAPSHOT_EVERY == 0:
                        await self.broadcast(code, room.snapshot(now))
                except Exception:              # never let one room kill the loop
                    log.exception("tick failed for room %s", code)
            for (code, pid), at in list(self._disconnect_at.items()):
                if now - at > DISCONNECT_GRACE_S:
                    self._disconnect_at.pop((code, pid), None)
                    room = self.rooms.get(code)
                    if room and pid in room.players and not room.players[pid].connected:
                        room.remove_player(pid)
                        await self.broadcast(code, room.lobby_state())
            self.rooms.sweep(now)
            await asyncio.sleep(max(0.0, TICK_S - (time.monotonic() - started)))

    # ---- messaging -----------------------------------------------------
    async def send(self, ws: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await ws.send_json(payload)
        except Exception:
            pass

    def player_exists(self, owner: tuple[str, str]) -> bool:
        room = self.rooms.get(owner[0])
        return room is not None and owner[1] in room.players

    async def send_player(self, owner: tuple[str, str], payload: dict[str, Any]) -> None:
        ws = self.sockets.get(owner[0], {}).get(owner[1])
        if ws is not None:
            await self.send(ws, payload)

    async def broadcast(self, code: str, payload: dict[str, Any]) -> None:
        for ws in list(self.sockets.get(code, {}).values()):
            await self.send(ws, payload)

    def attach(self, code: str, pid: str, ws: WebSocket) -> None:
        self.sockets.setdefault(code, {})[pid] = ws
        self._disconnect_at.pop((code, pid), None)

    def detach(self, code: str, pid: str, ws: WebSocket) -> None:
        room_sockets = self.sockets.get(code, {})
        if room_sockets.get(pid) is ws:
            room_sockets.pop(pid, None)
            self._disconnect_at[(code, pid)] = time.time()


hub = Hub()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    hub.start()
    finder = await discovery.start()
    try:
        yield
    finally:
        if finder is not None:
            finder.close()
        await hub.stop()


app = FastAPI(title="loonie", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "rooms": len(hub.rooms.rooms), "now": time.time()}


@app.get("/rooms/{code}")
async def room_info(code: str) -> dict[str, Any]:
    room = hub.rooms.get(code)
    if room is None:
        return {"exists": False}
    return {"exists": True, "phase": room.phase, "players": len(room.players),
            "max_players": room.settings.max_players, "map": room.settings.map}


@app.get("/classes")
async def classes() -> dict[str, Any]:
    return classes_payload()


@app.get("/maps")
async def maps() -> dict[str, Any]:
    return {mid: load_map(mid).public() for mid in available_maps()}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    room: Optional[Room] = None
    player: Optional[Player] = None
    try:
        raw = await ws.receive_json()
        try:
            first = FirstMessage.validate_python(raw)
        except ValidationError as e:
            await hub.send(ws, {"t": "error", "msg": "Bad first message",
                                "detail": e.errors(include_url=False, include_input=False)[:3]})
            await ws.close()
            return

        try:
            if isinstance(first, m.Create):
                room = hub.rooms.create(first.settings)
                player = room.add_player(first.name)
            elif isinstance(first, m.Join):
                room = hub.rooms.get(first.code)
                if room is None:
                    raise GameError("No game with that code")
                player = room.add_player(first.name)
            else:
                room = hub.rooms.get(first.code)
                p = room.players.get(first.player_id) if room else None
                if room is None or p is None or not _same_token(p.token, first.token):
                    raise GameError("Can't resume that session")
                player = p
        except GameError as e:
            await hub.send(ws, {"t": "error", "msg": str(e)})
            await ws.close()
            return

        player.connected = True
        hub.attach(room.code, player.id, ws)
        await hub.send(ws, {"t": "welcome", "player_id": player.id, "token": player.token,
                            "code": room.code, "host_id": room.host_id,
                            "classes": classes_payload(), "map": room.map.public(),
                            "maps": map_choices()})
        await hub.broadcast(room.code, room.lobby_state())
        now = time.time()
        if room.phase == "playing":
            # A phone that dropped mid-mission picks the mission back up.
            await hub.send(ws, room.started_event(now))
            await hub.send(ws, room.snapshot(now))
        elif room.phase == "ended" and room.ended:
            await hub.send(ws, room.ended)

        while True:
            raw = await ws.receive_json()
            try:
                msg = InGameMessage.validate_python(raw)
            except ValidationError as e:
                await hub.send(ws, {"t": "error", "msg": "Bad message",
                                    "detail": e.errors(include_url=False, include_input=False)[:3]})
                continue
            now = time.time()
            try:
                await handle(room, player, msg, now, ws)
                if isinstance(msg, m.Leave):
                    break
            except GameError as e:
                await hub.send(ws, {"t": "error", "msg": str(e)})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("socket error")
    finally:
        if room and player:
            hub.detach(room.code, player.id, ws)
            if hub.sockets.get(room.code, {}).get(player.id) is None:
                player.connected = False
                player.disconnected_at = time.time()
                if room.phase == "lobby":
                    room.remove_player(player.id)
                    hub._disconnect_at.pop((room.code, player.id), None)
                await hub.broadcast(room.code, room.lobby_state())


@app.websocket("/device")
async def device_endpoint(ws: WebSocket) -> None:
    """One gun. First message `hello {gun_id}`, then `btn {b, down}`. Presses
    go on to the paired player's phone, which treats them like its own
    on-screen buttons."""
    await ws.accept()
    gun_id: Optional[str] = None
    trigger_down = False
    try:
        try:
            hello = m.DeviceHello.model_validate(await ws.receive_json())
        except ValidationError:
            await hub.send(ws, {"t": "error", "msg": "Say hello first"})
            await ws.close()
            return
        gun_id = hello.gun_id
        old = hub.guns.get(gun_id)
        hub.guns[gun_id] = ws
        if old is not None:
            with contextlib.suppress(Exception):
                await old.close()
        owner = hub.devices.owner(gun_id)
        await hub.send(ws, {"t": "paired" if owner else "unpaired"})
        if owner:
            await hub.send_player(owner, {"t": "gun", "on": True})
        gunlog.info("%s  connected from %s, %s", gun_id, ws.client.host if ws.client else "?",
                    f"paired to {_player_label(owner)}" if owner else "not paired")

        while True:
            try:
                msg = DeviceMessage.validate_python(await ws.receive_json())
            except ValidationError:
                continue
            if not isinstance(msg, m.DeviceBtn):
                continue
            owner = hub.devices.owner(gun_id)
            if owner is not None and not hub.player_exists(owner):
                # Its player is gone (left, page reloaded, room closed): free the gun.
                hub.devices.forget_player(owner)
                owner = None
            counts = gun_presses.setdefault(gun_id, {"trigger": 0, "reload": 0})
            if msg.down:
                counts[msg.b] += 1
            what = f"{msg.b:<7} {'down' if msg.down else 'up  '}"
            if msg.down:
                what += f"  #{counts[msg.b]}"
            if owner is None:
                # Unpaired: the first trigger pull may claim the gun.
                if msg.b == "trigger" and msg.down:
                    owner = hub.devices.claim(gun_id, time.time())
                    if owner:
                        await hub.send(ws, {"t": "paired"})
                        await hub.send_player(owner, {"t": "gun", "on": True})
                        gunlog.info("%s  %s  paired it to %s", gun_id, what, _player_label(owner))
                        continue
                gunlog.info("%s  %s  ignored: not paired", gun_id, what)
                continue
            sent = msg.b == "trigger" or msg.down          # a reload release has nothing to send
            gunlog.info("%s  %s  %s %s", gun_id, what, "->" if sent else "(not sent)", _player_label(owner))
            if msg.b == "trigger":
                trigger_down = msg.down
                await hub.send_player(owner, {"t": "trigger", "down": msg.down})
            elif msg.down:
                await hub.send_player(owner, {"t": "reload_btn"})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("device socket error")
    finally:
        if gun_id:
            c = gun_presses.get(gun_id, {})
            gunlog.info("%s  disconnected (so far: %d trigger, %d reload)", gun_id, c.get("trigger", 0), c.get("reload", 0))
        if gun_id and hub.guns.get(gun_id) is ws:
            del hub.guns[gun_id]
            owner = hub.devices.owner(gun_id)
            if owner:
                if trigger_down:               # never leave a gun firing after it drops
                    await hub.send_player(owner, {"t": "trigger", "down": False})
                await hub.send_player(owner, {"t": "gun", "on": False})


def _player_label(owner: Optional[tuple[str, str]]) -> str:
    """"Ada in room KXTP", for the gun log."""
    if owner is None:
        return "nobody"
    room = hub.rooms.get(owner[0])
    p = room.players.get(owner[1]) if room else None
    return f"{p.name if p else owner[1]} in room {owner[0]}"


def _same_token(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


async def handle(room: Room, p: Player, msg: Any, now: float, ws: WebSocket) -> None:
    code = room.code
    if isinstance(msg, m.Pos):
        room.update_pos(p.id, msg.x, msg.y, msg.acc, msg.heading, msg.pitch)
    elif isinstance(msg, m.Fire):
        for e in room.fire(p.id, msg.seq, msg.hits, msg.heading, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.Ping):
        await hub.send(ws, {"t": "pong", "ts": msg.ts, "now": now})
    elif isinstance(msg, m.Ready):
        room.set_ready(p.id, msg.ready)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.SetClass):
        room.set_class(p.id, msg.cls)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.SetMap):
        room.set_map(p.id, msg.map)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.SetArea):
        walked = await asyncio.to_thread(room.build_area, p.id, msg.origin, msg.paths, msg.helicopter)
        room.use_area(p.id, walked)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.SetMode):
        room.set_mode(p.id, msg.mode)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.Start):
        started = room.start(p.id, now, msg.lat, msg.lon)
        await hub.broadcast(code, room.lobby_state())
        await hub.broadcast(code, started)
        await hub.broadcast(code, room.snapshot(now))
    elif isinstance(msg, m.Reload):
        for e in room.reload(p.id, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.Revive):
        for e in room.revive(p.id, msg.target, msg.on, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.Extract):
        room.set_extract(p.id, msg.on)
    elif isinstance(msg, m.Arrived):
        for e in room.arrived(p.id, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.PairGun):
        until = hub.devices.start_pairing((code, p.id), now)
        await hub.send(ws, {"t": "pairing", "until": until})
        gun = hub.devices.gun_of((code, p.id))
        if gun and gun in hub.guns:
            await hub.send(ws, {"t": "gun", "on": True})
    elif isinstance(msg, m.Reset):
        room.reset(p.id)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.Leave):
        hub.devices.forget_player((code, p.id))
        room.remove_player(p.id)
        await hub.broadcast(code, room.lobby_state())
