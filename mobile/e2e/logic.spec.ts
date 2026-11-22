/**
 * The phone's pure game logic, no browser: position fusion, orientation,
 * step detection, and the projection/aiming maths.
 */
import { test, expect } from '@playwright/test';
import { fromLocal, toLocal, angleDiffDeg } from '../src/game/geo';
import { OrientationTracker, pitchFromAttitude } from '../src/game/orientation';
import { PositionTracker, STEP_M } from '../src/game/position';
import { StepDetector } from '../src/game/steps';
import { EARSHOT_M, FULL_AT_M, HordeEar, RATE_MAX, RATE_MIN, hordeVoice, nearestDistance } from '../src/game/horde';
import { DEATH_FX_S, ZombieBuffer, pickTargets, project, underCrosshair, type Camera } from '../src/game/zombies';
import { Z_ATTACK, Z_CHASE } from '../src/net/types';
import { FIGURE_ASPECT, ZOMBIE_KINDS, cellPlace, facing, frameAt, spriteBox, turnOf } from '../src/ui/spriteBox';
import { ZOMBIE_ANGLES, ZOMBIE_SHEETS } from '../src/ui/zombieSheets';

const ORIGIN: [number, number] = [43.4723, -80.5449];
const FRAME = { origin: ORIGIN, rotation_deg: 0, start: [0, 0] as [number, number] };
const fix = (x: number, y: number, rotation = 0) => fromLocal(x, y, ORIGIN[0], ORIGIN[1], rotation);
const rad = (d: number) => (d * Math.PI) / 180;

test.describe('geo', () => {
  test('lat/lon and map metres round-trip, with and without rotation', () => {
    for (const rot of [0, 37, 90, 211]) {
      for (const [x, y] of [[0, 0], [12.5, -30], [-48, 7]]) {
        const [lat, lon] = fromLocal(x, y, ORIGIN[0], ORIGIN[1], rot);
        const [bx, by] = toLocal(lat, lon, ORIGIN[0], ORIGIN[1], rot);
        expect(Math.hypot(bx - x, by - y)).toBeLessThan(0.01);
      }
    }
  });
});

