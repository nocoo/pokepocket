import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parsePrePushInput } from './run-g2.mjs';
import { runParallelCommands } from './run-parallel.mjs';

export function parsePushCli(argv = process.argv, readStdinFn = () => readFileSync(0, 'utf8')) {
  const isPrePush = argv.includes('--pre-push');
  if (!isPrePush) {
    return { isPrePush: false, pushInput: undefined };
  }

  const inputIdx = argv.indexOf('--input');
  if (inputIdx !== -1) {
    const val = argv[inputIdx + 1];
    if (val === undefined || val.startsWith('--')) {
      throw new Error('Flag --input specified without an input value argument.');
    }
    parsePrePushInput(val);
    return { isPrePush: true, pushInput: val };
  }

  try {
    const raw = readStdinFn();
    parsePrePushInput(raw);
    return { isPrePush: true, pushInput: raw };
  } catch (err) {
    throw new Error(`Failed to read pre-push input from stdin: ${err.message}`);
  }
}

export function buildPushCommands(pushInput) {
  const l2Command = {
    command: 'npm',
    args: ['run', 'quality:l2'],
    stdio: 'inherit',
  };

  const g2Args = ['scripts/run-g2.mjs'];
  if (pushInput !== undefined) {
    g2Args.push('--pre-push', '--input', pushInput);
  }

  const g2Command = {
    command: 'node',
    args: g2Args,
    stdio: 'inherit',
  };

  return [l2Command, g2Command];
}

export async function runPushGate(options = {}) {
  const runner = options.runner ?? runParallelCommands;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const escalationGraceMs = options.escalationGraceMs ?? 3000;
  const pushInput = options.pushInput;
  const commands = options.commands ?? buildPushCommands(pushInput);

  const abortController = new AbortController();
  const parentSignal = options.signal;

  let signalReceived = null;
  const onSigint = () => {
    signalReceived = 'SIGINT';
    abortController.abort();
  };
  const onSigterm = () => {
    signalReceived = 'SIGTERM';
    abortController.abort();
  };

  const onParentAbort = () => {
    abortController.abort(parentSignal.reason);
  };

  const listenToProcess = options.listenToProcess ?? true;
  if (listenToProcess) {
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  try {
    await runner(commands, {
      timeoutMs,
      escalationGraceMs,
      signal: abortController.signal,
    });
    return true;
  } catch (error) {
    if (!options.silent) {
      console.error(`Push quality gate failed: ${error.message}`);
    }
    if (signalReceived === 'SIGINT') {
      process.exitCode = 130;
    } else if (signalReceived === 'SIGTERM') {
      process.exitCode = 143;
    } else {
      process.exitCode = 1;
    }
    return false;
  } finally {
    if (listenToProcess) {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    }
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let parsed;
  try {
    parsed = parsePushCli();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await runPushGate({ pushInput: parsed.pushInput });
}
