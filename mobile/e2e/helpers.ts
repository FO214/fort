/**
 * Driving simulated phones. Each browser context is one player; sensors are
 * fed through window.__loonieSim, so a test decides where a player stands and
 * where their gun points, and everything downstream is the real app.
 */
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BACKEND } from './playwright.config';

export const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
export const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`) });

export const SERVER = `ws://localhost:${BACKEND}/ws`;
export const DEVICE = `ws://localhost:${BACKEND}/device`;
/**
 * The app as a simulated phone. Most tests skip the deploy sequence (turn,
 * mount, position, countdown) so they can get straight to the mission; the
 * tests about deploying turn it back on.
 */
export const appUrl = (opts: { deploy?: boolean; query?: string; server?: string } = {}) =>
  `/?sim=1&server=${encodeURIComponent(opts.server ?? SERVER)}${opts.deploy ? '' : '&deploy=skip'}${opts.query ? `&${opts.query}` : ''}`;

export const PORTRAIT = { width: 390, height: 844 };
export const LANDSCAPE = { width: 844, height: 390 };

export interface Phone { ctx: BrowserContext; page: Page; name: string }

type ZRow = [number, number, number, number, number, number, string | null];
interface Pose { x: number; y: number; heading: number | null; pitch: number; hasFix: boolean }
declare global {
  interface Window {
    __loonieSim?: {
      at: (x: number, y: number, opts?: { acc?: number; snap?: boolean }) => void;
      aim: (heading: number, pitch?: number) => void;
      step: (n?: number) => void;
      fix: (lat: number, lon: number, acc?: number, snap?: boolean) => void;
      qr: (data: string | null) => void;
    };
    __loonieStore?: { getState: () => Record<string, any> };
    __loonieZombies?: { latest: () => ZRow[] };
    __loonieTracking?: { pose: () => Pose; position: { origin: [number, number] | null } };
    __loonieAR?: { items: { id: number; x: number; y: number; h: number; dist: number; aimed: boolean }[]; aim: number[]; threats: number[] };
  }
}

