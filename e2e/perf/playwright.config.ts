import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Opt-in performance harness (`make perf`); not part of `make e2e` or `make check`. Runs inside the
// pinned Playwright image with the repo mounted at /src and the working directory /src/e2e/perf.
const repo = path.resolve(import.meta.dirname, '../..');
const perf = path.join(repo, 'build/perf');
const port = Number(process.env.PERF_PORT ?? 18081); // e2e uses 18080
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'perf.spec.ts',
  outputDir: path.join(perf, 'test-results'),
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  reporter: [['list']],
  forbidOnly: true,
  workers: 1, // one measurement at a time
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  use: { baseURL },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'ipad', use: { ...devices['iPad Pro 11'] } },
  ],
  webServer: {
    command: path.join(repo, 'build/mdv'),
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    stdout: 'ignore',
    env: {
      MDV_LISTEN: `127.0.0.1:${port}`,
      MDV_ROOTS: `perf=${perf}`,
    },
  },
});
