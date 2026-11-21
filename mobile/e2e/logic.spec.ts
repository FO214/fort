/**
 * The phone's pure game logic, no browser: position fusion, orientation,
 * step detection, and the projection/aiming maths.
 */
import { test, expect } from '@playwright/test';
import { fromLocal, toLocal, angleDiffDeg } from '../src/game/geo';
import { OrientationTracker, pitchFromAttitude } from '../src/game/orientation';
import { PositionTracker, STEP_M } from '../src/game/position';
import { StepDetector } from '../src/game/steps';
import { ZombieBuffer, pickTargets, project, underCrosshair, type Camera } from '../src/game/zombies';
import { spriteBox } from '../src/ui/spriteBox';

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
    // Head top is 21 units below the view-box top, feet 196 of 204 units down.
    expect(b.top + (21 / 204) * b.height).toBeCloseTo(100, 5);
    expect(b.top + (196 / 204) * b.height).toBeCloseTo(300, 5);
    expect(b.left + (64 / 124) * b.width).toBeCloseTo(400, 5);
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
    expect(b.dying(10.3)[0].age).toBeCloseTo(0.25, 2);
    expect(b.dying(11)).toHaveLength(0);
  });
});