export async function phone(browser: Browser, name: string, opts: { deploy?: boolean; query?: string; server?: string } = {}): Promise<Phone> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console.error`, m.text()); });
  await page.goto(appUrl(opts));
  await expect(page.getByTestId('wordmark')).toBeVisible();
  if (name) await page.getByTestId('name').fill(name);
  return { ctx, page, name };
}

/** Everyone taps Ready, and the host's Start lights up. */
export async function readyUp(squad: Phone[], host: Phone = squad[0]): Promise<void> {
  for (const p of squad) await p.page.getByTestId('ready').click();
  await expect(host.page.getByTestId('start')).toBeEnabled();
}

/** Ready up and start: the usual way out of the lobby. */
export async function startMission(squad: Phone[], host: Phone = squad[0]): Promise<void> {
  await readyUp(squad, host);
  await host.page.getByTestId('start').click();
}

/** The host ends the mission for everyone from the mission menu. */
export async function abortMission(host: Phone): Promise<void> {
  await host.page.getByTestId('hud-menu').click();
  await host.page.getByTestId('abort').click();
  await host.page.getByTestId('abort-confirm').click();
}

/**
 * A blaster on the network. It says hello, then sends button presses, as the
 * ESP32 firmware does. Runs inside the page, which already has a WebSocket.
 */
export async function connectGun(page: Page, gunId: string): Promise<void> {
  await page.evaluate(({ url, gunId }) => new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    (window as unknown as { __gun?: WebSocket }).__gun = ws;
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', gun_id: gunId })); resolve(); };
    ws.onerror = () => reject(new Error('gun could not connect'));
  }), { url: DEVICE, gunId });
}
export const gunButton = (page: Page, b: 'trigger' | 'reload', down: boolean) =>
  page.evaluate(({ b, down }) => (window as unknown as { __gun: WebSocket }).__gun.send(JSON.stringify({ t: 'btn', b, down })), { b, down });
export const dropGun = (page: Page) => page.evaluate(() => (window as unknown as { __gun: WebSocket }).__gun.close());

/** Host creates a squad; returns the four-letter code. */
export async function createSquad(host: Phone): Promise<string> {
  await host.page.getByTestId('create').click();
  const code = (await host.page.getByTestId('code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);
  return code;
}

export async function joinSquad(p: Phone, code: string): Promise<void> {
  await p.page.getByTestId('join').click();
  await p.page.getByTestId('code').fill(code);
  await p.page.getByTestId('join-go').click();
  await expect(p.page.getByTestId('roster')).toBeVisible();
}

/** Wait until the mission screen is up and the map is anchored, then turn the phone sideways. */
export async function intoMission(p: Phone): Promise<void> {
  await expect(p.page.getByTestId('game')).toBeVisible();
  await p.page.setViewportSize(LANDSCAPE);
  await p.page.waitForFunction(() => !!window.__loonieTracking?.position.origin && !!window.__loonieSim?.at);
  await expect(p.page.getByTestId('hp')).toBeVisible();
}

/** Put a player at a map position, facing a map heading. */
export async function place(page: Page, x: number, y: number, heading = 0, pitch = 0): Promise<void> {
  await page.evaluate(({ x, y, heading, pitch }) => {
    window.__loonieSim!.at(x, y, { snap: true });
    window.__loonieSim!.aim(heading, pitch);
  }, { x, y, heading, pitch });
}

/** Walk to a map position at a brisk pace: real steps plus GPS fixes that follow. */
export async function walkTo(page: Page, x: number, y: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const done = await page.evaluate(({ x, y }) => {
      const p = window.__loonieTracking!.pose();
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
      if (d < 0.6) return true;
      const heading = (Math.atan2(dx, dy) * 180) / Math.PI;
      window.__loonieSim!.aim(heading);
      const stride = Math.min(d, 0.7);
      window.__loonieSim!.step(1);
      window.__loonieSim!.at(p.x + (dx / d) * stride, p.y + (dy / d) * stride, { acc: 4 });
      return false;
    }, { x, y });
    if (done) return;
    await page.waitForTimeout(140);      // ~7 steps a second: a run, to keep the test short
  }
  throw new Error(`never reached (${x}, ${y})`);
}

export interface World { me: Pose; myId: string; zombies: { id: number; x: number; y: number; hp: number; target: string | null; dist: number; bearing: number }[] }

/** What this phone currently knows: its own pose and every zombie, nearest first. */
export function world(page: Page): Promise<World> {
  return page.evaluate(() => {
    const me = window.__loonieTracking!.pose();
    const myId = window.__loonieStore!.getState().session?.playerId as string;
    const zombies = window.__loonieZombies!.latest().map((r) => {
      const dx = r[2] - me.x, dy = r[3] - me.y;
      return { id: r[0], x: r[2], y: r[3], hp: r[4], target: r[6], dist: Math.hypot(dx, dy), bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
    }).sort((a, b) => a.dist - b.dist);
    return { me, myId, zombies };
  });
}

/** Swing the gun onto the nearest zombie (optionally only ones passing `want`). Returns it, or null. */
export async function faceNearest(page: Page, want: 'any' | 'mine' = 'any'): Promise<World['zombies'][number] | null> {
  const w = await world(page);
  const z = w.zombies.find((q) => want === 'any' || q.target === w.myId);
  if (!z) return null;
  await page.evaluate((b) => window.__loonieSim!.aim(b), z.bearing);
  return z;
}

/** Aim at the nearest zombie and pull the trigger once. False if there was nothing to shoot. */
export async function shootNearest(page: Page, want: 'any' | 'mine' = 'any'): Promise<boolean> {
  if (!(await faceNearest(page, want))) return false;
  // The sight has to actually be on it before the trigger does anything useful.
  await page.locator('[data-testid=reticle][aria-label="on target"]').waitFor({ timeout: 1500 }).catch(() => {});
  // Never wait long for the trigger: if the mission just ended there is no Fire button any more.
  await page.getByTestId('fire').click({ timeout: 1500 }).catch(() => {});
  return true;
}

/** Keep shooting until `done()` says stop. Paces itself to the gun's fire rate. */
export async function fightUntil(page: Page, done: () => Promise<boolean>, opts: { want?: 'any' | 'mine'; everyMs?: number; timeoutMs?: number } = {}): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error('fight timed out');
    const fired = await shootNearest(page, opts.want ?? 'any');
    await page.waitForTimeout(fired ? opts.everyMs ?? 380 : 120);
  }
}

/** Press and keep holding an on-screen control (revive, extract). */
export async function holdDown(page: Page, testId: string): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

export const release = (page: Page) => page.mouse.up();

/** Hold a QR code up to this phone's camera, or take it away. */
export const showQr = (page: Page, data: string | null) => page.evaluate((d) => window.__loonieSim!.qr(d), data);

/** This player's own entry in the newest snapshot. */
export const me = (page: Page) => page.evaluate(() => {
  const s = window.__loonieStore!.getState();
  return (s.squad as any[]).find((p) => p.id === s.session?.playerId) as { st: string; hp: number; bl: number; rv: number; x: number; y: number } | undefined;
});

export const hud = {
  /** Own health as the HUD shows it: a whole percentage. */
  hp: async (page: Page) => parseInt((await page.getByTestId('hp').textContent()) ?? '', 10),
  ammo: async (page: Page) => parseInt((await page.getByTestId('ammo').textContent()) ?? '', 10),
  /** Kills are not on the HUD (they are on the results screen), so this reads the snapshot. */
  kills: (page: Page) => page.evaluate(() => {
    const s = window.__loonieStore!.getState();
    return ((s.squad as any[]).find((p) => p.id === s.session?.playerId)?.k ?? 0) as number;
  }),
  zombiesLeft: async (page: Page) => parseInt(((await page.getByTestId('zombies-left').textContent()) ?? '').replace(/\D/g, ''), 10),
  wave: async (page: Page) => parseInt(((await page.getByTestId('wave').textContent()) ?? '').replace(/\D/g, '') || '0', 10),
};

/** Client-side state, for diagnosing a step that didn't do what we expected. */
export const state = (page: Page) => page.evaluate(() => {
  const s = window.__loonieStore!.getState();
  const pick = (k: string[]) => Object.fromEntries(k.map((x) => [x, s[x]]));
  return { ...pick(['phase', 'connection', 'error', 'ammo', 'reloadingUntil', 'mission', 'zombieCount', 'squad']), pose: window.__loonieTracking?.pose() };
});
