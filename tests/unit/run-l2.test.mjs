import { describe, it, expect } from 'vitest';
import { runL2Gate, runL2Default } from '../../scripts/run-l2.mjs';

describe('run-l2 gate runner policies', () => {
  it('runL2Gate handles passing runner and returns true', async () => {
    const fakeRunner = async () => {};
    const res = await runL2Gate({ runner: fakeRunner, silent: true });
    expect(res).toBe(true);
  });

  it('runL2Gate handles failing runner, logs error when not silent, sets exitCode, and returns false', async () => {
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
      const res = await runL2Gate({ runner: fakeRunner, silent: false });
      expect(res).toBe(false);
      expect(logged).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate handles SIGINT and maps exitCode to 130', async () => {
    const savedExitCode = process.exitCode;
    try {
      const fakeRunner = async () => {
        process.emit('SIGINT');
        throw new Error('Interrupted by SIGINT');
      };
      const res = await runL2Gate({ runner: fakeRunner, silent: true });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(130);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate handles SIGTERM and maps exitCode to 143', async () => {
    const savedExitCode = process.exitCode;
    try {
      const fakeRunner = async () => {
        process.emit('SIGTERM');
        throw new Error('Interrupted by SIGTERM');
      };
      const res = await runL2Gate({ runner: fakeRunner, silent: true });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(143);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('runL2Gate handles timeout abort', async () => {
    const savedExitCode = process.exitCode;
    try {
      const fakeRunner = async ({ signal }) => {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('timed out'));
          });
        });
      };
      const res = await runL2Gate({ runner: fakeRunner, timeoutMs: 50, silent: true });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(1);
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

    // Yield macro-task: while build is pending, only the build command has started
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual([{ command: 'npm', args: ['run', 'build'] }]);

    // Release build, allowing vitest command to start
    releaseBuild();
    const result = await gatePromise;
    expect(result).toBe(true);
    expect(started).toEqual([
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
    expect(executed).toEqual([{ command: 'npm', args: ['run', 'build'] }]);
  });
});
