/**
 * Simulated phones play through the real app against a real server.
 * Screenshots of every screen land in e2e/output/.
 */
import { test, expect } from '@playwright/test';
import {
  LANDSCAPE, PORTRAIT, abortMission, createSquad, faceNearest, fightUntil, holdDown, hud, intoMission, joinSquad, me, phone, place,
  release, shot, startMission, walkTo, world,
} from './helpers';

const WAVE_1 = 5;      // a four-player first wave under the e2e pacing in playwright.config.ts

test('four phones fight a wave together', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  await shot(ada.page, '01-menu');
  const code = await createSquad(ada);

  const bo = await phone(browser, 'Bo');
  const cy = await phone(browser, 'Cy');
  const di = await phone(browser, 'Di');
  await bo.page.getByTestId('join').click();
  await shot(bo.page, '02-join');
  await bo.page.getByTestId('back').click();
  for (const p of [bo, cy, di]) await joinSquad(p, code);
  for (const n of ['Ada', 'Bo', 'Cy', 'Di']) await expect(ada.page.getByTestId(`player-${n}`)).toBeVisible();

  // Loadouts and ready. The lobby already has a GPS fix.
  await bo.page.getByTestId('class-smg').click();
  await di.page.getByTestId('class-rifle').click();
  await expect(ada.page.getByTestId('player-Bo')).toContainText('SMG');
  await expect(ada.page.getByTestId('player-Di')).toContainText('Rifle');
  await expect(ada.page.getByTestId('class-pistol')).toHaveAttribute('aria-checked', 'true');      // the default, marked as selected
  await expect(ada.page.getByTestId('gps')).toContainText('GPS ±3 m');

  // Start stays off, and says why, until everyone connected is ready.
  await expect(ada.page.getByTestId('start')).toBeDisabled();
  await expect(ada.page.getByTestId('start-why')).toContainText('Waiting for 4 players');
  for (const p of [ada, bo, cy]) await p.page.getByTestId('ready').click();
  await expect(ada.page.getByTestId('start')).toBeDisabled();
  await expect(ada.page.getByTestId('start-why')).toContainText('Waiting for Di');
  await expect(ada.page.getByTestId('player-Di')).toContainText('Not ready');
  await shot(di.page, '03-lobby-guest-not-ready');
  await di.page.getByTestId('ready').click();
  await expect(ada.page.getByTestId('player-Di')).toContainText('Ready');
  await expect(ada.page.getByTestId('start')).toBeEnabled();
  await shot(ada.page, '03-lobby-host');
  await cy.page.setViewportSize(LANDSCAPE);                 // a phone already on its gun
  await shot(cy.page, '03-lobby-guest-landscape');
  await cy.page.setViewportSize(PORTRAIT);

  // Only the host can start.
  await expect(bo.page.getByTestId('start')).toHaveCount(0);
  await ada.page.getByTestId('start').click();
  const squad = [ada, bo, cy, di];
  for (const p of squad) await intoMission(p);

  // Each phone has its own position. Stand in a loose group facing north.
  await place(ada.page, 0, 0);
  await place(bo.page, 3, 0);
  await place(cy.page, 0, 3);
  await place(di.page, -3, 0);
  await expect(ada.page.getByTestId('squad')).toContainText('Bo');
  await expect(ada.page.getByTestId('hint')).toHaveCount(0);       // GPS and compass are both live
  await shot(ada.page, '04-game-quiet');

  // Wave 1: the same zombies on every phone.
  await expect.poll(() => hud.wave(ada.page), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => hud.zombiesLeft(ada.page)).toBe(WAVE_1);
  await expect.poll(async () => (await world(bo.page)).zombies.length).toBe(WAVE_1);
  const seenByAda = (await world(ada.page)).zombies.map((z) => z.id).sort();
  const seenByDi = (await world(di.page)).zombies.map((z) => z.id).sort();
  expect(seenByDi).toEqual(seenByAda);

  // Ada swings onto the nearest one: the sight closes on it.
  const target = (await faceNearest(ada.page))!;
  await expect(ada.page.locator('[data-testid=reticle][aria-label="on target"]')).toBeVisible();
  await expect(ada.page.getByTestId(`zombie-${target.id}`)).toBeVisible();
  const drawn = await ada.page.evaluate((id) => window.__loonieAR!.items.find((i) => i.id === id), target.id);
  expect(Math.abs(drawn!.x - LANDSCAPE.width / 2)).toBeLessThan(12);          // drawn right under the crosshair
  expect(drawn!.aimed).toBe(true);
  await shot(ada.page, '05-game-on-target');

  // Turn away: nothing under the sight, and a shot is just a miss.
  await ada.page.evaluate((b) => window.__loonieSim!.aim(b + 150), target.bearing);
  await expect(ada.page.locator('[data-testid=reticle][aria-label="no target"]')).toBeVisible();
  const before = await hud.ammo(ada.page);
  await ada.page.getByTestId('fire').click();
  await expect.poll(() => hud.ammo(ada.page)).toBe(before - 1);
  await expect(ada.page.getByTestId('shot-hit')).toHaveCount(0);

  // Back on target: a hit.
  await ada.page.waitForTimeout(450);
  await faceNearest(ada.page);
  await expect(ada.page.locator('[data-testid=reticle][aria-label="on target"]')).toBeVisible();
  await ada.page.getByTestId('fire').click();
  await expect(ada.page.getByTestId('shot-hit').or(ada.page.getByTestId('shot-kill'))).toBeVisible();
  await shot(ada.page, '06-game-hit');

  // Let them close in for a look at a crowd up close.
  await expect.poll(async () => (await world(cy.page)).zombies[0]?.dist ?? 99, { timeout: 15_000, intervals: [100] }).toBeLessThan(6);
  await faceNearest(cy.page);
  await cy.page.waitForTimeout(150);
  await shot(cy.page, '07-game-zombies-close');

  // Turn her back on them: a zombie in reach but out of view is marked on the edge of the screen it is on.
  const behind = (await world(cy.page)).zombies[0];
  await cy.page.evaluate((b) => window.__loonieSim!.aim(b + 110), behind.bearing);
  await expect(cy.page.getByTestId('threat-left').first()).toBeVisible();
  await shot(cy.page, '07-game-threat-markers');

  // The whole squad opens fire until the wave is down. The banner says so, briefly.
  // Seeing the banner also counts as "cleared": the zombie count is only zero for
  // the short rest before the next wave, which a slow loop can miss.
  let waveDown = false;
  const sawCleared = expect(ada.page.getByTestId('banner')).toContainText('Wave 1 cleared', { timeout: 60_000 })
    .then(() => { waveDown = true; });
  const cleared = async () => waveDown || (await hud.zombiesLeft(ada.page)) === 0;
  await Promise.all([
    fightUntil(ada.page, cleared),
    fightUntil(bo.page, cleared, { everyMs: 130 }),           // Light: fast and weak
    fightUntil(cy.page, cleared),
    fightUntil(di.page, cleared, { everyMs: 850 }),           // Heavy: slow and strong
  ]);
  await sawCleared;
  // Every kill is credited to someone. (The next wave may already have lost a zombie or two.)
  const kills = await Promise.all(squad.map((p) => hud.kills(p.page)));
  expect(kills.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(WAVE_1);
  await shot(ada.page, '08-game-wave-cleared');

  // Reload from the HUD.
  if ((await hud.ammo(ada.page)) === 10) await ada.page.getByTestId('fire').click();
  await expect.poll(() => hud.ammo(ada.page)).toBeLessThan(10);
  await ada.page.getByTestId('reload').click();
  await expect(ada.page.getByTestId('ammo-panel')).toContainText('Reloading');
  await expect.poll(() => hud.ammo(ada.page), { timeout: 6_000 }).toBe(10);

  // The mission menu. Only the host can end the mission for everyone, and it asks twice.
  await bo.page.getByTestId('hud-menu').click();
  await expect(bo.page.getByTestId('leave')).toBeVisible();
  await expect(bo.page.getByTestId('abort')).toHaveCount(0);
  await bo.page.getByTestId('sheet-close').click();
  await ada.page.getByTestId('hud-menu').click();
  await shot(ada.page, '08-mission-menu');
  await ada.page.getByTestId('abort').click();
  await shot(ada.page, '08-abort-confirm');
  await ada.page.getByTestId('abort-confirm').click();
  for (const p of squad) await expect(p.page.getByTestId('roster')).toBeVisible();
  await shot(ada.page, '09-lobby-after-abort-landscape');

  for (const p of squad) await p.ctx.close();
});

