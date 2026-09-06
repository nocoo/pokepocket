import { describe, expect, it, vi, afterEach } from 'vitest';
import { runL3Optional } from '../../scripts/run-l3-optional.mjs';
import { runL3Gate, runL3TestsAndReport } from '../../scripts/run-l3.mjs';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { runParallelMock, portCheckMock, launchServerMock, createViteServerMock } = vi.hoisted(
  () => ({
    runParallelMock: vi.fn(),
    portCheckMock: vi.fn(),
    launchServerMock: vi.fn(),
    createViteServerMock: vi.fn(),
  }),
);

vi.mock('../../scripts/run-parallel.mjs', () => ({
  runParallelCommands: runParallelMock,
}));
vi.mock('../../scripts/production-runtime.mjs', () => ({
  checkPortAvailable: portCheckMock,
}));
vi.mock('@playwright/test', () => ({
  chromium: { launchServer: launchServerMock },
}));
vi.mock('vite', () => ({
  createServer: createViteServerMock,
}));

describe('runL3Optional entry and wrapper contracts', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('forces suite to "optional", uses optional report path and playwright.optional.config.ts', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-opt-entry-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let capturedTestCmd = null;
    let runtimeLaunched = false;
    let runtimeDisposed = false;
    let mockBrowserAlive = true;

    const mockBrowserServer = {
      process: () => ({
        pid: 777791,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-opt')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    const fakeRunner = async (cmds) => {
      for (const cmd of cmds) {
        if (cmd.command === 'npx') {
          capturedTestCmd = { ...cmd };
          const repPath = path.resolve(isolatedCwd, 'test-results/optional/report.json');
          mkdirSync(path.dirname(repPath), { recursive: true });
          writeFileSync(
            repPath,
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
      const ok = await runL3Optional({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3-optional.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === 777791 ? mockBrowserAlive : pid === process.pid),
        createLocalRomDevRuntimeFn: async () => {
          runtimeLaunched = true;
          return {
            server: {},
            start: async () => {},
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
      expect(capturedTestCmd.args).toEqual([
        'playwright',
        'test',
        '--config',
        'playwright.optional.config.ts',
      ]);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('rejects selectors and flags in optional wrapper before allocating resources or launching runtime', async () => {
    let rootAllocated = false;
    let browserTriggered = false;

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Optional({
        silent: true,
        argv: ['node', 'scripts/run-l3-optional.mjs', '--grep', 'test'],
        env: {},
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          rootAllocated = true;
          throw new Error('Should not be called');
        },
        launchBrowserServerFn: async () => {
          browserTriggered = true;
          throw new Error('Should not be called');
        },
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(rootAllocated).toBe(false);
      expect(browserTriggered).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });
});

describe('runL3Gate lifecycle regressions and error branches', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('(1) occupied-port case supplies explicit clean argv/env, asserts port-check call and intended diagnostic', async () => {
    let portCheckCalled = false;
    let rootAllocated = false;
    let buildExecuted = false;
    let browserLaunched = false;

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: false,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        checkPortAvailableFn: async (port, host) => {
          portCheckCalled = true;
          expect(port).toBe(27047);
          expect(host).toBe('127.0.0.1');
          return {
            available: false,
            error: { code: 'EADDRINUSE' },
          };
        },
        mkdtempFn: async () => {
          rootAllocated = true;
          throw new Error('Should not be called');
        },
        commandRunner: async () => {
          buildExecuted = true;
        },
        launchBrowserServerFn: async () => {
          browserLaunched = true;
          throw new Error('Should not be called');
        },
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(portCheckCalled).toBe(true);
      expect(rootAllocated).toBe(false);
      expect(buildExecuted).toBe(false);
      expect(browserLaunched).toBe(false);

      const errText = capturedErrors.join('\n');
      expect(errText).toContain('Port 27047 on 127.0.0.1 is already in use (EADDRINUSE)');
      expect(errText).toContain('Refusing to reuse or kill existing listener');
    } finally {
      console.error = origConsoleError;
      process.exitCode = savedExitCode;
    }
  });

  it('(2a) profile removal failure retains cleanup error status, surfaces exact diagnostic, and retains profile', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-profile-err-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const profilePath = path.join(isolatedCwd, 'profile-rm-err');
    mkdirSync(profilePath, { recursive: true });

    let mockBrowserAlive = true;
    const fakePid = 777793;

    const mockBrowserServer = {
      process: () => ({
        pid: fakePid,
        spawnargs: ['chrome', `--user-data-dir=${profilePath}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    const failingRm = async (target, opts) => {
      if (target === profilePath) {
        throw new Error('EACCES: permission denied, unlink profile');
      }
      rmSync(target, opts);
    };

    // Preceding build, tests, and report validation succeed cleanly!
    const fakeRunner = async (cmds) => {
      for (const cmd of cmds) {
        if (cmd.command === 'npx') {
          const repPath = path.resolve(isolatedCwd, 'test-results/required/report.json');
          mkdirSync(path.dirname(repPath), { recursive: true });
          writeFileSync(
            repPath,
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

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: false,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: fakeRunner,
        rmFn: failingRm,
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === fakePid ? mockBrowserAlive : pid === process.pid),
        expectedTestCount: 1,
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);

      // Verify exact diagnostic logged
      const errText = capturedErrors.join('\n');
      expect(errText).toContain(
        'Browser profile cleanup failed: Error: EACCES: permission denied, unlink profile',
      );

      // Profile directory still exists because rm failed on it
      expect(existsSync(profilePath)).toBe(true);
    } finally {
      console.error = origConsoleError;
      if (existsSync(profilePath)) {
        rmSync(profilePath, { recursive: true, force: true });
      }
      process.exitCode = savedExitCode;
    }
  });

  it('(2b) lock release failure in finally surfaces exact diagnostic and retains cleanup error status', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-lock-release-err-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let mockBrowserAlive = true;
    const fakePid = 777794;

    const mockBrowserServer = {
      process: () => ({
        pid: fakePid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-lock-err')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    // Preceding build, tests, and report validation succeed cleanly
    const fakeRunner = async (cmds) => {
      for (const cmd of cmds) {
        if (cmd.command === 'npx') {
          // Replace lock file with invalid JSON right before test completion so ownedLock.release() throws!
          writeFileSync(isolatedLockFile, 'corrupted unreadable lock content');

          const repPath = path.resolve(isolatedCwd, 'test-results/required/report.json');
          mkdirSync(path.dirname(repPath), { recursive: true });
          writeFileSync(
            repPath,
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

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: false,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: fakeRunner,
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === fakePid ? mockBrowserAlive : pid === process.pid),
        expectedTestCount: 1,
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);

      // Verify exact lock release diagnostic logged
      const errText = capturedErrors.join('\n');
      expect(errText).toContain('L3 Lock release failed:');
    } finally {
      console.error = origConsoleError;
      if (existsSync(isolatedLockFile)) {
        unlinkSync(isolatedLockFile);
      }
      process.exitCode = savedExitCode;
    }
  });

  it('(3) proc.kill fallback asserts exact SIGKILL signal', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-proc-kill-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let capturedKillSignal = null;
    let mockBrowserAlive = true;
    const fakePid = 777792;

    const fakeProc = {
      pid: fakePid,
      spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-proc')}`],
      kill: (signal) => {
        capturedKillSignal = signal;
        mockBrowserAlive = false;
      },
    };

    const mockBrowserServer = {
      process: () => fakeProc,
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        throw new Error('Forced close hang/error');
      },
      // Note: kill method intentionally undefined so gate escalates to fakeProc.kill('SIGKILL')
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
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes
          throw new Error('Trigger cleanup');
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === fakePid ? mockBrowserAlive : pid === process.pid),
        cleanupGraceMs: 50,
      });

      expect(ok).toBe(false);
      expect(capturedKillSignal).toBe('SIGKILL');
      expect(mockBrowserAlive).toBe(false);
      expect(existsSync(isolatedLockFile)).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('preserves exit code 130 and restores listeners when first abort reason is SIGINT', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-sigint-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveBuildStarted;
    const buildStarted = new Promise((resolve) => {
      resolveBuildStarted = resolve;
    });

    const runner = async (_cmds, opts) => {
      resolveBuildStarted();
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new Error('Interrupted by signal'));
        });
      });
    };

    const savedExitCode = process.exitCode;
    let gatePromise;
    try {
      gatePromise = runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: runner,
      });

      await buildStarted;
      // Emit SIGINT
      process.emit('SIGINT');

      const ok = await gatePromise;
      expect(ok).toBe(false);
      expect(process.exitCode).toBe(130);
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (gatePromise) await gatePromise.catch(() => {});
      process.exitCode = savedExitCode;
    }
  });

  it('handles SIGTERM as firstAbortReason mapping to exit code 143', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-sigterm-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    let resolveBuildStarted;
    const buildStarted = new Promise((resolve) => {
      resolveBuildStarted = resolve;
    });

    const runner = async (_cmds, opts) => {
      resolveBuildStarted();
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new Error('Interrupted by signal'));
        });
      });
    };

    const savedExitCode = process.exitCode;
    let gatePromise;
    try {
      gatePromise = runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        commandRunner: runner,
      });

      await buildStarted;
      // Emit SIGTERM
      process.emit('SIGTERM');

      const ok = await gatePromise;
      expect(ok).toBe(false);
      expect(process.exitCode).toBe(143);
    } finally {
      if (gatePromise) await gatePromise.catch(() => {});
      process.exitCode = savedExitCode;
    }
  });

  it('handles abort before resource allocation (SIGINT received during port check)', async () => {
    let mkdtempCalled = false;
    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: true,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        checkPortAvailableFn: async () => {
          // Emit SIGINT while port check is executing
          process.emit('SIGINT');
          return { available: true };
        },
        mkdtempFn: async () => {
          mkdtempCalled = true;
          throw new Error('Should not be called');
        },
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(130);
      expect(mkdtempCalled).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('handles resource root removal failure after successful test run while retaining cleanup error status and logging exact diagnostic', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-rmroot-err-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const ownedResDir = path.join(isolatedCwd, 'res-rm-err');

    let mockBrowserAlive = true;
    const fakePid = 777795;

    const mockBrowserServer = {
      process: () => ({
        pid: fakePid,
        spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-rmroot')}`],
      }),
      wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
      close: async () => {
        mockBrowserAlive = false;
      },
      kill: async () => {
        mockBrowserAlive = false;
      },
    };

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    const failingRm = async (target, opts) => {
      if (target === ownedResDir) {
        throw new Error('EACCES: permission denied, rmdir resource root');
      }
      rmSync(target, opts);
    };

    // Preceding build, test execution, and report validation succeed cleanly
    const fakeRunner = async (cmds) => {
      for (const cmd of cmds) {
        if (cmd.command === 'npx') {
          const repPath = path.resolve(isolatedCwd, 'test-results/required/report.json');
          mkdirSync(path.dirname(repPath), { recursive: true });
          writeFileSync(
            repPath,
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
          mkdirSync(ownedResDir, { recursive: true });
          return ownedResDir;
        },
        commandRunner: fakeRunner,
        rmFn: failingRm,
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) => (pid === fakePid ? mockBrowserAlive : pid === process.pid),
        expectedTestCount: 1,
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);

      // Verify exact diagnostic logged
      const errText = capturedErrors.join('\n');
      expect(errText).toContain(
        'L3 Gate resource cleanup failed: Error: EACCES: permission denied, rmdir resource root',
      );
      // Zero execution-error diagnostics: tests, build, and report all passed
      expect(errText).not.toContain('L3 Gate execution failed:');

      // Resource root still exists because rm failed on it
      expect(existsSync(ownedResDir)).toBe(true);

      // Profile was cleanly removed and lock was cleanly released
      expect(existsSync(path.join(isolatedCwd, 'profile-rmroot'))).toBe(false);
      expect(existsSync(isolatedLockFile)).toBe(false);
    } finally {
      console.error = origConsoleError;
      if (existsSync(ownedResDir)) {
        rmSync(ownedResDir, { recursive: true, force: true });
      }
      process.exitCode = savedExitCode;
    }
  });

  it('runs runL3TestsAndReport with required suite and reports report validation error', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-report-direct-'));

    // Command runner that writes an invalid report (0 specs)
    const runner = async () => {
      const repPath = path.resolve(isolatedCwd, 'test-results/required/report.json');
      mkdirSync(path.dirname(repPath), { recursive: true });
      writeFileSync(
        repPath,
        JSON.stringify({
          errors: [],
          stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
          suites: [],
        }),
      );
    };

    await expect(
      runL3TestsAndReport({
        commandRunner: runner,
        cwd: isolatedCwd,
        lock: { nonce: 'nonce', pid: process.pid, port: 27047 },
        resourceRoot: isolatedCwd,
        suite: 'required',
        expectedTestCount: 23,
        wsEndpoint: 'ws://127.0.0.1:9999/mock',
      }),
    ).rejects.toThrow(/Playwright report contains zero test suites/);
  });
});

