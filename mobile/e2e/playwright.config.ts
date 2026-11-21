import { defineConfig } from '@playwright/test';
import * as fs from 'node:fs';

// The remote sandbox ships Chromium outside Playwright's default cache.
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync(PREINSTALLED) ? PREINSTALLED : undefined);

const BACKEND = 8000;
const WEB = 8081;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
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
    launchOptions: {
      executablePath,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `cd ../../backend && python3 -m uvicorn app.main:app --host 0.0.0.0 --port ${BACKEND} --log-level warning`,
      url: `http://127.0.0.1:${BACKEND}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `npx serve -s ../dist -l ${WEB} --no-clipboard`,
      url: `http://localhost:${WEB}`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