test('full mission: knocked and revived, reach the helicopter, hold, two extract while two defend', async ({ browser }) => {
  test.setTimeout(180_000);
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  const cy = await phone(browser, 'Cy');
  const di = await phone(browser, 'Di');
  for (const p of [bo, cy, di]) await joinSquad(p, code);
  await expect(ada.page.getByTestId('player-Di')).toBeVisible();
  const squad = [ada, bo, cy, di];
  await startMission(squad);
  for (const p of squad) await intoMission(p);

  // ---- Journey. Three stay together; Di wanders off alone and does not shoot.
  await place(ada.page, 0, 0);
  await place(bo.page, 3, 0);
  await place(cy.page, 0, 3);
  await place(di.page, 18, -18);
  await expect(ada.page.getByTestId('objective')).toContainText('Reach the helicopter');
  await expect(ada.page.getByTestId('heli-dist')).toHaveText('30 m');            // it is 30 m north of the start
  await expect(di.page.getByTestId('heli-dist')).toHaveText('51 m');
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);                  // "We're here" waits until the host is close
  await ada.page.getByTestId('hud-menu').click();                                // ...but is always in the host's mission menu
  await expect(ada.page.getByTestId('arrived-menu')).toBeVisible();
  await ada.page.getByTestId('sheet-close').click();
  await shot(ada.page, '10-journey-objective');

  const diDown = () => di.page.getByTestId('knocked').isVisible();
  await Promise.all([
    fightUntil(ada.page, diDown, { want: 'mine', timeoutMs: 90_000 }),
    fightUntil(bo.page, diDown, { want: 'mine', everyMs: 420, timeoutMs: 90_000 }),
    fightUntil(cy.page, diDown, { want: 'mine', everyMs: 440, timeoutMs: 90_000 }),
    (async () => {
      await expect.poll(() => hud.hp(di.page), { timeout: 60_000, intervals: [50] }).toBeLessThan(100);
      await shot(di.page, '11-bitten');                                           // red flash + direction wedge
    })(),
  ]);

  // ---- Di is knocked: she cannot shoot and her bleed-out bar is showing.
  await expect(di.page.getByTestId('hp')).toHaveText(/^0/);
  await expect(di.page.getByTestId('knocked-status')).toContainText('Teammate coming');    // and who, and how far
  await expect(di.page.getByTestId('bleed')).toContainText('%');
  await expect(ada.page.getByTestId('mate-Di')).toContainText('Knocked');
  await expect(ada.page.getByTestId('revive')).toHaveCount(0);                   // too far away to help from here
  await expect(di.page.getByTestId('fire')).toHaveCount(0);                      // no weapon controls while down
  await expect(di.page.getByTestId('squad')).toBeVisible();                      // but the squad stays in view
  await shot(di.page, '12-knocked');

  // ---- Rescue. Bo and Cy run over and shoot the zombies off her; Ada walks in and holds Revive.
  await place(bo.page, 20, -16);
  await place(cy.page, 16, -20);
  const diUp = async () => (await me(di.page))?.st === 'alive';
  const cover = Promise.all([
    fightUntil(bo.page, diUp, { everyMs: 400, timeoutMs: 60_000 }),
    fightUntil(cy.page, diUp, { everyMs: 420, timeoutMs: 60_000 }),
  ]);
  await walkTo(ada.page, 16, -16);
  await expect(ada.page.getByTestId('revive')).toContainText('Hold to revive Di');
  await holdDown(ada.page, 'revive');
  // Held: either it is filling, or it says exactly why it is not.
  await expect(ada.page.getByTestId('revive')).toContainText(/Reviving Di|Clear the zombies first/);
  await expect(di.page.getByTestId('knocked-status')).toContainText('Ada is reviving you', { timeout: 15_000 });
  await shot(di.page, '13-being-revived');
  await shot(ada.page, '13-reviving');
  await expect(di.page.getByTestId('knocked')).toHaveCount(0, { timeout: 30_000 });
  await release(ada.page);
  await cover;
  const back = await hud.hp(di.page);                                            // back at half health or less
  expect(back).toBeGreaterThan(0);
  expect(back).toBeLessThanOrEqual(50);
  await expect(ada.page.getByTestId('feed')).toContainText('revived Di');
  await expect(ada.page.getByTestId('revive')).toHaveCount(0);

  // ---- Arrival. Ada walks the last stretch on GPS; reaching the helicopter starts the holdout.
  await place(bo.page, 4, 15);
  await place(cy.page, -4, 15);
  await place(di.page, 0, 13);
  await place(ada.page, 0, 14);
  await ada.page.waitForTimeout(400);
  await expect(ada.page.getByTestId('objective')).toContainText('Reach the helicopter');   // 16 m out: not there yet
  await expect(ada.page.getByTestId('heli-dist')).toHaveText('16 m');
  await expect(ada.page.getByTestId('arrived')).toBeVisible();                   // close enough: the host is offered "We're here"
  await expect(bo.page.getByTestId('arrived')).toHaveCount(0);
  const sawArrival = expect(ada.page.getByTestId('banner')).toContainText('Helicopter reached', { timeout: 30_000 });
  await walkTo(ada.page, 0, 27);
  for (const p of squad) await expect(p.page.getByTestId('objective')).toContainText('Hold the zone');
  await expect(ada.page.getByTestId('hold-count')).toHaveText('Wave 1 of 2');
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);
  await sawArrival;
  await shot(ada.page, '14-holdout');

  // ---- Holdout: two waves, then the final wave.
  const finalWave = () => ada.page.getByTestId('extract-bar').isVisible();
  await Promise.all([
    fightUntil(ada.page, finalWave, { timeoutMs: 90_000 }),
    fightUntil(bo.page, finalWave, { everyMs: 400, timeoutMs: 90_000 }),
    fightUntil(cy.page, finalWave, { everyMs: 420, timeoutMs: 90_000 }),
    fightUntil(di.page, finalWave, { everyMs: 440, timeoutMs: 90_000 }),
  ]);
  for (const p of squad) await expect(p.page.getByTestId('objective')).toContainText('Extract now');
  await expect(ada.page.getByTestId('extract-holders')).toContainText('0 of 2 holding');

  // ---- Extraction. Cy and Di defend from here on.
  let out = false;
  const done = async () => out;
  const defence = Promise.all([
    fightUntil(cy.page, done, { everyMs: 400, timeoutMs: 90_000 }),
    fightUntil(di.page, done, { everyMs: 420, timeoutMs: 90_000 }),
  ]);
  try {
    // The way out is a button on the screen: nothing to find, nothing to scan.
    await expect(ada.page.getByTestId('extract-hold')).toContainText('Hold to extract');
    await expect(ada.page.getByTestId('extract-holders')).toContainText('Press and hold to extract');
    await shot(ada.page, '15-final-hold-to-extract');

    // Ada holds. One player is not enough.
    await holdDown(ada.page, 'extract-hold');
    await expect(bo.page.getByTestId('extract-holders')).toContainText('1 of 2 holding. Need one more.');
    await expect(ada.page.getByTestId('extract-hold')).toContainText('Need one more');
    await ada.page.waitForTimeout(1200);
    await expect(ada.page.getByTestId('extract-bar')).toHaveAttribute('aria-label', 'extraction 0 percent');
    await shot(ada.page, '16-final-one-holding');

    // Bo holds too: the bar fills and they are out.
    await holdDown(bo.page, 'extract-hold');
    await expect(cy.page.getByTestId('extract-holders')).toContainText('2 of 2 holding');
    await expect(cy.page.getByTestId('objective')).toContainText('Cover them');
    await shot(cy.page, '17-final-defending');
    await shot(bo.page, '17-final-extracting');
    for (const p of squad) await expect(p.page.getByTestId('outcome')).toContainText('Extracted', { timeout: 30_000 });
  } finally {
    out = true;
    await release(ada.page).catch(() => {});
    await release(bo.page).catch(() => {});
    await defence.catch(() => {});
  }

  // ---- Summary.
  await expect(ada.page.getByTestId('revives-Ada')).toHaveText('1');
  await expect(ada.page.getByTestId('knocks-Di')).toHaveText('1');
  await expect(cy.page.getByTestId('fate-Di')).toHaveText('Extracted');
  await expect(cy.page.getByTestId('waiting-host')).toBeVisible();               // only the host can run it again
  await expect(cy.page.getByTestId('again')).toHaveCount(0);
  await shot(ada.page, '18-summary-extracted-landscape');
  await cy.page.setViewportSize(PORTRAIT);
  await shot(cy.page, '18-summary-extracted-portrait');

  await ada.page.getByTestId('again').click();
  for (const p of squad) await expect(p.page.getByTestId('roster')).toBeVisible();
  for (const p of squad) await p.ctx.close();
});

