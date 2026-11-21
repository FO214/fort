# LOONIE PvE — co-op zombie extraction (build spec for a fresh repo)

## Context

The PvP laser-tag game in `FO214/loonie` is being scrapped. The new game is a **1–4 player co-op
mission** played in one building: the squad walks to a "helicopter" while fighting waves of
virtual zombies, holds there for 2 waves, then extracts during a final wave. Phones are mounted
on Nerf guns in landscape; each gun has an ESP32 with a trigger button and a reload button.

This spec will be built **in a new repo, from a local Claude Code session** (not this cloud
session). It is written to stand alone.

Decisions already made by the user:
- **Every player's position is live and individual, from GPS.** No shared squad position, no
  position markers.
- **Only one QR code exists: the helicopter.** Extraction needs **at least 2 players** aiming
  their cameras at it and holding down on the screen at the same time while the others defend.
- **Real map view** of the building, built from a floor plan photo or video the user supplies.
- **Zombies start as code-drawn glowing silhouettes** behind one component that is later swapped
  for real art (sprite frames from video, or 3D models).
- No outdoor mode. No fixed deadline; phases are ordered so the game is playable early.

Why this is easier than PvP: targets are virtual, so the server knows exactly where they are.
No vests, dart sensing, shot matching or anti-cheat. Each phone draws a zombie using its own
position and heading and judges the shot with the same values, so sensor error mostly cancels
for the person shooting.

## Handoff (the only step done in the current cloud session)

1. Commit this spec to `FO214/loonie` as `docs/pve-plan.md` on
   `claude/fortnite-mobile-game-research-jeoaj8`, push, and send the file to the user.
2. In the new repo, the local session starts from: "implement `docs/pve-plan.md`".
3. Seed the new repo by copying `backend/` and `mobile/` from `FO214/loonie@7fca8e5`, then strip
   PvP (see "Carried over"). This keeps rooms, lobby, reconnect, HUD and the test harness.

## How it works

**Server owns the world.** Flat 2D map in metres (x east, y north) tied to real coordinates by
the map file's origin lat/lon and rotation. Simulation at 20 Hz; snapshots to phones at 10 Hz as
compact arrays `[id, type, x, y, hp, state, target]`. Phones interpolate ~100 ms behind. Phones
never spawn or move zombies, so all players see the same zombies at the same map positions.

**Player position (per player, live).** New `mobile/src/game/position.ts`:
- Source of truth is GPS via `expo-location` (`BestForNavigation`; indoors the OS blends in
  Wi-Fi positioning).
- Step tracking smooths it between fixes: each detected step (`expo-sensors` accelerometer peak
  detection) moves the estimate ~0.7 m along the current heading.
- Each GPS fix pulls the estimate toward it, weighted by the fix's reported accuracy. Fixes that
  imply faster than ~3 m/s are softened so the player doesn't teleport.
- Phone sends `pos {x, y, acc, heading, pitch}` at ~8 Hz. The server trusts it (co-op).

**Heading and pitch.** Compass from the existing `sensors/` module (keep the landscape +90°
offset) plus `expo-sensors` DeviceMotion for pitch and smooth turning.

**AR view.** For each zombie: bearing and distance from *this player's* position → screen x from
(bearing − heading) through the camera FOV, screen y from pitch, size from 1/distance. Reuse the
projection math from `mobile/src/ui/EnemyTag.tsx` and `mobile/src/game/aim.ts`.

**Shooting.** On trigger the phone picks the zombie(s) under the crosshair (angular size
`atan(0.35 m / dist)` + weapon spread; the nearest one blocks) and sends
`fire {seq, hits:[zombie_id…], heading}`. The server checks ammo, fire rate, range and that the
heading is plausible, then applies damage. Ammo, reload and duplicate-shot rules reuse the
existing `Player` logic.

