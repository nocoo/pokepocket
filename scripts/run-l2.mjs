import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_RESOURCE_ROOT_ENV } from './production-runtime.mjs';
import { runParallelCommands } from './run-parallel.mjs';

export async function runL2Gate(options = {}) {
  const silent = options.silent ?? false;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const commandRunner = options.commandRunner ?? runParallelCommands;
  const mkdtempFn = options.mkdtempFn ?? mkdtemp;
  const rmFn = options.rmFn ?? rm;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`L2 gate timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref?.();

  const handleSigint = () => controller.abort(new Error('Interrupted by SIGINT'));
  const handleSigterm = () => controller.abort(new Error('Interrupted by SIGTERM'));

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  let ownedResourceRoot = null;
  let executionError = null;
  let cleanupError = null;

  try {
    ownedResourceRoot = await mkdtempFn(path.join(tmpdir(), 'pokepocket-l2-gate-'));
    const runOptions = {
      commandRunner,
      signal: controller.signal,
      resourceRoot: ownedResourceRoot,
    };
    await runL2Default(runOptions);
  } catch (err) {
    executionError = err;
    if (!silent) {
      console.error('L2 Gate execution failed:', err);
    }
  } finally {
    clearTimeout(timer);

    if (ownedResourceRoot) {
      try {
        await rmFn(ownedResourceRoot, { recursive: true, force: true });
      } catch (rmErr) {
        cleanupError = rmErr;
        if (!silent) {
          console.error('L2 Gate cleanup failed:', rmErr);
        }
      }
    }

    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  }

  if (controller.signal.aborted) {
    const reason = controller.signal.reason?.message || '';
    if (reason.includes('SIGINT')) {
      process.exitCode = 130;
    } else if (reason.includes('SIGTERM')) {
      process.exitCode = 143;
    } else {
      process.exitCode = 1;
    }
    return false;
  }

  if (executionError) {
    process.exitCode = 1;
    return false;
  }

  if (cleanupError) {
    process.exitCode = 1;
    return false;
  }

  return true;
}

export async function runL2Default(options = {}) {
  const commandRunner = options.commandRunner ?? runParallelCommands;
  const commandOptions = { signal: options.signal };

  // Step 1: Sequential build of production bundle
  await commandRunner([{ command: 'npm', args: ['run', 'build'] }], commandOptions);

  // Step 2: Run L2 test suite against built bundle with owned resource root passed to child env
  const childEnv = options.resourceRoot
    ? { [RUNTIME_RESOURCE_ROOT_ENV]: options.resourceRoot }
    : undefined;

  await commandRunner(
    [
      {
        command: 'npx',
        args: ['vitest', 'run', '--config', 'vitest.l2.config.ts'],
        env: childEnv,
      },
    ],
    commandOptions,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runL2Gate();
}