test.describe('position', () => {
  test('starts at the map start and snaps to the first fix', () => {
    const p = new PositionTracker();
    p.setFrame({ ...FRAME, start: [2, 3] }, 0);
    expect(p.estimate(0)).toMatchObject({ x: 2, y: 3, hasFix: false });
    const [lat, lon] = fix(10, -5);
    p.onGps(lat, lon, 8, 1);
    const e = p.estimate(1);
    expect(e.hasFix).toBe(true);
    expect(e.x).toBeCloseTo(10, 1);
    expect(e.y).toBeCloseTo(-5, 1);
    expect(e.acc).toBeCloseTo(8, 0);
  });

  test('steps carry the estimate between fixes', () => {
    const p = new PositionTracker();
    p.setFrame(FRAME, 0);
    p.onGps(...fix(0, 0), 5, 0);
    for (let i = 1; i <= 10; i++) p.onStep(90, i * 0.5);           // ten steps east
    const e = p.estimate(5);
    expect(e.x).toBeCloseTo(10 * STEP_M, 5);
    expect(e.y).toBeCloseTo(0, 5);
    expect(e.acc).toBeGreaterThan(5);                               // less sure than right after the fix
  });

  test('a good fix pulls harder than a poor one', () => {
    const pull = (acc: number) => {
      const p = new PositionTracker();
      p.setFrame(FRAME, 0);
      p.onGps(...fix(0, 0), 10, 0);
      p.onGps(...fix(4, 0), acc, 2);
      return p.estimate(2).x;
    };
    const good = pull(4), poor = pull(30);
    expect(good).toBeGreaterThan(poor);
    expect(good).toBeGreaterThan(2);                                // mostly believed
    expect(poor).toBeLessThan(1);                                   // mostly ignored
    expect(poor).toBeGreaterThan(0);                                // ...but not entirely
  });

  test('a fix that implies teleporting is softened, not obeyed', () => {
    const p = new PositionTracker();
    p.setFrame(FRAME, 0);
    p.onGps(...fix(0, 0), 20, 0);
    p.onGps(...fix(60, 0), 5, 1);                                   // 60 m in one second
    expect(p.estimate(1).x).toBeLessThanOrEqual(3.01);              // at most a jog's worth
    expect(p.estimate(1).x).toBeGreaterThan(2);
  });

  test('standing still under noisy indoor GPS barely moves', () => {
    const p = new PositionTracker();
    p.setFrame(FRAME, 0);
    p.onGps(...fix(0, 0), 20, 0);
    let seed = 7;
    const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 40; };
    let worstJump = 0, last = p.estimate(0);
    for (let t = 1; t <= 120; t++) {
      p.onGps(...fix(noise(), noise()), 20, t);                     // ±20 m scatter, one fix a second
      const e = p.estimate(t);
      // Early fixes are allowed to move it: that is the estimate converging.
      if (t > 60) worstJump = Math.max(worstJump, Math.hypot(e.x - last.x, e.y - last.y));
      last = e;
    }
    expect(Math.hypot(last.x, last.y)).toBeLessThan(6);             // averaged down, not wandering off
    expect(worstJump).toBeLessThan(0.6);                            // settled: fixes barely nudge it
  });

  test('moving without detected steps is still caught, just more slowly', () => {
    // Step detection can fail (phone damped on the gun). GPS alone must still
    // bring the estimate to where the player actually is.
    const p = new PositionTracker();
    p.setFrame(FRAME, 0);
    for (let t = 0; t <= 30; t++) p.onGps(...fix(0, 0), 15, t);     // settled at the start
    let seed = 3;
    const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed / 2147483648 - 0.5) * 20; };
    for (let t = 31; t <= 90; t++) p.onGps(...fix(25 + noise(), noise()), 15, t);   // now 25 m east, no steps seen
    const e = p.estimate(90);
    expect(e.x).toBeGreaterThan(17);
    expect(Math.abs(e.y)).toBeLessThan(6);
  });

  test('walking follows the steps and GPS corrects the drift', () => {
    const p = new PositionTracker();
    p.setFrame(FRAME, 0);
    p.onGps(...fix(0, 0), 5, 0);
    // Walk 30 m north at 2 steps a second, but the compass is 10° out.
    let t = 0;
    for (let i = 1; i <= 43; i++) {
      t = i * 0.5;
      p.onStep(10, t);
      if (i % 2 === 0) p.onGps(...fix(0, i * STEP_M), 5, t);        // truth: straight north
    }
    const e = p.estimate(t);
    expect(e.y).toBeGreaterThan(27);
    expect(Math.abs(e.x)).toBeLessThan(2.5);                        // uncorrected it would be 5 m off
  });

  test('with no map anchor, the first fix is taken as the start point', () => {
    const p = new PositionTracker();
    p.setFrame({ origin: null, rotation_deg: 0, start: [0, 0] }, 0);
    p.onGps(51.5, -0.12, 10, 1);
    expect(Math.hypot(p.estimate(1).x, p.estimate(1).y)).toBeLessThan(0.01);
    const [lat, lon] = fromLocal(0, 6, 51.5, -0.12, 0);
    p.onGps(lat, lon, 3, 30);
    expect(p.estimate(30).y).toBeGreaterThan(3);                    // later fixes move relative to it
  });

  test('the drawn position eases: quickly after a step, slowly after a GPS correction', () => {
    const p = new PositionTracker();
    p.setFrame(FRAME, 0);
    p.onGps(...fix(0, 0), 5, 0);
    p.view(0);
    p.onStep(0, 0.01);
    const soon = p.view(0.03).y, later = p.view(1.0).y;
    expect(soon).toBeGreaterThan(0);
    expect(soon).toBeLessThan(STEP_M * 0.5);
    expect(later).toBeCloseTo(STEP_M, 2);                           // a step is fully shown within a second

    const q = new PositionTracker();
    q.setFrame(FRAME, 0);
    q.onGps(...fix(0, 0), 10, 0);
    q.view(0);
    q.onGps(...fix(6, 0), 10, 2);                                   // estimate jumps ~3 m toward the fix
    const jumped = q.estimate(2).x;
    expect(jumped).toBeGreaterThan(2);
    expect(q.view(2.033).x).toBeLessThan(0.1);                      // ...but the picture has barely moved a frame later
    expect(q.view(2.5).x).toBeLessThan(jumped * 0.4);               // and is still gliding half a second on
    expect(q.view(10).x).toBeCloseTo(jumped, 1);
  });

  test('a rotated map turns GPS north into the right map direction', () => {
    const p = new PositionTracker();
    p.setFrame({ origin: ORIGIN, rotation_deg: 90, start: [0, 0] }, 0);   // plan "up" faces east
    const [lat, lon] = fromLocal(0, 20, ORIGIN[0], ORIGIN[1], 90);
    expect(toLocal(lat, lon, ORIGIN[0], ORIGIN[1], 0)[0]).toBeCloseTo(20, 1);  // 20 m east in the world
    p.onGps(lat, lon, 4, 1);
    expect(p.estimate(1).y).toBeCloseTo(20, 1);
  });
});

