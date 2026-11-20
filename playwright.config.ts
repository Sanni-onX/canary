import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.platform === 'win32' ? 'msedge' : undefined } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.platform === 'win32' ? 'msedge' : undefined } },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
