/**
 * Four phones, one match. Each browser context is a player; sensors are
 * driven through window.__loonieSim so we control who is standing where
 * and which way they face.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

const LAT = 43.4723, LON = -80.5449;
const R = 6_371_008.8;
const at = (north: number, east: number) => ({
  lat: LAT + (north / R) * (180 / Math.PI),
  lon: LON + (east / (R * Math.cos((LAT * Math.PI) / 180))) * (180 / Math.PI),
});

async function player(browser: Browser, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto('/?sim=1');
  await expect(page.getByTestId('wordmark')).toBeVisible();
  await page.getByTestId('name').fill(name);
  return { ctx, page, name };
}

async function place(page: Page, north: number, east: number, heading: number, acc = 3) {
  await page.waitForFunction(() => !!window.__loonieSim);
  await page.evaluate(({ p, heading, acc }) => window.__loonieSim!.set({ ...p, heading, acc, headingAcc: 5 }), { p: at(north, east), heading, acc });
}

declare global { interface Window { __loonieSim?: { set: (f: Record<string, unknown>) => void }; __loonieStore?: { getState: () => Record<string, unknown> } } }

/** Client-side state, for diagnosing a step that didn't do what we expected. */
const state = (page: Page) => page.evaluate(() => {
  const s = window.__loonieStore!.getState() as Record<string, unknown>;
  const pick = (k: string[]) => Object.fromEntries(k.map((x) => [x, s[x]]));
  return pick(['phase', 'connection', 'error', 'ammo', 'reloadingUntil', 'shots', 'damages', 'deadUntil', 'fix', 'serverOffset']);
});

