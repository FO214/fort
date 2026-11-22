# Handoff: zombie sprites from a 3D model

For whoever picks this up next. Written at the end of the session that made
the branch `claude/sleepy-newton-1x9xfw`.

## Where things stand

- **`main` already has** the BLACKSITE UI rebuild and endless mode (merged as
  "Merge the BLACKSITE UI redesign and endless mode into main"), the Expo
  SDK 58 upgrade, and a `sounds/` folder of mp3s the owner added.
- **This branch is one commit on top of that `main`.** It replaces the
  code-drawn zombies with sprites rendered from a 3D model: a block-built,
  Minecraft-style zombie the owner supplied.
- It is pushed, not merged, and has no pull request. The owner merged the
  last branch themselves.

## What the branch does

The game draws zombies as flat images over the camera. Those images now come
from a 3D model, rendered ahead of time. Nothing draws 3D on the phone.

```
assets/zombies/source/model.gltf     the model (Blockbench glTF, skin embedded)
scripts/make-zombie-sprites.mts      renders it: three.js in headless Chromium
assets/zombies/<type>-<clip>.webp    12 sheets: walker|runner|brute|boss x move|attack|die
src/ui/zombieSheets.ts               GENERATED: frame size, grid, scale, offsets, timing, brightness
src/ui/zombieSources.ts              GENERATED: the require() of each sheet
src/ui/spriteBox.ts                  pure maths: which angle, which frame, where it goes
src/ui/ZombieSprite.tsx              draws one frame + shadow, aim outline, hit flash, health bar
src/ui/ZombieLayer.tsx               per camera frame: project, pick facing and frame, cull, edge markers
src/game/zombies.ts                  ZombieBuffer now tracks each zombie's heading; corpses keep it
```

How a frame is chosen:

1. `ZombieBuffer.push` works out each zombie's heading from how it moved
   between server snapshots (only while it is chasing; smoothed).
2. `turnOf` gives how far it is turned from facing this player; `facing`
   picks the nearest of five drawn angles (0, 45, 90, 135, 180) and whether
   to mirror, with hysteresis so it does not flicker between two.
3. `frameAt` picks the frame from the clock (move and attack loop; die plays
   once over `DEATH_FX_S`, 0.75 s, then fades).
4. `cellPlace` puts the frame so its floor line is at the feet. Frames are
   not centred on the body: each sheet says where its frames are centred
   (`forward`, `side`), because arms reach ahead and a fallen body lies to
   one side.

The model file has **no walk animation**, only a pose. The render script
makes the movement itself, in `pose()`: leg swing, arms out, alternating claw
for the attack, tipping over sideways for the death. The four types are the
same six boxes resized and posed differently; see `KINDS` in the script.

To change the art, edit `KINDS` / `pose()` / the lights in the script and run:

```sh
cd mobile
npm run zombie-sprites -- --proof /tmp/proof.png     # look at the proof image
```

Do not edit the two generated modules by hand. A different model works if it
has the same part names (`waist`, `body`, `head`, `rightArm`, `leftArm`,
`rightLeg`, `leftLeg`); otherwise `setUp()` and `pose()` need adapting.

## Running and testing

```sh
# backend
cd backend && .venv/bin/python -m pytest -q            # 106 tests

# app
cd mobile
npm ci
npm run typecheck
npm run test:logic                                     # 49 pure-logic tests, about 2 s
npx expo export --platform web --output-dir dist      # the e2e tests run against this build
npx playwright test -c e2e/playwright.config.ts --trace off    # everything; about 4 minutes
```

In the cloud container used for this session, Playwright needs
`CHROMIUM_PATH=/opt/pw-browsers/chromium`, and `E2E_BACKEND_PORT` /
`E2E_WEB_PORT` pick free ports. The e2e tests serve `dist/`, so **rebuild
`dist` after any app change** or you are testing the old code.

Tests that cover this work:

- `e2e/logic.spec.ts`: frame placement for every sheet, facing and
  mirroring, frame timing, heading tracking, and that every type is bright
  enough against the darkest scene and dark enough against white (from the
  `luminance` the renderer measured).
