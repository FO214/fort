# AR tracking: how it fits together, and what the native module must do

Indoors, GPS is often 5–10 m out. That is enough to put a player on the wrong side of a wall, so zombies show through walls or vanish in the same room. AR world tracking (ARKit on iOS, ARCore on Android) follows the phone to a few centimetres using the camera and motion sensors. It needs no LiDAR, so it works on any reasonably recent phone. What it lacks is a starting point: it measures movement from wherever its session began. A printed **marker** hung at a known spot on the map provides that starting point.

## What exists already (no device needed)

| Piece | Where |
|---|---|
| Map anchors: `anchors: [{id, x, y, facing, size_m}]` in map files, validated on load and sent to phones | `backend/app/mapdata.py`, `mobile/src/net/types.ts` |
| Placeholder anchors for Schmeichel (**measure them on site**) | `backend/tools/build_schmeichel.py` |
| Map upload: `POST /maps/{id}`, header `X-Upload-Key`, off unless `LOONIE_UPLOAD_KEY` is set; stored in `LOONIE_MAPS_DIR` | `backend/app/main.py`, `backend/deploy/docker-compose.yml` |
| All AR maths: matrices to poses, marker sighting to map alignment, the tracker (staleness, lost tracking, eased re-anchoring) | `mobile/src/game/arPose.ts` |
| AR events wired into tracking: `tracking.pose()` gives the AR pose while anchored and the GPS pose otherwise; GPS is kept in step so falling back does not jump | `mobile/src/game/tracking.ts`, `mobile/src/sensors/index.ts` |
| Marker images and a print sheet: `npm run markers` | `mobile/scripts/make-markers.mts` → `mobile/assets/markers/`, `mobile/scripts/output/` |
| Tests: logic (`e2e/logic.spec.ts`, "AR tracking"), browser (`e2e/ar.spec.ts`, simulated AR session), backend (`tests/test_maps.py`) | |

## The contract for the native module

The module sends three events into `startSensors`' listener (`mobile/src/sensors/index.ts`). All maths stays in JS. The native side only passes on what ARKit or ARCore reports.

```ts
{ k: 'arFrame', m: number[16], state: 'normal' | 'limited' | 'none' }   // every frame, 30-60 Hz
{ k: 'arMarker', id: string, m: number[16] }                            // each time a marker is detected or updated
{ k: 'arReset' }                                                        // the session restarted (new world frame)
```

- **Matrices** are 4×4, **column-major**, 16 numbers, in the session's world frame: right-handed, metres, +y up (gravity-aligned). This is what both frameworks use natively (`simd_float4x4` columns; ARCore `Pose.toMatrix`).
- **`arFrame.m`** is the camera transform. On iOS, `ARFrame.camera.transform`. On Android, `Camera.getPose()` or `getDisplayOrientedPose()`; either works, because roll is normalised for both landscape grips. The camera looks down its own −z.
- **`arMarker.m`** is the image anchor transform. On iOS, `ARImageAnchor.transform`. On Android, `AugmentedImage.getCenterPose()`. The image lies in the anchor's x–z plane with +y out of its face. `id` is the anchor id from the map: name each reference image `<map>-<id>` and send back the part after the map id.
- **`state`**: `normal` → `'normal'`; `limited` (any reason) → `'limited'`; `notAvailable` / `STOPPED` / `PAUSED` → `'none'`.
- **Reference images**: `mobile/assets/markers/<map>-<id>.png`, with a physical width of the anchor's `size_m` (ARKit `ARReferenceImage(_, orientation:, physicalWidth:)`; ARCore `AugmentedImageDatabase.addImage(name, bitmap, widthInMeters)`).
- **Camera view**: the AR session owns the camera, so the AR view replaces `expo-camera`'s `CameraView` in `MatchScreen.tsx`. The zombie layer keeps drawing on top as it does now.

To check the module against the simulator: `window.__loonieSim.arPose(x, y, heading)` (web, `?sim=1`) sends exactly these events. `e2e/ar.spec.ts` shows how it behaves.

## Hanging markers

1. Run `npm run markers` in `mobile/` and print `scripts/output/<map>-markers.pdf` at 100%. Check the 10 cm bar measures 10 cm.
2. Hang each sheet flat on a wall at about chest height, black bar at the top, somewhere players naturally look: the start, junctions, the helicopter. Use matte paper, keep the sheet flat, and keep it out of glare.
3. Measure each sheet's centre on the map and the direction it faces. Put the numbers in the map (for Schmeichel, `build_schmeichel.py`, then rebuild). A marker that is 1 m off on the map puts everyone 1 m off.

## Milestone 1: done when

- [ ] A development build of the current app runs on an iPhone (`expo-dev-client`; `npx expo run:ios` or EAS).
- [ ] The native ARKit module emits the three events, and `CameraView` is replaced by the AR view.
- [ ] On Schmeichel, with both markers hung and measured, two non-Pro iPhones each anchor by looking at a marker.
- [ ] Both phones show the same zombie in the same place (within about 30 cm).
- [ ] Walls hide zombies reliably while walking the building.
- [ ] A phone without AR still plays on GPS.

## Device spikes to run first

| Spike | Question | Pass |
|---|---|---|
| A. Pose rate | Do poses reach JS fast enough? | 30+ per second; sprites trail the camera image by no more than about a frame |
| B. Corridor drift | How far does tracking drift in the building? | Walk the 50 m concourse and back: under about 1 m off at the start |
| C. Detection | At what distance and angle are markers found? | 2 m+, up to about 45°, in the building's lighting |
| D. Two phones | Do two phones anchored to one marker agree? | Same zombie, same spot, within about 30 cm |
| E. Endurance | Heat and battery over a game | 20 minutes without throttling or a dropped frame rate |
| F. Gun mount | Does tracking survive swings and recoil? | Recovers within a second or two |

## Later

- Exact field of view from the camera intrinsics (replacing the lens table in `mobile/src/game/camera.ts`).
- A HUD indicator for AR or GPS tracking.
- LiDAR scanning (RoomPlan) to make maps: walls become `walls` (cut at doors and openings), furniture becomes `obstacles`, and markers seen during the scan become `anchors`. The result is uploaded with `POST /maps/{id}`.
- ARCore on Android.
