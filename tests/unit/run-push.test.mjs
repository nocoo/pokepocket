import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPushCommands, parsePushCli, runPushGate } from '../../scripts/run-push.mjs';

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

const VALID_ROW =
  'refs/heads/feature 1111111111111111111111111111111111111111 refs/heads/feature 2222222222222222222222222222222222222222';
const DELETE_ROW =
  'refs/heads/feature 0000000000000000000000000000000000000000 refs/heads/feature 2222222222222222222222222222222222222222';

describe('parsePushCli policy', () => {
  it('returns isPrePush=false when --pre-push flag is absent', () => {
    const res = parsePushCli(['node', 'scripts/run-push.mjs']);
    expect(res).toEqual({ isPrePush: false, pushInput: undefined });
  });

  it('reads explicit --input argument when provided', () => {
    const res = parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push', '--input', VALID_ROW]);
    expect(res).toEqual({ isPrePush: true, pushInput: VALID_ROW });
  });

  it('throws error when --input flag is missing an argument value', () => {
    expect(() => parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push', '--input'])).toThrow(
      'Flag --input specified without an input value argument.',
    );

    expect(() =>
      parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push', '--input', '--other']),
    ).toThrow('Flag --input specified without an input value argument.');
  });

  it('reads stdin using provided reader function when --pre-push is given without --input', () => {
    const mockStdin = () => VALID_ROW;
    const res = parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push'], mockStdin);
    expect(res).toEqual({ isPrePush: true, pushInput: VALID_ROW });
  });

  it('validates stdin input lines using parsePrePushInput and rejects malformed lines', () => {
    const malformedStdin = () => 'not a valid pre push line';
    expect(() =>
      parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push'], malformedStdin),
    ).toThrow('Malformed pre-push input line 1');
  });

  it('handles empty stdin gracefully as valid pre-push input', () => {
    const emptyStdin = () => '';
    const res = parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push'], emptyStdin);
    expect(res).toEqual({ isPrePush: true, pushInput: '' });
  });

  it('handles CRLF line endings in stdin correctly', () => {
    const crlfStdin = () => `${VALID_ROW}\r\n${DELETE_ROW}\r\n`;
    const res = parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push'], crlfStdin);
    expect(res.isPrePush).toBe(true);
    expect(res.pushInput).toContain('\r\n');
  });

  it('wraps stdin read errors with informative message', () => {
    const failingStdin = () => {
      throw new Error('EPIPE');
    };
    expect(() =>
      parsePushCli(['node', 'scripts/run-push.mjs', '--pre-push'], failingStdin),
    ).toThrow('Failed to read pre-push input from stdin: EPIPE');
  });
});

describe('buildPushCommands policy', () => {
  it('builds direct commands when pushInput is undefined (no stdin forwarded)', () => {
    const cmds = buildPushCommands(undefined);
    expect(cmds).toEqual([
      { command: 'npm', args: ['run', 'quality:l2'], stdio: 'inherit' },
      { command: 'node', args: ['scripts/run-g2.mjs'], stdio: 'inherit' },
    ]);
  });

  it('builds pre-push commands forwarding validated pushInput exclusively to G2', () => {
    const cmds = buildPushCommands(VALID_ROW);
    expect(cmds).toEqual([
      { command: 'npm', args: ['run', 'quality:l2'], stdio: 'inherit' },
      {
        command: 'node',
        args: ['scripts/run-g2.mjs', '--pre-push', '--input', VALID_ROW],
        stdio: 'inherit',
      },
    ]);
  });

  it('builds pre-push commands for deletion rows forwarding to G2', () => {
    const cmds = buildPushCommands(DELETE_ROW);
    expect(cmds[0]).toEqual({
      command: 'npm',
      args: ['run', 'quality:l2'],
      stdio: 'inherit',
    });
    expect(cmds[1]).toEqual({
      command: 'node',
      args: ['scripts/run-g2.mjs', '--pre-push', '--input', DELETE_ROW],
      stdio: 'inherit',
    });
  });
});