test('nobody helps: a knocked player bleeds out and dies; the last one falling is a wipe', async ({ browser }) => {
  test.setTimeout(180_000);
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await expect(ada.page.getByTestId('player-Bo')).toBeVisible();
  await startMission([ada, bo]);
  for (const p of [ada, bo]) await intoMission(p);
  await place(ada.page, 0, 0);
  await place(bo.page, 22, 0);                                  // too far apart to revive each other

  // Bo looks after himself only. Ada never fires.
  const adaDead = () => ada.page.getByTestId('dead').isVisible();
  await fightUntil(bo.page, adaDead, { want: 'mine', timeoutMs: 150_000 });
  await expect(ada.page.getByTestId('hp')).toHaveText(/^0/);
  await expect(ada.page.getByTestId('dead')).toContainText("You're out");
  await expect(ada.page.getByTestId('fire')).toHaveCount(0);            // nothing to shoot or revive with
  await shot(ada.page, '19-dead');
  await ada.page.getByTestId('spectate').click();                       // fold it away and watch
  await expect(ada.page.getByTestId('dead')).toContainText('Spectating');
  await shot(ada.page, '19-spectating');
  await expect(bo.page.getByTestId('mate-Ada')).toContainText('Dead');
  await expect(bo.page.getByTestId('feed')).toContainText('Ada');
  await shot(bo.page, '19-teammate-dead');

  // Bo stops fighting. With nobody standing the mission is lost.
  for (const p of [ada, bo]) await expect(p.page.getByTestId('outcome')).toContainText('Squad wiped', { timeout: 90_000 });
  await expect(bo.page.getByTestId('fate-Ada')).toHaveText('Dead');
  await expect(bo.page.getByTestId('fate-Bo')).toHaveText('Knocked');
  await expect(ada.page.getByTestId('again')).toBeVisible();
  await expect(bo.page.getByTestId('again')).toHaveCount(0);
  await shot(bo.page, '20-summary-wiped-landscape');
  await bo.page.setViewportSize(PORTRAIT);
  await shot(bo.page, '20-summary-wiped-portrait');

  await ada.page.getByTestId('again').click();
  for (const p of [ada, bo]) await expect(p.page.getByTestId('roster')).toBeVisible();
  for (const p of [ada, bo]) await p.ctx.close();
});

