import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/optional',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:27047',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
  ],
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 27047',
        url: 'http://127.0.0.1:27047',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
});
