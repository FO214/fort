/**
 * Simulated phones play through the real app against a real server.
 * Screenshots of every screen land in e2e/output/.
 */
import { test, expect } from '@playwright/test';
import {
  LANDSCAPE, PORTRAIT, createSquad, faceNearest, fightUntil, holdDown, hud, intoMission, joinSquad, me, phone, place, release,
  shot, showQr, walkTo, world,
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
  await bo.page.getByTestId('class-light').click();
  await di.page.getByTestId('class-heavy').click();
  for (const p of [ada, bo, cy, di]) await p.page.getByTestId('ready').click();
  await expect(ada.page.getByTestId('player-Bo')).toContainText('Light');
  await expect(ada.page.getByTestId('player-Di')).toContainText('Heavy');
  await expect(ada.page.getByTestId('gps')).toContainText('GPS ±3 m');
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

  // The whole squad opens fire until the wave is down.
  const cleared = async () => (await hud.zombiesLeft(ada.page)) === 0;
  await Promise.all([
    fightUntil(ada.page, cleared),
    fightUntil(bo.page, cleared, { everyMs: 130 }),           // Light: fast and weak
    fightUntil(cy.page, cleared),
    fightUntil(di.page, cleared, { everyMs: 850 }),           // Heavy: slow and strong
  ]);
  await expect(ada.page.getByTestId('feed')).toContainText('Wave 1');
  await expect(ada.page.getByTestId('feed')).toContainText('cleared');
  const kills = await Promise.all(squad.map((p) => hud.kills(p.page)));
  expect(kills.reduce((a, b) => a + b, 0)).toBe(WAVE_1);
  await shot(ada.page, '08-game-wave-cleared');

  // Reload from the HUD.
  if ((await hud.ammo(ada.page)) === 10) await ada.page.getByTestId('fire').click();
  await expect.poll(() => hud.ammo(ada.page)).toBeLessThan(10);
  await ada.page.getByTestId('reload').click();
  await expect(ada.page.getByTestId('ammo-panel')).toContainText('Reloading');
  await expect.poll(() => hud.ammo(ada.page), { timeout: 6_000 }).toBe(10);

  // Host aborts: everyone is back in the lobby.
  await expect(bo.page.getByTestId('abort')).toHaveCount(0);
  await ada.page.getByTestId('abort').click();
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
  await ada.page.getByTestId('start').click();
  const squad = [ada, bo, cy, di];
  for (const p of squad) await intoMission(p);

  // ---- Journey. Three stay together; Di wanders off alone and does not shoot.
  await place(ada.page, 0, 0);
  await place(bo.page, 3, 0);
  await place(cy.page, 0, 3);
  await place(di.page, 18, -18);
  await expect(ada.page.getByTestId('objective')).toContainText('Helicopter');
  await expect(ada.page.getByTestId('heli-dist')).toHaveText('30 m');            // it is 30 m north of the start
  await expect(di.page.getByTestId('heli-dist')).toHaveText('51 m');
  await expect(ada.page.getByTestId('arrived')).toBeVisible();                   // host's "We're here"
  await expect(bo.page.getByTestId('arrived')).toHaveCount(0);
  await shot(ada.page, '10-journey-objective');

  const diDown = () => di.page.getByTestId('knocked').isVisible();
  await Promise.all([
    fightUntil(ada.page, diDown, { want: 'mine', timeoutMs: 90_000 }),
    fightUntil(bo.page, diDown, { want: 'mine', everyMs: 420, timeoutMs: 90_000 }),
    fightUntil(cy.page, diDown, { want: 'mine', everyMs: 440, timeoutMs: 90_000 }),
    (async () => {
      await expect.poll(() => hud.hp(di.page), { timeout: 60_000, intervals: [50] }).toBeLessThan(8);
      await shot(di.page, '11-bitten');                                           // red flash + direction wedge
    })(),
  ]);

  // ---- Di is knocked: she cannot shoot and her bleed-out bar is showing.
  await expect(di.page.getByTestId('hp')).toHaveText(/^0/);
  await expect(di.page.getByTestId('knocked-status')).toContainText('teammate must clear');
  await expect(ada.page.getByTestId('mate-Di')).toContainText('down');
  await expect(ada.page.getByTestId('revive')).toHaveCount(0);                   // too far away to help from here
  const ammo = await hud.ammo(di.page);
  await di.page.getByTestId('fire').click({ force: true });
  await di.page.waitForTimeout(250);
  expect(await hud.ammo(di.page)).toBe(ammo);
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
  await expect(ada.page.getByTestId('revive')).toContainText('Reviving Di');
  await expect(di.page.getByTestId('knocked-status')).toContainText('Ada is reviving you', { timeout: 15_000 });
  await shot(di.page, '13-being-revived');
  await shot(ada.page, '13-reviving');
  await expect(di.page.getByTestId('knocked')).toHaveCount(0, { timeout: 30_000 });
  await release(ada.page);
  await cover;
  await expect(di.page.getByTestId('hp')).toHaveText(/^[1-4]\//);                // back at half health or less
  await expect(ada.page.getByTestId('feed')).toContainText('revived Di');
  await expect(ada.page.getByTestId('revive')).toHaveCount(0);

  // ---- Arrival. Ada walks the last stretch on GPS; reaching the helicopter starts the holdout.
  await place(bo.page, 4, 15);
  await place(cy.page, -4, 15);
  await place(di.page, 0, 13);
  await place(ada.page, 0, 14);
  await ada.page.waitForTimeout(400);
  await expect(ada.page.getByTestId('objective')).toContainText('Helicopter');   // 16 m out: not there yet
  await expect(ada.page.getByTestId('heli-dist')).toHaveText('16 m');
  await walkTo(ada.page, 0, 27);
  for (const p of squad) await expect(p.page.getByTestId('objective')).toContainText('Hold the helicopter');
  await expect(ada.page.getByTestId('arrived')).toHaveCount(0);
  await expect(ada.page.getByTestId('feed')).toContainText('Helicopter reached');
  await shot(ada.page, '14-holdout');

  // ---- Holdout: two waves, then the final wave.
  const finalWave = () => ada.page.getByTestId('extract-bar').isVisible();
  await Promise.all([
    fightUntil(ada.page, finalWave, { timeoutMs: 90_000 }),
    fightUntil(bo.page, finalWave, { everyMs: 400, timeoutMs: 90_000 }),
    fightUntil(cy.page, finalWave, { everyMs: 420, timeoutMs: 90_000 }),
    fightUntil(di.page, finalWave, { everyMs: 440, timeoutMs: 90_000 }),
  ]);
  for (const p of squad) await expect(p.page.getByTestId('objective')).toContainText('Final wave');
  await expect(ada.page.getByTestId('extract-holders')).toHaveText('0/2 holding');

  // ---- Extraction. Cy and Di defend from here on.
  let out = false;
  const done = async () => out;
  const defence = Promise.all([
    fightUntil(cy.page, done, { everyMs: 400, timeoutMs: 90_000 }),
    fightUntil(di.page, done, { everyMs: 420, timeoutMs: 90_000 }),
  ]);
  try {
    // No code in view: nothing to hold. The wrong code does not count either.
    await expect(ada.page.getByTestId('extract-aim')).toBeVisible();
    await showQr(ada.page, 'SOME-OTHER-CODE');
    await ada.page.waitForTimeout(500);
    await expect(ada.page.getByTestId('extract-hold')).toHaveCount(0);
    await shot(ada.page, '15-final-aim-at-code');

    // Ada finds the helicopter's code and holds. One player is not enough.
    await showQr(ada.page, 'LOONIE:HELI');
    await expect(ada.page.getByTestId('extract-hold')).toContainText('Hold to extract');
    await holdDown(ada.page, 'extract-hold');
    await expect(bo.page.getByTestId('extract-holders')).toHaveText('1/2 holding');
    await expect(ada.page.getByTestId('extract-hold')).toContainText('Waiting for 1 more');
    await ada.page.waitForTimeout(1200);
    await expect(ada.page.getByTestId('extract-bar')).toHaveAttribute('aria-label', 'extraction 0 percent');
    await shot(ada.page, '16-final-one-holding');

    // Bo joins her on the code: the bar fills and they are out.
    await showQr(bo.page, 'LOONIE:HELI');
    await holdDown(bo.page, 'extract-hold');
    await expect(cy.page.getByTestId('extract-holders')).toHaveText('2/2 holding');
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
  await expect(ada.page.getByTestId('result-Ada')).toContainText('1 revive');
  await expect(cy.page.getByTestId('result-Di')).toContainText('extracted');
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
  await ada.page.getByTestId('start').click();
  for (const p of [ada, bo]) await intoMission(p);
  await place(ada.page, 0, 0);
  await place(bo.page, 22, 0);                                  // too far apart to revive each other

  // Bo looks after himself only. Ada never fires.
  const adaDead = () => ada.page.getByTestId('dead').isVisible();
  await fightUntil(bo.page, adaDead, { want: 'mine', timeoutMs: 150_000 });
  await expect(ada.page.getByTestId('hp')).toHaveText(/^0/);
  await shot(ada.page, '19-dead');
  await expect(bo.page.getByTestId('mate-Ada')).toContainText('dead');
  await expect(bo.page.getByTestId('feed')).toContainText('Ada');
  await shot(bo.page, '19-teammate-dead');

  // Bo stops fighting. With nobody standing the mission is lost.
  for (const p of [ada, bo]) await expect(p.page.getByTestId('outcome')).toContainText('Squad wiped', { timeout: 90_000 });
  await expect(bo.page.getByTestId('result-Ada')).toContainText('dead');
  await expect(bo.page.getByTestId('result-Bo')).toContainText('knocked');
  await expect(ada.page.getByTestId('again')).toBeVisible();
  await expect(bo.page.getByTestId('again')).toHaveCount(0);
  await shot(bo.page, '20-summary-wiped-landscape');
  await bo.page.setViewportSize(PORTRAIT);
  await shot(bo.page, '20-summary-wiped-portrait');

  await ada.page.getByTestId('again').click();
  for (const p of [ada, bo]) await expect(p.page.getByTestId('roster')).toBeVisible();
  for (const p of [ada, bo]) await p.ctx.close();
});

test('a phone that reloads the page mid-mission drops back into it', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  await createSquad(ada);
  await ada.page.getByTestId('start').click();
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
