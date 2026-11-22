# FortIRL

**Survive together.** A 1–4 player co-op zombie game played on phones mounted
on Nerf guns, inside one building. The server owns the zombies; each phone
draws them over its camera from its own position and heading, and the
crosshair is the gun sight.

The build spec is [docs/pve-plan.md](docs/pve-plan.md). The interface follows
the BLACKSITE design system: see [mobile/README.md](mobile/README.md#the-design-system).

(The project started life as LOONIE. The name survives in a few identifiers
that are not worth breaking: the `LOONIE_TUNING` and `LOONIE_DEFAULT_MAP`
server settings, the `LOONIE:HELI` text on the printed helicopter sign, and
the test hooks.)

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
| 6 | Variety and feel | part done: four gun classes (as plain stat tables: no shotgun cone or rifle pierce yet), sound and haptic cues, keep-awake. The phone can draw walkers, runners, brutes and a boss; the server still only spawns walkers |
| 7 | Real zombie art | not started: the four types are drawn in code, behind the one component to swap |
| UI | BLACKSITE design system | done: every screen, the HUD and all overlays → `mobile/README.md` |
| Modes | Mission and Endless | done: the host picks in the lobby. Endless has no helicopter: waves keep coming around the squad, each tougher than the last, until nobody is standing → `backend/README.md` |

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

`docs/schmeichel-map.svg` is a picture of it (walls, zombie routes, spawn
points, start, helicopter) to check against the real place. To change the
map, edit the numbers at the top of `backend/tools/build_schmeichel.py` and
run it; that rewrites both the JSON and the picture. The host picks the map in the lobby,
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

- **Endless mode ends only in a wipe.** There is no helicopter, so nothing to
  reach or extract on; the host's abort still returns everyone to the lobby.
  Each wave is bigger and its zombies 6% tougher than the last, so a run
  always ends. Each phone remembers the furthest wave it has reached.
- **Four gun classes: pistol, SMG, shotgun, rifle.** The lobby's class cards
  come straight from the server's table. Pistol, SMG and rifle carry the
  numbers the original regular, light and heavy classes had; the shotgun is
  new (hard-hitting, forgiving aim, 12 m reach). They differ only in their
  numbers so far.
- **The host can only start once everyone connected is ready.** The phone
  enforces this and says who it is waiting for; the server would still accept
  a start, so an older client is not locked out.
- **A deploy step sits between the lobby and the mission**: turn the phone,
  mount it, wait for a position, count in. The mission clock is the server's
  and is already running, so the step is short and a phone that rejoins
  mid-mission skips it.

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
