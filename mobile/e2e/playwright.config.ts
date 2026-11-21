import { defineConfig } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureFakeCamera } from './fakeCamera';

// Which browser to drive, in order of preference:
//   CHROMIUM_PATH            an explicit binary
//   a sandbox's preinstalled Chromium
//   Google Chrome on this machine (no download needed)
//   Playwright's own Chromium (`npx playwright install chromium`)
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined);
const channel = !executablePath && fs.existsSync(MAC_CHROME) ? 'chrome' : undefined;

// A drawn corridor stands in for the camera (see fakeCamera.ts).
const CAMERA = ensureFakeCamera(path.join(__dirname, 'output'));

// Their own ports, so a dev server on 8000/8081 is left alone and the tests
// always get a backend running the fast test pacing below.
export const BACKEND = 8010;
export const WEB = 8082;

// A whole mission in well under a minute. Same rules, shorter waits.
const TUNING = JSON.stringify({
  grace_s: 2, rest_s: 3, spawn_gap_s: 0.3, zombie_speed: 2,
});

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'output/artifacts',
  use: {
    baseURL: `http://localhost:${WEB}`,
    viewport: { width: 390, height: 844 },      // iPhone 14/15
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ['camera', 'geolocation'],
    channel,
    launchOptions: {
      executablePath,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${CAMERA}`],
    },
    trace: 'retain-on-failure',
  },
  // `npm run test:logic` runs only the browserless specs and needs no servers.
  webServer: process.env.LOGIC_ONLY ? undefined : [
    {
      // Use the backend's virtualenv when there is one.
      command: `cd ../../backend && PY=$([ -x .venv/bin/python ] && echo .venv/bin/python || echo python3) && exec $PY -m uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND} --log-level warning`,
      url: `http://127.0.0.1:${BACKEND}/health`,
      env: { LOONIE_TUNING: TUNING },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx serve -s ../dist -l ${WEB} --no-clipboard`,
      url: `http://localhost:${WEB}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
