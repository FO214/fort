# LOONIE mobile

Expo / React Native client. One codebase for iOS, Android and web.

## Fastest: phone browsers, nothing to install

```sh
# laptop, terminal 1
cd backend && pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port 8000
# laptop, terminal 2
cd mobile && npm install && npx expo start --web
```
Everyone on the same Wi-Fi opens `http://<laptop-ip>:8081` in their phone's
browser. The app points itself at the server on that same laptop, so
there's nothing to configure. Host picks **Aim · Tap (indoors)**.

## Run it with your roommates tonight (Expo Go)

1. **Server.** On one laptop, from `../backend`:
   ```sh
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8000
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
4. One phone **creates**; the others **join** with the four-letter code.
   Pick a loadout, tap ready, host starts.

**Indoors?** In the lobby the host sets **Aim · Tap (indoors)**. GPS is
useless inside, so instead of a bearing lock you tap the enemy's chip in
the HUD to lock, then fire. Everything else — ammo, damage, kills,
respawn, teams — is the same. **Outdoors**, leave it on **Aim · GPS** and
hold the phone sideways like you're filming the target.

## How aiming works

`src/game/aim.ts` mirrors `backend/app/engine.py`:

- Every enemy gets a bearing and distance from your fix.
- A target is *lockable* when it's inside the weapon's range and inside the
  **dynamic gate** — the weapon's cone widened by the angular size of both
  players' GPS uncertainty at that range.
- Hold the most-centred lockable target for the weapon's `acquire_ms` and
  the reticle closes to mint: **locked**. Fire now and the shot carries
  that target id.
- Fire without a lock and the shot still costs ammo; the HUD says *No lock*.

The server re-judges every shot at the moment you pulled the trigger
(lag-compensated) and is the only thing that changes anyone's health.

`src/sensors/index.ts` is the seam for a better bearing source later
(ARCore Geospatial heading, camera-confirmed targets).

## Layout

```
App.tsx               phase router: menu · join · lobby · playing · summary
src/theme.ts          colour / spacing / type tokens (dark glass over camera)
src/store.ts          zustand store; handles every server message
src/net/client.ts     WebSocket with token resume + backoff
src/sensors/          native (expo-location) · web · sim (tests)
src/game/aim.ts       candidates, dynamic gate, lock state machine
src/ui/               Glass, GlassButton, Reticle, FireButton, Radar, EnemyTag,
                      HealthBar, KillFeed, DamageFlash, HitMarker, …
src/screens/          Menu, Join, Lobby, Game, Summary
e2e/                  Playwright: four browser contexts play a whole match
```

## Tests

```sh
npm run typecheck
npm run e2e          # exports the web build, boots the backend, runs Playwright
```

The e2e drives sensors through `window.__loonieSim` (web build with `?sim=1`)
so it can put four players at exact positions and headings, lock, fire,
take damage, die, respawn, and finish a match. Screenshots land in
`e2e/output/`.

## Building for a phone without Expo Go

```sh
npx expo prebuild
npx expo run:ios      # or run:android
```
Camera and location permissions are declared in `app.json`.
