/**
 * Simulated phones play through the real app against a real server.
 * Screenshots of every screen land in e2e/output/.
 */
import { test, expect } from '@playwright/test';
import {
  LANDSCAPE, PORTRAIT, createSquad, faceNearest, fightUntil, hud, intoMission, joinSquad, phone, place, shot, world,
} from './helpers';

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

  // Wave 1: eight zombies for a full squad, the same ones on every phone.
  await expect.poll(() => hud.wave(ada.page), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => hud.zombiesLeft(ada.page)).toBe(8);
  await expect.poll(async () => (await world(bo.page)).zombies.length).toBe(8);
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
  expect(kills.reduce((a, b) => a + b, 0)).toBe(8);
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

test('a player who stops fighting is knocked; everyone down is a wipe', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await expect(ada.page.getByTestId('player-Bo')).toBeVisible();
  await ada.page.getByTestId('start').click();
  for (const p of [ada, bo]) await intoMission(p);
  await place(ada.page, 0, 0);
  await place(bo.page, 4, 0);

  // Bo defends only himself. Ada never fires, so the zombies get to her.
  const adaKnocked = () => ada.page.getByTestId('knocked').isVisible();
  const defending = fightUntil(bo.page, adaKnocked, { want: 'mine', timeoutMs: 90_000 });

  await expect.poll(() => hud.hp(ada.page), { timeout: 30_000, intervals: [50] }).toBeLessThan(8);
  await shot(ada.page, '10-game-bitten');                      // red flash and the wedge showing where from
  await expect(ada.page.getByTestId('knocked')).toBeVisible({ timeout: 40_000 });
  await defending;
  await expect(ada.page.getByTestId('hp')).toHaveText(/^0/);
  await shot(ada.page, '11-game-knocked');
  await expect(bo.page.getByTestId('mate-Ada')).toContainText('down');
  await shot(bo.page, '11-game-teammate-down');

  // A knocked player cannot shoot.
  const ammo = await hud.ammo(ada.page);
  await ada.page.getByTestId('fire').click({ force: true });
  await ada.page.waitForTimeout(300);
  expect(await hud.ammo(ada.page)).toBe(ammo);

  // Bo stops defending. With nobody standing the mission is lost.
  for (const p of [ada, bo]) await expect(p.page.getByTestId('outcome')).toContainText('Squad wiped', { timeout: 60_000 });
  await expect(bo.page.getByTestId('result-Ada')).toContainText('knocked');
  await expect(ada.page.getByTestId('again')).toBeVisible();
  await expect(bo.page.getByTestId('again')).toHaveCount(0);
  await shot(bo.page, '12-summary-wiped-landscape');
  await bo.page.setViewportSize(PORTRAIT);
  await shot(bo.page, '12-summary-wiped-portrait');

  // Play again puts the squad back in the lobby.
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