**Guns.** ESP32 joins Wi-Fi, opens a WebSocket to a new `/device` endpoint and sends
`btn {b:"trigger"|"reload", down}`. The server forwards it to the paired player's phone, which
runs the same code as the on-screen Fire/Reload buttons (kept as fallback). Pairing: tap
"Pair gun" in the lobby, pull the trigger within 10 s. Routed through the server rather than
Bluetooth so it works in Expo Go; the extra hop should be tens of milliseconds on local Wi-Fi.

**Mission phases.**
`lobby → journey → holdout (2 waves) → final wave + extraction → extracted | wiped`
- *Journey:* helicopter shown on the map and as a direction/distance bar. Waves spawn on the way.
- *Arrival:* any living player within the helicopter radius (radius grows with reported GPS
  accuracy). Host also has a "We're here" button in case GPS is off.
- *Extraction:* during the final wave, players aim at the helicopter QR and hold the screen.
  Progress fills only while **≥ 2 players** are holding with the QR in view (1 if playing solo).
  Releasing pauses it. Holding players cannot shoot. Full bar → extracted.
- The QR is read by the existing `expo-camera` view (`onBarcodeScanned`), no mode switch.

**Knock and revive.** HP 0 → knocked, cannot shoot. Zombies in reach drain a bleed-out bar;
empty → dead for the mission. A teammate within ~4 m (plus GPS slack) holds Revive for 3 s; only
allowed when no zombie is within 4 m of the knocked player; taking damage interrupts it.
Revived at 50% HP, then 30%, then 20%. Everyone knocked or dead → mission failed.

**Zombies.** Spawn at map spawn points away from players, chase the nearest living player
(knocked players included), attack within 1.5 m. Follow the map's corridor graph when it has
one, straight lines otherwise. Wave size scales with player count.

## Protocol (JSON, `t` = type)

| From | Messages |
|---|---|
| phone → server | `create` `join` `resume` `ready` `set_class` `pair_gun` `start` `pos` `fire` `reload` `revive {target, on}` `extract {on}` `arrived` (host) `reset` `leave` |
| server → phone | `welcome` (+ map, classes) `lobby` `started` `snap` `fired` `zhit` `zkill` `hurt {dir}` `knocked` `revived` `dead` `phase` `wave` `extract {progress, holders}` `trigger {down}` `reload_btn` `ended` `error` |
| gun → server | `hello {gun_id}` `btn {b, down}` |
| server → gun | `paired {player}` |

## Repo layout

```
backend/app/   main.py  room.py  world.py  mission.py  mapdata.py  devices.py  models.py  geo.py
backend/maps/  arena.json (open test map)   <building>.json
backend/tests/
mobile/src/    net/  sensors/  game/{position,orientation,zombies}.ts
               ui/{ZombieLayer,ZombieSprite,MapView,ObjectiveBar,ExtractHold,DownedOverlay,ReviveButton}.tsx
               screens/{Menu,Join,Lobby,Game,Summary}.tsx
mobile/e2e/
firmware/gun/  PlatformIO project; config.example.h (real config.h gitignored)
docs/pve-plan.md
```

## Carried over from `FO214/loonie@7fca8e5`

- Keep: `backend/app/main.py` (Hub, `/ws`, room codes, token resume, tick loop → 0.05 s);
  lobby methods, `Player` ammo/reload/cooldown/`fire_seq`, `RoomManager` from `engine.py`;
  `geo.py`; test layout with fake clock; WebSocket test client.
- Keep: Menu, Join, Lobby, Summary; `store.ts`; `net/client.ts`; `sensors/index.ts` (with the
  `window.__loonieSim` test hook); `Radar`, `HealthBar`, `AmmoPanel`, `FireButton`,
  `DamageFlash`, `HitMarker`, `KillFeed`, `Reticle`, glass UI kit; Playwright harness.
- Remove: player-vs-player hit resolution, teams, `aim` gps/manual, `TargetStrip`, lag history.
- New Expo modules (all work in Expo Go): `expo-sensors`, `expo-audio`, `expo-keep-awake`.

