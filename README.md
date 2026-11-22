# LOONIE PvE

A 1–4 player co-op zombie game played on phones mounted on Nerf guns, inside
one building. The server owns the zombies; each phone draws them over its
camera from its own position and heading, and the crosshair is the gun sight.

The build spec is [docs/pve-plan.md](docs/pve-plan.md).

```
backend/   FastAPI + WebSocket server: world, waves, mission, rules   → backend/README.md
mobile/    Expo / React Native app: sensors, AR view, HUD             → mobile/README.md
firmware/  ESP32 gun: trigger + reload buttons over Wi-Fi                → firmware/gun/README.md
docs/      the build spec
```

## Where the build is

| Step | What | State |
|---|---|---|
| 0 | GPS walk test | skipped on request |
| 1 | Server core: world, waves, shot validation | done |
| 2 | Phone AR + shooting | done |
| 3 | Full mission: knock, revive, helicopter, holdout, extraction | done |
| 4 | Guns: ESP32 firmware, `/device`, pairing | done: one gun tested end to end on an ESP32-S3 → `firmware/gun/README.md` |
| 5 | Building map | done: Schmeichel ground floor, real outline, interior from the walkthrough video; not yet checked on site |
| 6–7 | Zombie variety, sound, real art | not started |

## The building map

`backend/maps/schmeichel.json` is the ground floor of the Ronald D. Schmeichel
Building at Western University.

- **Outline and position are real.** They come from OpenStreetMap (way
  1300081894), so a phone's GPS lands in the right place on it.
- **The interior comes from a walkthrough video, not a floor plan.** Expect
  walls to be right to a few metres. It covers what the video shows: the
  atrium at the building's elbow, the long concourse up the north wing, the
  side corridor to the exit doors, and the Founders Café at the north end.
  The rooms east of the concourse and the whole south wing are closed.
- **The squad starts in the café. The helicopter is in the atrium**, about
  15 m in from the main (courtyard) entrance, on the line of the concourse.
  That is 59 m away, straight down the concourse.

To change it, edit the numbers at the top of `backend/tools/build_schmeichel.py`
and run it; do not edit the JSON by hand. The host picks the map in the lobby,
or start the server with `LOONIE_DEFAULT_MAP=schmeichel` to make it the default.

The helicopter sign to print is `docs/helicopter-qr.svg` (regenerate with
`npm run heli-qr` in `mobile/`).

## Run everything

```sh
# server
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# app (another terminal), then open in Expo Go on each phone
cd mobile && npm install && npx expo start
```

## Test everything

```sh
cd backend && .venv/bin/python -m pytest
cd mobile && npm run typecheck && npm run e2e
```

## Decisions made while building

These go beyond the spec, or settle something it left open.

- **The arena has no place in the real world.** The host's GPS fix at the
  moment they press Start becomes map (0, 0) for everyone, and the helicopter
  sits 30 m north of it. Where the printed QR code physically hangs is not
  tied to that until step 5 gives the building a real map; the host's
  "We're here" button covers the gap.
- **A phone with no GPS fix yet** is treated as standing at the map's start
  point until its first fix arrives.
- **GPS is trusted less while you stand still** (no steps detected), so
  indoor noise does not slide the zombies around; if fixes keep disagreeing
  in one direction it is trusted more again.
- **Extraction needs 2 holders, or 1 if only one player is not dead.** The
  spec says "1 if playing solo"; without the second half a squad whose
  teammates died could never leave.
- **Revive range adds both phones' GPS accuracy** (up to 25 m of slack),
  because two people standing together can read as metres apart indoors.
- **A dropped phone** stops being chased, and stops counting toward "is
  anyone standing", after 20 s.
- **The landscape compass correction follows gravity** rather than a fixed
  +90°, so it is right whichever way round the phone sits on the gun.
