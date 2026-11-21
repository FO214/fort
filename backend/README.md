# loonie backend

Authoritative match server: FastAPI + WebSockets, in-memory rooms, 10 Hz tick.
One small box runs hundreds of players; four roommates won't register.

## Run locally

```sh
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
pytest            # 16 tests: geodesy, engine with fake clock, 4-client WS match
```

Phones on the same Wi-Fi reach it at `ws://<your-laptop-ip>:8000/ws`.

## Protocol (all JSON, `t` is the type)

First message on a socket: `create {name, settings}` · `join {code, name}` ·
`resume {code, player_id, token}`. Server answers `welcome` then streams
`lobby` on every roster change and, once playing, a `snapshot` every 100 ms.

| client → server | server → client |
|---|---|
| `ready` `set_team` `set_weapon` `settings` `start` | `lobby` `started` `snapshot` |
| `pos {lat, lon, acc, heading, heading_acc, ts}` @ 4 Hz | `fired {player_id, seq, reason, off?, gate?, dist?}` |
| `fire {seq, target_id, ts}` | `hit {shooter_id, target_id, damage, hp, dir}` |
| `reload` `end` `leave` `ping` | `killed` `respawned` `reload` `reloaded` `ended` `error` |

## How a shot is judged (`engine.py`)

1. Lag-compensate: rewind both players to the shooter's trigger timestamp
   (bounded to 1 s).
2. Distance ≤ weapon range.
3. Angle off the shooter's heading ≤ **dynamic gate** = weapon cone +
   `atan((acc_shooter + acc_target) / dist)`. GPS uncertainty widens the gate
   at close range and tightens it at distance, so a physically on-target shot
   isn't thrown away for a 3 m fix. Capped at 40°.
4. Cooldown, magazine, reload, spawn protection, friendly fire.

Misses still broadcast `fired` (with the reason) so every client can play the
shot and the shooter's HUD can explain why it didn't land.

## Deploy on AWS free tier

EC2 **t3.micro** (750 h/month free for 12 months) is the cheapest thing that
runs a persistent WebSocket. Lambda + API Gateway WebSockets works but is
more moving parts than this needs.

1. Launch Amazon Linux 2023, t3.micro, security group inbound **80, 443**.
2. Paste `deploy/ec2-user-data.sh` into *User data*. It installs Docker,
   clones this repo, and brings up the server behind Caddy with a real TLS
   cert on `<ip-with-dashes>.sslip.io` — no domain purchase.
3. Point the app at `wss://<ip-with-dashes>.sslip.io/ws`.

To redeploy: `ssh`, `cd /opt/loonie && git pull && cd backend/deploy && docker-compose up -d --build`.