test('a real building: host picks the map, zombies keep to the floor plan, the map opens full screen', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await expect(ada.page.getByTestId('player-Bo')).toBeVisible();

  // Only the host can choose. Everyone sees the choice.
  await expect(bo.page.getByTestId('map-name')).toHaveText('Open arena');
  await expect(bo.page.getByTestId('map-schmeichel')).toHaveCount(0);
  await ada.page.getByTestId('map-schmeichel').click();
  await expect(bo.page.getByTestId('map-name')).toContainText('Schmeichel');
  await shot(ada.page, '21-lobby-map-picker');

  await startMission([ada, bo]);
  for (const p of [ada, bo]) await intoMission(p);
  // Until GPS puts them at the building (the simulator starts 100 km away) the HUD says so.
  await expect(ada.page.getByTestId('hint')).toContainText('not at Schmeichel');

  const map = await ada.page.evaluate(() => window.__loonieStore!.getState().map as { start: [number, number]; helicopter: { x: number; y: number }; outline: [number, number][]; origin: [number, number] });
  expect(map.origin[0]).toBeCloseTo(43.0073, 3);                 // pinned to the real building, not to the host
  await place(ada.page, map.start[0], map.start[1], 90);
  await place(bo.page, map.start[0] + 2, map.start[1] - 2, 90);
  await expect(ada.page.getByTestId('hint')).toHaveCount(0);

  // The radar is replaced by the floor plan, and the objective measures to the real helicopter spot.
  await expect(ada.page.getByTestId('minimap')).toBeVisible();
  await expect(ada.page.getByTestId('radar')).toHaveCount(0);
  const far = Math.round(Math.hypot(map.helicopter.x - map.start[0], map.helicopter.y - map.start[1]));
  await expect(ada.page.getByTestId('heli-dist')).toHaveText(`${far} m`);

  // Zombies come from the building's spawn points and never leave the floor plan.
  await expect.poll(async () => (await world(ada.page)).zombies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const inside = ([x, y]: [number, number]) => {
    let odd = false;
    for (let i = 0, j = map.outline.length - 1; i < map.outline.length; j = i++) {
      const [xi, yi] = map.outline[i], [xj, yj] = map.outline[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  const first = (await world(ada.page)).zombies[0];
  let closest = first.dist;
  for (let i = 0; i < 12; i++) {
    const w = await world(ada.page);
    for (const z of w.zombies) expect(inside([z.x, z.y]), `zombie ${z.id} at ${z.x},${z.y}`).toBe(true);
    closest = Math.min(closest, w.zombies[0]?.dist ?? closest);
    await ada.page.waitForTimeout(400);
  }
  expect(closest).toBeLessThan(first.dist);                      // and they are closing in
  await shot(ada.page, '22-building-hud-minimap');

  // Tap the minimap for the whole floor; tap again to close.
  await ada.page.getByTestId('minimap-open').click();
  await expect(ada.page.getByTestId('fullmap')).toBeVisible();
  await shot(ada.page, '23-building-full-map');
  await ada.page.getByTestId('fullmap-close').click();
  await expect(ada.page.getByTestId('fullmap')).toHaveCount(0);

  await abortMission(ada);
  for (const p of [ada, bo]) await expect(p.page.getByTestId('roster')).toBeVisible();
  await expect(bo.page.getByTestId('map-name')).toContainText('Schmeichel');     // the choice survives a run
  for (const p of [ada, bo]) await p.ctx.close();
});

test('endless mode: the host picks it, waves keep coming with no helicopter, and it ends when nobody is standing', async ({ browser }) => {
  test.setTimeout(180_000);
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);

  // The mission is the default. Only the host can change it, and everyone sees the choice.
  await expect(bo.page.getByTestId('mode-chip')).toContainText('Mission');
  await expect(bo.page.getByTestId('mode-endless')).toHaveCount(0);
  await ada.page.getByTestId('mode-endless').click();
  await expect(ada.page.getByTestId('mode-endless')).toHaveAttribute('aria-checked', 'true');
  await expect(bo.page.getByTestId('mode-chip')).toContainText('Endless');
  await expect(bo.page.getByTestId('mode-line')).toContainText('No helicopter');
  await shot(ada.page, '25-lobby-endless');
  await shot(bo.page, '25-lobby-endless-guest');

  await startMission([ada, bo]);
  for (const p of [ada, bo]) await intoMission(p);
  await place(ada.page, 0, 0);
  await place(bo.page, 3, 0);

  // The objective is to survive: a clock, and no helicopter anywhere.
  await expect(ada.page.getByTestId('objective')).toContainText('Survive');
  await expect(ada.page.getByTestId('endless-time')).toHaveText(/^\d+:\d\d$/);
  await expect(ada.page.getByTestId('heli-dist')).toHaveCount(0);
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);
  await ada.page.getByTestId('hud-menu').click();
  await expect(ada.page.getByTestId('arrived-menu')).toHaveCount(0);
  await ada.page.getByTestId('sheet-close').click();
  // Standing where the helicopter would be changes nothing.
  await place(ada.page, 0, 30);
  await ada.page.waitForTimeout(700);
  await expect(ada.page.getByTestId('objective')).toContainText('Survive');
  await place(ada.page, 0, 0);

  // Wave after wave: clear one and the next arrives, with no end to them.
  await expect.poll(() => hud.wave(ada.page), { timeout: 20_000 }).toBe(1);
  await shot(ada.page, '26-endless-hud');
  const wave3 = async () => (await hud.wave(ada.page)) >= 3;
  await Promise.all([
    fightUntil(ada.page, wave3, { timeoutMs: 90_000 }),
    fightUntil(bo.page, wave3, { everyMs: 400, timeoutMs: 90_000 }),
  ]);
  for (const p of [ada, bo]) await expect(p.page.getByTestId('objective')).toContainText('Survive');
  expect(await hud.wave(bo.page)).toBeGreaterThanOrEqual(3);
  await shot(ada.page, '26-endless-wave-3');

  // They stop fighting. The only way an endless run ends.
  for (const p of [ada, bo]) await expect(p.page.getByTestId('outcome')).toContainText('Squad wiped', { timeout: 90_000 });
  await expect(ada.page.getByTestId('outcome-line')).toContainText(/You reached wave \d+ and lasted \d+:\d\d/);
  await expect(ada.page.getByTestId('mission-id')).toContainText('ENDLESS');
  await expect(ada.page.getByTestId('endless-best')).toContainText('New best on this phone: wave');
  expect(parseInt((await ada.page.getByTestId('sum-wave').textContent()) ?? '0', 10)).toBeGreaterThanOrEqual(3);
  await ada.page.setViewportSize(PORTRAIT);
  await shot(ada.page, '27-endless-results');

  // Play again keeps the mode.
  await ada.page.getByTestId('again').click();
  for (const p of [ada, bo]) await expect(p.page.getByTestId('mode-chip')).toContainText('Endless');
  for (const p of [ada, bo]) await p.ctx.close();
});

test('"We\'re here": the host presses it, GPS still short of the helicopter, and the holdout starts for everyone', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await expect(ada.page.getByTestId('player-Bo')).toBeVisible();
  await startMission([ada, bo]);
  for (const p of [ada, bo]) await intoMission(p);

  // 45 m out by a good fix: not offered. The same reading from a fix only sure
  // to ±30 m is: she may well be standing under the helicopter.
  await place(bo.page, 3, 14);
  await ada.page.evaluate(() => window.__loonieSim!.at(0, -15, { acc: 3, snap: true }));
  await expect(ada.page.getByTestId('heli-dist')).toHaveText('45 m');
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);
  await ada.page.evaluate(() => window.__loonieSim!.at(0, -15, { acc: 30, snap: true }));
  await expect(ada.page.getByTestId('arrived')).toBeVisible();

  // 16 m out: too far for GPS to call it, close enough for the HUD to offer the button.
  await place(ada.page, 0, 14);
  await expect(ada.page.getByTestId('objective')).toContainText('Reach the helicopter');
  await expect(bo.page.getByTestId('arrived')).toHaveCount(0);                   // the host's call, nobody else's
  const button = ada.page.getByTestId('arrived');
  await expect(button).toBeVisible();
  // It must be somewhere a finger can reach it: clear of the corner panels, and
  // inside the box that lays it out (a control hung outside its parent draws
  // on a phone but may not take touches there).
  const box = (await button.boundingBox())!, stats = (await ada.page.getByTestId('stats').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(stats.x);
  const outside = await button.evaluate((el) => {
    const b = el.getBoundingClientRect();
    let levels = 0;
    for (let p = el.parentElement; p && p.getAttribute('data-testid') !== 'game'; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      levels++;
      if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) return `sticks out of ancestor ${levels}`;
    }
    return levels > 2 ? null : 'never found the game root';
  });
  expect(outside).toBeNull();
  await shot(ada.page, '29-were-here');
  await button.click();
  for (const p of [ada, bo]) await expect(p.page.getByTestId('objective')).toContainText('Hold the zone');
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);
  for (const p of [ada, bo]) await p.ctx.close();
});