Known gotchas from the old build:
- react-native-web sends only `onPress` for a quick tap; handle it as one trigger pull.
- `expo-location` heading is not rotated for landscape; apply the +90° offset.
- `process.env.EXPO_PUBLIC_*` must be written without optional chaining to be inlined.
- Install `babel-preset-expo` at top level.
- In WebSocket tests connect with `max_queue=None`, or closes take 10 s.
- Camera and motion sensors need Expo Go or https; plain-http phone browsers won't have them.

## Build order (each milestone is playable)

0. **GPS walk test (10 minutes, before anything else).** A debug screen that logs GPS accuracy
   while walking the building. Tells us how much the step tracking has to carry.
1. **Server core.** Strip PvP. `world.py` + `mission.py` on the open arena map: one zombie type,
   waves, melee, fire validation. Fake-clock tests.
2. **Phone AR + shooting.** Position and orientation modules, zombie layer with silhouettes,
   crosshair picking, radar dots, damage wedge, on-screen buttons. E2E with simulated sensors.
   **→ Milestone A: phones-only zombie waves.**
3. **Full mission loop.** Knock, bleed-out, revive by proximity, phases, objective bar, two-player
   hold-to-extract on the QR, win/lose summary, play again.
   **→ Milestone B: complete game without guns or building map.**
4. **Guns.** `/device` endpoint, pairing, relay to phone, firmware, fake-gun client in tests.
   **→ Milestone C: Nerf guns fire and reload.**
5. **Building map.** Map JSON (origin lat/lon, rotation, scale, walls, corridor graph, spawn
   points, helicopter). Map view as minimap and full screen with live player dots. Zombies follow
   corridors. Printable helicopter QR. **→ Milestone D: the real building.**
6. **Variety and feel.** Walker / runner / brute, final-wave boss, 4 gun classes (pistol, SMG,
   shotgun cone, rifle pierce), sound, haptics, keep-awake, balance pass.
7. **Real zombie art.** Swap `ZombieSprite` to sprite frames cut from the user's videos, or to 3D
   models via `expo-three`.

Stretch: gun LED/rumble feedback; dim zombies that are behind a map wall.

## Risk the user has accepted

Indoor GPS is often 10–30 m off and can drop out; it also cannot tell floors apart. The user
chose GPS as the position source anyway. Mitigations in this spec: step tracking between fixes,
accuracy-weighted blending, jump limiting, arrival and revive distances that grow with reported
accuracy, the host "We're here" button, and the step-0 walk test. If the walk test shows GPS is
unusable, the fallback is a one-time "squad is at the start point" tap followed by step tracking
only — to be decided with the user at that point, not built by default. Play on one floor.

## Needed from the user

- Floor plan of the building (a photo of the posted evacuation map is ideal; video works but is
  less accurate) and the lat/lon of two building corners for placing it on real coordinates.
  Until then everything runs on the built-in arena map.
- ESP32 board model and the two button pins.
- A hotspot or router for event day (ESP32 needs 2.4 GHz with no login page).
- Zombie videos or models when ready (phase 7).

## Verification

- `cd backend && python3 -m pytest` — world sim, mission phases, knock/revive, extraction needing
  two holders, pairing, map pathing, and a WebSocket test with 4 players plus a fake gun playing
  a full mission.
- `cd mobile && npm run typecheck && npm run e2e` — Playwright with 4 simulated phones: join,
  walk (simulated GPS), turn to face zombies, shoot, get knocked, revive, arrive, two players
  hold-extract while two defend; screenshots of every screen reviewed.
- `expo export` for iOS and Android; `pio run` compiles the firmware.
- On real devices (local session, with the user): Expo Go on the hotspot; pair one gun and check
  trigger-to-flash delay; check zombies stay put while turning and walking; walk test numbers;
  two phones extracting on the printed QR.
