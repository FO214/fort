# LOONIE backend

The server owns the game world. It spawns zombies, walks them toward players,
decides when they bite and whether a shot counts, and sends every phone the
same snapshots. FastAPI + WebSockets, rooms in memory.

## Run locally

Needs Python 3.10 or newer.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
.venv/bin/python -m pytest      # 80 tests, about 45 s (most of it is the live socket tests)
```

Phones on the same Wi-Fi reach it at `ws://<your-laptop-ip>:8000/ws`.
Guns find it by themselves: the server answers `LOONIE?` broadcasts on UDP 8001
(`app/discovery.py`). Set `LOONIE_PORT` if uvicorn isn't on 8000, and
`LOONIE_DISCOVERY_PORT` to move the UDP port.

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
- **Zombies** chase the nearest player who is not dead, knocked or not, and
  bite within 1.5 m after a short wind-up.
- **Mission.** `journey` (waves on the way to the helicopter) → `holdout`
  (survive 2 waves there, each must be cleared) → `final` (a last wave that is
  topped up until the squad is out) → `extracted`, or `wiped` when nobody is
  left standing.
- **Arrival.** Any standing player inside the helicopter radius, which grows
  by half that phone's GPS accuracy (up to 10 m). The host can also send
  `arrived` when GPS will not admit it.
- **Knocked and revive.** Health 0 is knocked: no shooting, and each bite
  drains the bleed-out bar (8 bites) until dead. A standing teammate within
  4 m plus both phones' GPS accuracy (slack capped at 25 m) holds `revive` for
  3 s. It does not progress while a zombie is within 4 m of the knocked
  player, and a bite on the reviver cancels it. Revived at 50 %, then 30 %,
  then 20 % health.
- **Extraction.** In the final wave a phone sends `extract {on: true}` while
  the helicopter's QR code is in its camera and the player is holding the
  screen. The bar fills only while at least 2 players are holding (1 when
  only one player is not dead). Letting go pauses it. Holders cannot fire.

## Protocol (JSON, `t` is the type)

First message on a socket: `create {name}`, `join {code, name}` or
`resume {code, player_id, token}`. The server answers `welcome` (with the gun
classes and the map), then `lobby` on every roster change.

| phone → server | server → phone |
|---|---|
| `ready` `set_class` `start {lat?, lon?}` | `welcome` `lobby` `started` |
| `pos {x, y, acc, heading, pitch}` ~8 Hz | `snap` 10 Hz |
| `fire {seq, hits, heading}` `reload` | `fired` `zhit` `zkill` `reload` `reloaded` |
| `revive {target, on}` | `hurt {dir}` `knocked` `revived` `dead` |
| `extract {on}` `arrived` (host) | `phase` `wave` `extract {progress, holders, need}` |
| `pair_gun` | `pairing {until}` `gun {on}` `trigger {down}` `reload_btn` |
| `reset` (host) `leave` `ping` | `ended {outcome, results}` `error` |

**Guns** connect to `/device` and send `hello {gun_id}`, then `btn {b: "trigger"|"reload", down}`;
the server answers `paired` or `unpaired`. A phone's `pair_gun` opens a 10 s window and the
first unpaired gun to pull its trigger becomes that player's (pairing in `app/devices.py`).
A gun whose player is gone is freed. Presses reach the phone as `trigger` / `reload_btn`.

The gun messages in the spec (`pair_gun`, `/device`, `trigger`, `reload_btn`)
are not built yet; phones use their on-screen Fire and Reload.

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