test('"We\'re here" from the mission menu works wherever GPS has put the host', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  await createSquad(ada);
  await startMission([ada]);
  await intoMission(ada);
  await place(ada.page, 40, -40);                                                // GPS has her streets away
  await expect(ada.page.getByTestId('objective')).toContainText('Reach the helicopter');
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);
  await ada.page.getByTestId('hud-menu').click();
  await ada.page.getByTestId('arrived-menu').click();
  await expect(ada.page.getByTestId('objective')).toContainText('Hold the zone');
  await ada.ctx.close();
});

test('zombies are the 3D model: drawn from the side they are seen from, biting, and falling when shot', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  // Every sheet the walker needs arrives, and arrives before it is needed.
  const sheets = new Set<string>();
  ada.page.on('response', (r) => { const m = /zombies\/(walker-[a-z]+)\.[0-9a-f]+\.webp/.exec(r.url()); if (m && r.ok()) sheets.add(m[1]); });
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await startMission([ada, bo]);
  for (const p of [ada, bo]) await intoMission(p);
  await place(ada.page, 0, 0);
  await place(bo.page, 3, 0);
  await expect.poll(() => hud.wave(ada.page), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => [...sheets].sort()).toEqual(['walker-attack', 'walker-die', 'walker-move']);
  await expect.poll(async () => (await world(ada.page)).zombies.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // A zombie goes for whoever is nearest, so where Bo stands decides whose it is.
  const FAR: [number, number] = [0, 90];
  const drawn = (id: number) => ada.page.evaluate((i) => window.__loonieAR!.items.find((z) => z.id === i) ?? null, id);
  const where = async (id: number) => (await world(ada.page)).zombies.find((z) => z.id === id)!;
  const lookAt = async (id: number) => ada.page.evaluate((b) => window.__loonieSim!.aim(b), (await where(id)).bearing);

  // Bo is nowhere near: it comes for Ada. She looks at it and sees it from the front, walking.
  await place(bo.page, ...FAR);
  const z = (await world(ada.page)).zombies[0].id;
  await expect.poll(async () => { await lookAt(z); return drawn(z); }, { intervals: [150] }).toMatchObject({ clip: 'move', row: 0, mirror: false });
  const frame = (await drawn(z))!.frame;
  await expect.poll(async () => (await drawn(z))?.frame, { intervals: [50] }).not.toBe(frame);       // and it is moving
  await shot(ada.page, '28-zombie-front');

  // Now Bo is the nearer one, off to its east, and Ada is south of it: it turns and walks across her view,
  // left to right. She sees its side, the side that faces her.
  const at = await where(z);
  await place(bo.page, at.x + 9, at.y);
  await place(ada.page, at.x, at.y - 13);
  await expect.poll(async () => { await lookAt(z); return drawn(z); }, { intervals: [150] }).toMatchObject({ clip: 'move', row: 2, mirror: false });
  await shot(ada.page, '28-zombie-side');
  // And from the other side of it, the same frames mirrored: it walks right to left.
  const then = await where(z);
  await place(ada.page, then.x, then.y + 13);
  await expect.poll(async () => { await lookAt(z); return drawn(z); }, { intervals: [150] }).toMatchObject({ clip: 'move', row: 2, mirror: true });

  // Bo leaves again. It comes back for Ada, reaches her and bites: facing her, with the attack.
  await place(bo.page, ...FAR);
  await expect.poll(async () => { await lookAt(z); return (await drawn(z))?.clip ?? 'not drawn'; }, { timeout: 20_000, intervals: [150] }).toBe('attack');
  expect(await drawn(z)).toMatchObject({ row: 0, mirror: false });
  await shot(ada.page, '28-zombie-biting');

  // She shoots it: it falls where it stood, and then it is gone.
  const fell = ada.page.getByTestId(`corpse-${z}`).waitFor({ state: 'attached', timeout: 20_000 });
  for (let i = 0; i < 40 && (await world(ada.page)).zombies.some((q) => q.id === z); i++) {
    await lookAt(z).catch(() => {});
    await ada.page.getByTestId('fire').click({ timeout: 1_500 }).catch(() => {});
    await ada.page.waitForTimeout(300);
  }
  await fell;
  await expect(ada.page.getByTestId(`zombie-${z}`)).toHaveCount(0);
  await expect(ada.page.getByTestId(`corpse-${z}`)).toHaveCount(0, { timeout: 3_000 });
  for (const p of [ada, bo]) await p.ctx.close();
});

