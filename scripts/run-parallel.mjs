import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function killProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    try {
      process.kill(pgid, signal);
    } catch {}
  }
}

function formatCommand(cmd) {
  if (cmd.args && cmd.args.length > 0) {
    return `${cmd.command} ${cmd.args.join(' ')}`;
  }
  return cmd.command;
}

export function runParallelCommands(commands, options = {}) {
  const signal = options.signal;
  const timeoutMs = options.timeoutMs;
  const escalationGraceMs = options.escalationGraceMs ?? 1000;
  const spawnFn = options.spawn ?? spawn;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Parallel execution aborted before start'));
    }

    if (!commands || commands.length === 0) {
      return resolve();
    }

    const processGroups = new Set();
    let settled = false;
    let completedCount = 0;
    let timeoutTimer = null;
    let cleanupPromise = null;
    let abortListener = null;

    function cleanupAll() {
      if (cleanupPromise) return cleanupPromise;

      cleanupPromise = new Promise((cleanupDone) => {
        // Send SIGTERM to all captured process groups
        for (const pgid of processGroups) {
          killProcessGroup(pgid, 'SIGTERM');
        }

        // Escalation to SIGKILL after escalation grace period
        // Keep referenced until completed! Do NOT call unref()!
        setTimeout(() => {
          for (const pgid of processGroups) {
            killProcessGroup(pgid, 'SIGKILL');
          }
          cleanupDone();
        }, escalationGraceMs);
      });

      return cleanupPromise;
    }

    function removeOwnedListeners() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
    }

    async function finish(err) {
      if (settled) return;
      settled = true;
      removeOwnedListeners();

      if (err) {
        await cleanupAll();
        reject(err);
      } else {
        resolve();
      }
    }

    if (timeoutMs) {
      timeoutTimer = setTimeout(() => {
        finish(new Error(`Parallel execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    if (signal) {
      abortListener = () => {
        finish(new Error('Parallel execution aborted by signal'));
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    for (const cmd of commands) {
      if (settled) break;

      let child;
      try {
        child = spawnFn(cmd.command, cmd.args || [], {
          cwd: cmd.cwd || process.cwd(),
          detached: true,
          stdio: cmd.stdio || 'inherit',
          env: { ...process.env, ...cmd.env },
        });
      } catch (err) {
        finish(err);
        break;
      }

      if (typeof child.pid === 'number') {
        processGroups.add(child.pid);
      }

      child.on('error', (err) => {
        finish(err);
      });

      child.on('close', (code, sig) => {
        if (code !== 0 || sig !== null) {
          const formatted = formatCommand(cmd);
          if (sig) {
            finish(new Error(`Command "${formatted}" terminated by signal ${sig}`));
          } else {
            finish(new Error(`Command "${formatted}" exited with code ${code}`));
          }
        } else {
          completedCount++;
          if (completedCount === commands.length) {
            finish();
          }
        }
      });
    }
  });
}

export async function runPreCommitGate(options = {}) {
  const runner = options.runner ?? runParallelCommands;
  const commands = options.commands ?? [
    { command: 'npm', args: ['run', 'quality:l1'] },
    { command: 'npm', args: ['run', 'quality:g1'] },
  ];
  const timeoutMs = options.timeoutMs ?? 28_000;
  const abortController = new AbortController();

  let signalReceived = null;
  const onSigint = () => {
    if (signalReceived === null) {
      signalReceived = 'SIGINT';
    }
    abortController.abort();
  };
  const onSigterm = () => {
    if (signalReceived === null) {
      signalReceived = 'SIGTERM';
    }
    abortController.abort();
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  try {
    await runner(commands, {
      timeoutMs,
      signal: abortController.signal,
    });
    return true;
  } catch (error) {
    if (!options.silent) {
      console.error(`Pre-commit quality check failed: ${error.message}`);
    }
    process.exitCode = signalReceived ? (signalReceived === 'SIGINT' ? 130 : 143) : 1;
    return false;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ok = await runPreCommitGate();
  if (!ok && process.exitCode === undefined) {
    process.exitCode = 1;
  }
}
