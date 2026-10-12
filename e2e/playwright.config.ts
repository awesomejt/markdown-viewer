import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Runs inside the pinned Playwright image (see the Makefile `e2e` target): the repo is mounted at
// /src and the working directory is /src/e2e. The built, static build/mdv binary runs in the same container.
const repo = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.E2E_PORT ?? 18080);
const baseURL = `http://127.0.0.1:${port}`;

// Writable root for the live-reload specs (under the ignored build/; fixtures are tracked and read-only).
// `make e2e` clears it first; specs use unique file names. The server needs the directory to exist at start.
const liveDir = path.join(repo, 'build/e2e/live');
mkdirSync(liveDir, { recursive: true });

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(repo, 'build/e2e/test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(repo, 'build/e2e/report'), open: 'never' }],
  ],
  forbidOnly: true,
  retries: 0,
  fullyParallel: true,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  // T1 adds firefox, webkit and an iPad (WebKit device descriptor) project here.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: path.join(repo, 'build/mdv'),
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    stdout: 'ignore',
    env: {
      MDV_LISTEN: `127.0.0.1:${port}`,
      MDV_ROOTS: `fixtures=${path.join(repo, 'testdata/fixtures')},live=${liveDir}:poll`,
      MDV_POLL_INTERVAL: '300ms',
    },
  },
});
