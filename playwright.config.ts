import { defineConfig, devices } from '@playwright/test';

// End-to-end flows against the local dev server (local D1/R2, DEV_BYPASS_AUTH=1).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4321',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:4321/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
