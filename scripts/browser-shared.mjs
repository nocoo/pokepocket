import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const BROWSER_PORT = 27047;
export const BROWSER_TARGET_URL = `http://127.0.0.1:${BROWSER_PORT}`;

export const ARTIFACTS_ROOT_NAME = 'test-results';
export const OWNERSHIP_MARKER_MAGIC = 'pokepocket-owned-artifacts-v1';
export const LOCK_METADATA_HEADER = 'POKEPOCKET_BROWSER_LOCK_V1';

export const ENV_BROWSER_NONCE = 'POKEPOCKET_BROWSER_RUN_NONCE';
export const ENV_BROWSER_RESOURCE_ROOT = 'POKEPOCKET_BROWSER_RESOURCE_ROOT';
export const ENV_BROWSER_PORT = 'POKEPOCKET_BROWSER_PORT';
export const ENV_BROWSER_PID = 'POKEPOCKET_BROWSER_PID';
export const ENV_BROWSER_WS = 'POKEPOCKET_BROWSER_WS';

export const REQUIRED_TEST_COUNT = 23; // 21 core/feature journeys + 2 authorization tests
export const OPTIONAL_TEST_COUNT = 16; // 13 series + 3 commercial

export const FORBIDDEN_CLI_FLAGS = new Set([
  '--output',
  '-o',
  '--reporter',
  '--add-reporter',
  '--last-failed-file',
]);

export const FORBIDDEN_OUTPUT_ENVS = [
  'PW_TEST_REPORTER',
  'PLAYWRIGHT_BLOB_OUTPUT_DIR',
  'PLAYWRIGHT_BLOB_OUTPUT_FILE',
  'PLAYWRIGHT_BLOB_OUTPUT_NAME',
  'PLAYWRIGHT_HTML_OUTPUT_DIR',
  'PLAYWRIGHT_HTML_REPORT',
  'PLAYWRIGHT_JSON_OUTPUT_DIR',
  'PLAYWRIGHT_JSON_OUTPUT_FILE',
  'PLAYWRIGHT_JSON_OUTPUT_NAME',
  'PLAYWRIGHT_JUNIT_OUTPUT_DIR',
  'PLAYWRIGHT_JUNIT_OUTPUT_FILE',
  'PLAYWRIGHT_JUNIT_OUTPUT_NAME',
  'PLAYWRIGHT_LAST_RUN_OUTPUT_FILE',
  'PLAYWRIGHT_PERFETTO_OUTPUT_DIR',
  'PLAYWRIGHT_PERFETTO_OUTPUT_FILE',
  'PLAYWRIGHT_PERFETTO_OUTPUT_NAME',
];

export function validateBrowserTarget(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('Target URL must be a non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_err) {
    throw new Error(`Target URL is malformed: ${url}`);
  }

  if (parsed.protocol !== 'http:') {
    throw new Error(`Target protocol must be "http:", received "${parsed.protocol}"`);
  }
  if (parsed.hostname !== '127.0.0.1') {
    throw new Error(`Target hostname must be strictly "127.0.0.1", received "${parsed.hostname}"`);
  }
  if (parsed.port !== String(BROWSER_PORT)) {
    throw new Error(`Target port must be strictly ${BROWSER_PORT}, received "${parsed.port}"`);
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`Target URL must not contain a path, received "${parsed.pathname}"`);
  }
  if (parsed.search) {
    throw new Error(`Target URL must not contain query parameters, received "${parsed.search}"`);
  }
  if (parsed.hash) {
    throw new Error(`Target URL must not contain hash, received "${parsed.hash}"`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Target URL must not contain credentials');
  }

  return BROWSER_TARGET_URL;
}

export function validateBrowserWsEndpoint(wsUrl) {
  if (typeof wsUrl !== 'string' || !wsUrl.trim()) {
    throw new Error('Browser wsEndpoint must be a non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(wsUrl);
  } catch (_err) {
    throw new Error(`Browser wsEndpoint is malformed: ${wsUrl}`);
  }
  if (parsed.protocol !== 'ws:') {
    throw new Error(`Browser wsEndpoint protocol must be "ws:", received "${parsed.protocol}"`);
  }
  if (parsed.hostname !== '127.0.0.1') {
    throw new Error(
      `Browser wsEndpoint hostname must be strictly "127.0.0.1", received "${parsed.hostname}"`,
    );
  }
  return wsUrl;
}

export function assertNoForbiddenInvocation(argv = process.argv, env = process.env) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== 'string') continue;
    if (FORBIDDEN_CLI_FLAGS.has(arg)) {
      throw new Error(
        `Raw Playwright CLI flag "${arg}" is forbidden; use guarded configuration defaults.`,
      );
    }
    for (const flag of FORBIDDEN_CLI_FLAGS) {
      if (arg.startsWith(`${flag}=`)) {
        throw new Error(
          `Raw Playwright CLI flag "${arg}" is forbidden; use guarded configuration defaults.`,
        );
      }
    }
  }

  for (const envKey of FORBIDDEN_OUTPUT_ENVS) {
    if (env[envKey]) {
      throw new Error(`Overriding ${envKey} is forbidden.`);
    }
  }

  const testBaseUrl = env.TEST_BASE_URL;
  if (testBaseUrl !== undefined && testBaseUrl !== '') {
    validateBrowserTarget(testBaseUrl);
  }
}

export function getMachineLockParent() {
  const candidates = ['/tmp', '/var/tmp'];
  for (const cand of candidates) {
    if (existsSync(cand)) {
      try {
        const canonical = realpathSync(cand);
        const st = lstatSync(canonical);
        if (st.isDirectory()) {
          return canonical;
        }
      } catch {
        // continue
      }
    }
  }
  throw new Error('No stable machine-local tmp directory found (/tmp, /var/tmp)');
}

export function getBrowserLockPath(port = BROWSER_PORT) {
  const parent = getMachineLockParent();
  return path.join(parent, `pokepocket-browser-${port}.lock`);
}
