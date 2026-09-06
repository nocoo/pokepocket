import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { resolveGuardedOutputDir } from './scripts/browser-artifacts.ts';

const configDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolveGuardedOutputDir({ configDir, suiteSubdir: 'required' });

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
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
});