- `e2e/mission.spec.ts` "zombies are the 3D model…": a real match. A zombie is
  seen from the front, then side-on from both sides, then biting, then shot
  and falling. It steers the zombie by moving the second player, so it does
  not depend on luck.
- `e2e/ui.spec.ts` gallery test: all twelve sheets load.

Test hooks on the web build: `?sim=1` (simulated sensors), `?gallery=1`
(design gallery, includes every zombie type and state), `window.__loonieAR`
(what the last frame drew: per zombie `clip`, `row`, `mirror`, `frame`),
`window.__loonieSim`, `__loonieStore`, `__loonieZombies`, `__loonieTracking`.

## Verified, and not

Verified here, on the **web build** in headless Chromium: all of the above
tests, and by eye in the gallery and in matches (mission and endless).

**Not verified: a real phone.** This is the main risk.

- `Cell` in `ZombieSprite.tsx` has two paths. The web path (a `div` with the
  sheet as its background, CSS mask for the hit flash, `drop-shadow` filter
  for the aim outline) is what the tests see. The native path (an
  `expo-image` of the whole sheet behind a frame-sized clipping view,
  `tintColor` copies for flash and outline) has only been type-checked.
- Things to look at on a device: frames blinking when a zombie first
  appears, starts biting or falls (`ZombiePreload` is meant to prevent it);
  memory and frame rate with twenty zombies (three sheets per type, each up
  to 2048 px a side, about 15 MB decoded); the mirrored frames; WebP with
  alpha on older Android.
- `expo-image` is a new native dependency (`~58.0.18`). Fine in Expo Go;
  a development build needs rebuilding.

Two things were tuned for speed and should not be undone without measuring:

- `MAX_TALL` in `ZombieLayer.tsx` caps how big a point-blank zombie is drawn.
  Without it sprites reach thousands of pixels and slow everything down
  (it made a timing-sensitive e2e test fail).
- `OUTLINE_MAX_PX` in `ZombieSprite.tsx` skips the web outline filter on very
  large sprites, for the same reason.

## Open items

1. **Model licence and credit.** Who made `model.gltf` and under what licence
   is not recorded (`assets/zombies/CREDITS.md` says so). The design is
   Minecraft's, which belongs to Mojang / Microsoft. The owner should confirm
   both before the app is published. There is no credit line in the app.
2. **The owner's sounds are not wired in.** `sounds/*.mp3` at the repo root
   (hitmarker, knocked, pistol_shot, rifle_shot, shotgun_shot, sniper_shot,
   revive, zombie, peterloading) are not used by the app. The app plays
   synthesised placeholders from `mobile/assets/sounds/*.wav`, mapped in
   `mobile/src/game/sound.ts` (`FILES`, `VOLUME`). Wiring them in means
   copying them under `mobile/assets/sounds/`, pointing `FILES` at them and
   checking levels. There is no cue yet for a zombie groan or for loading.
   Nobody asked for this yet; ask before doing it.
3. **The server only spawns walkers** (`backend/app/world.py`, `TYPES`). The
   runner, brute and boss sprites exist and show in the gallery, but never
   appear in play until the server sends type codes 1 to 3.
4. **The walkthrough video is out of date.** It was recorded before endless
   mode and shows the old code-drawn zombies.
5. **Idle zombies** (no player left to chase) reuse the walk at 30% speed.
   There is no idle animation.
6. **A zombie shot from behind** still falls the same way. One fall per type.
7. Stride speed is set by eye (`seconds` per clip in `KINDS`), not matched to
   the server's walking speed, so feet slide a little.

## History of this piece of work, briefly

The first version of this used a different, realistic model ("Zombie" by
pxltiger, from Sketchfab) with its own skeletal animations. The owner then
asked to switch to the Minecraft zombie and drop the old one. Nothing of the
first model is in the repository. The pipeline is the same; what changed is
the loader (glTF instead of FBX) and that animation is now made in `pose()`
instead of read from files.