test.describe('orientation', () => {
  test('pitch from attitude: level in landscape either way round, down when flat', () => {
    expect(pitchFromAttitude(0, rad(90))).toBeCloseTo(0, 5);
    expect(pitchFromAttitude(0, rad(-90))).toBeCloseTo(0, 5);
    expect(pitchFromAttitude(0, 0)).toBeCloseTo(-90, 5);            // lying on a table, camera at the floor
    expect(pitchFromAttitude(0, rad(180))).toBeCloseTo(90, 5);      // face down, camera at the ceiling
    expect(pitchFromAttitude(0, rad(110))).toBeCloseTo(20, 5);      // tilted up 20°
    expect(pitchFromAttitude(0, rad(-110))).toBeCloseTo(20, 5);     // same tilt, other landscape
    expect(pitchFromAttitude(0, rad(75))).toBeCloseTo(-15, 5);
  });

  test('compass alone drives the heading when there is no motion sensor', () => {
    const o = new OrientationTracker();
    expect(o.get().heading).toBeNull();
    o.onCompass(40, 0);
    o.onCompass(200, 0.1);
    expect(o.get().heading).toBeCloseTo(200, 5);
  });

  test('attitude gives smooth turning; the compass only corrects drift', () => {
    const o = new OrientationTracker();
    o.onCompass(0, 0);
    o.onAttitude(0, 0, rad(90), 0);
    // Turn 60° clockwise over a second. iOS yaw runs counter-clockwise. The
    // compass follows, but 8° behind.
    for (let i = 1; i <= 60; i++) {
      o.onAttitude(rad(-i), 0, rad(90), i / 60);
      if (i % 6 === 0) o.onCompass(Math.max(0, i - 8), i / 60);
    }
    expect(Math.abs(angleDiffDeg(o.get().heading!, 60))).toBeLessThan(3);   // tracks the turn, not the laggy compass
    // A steady disagreement is slowly corrected.
    for (let i = 0; i < 200; i++) { o.onAttitude(rad(-60), 0, rad(90), 1.1 + i * 0.1); o.onCompass(52, 1.1 + i * 0.1); }
    expect(o.get().heading!).toBeCloseTo(52, 0);
  });

  test('learns a platform whose yaw runs the other way', () => {
    const o = new OrientationTracker();
    o.onCompass(0, 0);
    o.onAttitude(0, 0, rad(90), 0);
    let t = 0, yaw = 0, compass = 0;
    // Several real turns where yaw and compass both increase (clockwise-positive yaw).
    for (let turn = 0; turn < 6; turn++) {
      for (let i = 0; i < 30; i++) { t += 1 / 30; yaw += 1; compass += 1; o.onAttitude(rad(yaw), 0, rad(90), t); if (i % 5 === 4) o.onCompass(compass, t); }
    }
    expect(o.yawSign).toBe(1);
    const before = o.get().heading!;
    for (let i = 0; i < 20; i++) { t += 1 / 30; yaw += 1; o.onAttitude(rad(yaw), 0, rad(90), t); }
    expect(angleDiffDeg(o.get().heading!, before)).toBeCloseTo(20, 0);   // now turns the right way
  });

  test('a big disagreement snaps instead of crawling', () => {
    const o = new OrientationTracker();
    o.onCompass(10, 0);
    o.onAttitude(0, 0, rad(90), 0);
    o.onAttitude(0, 0, rad(90), 0.1);
    o.onCompass(200, 0.2);                                           // compass recalibrated
    expect(o.get().heading).toBeCloseTo(200, 5);
  });
});

test.describe('steps', () => {
  const G = 9.81;
  const feed = (d: StepDetector, signal: (t: number) => number, seconds: number, hz = 50, t0 = 0) => {
    let steps = 0;
    for (let i = 0; i < seconds * hz; i++) { const t = t0 + i / hz; if (d.onAccel(G + signal(t), t)) steps++; }
    return steps;
  };

  test('counts a walking rhythm', () => {
    const d = new StepDetector();
    feed(d, () => 0, 2);                                             // settle on gravity
    const steps = feed(d, (t) => 2.5 * Math.sin(2 * Math.PI * 1.8 * t), 10, 50, 2);
    expect(steps).toBeGreaterThanOrEqual(16);
    expect(steps).toBeLessThanOrEqual(19);                           // 1.8 Hz for 10 s
  });

  test('standing still, and slow aiming sway, are not steps', () => {
    const d = new StepDetector();
    expect(feed(d, (t) => 0.15 * Math.sin(40 * t), 10)).toBe(0);
    expect(feed(d, (t) => 0.5 * Math.sin(2 * Math.PI * 0.3 * t), 10, 50, 10)).toBe(0);
  });

  test('a short sharp jolt (the plunger firing) is not a step', () => {
    const d = new StepDetector();
    feed(d, () => 0, 2);
    const jolt = (t: number) => (t > 3 && t < 3.012 ? 30 : 0);       // 12 ms spike of 3 g
    expect(feed(d, jolt, 3, 200, 2)).toBe(0);
  });

  test('bumps are ignored while muted after a shot', () => {
    const d = new StepDetector();
    feed(d, () => 0, 2);
    d.mute(2.6);
    const bump = (t: number) => (t > 2.2 && t < 2.45 ? 3 : 0);
    expect(feed(d, bump, 1, 50, 2)).toBe(0);
  });
});

