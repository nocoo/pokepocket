import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import {
  assertGuardedInvocationLock,
  resolveGuardedOutputDir,
  BROWSER_TARGET_URL,
} from './scripts/browser-artifacts.ts';

const configDir = dirname(fileURLToPath(import.meta.url));

// Explicit guard: validate held machine lock and runner-owned invocation metadata BEFORE resolving output dir
const wsEndpoint = assertGuardedInvocationLock(configDir, 'required');
const outputDir = resolveGuardedOutputDir({ configDir, suiteSubdir: 'required' });

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: BROWSER_TARGET_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    connectOptions: {
      wsEndpoint,
    },
  },
  reporter: [['line'], ['json', { outputFile: `${outputDir}/report.json` }]],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
