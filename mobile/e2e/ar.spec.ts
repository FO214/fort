/**
 * AR tracking through the real app: a simulated AR session (sensors/index.ts,
 * `sim.arPose`) sees one of the map's printed markers, and from then on the
 * phone stands where AR says, not where GPS does. Walls still hide zombies.
 */
import { test, expect, type Page } from '@playwright/test';
import { wallBetween, type Wall } from '../src/game/zombies';
import { createSquad, intoMission, phone, startMission, world } from './helpers';

/** Keep the pretend AR session reporting a pose, as a real one does every frame. */
const holdAr = (page: Page, x: number, y: number, heading: number) =>
  page.evaluate(([x, y, heading]) => {
    const w = window as unknown as { __arHold?: number };
    if (w.__arHold) clearInterval(w.__arHold);
    window.__loonieSim!.arPose(x, y, heading);
    w.__arHold = window.setInterval(() => window.__loonieSim!.arPose(x, y, heading), 100);
  }, [x, y, heading]);

test('a marker puts the phone on the map, and walls still hide zombies', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  await createSquad(ada);
  await ada.page.getByTestId('map-schmeichel').click();
  await startMission([ada]);
  await intoMission(ada);

  const map = await ada.page.evaluate(() => window.__loonieStore!.getState().map as {
    start: [number, number]; walls: Wall[]; anchors: { id: string }[];
  });
  expect(map.anchors.map((a) => a.id)).toEqual(['cafe', 'atrium']);

  // GPS has the phone 100 km away (the simulator's default fix). AR, once it has seen a marker, knows better.
  const [sx, sy] = map.start;
  await holdAr(ada.page, sx, sy, 90);
  const pose = (await world(ada.page)).me;
  expect(pose.x).toBeCloseTo(sx, 3);
  expect(pose.y).toBeCloseTo(sy, 3);
  expect(pose.heading).toBeCloseTo(90, 3);
  expect(pose.acc).toBe(0.3);
  await expect(ada.page.getByTestId('hint')).toHaveCount(0);       // no "not at Schmeichel": AR says it is

  // Turn to each zombie in turn. One in the open is drawn; one behind a wall never is.
  await expect.poll(async () => (await world(ada.page)).zombies.length, { timeout: 20_000 }).toBeGreaterThan(0);
  let drawnInOpen = 0;
  for (let i = 0; i < 25 && drawnInOpen < 2; i++) {
    const w = await world(ada.page);
    const z = w.zombies[i % w.zombies.length];
    if (!z) continue;
    await holdAr(ada.page, sx, sy, z.bearing);
    await ada.page.waitForTimeout(250);
    const now = await world(ada.page);
    const drawn = new Set(await ada.page.evaluate(() => window.__loonieAR!.items.map((it) => it.id)));
    for (const q of now.zombies) {
      if (wallBetween(sx, sy, q.x, q.y, map.walls)) expect(drawn.has(q.id), `zombie ${q.id} is behind a wall`).toBe(false);
    }
    const seen = now.zombies.find((q) => q.id === z.id);
    if (seen && seen.dist > 2 && seen.dist < 60 && !wallBetween(sx, sy, seen.x, seen.y, map.walls) && drawn.has(seen.id)) drawnInOpen++;
  }
  expect(drawnInOpen, 'a zombie in the open was drawn').toBeGreaterThan(0);

  // AR goes quiet (tracking lost): the phone falls back to GPS and steps, from where AR last had it.
  await ada.page.evaluate(() => clearInterval((window as unknown as { __arHold: number }).__arHold));
  await ada.page.waitForTimeout(1300);
  const after = (await world(ada.page)).me;
  expect(after.acc).not.toBe(0.3);
  expect(Math.hypot(after.x - sx, after.y - sy)).toBeLessThan(1);
  await ada.ctx.close();
});