describe('(4) CLI direct execution branches for run-l3 and run-l3-optional', () => {
  it('covers run-l3-optional direct execution rejection of unsupported options with vi.resetModules, exact path, and asserts no mocked dependencies were called', async () => {
    const origArgv = process.argv;
    const origExitCode = process.exitCode;
    const origConsoleError = console.error;
    const errors = [];
    console.error = (...args) => {
      errors.push(args.map(String).join(' '));
    };

    runParallelMock.mockClear();
    portCheckMock.mockClear();
    launchServerMock.mockClear();
    createViteServerMock.mockClear();

    try {
      vi.resetModules();
      const scriptPath = path.resolve('scripts/run-l3-optional.mjs');
      process.argv = ['node', scriptPath, '--unsupported-selector'];
      process.exitCode = 0;

      await import('../../scripts/run-l3-optional.mjs');

      expect(process.exitCode).toBe(1);
      const errText = errors.join('\n');
      expect(errText).toContain(
        'Unknown or unsupported CLI option "--unsupported-selector" in optional L3 gate',
      );
      expect(errText).toContain('Selectors, flags, and mode overrides are forbidden');

      // Assert zero side effects on mocked dependencies
      expect(runParallelMock).not.toHaveBeenCalled();
      expect(portCheckMock).not.toHaveBeenCalled();
      expect(launchServerMock).not.toHaveBeenCalled();
      expect(createViteServerMock).not.toHaveBeenCalled();
    } finally {
      process.argv = origArgv;
      process.exitCode = origExitCode;
      console.error = origConsoleError;
      runParallelMock.mockClear();
      portCheckMock.mockClear();
      launchServerMock.mockClear();
      createViteServerMock.mockClear();
      vi.resetModules();
    }
  });

  it('covers run-l3 direct execution rejection of unsupported options with vi.resetModules, exact path, and asserts no mocked dependencies were called', async () => {
    const origArgv = process.argv;
    const origExitCode = process.exitCode;
    const origConsoleError = console.error;
    const errors = [];
    console.error = (...args) => {
      errors.push(args.map(String).join(' '));
    };

    runParallelMock.mockClear();
    portCheckMock.mockClear();
    launchServerMock.mockClear();
    createViteServerMock.mockClear();

    try {
      vi.resetModules();
      const scriptPath = path.resolve('scripts/run-l3.mjs');
      process.argv = ['node', scriptPath, '--unsupported-selector'];
      process.exitCode = 0;

      await import('../../scripts/run-l3.mjs');

      expect(process.exitCode).toBe(1);
      const errText = errors.join('\n');
      expect(errText).toContain(
        'Unknown or unsupported CLI option "--unsupported-selector" in required L3 gate',
      );
      expect(errText).toContain('Selectors, flags, and mode overrides are forbidden');

      // Assert zero side effects on mocked dependencies
      expect(runParallelMock).not.toHaveBeenCalled();
      expect(portCheckMock).not.toHaveBeenCalled();
      expect(launchServerMock).not.toHaveBeenCalled();
      expect(createViteServerMock).not.toHaveBeenCalled();
    } finally {
      process.argv = origArgv;
      process.exitCode = origExitCode;
      console.error = origConsoleError;
      runParallelMock.mockClear();
      portCheckMock.mockClear();
      launchServerMock.mockClear();
      createViteServerMock.mockClear();
      vi.resetModules();
    }
  });
});