test.describe('zombies', () => {
  const cam = (over: Partial<Camera> = {}): Camera => ({ x: 0, y: 0, heading: 0, pitch: 0, width: 844, height: 390, hfov: 66, ...over });

  test('a zombie dead ahead is centred, feet below the horizon, head above', () => {
    const p = project(0, 10, cam())!;
    expect(p.sx).toBeCloseTo(422, 5);
    expect(p.off).toBeCloseTo(0, 5);
    expect(p.dist).toBeCloseTo(10, 5);
    expect(p.bottom).toBeGreaterThan(195);
    expect(p.top).toBeLessThan(195);
    const tall = p.bottom - p.top;
    const near = project(0, 5, cam())!;
    expect(near.bottom - near.top).toBeCloseTo(tall * 2, 3);         // half the distance, twice the size
  });

  test('left and right of the gun land left and right on screen; behind is not drawn', () => {
    expect(project(-3, 10, cam())!.sx).toBeLessThan(422);
    expect(project(3, 10, cam())!.sx).toBeGreaterThan(422);
    expect(project(10, 0, cam({ heading: 90 }))!.sx).toBeCloseTo(422, 5);   // turned to face it
    expect(project(0, -10, cam())).toBeNull();
    // The edge of a 66° field of view is the edge of the screen.
    const edge = project(Math.tan(rad(33)) * 10, 10, cam())!;
    expect(edge.sx).toBeCloseTo(844, 3);
  });

  test('tilting the gun up slides the world down the screen', () => {
    const level = project(0, 10, cam())!, up = project(0, 10, cam({ pitch: 10 }))!;
    expect(up.bottom).toBeGreaterThan(level.bottom + 50);
    expect(up.bottom - up.top).toBeCloseTo(level.bottom - level.top, 5);
  });

  test('the sprite box puts the head and feet exactly where the projection says', () => {
    const b = spriteBox(400, 100, 300);
    expect(b.top).toBeCloseTo(100, 5);
    expect(b.top + b.height).toBeCloseTo(300, 5);
    expect(b.left + b.width / 2).toBeCloseTo(400, 5);
  });

  test('every frame stands its zombie on the floor of the box, at the right height', () => {
    const SIZE = 180;                                                // a body box 180 px tall: 100 px per metre
    for (const kind of ZOMBIE_KINDS) {
      for (const clip of ['move', 'attack', 'die'] as const) {
        const sheet = ZOMBIE_SHEETS[kind][clip];
        const front = cellPlace(sheet, SIZE, 0, { row: 0, mirror: false });
        const what = `${kind} ${clip}`;
        // The floor line of the frame lands on the bottom of the box.
        expect(front.top + sheet.floorY * front.scale, what).toBeCloseTo(SIZE, 5);
        expect(front.scale * sheet.ppm, what).toBeCloseTo(100, 5);
        // From the front the frame is centred `side` metres off the body (a fallen zombie lies to one side).
        expect(front.left + front.width / 2 - (SIZE * FIGURE_ASPECT) / 2, what).toBeCloseTo(sheet.side * 100, 5);
        // From the side it is centred ahead of the feet, and mirrored it is the same distance the other way.
        const right = cellPlace(sheet, SIZE, 0, { row: 2, mirror: false }), left = cellPlace(sheet, SIZE, 0, { row: 2, mirror: true });
        expect(right.left + right.width / 2 - (SIZE * FIGURE_ASPECT) / 2, what).toBeCloseTo(sheet.forward * 100, 5);
        expect(left.left + left.width / 2 - (SIZE * FIGURE_ASPECT) / 2, what).toBeCloseTo(-sheet.forward * 100, 5);
        // Every frame of every angle is inside the sheet.
        const last = cellPlace(sheet, SIZE, sheet.frames - 1, { row: ZOMBIE_ANGLES.length - 1, mirror: false });
        expect((last.col + 1) * sheet.cw, what).toBeLessThanOrEqual(sheet.w);
        expect((last.line + 1) * sheet.ch, what).toBeLessThanOrEqual(sheet.h);
        // And a sheet is never bigger than a phone can hold as one texture.
        expect(Math.max(sheet.w, sheet.h), what).toBeLessThanOrEqual(2048);
      }
    }
  });

  test('a zombie is drawn from the side it is seen from', () => {
    // The viewer stands at the origin looking north at a zombie 10 m away.
    const turn = (heading: number) => turnOf(heading, 0, 10, 0, 0);
    expect(turn(180)).toBe(0);                                       // walking south: straight at the viewer
    expect(turn(0)).toBe(180);                                       // walking away
    expect(turn(90)).toBe(90);                                       // walking east: turned to the viewer's right
    expect(turn(270)).toBe(-90);
    expect(facing(0)).toEqual({ row: 0, mirror: false });
    expect(facing(40)).toEqual({ row: 1, mirror: false });
    expect(facing(-40)).toEqual({ row: 1, mirror: true });           // the other side is the same frame flipped
    expect(facing(-90)).toEqual({ row: 2, mirror: true });
    expect(facing(170)).toEqual({ row: 4, mirror: false });
    expect(facing(-175)).toEqual({ row: 4, mirror: false });         // square on from behind: nothing to flip
    expect(facing(-10)).toEqual({ row: 0, mirror: false });
    // Hovering on the line between two angles, it keeps the one it had.
    expect(facing(24)).toEqual({ row: 1, mirror: false });
    expect(facing(24, { row: 0, mirror: false })).toEqual({ row: 0, mirror: false });
    expect(facing(21, { row: 1, mirror: false })).toEqual({ row: 1, mirror: false });
    expect(facing(35, { row: 0, mirror: false })).toEqual({ row: 1, mirror: false });
  });

  test('animations loop, except the fall, which plays once and stays down', () => {
    const walk = ZOMBIE_SHEETS.walker.move, fall = ZOMBIE_SHEETS.walker.die;
    expect(frameAt(walk, 0)).toBe(0);
    expect(frameAt(walk, walk.seconds / 2)).toBe(walk.frames / 2);
    expect(frameAt(walk, walk.seconds * 7 + 0.001)).toBe(0);
    expect(frameAt(walk, -0.001)).toBe(walk.frames - 1);
    expect(frameAt(fall, 0)).toBe(0);
    expect(frameAt(fall, fall.seconds * 5)).toBe(fall.frames - 1);
    expect(fall.seconds).toBeCloseTo(DEATH_FX_S, 5);                 // the fall lasts as long as the corpse does
  });

  test('the crosshair is on a zombie only when it really is', () => {
    const aim = { x: 0, y: 0, heading: 0, pitch: 0 };
    expect(underCrosshair({ x: 0, y: 10 }, aim, 2, 35)).toEqual({ dist: 10 });
    expect(underCrosshair({ x: 0.5, y: 10 }, aim, 2, 35)).not.toBeNull();   // within body width + spread
    expect(underCrosshair({ x: 1.5, y: 10 }, aim, 2, 35)).toBeNull();       // clearly beside it
    expect(underCrosshair({ x: 0, y: 40 }, aim, 2, 35)).toBeNull();         // out of range
    expect(underCrosshair({ x: 0, y: 10 }, { ...aim, pitch: 30 }, 2, 35)).toBeNull();   // aiming at the ceiling
    expect(underCrosshair({ x: 0, y: 10 }, { ...aim, pitch: -30 }, 2, 35)).toBeNull();  // ...or the floor
    expect(underCrosshair({ x: 0, y: 2 }, { ...aim, pitch: -20 }, 2, 35)).not.toBeNull(); // a close one fills the view
  });

  test('what you can hit is what is drawn under the centre of the screen', () => {
    // Sweep the gun across a zombie: "on target" must coincide with the
    // sprite's body overlapping the screen centre.
    const z = { x: 2, y: 12 };
    for (let h = -5; h <= 25; h += 0.5) {
      const c = cam({ heading: h });
      const p = project(z.x, z.y, c)!;
      const bodyHalfPx = ((p.bottom - p.top) / 1.8) * 0.35;
      const centred = Math.abs(p.sx - 422) <= bodyHalfPx;
      const hit = underCrosshair(z, { x: 0, y: 0, heading: h, pitch: 0 }, 0, 35) != null;
      if (centred !== hit) expect(Math.abs(Math.abs(p.sx - 422) - bodyHalfPx)).toBeLessThan(6);   // only at the very edge
    }
  });

  test('nearest zombie under the crosshair comes first', () => {
    const zs = [{ id: 1, x: 0, y: 20 }, { id: 2, x: 0, y: 8 }, { id: 3, x: 6, y: 8 }];
    expect(pickTargets(zs, { x: 0, y: 0, heading: 0, pitch: 0 }, { spread_deg: 2, range_m: 35 })).toEqual([2, 1]);
  });

  test('snapshots are drawn 100 ms late, sliding between positions', () => {
    const b = new ZombieBuffer();
    b.push(10.0, [[1, 0, 0, 10, 6, 1, 'a']]);
    b.push(10.1, [[1, 0, 0, 9, 6, 1, 'a']]);
    b.push(10.2, [[1, 0, 0, 8, 4, 2, 'a'], [2, 0, 5, 5, 6, 1, 'a']]);
    expect(b.sample(10.15)[0].y).toBeCloseTo(9.5, 5);               // halfway between the first two
    const now = b.sample(10.25);
    const one = now.find((z) => z.id === 1)!, two = now.find((z) => z.id === 2)!;
    expect(one.y).toBeCloseTo(8.5, 5);
    expect(one.hp).toBe(4);
    expect(one.maxHp).toBe(6);                                       // remembers full health
    expect(two.x).toBe(5);                                           // newcomer: no earlier position to slide from
    expect(b.sample(99).find((z) => z.id === 1)!.y).toBe(8);        // server stalled: hold the last position
    expect(b.latest().length).toBe(2);
  });

  test('a kill removes the zombie at once and leaves a short-lived corpse', () => {
    const b = new ZombieBuffer();
    b.push(10.0, [[1, 0, 0, 10, 6, 1, 'a']]);
    b.push(10.1, [[1, 0, 0, 9, 6, 1, 'a']]);
    b.onHit(1, 10.12);
    expect(b.sample(10.15)[0].hitAge).toBeCloseTo(0.03, 5);
    b.onKill(1, 0, 9, 10.15);
    expect(b.sample(10.16)).toEqual([]);
    expect(b.dying(10.3)).toHaveLength(1);
    expect(b.dying(10.3)[0].age).toBeCloseTo(0.15 / DEATH_FX_S, 2);
    expect(b.dying(10.3)[0].heading).toBe(180);                      // it was walking south, and falls that way round
    expect(b.dying(11)).toHaveLength(0);
  });

  test('a zombie faces the way it walks, and holds that when it stops to bite', () => {
    const b = new ZombieBuffer();
    b.push(1.0, [[1, 0, 0, 10, 6, Z_CHASE, 'a']]);
    expect(b.sample(1.05)[0].heading).toBeNull();                    // not seen to move yet
    b.push(1.1, [[1, 0, 0.12, 10, 6, Z_CHASE, 'a']]);
    expect(b.sample(1.15)[0].heading).toBeCloseTo(90, 5);            // east
    b.push(1.2, [[1, 0, 0.125, 10, 6, Z_CHASE, 'a']]);               // barely moved: no new opinion
    expect(b.sample(1.25)[0].heading).toBeCloseTo(90, 5);
    b.push(1.3, [[1, 0, 0.125, 9.8, 6, Z_ATTACK, 'a']]);             // shoved while biting: not a turn
    expect(b.sample(1.35)[0].heading).toBeCloseTo(90, 5);
    b.push(1.4, [[1, 0, 0.125, 9.68, 6, Z_CHASE, 'a']]);             // off again, south: it comes round, not all at once
    const h = b.sample(1.45)[0].heading!;
    expect(h).toBeGreaterThan(90);
    expect(h).toBeLessThan(180);
  });
});