describe('runPushGate execution and signal handling', () => {
  it('runs configured commands via runner and resolves true on success with default commands', async () => {
    let capturedOptions = null;
    let capturedCommands = null;
    const fakeRunner = async (commands, options) => {
      capturedCommands = commands;
      capturedOptions = options;
    };

    const ok = await runPushGate({
      runner: fakeRunner,
      pushInput: VALID_ROW,
      silent: true,
      listenToProcess: false,
    });
    expect(ok).toBe(true);
    expect(capturedCommands.length).toBe(2);
    expect(capturedOptions.timeoutMs).toBe(180_000);
    expect(capturedOptions.escalationGraceMs).toBe(3000);
    expect(capturedOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails closed and returns false on runner error', async () => {
    const savedExitCode = process.exitCode;
    try {
      const fakeFailingRunner = async () => {
        throw new Error('L2 suite failed');
      };

      const ok = await runPushGate({
        runner: fakeFailingRunner,
        silent: true,
        listenToProcess: false,
      });
      expect(ok).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('aborts when parent signal is aborted before start', async () => {
    const savedExitCode = process.exitCode;
    try {
      const parentController = new AbortController();
      parentController.abort(new Error('Parent aborted'));

      const fakeRunner = async (_cmds, options) => {
        expect(options.signal.aborted).toBe(true);
        throw new Error('aborted');
      };

      const ok = await runPushGate({
        runner: fakeRunner,
        signal: parentController.signal,
        silent: true,
        listenToProcess: false,
      });
      expect(ok).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('aborts runner when parent signal is triggered during run', async () => {
    const savedExitCode = process.exitCode;
    try {
      const parentController = new AbortController();

      const fakeRunner = async (_cmds, options) => {
        parentController.abort();
        expect(options.signal.aborted).toBe(true);
        throw new Error('aborted by parent');
      };

      const ok = await runPushGate({
        runner: fakeRunner,
        signal: parentController.signal,
        silent: true,
        listenToProcess: false,
      });
      expect(ok).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('restores process signal listeners and maps SIGINT/SIGTERM exit codes', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    try {
      const fakeSigintRunner = async (_cmds, options) => {
        process.emit('SIGINT');
        expect(options.signal.aborted).toBe(true);
        throw new Error('Interrupted');
      };

      const res = await runPushGate({
        runner: fakeSigintRunner,
        silent: true,
        listenToProcess: true,
      });
      expect(res).toBe(false);
      expect(process.exitCode).toBe(130);

      const fakeSigtermRunner = async (_cmds, options) => {
        process.emit('SIGTERM');
        expect(options.signal.aborted).toBe(true);
        throw new Error('Terminated');
      };

      const resTerm = await runPushGate({
        runner: fakeSigtermRunner,
        silent: true,
        listenToProcess: true,
      });
      expect(resTerm).toBe(false);
      expect(process.exitCode).toBe(143);

      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('retains owned listeners during deferred runner settlement with repeated and mixed signals (SIGTERM first), preserves first abort status, and keeps gate pending until settlement', async () => {
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

    let capturedRunnerSignal = null;
    let gateSettled = false;

    const deferredRunner = async (_commands, { signal }) => {
      capturedRunnerSignal = signal;
      resolveRunnerEntered();
      await runnerDeferred;
      if (signal.aborted) {
        throw new Error(signal.reason?.message || 'Runner aborted');
      }
    };

    let gatePromise;
    try {
      gatePromise = runPushGate({
        runner: deferredRunner,
        silent: true,
        listenToProcess: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      await runnerEntered;

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

      // Emit first signal: SIGTERM
      process.emit('SIGTERM');

      // Assert owned listeners remain attached (not dropped by process.once)
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(capturedRunnerSignal.aborted).toBe(true);

      // Emit repeat signal, then other signal
      process.emit('SIGTERM');
      process.emit('SIGINT');

      // Assert owned listeners still remain attached
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Verify gate remains pending while runner settlement is delayed
      expect(gateSettled).toBe(false);

      // Release runner to settle and reject
      releaseRunner();

      const ok = await gatePromise;
      expect(ok).toBe(false);
      // First signal status (SIGTERM -> 143) survives despite subsequent SIGINT
      expect(process.exitCode).toBe(143);

      // Listener arrays are fully restored
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

  it('retains owned listeners during deferred runner settlement with repeated and mixed signals (SIGINT first), preserves first abort status, and keeps gate pending until settlement', async () => {
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

    let capturedRunnerSignal = null;
    let gateSettled = false;

    const deferredRunner = async (_commands, { signal }) => {
      capturedRunnerSignal = signal;
      resolveRunnerEntered();
      await runnerDeferred;
      if (signal.aborted) {
        throw new Error(signal.reason?.message || 'Runner aborted');
      }
    };

    let gatePromise;
    try {
      gatePromise = runPushGate({
        runner: deferredRunner,
        silent: true,
        listenToProcess: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      await runnerEntered;

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

      // Emit first signal: SIGINT
      process.emit('SIGINT');

      // Assert owned listeners remain attached
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(capturedRunnerSignal.aborted).toBe(true);

      // Emit repeat signal, then other signal
      process.emit('SIGINT');
      process.emit('SIGTERM');

      // Assert owned listeners still remain attached
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);

      // Verify gate remains pending while runner settlement is delayed
      expect(gateSettled).toBe(false);

      // Release runner to settle and reject
      releaseRunner();

      const ok = await gatePromise;
      expect(ok).toBe(false);
      // First signal status (SIGINT -> 130) survives despite subsequent SIGTERM
      expect(process.exitCode).toBe(130);

      // Listener arrays are fully restored
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

  it('exercises real nested production cancellation: outer push escalation allows inner L2 to clean up root and terminate descendants', async () => {
    const savedExitCode = process.exitCode;
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nested-cancellation-'));
    const readyFile = path.join(tempDir, 'ready.json');
    const leafReadyFile = path.join(tempDir, 'leaf-ready');
    const rootLogFile = path.join(tempDir, 'roots.jsonl');
    const pidsLogFile = path.join(tempDir, 'pids.jsonl');
    const blockerScript = path.join(tempDir, 'blocker.cjs');
    const l2ChildScript = path.join(tempDir, 'run-l2-child.mjs');
    const packageJsonPath = path.join(tempDir, 'package.json');

    const capturedPids = [];
    let childPromise = null;
    const outerController = new AbortController();

    try {
      // 1. blocker.cjs: receives owned paths via process.env, spawns leaf process that ignores SIGTERM, writes readyFile
      const blockerContent = `
const fs = require('node:fs');
const cp = require('node:child_process');
const leafReady = process.env.POKEPOCKET_TEST_LEAF_READY;
const ready = process.env.POKEPOCKET_TEST_READY;
const pidsLog = process.env.POKEPOCKET_TEST_PIDS_LOG;

const leaf = cp.spawn(process.execPath, [
  '-e',
  "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);",
  leafReady
], { stdio: 'ignore' });

if (leaf.pid && pidsLog) {
  fs.appendFileSync(pidsLog, JSON.stringify({ pid: leaf.pid, name: 'leaf' }) + '\\n');
}

const timer = setInterval(() => {
  if (fs.existsSync(leafReady)) {
    clearInterval(timer);
    fs.writeFileSync(ready, JSON.stringify({ pid: process.pid, leaf: leaf.pid }));
  }
}, 10);
setInterval(() => {}, 1000);
`;
      await writeFile(blockerScript, blockerContent);

      // 2. Owned package.json with fixed "node blocker.cjs" command
      const packageJsonContent = JSON.stringify({
        name: 'owned-nested-fixture',
        scripts: {
          build: 'node blocker.cjs',
        },
      });
      await writeFile(packageJsonPath, packageJsonContent);

      // 3. Child wrapper importing actual runL2Gate with 1300ms deferred rm and wrapping runParallelCommands
      const l2ChildContent = `
import { rm as baseRm, mkdtemp as baseMkdtemp } from 'node:fs/promises';
import fs from 'node:fs';
import { spawn as baseSpawn } from 'node:child_process';
import { runL2Gate } from ${JSON.stringify(path.resolve(process.cwd(), 'scripts/run-l2.mjs'))};
import { runParallelCommands } from ${JSON.stringify(path.resolve(process.cwd(), 'scripts/run-parallel.mjs'))};

const rootLog = process.env.POKEPOCKET_TEST_ROOTS_LOG;
const pidsLog = process.env.POKEPOCKET_TEST_PIDS_LOG;

const customRm = async (target, opts) => {
  await new Promise((res) => setTimeout(res, 1300));
  return baseRm(target, opts);
};

const customMkdtemp = async (prefix) => {
  const res = await baseMkdtemp(prefix);
  if (rootLog) fs.appendFileSync(rootLog, String(res) + '\\n');
  return res;
};

const commandRunner = (cmds, opts = {}) => {
  const customSpawn = (cmd, args, spawnOpts) => {
    const ch = baseSpawn(cmd, args, spawnOpts);
    if (typeof ch.pid === 'number' && pidsLog) {
      fs.appendFileSync(pidsLog, JSON.stringify({ pid: ch.pid, name: String(cmd) }) + '\\n');
    }
    return ch;
  };

  return runParallelCommands(cmds, {
    ...opts,
    spawn: customSpawn,
  });
};

const ok = await runL2Gate({
  silent: true,
  commandRunner,
  mkdtempFn: customMkdtemp,
  rmFn: customRm,
});
if (!ok && process.exitCode === undefined) {
  process.exitCode = 1;
}
`;
      await writeFile(l2ChildScript, l2ChildContent);

      // 4. Outer parallel runner with captured PIDs seam
      const { runParallelCommands } = await import('../../scripts/run-parallel.mjs');
      const innerSpawnSeam = (cmd, args, opts) => {
        const { spawn: baseSpawn } = require('node:child_process');
        const child = baseSpawn(cmd, args, opts);
        if (typeof child.pid === 'number') {
          capturedPids.push(child.pid);
        }
        return child;
      };

      const outerParallelRunner = (commands, runnerOpts) => {
        return runParallelCommands(commands, {
          ...runnerOpts,
          spawn: innerSpawnSeam,
        });
      };

      // 5. Run push gate with the l2 child wrapper command and real outer parallel runner
      const testCommands = [
        {
          command: process.execPath,
          args: [l2ChildScript],
          cwd: tempDir,
          env: {
            ...process.env,
            POKEPOCKET_TEST_LEAF_READY: leafReadyFile,
            POKEPOCKET_TEST_READY: readyFile,
            POKEPOCKET_TEST_ROOTS_LOG: rootLogFile,
            POKEPOCKET_TEST_PIDS_LOG: pidsLogFile,
          },
          stdio: 'ignore',
        },
      ];

      childPromise = runPushGate({
        runner: outerParallelRunner,
        commands: testCommands,
        signal: outerController.signal,
        escalationGraceMs: 3000,
        silent: true,
        listenToProcess: false,
      });
      childPromise.catch(() => {});

      // Wait until blocker is ready
      const start = Date.now();
      while (true) {
        try {
          const content = await readFile(readyFile, 'utf8');
          const meta = JSON.parse(content);
          if (meta.pid) capturedPids.push(meta.pid);
          if (meta.leaf) capturedPids.push(meta.leaf);
          break;
        } catch {
          if (Date.now() - start > 5000) throw new Error('Timeout waiting for blocker ready');
          await delay(25);
        }
      }

      // Coordinator aborts push gate
      outerController.abort();

      const ok = await childPromise;
      expect(ok).toBe(false);

      // Read all logged pids from inner runner unconditionally
      const pidLines = (await readFile(pidsLogFile, 'utf8')).trim().split('\n').filter(Boolean);
      expect(pidLines.length).toBeGreaterThan(0);
      const loggedRecords = pidLines.map((line) => JSON.parse(line));
      const hasLeafRecord = loggedRecords.some(
        (rec) => rec.name === 'leaf' && typeof rec.pid === 'number' && rec.pid > 0,
      );
      const hasBuildRecord = loggedRecords.some(
        (rec) =>
          typeof rec.pid === 'number' &&
          rec.pid > 0 &&
          (rec.name === 'npm' || rec.name.includes('node') || rec.name.includes('npm')),
      );
      expect(hasLeafRecord).toBe(true);
      expect(hasBuildRecord).toBe(true);
      for (const rec of loggedRecords) {
        expect(typeof rec.pid).toBe('number');
        expect(rec.pid).toBeGreaterThan(0);
        capturedPids.push(rec.pid);
      }

      // Verify all captured processes settled cleanly
      const survivors = await settleChildren(capturedPids, 2500);
      expect(survivors).toEqual([]);

      // Require that L2 actually allocated its root and removed it
      const rootLines = (await readFile(rootLogFile, 'utf8')).trim().split('\n').filter(Boolean);
      expect(rootLines.length).toBeGreaterThan(0);
      const { existsSync } = await import('node:fs');
      for (const rootPath of rootLines) {
        expect(path.basename(rootPath).startsWith('pokepocket-l2-gate-')).toBe(true);
        expect(existsSync(rootPath)).toBe(false);
      }
    } finally {
      outerController.abort();
      if (childPromise) {
        try {
          await childPromise;
        } catch {}
      }
      try {
        const lines = (await readFile(pidsLogFile, 'utf8')).trim().split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.pid) capturedPids.push(parsed.pid);
        }
      } catch {}
      for (const pid of capturedPids) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {}
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      try {
        const rootLines = (await readFile(rootLogFile, 'utf8')).trim().split('\n').filter(Boolean);
        for (const rootPath of rootLines) {
          if (path.basename(rootPath).startsWith('pokepocket-l2-gate-')) {
            await rm(rootPath, { recursive: true, force: true });
          }
        }
      } catch {}
      await rm(tempDir, { recursive: true, force: true });
      process.exitCode = savedExitCode;
    }
  }, 15_000);

  it('logs failure message when not silent and formats error output', async () => {
    const errorLogs = [];
    const origError = console.error;
    console.error = (...args) => {
      errorLogs.push(args.join(' '));
    };

    const savedExitCode = process.exitCode;
    try {
      const ok = await runPushGate({
        runner: async () => {
          throw new Error('Explicit gate failure simulation');
        },
        silent: false,
        listenToProcess: false,
      });
      expect(ok).toBe(false);
      expect(
        errorLogs.some((l) =>
          l.includes('Push quality gate failed: Explicit gate failure simulation'),
        ),
      ).toBe(true);
    } finally {
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });
});