test('four roommates play a full match', async ({ browser }) => {
  const ada = await player(browser, 'Ada');
  await shot(ada.page, '01-menu');

  // Host creates; the code shows up in the lobby header.
  await ada.page.getByTestId('create').click();
  const code = (await ada.page.getByTestId('code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  // Three more join by code.
  const bo = await player(browser, 'Bo');
  const cy = await player(browser, 'Cy');
  const di = await player(browser, 'Di');
  for (const p of [bo, cy, di]) {
    await p.page.getByTestId('join').click();
    await shot(p.page, `02-join-${p.name}`);
    await p.page.getByTestId('code').fill(code);
    await p.page.getByTestId('join-go').click();
    await expect(p.page.getByTestId('roster')).toBeVisible();
  }
  for (const n of ['Ada', 'Bo', 'Cy', 'Di']) await expect(ada.page.getByTestId(`player-${n}`)).toBeVisible();

  // Loadouts, settings, ready.
  await bo.page.getByTestId('weapon-light').click();
  await di.page.getByTestId('weapon-heavy').click();
  await ada.page.getByTestId('resp-4').click();
  for (const p of [ada, bo, cy, di]) await p.page.getByTestId('ready').click();
  await expect(ada.page.getByTestId('player-Bo')).toContainText('Light');
  await expect(ada.page.getByTestId('player-Di')).toContainText('Heavy');
  await shot(ada.page, '03-lobby-host');
  await shot(cy.page, '03-lobby-guest');

  // Only the host can start.
  await expect(bo.page.getByTestId('start')).toHaveCount(0);
  await ada.page.getByTestId('start').click();
  for (const p of [ada, bo, cy, di]) {
    await expect(p.page.getByTestId('game')).toBeVisible();
    await p.page.setViewportSize({ width: 844, height: 390 });     // the match is played sideways
  }

  // Ada at origin facing north. Bo 15 m north facing back. Cy 15 m east. Di 40 m south.
  await place(ada.page, 0, 0, 0);
  await place(bo.page, 15, 0, 180);
  await place(cy.page, 0, 15, 270);
  await place(di.page, -40, 0, 0);
  await expect(ada.page.getByTestId('timer')).toBeVisible();
  // Everyone spawns protected for a moment; the HUD says so, then it clears.
  await expect(ada.page.getByTestId('hint')).toContainText('Protected');
  await expect(ada.page.getByTestId('hint')).toHaveCount(0);

  // Ada's reticle acquires Bo (dead ahead) and locks after the Regular's 400 ms.
  await expect(ada.page.getByTestId('tag-Bo')).toBeVisible();
  await expect(ada.page.locator('[data-testid=reticle][aria-label=locked]')).toBeVisible();
  await shot(ada.page, '04-game-locked');

  // Fire: hit marker for Ada, Bo drops to 4/6 and sees the damage wedge.
  await ada.page.getByTestId('fire').click();
  await expect(ada.page.getByTestId('shot-hit')).toBeVisible();
  await expect(bo.page.getByTestId('hp')).toHaveText(/^4/);
  await shot(bo.page, '05-game-took-damage');
  await shot(ada.page, '05-game-hit');

  // Facing east now: Cy is dead ahead, Bo is 90° off. Lock swaps to Cy.
  await place(ada.page, 0, 0, 90);
  await expect(ada.page.locator('[data-testid=reticle][aria-label=locked]')).toBeVisible();
  await expect(ada.page.getByTestId('tag-Cy')).toHaveAttribute('aria-label', /locked/);
  await expect(ada.page.getByTestId('tag-Bo')).toHaveCount(0);   // 90° off: radar only, no bracket

  // Turn away from everyone: no lock, and a shot says so.
  await place(ada.page, 0, 0, 315);
  await expect(ada.page.locator('[data-testid=reticle][aria-label="no target"]')).toBeVisible();
  await ada.page.waitForTimeout(500);
  await ada.page.getByTestId('fire').click();
  await expect(ada.page.getByTestId('shot-miss')).toContainText('No lock');
  await shot(ada.page, '06-game-no-lock');

  // Bo (Light, full auto) holds the trigger on Ada until she's eliminated.
  await expect(bo.page.locator('[data-testid=reticle][aria-label=locked]')).toBeVisible();
  const fire = bo.page.getByTestId('fire');
  const box = (await fire.boundingBox())!;
  await bo.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await bo.page.mouse.down();
  await expect(ada.page.getByTestId('dead')).toBeVisible({ timeout: 10_000 });
  await bo.page.mouse.up();
  await expect(ada.page.getByTestId('respawn')).toBeVisible();
  await shot(ada.page, '07-game-eliminated');
  await expect(bo.page.getByTestId('kills')).toContainText('1');
  await expect(ada.page.getByTestId('alive')).toContainText('3/4');
  await expect(cy.page.getByTestId('killfeed')).toContainText('Bo');
  await shot(bo.page, '07-game-killer');

  // Respawn after 4 s with full health.
  await expect(ada.page.getByTestId('dead')).toHaveCount(0, { timeout: 8_000 });
  await expect(ada.page.getByTestId('hp')).toHaveText(/^8/);

  // Reload works from the HUD.
  await expect(bo.page.getByTestId('ammo')).not.toHaveText('18');
  await bo.page.getByTestId('reload').click();
  await expect(bo.page.getByTestId('ammo')).toHaveText('18', { timeout: 6_000 });

  // Host ends it. Bo tops the board.
  await ada.page.getByTestId('end').click();
  await ada.page.getByTestId('end-confirm').click();
  for (const p of [ada, bo, cy, di]) {
    await expect(p.page.getByTestId('winner')).toContainText('Bo wins');
    await p.page.setViewportSize({ width: 390, height: 844 });
  }
  await expect(di.page.getByTestId('result-Bo')).toContainText('1');
  await shot(di.page, '08-summary');

  // Back to the lobby for another round; scores reset.
  await ada.page.getByTestId('again').click();
  for (const p of [ada, bo, cy, di]) await expect(p.page.getByTestId('roster')).toBeVisible();
  await expect(ada.page.getByTestId('start')).toBeVisible();

  // Teams mode assigns everyone and exposes the switcher.
  await ada.page.getByTestId('mode-teams').click();
  await expect(bo.page.getByTestId('team-alpha')).toBeVisible();
  await shot(bo.page, '09-lobby-teams');

  for (const p of [ada, bo, cy, di]) await p.ctx.close();
});

test('bad code is explained, not swallowed', async ({ browser }) => {
  const p = await player(browser, 'Solo');
  await p.page.getByTestId('join').click();
  await p.page.getByTestId('code').fill('ZZZZ');
  await p.page.getByTestId('join-go').click();
  await expect(p.page.getByTestId('error')).toContainText('No game with that code');
  await p.page.getByTestId('back').click();
  await expect(p.page.getByTestId('wordmark')).toBeVisible();
  await p.ctx.close();
});

test('indoor tap-aim mode needs no GPS', async ({ browser }) => {
  const ada = await player(browser, 'Ada');
  await ada.page.getByTestId('create').click();
  const code = (await ada.page.getByTestId('code').textContent())!.trim();
  const bo = await player(browser, 'Bo');
  await bo.page.getByTestId('join').click();
  await bo.page.getByTestId('code').fill(code);
  await bo.page.getByTestId('join-go').click();
  await expect(ada.page.getByTestId('player-Bo')).toBeVisible();

  await ada.page.getByTestId('aim-manual').click();
  await ada.page.getByTestId('start').click();
  for (const p of [ada, bo]) {
    await expect(p.page.getByTestId('game')).toBeVisible();
    await p.page.setViewportSize({ width: 844, height: 390 });
  }

  // No sensor input at all. Radar hidden; strip shows the one enemy.
  await expect(ada.page.getByTestId('radar')).toHaveCount(0);
  await expect(bo.page.getByTestId('targets')).toBeVisible();     // Bo's client got the setting too
  await expect(ada.page.getByTestId('hint')).toContainText('Protected');
  await expect(ada.page.getByTestId('hint')).toContainText('Tap a target');
  await ada.page.getByTestId('target-Bo').click();
  await expect(ada.page.locator('[data-testid=reticle][aria-label=locked]')).toBeVisible();
  await shot(ada.page, '10-indoor-locked');
  await ada.page.getByTestId('fire').click();
  await expect(ada.page.getByTestId('shot-hit')).toBeVisible();
  await expect(bo.page.getByTestId('hp')).toHaveText(/^6/);
  await shot(bo.page, '10-indoor-hit');
  for (const p of [ada, bo]) await p.ctx.close();
});

test('a phone opening the page by LAN address finds the server on its own', async ({ browser }) => {
  // A phone can't use "localhost": it opens http://<laptop-ip>:8081 instead.
  const ip = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
  test.skip(!ip, 'no non-loopback IPv4 address on this machine');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://${ip}:8081/`);
  await expect(page.getByTestId('wordmark')).toBeVisible();
  await expect(page.getByText(`ws://${ip}:8000/ws`)).toBeVisible();
  // Connecting is covered by the localhost tests: a sandbox with an
  // outbound proxy may refuse WebSocket upgrades to a non-loopback address.
  await ctx.close();
});
