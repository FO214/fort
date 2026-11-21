"""FastAPI + WebSocket server. One socket per player; the first message
must be `create`, `join`, or `resume`. Rooms tick at 10 Hz and every tick
broadcasts a snapshot to the connected players in that room."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import TypeAdapter, ValidationError

from . import models as m
from .engine import GameError, Player, Room, RoomManager

log = logging.getLogger("loonie")

TICK_S = 0.1
DISCONNECT_GRACE_S = 90.0     # keep a dropped player's slot this long for resume

FirstMessage = TypeAdapter(m.Create | m.Join | m.Resume)
InGameMessage = TypeAdapter(
    m.Ready | m.SetTeam | m.SetWeapon | m.UpdateSettings | m.Start
    | m.Pos | m.Fire | m.Reload | m.Leave | m.End | m.Reset | m.Ping
)


class Hub:
    """Sockets per room, plus the tick loop that drives every room."""

    def __init__(self) -> None:
        self.rooms = RoomManager()
        self.sockets: dict[str, dict[str, WebSocket]] = {}   # code -> pid -> ws
        self._task: Optional[asyncio.Task[None]] = None
        self._disconnect_at: dict[tuple[str, str], float] = {}

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
            now = time.time()
            for code, room in list(self.rooms.rooms.items()):
                try:
                    events = room.tick(now)
                    for e in events:
                        await self.broadcast(code, e)
                    if room.phase == "playing":
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
            await asyncio.sleep(TICK_S)

    # ---- messaging -----------------------------------------------------
    async def send(self, ws: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await ws.send_json(payload)
        except Exception:
            pass

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
    try:
        yield
    finally:
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
            "max_players": room.settings.max_players, "mode": room.settings.mode}


@app.get("/weapons")
async def weapons() -> dict[str, Any]:
    return {k: {**w.model_dump(), "hp": m.WEAPON_HP[k]} for k, w in m.WEAPONS.items()}


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
            await hub.send(ws, {"t": "error", "msg": "Bad first message", "detail": e.errors()})
            await ws.close()
            return

        if isinstance(first, m.Create):
            room = hub.rooms.create(first.settings)
            player = room.add_player(first.name)
        elif isinstance(first, m.Join):
            room = hub.rooms.get(first.code)
            if room is None:
                await hub.send(ws, {"t": "error", "msg": "No game with that code"})
                await ws.close()
                return
            try:
                player = room.add_player(first.name)
            except GameError as e:
                await hub.send(ws, {"t": "error", "msg": str(e)})
                await ws.close()
                return
        else:
            room = hub.rooms.get(first.code)
            p = room.players.get(first.player_id) if room else None
            if room is None or p is None or p.token != first.token:
                await hub.send(ws, {"t": "error", "msg": "Can't resume that session"})
                await ws.close()
                return
            player = p

        player.connected = True
        hub.attach(room.code, player.id, ws)
        await hub.send(ws, {"t": "welcome", "player_id": player.id, "token": player.token,
                            "code": room.code, "host_id": room.host_id,
                            "weapons": {k: {**w.model_dump(), "hp": m.WEAPON_HP[k]}
                                        for k, w in m.WEAPONS.items()}})
        await hub.broadcast(room.code, room.lobby_state())
        if room.phase == "playing":
            await hub.send(ws, room.snapshot(time.time()))
            for entry in room.feed:
                await hub.send(ws, entry)
        elif room.phase == "ended":
            await hub.send(ws, {"t": "ended", "results": room.results, "teams": None,
                                "duration_s": 0})

        while True:
            raw = await ws.receive_json()
            try:
                msg = InGameMessage.validate_python(raw)
            except ValidationError as e:
                await hub.send(ws, {"t": "error", "msg": "Bad message", "detail": e.errors()[:3]})
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
                if room.phase == "lobby":
                    room.remove_player(player.id)
                    hub._disconnect_at.pop((room.code, player.id), None)
                await hub.broadcast(room.code, room.lobby_state())


async def handle(room: Room, p: Player, msg: Any, now: float, ws: WebSocket) -> None:
    code = room.code
    if isinstance(msg, m.Pos):
        room.update_pos(p.id, msg.lat, msg.lon, msg.acc, msg.heading, msg.heading_acc, msg.ts, now)
    elif isinstance(msg, m.Fire):
        for e in room.fire(p.id, msg.seq, msg.target_id, msg.ts, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.Ping):
        await hub.send(ws, {"t": "pong", "ts": msg.ts, "now": now})
    elif isinstance(msg, m.Ready):
        room.set_ready(p.id, msg.ready)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.SetTeam):
        room.set_team(p.id, msg.team)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.SetWeapon):
        room.set_weapon(p.id, msg.weapon)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.UpdateSettings):
        room.update_settings(p.id, msg.settings)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.Start):
        room.start(p.id, now)
        await hub.broadcast(code, {"t": "started", "ends_at": room.ends_at, "now": now,
                                   "settings": room.settings.model_dump()})
        await hub.broadcast(code, room.snapshot(now))
    elif isinstance(msg, m.Reload):
        for e in room.reload(p.id, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.End):
        for e in room.end(p.id, now):
            await hub.broadcast(code, e)
    elif isinstance(msg, m.Reset):
        room.reset(p.id)
        await hub.broadcast(code, room.lobby_state())
    elif isinstance(msg, m.Leave):
        room.remove_player(p.id)
        await hub.broadcast(code, room.lobby_state())
