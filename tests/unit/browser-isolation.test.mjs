import { describe, expect, it, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  lstatSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acquireBrowserLock,
  BROWSER_PORT,
  getBrowserLockPath,
  getMachineLockParent,
  readAndVerifyHeldLock,
  validateBrowserTarget,
} from '../../scripts/browser-lock.mjs';
import {
  validatePlaywrightJsonReport,
  REQUIRED_TEST_COUNT,
} from '../../scripts/browser-report.mjs';
import { validateBrowserWsEndpoint } from '../../scripts/browser-shared.mjs';
import { parseL3Cli, runL3Gate } from '../../scripts/run-l3.mjs';

describe('browser target URL policy', () => {
  it('accepts strictly http://127.0.0.1:27047 and returns canonical target', () => {
    expect(validateBrowserTarget('http://127.0.0.1:27047')).toBe('http://127.0.0.1:27047');
    expect(validateBrowserTarget('http://127.0.0.1:27047/')).toBe('http://127.0.0.1:27047');
  });

  it('rejects empty or malformed URLs', () => {
    expect(() => validateBrowserTarget('')).toThrow('Target URL must be a non-empty string');
    expect(() => validateBrowserTarget('not-a-url')).toThrow('Target URL is malformed');
  });

  it('rejects non-http protocol (e.g. https)', () => {
    expect(() => validateBrowserTarget('https://127.0.0.1:27047')).toThrow(
      'Target protocol must be "http:"',
    );
  });

  it('rejects non-loopback hostnames (e.g. localhost, 0.0.0.0, external domains)', () => {
    expect(() => validateBrowserTarget('http://localhost:27047')).toThrow(
      'Target hostname must be strictly "127.0.0.1"',
    );
    expect(() => validateBrowserTarget('http://0.0.0.0:27047')).toThrow(
      'Target hostname must be strictly "127.0.0.1"',
    );
    expect(() => validateBrowserTarget('http://pokepocket.hexly.ai:27047')).toThrow(
      'Target hostname must be strictly "127.0.0.1"',
    );
  });

  it('rejects forbidden ports: dev 7047, preview 17047, L2 17048, or arbitrary ports', () => {
    expect(() => validateBrowserTarget('http://127.0.0.1:7047')).toThrow(
      'Target port must be strictly 27047',
    );
    expect(() => validateBrowserTarget('http://127.0.0.1:17047')).toThrow(
      'Target port must be strictly 27047',
    );
    expect(() => validateBrowserTarget('http://127.0.0.1:17048')).toThrow(
      'Target port must be strictly 27047',
    );
    expect(() => validateBrowserTarget('http://127.0.0.1:8080')).toThrow(
      'Target port must be strictly 27047',
    );
  });

  it('rejects paths, query params, hashes, and embedded credentials', () => {
    expect(() => validateBrowserTarget('http://127.0.0.1:27047/api/catalog')).toThrow(
      'Target URL must not contain a path',
    );
    expect(() => validateBrowserTarget('http://127.0.0.1:27047/?query=1')).toThrow(
      'Target URL must not contain query',
    );
    expect(() => validateBrowserTarget('http://127.0.0.1:27047/#hash')).toThrow(
      'Target URL must not contain hash',
    );
    expect(() => validateBrowserTarget('http://user:pass@127.0.0.1:27047')).toThrow(
      'Target URL must not contain credentials',
    );
  });
});

describe('browser machine-local port lock policy', () => {
  let tempDir;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('derives stable machine lock path in existing canonical /tmp or /var/tmp', () => {
    const parent = getMachineLockParent();
    expect(existsSync(parent)).toBe(true);
    const lockPath = getBrowserLockPath();
    expect(path.basename(lockPath)).toBe(`pokepocket-browser-${BROWSER_PORT}.lock`);
  });

  it('acquires lock exclusively, records metadata with live PID, and releases properly', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-test-'));
    const testLockFile = path.join(tempDir, 'test.lock');
    const resourceDir = path.join(tempDir, 'resource');
    mkdirSync(resourceDir);

    const lock = acquireBrowserLock({
      lockFilePath: testLockFile,
      suite: 'required',
      runResourceRoot: resourceDir,
    });

    expect(existsSync(testLockFile)).toBe(true);
    const verified = readAndVerifyHeldLock({
      lockFilePath: testLockFile,
      nonce: lock.nonce,
      suite: 'required',
      pid: process.pid,
      runResourceRoot: resourceDir,
    });
    expect(verified.header).toBe('POKEPOCKET_BROWSER_LOCK_V1');
    expect(verified.suite).toBe('required');

    lock.release();
    expect(existsSync(testLockFile)).toBe(false);
  });

  it('fails closed when lock file already exists (unowned / concurrency collision)', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-test-'));
    const testLockFile = path.join(tempDir, 'test.lock');
    const resourceDir = path.join(tempDir, 'resource');
    mkdirSync(resourceDir);

    writeFileSync(testLockFile, 'existing unowned content');

    expect(() =>
      acquireBrowserLock({
        lockFilePath: testLockFile,
        runResourceRoot: resourceDir,
      }),
    ).toThrow('already exists. Another run may be holding port');
  });

  it('fails closed when lock file is a pre-existing symbolic link', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-test-'));
    const targetFile = path.join(tempDir, 'target.txt');
    writeFileSync(targetFile, 'target');
    const symlinkLock = path.join(tempDir, 'test.lock');
    symlinkSync(targetFile, symlinkLock);
    const resourceDir = path.join(tempDir, 'resource');
    mkdirSync(resourceDir);

    expect(() =>
      acquireBrowserLock({
        lockFilePath: symlinkLock,
        runResourceRoot: resourceDir,
      }),
    ).toThrow('already exists');

    expect(() =>
      readAndVerifyHeldLock({
        lockFilePath: symlinkLock,
      }),
    ).toThrow('is a symbolic link. Rejection required');
  });

  it('readAndVerifyHeldLock fails closed when owner PID is dead (fake-PID stubbed with no real OS kill)', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-test-'));
    const testLockFile = path.join(tempDir, 'test.lock');
    const resourceDir = path.join(tempDir, 'resource');
    mkdirSync(resourceDir);

    writeFileSync(
      testLockFile,
      JSON.stringify({
        header: 'POKEPOCKET_BROWSER_LOCK_V1',
        port: 27047,
        pid: 99999999,
        checkoutDir: realpathSync(process.cwd()),
        suite: 'required',
        runResourceRoot: realpathSync(resourceDir),
        nonce: 'test-nonce',
      }),
    );

    const fakeIsProcessAlive = (_pid) => false;

    expect(() =>
      readAndVerifyHeldLock({
        lockFilePath: testLockFile,
        isProcessAliveFn: fakeIsProcessAlive,
      }),
    ).toThrow('is dead. Stale lock fails closed');
  });

  it('refuses to release lock if metadata or nonce does not match creator', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-test-'));
    const testLockFile = path.join(tempDir, 'test.lock');
    const resourceDir = path.join(tempDir, 'resource');
    mkdirSync(resourceDir);

    const lock = acquireBrowserLock({
      lockFilePath: testLockFile,
      runResourceRoot: resourceDir,
    });

    writeFileSync(
      testLockFile,
      JSON.stringify({
        header: 'POKEPOCKET_BROWSER_LOCK_V1',
        nonce: 'different-nonce',
        pid: process.pid,
      }),
    );

    expect(() => lock.release()).toThrow('Refusing to release lock: lock metadata mismatched');
  });

  it('readAndVerifyHeldLock detects PID, checkoutDir, suite, and resourceRoot mismatches', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-test-'));
    const testLockFile = path.join(tempDir, 'test.lock');
    const resourceDir = path.join(tempDir, 'resource');
    mkdirSync(resourceDir);

    const lock = acquireBrowserLock({
      lockFilePath: testLockFile,
      suite: 'required',
      nonce: 'nonce-123',
      pid: process.pid,
      runResourceRoot: resourceDir,
    });

    expect(() =>
      readAndVerifyHeldLock({
        lockFilePath: testLockFile,
        nonce: 'wrong-nonce',
      }),
    ).toThrow('Browser lock nonce mismatch');

    expect(() =>
      readAndVerifyHeldLock({
        lockFilePath: testLockFile,
        nonce: 'nonce-123',
        pid: 1, // different pid
      }),
    ).toThrow('Browser lock PID mismatch');

    expect(() =>
      readAndVerifyHeldLock({
        lockFilePath: testLockFile,
        nonce: 'nonce-123',
        suite: 'optional',
      }),
    ).toThrow('Browser lock suite mismatch');

    lock.release();
  });
});

