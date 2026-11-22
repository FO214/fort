# FortIRL mobile

Expo / React Native client. The phone sits on a Nerf gun in landscape; the
camera shows the room, zombies are drawn over it, and the crosshair in the
middle of the screen is the gun sight.

## Run it on phones (Expo Go)

The app is on **Expo SDK 58** (React Native 0.88), which is what the current
Expo Go from the App Store and Play Store opens.

**You need Node.js 22.13 or newer** (24.3+ and 26+ also work). On an older
Node the dev server stops at startup with `URL.parse is not a function`.
Check with `node --version`; get the LTS installer from nodejs.org.

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
3. On the menu, open **Settings → Advanced** and set the server address to
   `ws://<laptop-ip>:8000/ws`. It's remembered.
4. One phone **creates** a mission; the others **join** with the
   four-character code. Pick a class, pair a gun if you have one, ready up.
   The host picks the **mode** (Mission, or Endless: no helicopter, waves
   until nobody is standing) and the map, and starts once everyone is ready.
5. Each phone then walks through **deploy**: turn it sideways, mount it on
   the blaster, wait for a position, count in.

Camera and motion sensors need Expo Go (or https). A phone browser on plain
http will not get them.

If the mission screen does not turn sideways on an iPhone, switch off
Portrait Orientation Lock in Control Centre. On iOS 27 the system can refuse
an app's request to lock the screen (it does so under iPhone Mirroring), and
the game then follows however the phone is held.

**No newer Node yet?** The web build still works on Node 20, for a quick
check in a phone browser without camera or compass:
```sh
npm run export:web && npx serve -s dist -l 8081
```

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
- **Revive.** When a knocked teammate is within reach, a Hold to revive
  button appears bottom-centre. The phone keeps telling the server while it
  is held.
- **Extraction.** In the final wave the camera also reads QR codes. While
  the helicopter's code is in view a Hold to extract button appears; holding
  it tells the server. No separate scan mode.

`src/game/tracking.ts` ties the sensors to those modules and reports the
phone's pose to the server 8 times a second.

## Layout

```
App.tsx               font loading, then the phase router: menu · join · lobby · playing · summary
src/theme.ts          every design token: colour, type, spacing, radius, materials, motion, touch
src/fonts.ts          Barlow Condensed, IBM Plex Sans, IBM Plex Mono
src/brand/            the Formation insignia and the FORTIRL wordmark, as geometry and components
src/assets/brand/     the same marks as SVG files (generated: npm run brand)
src/store.ts          zustand store; handles every server message
src/net/              WebSocket with token resume; wire types
src/sensors/          native (expo-location, expo-sensors) · web · sim (tests)
src/game/             position, orientation, steps, zombies, tracking; identity, permissions,
                      feedback (haptics + sound), format (how values are written on screen)
src/screens/          MainMenu, JoinMission, Lobby, Deploy, Match, Results, Gallery
src/overlays/         Knocked, RevivePrompt, Extraction, Dead, FullMap, HudMenu, Connection,
                      Permission, Settings
src/ui/               shared pieces. Portrait: Button, TextField, MissionCodeInput, Panel, Sheet,
                      StatusChip, RosterRow, ClassCard, PairGunControl. HUD: HudPanel, Crosshair,
                      HitMarker, ThreatMarker, SquadPanel, AmmoReadout, HudControls,
                      ObjectiveBanner, Minimap, MapView, HoldAction. Both: Icon, T, ProgressBar,
                      ProgressRing
src/ui/ZombieLayer    places sprites over the camera, works out the aim, marks unseen zombies
src/ui/ZombieSprite   what a zombie looks like: the one file to swap for real art
assets/sounds/        audio cues (generated: npm run sounds)
e2e/                  Playwright: logic tests + simulated phones
```

## The design system

**BLACKSITE**: industrial typography, operational amber, a geometric
insignia. Solid surfaces first; dark glass only on the HUD, where the camera
has to stay visible.

- **Tokens.** `src/theme.ts` is the only place a colour, a type size or a
  spacing value is written down. Components read semantic names
  (`colors.status.health`, `type.hudValue`, `space[4]`).
