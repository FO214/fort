# LOONIE backend

The server owns the game world. It spawns zombies, walks them toward players,
decides when they bite and whether a shot counts, and sends every phone the
same snapshots. FastAPI + WebSockets, rooms in memory.

## Run locally

Needs Python 3.10 or newer.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
.venv/bin/python -m pytest      # about 45 s (most of it is the live socket tests)
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
app/nav.py       walls: line of sight and corridor routes for zombies
app/models.py    wire protocol and gun classes
app/geo.py       geometry helpers
maps/arena.json       built-in open test map
maps/schmeichel.json  the building's ground floor (real outline, interior from a walkthrough video)
tools/build_schmeichel.py  generates that file; edit the numbers there
```

## How it works

- **Map.** A flat plane in metres, x right and y up. `rotation_deg` is the
  compass bearing of +y, so with 0 the map is x east / y north. The arena has
  no fixed real-world origin: the host's GPS fix at `start` becomes (0, 0).
- **Buildings.** A map can carry an outline, walls, a corridor graph and
  fixed spawn points (the file format is described at the top of
  `app/mapdata.py`). Zombies then walk straight when nothing is in the way and
  otherwise follow the corridor graph round the walls; they spawn at the
  map's spawn points, preferring the ones nearest by corridor. A corridor
  edge drawn through a wall is refused when the map loads. The host picks
  the map in the lobby with `set_map`.
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
  the player is holding the extract button. The bar fills only while at least 2 players are holding (1 when
  only one player is not dead). Letting go pauses it. Holders cannot fire.

## Protocol (JSON, `t` is the type)

First message on a socket: `create {name}`, `join {code, name}` or
`resume {code, player_id, token}`. The server answers `welcome` (with the gun
classes and the map), then `lobby` on every roster change.

| phone → server | server → phone |
|---|---|
| `ready` `set_class` `set_map` (host) `set_mode {mode}` (host) `start {lat?, lon?}` | `welcome` (classes, map, maps) `lobby` (map, settings incl. `mode`) `started` (`mode`, `at`) |
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


## Modes

The host picks one in the lobby with `set_mode`; it is part of `settings` in
every `lobby` message and locks when the run starts.

- **`mission`** (the default): journey to the helicopter, hold it, final wave,
  extract.
- **`endless`**: one phase, `endless`, that never changes. There is no
  helicopter to reach and nothing to extract on (`arrived` and `extract` do
  nothing). Waves spawn around the squad wherever it stands, each bigger than
  the last, and each wave's zombies have `endless_hp_growth` more health than
  the wave before. The run ends only as `wiped`. `started` carries `at`, the
  server time the run began, so a phone can show how long the squad has lasted.

## Tuning

Every pacing and balance number lives in `Tuning` (`app/mission.py`). Override
any of them for one server with a JSON object in the environment:

```sh
LOONIE_TUNING='{"grace_s": 2, "zombie_speed": 1.5}' .venv/bin/uvicorn app.main:app
```

`LOONIE_DEFAULT_MAP=schmeichel` makes new squads start on the building map
instead of the open arena (the host can still switch in the lobby).

## Deploy on AWS free tier

EC2 **t3.micro** is the cheapest thing that runs a persistent WebSocket.

1. Launch Amazon Linux 2023, t3.micro, security group inbound **80, 443**.
2. Paste `deploy/ec2-user-data.sh` into *User data*. It installs Docker,
   clones the repo, and brings up the server behind Caddy with a real TLS
   cert on `<ip-with-dashes>.sslip.io`.
3. Point the app at `wss://<ip-with-dashes>.sslip.io/ws`.

For play inside one building, a laptop on the same Wi-Fi is simpler and has
less lag than a cloud box.
