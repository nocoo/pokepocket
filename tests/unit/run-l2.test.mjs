import { describe, it, expect, afterEach } from 'vitest';
import { stat, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { runL2Gate, runL2Default } from '../../scripts/run-l2.mjs';
import { RUNTIME_RESOURCE_ROOT_ENV } from '../../scripts/production-runtime.mjs';

describe('run-l2 gate runner policies', () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        await fn();
      } catch {}
    }
  });

  it('runL2Gate handles passing commandRunner and returns true', async () => {
    const fakeRunner = async () => {};
    const res = await runL2Gate({ commandRunner: fakeRunner, silent: true });
    expect(res).toBe(true);
  });

  it('runL2Gate handles failing commandRunner, logs error when not silent, sets exitCode, and returns false', async () => {
    const savedExitCode = process.exitCode;
    const origError = console.error;
    let logged = false;
    console.error = () => {
      logged = true;
    };
    try {
      const fakeRunner = async () => {
        throw new Error('L2 test failure');
      };
      const res = await runL2Gate({ commandRunner: fakeRunner, silent: false });
      expect(res).toBe(false);
      expect(logged).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate handles SIGINT and maps exitCode to 130 while cleaning owned temp state', async () => {
    const savedExitCode = process.exitCode;
    let capturedRoot = null;
    try {
      const fakeRunner = async (commands) => {
        const cmd = commands[0];
        if (cmd.command === 'npm') return;
        capturedRoot = cmd.env?.[RUNTIME_RESOURCE_ROOT_ENV];
        process.emit('SIGINT');
        throw new Error('Interrupted by SIGINT');
      };
      const res = await runL2Gate({ commandRunner: fakeRunner, silent: true });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(130);
      expect(capturedRoot).toBeDefined();
      const statResult = await stat(capturedRoot).catch((e) => e);
      expect(statResult.code).toBe('ENOENT');
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate handles SIGTERM and maps exitCode to 143 while cleaning owned temp state', async () => {
    const savedExitCode = process.exitCode;
    let capturedRoot = null;
    try {
      const fakeRunner = async (commands) => {
        const cmd = commands[0];
        if (cmd.command === 'npm') return;
        capturedRoot = cmd.env?.[RUNTIME_RESOURCE_ROOT_ENV];
        process.emit('SIGTERM');
        throw new Error('Interrupted by SIGTERM');
      };
      const res = await runL2Gate({ commandRunner: fakeRunner, silent: true });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(143);
      expect(capturedRoot).toBeDefined();
      const statResult = await stat(capturedRoot).catch((e) => e);
      expect(statResult.code).toBe('ENOENT');
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate handles timeout abort', async () => {
    const savedExitCode = process.exitCode;
    try {
      const fakeRunner = async (_commands, { signal }) => {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('timed out'));
          });
        });
      };
      const res = await runL2Gate({ commandRunner: fakeRunner, timeoutMs: 50, silent: true });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('handles mkdtemp allocation failure by cleaning timers/listeners, skipping commands, and preserving unrelated listeners', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');
    let commandRunnerCalled = false;

    try {
      const failingMkdtemp = async () => {
        throw new Error('Injected allocation failure');
      };
      const fakeRunner = async () => {
        commandRunnerCalled = true;
      };

      const res = await runL2Gate({
        mkdtempFn: failingMkdtemp,
        commandRunner: fakeRunner,
        silent: true,
      });

      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(commandRunnerCalled).toBe(false);

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('fails closed on sole cleanup failure with exitCode 1 and reports cleanup error', async () => {
    const savedExitCode = process.exitCode;
    const origError = console.error;
    let loggedError = null;
    console.error = (...args) => {
      loggedError = args.join(' ');
    };

    try {
      const failingRm = async (dir) => {
        cleanups.push(() => rm(dir, { recursive: true, force: true }));
        throw new Error('Injected cleanup failure');
      };

      const fakeRunner = async () => {};

      const res = await runL2Gate({
        commandRunner: fakeRunner,
        rmFn: failingRm,
        silent: false,
      });

      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(loggedError).toContain('L2 Gate cleanup failed: Error: Injected cleanup failure');
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('retains initiating execution failure and exit status when both execution and cleanup fail', async () => {
    const savedExitCode = process.exitCode;
    const origError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
      loggedErrors.push(args.join(' '));
    };

    try {
      const failingRm = async (dir) => {
        cleanups.push(() => rm(dir, { recursive: true, force: true }));
        throw new Error('Injected cleanup secondary failure');
      };

      const fakeRunner = async () => {
        process.emit('SIGTERM');
        throw new Error('Primary execution failure');
      };

      const res = await runL2Gate({
        commandRunner: fakeRunner,
        rmFn: failingRm,
        silent: false,
      });

      expect(res).toBe(false);
      expect(process.exitCode).toBe(143);
      expect(loggedErrors.some((e) => e.includes('L2 Gate execution failed:'))).toBe(true);
      expect(loggedErrors.some((e) => e.includes('Primary execution failure'))).toBe(true);
      expect(loggedErrors.some((e) => e.includes('L2 Gate cleanup failed:'))).toBe(true);
      expect(loggedErrors.some((e) => e.includes('Injected cleanup secondary failure'))).toBe(true);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('deferred-rm regression: retains owned listener across repeated signals (SIGTERM first), verifies pending gate and directory lifecycle, and restores listeners', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveEnteredCleanup;
    const enteredCleanup = new Promise((resolve) => {
      resolveEnteredCleanup = resolve;
    });

    let releaseCleanup;
    const cleanupDeferred = new Promise((resolve) => {
      releaseCleanup = resolve;
    });

    let targetDir = null;
    let removedDir = null;
    let gateSettled = false;
    const deferredRm = async (dir, opts) => {
      targetDir = dir;
      resolveEnteredCleanup();
      await cleanupDeferred;
      removedDir = dir;
      return rm(dir, opts);
    };

    const fakeRunner = async () => {};

    let gatePromise;
    try {
      gatePromise = runL2Gate({
        commandRunner: fakeRunner,
        rmFn: deferredRm,
        silent: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      // Wait until rmFn has explicitly entered cleanup
      await enteredCleanup;

      // Identify exact owned listeners
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

      // Emit first signal (SIGTERM)
      process.emit('SIGTERM');

      // Assert the exact owned listeners remain attached (not dropped by process.once)
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Emit the same signal again, then the other signal
      process.emit('SIGTERM');
      process.emit('SIGINT');

      // Assert owned listeners still remain attached
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Verify gate remains pending until rm is released
      expect(gateSettled).toBe(false);

      // The real owned directory still exists before release
      expect(targetDir).toBeDefined();
      const preStat = await stat(targetDir);
      expect(preStat.isDirectory()).toBe(true);

      // Release cleanup
      releaseCleanup();

      const res = await gatePromise;
      expect(res).toBe(false);
      // Initial signal was SIGTERM, so initial signal status is retained (143)
      expect(process.exitCode).toBe(143);

      // Verify directory was removed after release
      expect(removedDir).toBe(targetDir);
      const postStat = await stat(removedDir).catch((e) => e);
      expect(postStat.code).toBe('ENOENT');

      // Both original listener arrays and exitCode are restored
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseCleanup) {
        releaseCleanup();
      }
      if (gatePromise) {
        await gatePromise.catch(() => {});
      }
      process.exitCode = savedExitCode;
    }
  });

  it('deferred-rm regression: retains owned listener across repeated signals (SIGINT first), verifies pending gate and directory lifecycle, and restores listeners', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveEnteredCleanup;
    const enteredCleanup = new Promise((resolve) => {
      resolveEnteredCleanup = resolve;
    });

    let releaseCleanup;
    const cleanupDeferred = new Promise((resolve) => {
      releaseCleanup = resolve;
    });

    let targetDir = null;
    let removedDir = null;
    let gateSettled = false;
    const deferredRm = async (dir, opts) => {
      targetDir = dir;
      resolveEnteredCleanup();
      await cleanupDeferred;
      removedDir = dir;
      return rm(dir, opts);
    };

    const fakeRunner = async () => {};

    let gatePromise;
    try {
      gatePromise = runL2Gate({
        commandRunner: fakeRunner,
        rmFn: deferredRm,
        silent: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      // Wait until rmFn has explicitly entered cleanup
      await enteredCleanup;

      // Identify exact owned listeners
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

      // Emit first signal (SIGINT)
      process.emit('SIGINT');

      // Assert the exact owned listeners remain attached (not dropped by process.once)
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Emit the same signal again, then the other signal
      process.emit('SIGINT');
      process.emit('SIGTERM');

      // Assert owned listeners still remain attached
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Verify gate remains pending until rm is released
      expect(gateSettled).toBe(false);

      // The real owned directory still exists before release
      expect(targetDir).toBeDefined();
      const preStat = await stat(targetDir);
      expect(preStat.isDirectory()).toBe(true);

      // Release cleanup
      releaseCleanup();

      const res = await gatePromise;
      expect(res).toBe(false);
      // Initial signal was SIGINT, so initial signal status is retained (130)
      expect(process.exitCode).toBe(130);

      // Verify directory was removed after release
      expect(removedDir).toBe(targetDir);
      const postStat = await stat(removedDir).catch((e) => e);
      expect(postStat.code).toBe('ENOENT');

      // Both original listener arrays and exitCode are restored
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseCleanup) {
        releaseCleanup();
      }
      if (gatePromise) {
        await gatePromise.catch(() => {});
      }
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate retains owned listeners during runner settlement across repeat signals', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveRunnerEntered;
    const runnerEntered = new Promise((resolve) => {
      resolveRunnerEntered = resolve;
    });

    let releaseRunner;
    const runnerDeferred = new Promise((resolve) => {
      releaseRunner = resolve;
    });

    const blockedRunner = async (_commands, { signal }) => {
      resolveRunnerEntered();
      await runnerDeferred;
      if (signal.aborted) {
        throw new Error(signal.reason?.message || 'Aborted');
      }
    };

    let gateSettled = false;
    let gatePromise;
    try {
      gatePromise = runL2Gate({
        commandRunner: blockedRunner,
        silent: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      await runnerEntered;

      const currentSigtermListeners = process.listeners('SIGTERM');
      const currentSigintListeners = process.listeners('SIGINT');
      const ownedSigtermListener = currentSigtermListeners.find(
        (fn) => !initialSigterm.includes(fn),
      );
      const ownedSigintListener = currentSigintListeners.find((fn) => !initialSigint.includes(fn));
      expect(ownedSigtermListener).toBeDefined();
      expect(ownedSigintListener).toBeDefined();

      // Emit first signal
      process.emit('SIGTERM');

      // Assert owned listeners retained
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Emit repeat and alternate signals while runner is still settling
      process.emit('SIGTERM');
      process.emit('SIGINT');

      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(gateSettled).toBe(false);

      releaseRunner();

      const res = await gatePromise;
      expect(res).toBe(false);
      expect(process.exitCode).toBe(143);

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseRunner) {
        releaseRunner();
      }
      if (gatePromise) {
        await gatePromise.catch(() => {});
      }
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate cleans simulated child runtime state when commandRunner is interrupted and fails', async () => {
    const savedExitCode = process.exitCode;
    let capturedChildRoot = null;
    let simulatedChildState = null;

    try {
      const commandRunner = async (commands) => {
        const cmd = commands[0];
        if (cmd.command === 'npm') {
          return;
        }
        if (cmd.command === 'npx') {
          capturedChildRoot = cmd.env?.[RUNTIME_RESOURCE_ROOT_ENV];
          expect(capturedChildRoot).toBeDefined();
          simulatedChildState = path.join(capturedChildRoot, 'simulated-child-runtime-state');
          await mkdir(simulatedChildState, { recursive: true });
          await writeFile(path.join(simulatedChildState, 'data.txt'), 'isolated-content');

          expect((await stat(simulatedChildState)).isDirectory()).toBe(true);

          throw new Error('Command terminated by signal SIGTERM');
        }
      };

      const res = await runL2Gate({ commandRunner, silent: true });
      expect(res).toBe(false);

      expect(capturedChildRoot).toBeDefined();
      const statResult = await stat(capturedChildRoot).catch((e) => e);
      expect(statResult.code).toBe('ENOENT');
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate runs default orchestration through commandRunner seam with deferred build', async () => {
    const started = [];
    let releaseBuild;
    const buildDeferred = new Promise((resolve) => {
      releaseBuild = resolve;
    });

    const commandRunner = async (commands) => {
      const cmd = commands[0];
      started.push(cmd);
      if (cmd.command === 'npm') {
        await buildDeferred;
      }
    };

    const gatePromise = runL2Gate({ commandRunner, silent: true });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started.map((c) => ({ command: c.command, args: c.args }))).toEqual([
      { command: 'npm', args: ['run', 'build'] },
    ]);

    releaseBuild();
    const result = await gatePromise;
    expect(result).toBe(true);
    expect(started.map((c) => ({ command: c.command, args: c.args }))).toEqual([
      { command: 'npm', args: ['run', 'build'] },
      { command: 'npx', args: ['vitest', 'run', '--config', 'vitest.l2.config.ts'] },
    ]);
  });

  it('runL2Default stops on build failure before running tests', async () => {
    const executed = [];
    const failingCommandRunner = async (commands) => {
      const cmd = commands[0];
      executed.push(cmd);
      if (cmd.command === 'npm') {
        throw new Error('Injected build failure');
      }
    };

    await expect(runL2Default({ commandRunner: failingCommandRunner })).rejects.toThrow(
      'Injected build failure',
    );
    expect(executed.map((c) => ({ command: c.command, args: c.args }))).toEqual([
      { command: 'npm', args: ['run', 'build'] },
    ]);
  });
});
