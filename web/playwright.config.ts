import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. Specs live in e2e/ (vitest owns *.test.ts under lib/ and
 * prisma/). The app must already be running — point PLAYWRIGHT_BASE_URL at it
 * (defaults to the dev server on :4001) — so parallel worktrees can each test
 * their own port.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './e2e/.results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
