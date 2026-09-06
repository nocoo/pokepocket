import { describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runParallelCommands, runPreCommitGate } from '../../scripts/run-parallel.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function settleChildren(pids, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && pids.some(isAlive)) {
    await delay(25);
  }
  return pids.filter(isAlive);
}

describe('runParallelCommands runner', () => {
  it('resolves on empty commands list', async () => {
    await expect(runParallelCommands([])).resolves.toBeUndefined();
  });

  it('runs multiple commands concurrently using rendezvous synchronization', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'parallel-rendezvous-'));
    try {
      const job1Ready = path.join(tempDir, 'job1-ready');
      const job2Ready = path.join(tempDir, 'job2-ready');

      // Job 1 creates job1Ready then waits for job2Ready before exiting 0
      // Job 2 creates job2Ready then waits for job1Ready before exiting 0
      // If run sequentially, Job 1 would wait forever and time out.
      await runParallelCommands(
        [
          {
            command: 'node',
            args: [
              '-e',
              `
              import fs from 'node:fs';
              fs.writeFileSync(process.argv[1], '1');
              const start = Date.now();
              while (!fs.existsSync(process.argv[2])) {
                if (Date.now() - start > 4000) process.exit(1);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
              }
              process.exit(0);
              `,
              job1Ready,
              job2Ready,
            ],
          },
          {
            command: 'node',
            args: [
              '-e',
              `
              import fs from 'node:fs';
              fs.writeFileSync(process.argv[1], '1');
              const start = Date.now();
              while (!fs.existsSync(process.argv[2])) {
                if (Date.now() - start > 4000) process.exit(1);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
              }
              process.exit(0);
              `,
              job2Ready,
              job1Ready,
            ],
          },
        ],
        { timeoutMs: 5000 },
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects immediately when a command fails with non-zero exit code and terminates peers', async () => {
    await expect(
      runParallelCommands(
        [
          { command: 'node', args: ['-e', 'process.exit(2)'] },
          {
            command: 'node',
            args: ['-e', 'setTimeout(() => { process.exit(0); }, 3000)'],
          },
        ],
        { escalationGraceMs: 200 },
      ),
    ).rejects.toThrow('exited with code 2');
  });

  it('rejects when command is terminated by signal', async () => {
    await expect(
      runParallelCommands(
        [{ command: 'node', args: ['-e', 'process.kill(process.pid, "SIGTERM")'] }],
        { escalationGraceMs: 200 },
      ),
    ).rejects.toThrow('terminated by signal SIGTERM');
  });

  it('rejects when execution times out', async () => {
    await expect(
      runParallelCommands([{ command: 'node', args: ['-e', 'setTimeout(() => {}, 5000)'] }], {
        timeoutMs: 150,
        escalationGraceMs: 100,
      }),
    ).rejects.toThrow('timed out after 150ms');
  });

  it('rejects when aborted via AbortSignal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    await expect(
      runParallelCommands([{ command: 'node', args: ['-e', 'setTimeout(() => {}, 5000)'] }], {
        signal: controller.signal,
        escalationGraceMs: 100,
      }),
    ).rejects.toThrow('aborted');

    const abortedController = new AbortController();
    abortedController.abort();
    await expect(
      runParallelCommands([{ command: 'node', args: ['-e', 'process.exit(0)'] }], {
        signal: abortedController.signal,
      }),
    ).rejects.toThrow('aborted before start');
  });

  it('handles command spawn errors (e.g. non-existent command)', async () => {
    await expect(
      runParallelCommands([{ command: 'non_existent_binary_xyz_123', args: [] }]),
    ).rejects.toThrow();
  });

  it('terminates TERM-ignoring descendants when parent exits on TERM and peer fails', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'parallel-descendant-'));
    const parentPidFile = path.join(tempDir, 'parent.pid');
    const descendantPidFile = path.join(tempDir, 'descendant.pid');
    const descendantReadyFile = path.join(tempDir, 'descendant-ready');

    const capturedPids = [];
    const spawnWithCapture = (cmd, args, opts) => {
      const { spawn: baseSpawn } = require('node:child_process');
      const child = baseSpawn(cmd, args, opts);
      if (typeof child.pid === 'number') {
        capturedPids.push(child.pid);
      }
      return child;
    };

    try {
      await expect(
        runParallelCommands(
          [
            {
              command: 'node',
              args: [
                '-e',
                `
                import fs from 'node:fs';
                const readyFile = process.argv[1];
                const start = Date.now();
                while (!fs.existsSync(readyFile)) {
                  if (Date.now() - start > 4000) process.exit(2);
                  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
                }
                process.exit(1);
                `,
                descendantReadyFile,
              ],
            },
            {
              command: 'node',
              args: [
                '-e',
                `
                import { spawn } from 'node:child_process';
                import fs from 'node:fs';
                const [pPidFile, dPidFile, dReadyFile] = [process.argv[1], process.argv[2], process.argv[3]];
                fs.writeFileSync(pPidFile, String(process.pid));
                const sub = spawn('node', [
                  '-e',
                  \`
                  import fs from 'node:fs';
                  const [pidFile, readyFile] = [process.argv[1], process.argv[2]];
                  process.on('SIGTERM', () => {});
                  fs.writeFileSync(pidFile, String(process.pid));
                  fs.writeFileSync(readyFile, 'ready');
                  setInterval(() => {}, 1000);
                  \`,
                  dPidFile,
                  dReadyFile,
                ], { stdio: 'ignore' });
                setInterval(() => {}, 1000);
                `,
                parentPidFile,
                descendantPidFile,
                descendantReadyFile,
              ],
            },
          ],
          { spawn: spawnWithCapture, escalationGraceMs: 300 },
        ),
      ).rejects.toThrow('exited with code 1');

      let descendantPid = null;
      try {
        descendantPid = Number((await readFile(descendantPidFile, 'utf8')).trim());
        if (descendantPid) capturedPids.push(descendantPid);
      } catch {}

      const survivors = await settleChildren(capturedPids, 2000);
      expect(survivors).toEqual([]);
    } finally {
      for (const pid of capturedPids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('terminates TERM-ignoring descendant when coordinator aborts with SIGTERM', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'parallel-abort-descendant-'));
    const parentPidFile = path.join(tempDir, 'parent.pid');
    const descendantPidFile = path.join(tempDir, 'descendant.pid');
    const descendantReadyFile = path.join(tempDir, 'descendant-ready');

    const capturedPids = [];
    const spawnWithCapture = (cmd, args, opts) => {
      const { spawn: baseSpawn } = require('node:child_process');
      const child = baseSpawn(cmd, args, opts);
      if (typeof child.pid === 'number') {
        capturedPids.push(child.pid);
      }
      return child;
    };

    const abortController = new AbortController();
    let runPromise = null;

    try {
      runPromise = runParallelCommands(
        [
          {
            command: 'node',
            args: [
              '-e',
              `
              import { spawn } from 'node:child_process';
              import fs from 'node:fs';
              const [pPidFile, dPidFile, dReadyFile] = [process.argv[1], process.argv[2], process.argv[3]];
              fs.writeFileSync(pPidFile, String(process.pid));
              const sub = spawn('node', [
                '-e',
                \`
                import fs from 'node:fs';
                const [pidFile, readyFile] = [process.argv[1], process.argv[2]];
                process.on('SIGTERM', () => {});
                fs.writeFileSync(pidFile, String(process.pid));
                fs.writeFileSync(readyFile, 'ready');
                setInterval(() => {}, 1000);
                \`,
                dPidFile,
                dReadyFile,
              ], { stdio: 'ignore' });
              setInterval(() => {}, 1000);
              `,
              parentPidFile,
              descendantPidFile,
              descendantReadyFile,
            ],
          },
        ],
        { spawn: spawnWithCapture, signal: abortController.signal, escalationGraceMs: 300 },
      );
      runPromise.catch(() => {});

      // Wait until descendant is ready
      const start = Date.now();
      while (true) {
        try {
          await readFile(descendantReadyFile, 'utf8');
          break;
        } catch {
          if (Date.now() - start > 4000) throw new Error('Timeout waiting for descendant ready');
          await delay(25);
        }
      }

      // Abort coordinator
      abortController.abort();

      await expect(runPromise).rejects.toThrow('aborted by signal');

      try {
        const descendantPid = Number((await readFile(descendantPidFile, 'utf8')).trim());
        if (descendantPid) capturedPids.push(descendantPid);
      } catch {}

      const survivors = await settleChildren(capturedPids, 2000);
      expect(survivors).toEqual([]);
    } finally {
      abortController.abort();
      if (runPromise) {
        try {
          await runPromise;
        } catch {}
      }
      for (const pid of capturedPids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('runPreCommitGate policy runs runner, handles errors and signal interruption without modifying process.exitCode', async () => {
    const savedExitCode = process.exitCode;
    try {
      const fakePassingRunner = async () => {};
      const success = await runPreCommitGate({
        runner: fakePassingRunner,
        commands: [{ command: 'echo', args: ['ok'] }],
        silent: true,
      });
      expect(success).toBe(true);

      const fakeFailingRunner = async () => {
        throw new Error('Injected failure');
      };
      const failure = await runPreCommitGate({
        runner: fakeFailingRunner,
        commands: [{ command: 'echo', args: ['fail'] }],
        silent: true,
      });
      expect(failure).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('removes abort signal listener upon completion and prevents late abort from killing processes', async () => {
    const controller = new AbortController();
    const { getEventListeners } = await import('node:events');

    await runParallelCommands([{ command: 'node', args: ['-e', 'process.exit(0)'] }], {
      signal: controller.signal,
    });

    // Verify listeners on AbortSignal are restored / empty
    const listeners = getEventListeners(controller.signal, 'abort');
    expect(listeners.length).toBe(0);

    // Verify late abort cannot schedule process.kill
    const origKill = process.kill;
    let killCalled = false;
    process.kill = (...args) => {
      killCalled = true;
      return origKill.apply(process, args);
    };

    try {
      controller.abort();
      await delay(50);
      expect(killCalled).toBe(false);
    } finally {
      process.kill = origKill;
    }
  });

  it('verifies runPreCommitGate default commands identities, timeout, and signal options', async () => {
    let capturedCommands = null;
    let capturedOptions = null;

    const fakeRunner = async (commands, options) => {
      capturedCommands = commands;
      capturedOptions = options;
    };

    const ok = await runPreCommitGate({ runner: fakeRunner, silent: true });
    expect(ok).toBe(true);
    expect(capturedCommands).toEqual([
      { command: 'npm', args: ['run', 'quality:l1'] },
      { command: 'npm', args: ['run', 'quality:g1'] },
    ]);
    expect(capturedOptions.timeoutMs).toBe(28_000);
    expect(capturedOptions.signal).toBeInstanceOf(AbortSignal);
    expect(capturedOptions.signal.aborted).toBe(false);
  });

  it('restores process signal listeners and preserves exitCode in runPreCommitGate', async () => {
    const savedExitCode = process.exitCode;
    const initialSigintCount = process.listenerCount('SIGINT');
    const initialSigtermCount = process.listenerCount('SIGTERM');

    try {
      const result = await runPreCommitGate({
        runner: async () => {},
        commands: [],
        silent: true,
      });
      expect(result).toBe(true);
      expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
      expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);

      // Verify failure path restores listeners as well
      const failResult = await runPreCommitGate({
        runner: async () => {
          throw new Error('simulated failure');
        },
        commands: [],
        silent: true,
      });
      expect(failResult).toBe(false);
      expect(process.listenerCount('SIGINT')).toBe(initialSigintCount);
      expect(process.listenerCount('SIGTERM')).toBe(initialSigtermCount);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('covers default options and error logging in runPreCommitGate', async () => {
    const savedExitCode = process.exitCode;
    const errorLogs = [];
    const origError = console.error;
    console.error = (...args) => {
      errorLogs.push(args.join(' '));
    };

    try {
      let passedCommands = null;
      const fakeFailingRunner = async (cmds) => {
        passedCommands = cmds;
        throw new Error('expected failure for gate test');
      };

      const result = await runPreCommitGate({
        runner: fakeFailingRunner,
      });

      expect(result).toBe(false);
      expect(passedCommands).toEqual([
        { command: 'npm', args: ['run', 'quality:l1'] },
        { command: 'npm', args: ['run', 'quality:g1'] },
      ]);
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs[0]).toContain('expected failure for gate test');
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('handles abort signals during runPreCommitGate and maps exitCode accordingly', async () => {
    const savedExitCode = process.exitCode;
    const origError = console.error;
    console.error = () => {};
    try {
      let signalListener = null;
      const fakeSignalRunner = async (_cmds, options) => {
        options.signal.addEventListener('abort', () => {
          signalListener = true;
        });
        process.emit('SIGINT');
        throw new Error('aborted by SIGINT');
      };

      const res = await runPreCommitGate({
        runner: fakeSignalRunner,
      });
      expect(res).toBe(false);
      expect(signalListener).toBe(true);
      expect(process.exitCode).toBe(130);

      const fakeSigtermRunner = async (_cmds, _options) => {
        process.emit('SIGTERM');
        throw new Error('aborted by SIGTERM');
      };

      const resTerm = await runPreCommitGate({
        runner: fakeSigtermRunner,
      });
      expect(resTerm).toBe(false);
      expect(process.exitCode).toBe(143);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });

  it('handles empty commands array in runPreCommitGate without runner error', async () => {
    const res = await runPreCommitGate({
      commands: [],
      silent: true,
    });
    expect(res).toBe(true);
  });

  it('preserves first error deterministically using peer readiness signal and SIGTERM exit 3', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'parallel-first-err-'));
    const peerReadyFile = path.join(tempDir, 'peer-ready');

    try {
      await expect(
        runParallelCommands(
          [
            // Peer installs SIGTERM handler that exits 3 upon receiving SIGTERM, and signals ready
            {
              command: 'node',
              args: [
                '-e',
                `
              import fs from 'node:fs';
              const readyFile = process.argv[1];
              process.on('SIGTERM', () => {
                process.exit(3);
              });
              fs.writeFileSync(readyFile, 'ready');
              setInterval(() => {}, 1000);
              `,
                peerReadyFile,
              ],
            },
            // Job waits for peer readiness, then exits 2 (triggering cleanup SIGTERM to peer)
            {
              command: 'node',
              args: [
                '-e',
                `
              import fs from 'node:fs';
              const readyFile = process.argv[1];
              const start = Date.now();
              while (!fs.existsSync(readyFile)) {
                if (Date.now() - start > 4000) process.exit(1);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
              }
              process.exit(2);
              `,
                peerReadyFile,
              ],
            },
          ],
          { escalationGraceMs: 200 },
        ),
      ).rejects.toThrow('exited with code 2');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('honors custom cwd, env, and stdio options with real child output', async () => {
    const { realpath } = await import('node:fs/promises');
    const tempDir = await realpath(await mkdtemp(path.join(tmpdir(), 'parallel-cwd-env-')));
    const outFile = path.join(tempDir, 'out.txt');

    try {
      await runParallelCommands([
        {
          command: 'node',
          args: [
            '-e',
            `
            import fs from 'node:fs';
            fs.writeFileSync(process.argv[1], process.cwd() + '|' + process.env.TEST_FOO);
            `,
            outFile,
          ],
          cwd: tempDir,
          env: { TEST_FOO: 'pokepocket-parallel-env' },
          stdio: 'pipe',
        },
        {
          command: 'node',
          args: ['-e', 'process.exit(0)'],
        },
      ]);

      const content = await readFile(outFile, 'utf8');
      expect(content).toBe(`${tempDir}|pokepocket-parallel-env`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('cleans up running peers on synchronous spawn rejection and stops scheduling subsequent jobs', async () => {
    const { spawn } = await import('node:child_process');
    const capturedPids = [];
    let subsequentSpawnAttempted = false;

    const callThroughSpawn = (command, args, options) => {
      if (command === 'marker-sync-fail') {
        throw new Error('Synchronous spawn failure injected');
      }
      if (command === 'marker-subsequent') {
        subsequentSpawnAttempted = true;
      }
      const child = spawn(command, args, options);
      if (typeof child.pid === 'number') {
        capturedPids.push(child.pid);
      }
      return child;
    };

    try {
      await expect(
        runParallelCommands(
          [
            // Job 1: Real Node child process that stays alive
            { command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] },
            // Job 2: Synchronous spawn rejection
            { command: 'marker-sync-fail', args: [] },
            // Job 3: Subsequent job that must not be spawned
            { command: 'marker-subsequent', args: [] },
          ],
          { spawn: callThroughSpawn, escalationGraceMs: 200 },
        ),
      ).rejects.toThrow('Synchronous spawn failure injected');

      expect(subsequentSpawnAttempted).toBe(false);
      expect(capturedPids.length).toBe(1);
      const survivors = await settleChildren(capturedPids, 2000);
      expect(survivors).toEqual([]);
    } finally {
      for (const pid of capturedPids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
    }
  });

  it('formats error message without args array using owned executable fixtures for exit code and signal', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'parallel-exec-format-'));
    const exit4Script = path.join(tempDir, 'exit4.sh');
    const sigtermScript = path.join(tempDir, 'sigterm.sh');

    try {
      await writeFile(exit4Script, '#!/bin/sh\nexit 4\n');
      await chmod(exit4Script, 0o755);

      await writeFile(
        sigtermScript,
        '#!/bin/sh\nkill -TERM $$ 2>/dev/null || true\nwhile true; do sleep 1; done\n',
      );
      await chmod(sigtermScript, 0o755);

      // Command without args terminating with exit code 4
      await expect(
        runParallelCommands([{ command: exit4Script }], { escalationGraceMs: 100 }),
      ).rejects.toThrow(`Command "${exit4Script}" exited with code 4`);

      // Command without args terminating with SIGTERM
      await expect(
        runParallelCommands([{ command: sigtermScript }], { escalationGraceMs: 100 }),
      ).rejects.toThrow(`Command "${sigtermScript}" terminated by signal SIGTERM`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