describe('Playwright JSON report validator policy', () => {
  it('passes a fully compliant report with exact expected test count and passing stats', () => {
    const validReport = {
      errors: [],
      stats: { expected: REQUIRED_TEST_COUNT, unexpected: 0, flaky: 0, skipped: 0, duration: 5000 },
      suites: [
        {
          specs: Array.from({ length: REQUIRED_TEST_COUNT }, (_, i) => ({
            title: `spec ${i}`,
            ok: true,
            tests: [
              {
                expectedStatus: 'passed',
                status: 'expected',
                results: [{ status: 'passed', retry: 0 }],
              },
            ],
          })),
        },
      ],
    };

    const res = validatePlaywrightJsonReport(validReport, {
      expectedTestCount: REQUIRED_TEST_COUNT,
    });
    expect(res.totalTests).toBe(REQUIRED_TEST_COUNT);
  });

  it('rejects report with top-level runner errors', () => {
    const report = {
      errors: ['Global setup timed out'],
      stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [],
    };
    expect(() => validatePlaywrightJsonReport(report)).toThrow(
      'Playwright run encountered top-level errors',
    );
  });

  it('rejects report with zero test suites', () => {
    const report = {
      errors: [],
      stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [],
    };
    expect(() => validatePlaywrightJsonReport(report)).toThrow('contains zero test suites');
  });

  it('rejects report when unexpected failures or flaky tests exist', () => {
    const reportFail = {
      errors: [],
      stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
      suites: [{ specs: [] }],
    };
    expect(() => validatePlaywrightJsonReport(reportFail)).toThrow(
      'contains 1 unexpected failures',
    );

    const reportFlaky = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 1, skipped: 0 },
      suites: [{ specs: [] }],
    };
    expect(() => validatePlaywrightJsonReport(reportFlaky)).toThrow('contains 1 flaky tests');
  });

  it('rejects report with skipped tests', () => {
    const reportSkip = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 1 },
      suites: [{ specs: [] }],
    };
    expect(() => validatePlaywrightJsonReport(reportSkip)).toThrow('contains 1 skipped tests');
  });

  it('rejects expectedFailure masking (test.fail())', () => {
    const maskedReport = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              title: 'masked failure spec',
              ok: true,
              tests: [
                {
                  expectedStatus: 'failed',
                  status: 'expected',
                  results: [{ status: 'failed' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validatePlaywrightJsonReport(maskedReport)).toThrow(
      'Expected failure masking is forbidden',
    );
  });

  it('rejects tests with failed, retry, or non-passed result items', () => {
    const failedReport = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              title: 'spec with failure',
              ok: true,
              tests: [
                {
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ status: 'failed', retry: 0 }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validatePlaywrightJsonReport(failedReport)).toThrow(
      'Only "passed" results are allowed',
    );

    const retryReport = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              title: 'spec with multiple results',
              ok: true,
              tests: [
                {
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [
                    { status: 'timedOut', retry: 0 },
                    { status: 'passed', retry: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validatePlaywrightJsonReport(retryReport)).toThrow(
      'Retries or multiple executions are forbidden',
    );

    const retryCountReport = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              title: 'spec with retry 1',
              ok: true,
              tests: [
                {
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ status: 'passed', retry: 1 }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => validatePlaywrightJsonReport(retryCountReport)).toThrow(
      'Only first-attempt retry:0 is allowed',
    );
  });

  it('rejects report when executed test count does not match exact expected count', () => {
    const partialReport = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              title: 'spec 1',
              ok: true,
              tests: [
                {
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ status: 'passed', retry: 0 }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() =>
      validatePlaywrightJsonReport(partialReport, { expectedTestCount: REQUIRED_TEST_COUNT }),
    ).toThrow(`does not match required exact count of ${REQUIRED_TEST_COUNT}`);
  });
});

describe('runL3Gate CLI parsing and early invocation validation', () => {
  it('parses empty argv as required suite', () => {
    const parsed = parseL3Cli(['node', 'scripts/run-l3.mjs']);
    expect(parsed.isOptional).toBe(false);
  });

  it('rejects any flags including --optional in required CLI entry', () => {
    expect(() => parseL3Cli(['node', 'scripts/run-l3.mjs', '--optional'])).toThrow(
      /Unknown or unsupported CLI option "--optional" in required L3 gate/,
    );
  });

  it('rejects partial selectors and unknown CLI flags', () => {
    expect(() => parseL3Cli(['node', 'scripts/run-l3.mjs', '--grep', 'auth'])).toThrow(
      'Unknown or unsupported CLI option "--grep"',
    );
    expect(() => parseL3Cli(['node', 'scripts/run-l3.mjs', '--project', 'chromium'])).toThrow(
      'Unknown or unsupported CLI option "--project"',
    );
  });

  it('rejects forbidden env and output overrides in runL3Gate without triggering build/lock/browser effects', async () => {
    const savedExitCode = process.exitCode;
    let buildTriggered = false;
    let rootAllocated = false;
    let browserTriggered = false;

    try {
      const res = await runL3Gate({
        silent: true,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: { PW_TEST_REPORTER: 'json' },
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          rootAllocated = true;
          throw new Error('mkdtempFn should never be reached');
        },
        commandRunner: async () => {
          buildTriggered = true;
        },
        launchBrowserServerFn: async () => {
          browserTriggered = true;
          throw new Error(
            'launchBrowserServerFn should never be called when invocation is forbidden',
          );
        },
      });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(buildTriggered).toBe(false);
      expect(rootAllocated).toBe(false);
      expect(browserTriggered).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('rejects invalid TEST_BASE_URL without triggering build/lock/browser effects', async () => {
    const savedExitCode = process.exitCode;
    let buildTriggered = false;
    let rootAllocated = false;
    let browserTriggered = false;

    try {
      const res = await runL3Gate({
        silent: true,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: { TEST_BASE_URL: 'http://127.0.0.1:7047' },
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          rootAllocated = true;
          throw new Error('mkdtempFn should never be reached');
        },
        commandRunner: async () => {
          buildTriggered = true;
        },
        launchBrowserServerFn: async () => {
          browserTriggered = true;
          throw new Error('launchBrowserServerFn should never be called');
        },
      });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(buildTriggered).toBe(false);
      expect(rootAllocated).toBe(false);
      expect(browserTriggered).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });
});

describe('runL3Gate lifecycle order and settlement', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('executes in exact verified order: validate -> reject occupied port -> allocate root -> acquire lock -> build -> launch browser/runtime -> run tests -> settle -> rm root -> release lock', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-cwd-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const steps = [];

    let mockProcessAlive = true;
    const mockBrowserServer = {
      process: () => ({
        pid: 777771,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-order')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        steps.push('browser-close');
        mockProcessAlive = false;
      },
      kill: async () => {
        mockProcessAlive = false;
      },
    };

    let reportPathWritten = null;
    let capturedTestCmd = null;
    let capturedBuildCmd = null;
    let allocatedResourceRoot = null;

    const fakeRunner = async (cmds) => {
      for (const cmd of cmds) {
        if (cmd.command === 'npm' && cmd.args.includes('build')) {
          steps.push('build');
          capturedBuildCmd = { ...cmd };
          // Verify lock was acquired BEFORE build started
          expect(existsSync(isolatedLockFile)).toBe(true);
        } else if (cmd.command === 'npx') {
          steps.push('run-tests');
          capturedTestCmd = { ...cmd };
          // Verify browser-metadata.json exists, is non-symlink regular file, and has correct content
          const metaPath = path.join(allocatedResourceRoot, 'browser-metadata.json');
          expect(existsSync(metaPath)).toBe(true);
          const metaStat = lstatSync(metaPath);
          expect(metaStat.isSymbolicLink()).toBe(false);
          expect(metaStat.isFile()).toBe(true);
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          expect(meta.browserPid).toBe(777771);
          expect(meta.wsEndpoint).toBe('ws://127.0.0.1:9999/mock');
          expect(meta.port).toBe(27047);
          expect(typeof meta.lockNonce).toBe('string');
          expect(meta.browserProfilePath).toBe(path.join(isolatedCwd, 'profile-order'));

          reportPathWritten = path.resolve(isolatedCwd, 'test-results/required/report.json');
          mkdirSync(path.dirname(reportPathWritten), { recursive: true });
          writeFileSync(
            reportPathWritten,
            JSON.stringify({
              errors: [],
              stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
              suites: [
                {
                  specs: [
                    {
                      title: 'mock spec',
                      ok: true,
                      tests: [
                        {
                          expectedStatus: 'passed',
                          status: 'expected',
                          results: [{ status: 'passed', retry: 0 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          );
        }
      }
    };

    const mockMkdtemp = async (prefix) => {
      steps.push('allocate-root');
      allocatedResourceRoot = mkdtempSync(prefix);
      return allocatedResourceRoot;
    };

    const mockRm = async (target, opts) => {
      if (target === path.join(isolatedCwd, 'profile-order')) {
        steps.push('rm-profile');
      } else {
        steps.push('rm-root');
      }
      // Verify lock is STILL held while resources and profiles are being removed
      expect(existsSync(isolatedLockFile)).toBe(true);
      rmSync(target, opts);
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: mockMkdtemp,
        rmFn: mockRm,
        launchBrowserServerFn: async () => {
          steps.push('launch-browser');
          return mockBrowserServer;
        },
        isProcessAliveFn: (pid) => (pid === 777771 ? mockProcessAlive : pid === process.pid),
        commandRunner: fakeRunner,
        expectedTestCount: 1,
      });

      expect(ok).toBe(true);
      // Verify lock was released AFTER rm-root
      expect(existsSync(isolatedLockFile)).toBe(false);
      expect(steps).toEqual([
        'allocate-root',
        'build',
        'launch-browser',
        'run-tests',
        'browser-close',
        'rm-profile',
        'rm-root',
      ]);

      // Assert exact complete build and test execution commands, cwd, and owned env
      expect(capturedBuildCmd).toEqual({
        command: 'npm',
        args: ['run', 'build'],
        cwd: isolatedCwd,
      });
      expect(capturedTestCmd.command).toBe('npx');
      expect(capturedTestCmd.args).toEqual([
        'playwright',
        'test',
        '--config',
        'playwright.config.ts',
      ]);
      expect(capturedTestCmd.cwd).toBe(isolatedCwd);

      expect(capturedTestCmd.env.POKEPOCKET_BROWSER_RUN_NONCE).toBeDefined();
      expect(capturedTestCmd.env.POKEPOCKET_BROWSER_PID).toBe(String(process.pid));
      expect(capturedTestCmd.env.POKEPOCKET_BROWSER_PORT).toBe('27047');
      expect(capturedTestCmd.env.POKEPOCKET_BROWSER_WS).toBe('ws://127.0.0.1:9999/mock');
      expect(capturedTestCmd.env.POKEPOCKET_BROWSER_RESOURCE_ROOT).toBe(allocatedResourceRoot);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('retains owned signal listeners and lock during deferred cleanup across mixed/repeated signals', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-signal-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveBrowserCloseStarted;
    const browserCloseStarted = new Promise((resolve) => {
      resolveBrowserCloseStarted = resolve;
    });

    let releaseBrowserClose;
    const browserCloseDeferred = new Promise((resolve) => {
      releaseBrowserClose = resolve;
    });

    let mockProcessAlive = true;
    const mockBrowserServer = {
      process: () => ({
        pid: 777772,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-signal')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        resolveBrowserCloseStarted();
        await browserCloseDeferred;
        mockProcessAlive = false;
      },
      kill: async () => {
        mockProcessAlive = false;
      },
    };

    const fakeRunner = async (cmds) => {
      if (cmds[0].command === 'npm') return; // build passes
      throw new Error('Test suite interrupted');
    };

    let gateSettled = false;
    let gatePromise;
    try {
      gatePromise = runL3Gate({
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: fakeRunner,
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === 777772 ? mockProcessAlive : pid === process.pid),
        silent: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      // Await entry into deferred cleanup
      await browserCloseStarted;

      // During deferred cleanup, lock MUST be held
      expect(existsSync(isolatedLockFile)).toBe(true);

      const currentSigtermListeners = process.listeners('SIGTERM');
      const currentSigintListeners = process.listeners('SIGINT');
      expect(currentSigtermListeners.length).toBe(initialSigterm.length + 1);
      expect(currentSigintListeners.length).toBe(initialSigint.length + 1);
      const ownedSigtermListener = currentSigtermListeners.find(
        (fn) => !initialSigterm.includes(fn),
      );
      const ownedSigintListener = currentSigintListeners.find((fn) => !initialSigint.includes(fn));
      expect(ownedSigtermListener).toBeDefined();
      expect(ownedSigintListener).toBeDefined();

      // Emit first signal: SIGTERM
      process.emit('SIGTERM');
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(existsSync(isolatedLockFile)).toBe(true);

      // Emit repeat signal, then other signal
      process.emit('SIGTERM');
      process.emit('SIGINT');
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(existsSync(isolatedLockFile)).toBe(true);

      expect(gateSettled).toBe(false);

      // Release browser close to allow cleanup to finish
      releaseBrowserClose();

      const res = await gatePromise;
      expect(res).toBe(false);
      // First signal (SIGTERM -> 143) preserved despite subsequent SIGINT
      expect(process.exitCode).toBe(143);
      expect(existsSync(isolatedLockFile)).toBe(false);

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseBrowserClose) releaseBrowserClose();
      if (gatePromise) await gatePromise.catch(() => {});
      process.exitCode = savedExitCode;
    }
  });

  it('preserves timeout status when timeout occurs before signal', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-timeout-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveBuildStarted;
    const buildStarted = new Promise((resolve) => {
      resolveBuildStarted = resolve;
    });

    let resolveCleanupEntered;
    const enteredCleanup = new Promise((resolve) => {
      resolveCleanupEntered = resolve;
    });

    let releaseCleanup;
    const cleanupDeferred = new Promise((resolve) => {
      releaseCleanup = resolve;
    });

    const hangingBuildRunner = async (_cmds, opts) => {
      resolveBuildStarted();
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new Error('AbortError: build timed out'));
        });
      });
    };

    const deferredRm = async (target, opts) => {
      resolveCleanupEntered();
      await cleanupDeferred;
      rmSync(target, opts);
    };

    let gateSettled = false;
    let gatePromise;
    try {
      gatePromise = runL3Gate({
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => mkdtempSync(path.join(isolatedCwd, 'res-timeout-')),
        rmFn: deferredRm,
        commandRunner: hangingBuildRunner,
        timeoutMs: 50,
        silent: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      await buildStarted;
      // Await entry into deferred cleanup triggered by timeout
      await enteredCleanup;

      // Assert lock is held and owned listeners are active
      expect(existsSync(isolatedLockFile)).toBe(true);
      const currentSigtermListeners = process.listeners('SIGTERM');
      const currentSigintListeners = process.listeners('SIGINT');
      expect(currentSigtermListeners.length).toBe(initialSigterm.length + 1);
      expect(currentSigintListeners.length).toBe(initialSigint.length + 1);

      // Emit signals during deferred cleanup
      process.emit('SIGTERM');
      process.emit('SIGINT');
      expect(existsSync(isolatedLockFile)).toBe(true);
      expect(gateSettled).toBe(false);

      // Release cleanup settlement
      releaseCleanup();

      const res = await gatePromise;
      expect(res).toBe(false);
      // Timeout status (exitCode 1) preserved despite subsequent signals!
      expect(process.exitCode).toBe(1);
      expect(existsSync(isolatedLockFile)).toBe(false);

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseCleanup) releaseCleanup();
      if (gatePromise) await gatePromise.catch(() => {});
      process.exitCode = savedExitCode;
    }
  });

  it('stops before test execution and browser launch when production build fails in runL3Gate', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-build-fail-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let browserLaunched = false;
    const failingBuildRunner = async (commands) => {
      if (commands[0].command === 'npm' && commands[0].args.includes('build')) {
        throw new Error('Build error injection');
      }
    };

    const savedExitCode = process.exitCode;
    try {
      const res = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: failingBuildRunner,
        launchBrowserServerFn: async () => {
          browserLaunched = true;
          return {
            process: () => ({ pid: process.pid }),
            wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
            close: async () => {},
          };
        },
      });

      expect(res).toBe(false);
      expect(browserLaunched).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(existsSync(isolatedLockFile)).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });
});

describe('createLocalRomDevRuntime factory and lifecycle', () => {
  it('calls createViteServerFn with vite.optional.config.ts, exposes start/dispose, and settles cleanly', async () => {
    const { createLocalRomDevRuntime } = await import('../../scripts/run-l3.mjs');

    let listenCalled = false;
    let closeCalled = false;
    let capturedConfig = null;

    const fakeViteServer = {
      listen: async () => {
        listenCalled = true;
      },
      close: async () => {
        closeCalled = true;
      },
    };

    const fakeCreateViteServer = async (config) => {
      capturedConfig = config;
      return fakeViteServer;
    };

    const runtime = await createLocalRomDevRuntime({
      root: '/fake/root',
      port: 27047,
      resourceRoot: '/fake/resource',
      createViteServerFn: fakeCreateViteServer,
    });

    expect(listenCalled).toBe(false);
    expect(capturedConfig.configFile).toContain('vite.optional.config.ts');
    expect(capturedConfig.server.port).toBe(27047);
    expect(capturedConfig.server.strictPort).toBe(true);
    expect(capturedConfig.cacheDir).toBe(path.join('/fake/resource', '.vite-cache'));

    await runtime.start();
    expect(listenCalled).toBe(true);

    await runtime.dispose();
    expect(closeCalled).toBe(true);
  });

  it('throws when runtime.start() fails and delegates cleanup to dispose()', async () => {
    const { createLocalRomDevRuntime } = await import('../../scripts/run-l3.mjs');

    let closeCalled = false;
    const fakeViteServer = {
      listen: async () => {
        throw new Error('EADDRINUSE simulation');
      },
      close: async () => {
        closeCalled = true;
      },
    };

    const runtime = await createLocalRomDevRuntime({
      createViteServerFn: async () => fakeViteServer,
    });

    await expect(runtime.start()).rejects.toThrow('EADDRINUSE simulation');
    await runtime.dispose();
    expect(closeCalled).toBe(true);
  });

  it('rejects if signal is already aborted before starting local-ROM dev runtime', async () => {
    const { createLocalRomDevRuntime } = await import('../../scripts/run-l3.mjs');

    const controller = new AbortController();
    controller.abort();

    await expect(
      createLocalRomDevRuntime({
        signal: controller.signal,
      }),
    ).rejects.toThrow('Signal already aborted');
  });

  it('rejects in start() if signal was aborted after server creation but before start', async () => {
    const { createLocalRomDevRuntime } = await import('../../scripts/run-l3.mjs');

    const controller = new AbortController();
    const fakeViteServer = {
      listen: async () => {},
      close: async () => {},
    };

    const runtime = await createLocalRomDevRuntime({
      signal: controller.signal,
      createViteServerFn: async () => fakeViteServer,
    });

    controller.abort(new Error('Aborted after create'));
    await expect(runtime.start()).rejects.toThrow('Aborted after create');
  });
});

describe('browser lock and report edge case branches', () => {
  let tempDir;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid ports or suite names in acquireBrowserLock', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-edge-'));
    expect(() => acquireBrowserLock({ port: -1, runResourceRoot: tempDir })).toThrow(
      /Invalid port for browser lock/,
    );
    expect(() => acquireBrowserLock({ port: 999999, runResourceRoot: tempDir })).toThrow(
      /Invalid port for browser lock/,
    );
    expect(() =>
      acquireBrowserLock({ port: 27047, suite: 'invalid', runResourceRoot: tempDir }),
    ).toThrow(/Invalid suite for browser lock/);
    expect(() => acquireBrowserLock({ port: 27047, pid: -10, runResourceRoot: tempDir })).toThrow(
      /Invalid owner PID for browser lock/,
    );
    expect(() => acquireBrowserLock({ port: 27047 })).toThrow(
      /requires an explicit runResourceRoot/,
    );
  });

  it('handles lock file release when file became a symlink or already deleted', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-edge-'));
    const lockFile = path.join(tempDir, 'test.lock');
    const resDir = path.join(tempDir, 'res');
    mkdirSync(resDir);

    const lock = acquireBrowserLock({
      lockFilePath: lockFile,
      runResourceRoot: resDir,
    });

    // Delete directly: release() should silently return if ENOENT
    rmSync(lockFile);
    expect(() => lock.release()).not.toThrow();

    // Re-acquire and replace with symlink before release
    const lock2 = acquireBrowserLock({
      lockFilePath: lockFile,
      runResourceRoot: resDir,
    });
    rmSync(lockFile);
    symlinkSync(tempDir, lockFile);
    expect(() => lock2.release()).toThrow(/became a symbolic link/);
  });

  it('validates readAndVerifyHeldLock failures: not a file, invalid JSON, header mismatch, port mismatch', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'lock-edge-'));
    const lockFile = path.join(tempDir, 'test.lock');
    const resDir = path.join(tempDir, 'res');
    mkdirSync(resDir);

    // Directory instead of file
    mkdirSync(lockFile);
    expect(() => readAndVerifyHeldLock({ lockFilePath: lockFile })).toThrow(
      /is not a regular file/,
    );
    rmSync(lockFile, { recursive: true });

    // Invalid JSON
    writeFileSync(lockFile, 'not json');
    expect(() => readAndVerifyHeldLock({ lockFilePath: lockFile })).toThrow(
      /contains invalid JSON/,
    );

    // Header mismatch
    writeFileSync(lockFile, JSON.stringify({ header: 'WRONG' }));
    expect(() => readAndVerifyHeldLock({ lockFilePath: lockFile })).toThrow(/header mismatch/);

    // Port mismatch
    writeFileSync(lockFile, JSON.stringify({ header: 'POKEPOCKET_BROWSER_LOCK_V1', port: 1234 }));
    expect(() => readAndVerifyHeldLock({ lockFilePath: lockFile, port: 27047 })).toThrow(
      /port mismatch/,
    );

    // Invalid PID in lock
    writeFileSync(
      lockFile,
      JSON.stringify({ header: 'POKEPOCKET_BROWSER_LOCK_V1', port: 27047, pid: 'bad' }),
    );
    expect(() => readAndVerifyHeldLock({ lockFilePath: lockFile, port: 27047 })).toThrow(
      /not a valid integer process ID/,
    );

    // Empty nonce
    writeFileSync(
      lockFile,
      JSON.stringify({
        header: 'POKEPOCKET_BROWSER_LOCK_V1',
        port: 27047,
        pid: process.pid,
        nonce: '',
      }),
    );
    expect(() => readAndVerifyHeldLock({ lockFilePath: lockFile, port: 27047 })).toThrow(
      /empty or invalid nonce/,
    );

    // Checkout mismatch
    writeFileSync(
      lockFile,
      JSON.stringify({
        header: 'POKEPOCKET_BROWSER_LOCK_V1',
        port: 27047,
        pid: process.pid,
        nonce: 'n',
        checkoutDir: '/different/checkout',
      }),
    );
    expect(() =>
      readAndVerifyHeldLock({ lockFilePath: lockFile, port: 27047, checkoutDir: process.cwd() }),
    ).toThrow(/checkoutDir mismatch/);

    // ResourceRoot mismatch
    writeFileSync(
      lockFile,
      JSON.stringify({
        header: 'POKEPOCKET_BROWSER_LOCK_V1',
        port: 27047,
        pid: process.pid,
        nonce: 'n',
        checkoutDir: realpathSync(process.cwd()),
        runResourceRoot: '/different/root',
      }),
    );
    expect(() =>
      readAndVerifyHeldLock({
        lockFilePath: lockFile,
        port: 27047,
        checkoutDir: process.cwd(),
        runResourceRoot: resDir,
      }),
    ).toThrow(/resourceRoot mismatch/);
  });

  it('validates report with nested child suites and tests', () => {
    const report = {
      errors: [],
      stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: 'nested spec 1',
                  ok: true,
                  tests: [
                    {
                      expectedStatus: 'passed',
                      status: 'expected',
                      results: [{ status: 'passed', retry: 0 }],
                    },
                  ],
                },
                {
                  title: 'nested spec 2',
                  ok: true,
                  tests: [
                    {
                      expectedStatus: 'passed',
                      status: 'expected',
                      results: [{ status: 'passed', retry: 0 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const res = validatePlaywrightJsonReport(report, { expectedTestCount: 2 });
    expect(res.totalTests).toBe(2);
  });

  it('validates report reader file reading, parsing, and options', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'rep-edge-'));
    const repFile = path.join(tempDir, 'rep.json');

    expect(() => validatePlaywrightJsonReport(path.join(tempDir, 'missing.json'))).toThrow(
      /Failed to read Playwright JSON report/,
    );

    writeFileSync(repFile, 'bad json');
    expect(() => validatePlaywrightJsonReport(repFile)).toThrow(/contains malformed JSON/);

    expect(() => validatePlaywrightJsonReport(123)).toThrow(
      /Expected report object or string path/,
    );

    const validReport = {
      errors: [],
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [
        {
          specs: [
            {
              title: 's1',
              ok: true,
              tests: [
                {
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ status: 'passed', retry: 0 }],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(repFile, JSON.stringify(validReport));
    expect(() => validatePlaywrightJsonReport(repFile, { expectedSuiteCount: 5 })).toThrow(
      /suite count mismatch/,
    );

    // Spec not ok
    expect(() =>
      validatePlaywrightJsonReport({
        errors: [],
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [{ specs: [{ title: 'bad', ok: false }] }],
      }),
    ).toThrow(/is not ok/);

    // Spec with 0 tests
    expect(() =>
      validatePlaywrightJsonReport({
        errors: [],
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [{ specs: [{ title: 'no tests', ok: true, tests: [] }] }],
      }),
    ).toThrow(/contains no test entries/);

    // Test outcome status not 'expected'
    expect(() =>
      validatePlaywrightJsonReport({
        errors: [],
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [
          {
            specs: [
              {
                title: 's',
                ok: true,
                tests: [
                  {
                    expectedStatus: 'passed',
                    status: 'unexpected',
                    results: [{ status: 'passed', retry: 0 }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(/outcome status is "unexpected"/);

    // Test with no results
    expect(() =>
      validatePlaywrightJsonReport({
        errors: [],
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [
          {
            specs: [
              {
                title: 's',
                ok: true,
                tests: [{ expectedStatus: 'passed', status: 'expected', results: [] }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/has no results recorded/);

    // Test result with errors despite status passed
    expect(() =>
      validatePlaywrightJsonReport({
        errors: [],
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
        suites: [
          {
            specs: [
              {
                title: 's',
                ok: true,
                tests: [
                  {
                    expectedStatus: 'passed',
                    status: 'expected',
                    results: [{ status: 'passed', retry: 0, error: 'err' }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(/contains errors despite passing status/);
  });
});

describe('runL3Gate error handling and branch paths', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('handles optional suite execution with mock local ROM runtime', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-opt-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let runtimeLaunched = false;
    let runtimeDisposed = false;

    let mockProcessAlive = true;
    const mockBrowserServer = {
      process: () => ({
        pid: 777773,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-optional')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        mockProcessAlive = false;
      },
      kill: async () => {
        mockProcessAlive = false;
      },
    };

    const fakeRunner = async (cmds) => {
      for (const cmd of cmds) {
        if (cmd.command === 'npx') {
          const reportPathWritten = path.resolve(isolatedCwd, 'test-results/optional/report.json');
          mkdirSync(path.dirname(reportPathWritten), { recursive: true });
          writeFileSync(
            reportPathWritten,
            JSON.stringify({
              errors: [],
              stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
              suites: [
                {
                  specs: [
                    {
                      title: 'mock opt spec',
                      ok: true,
                      tests: [
                        {
                          expectedStatus: 'passed',
                          status: 'expected',
                          results: [{ status: 'passed', retry: 0 }],
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          );
        }
      }
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === 777773 ? mockProcessAlive : pid === process.pid),
        createLocalRomDevRuntimeFn: async () => {
          runtimeLaunched = true;
          return {
            server: {},
            dispose: async () => {
              runtimeDisposed = true;
            },
          };
        },
        commandRunner: fakeRunner,
        expectedTestCount: 1,
      });

      expect(ok).toBe(true);
      expect(runtimeLaunched).toBe(true);
      expect(runtimeDisposed).toBe(true);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('rejects when BrowserServer fails to capture valid PID or profile', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-bad-browser-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const savedExitCode = process.exitCode;
    try {
      // 1. Missing PID
      const res1 = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: async () => {},
        launchBrowserServerFn: async () => ({
          process: () => ({ pid: 0 }),
          wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
          close: async () => {},
        }),
      });
      expect(res1).toBe(false);

      // 2. Missing user-data-dir in spawnargs
      const res2 = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: async () => {},
        launchBrowserServerFn: async () => ({
          process: () => ({ pid: process.pid, spawnargs: ['chrome'] }),
          wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
          close: async () => {},
        }),
      });
      expect(res2).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('captures cleanup errors in runtime disposal and browser close', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-cleanup-err-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let browserCloseRan = false;
    let runtimeDisposeRan = false;
    let mockProcessAlive = true;

    const fakeBrowser = {
      process: () => ({
        pid: 777774,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-cleanup-err')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserCloseRan = true;
        mockProcessAlive = false;
        throw new Error('Forced browser close error');
      },
      kill: async () => {
        mockProcessAlive = false;
      },
    };

    const fakeRuntime = {
      server: {},
      dispose: async () => {
        runtimeDisposeRan = true;
        throw new Error('Forced runtime dispose error');
      },
    };

    const savedExitCode = process.exitCode;
    try {
      const res = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => mkdtempSync(path.join(isolatedCwd, 'res-cleanup-err-')),
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build succeeds!
          throw new Error('Forced test execution failure');
        },
        launchBrowserServerFn: async () => fakeBrowser,
        isProcessAliveFn: (pid) => (pid === 777774 ? mockProcessAlive : pid === process.pid),
        createLocalRomDevRuntimeFn: async () => fakeRuntime,
      });

      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(browserCloseRan).toBe(true);
      expect(runtimeDisposeRan).toBe(true);
    } finally {
      process.exitCode = savedExitCode;
    }
  });
});

describe('validateBrowserWsEndpoint policy', () => {
  it('accepts loopback ws endpoints', () => {
    expect(validateBrowserWsEndpoint('ws://127.0.0.1:9222/devtools/browser')).toBe(
      'ws://127.0.0.1:9222/devtools/browser',
    );
  });

  it('rejects empty or malformed ws URLs', () => {
    expect(() => validateBrowserWsEndpoint('')).toThrow(
      /Browser wsEndpoint must be a non-empty string/,
    );
    expect(() => validateBrowserWsEndpoint('not-a-url')).toThrow(/Browser wsEndpoint is malformed/);
  });

  it('rejects non-ws protocols (e.g. wss, http)', () => {
    expect(() => validateBrowserWsEndpoint('wss://127.0.0.1:9222/')).toThrow(
      /protocol must be "ws:"/,
    );
    expect(() => validateBrowserWsEndpoint('http://127.0.0.1:9222/')).toThrow(
      /protocol must be "ws:"/,
    );
  });

  it('rejects non-loopback hostnames', () => {
    expect(() => validateBrowserWsEndpoint('ws://localhost:9222/')).toThrow(
      /hostname must be strictly "127.0.0.1"/,
    );
    expect(() => validateBrowserWsEndpoint('ws://example.com:9222/')).toThrow(
      /hostname must be strictly "127.0.0.1"/,
    );
  });
});

describe('cleanup escalation, dual failure, and atomic lock write resilience', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('escalates to kill when BrowserServer.close hangs and terminates cleanly', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-hang-close-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let killCalled = false;
    let processAlive = true;
    const fakeBrowserPid = 888888;

    const mockBrowser = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-hang')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        // Hang forever
        await new Promise(() => {});
      },
      kill: async () => {
        killCalled = true;
        processAlive = false;
      },
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => mkdtempSync(path.join(isolatedCwd, 'res-hang-')),
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes!
          throw new Error('Test run error to trigger cleanup');
        },
        launchBrowserServerFn: async () => mockBrowser,
        isProcessAliveFn: (_pid) => processAlive,
        cleanupGraceMs: 50,
      });

      expect(ok).toBe(false);
      expect(killCalled).toBe(true);
      expect(processAlive).toBe(false);
      expect(existsSync(isolatedLockFile)).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('preserves resource root and holds lock when optional runtime dispose fails', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-rt-fail-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-rt-fail');

    let closeConnectionsCalled = false;
    let browserClosedCleanly = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777775;

    const fakeHttpServer = {
      closeAllConnections: () => {
        closeConnectionsCalled = true;
      },
    };

    // Model browser success: cleanly closes and terminates, so failure is SOLELY from runtime dispose
    const mockBrowser = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-rt-fail')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserClosedCleanly = true;
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes
          throw new Error('Test run injection to trigger cleanup');
        },
        launchBrowserServerFn: async () => mockBrowser,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        createLocalRomDevRuntimeFn: async () => ({
          server: { httpServer: fakeHttpServer },
          dispose: async () => {
            throw new Error('Vite server dispose timeout');
          },
        }),
        cleanupGraceMs: 50,
      });

      expect(ok).toBe(false);
      expect(browserClosedCleanly).toBe(true);
      expect(closeConnectionsCalled).toBe(true);

      // Verify resource root, browser-metadata.json, and lock are preserved!
      expect(existsSync(isolatedLockFile)).toBe(true);
      expect(existsSync(ownedResourceDir)).toBe(true);
      expect(existsSync(path.join(ownedResourceDir, 'browser-metadata.json'))).toBe(true);
    } finally {
      // Clean up only test-owned isolated state
      if (existsSync(isolatedLockFile)) {
        try {
          unlinkSync(isolatedLockFile);
        } catch (_e) {}
      }
      process.exitCode = savedExitCode;
    }
  });

  it('preserves resource root and holds lock on dual failure (kill cannot terminate process) with silent:false capturing both diagnostics', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-iso-dual-fail-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-dual-fail');

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    let killCalled = false;
    // Process stubbornly remains alive despite close and kill
    const processAlive = true;
    const fakeBrowserPid = 888889;

    const mockBrowser = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-dual-fail')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        throw new Error('Close socket destroyed');
      },
      kill: async () => {
        killCalled = true;
        throw new Error('Kill permission denied');
      },
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: false,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes!
          throw new Error('Test run injection');
        },
        launchBrowserServerFn: async () => mockBrowser,
        isProcessAliveFn: (pid) => (pid === fakeBrowserPid ? processAlive : pid === process.pid),
        cleanupGraceMs: 50,
      });

      expect(ok).toBe(false);
      expect(killCalled).toBe(true);

      // Verify both close error and kill error diagnostics are surfaced
      const allErrors = capturedErrors.join('\n');
      expect(allErrors).toContain('Close socket destroyed');
      expect(allErrors).toContain('Kill permission denied');

      // Dual failure must hold the lock and keep metadata so another process does not reuse port while browser is alive!
      expect(existsSync(isolatedLockFile)).toBe(true);
      expect(existsSync(ownedResourceDir)).toBe(true);
      expect(existsSync(path.join(ownedResourceDir, 'browser-metadata.json'))).toBe(true);
    } finally {
      console.error = origConsoleError;
      // Clean up only test-owned isolated state
      if (existsSync(isolatedLockFile)) {
        unlinkSync(isolatedLockFile);
      }
      process.exitCode = savedExitCode;
    }
  });

  it('acquireBrowserLock write failure cleans up exclusively created inode, allows subsequent acquire, leaves outside sentinel intact', () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-lock-atomic-'));
    const testLock = path.join(isolatedCwd, 'atomic.lock');
    const resDir = path.join(isolatedCwd, 'resource');
    mkdirSync(resDir);

    const outsideSentinel = path.join(isolatedCwd, 'sentinel.txt');
    writeFileSync(outsideSentinel, 'sentinel-intact');

    let writeAttempts = 0;
    const failingWriteSync = () => {
      writeAttempts++;
      throw new Error('Injected disk full simulation during lock payload write');
    };

    // First attempt fails during writeSync
    expect(() =>
      acquireBrowserLock({
        lockFilePath: testLock,
        runResourceRoot: resDir,
        writeSyncFn: failingWriteSync,
      }),
    ).toThrow(/Failed to exclusively acquire browser lock/);

    expect(writeAttempts).toBe(1);
    // Verified: failing acquisition cleaned up its own unwritten inode
    expect(existsSync(testLock)).toBe(false);
    expect(readFileSync(outsideSentinel, 'utf8')).toBe('sentinel-intact');

    // Subsequent normal acquire succeeds cleanly without leftover collision
    const lock2 = acquireBrowserLock({
      lockFilePath: testLock,
      runResourceRoot: resDir,
    });
    expect(existsSync(testLock)).toBe(true);
    lock2.release();
    expect(existsSync(testLock)).toBe(false);
    expect(readFileSync(outsideSentinel, 'utf8')).toBe('sentinel-intact');
  });

  it('acquireBrowserLock rollback refuses to unlink if target was replaced with a symlink during write failure', () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-lock-symlink-rollback-'));
    const testLock = path.join(isolatedCwd, 'symlink.lock');
    const resDir = path.join(isolatedCwd, 'resource');
    mkdirSync(resDir);

    const outsideTarget = path.join(isolatedCwd, 'outside-target.txt');
    writeFileSync(outsideTarget, 'preserve-target');

    // Simulate writeSync throwing after an attacker / concurrent agent replaced the created file with a symlink
    const replacingWriteSync = (_fd) => {
      try {
        unlinkSync(testLock);
      } catch (_e) {}
      symlinkSync(outsideTarget, testLock);
      throw new Error('Simulated write error after external symlink swap');
    };

    expect(() =>
      acquireBrowserLock({
        lockFilePath: testLock,
        runResourceRoot: resDir,
        writeSyncFn: replacingWriteSync,
      }),
    ).toThrow(/Failed to exclusively acquire browser lock/);

    // Rollback refused to unlink the replaced symlink or the outside target
    expect(existsSync(outsideTarget)).toBe(true);
    expect(readFileSync(outsideTarget, 'utf8')).toBe('preserve-target');
  });

  it('acquireBrowserLock rejects short write (0 bytes written)', () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-lock-short-write-'));
    const testLock = path.join(isolatedCwd, 'short.lock');
    const resDir = path.join(isolatedCwd, 'resource');
    mkdirSync(resDir);

    const zeroWriteSync = () => 0;

    expect(() =>
      acquireBrowserLock({
        lockFilePath: testLock,
        runResourceRoot: resDir,
        writeSyncFn: zeroWriteSync,
      }),
    ).toThrow(/Short write while recording browser lock payload/);

    expect(existsSync(testLock)).toBe(false);
  });

  it('acquireBrowserLock succeeds across multiple chunked partial writes, produces complete valid lock verified by readAndVerifyHeldLock, and releases cleanly', () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-lock-partial-write-'));
    const testLock = path.join(isolatedCwd, 'partial.lock');
    const resDir = path.join(isolatedCwd, 'resource');
    mkdirSync(resDir);

    let writeCalls = 0;
    const chunkedWriteSync = (fd, buffer, offset, length) => {
      writeCalls++;
      // Write small slice each time (e.g. 17 bytes)
      const sliceLen = Math.min(length, 17);
      return writeSync(fd, buffer, offset, sliceLen);
    };

    const lock = acquireBrowserLock({
      lockFilePath: testLock,
      runResourceRoot: resDir,
      suite: 'required',
      writeSyncFn: chunkedWriteSync,
    });

    expect(writeCalls).toBeGreaterThan(1);
    expect(existsSync(testLock)).toBe(true);

    const verified = readAndVerifyHeldLock({
      lockFilePath: testLock,
      nonce: lock.nonce,
      suite: 'required',
      pid: process.pid,
      runResourceRoot: resDir,
    });
    expect(verified.header).toBe('POKEPOCKET_BROWSER_LOCK_V1');
    expect(verified.port).toBe(27047);
    expect(verified.suite).toBe('required');
    expect(verified.pid).toBe(process.pid);
    expect(verified.runResourceRoot).toBe(realpathSync(resDir));
    expect(verified.nonce).toBe(lock.nonce);

    lock.release();
    expect(existsSync(testLock)).toBe(false);
  });
});

describe('optional dev runtime ownership and startup resilience', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('listen rejection + successful close: releases root and lock, preserves listen error in diagnostics', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-opt-listen-fail-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-listen-fail');

    const savedExitCode = process.exitCode;
    const savedListenersSigint = process.listeners('SIGINT');
    const savedListenersSigterm = process.listeners('SIGTERM');

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    let browserClosed = false;
    let browserKillCalled = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777781;
    const mockBrowserServer = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-listen-fail')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserClosed = true;
        mockBrowserAlive = false;
      },
      kill: async () => {
        browserKillCalled = true;
        mockBrowserAlive = false;
      },
    };

    let serverCloseCalled = false;
    const fakeViteServer = {
      listen: async () => {
        throw new Error('Simulated Vite listen EADDRINUSE failure');
      },
      close: async () => {
        serverCloseCalled = true;
      },
    };

    try {
      const ok = await runL3Gate({
        silent: false,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes
          throw new Error('commandRunner should never be called for test execution');
        },
        createViteServerFn: async () => fakeViteServer,
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(serverCloseCalled).toBe(true);
      expect(browserClosed).toBe(true);
      // Clean close means kill was NOT called
      expect(browserKillCalled).toBe(false);

      // Verify real listen error text in diagnostics
      const errText = capturedErrors.join('\n');
      expect(errText).toContain('Simulated Vite listen EADDRINUSE failure');

      // Clean disposal of both browser and runtime allows root and lock to be released
      expect(existsSync(isolatedLockFile)).toBe(false);
      expect(existsSync(ownedResourceDir)).toBe(false);

      expect(process.listeners('SIGINT')).toEqual(savedListenersSigint);
      expect(process.listeners('SIGTERM')).toEqual(savedListenersSigterm);
    } finally {
      console.error = origConsoleError;
      process.exitCode = savedExitCode;
    }
  });

  it('listen rejection + close rejection: retains root, browser metadata, and lock with silent:false capturing both errors', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-opt-listen-close-fail-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-close-fail');

    const savedExitCode = process.exitCode;
    const savedListenersSigint = process.listeners('SIGINT');
    const savedListenersSigterm = process.listeners('SIGTERM');

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    let browserClosed = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777782;
    const mockBrowserServer = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-close-fail')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserClosed = true;
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    let closeConnectionsCalled = false;
    const fakeViteServer = {
      httpServer: {
        closeAllConnections: () => {
          closeConnectionsCalled = true;
        },
      },
      listen: async () => {
        throw new Error('Simulated Vite listen port error');
      },
      close: async () => {
        throw new Error('Simulated Vite close socket error');
      },
    };

    try {
      const ok = await runL3Gate({
        silent: false,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes
          throw new Error('commandRunner should never be called for test execution');
        },
        createViteServerFn: async () => fakeViteServer,
        cleanupGraceMs: 50,
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(browserClosed).toBe(true);
      expect(closeConnectionsCalled).toBe(true);

      // Verify BOTH initial listen execution error and cleanup close error are logged to diagnostics
      const allErrors = capturedErrors.join('\n');
      expect(allErrors).toContain('Simulated Vite listen port error');
      expect(allErrors).toContain('Simulated Vite close socket error');

      // Close failed: runtime termination NOT confirmed -> retain root, metadata, and lock!
      expect(existsSync(isolatedLockFile)).toBe(true);
      expect(existsSync(ownedResourceDir)).toBe(true);
      expect(existsSync(path.join(ownedResourceDir, 'browser-metadata.json'))).toBe(true);

      expect(process.listeners('SIGINT')).toEqual(savedListenersSigint);
      expect(process.listeners('SIGTERM')).toEqual(savedListenersSigterm);
    } finally {
      console.error = origConsoleError;
      if (existsSync(isolatedLockFile)) {
        unlinkSync(isolatedLockFile);
      }
      process.exitCode = savedExitCode;
    }
  });

  it('listen rejection + hanging close: bounded settlement, retains root and lock', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-opt-hang-close-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-hang-close');

    const savedExitCode = process.exitCode;
    const savedListenersSigint = process.listeners('SIGINT');
    const savedListenersSigterm = process.listeners('SIGTERM');

    let browserClosed = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777783;
    const mockBrowserServer = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-hang-close')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserClosed = true;
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    let releaseHangingClose;
    const hangingClosePromise = new Promise((resolve) => {
      releaseHangingClose = resolve;
    });
    let hangingCloseResolved;
    const hangingCloseFinished = new Promise((resolve) => {
      hangingCloseResolved = resolve;
    });

    const fakeViteServer = {
      listen: async () => {
        throw new Error('Simulated listen failure');
      },
      close: async () => {
        try {
          await hangingClosePromise;
        } finally {
          hangingCloseResolved();
        }
      },
    };

    try {
      const ok = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes
          throw new Error('commandRunner should never be called for test execution');
        },
        createViteServerFn: async () => fakeViteServer,
        cleanupGraceMs: 50,
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(browserClosed).toBe(true);

      // Hanging close exceeded bounded cleanup grace (50ms) -> retains lock and root!
      expect(existsSync(isolatedLockFile)).toBe(true);
      expect(existsSync(ownedResourceDir)).toBe(true);
      expect(existsSync(path.join(ownedResourceDir, 'browser-metadata.json'))).toBe(true);

      expect(process.listeners('SIGINT')).toEqual(savedListenersSigint);
      expect(process.listeners('SIGTERM')).toEqual(savedListenersSigterm);
    } finally {
      if (releaseHangingClose) releaseHangingClose();
      if (hangingCloseFinished) await hangingCloseFinished;
      if (existsSync(isolatedLockFile)) {
        unlinkSync(isolatedLockFile);
      }
      process.exitCode = savedExitCode;
    }
  });

  it('pending listen still deferred past cleanup grace: timeout fails with abort reason, zero test commands, retains root and lock', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-opt-timeout-listen-deferred-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-timeout-deferred');

    const savedExitCode = process.exitCode;
    const savedListenersSigint = process.listeners('SIGINT');
    const savedListenersSigterm = process.listeners('SIGTERM');

    let browserClosed = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777784;
    const mockBrowserServer = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: [
          'chrome',
          `--user-data-dir=${path.join(isolatedCwd, 'profile-timeout-deferred')}`,
        ],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserClosed = true;
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    let resolveListenStarted;
    const listenStarted = new Promise((resolve) => {
      resolveListenStarted = resolve;
    });

    let releaseListen;
    const listenDeferred = new Promise((resolve) => {
      releaseListen = resolve;
    });

    let capturedSignal1 = null;
    let serverActive = false;
    let closeCalled = false;
    let resolveCloseFinished;
    const closeFinished = new Promise((resolve) => {
      resolveCloseFinished = resolve;
    });

    const fakeViteServer = {
      listen: async () => {
        resolveListenStarted();
        await listenDeferred;
        serverActive = true;
      },
      close: async () => {
        closeCalled = true;
        serverActive = false;
        resolveCloseFinished();
      },
    };

    let testCommandCalls = 0;
    let gatePromise;
    try {
      gatePromise = runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        commandRunner: async (cmds, cmdOpts) => {
          if (cmds[0].command === 'npm') {
            capturedSignal1 = cmdOpts?.signal;
            return; // build passes
          }
          testCommandCalls++;
        },
        createViteServerFn: async () => fakeViteServer,
        timeoutMs: 50,
        cleanupGraceMs: 50,
      });

      // Await pending listen started
      await listenStarted;

      // Keep listenDeferred pending past gate cleanup grace -> dispose times out
      const ok = await gatePromise;
      expect(ok).toBe(false);

      // Gate timed out: test suite command must never have been called
      expect(testCommandCalls).toBe(0);

      // Timeout abort status preserved (exitCode 1) and exact abort reason
      expect(process.exitCode).toBe(1);
      expect(capturedSignal1?.aborted).toBe(true);
      expect(capturedSignal1?.reason?.message).toContain('L3 gate timed out after 50ms');
      expect(browserClosed).toBe(true);

      // Because underlying listen was not settled within cleanup grace, disposal could not confirm termination -> retain lock & root!
      expect(existsSync(isolatedLockFile)).toBe(true);
      expect(existsSync(ownedResourceDir)).toBe(true);
      expect(existsSync(path.join(ownedResourceDir, 'browser-metadata.json'))).toBe(true);
      expect(closeCalled).toBe(false);
      expect(serverActive).toBe(false);

      expect(process.listeners('SIGINT')).toEqual(savedListenersSigint);
      expect(process.listeners('SIGTERM')).toEqual(savedListenersSigterm);
    } finally {
      // Resolve deferred startup in finally and await disposal before removing test-owned files
      if (releaseListen) releaseListen();
      if (gatePromise) await gatePromise.catch(() => {});
      await closeFinished;
      expect(closeCalled).toBe(true);
      expect(serverActive).toBe(false);
      if (existsSync(isolatedLockFile)) {
        unlinkSync(isolatedLockFile);
      }
      process.exitCode = savedExitCode;
    }
  });

  it('pending listen resolving during cleanup: close runs after listen settled, late serverActive is false, root and lock released', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-opt-timeout-listen-settled-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResourceDir = path.join(isolatedCwd, 'res-timeout-settled');

    const savedExitCode = process.exitCode;
    const savedListenersSigint = process.listeners('SIGINT');
    const savedListenersSigterm = process.listeners('SIGTERM');

    let browserClosed = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777785;
    let resolveCleanupEntered;
    const cleanupEntered = new Promise((resolve) => {
      resolveCleanupEntered = resolve;
    });

    const mockBrowserServer = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: [
          'chrome',
          `--user-data-dir=${path.join(isolatedCwd, 'profile-timeout-settled')}`,
        ],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        browserClosed = true;
        mockBrowserAlive = false;
        resolveCleanupEntered();
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    let resolveListenStarted;
    const listenStarted = new Promise((resolve) => {
      resolveListenStarted = resolve;
    });

    let releaseListen;
    const listenDeferred = new Promise((resolve) => {
      releaseListen = resolve;
    });

    let capturedSignal2 = null;

    let serverActive = false;
    let closeRuns = 0;
    let closeSawServerActive = false;
    let resolveCloseFinished;
    const closeFinished = new Promise((resolve) => {
      resolveCloseFinished = resolve;
    });

    const fakeViteServer = {
      listen: async () => {
        resolveListenStarted();
        await listenDeferred;
        serverActive = true;
      },
      close: async () => {
        closeRuns++;
        closeSawServerActive = serverActive;
        serverActive = false;
        resolveCloseFinished();
      },
    };

    let testCommandCalls = 0;
    let gatePromise;
    try {
      gatePromise = runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        suite: 'optional',
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          mkdirSync(ownedResourceDir, { recursive: true });
          return ownedResourceDir;
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        commandRunner: async (cmds, cmdOpts) => {
          if (cmds[0].command === 'npm') {
            capturedSignal2 = cmdOpts?.signal;
            return; // build passes
          }
          testCommandCalls++;
        },
        createViteServerFn: async () => fakeViteServer,
        timeoutMs: 50,
        cleanupGraceMs: 300,
      });

      // Await pending listen started
      await listenStarted;

      // Await cleanup entry triggered by timeout, then resolve listen while cleanup is active
      await cleanupEntered;
      releaseListen();

      const ok = await gatePromise;
      expect(ok).toBe(false);

      // Gate timed out: test suite command must never have been called
      expect(testCommandCalls).toBe(0);

      // Timeout abort status preserved (exitCode 1) and exact abort reason
      expect(process.exitCode).toBe(1);
      expect(capturedSignal2?.aborted).toBe(true);
      expect(capturedSignal2?.reason?.message).toContain('L3 gate timed out after 50ms');
      expect(browserClosed).toBe(true);
      expect(closeRuns).toBe(1);

      // Close must have run AFTER listen resolved (saw serverActive === true and turned it false)
      expect(closeSawServerActive).toBe(true);
      expect(serverActive).toBe(false);

      // Clean termination of browser and vite server allows root and lock to be released
      expect(existsSync(isolatedLockFile)).toBe(false);
      expect(existsSync(ownedResourceDir)).toBe(false);

      expect(process.listeners('SIGINT')).toEqual(savedListenersSigint);
      expect(process.listeners('SIGTERM')).toEqual(savedListenersSigterm);
    } finally {
      if (releaseListen) releaseListen();
      if (gatePromise) await gatePromise.catch(() => {});
      await closeFinished;
      process.exitCode = savedExitCode;
    }
  });
});