- **Colour means one thing each.** Amber is the brand, the primary action and
  the objective. Olive is health and readiness. Red is damage and danger.
  Player colours identify a player and nothing else, and every one of them
  comes with a shape and a slot number. Zombie types have their own cues.
- **Never colour alone.** Ready is a word and a tick as well as olive; a
  knocked teammate is a word and a cross as well as red; the selected class
  says "Selected".
- **Type.** Barlow Condensed for titles, banners and buttons; IBM Plex Sans
  for labels and instructions; IBM Plex Mono for codes, ammo, distance and
  timers. Nothing on the HUD is set below 12 pt.
- **Over the camera.** Critical text sits on a dark plate, never straight on
  the image. Plates are as light as contrast allows: the logic tests
  composite each one over a pure white scene and check the text on it still
  clears WCAG AA.
- **Small screens lose detail, not legibility.** On a narrow or short screen
  the HUD drops teammates' bars, then the wave label, then the minimap, and
  shortens the objective's wording. The crosshair, own health, ammo, the
  objective, threat cues and the hold actions never go, and the type is
  never shrunk to make room.
- **Motion** is short timed eases that say something changed. Nothing
  bounces, and with the system's reduced-motion setting on, things simply
  change.
- **Sound and haptics** have separate switches (Settings, or the mission
  menu), and neither is ever the only sign of an event.

**The gallery** shows the whole system on one screen: palette, type,
buttons, fields, progress, roster, class cards, pairing states, every icon,
the four zombie types on light and dark, player identities, materials. Open
it from Settings → Advanced → Design system, or `?gallery=1` on the web build.

**What is drawn in code** and can be regenerated:

```sh
npm run brand        # src/assets/brand/*.svg and the app icons, from src/brand/geometry.ts
npm run sounds       # assets/sounds/*.wav, synthesised placeholders
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
them with step and GPS events, hold a QR code up to the camera, and press
and hold the real on-screen buttons. One test plays a whole mission with
four phones: knocked, revived, arrive, hold two waves, two extract while
two defend.

`e2e/ui.spec.ts` covers the screens around the mission: the menu's errors,
the code field, the permission briefing (`?perm=ask` stands in for a phone
that has not been asked), gun pairing against a simulated blaster on
`/device` (window, timeout, paired, dropped, back), the deploy sequence, and
the HUD at four device sizes and three HUD scales, where it checks that no
critical piece overlaps another or leaves the screen. Tests skip the deploy
sequence with `?deploy=skip` unless they are about it.

The logic tests also check the design system itself: contrast for every
semantic pairing, HUD plates over a white scene, type and touch minimums,
and the brand geometry.

Screenshots of every screen and state land in `e2e/output/`. The "camera"
in those screenshots is a drawn corridor (`e2e/fakeCamera.ts`).

## The helicopter sign

```sh
npm run heli-qr      # writes ../docs/helicopter-qr.svg
```
Open it in a browser and print at 100 %. It encodes `LOONIE:HELI`, which is
what every map shipped so far expects.

## Things that can only be checked on a real phone

- Which way zombies sit relative to the real world (compass + landscape
  offset). The offset is taken from gravity; if zombies appear exactly behind
  where they should be, the constant to flip is in `src/sensors/index.ts`
  (`offsetFromGravity`).
- Camera field of view (`CAMERA_HFOV_DEG` in `src/game/zombies.ts`, 66°). If
  zombies drift sideways against the room as you turn, adjust it.
- Step detection thresholds (`src/game/steps.ts`) with the phone on the gun.
- How noisy GPS is in the building.
- Blur on the HUD's glass panels (iOS and web blur; Android uses the opaque
  fallback), and how the plates read over real rooms in daylight.
- Haptic patterns and the loudness of the audio cues against each other.
- Reading the helicopter QR code through the game camera. Tests simulate
  "code in view"; the real scan path (`onBarcodeScanned`) has not run on a
  device. Any QR whose text is `LOONIE:HELI` is the helicopter for now.

## Building for a phone without Expo Go

```sh
npx expo prebuild
npx expo run:ios      # or run:android
```
Camera, location and motion permissions are declared in `app.json`.