test('a phone that reloads the page mid-mission drops back into it', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  await createSquad(ada);
  await startMission([ada]);
  await intoMission(ada);
  await place(ada.page, 0, 0);
  await expect.poll(() => hud.wave(ada.page), { timeout: 15_000 }).toBe(1);

  await ada.page.reload();
  await intoMission(ada);
  await expect.poll(() => hud.wave(ada.page)).toBe(1);
  // Shots still count after the reload (the server must not see them as repeats).
  await place(ada.page, 0, 0);
  await expect.poll(async () => (await world(ada.page)).zombies.length).toBeGreaterThan(0);
  const before = await hud.kills(ada.page);
  await fightUntil(ada.page, async () => (await hud.kills(ada.page)) > before, { timeoutMs: 30_000 });
  await ada.ctx.close();
});

test('bad code is explained, not swallowed', async ({ browser }) => {
  const p = await phone(browser, 'Solo');
  await p.page.getByTestId('join').click();
  await p.page.getByTestId('code').fill('ZZZZ');
  await p.page.getByTestId('join-go').click();
  await expect(p.page.getByTestId('error')).toContainText('No game with that code');
  await p.page.getByTestId('back').click();
  await expect(p.page.getByTestId('wordmark')).toBeVisible();
  await p.ctx.close();
});