// ------------------------------------------------------------------ design system

import { FORMATION, FORMATION_MICRO, MARK_SIZE, WORDMARK } from '../src/brand/geometry';
import { clock, extractionLine, healthPct, normalizeCode } from '../src/game/format';
import { MARKER_SHAPES, identityForSlot, identityOf } from '../src/game/identity';
import { PLAYER_COLORS, colors, contrast, hud, luminance, touch, type as typeScale } from '../src/theme';

/** `rgba(r,g,b,a)` laid over an opaque colour, as an opaque `#RRGGBB`. */
function over(rgba: string, base: string): string {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number);
  const n = parseInt(base.slice(1), 16);
  const mix = (top: number, under: number) => Math.round(top * a + under * (1 - a));
  return '#' + [mix(r, (n >> 16) & 255), mix(g, (n >> 8) & 255), mix(b, n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

test.describe('contrast', () => {
  const AA = 4.5, LARGE = 3;
  const WHITE = '#FFFFFF';

  test('text on the solid surfaces meets WCAG AA', () => {
    for (const surface of [colors.background, colors.surface, colors.surfaceElevated, colors.surfaceOverlay]) {
      expect(contrast(colors.textPrimary, surface), `primary on ${surface}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(colors.textSecondary, surface), `secondary on ${surface}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(colors.status.health, surface), `ready on ${surface}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(colors.status.dangerText, surface), `small red text on ${surface}`).toBeGreaterThanOrEqual(AA);
      expect(contrast(colors.brand.amber, surface), `amber on ${surface}`).toBeGreaterThanOrEqual(AA);
    }
    // Muted is for tertiary labels only, and still clears the large-text bar where it is used.
    for (const surface of [colors.background, colors.surface, colors.surfaceOverlay]) {
      expect(contrast(colors.textMuted, surface), `muted on ${surface}`).toBeGreaterThanOrEqual(LARGE);
    }
  });

  test('labels on filled buttons meet AA', () => {
    expect(contrast(colors.brand.onAmber, colors.brand.amber)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.brand.onAmber, colors.brand.amberPressed)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.status.onDanger, colors.status.dangerSurface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.status.onDanger, colors.status.dangerPressed)).toBeGreaterThanOrEqual(AA);
  });

  test('status colours used for icons, bars and large text clear 3:1', () => {
    for (const c of [colors.status.danger, colors.status.health, colors.status.objective, colors.status.ammo, colors.status.neutral, colors.borderStrong]) {
      expect(contrast(c, colors.background), `${c} on the background`).toBeGreaterThanOrEqual(LARGE);
    }
  });

  test('HUD plates keep text readable over a pure white scene, the worst the camera can do', () => {
    // A plate for critical (bone) text.
    expect(contrast(colors.textPrimary, over(colors.camera.backing, WHITE))).toBeGreaterThanOrEqual(AA);
    // A strong plate also carries secondary text and coloured marks.
    const strong = over(colors.camera.backingStrong, WHITE);
    expect(contrast(colors.textPrimary, strong)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.textSecondary, strong)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.status.health, strong)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.status.objective, strong)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.status.danger, strong)).toBeGreaterThanOrEqual(LARGE);
    // Glass without blur falls back to a plate that is at least as dark.
    expect(contrast(colors.textPrimary, over(colors.camera.glassFallback, WHITE))).toBeGreaterThanOrEqual(AA);
    // And over a dark scene nothing is lost either.
    expect(contrast(colors.textPrimary, over(colors.camera.backing, '#000000'))).toBeGreaterThanOrEqual(AA);
  });

  test('zombies read on light and on dark', () => {
    // Contrast between two luminances, as WCAG has it.
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    for (const kind of ZOMBIE_KINDS) {
      // The figure itself, as rendered: lit enough to stand off the darkest scene, dark enough for a white wall.
      for (const clip of ['move', 'attack'] as const) {
        const lit = ZOMBIE_SHEETS[kind][clip].luminance;
        expect(ratio(lit, luminance(colors.background)), `${kind} ${clip} in the dark`).toBeGreaterThanOrEqual(LARGE);
        expect(ratio(lit, luminance(WHITE)), `${kind} ${clip} on white`).toBeGreaterThanOrEqual(AA);
      }
      // Its type colour (the outline under the crosshair, the edge markers) against the dark edge it sits on.
      expect(contrast(colors.zombies[kind], colors.zombies.body), `${kind} colour on the dark edge`).toBeGreaterThanOrEqual(LARGE);
    }
    expect(contrast(colors.zombies.body, colors.sample.bright)).toBeGreaterThanOrEqual(7);
  });

  test('player identities: four colours that stand off the background, and four different shapes', () => {
    expect(new Set(PLAYER_COLORS).size).toBe(4);
    for (const c of PLAYER_COLORS) {
      expect(contrast(c, colors.background)).toBeGreaterThanOrEqual(AA);
      expect(contrast(colors.background, c), 'the slot number on the marker').toBeGreaterThanOrEqual(AA);
    }
    expect(new Set(MARKER_SHAPES).size).toBe(4);
    const zombieCues = [colors.zombies.walker, colors.zombies.runner, colors.zombies.brute, colors.zombies.boss] as string[];
    // No zombie type borrows a player's colour.
    for (const c of PLAYER_COLORS) expect(zombieCues).not.toContain(c);
  });
});

test.describe('type and touch', () => {
  test('nothing on the HUD is set smaller than 12 points, and critical values are far larger', () => {
    for (const [name, step] of Object.entries(typeScale)) {
      if (name.startsWith('hud')) expect(step.fontSize, name).toBeGreaterThanOrEqual(12);
    }
    expect(typeScale.hudHero.fontSize).toBeGreaterThanOrEqual(36);
    expect(typeScale.hudPrimary.fontSize).toBeGreaterThanOrEqual(28);
    expect(typeScale.hudValue.fontSize).toBeGreaterThanOrEqual(22);
    expect(typeScale.hudLabel.fontSize).toBeGreaterThanOrEqual(16);
  });

  test('touch targets meet the minimums', () => {
    expect(touch.min).toBeGreaterThanOrEqual(44);
    expect(touch.hud).toBeGreaterThanOrEqual(56);
    expect(touch.fire).toBeGreaterThanOrEqual(touch.hud);
    expect(touch.reload).toBeGreaterThanOrEqual(touch.hud);
    expect(hud.reference).toEqual({ width: 844, height: 390 });
  });
});

test.describe('identity', () => {
  test('a player keeps their slot, colour and shape wherever they appear', () => {
    const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(roster.map((p) => identityOf(p.id, roster).label)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(identityOf('c', roster)).toEqual(identityForSlot(2));
    expect(identityOf('c', roster).color).toBe(colors.players.three);
    // Someone the roster does not know yet falls back to the first slot rather than crashing.
    expect(identityOf('zz', roster).slot).toBe(0);
    expect(identityOf(undefined, roster).slot).toBe(0);
  });
});

test.describe('what the screen says', () => {
  test('a mission code is four capitals or digits, however it was typed or pasted', () => {
    expect(normalizeCode('abcd')).toBe('ABCD');
    expect(normalizeCode(' 7f-3k ')).toBe('7F3K');
    expect(normalizeCode('abcdefg')).toBe('ABCD');
    expect(normalizeCode('a!b')).toBe('AB');
    expect(normalizeCode('')).toBe('');
  });

  test('health is a whole percentage', () => {
    expect(healthPct(8, 8)).toBe(100);
    expect(healthPct(7, 8)).toBe(88);
    expect(healthPct(0, 8)).toBe(0);
    expect(healthPct(-1, 8)).toBe(0);
    expect(healthPct(3, 0)).toBe(0);
  });

  test('mission time reads as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(754)).toBe('12:34');
  });

  test('the extraction line counts the holders and says what is missing', () => {
    expect(extractionLine(0, 2, 0)).toBe('0 of 2 holding. Press and hold to extract.');
    expect(extractionLine(1, 2, 0)).toBe('1 of 2 holding. Need one more.');
    expect(extractionLine(2, 2, 0.4)).toBe('2 of 2 holding. Cover them.');
    expect(extractionLine(1, 2, 0.4)).toBe('Paused. 1 of 2 holding. Need one more.');   // someone let go
    expect(extractionLine(0, 2, 0.4)).toBe('Paused. 0 of 2 holding.');
    expect(extractionLine(1, 1, 0.1)).toBe('1 of 1 holding. Cover them.');              // the last one standing
    expect(extractionLine(1, 3, 0)).toBe('1 of 3 holding. Need two more.');
  });
});

test.describe('brand marks', () => {
  const pts = (s: string) => s.split(' ').map((p) => p.split(',').map(Number) as [number, number]);

  test('the Formation is four identical segments, each a quarter turn from the last', () => {
    for (const mark of [FORMATION, FORMATION_MICRO]) {
      expect(mark).toHaveLength(4);
      const first = pts(mark[0]);
      mark.forEach((segment, q) => {
        let turned = first;
        for (let i = 0; i < q; i++) turned = turned.map(([x, y]) => [MARK_SIZE - y, x]);
        expect(pts(segment)).toEqual(turned);
        for (const [x, y] of pts(segment)) {
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(MARK_SIZE);
          expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(MARK_SIZE);
        }
      });
    }
  });

  test('the segments leave the centre open', () => {
    // No vertex of any segment comes inside the central void.
    for (const segment of FORMATION) {
      for (const [x, y] of pts(segment)) expect(Math.abs(x - 60) + Math.abs(y - 60)).toBeGreaterThanOrEqual(19);
    }
  });

  test('the wordmark is one closed path, about five times as wide as it is tall', () => {
    expect(WORDMARK.height).toBe(100);
    expect(WORDMARK.width / WORDMARK.height).toBeGreaterThan(4.5);
    expect(WORDMARK.width / WORDMARK.height).toBeLessThan(5.6);
    // Seven letters, plus the counters of the O and the two Rs.
    expect(WORDMARK.d.match(/M/g)).toHaveLength(10);
    expect(WORDMARK.d.match(/Z/g)).toHaveLength(10);
  });
});

test.describe('the horde, heard', () => {
  test('silent out of earshot, louder the nearer it is, full at arm\'s length', () => {
    expect(hordeVoice(EARSHOT_M + 5, 0).volume).toBe(0);
    expect(hordeVoice(EARSHOT_M, 0).volume).toBe(0);
    const far = hordeVoice(20, 0).volume, mid = hordeVoice(10, 0).volume, near = hordeVoice(4, 0).volume;
    expect(far).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(far * 3);            // the last few metres do the shouting
    expect(near).toBeGreaterThan(mid);
    expect(hordeVoice(FULL_AT_M, 0).volume).toBe(1);
    expect(hordeVoice(0.5, 0).volume).toBe(1);
  });

  test('Doppler: pitch rises as it closes, falls as it drops behind, and holds still when nothing moves', () => {
    expect(hordeVoice(10, 0).rate).toBe(1);
    const walkingIn = hordeVoice(10, 1.2).rate, bothWalking = hordeVoice(10, 2.7).rate;
    expect(walkingIn).toBeGreaterThan(1.05);           // a zombie at walking pace is plainly audible
    expect(bothWalking).toBeGreaterThan(walkingIn);
    expect(hordeVoice(10, -1.2).rate).toBeLessThan(0.95);
    // However fast, it stays a groan: never a squeak, never a slur.
    expect(hordeVoice(10, 50).rate).toBeLessThanOrEqual(RATE_MAX);
    expect(hordeVoice(10, -50).rate).toBeGreaterThanOrEqual(RATE_MIN);
    // How loud is about distance alone.
    expect(hordeVoice(10, 3).volume).toBe(hordeVoice(10, -3).volume);
  });

  test('the nearest zombie is the one that is heard', () => {
    expect(nearestDistance([], 0, 0)).toBeNull();
    expect(nearestDistance([{ x: 30, y: 0 }, { x: 3, y: 4 }, { x: -9, y: 0 }], 0, 0)).toBe(5);
  });

  test('a zombie walking in is heard closing; one walking away is heard leaving', () => {
    const ear = new HordeEar();
    let v = ear.hear(20, 0)!;
    expect(v.rate).toBe(1);                            // one reading: no speed yet
    for (let i = 1; i <= 30; i++) v = ear.hear(20 - 1.2 * i * 0.1, i * 0.1)!;      // three seconds at 1.2 m/s
    expect(v.rate).toBeGreaterThan(1.07);
    expect(v.rate).toBeLessThan(1.11);                 // settles on the walking-pace shift, no overshoot
    for (let i = 1; i <= 30; i++) v = ear.hear(16.4 + 1.2 * i * 0.1, 3 + i * 0.1)!;
    expect(v.rate).toBeLessThan(0.95);
  });

  test('a jump in distance is not speed: the nearest one dying, or GPS moving the player', () => {
    const ear = new HordeEar();
    for (let i = 0; i <= 20; i++) ear.hear(4, i * 0.1);                             // standing still beside one
    const still = ear.hear(4, 2.1)!;
    expect(still.rate).toBeCloseTo(1, 2);
    const next = ear.hear(15, 2.2)!;                   // it dies; the next nearest is 15 m off
    expect(next.rate).toBeCloseTo(1, 2);
    expect(next.volume).toBeLessThan(still.volume);
  });

  test('nothing in earshot is silence, and coming back into earshot starts from rest', () => {
    const ear = new HordeEar();
    for (let i = 0; i <= 10; i++) ear.hear(10 - i * 0.3, i * 0.1);                  // closing fast
    expect(ear.hear(null, 1.1)).toBeNull();
    expect(ear.hear(EARSHOT_M + 1, 1.2)).toBeNull();
    expect(ear.hear(12, 1.3)!.rate).toBe(1);
  });
});
