# LOONIE backend

The server owns the game world. It spawns zombies, walks them toward players,
decides when they bite and whether a shot counts, and sends every phone the
same snapshots. FastAPI + WebSockets, rooms in memory.

## Run locally

Needs Python 3.10 or newer.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
.venv/bin/python -m pytest
```

Phones on the same Wi-Fi reach it at `ws://<your-laptop-ip>:8000/ws`.

## Layout

```
app/main.py      sockets, room codes, token resume, the 20 Hz tick loop
app/room.py      lobby, players, ammo/reload, shot validation, bites
app/world.py     zombies: spawn, chase, attack, un-stack
app/mission.py   wave pacing and every tuning number (class Tuning)
app/mapdata.py   map files, spawn placement, lat/lon <-> map metres
app/models.py    wire protocol and gun classes
app/geo.py       geometry helpers
maps/arena.json  built-in open test map
```

## How it works

- **Map.** A flat plane in metres, x right and y up. `rotation_deg` is the
  compass bearing of +y, so with 0 the map is x east / y north. The arena has
  no fixed real-world origin: the host's GPS fix at `start` becomes (0, 0).
- **Tick.** The world steps every 50 ms. Every second tick each phone gets a
  `snap`: mission phase, wave, zombies as `[id, type, x, y, hp, state, target]`
  and one small object per player.
- **Position.** Each phone reports its own `pos {x, y, acc, heading, pitch}` in
  map metres. The server trusts it; this is co-op.
- **Shooting.** The phone decides which zombie is under its crosshair and
  sends `fire {seq, hits, heading}`. The server checks ammo, fire rate and
  reload, then that the claimed zombie exists, is in range, and lies within a
  small angle of where the gun points. One bullet hits one zombie.
- **Zombies** chase the nearest standing player and bite within 1.5 m after a
  short wind-up. Health 0 means knocked; everyone down ends the mission.

## Protocol (JSON, `t` is the type)

First message on a socket: `create {name}`, `join {code, name}` or
`resume {code, player_id, token}`. The server answers `welcome` (with the gun
classes and the map), then `lobby` on every roster change.

| phone → server | server → phone |
|---|---|
| `ready` `set_class` `start {lat?, lon?}` | `welcome` `lobby` `started` |
| `pos {x, y, acc, heading, pitch}` ~8 Hz | `snap` 10 Hz |
| `fire {seq, hits, heading}` `reload` | `fired` `zhit` `zkill` `reload` `reloaded` |
| `reset` (host) `leave` `ping` | `hurt {dir}` `knocked` `wave` `ended` `error` |

## Tuning

Every pacing and balance number lives in `Tuning` (`app/mission.py`). Override
any of them for one server with a JSON object in the environment:

```sh
LOONIE_TUNING='{"grace_s": 2, "zombie_speed": 1.5}' .venv/bin/uvicorn app.main:app
```

## Deploy on AWS free tier

EC2 **t3.micro** is the cheapest thing that runs a persistent WebSocket.

1. Launch Amazon Linux 2023, t3.micro, security group inbound **80, 443**.
2. Paste `deploy/ec2-user-data.sh` into *User data*. It installs Docker,
   clones the repo, and brings up the server behind Caddy with a real TLS
   cert on `<ip-with-dashes>.sslip.io`.
3. Point the app at `wss://<ip-with-dashes>.sslip.io/ws`.

For play inside one building, a laptop on the same Wi-Fi is simpler and has
less lag than a cloud box.
