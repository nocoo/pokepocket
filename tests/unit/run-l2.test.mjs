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

      // Verify owned listeners were removed while unrelated listeners survived
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
      // Initiating SIGTERM maps to 143, not overwritten by cleanup failure
      expect(process.exitCode).toBe(143);
      expect(loggedErrors.some((e) => e.includes('L2 Gate execution failed:'))).toBe(true);
      expect(loggedErrors.some((e) => e.includes('L2 Gate cleanup failed:'))).toBe(true);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate cleans simulated child runtime state when commandRunner is interrupted and fails', async () => {
    let capturedChildRoot = null;
    let simulatedChildState = null;

    const commandRunner = async (commands) => {
      const cmd = commands[0];
      if (cmd.command === 'npm') {
        // Build succeeds
        return;
      }
      if (cmd.command === 'npx') {
        // Child vitest runs: simulate creating runtime state inside the passed resource root
        capturedChildRoot = cmd.env?.[RUNTIME_RESOURCE_ROOT_ENV];
        expect(capturedChildRoot).toBeDefined();
        simulatedChildState = path.join(capturedChildRoot, 'simulated-child-runtime-state');
        await mkdir(simulatedChildState, { recursive: true });
        await writeFile(path.join(simulatedChildState, 'data.txt'), 'isolated-content');

        // Verify simulated state exists before child interruption
        expect((await stat(simulatedChildState)).isDirectory()).toBe(true);

        // Child is interrupted by signal
        throw new Error('Command terminated by signal SIGTERM');
      }
    };

    const res = await runL2Gate({ commandRunner, silent: true });
    expect(res).toBe(false);

    // Parent finally must have removed the owned resource root and all state inside it
    expect(capturedChildRoot).toBeDefined();
    const statResult = await stat(capturedChildRoot).catch((e) => e);
    expect(statResult.code).toBe('ENOENT');
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

    // Yield macro-task: while build is pending, only the build command has started
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started.map((c) => ({ command: c.command, args: c.args }))).toEqual([
      { command: 'npm', args: ['run', 'build'] },
    ]);

    // Release build, allowing vitest command to start
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
