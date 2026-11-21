# LOONIE mobile

Expo / React Native client. The phone sits on a Nerf gun in landscape; the
camera shows the room, zombies are drawn over it, and the crosshair in the
middle of the screen is the gun sight.

## Run it on phones (Expo Go)

1. **Server.** On a laptop, from `../backend`:
   ```sh
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
   Note the laptop's LAN IP (`ipconfig getifaddr en0` on macOS).
2. **App.** From this folder:
   ```sh
   npm install
   npx expo start
   ```
   Scan the QR with Expo Go on each phone (same Wi-Fi).
3. On the menu, tap **Server** and set it to `ws://<laptop-ip>:8000/ws`.
   It's remembered.
4. One phone **creates** a squad; the others **join** with the four-letter
   code. Pick a loadout, tap ready, host starts.

Camera and motion sensors need Expo Go (or https). A phone browser on plain
http will not get them.

## How the phone knows where things are

- **Position** (`src/game/position.ts`). GPS is the source of truth. Between
  fixes, each detected step moves the estimate 0.7 m along the heading. Every
  fix pulls the estimate toward itself, weighted by its reported accuracy and
  never faster than 3 m/s. While you stand still GPS is trusted less, so
  indoor noise does not slide the zombies around.
- **Heading and pitch** (`src/game/orientation.ts`). Turning comes from the
  motion sensor (smooth); the compass slowly corrects its drift. Pitch comes
  from the same sensor.
- **Zombies** (`src/game/zombies.ts`). The server sends positions 10 times a
  second; the phone draws the world 100 ms in the past, sliding between
  snapshots. The same numbers place a zombie on screen and decide whether
  the crosshair is on it.
- **Shooting.** Fire sends the zombies under the crosshair (nearest first)
  and where the gun pointed. The server has the last word.

`src/game/tracking.ts` ties the sensors to those modules and reports the
phone's pose to the server 8 times a second.

## Layout

```
App.tsx               phase router: menu · join · lobby · playing · summary
src/theme.ts          colour / spacing / type tokens (dark glass over camera)
src/store.ts          zustand store; handles every server message
src/net/              WebSocket with token resume; wire types
src/sensors/          native (expo-location, expo-sensors) · web · sim (tests)
src/game/             position, orientation, steps, zombies, tracking
src/ui/ZombieLayer    places sprites over the camera, works out the aim
src/ui/ZombieSprite   what a zombie looks like — the one file to swap for real art
src/ui/               Glass kit, Reticle, FireButton, Radar, HealthBar, Squad, …
src/screens/          Menu, Join, Lobby, Game, Summary
e2e/                  Playwright: logic tests + simulated phones
```

## Tests

```sh
npm run typecheck
npm run test:logic   # position, orientation, steps, projection, aiming (no browser)
npm run e2e          # builds the web app, boots a backend, plays with simulated phones
```

The e2e uses Google Chrome if it is installed, otherwise run
`npx playwright install chromium` once. It starts its own backend on port
8010 with fast pacing and serves the web build on 8082, so a dev server on
8000/8081 is left alone.

Sensors are driven through `window.__loonieSim` (web build with `?sim=1`):
tests put each player at a map position, turn them to face a zombie, walk
them with step and GPS events, and press the real on-screen buttons.
Screenshots of every screen land in `e2e/output/`. The "camera" in those
screenshots is a drawn corridor (`e2e/fakeCamera.ts`).

## Things that can only be checked on a real phone

- Which way zombies sit relative to the real world (compass + landscape
  offset). The offset is taken from gravity; if zombies appear exactly behind
  where they should be, the constant to flip is in `src/sensors/index.ts`
  (`offsetFromGravity`).
- Camera field of view (`CAMERA_HFOV_DEG` in `src/game/zombies.ts`, 66°). If
  zombies drift sideways against the room as you turn, adjust it.
- Step detection thresholds (`src/game/steps.ts`) with the phone on the gun.
- How noisy GPS is in the building.

## Building for a phone without Expo Go

```sh
npx expo prebuild
npx expo run:ios      # or run:android
```
Camera, location and motion permissions are declared in `app.json`.