describe('runL3Gate gaps (1)-(3): TEST_BASE_URL, interruption lifecycle, and default chromium launch options', () => {
  let isolatedCwd;

  afterEach(() => {
    if (isolatedCwd && existsSync(isolatedCwd)) {
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it('(1) permitted TEST_BASE_URL reaches mocked port check; invalid target logs exact validation and calls no side-effect seams', async () => {
    let portCheckCalled = false;
    let buildExecuted = false;
    let portCheckCalled2 = false;
    let rootAllocated2 = false;

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
    };

    const savedExitCode = process.exitCode;
    try {
      // Permitted target URL reaches port check
      const ok1 = await runL3Gate({
        silent: true,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: { TEST_BASE_URL: 'http://127.0.0.1:27047' },
        checkPortAvailableFn: async () => {
          portCheckCalled = true;
          return { available: false, error: { code: 'EADDRINUSE' } };
        },
        commandRunner: async () => {
          buildExecuted = true;
        },
      });

      expect(ok1).toBe(false);
      expect(portCheckCalled).toBe(true);
      expect(buildExecuted).toBe(false);

      // Invalid target URL logs exact validation error and calls zero side-effect seams
      const ok2 = await runL3Gate({
        silent: false,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: { TEST_BASE_URL: 'http://127.0.0.1:7047' },
        checkPortAvailableFn: async () => {
          portCheckCalled2 = true;
          return { available: true };
        },
        mkdtempFn: async () => {
          rootAllocated2 = true;
          throw new Error('Should not be called');
        },
      });

      expect(ok2).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(portCheckCalled2).toBe(false);
      expect(rootAllocated2).toBe(false);

      const errText = capturedErrors.join('\n');
      expect(errText).toContain(
        'L3 pre-invocation validation failed: Target port must be strictly 27047',
      );
    } finally {
      console.error = origConsoleError;
      process.exitCode = savedExitCode;
    }
  });

  it('(2a) SIGINT while owned mkdtemp resolves prevents lock and build, restores listeners', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-sigint-mkdtemp-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let buildExecuted = false;
    let recordedResourceRoot = null;

    const origConsoleError = console.error;
    const capturedErrors = [];
    console.error = (...args) => {
      capturedErrors.push(args.map(String).join(' '));
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
          const dir = mkdtempSync(path.join(isolatedCwd, 'res-'));
          recordedResourceRoot = dir;
          // Emit SIGINT while mkdtemp resolves
          process.emit('SIGINT');
          return dir;
        },
        commandRunner: async () => {
          buildExecuted = true;
        },
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(130);
      expect(buildExecuted).toBe(false);
      expect(existsSync(isolatedLockFile)).toBe(false);
      expect(recordedResourceRoot).not.toBeNull();
      expect(existsSync(recordedResourceRoot)).toBe(false);

      const errText = capturedErrors.join('\n');
      expect(errText).toContain('L3 Gate execution failed: Error: Interrupted by SIGINT');

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      console.error = origConsoleError;
      process.exitCode = savedExitCode;
    }
  });

  it('(2b) SIGTERM at successful build settlement prevents browser launch, restores listeners', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-sigterm-build-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let browserLaunched = false;
    let recordedResourceRoot = null;
    let buildSignalAborted = false;
    let buildAbortReasonMessage = null;

    const savedExitCode = process.exitCode;
    try {
      const ok = await runL3Gate({
        silent: true,
        cwd: isolatedCwd,
        argv: ['node', 'scripts/run-l3.mjs'],
        env: {},
        lockFilePath: isolatedLockFile,
        checkPortAvailableFn: async () => ({ available: true }),
        mkdtempFn: async () => {
          const dir = mkdtempSync(path.join(isolatedCwd, 'res-'));
          recordedResourceRoot = dir;
          return dir;
        },
        commandRunner: async (cmds, cmdOpts) => {
          if (cmds[0].command === 'npm') {
            // Build succeeds, but emit SIGTERM at build settlement
            process.emit('SIGTERM');
            if (cmdOpts?.signal) {
              buildSignalAborted = cmdOpts.signal.aborted;
              buildAbortReasonMessage = cmdOpts.signal.reason?.message;
            }
            return;
          }
          throw new Error('Test run should not occur');
        },
        launchBrowserServerFn: async () => {
          browserLaunched = true;
          throw new Error('Browser launch should not occur');
        },
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(143);
      expect(browserLaunched).toBe(false);
      expect(existsSync(isolatedLockFile)).toBe(false);
      expect(recordedResourceRoot).not.toBeNull();
      expect(existsSync(recordedResourceRoot)).toBe(false);

      expect(buildSignalAborted).toBe(true);
      expect(buildAbortReasonMessage).toBe('Interrupted by SIGTERM');

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('(2c) signal after browser and optional runtime startup prevents later test command while disposing captured resources', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-sig-after-start-'));
    const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');
    const profileDir = path.join(isolatedCwd, 'profile-after-start');
    mkdirSync(profileDir, { recursive: true });
    expect(existsSync(profileDir)).toBe(true);

    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let recordedResourceRoot = null;
    let browserClosed = false;
    let mockBrowserAlive = true;
    const fakeBrowserPid = 777796;
    const mockBrowserServer = {
      process: () => ({
        pid: fakeBrowserPid,
        spawnargs: ['chrome', `--user-data-dir=${profileDir}`],
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

    let runtimeDisposed = false;
    let runtimeSignalAborted = false;
    let runtimeAbortReasonMessage = null;
    let testExecuted = false;

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
        mkdtempFn: async () => {
          const dir = mkdtempSync(path.join(isolatedCwd, 'res-'));
          recordedResourceRoot = dir;
          return dir;
        },
        commandRunner: async (cmds) => {
          if (cmds[0].command === 'npm') return; // build passes
          testExecuted = true;
        },
        launchBrowserServerFn: async () => mockBrowserServer,
        isProcessAliveFn: (pid) =>
          pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
        createLocalRomDevRuntimeFn: async ({ signal }) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              runtimeSignalAborted = signal.aborted;
              runtimeAbortReasonMessage = signal.reason?.message;
            });
          }
          return {
            server: {},
            start: async () => {
              // Emit SIGINT right after startup completion
              process.emit('SIGINT');
            },
            dispose: async () => {
              runtimeDisposed = true;
            },
          };
        },
      });

      expect(ok).toBe(false);
      expect(process.exitCode).toBe(130);
      expect(testExecuted).toBe(false);
      expect(browserClosed).toBe(true);
      expect(runtimeDisposed).toBe(true);
      expect(existsSync(isolatedLockFile)).toBe(false);
      expect(existsSync(profileDir)).toBe(false);
      expect(recordedResourceRoot).not.toBeNull();
      expect(existsSync(recordedResourceRoot)).toBe(false);

      expect(runtimeSignalAborted).toBe(true);
      expect(runtimeAbortReasonMessage).toBe('Interrupted by SIGINT');

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it.each([
    { ci: undefined, channel: 'chrome' },
    { ci: '1', channel: undefined },
  ])(
    '(3a) default chromium.launchServer uses channel $channel with CI=$ci and exact launch options',
    async ({ ci, channel }) => {
      isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-ci-launch-'));
      const isolatedLockFile = path.join(isolatedCwd, 'mock.lock');

      let mockBrowserAlive = true;
      const fakeBrowserPid = 777797;

      const mockBrowserServer = {
        process: () => ({
          pid: fakeBrowserPid,
          spawnargs: ['chrome', `--user-data-dir=${path.join(isolatedCwd, 'profile-ci')}`],
        }),
        wsEndpoint: () => 'ws://127.0.0.1:9999/mock',
        close: async () => {
          mockBrowserAlive = false;
        },
        kill: async () => {
          mockBrowserAlive = false;
        },
      };

      launchServerMock.mockImplementation(async () => mockBrowserServer);

      const fakeRunner = async (cmds) => {
        for (const cmd of cmds) {
          if (cmd.command === 'npx') {
            const repPath = path.resolve(isolatedCwd, 'test-results/required/report.json');
            mkdirSync(path.dirname(repPath), { recursive: true });
            writeFileSync(
              repPath,
              JSON.stringify({
                errors: [],
                stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
                suites: [
                  {
                    specs: [
                      {
                        title: 'ci spec',
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

      const savedEnvCi = process.env.CI;
      const savedExitCode = process.exitCode;
      try {
        if (ci === undefined) delete process.env.CI;
        else process.env.CI = ci;
        const ok = await runL3Gate({
          silent: true,
          cwd: isolatedCwd,
          argv: ['node', 'scripts/run-l3.mjs'],
          env: {},
          lockFilePath: isolatedLockFile,
          checkPortAvailableFn: async () => ({ available: true }),
          commandRunner: fakeRunner,
          isProcessAliveFn: (pid) =>
            pid === fakeBrowserPid ? mockBrowserAlive : pid === process.pid,
          expectedTestCount: 1,
        });

        expect(ok).toBe(true);
        expect(launchServerMock).toHaveBeenCalledTimes(1);
        expect(launchServerMock).toHaveBeenCalledWith({
          host: '127.0.0.1',
          handleSIGINT: false,
          handleSIGTERM: false,
          channel,
        });
        expect(existsSync(isolatedLockFile)).toBe(false);
      } finally {
        if (savedEnvCi === undefined) {
          delete process.env.CI;
        } else {
          process.env.CI = savedEnvCi;
        }
        process.exitCode = savedExitCode;
        launchServerMock.mockReset();
      }
    },
  );

  it('(3b) runL3TestsAndReport runs default runner options with successful report validation', async () => {
    isolatedCwd = mkdtempSync(path.join(tmpdir(), 'l3-report-default-'));

    let capturedCommands = null;

    const mockRunner = async (cmds) => {
      capturedCommands = cmds;

      const repPath = path.resolve(isolatedCwd, 'test-results/required/report.json');
      mkdirSync(path.dirname(repPath), { recursive: true });
      writeFileSync(
        repPath,
        JSON.stringify({
          errors: [],
          stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
          suites: [
            {
              specs: [
                {
                  title: 'default runner spec',
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
    };

    runParallelMock.mockImplementation(mockRunner);
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(isolatedCwd);

    try {
      await runL3TestsAndReport({
        lock: { nonce: 'test-nonce-def', pid: process.pid, port: 27047 },
        resourceRoot: isolatedCwd,
        expectedTestCount: 1,
        wsEndpoint: 'ws://127.0.0.1:9999/mock',
      });

      expect(capturedCommands[0].command).toBe('npx');
      expect(capturedCommands[0].args).toEqual([
        'playwright',
        'test',
        '--config',
        'playwright.config.ts',
      ]);
      expect(capturedCommands[0].cwd).toBe(isolatedCwd);
      expect(capturedCommands[0].env.POKEPOCKET_BROWSER_RUN_NONCE).toBe('test-nonce-def');
    } finally {
      cwdSpy.mockRestore();
      runParallelMock.mockReset();
    }
  });
});
