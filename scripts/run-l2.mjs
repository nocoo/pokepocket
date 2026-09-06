import { pathToFileURL } from 'node:url';
import { runParallelCommands } from './run-parallel.mjs';

export async function runL2Gate(options = {}) {
  const silent = options.silent ?? false;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const commandRunner = options.commandRunner ?? runParallelCommands;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`L2 gate timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref?.();

  const handleSigint = () => controller.abort(new Error('Interrupted by SIGINT'));
  const handleSigterm = () => controller.abort(new Error('Interrupted by SIGTERM'));

  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);

  try {
    const runOptions = { commandRunner, signal: controller.signal };
    if (options.runner) {
      await options.runner(runOptions);
    } else {
      await runL2Default(runOptions);
    }
    return true;
  } catch (err) {
    if (!silent) {
      console.error('L2 Gate failed:', err);
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
    } else {
      process.exitCode = 1;
    }
    return false;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  }
}

export async function runL2Default(options = {}) {
  const commandRunner = options.commandRunner ?? runParallelCommands;
  const commandOptions = { signal: options.signal };

  // Step 1: Sequential build of production bundle
  await commandRunner([{ command: 'npm', args: ['run', 'build'] }], commandOptions);

  // Step 2: Run L2 test suite against built bundle
  await commandRunner(
    [{ command: 'npx', args: ['vitest', 'run', '--config', 'vitest.l2.config.ts'] }],
    commandOptions,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runL2Gate();
}
