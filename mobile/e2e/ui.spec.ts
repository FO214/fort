/**
 * The screens around the mission, state by state: the menu's errors, the
 * code field, the lobby's permission briefing and gun pairing, the deploy
 * sequence, and the HUD holding together at other screen sizes.
 * Screenshots land in e2e/output/ next to the mission's.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  LANDSCAPE, PORTRAIT, SERVER, appUrl, connectGun, createSquad, dropGun, gunButton, hud, intoMission, joinSquad, phone, place, shot,
  startMission,
} from './helpers';

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('main menu: a call sign comes first; settings keep the preferences and tuck the server address away', async ({ browser }) => {
  const p = await phone(browser, '');
  await p.page.getByTestId('create').click();
  await expect(p.page.getByText('Enter a call sign first')).toBeVisible();
  await p.page.getByTestId('join').click();
  await expect(p.page.getByTestId('wordmark')).toBeVisible();                 // still on the menu
  await shot(p.page, '01-menu-call-sign-missing');
  await p.page.getByTestId('name').fill('Ada');
  await expect(p.page.getByText('Enter a call sign first')).toHaveCount(0);   // gone once it is fixed

  await p.page.getByTestId('settings-open').click();
  await expect(p.page.getByTestId('settings')).toBeVisible();
  await expect(p.page.getByTestId('server')).toHaveCount(0);                  // the developer setting is not in the way
  await p.page.getByTestId('pref-haptics').click();
  await expect(p.page.getByTestId('pref-haptics')).toHaveAttribute('aria-checked', 'false');
  await expect(p.page.getByTestId('pref-sound')).toHaveAttribute('aria-checked', 'true');      // independent of each other
  await p.page.getByTestId('pref-hud-1.12').click();
  await p.page.getByTestId('server-toggle').click();
  await expect(p.page.getByTestId('server')).toHaveValue(SERVER);
  await shot(p.page, '01-menu-settings');

  await p.page.reload();                                                      // preferences are remembered
  await p.page.getByTestId('settings-open').click();
  await expect(p.page.getByTestId('pref-haptics')).toHaveAttribute('aria-checked', 'false');
  await expect(p.page.getByTestId('pref-hud-1.12')).toHaveAttribute('aria-checked', 'true');
  await p.ctx.close();
});

test('a server that cannot be reached is explained on the menu, and Create can be tried again', async ({ browser }) => {
  const p = await phone(browser, 'Ada', { server: 'ws://localhost:9/ws' });
  await p.page.getByTestId('create').click();
  await expect(p.page.getByTestId('error')).toContainText('Could not reach the server');
  await expect(p.page.getByTestId('create')).toBeEnabled();
  await shot(p.page, '01-menu-connection-failed');
  await p.ctx.close();
});

test('join: four cells, capitals, a pasted code cleaned up, and Join only once it is complete', async ({ browser }) => {
  const host = await phone(browser, 'Ada');
  const code = await createSquad(host);
  const p = await phone(browser, 'Bo');
  await p.page.getByTestId('join').click();
  const field = p.page.getByTestId('code');
  await expect(p.page.getByTestId('join-go')).toBeDisabled();
  await field.fill('ab');
  await expect(field).toHaveValue('AB');
  await expect(p.page.getByTestId('join-go')).toBeDisabled();
  await shot(p.page, '02-join-partial');
  await field.fill(` ${code.toLowerCase().slice(0, 2)}-${code.toLowerCase().slice(2)} x`);       // as pasted from a message
  await expect(field).toHaveValue(code);
  await expect(p.page.getByTestId('join-go')).toBeEnabled();
  await shot(p.page, '02-join-complete');
  await p.page.getByTestId('join-go').click();
  await expect(p.page.getByTestId('roster')).toBeVisible();
  await expect(p.page.getByTestId('code')).toHaveText(code);
  for (const x of [host, p]) await x.ctx.close();
});

test('lobby: the permission briefing comes before the phone is asked, and sensors wait for the answer', async ({ browser }) => {
  const ada = await phone(browser, 'Ada', { query: 'perm=ask' });
  await createSquad(ada);
  const sheet = ada.page.getByTestId('permissions');
  await expect(sheet).toBeVisible();
  for (const what of ['Camera', 'Location', 'Motion']) await expect(sheet).toContainText(what);
  await expect(ada.page.getByTestId('gps')).toContainText('Finding GPS');     // nothing was started behind the briefing
  await expect(ada.page.getByTestId('ready')).toBeDisabled();
  await shot(ada.page, '03-lobby-permissions');
  await ada.page.getByTestId('perm-allow').click();
  await expect(sheet).toHaveCount(0);
  await expect(ada.page.getByTestId('gps')).toContainText('GPS ±3 m');
  await expect(ada.page.getByTestId('ready')).toBeEnabled();
  await ada.ctx.close();
});

test('lobby: a host who leaves is asked first, and the lobby passes to the next player', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await expect(bo.page.getByTestId('start')).toHaveCount(0);
  await expect(bo.page.getByTestId('start-why')).toContainText('The host starts the mission');
  await ada.page.getByTestId('copy').click();
  await expect(ada.page.getByTestId('copy')).toContainText('Copied');         // the tap is confirmed
  await ada.page.getByTestId('leave').click();
  await expect(ada.page.getByTestId('leave-confirm')).toBeVisible();
  await shot(ada.page, '03-lobby-leave-confirm');
  await ada.page.getByTestId('leave-no').click();
  await expect(ada.page.getByTestId('roster')).toBeVisible();
  await ada.page.getByTestId('leave').click();
  await ada.page.getByTestId('leave-yes').click();
  await expect(ada.page.getByTestId('wordmark')).toBeVisible();
  await expect(bo.page.getByTestId('start')).toBeVisible();                   // Bo hosts now, and is told so
  await expect(bo.page.getByTestId('host-note')).toContainText('You are the host now');
  await expect(bo.page.getByTestId('player-Ada')).toHaveCount(0);
  await bo.page.getByTestId('leave').click();                                 // alone: no question asked
  await expect(bo.page.getByTestId('wordmark')).toBeVisible();
  for (const x of [ada, bo]) await x.ctx.close();
});

test('lobby: a phone already sideways on its blaster gets two columns, nothing overlapping', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const bo = await phone(browser, 'Bo');
  await joinSquad(bo, code);
  await ada.page.setViewportSize(LANDSCAPE);
  const cards = ['class-pistol', 'class-smg', 'class-shotgun', 'class-rifle'];
  // All four rectangles in one read, once the cards have moved to the right-hand column.
  const read = () => ada.page.evaluate((ids) => ids.map((id) => {
    const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }), [...cards, 'roster']);
  await expect.poll(async () => { const b = await read(); return b.every(Boolean) && b[0]!.x > LANDSCAPE.width / 2; }).toBe(true);
  const all = (await read()) as Box[];
  const boxes = all.slice(0, cards.length);
  const roster = all[cards.length];
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i].width, `${cards[i]} has room for its numbers`).toBeGreaterThanOrEqual(76);
    expect(boxes[i].x + boxes[i].width).toBeLessThanOrEqual(LANDSCAPE.width);
    for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${cards[i]} overlaps ${cards[j]}`).toBe(false);
  }
  for (const b of boxes) expect(overlap(roster, b), 'the roster and the class cards sit side by side').toBe(false);
  await expect(ada.page.getByTestId('player-Ada')).toContainText('Ada');
  await expect(ada.page.getByTestId('start')).toBeVisible();
  await expect(ada.page.getByTestId('ready')).toBeVisible();
  await shot(ada.page, '03-lobby-host-landscape');
  for (const x of [ada, bo]) await x.ctx.close();
});

test('pairing a blaster: the window, the timeout, and "paired" only when the gun itself answers', async ({ browser }) => {
  test.setTimeout(90_000);
  const ada = await phone(browser, 'Ada');
  await createSquad(ada);
  const state = ada.page.getByTestId('pair-gun-state');
  const gunId = `e2e-${Date.now()}`;

  // No gun on the network: the ten seconds run out, and it says so.
  await ada.page.getByTestId('pair-gun').click();
  await expect(state).toContainText('Pull your trigger now');
  await expect(ada.page.getByTestId('pair-countdown')).toContainText(/^(10|9|8)s$/);
  await shot(ada.page, '03-lobby-pairing');
  await expect(state).toContainText('Pairing timed out', { timeout: 15_000 });
  await expect(state).not.toContainText('Gun paired');
  await shot(ada.page, '03-lobby-pairing-timeout');

  // Retry with a gun: nothing is claimed until its trigger is pulled.
  await connectGun(ada.page, gunId);
  await ada.page.getByTestId('pair-gun').click();
  await expect(state).toContainText('Pull your trigger now');
  await ada.page.waitForTimeout(600);
  await expect(state).not.toContainText('Gun paired');
  await gunButton(ada.page, 'trigger', true);
  await gunButton(ada.page, 'trigger', false);
  await expect(state).toContainText('Gun paired');
  await expect(ada.page.getByTestId('player-Ada')).toContainText('Gun paired');
  await shot(ada.page, '03-lobby-gun-paired');

  // The gun drops off the network, then finds its way back on its own.
  await dropGun(ada.page);
  await expect(state).toContainText('Gun disconnected');
  await shot(ada.page, '03-lobby-gun-disconnected');
  await connectGun(ada.page, gunId);
  await expect(state).toContainText('Gun paired');

  // In the mission its buttons are the trigger and the reload.
  await startMission([ada]);
  await intoMission(ada);
  await place(ada.page, 0, 0);
  const before = await hud.ammo(ada.page);
  await gunButton(ada.page, 'trigger', true);
  await gunButton(ada.page, 'trigger', false);
  await expect.poll(() => hud.ammo(ada.page)).toBe(before - 1);
  await gunButton(ada.page, 'reload', true);
  await expect(ada.page.getByTestId('ammo-panel')).toContainText('Reloading');
  await dropGun(ada.page);
  await expect(ada.page.getByTestId('hint')).toContainText('Gun disconnected');
  await shot(ada.page, '05-hud-gun-disconnected');
  await ada.ctx.close();
});

test('deploy: turn the phone, mount it, find the position, count in', async ({ browser }) => {
  const ada = await phone(browser, 'Ada', { deploy: true });
  await createSquad(ada);
  await startMission([ada]);
  const title = ada.page.getByTestId('deploy-title');
  await expect(title).toHaveText('Rotate your phone');
  await expect(ada.page.getByTestId('hp')).toHaveCount(0);                    // no HUD behind it
  await shot(ada.page, '04-deploy-rotate');

  await ada.page.setViewportSize(LANDSCAPE);
  await expect(title).toHaveText('Mount your phone');
  await shot(ada.page, '04-deploy-mount');
  await ada.page.waitForTimeout(1500);
  await expect(title).toHaveText('Mount your phone');                         // it waits for the player, however long that is
  await ada.page.setViewportSize(PORTRAIT);                                   // turned back upright: it asks again
  await expect(title).toHaveText('Rotate your phone');
  await ada.page.setViewportSize(LANDSCAPE);

  await ada.page.getByTestId('deploy-mounted').click();
  await expect(title).toHaveText('Getting your position');
  await expect(ada.page.getByTestId('deploy-gps')).toContainText('GPS acquired ±3 m');
  await shot(ada.page, '04-deploy-position');
  await expect(ada.page.getByTestId('deploy-count')).toBeVisible();
  await shot(ada.page, '04-deploy-countdown');
  await expect(ada.page.getByTestId('hp')).toBeVisible({ timeout: 8_000 });
  await expect(ada.page.getByTestId('deploy')).toHaveCount(0);

  // A phone that drops back into a mission already under way goes straight to the HUD.
  await ada.page.reload();
  await expect(ada.page.getByTestId('hp')).toBeVisible();
  await expect(ada.page.getByTestId('deploy')).toHaveCount(0);
  await ada.ctx.close();
});

// ---- the HUD at other sizes -------------------------------------------------

/** Every critical HUD piece is on screen and none of them cover each other. */
async function expectHudSound(page: Page, size: { width: number; height: number }): Promise<void> {
  const ids = ['healthbar', 'objective', 'stats', 'ammo-panel', 'fire', 'reload', 'reticle', 'hud-menu'];
  const boxes: Record<string, Box> = {};
  for (const id of ids) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} is on the HUD`).not.toBeNull();
    boxes[id] = box!;
    expect(box!.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
    expect(box!.y, `${id} top edge`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(size.width + 0.5);
    expect(box!.y + box!.height, `${id} bottom edge`).toBeLessThanOrEqual(size.height + 0.5);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      expect(overlap(boxes[ids[i]], boxes[ids[j]]), `${ids[i]} overlaps ${ids[j]}`).toBe(false);
    }
  }
  // The trigger is a real target, and the sight is dead centre.
  expect(Math.min(boxes.fire.width, boxes.fire.height)).toBeGreaterThanOrEqual(56);
  expect(Math.min(boxes.reload.width, boxes.reload.height)).toBeGreaterThanOrEqual(56);
  expect(Math.abs(boxes.reticle.x + boxes.reticle.width / 2 - size.width / 2)).toBeLessThan(1);
  expect(Math.abs(boxes.reticle.y + boxes.reticle.height / 2 - size.height / 2)).toBeLessThan(1);
}

test('the HUD holds together on small and large phones, and at every HUD size', async ({ browser }) => {
  const ada = await phone(browser, 'Ada');
  const code = await createSquad(ada);
  const mates = [await phone(browser, 'Bo'), await phone(browser, 'Cy'), await phone(browser, 'Di')];
  for (const m of mates) await joinSquad(m, code);
  await startMission([ada, ...mates]);
  await intoMission(ada);
  await place(ada.page, 0, 0);
  await expect(ada.page.getByTestId('squad')).toContainText('Di');             // a full squad list, the tightest case

  const sizes = { 'iphone-se': { width: 667, height: 375 }, 'iphone-15': LANDSCAPE, 'iphone-15-pro-max': { width: 932, height: 430 }, 'small-android': { width: 640, height: 360 } };
  for (const [name, size] of Object.entries(sizes)) {
    await ada.page.setViewportSize(size);
    for (const scale of ['0.9', '1', '1.12']) {
      await ada.page.evaluate((v) => window.__loonieStore!.getState().setPrefs({ hudScale: Number(v) }), scale);
      await ada.page.waitForTimeout(120);
      await expectHudSound(ada.page, size);
      // Straight to the file: this has to finish before the first wave reaches a player who is not shooting back.
      if (scale !== '0.9') await ada.page.screenshot({ path: `${__dirname}/output/24-hud-${name}-x${scale}.png` });
    }
  }
  for (const x of [ada, ...mates]) await x.ctx.close();
});

test('the design system gallery renders every part of the system', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 720, height: 1000 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The zombie section draws all four types walking, biting and falling: twelve sprite sheets.
  const sheets = new Set<string>();
  page.on('response', (r) => { const m = /zombies\/([a-z]+-[a-z]+)\.[0-9a-f]+\.webp/.exec(r.url()); if (m && r.ok()) sheets.add(m[1]); });
  await page.goto(appUrl({ query: 'gallery=1' }));
  await expect(page.getByTestId('gallery')).toBeVisible();
  for (const n of ['01', '04', '05', '06', '07', '08', '09', '10', '11', '12']) {
    const section = page.getByTestId(`gallery-${n}`);
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${__dirname}/output/gallery-${n}.png` });
  }
  await expect.poll(() => sheets.size).toBe(12);
  expect(errors).toEqual([]);
  await ctx.close();
});
