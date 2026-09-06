import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const QUALITY_TOOLS_PATH = new URL('./quality-tools.json', import.meta.url);
const SHA_HEX_REGEX = /^[0-9a-f]{40}$/i;
const ZERO_SHA = '0000000000000000000000000000000000000000';

function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

export function loadQualityToolsConfig(configPath = QUALITY_TOOLS_PATH) {
  const content = readFileSync(configPath, 'utf8');
  return JSON.parse(content);
}

export function parseScannerVersion(scannerName, output) {
  if (typeof output !== 'string') return null;

  if (scannerName === 'osv' || scannerName === 'osv-scanner') {
    // Exact format from osv-scanner: osv-scanner version: 2.5.1
    const match = output.match(/^osv-scanner\s+version:\s*([^\s\r\n]+)\s*$/m);
    return match ? match[1].trim() : null;
  }

  if (scannerName === 'gitleaks') {
    // Exact line from gitleaks version: 8.30.1 or v8.30.1 (anchored to entire line)
    const match = output.match(/^\s*v?([0-9]+\.[0-9]+\.[0-9]+(?:\S*))\s*$/m);
    return match ? match[1].trim() : null;
  }

  return null;
}

export function redactSecrets(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/(Secret:\s*)([^\r\n]+)/gi, '$1[REDACTED]')
    .replace(/(ghp_[A-Za-z0-9]{36,})/g, '[REDACTED]')
    .replace(/(gho_[A-Za-z0-9]{36,})/g, '[REDACTED]')
    .replace(/(github_pat_[A-Za-z0-9_]{22,})/g, '[REDACTED]')
    .replace(/(glpat-[A-Za-z0-9_-]{20,})/g, '[REDACTED]')
    .replace(/(ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,})/g, '[REDACTED]');
}

export function runProcessCapture(command, args, options = {}) {
  const spawnFn = options.spawnFn ?? spawn;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const escalationGraceMs = options.escalationGraceMs ?? 1000;
  const stdinData = options.stdinData;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutTimer = null;
    let initiatingError = null;
    let abortListener = null;

    if (signal?.aborted) {
      settled = true;
      return reject(new Error('Process execution aborted before start'));
    }

    try {
      child = spawnFn(command, args, {
        cwd,
        env,
        detached: true,
        stdio: [stdinData !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      settled = true;
      return reject(err);
    }

    const pid = child.pid;
    let cleanupPromise = null;

    function cleanupGroup() {
      if (cleanupPromise) return cleanupPromise;

      cleanupPromise = new Promise((done) => {
        if (!pid) {
          done();
          return;
        }

        // Send SIGTERM to captured process group
        killProcessGroup(pid, 'SIGTERM');

        // Keep killTimer referenced until cleanup resolves so Node does not exit early
        setTimeout(() => {
          killProcessGroup(pid, 'SIGKILL');
          done();
        }, escalationGraceMs);
      });

      return cleanupPromise;
    }

    function removeListeners() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
    }

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!initiatingError) {
          initiatingError = new Error(
            `Command "${command} ${args.join(' ')}" timed out after ${timeoutMs}ms`,
          );
        }
        cleanupGroup();
      }, timeoutMs);
      timeoutTimer.unref?.();
    }

    if (signal) {
      abortListener = () => {
        if (!initiatingError) {
          initiatingError = new Error('Process execution aborted by signal');
        }
        cleanupGroup();
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }

    child.stdout?.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    child.on('error', (err) => {
      if (!initiatingError) {
        initiatingError = err;
      }
    });

    child.on('close', async (code, procSignal) => {
      if (settled) return;
      settled = true;
      removeListeners();

      if (initiatingError) {
        await cleanupGroup();
        reject(initiatingError);
      } else if (code !== 0 || procSignal !== null) {
        // Nonzero or signal-only close: ensure descendants are killed before resolving failure
        await cleanupGroup();
        resolve({
          code,
          signal: procSignal,
          stdout,
          stderr,
        });
      } else {
        resolve({
          code,
          signal: procSignal,
          stdout,
          stderr,
        });
      }
    });

    if (stdinData !== undefined && child.stdin) {
      child.stdin.end(stdinData, 'utf8');
    }
  });
}

export async function verifyScannerVersion(scannerKey, options = {}) {
  const runner = options.runner ?? runProcessCapture;
  const config = options.config ?? loadQualityToolsConfig();
  const scannerInfo = config.scanners?.[scannerKey];

  if (!scannerInfo) {
    throw new Error(`Scanner "${scannerKey}" is not defined in quality-tools configuration.`);
  }

  const binaryName = scannerInfo.name;
  const expectedVersion = scannerInfo.version;

  let result;
  try {
    const versionFlag = binaryName === 'osv-scanner' ? '--version' : 'version';
    result = await runner(binaryName, [versionFlag], {
      timeoutMs: options.timeoutMs ?? 10_000,
      cwd: options.cwd,
      signal: options.signal,
    });
  } catch (err) {
    throw new Error(
      `Failed to execute ${binaryName} (${expectedVersion}): ${err.message}. Please ensure ${binaryName} is installed in PATH (e.g. /opt/homebrew/bin). Run '${binaryName} --help' for setup diagnostics.`,
    );
  }

  if (result.signal !== null) {
    throw new Error(
      `${binaryName} version check terminated by signal ${result.signal}. Run '${binaryName} --help' for setup diagnostics.`,
    );
  }

  if (result.code !== 0) {
    const safeStderr = redactSecrets(result.stderr || '');
    throw new Error(
      `${binaryName} version check failed with exit code ${result.code}: ${safeStderr}. Run '${binaryName} --help' for setup diagnostics.`,
    );
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const actualVersion = parseScannerVersion(scannerKey, combinedOutput);

  if (!actualVersion || actualVersion !== expectedVersion) {
    throw new Error(
      `Version mismatch for ${binaryName}: expected exact version "${expectedVersion}", but found "${actualVersion || 'unknown'}". Output: ${redactSecrets(combinedOutput).trim()}. Run '${binaryName} --help' for setup diagnostics.`,
    );
  }

  return { binaryName, expectedVersion, actualVersion };
}

export function parsePrePushInput(input) {
  if (typeof input !== 'string') {
    throw new Error('Pre-push input must be a string.');
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return [];
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const parts = line.split(/\s+/);
    if (parts.length !== 4) {
      throw new Error(
        `Malformed pre-push input line ${i + 1}: expected 4 fields (<local-ref> <local-sha> <remote-ref> <remote-sha>), got "${line}"`,
      );
    }

    const [localRef, localSha, remoteRef, remoteSha] = parts;

    if (!SHA_HEX_REGEX.test(localSha)) {
      throw new Error(`Invalid local SHA on line ${i + 1}: "${localSha}"`);
    }
    if (!SHA_HEX_REGEX.test(remoteSha)) {
      throw new Error(`Invalid remote SHA on line ${i + 1}: "${remoteSha}"`);
    }

    rows.push({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
      isDelete: localSha === ZERO_SHA,
      isNewBranch: remoteSha === ZERO_SHA,
    });
  }

  return rows;
}

export async function checkGitObjectExists(sha, options = {}) {
  const runner = options.runner ?? runProcessCapture;
  const cwd = options.cwd ?? process.cwd();

  try {
    const result = await runner('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd,
      signal: options.signal,
    });
    return result.code === 0 && result.signal === null;
  } catch {
    return false;
  }
}

export async function determinePushScanRanges(rows, options = {}) {
  const ranges = [];
  const cwd = options.cwd ?? process.cwd();
  const objectChecker = options.objectChecker ?? checkGitObjectExists;

  for (const row of rows) {
    if (row.isDelete) {
      // Branch deletion: omit history scan for this ref (still scans bun.lock)
      continue;
    }

    if (row.isNewBranch) {
      // New branch: remote-sha is zero -> full local ancestry of localSha with -m
      ranges.push({
        ref: row.localRef,
        logOpts: `-m ${row.localSha}`,
      });
      continue;
    }

    // Both localSha and remoteSha are non-zero. Check if remoteSha exists locally
    const remoteExists = await objectChecker(row.remoteSha, {
      cwd,
      runner: options.runner,
      signal: options.signal,
    });
    if (!remoteExists) {
      // Conservative fail-safe: scan full local ancestry
      ranges.push({
        ref: row.localRef,
        logOpts: `-m ${row.localSha}`,
      });
    } else {
      ranges.push({
        ref: row.localRef,
        logOpts: `-m ${row.remoteSha}..${row.localSha}`,
      });
    }
  }

  return ranges;
}

export function determineDirectScanRange() {
  // Direct quality:g2 mode scans conservative full committed HEAD ancestry with -m
  return '-m HEAD';
}

export async function runOsvScanner(options = {}) {
  const runner = options.runner ?? runProcessCapture;
  const cwd = options.cwd ?? process.cwd();
  const lockfilePath = options.lockfilePath ?? path.resolve(cwd, 'bun.lock');

  const args = ['scan', `--lockfile=${lockfilePath}`];
  const result = await runner('osv-scanner', args, {
    cwd,
    timeoutMs: options.timeoutMs ?? 120_000,
    signal: options.signal,
  });

  if (result.signal !== null) {
    throw new Error(`osv-scanner terminated by signal ${result.signal}`);
  }

  if (result.code !== 0) {
    const safeOutput = redactSecrets(`${result.stdout}\n${result.stderr}`.trim());
    throw new Error(
      `osv-scanner found vulnerabilities or failed (exit code ${result.code}):\n${safeOutput}`,
    );
  }

  return result;
}

export async function runGitleaksScan(logOpts, options = {}) {
  const runner = options.runner ?? runProcessCapture;
  const cwd = options.cwd ?? process.cwd();
  const ignorePath = options.ignorePath ?? path.resolve(cwd, '.gitleaksignore');

  const args = [
    'git',
    `--log-opts=${logOpts}`,
    `--gitleaks-ignore-path=${ignorePath}`,
    '--redact=100',
    '--no-banner',
    '--no-color',
  ];

  const result = await runner('gitleaks', args, {
    cwd,
    timeoutMs: options.timeoutMs ?? 120_000,
    signal: options.signal,
  });

  if (result.signal !== null) {
    throw new Error(`gitleaks terminated by signal ${result.signal}`);
  }

  if (result.code !== 0) {
    const safeOutput = redactSecrets(`${result.stdout}\n${result.stderr}`.trim());
    throw new Error(
      `gitleaks detected secrets or failed (exit code ${result.code}):\n${safeOutput}`,
    );
  }

  return result;
}

export async function runG2Gate(options = {}) {
  const silent = options.silent ?? false;
  const prePushInput = options.prePushInput; // undefined = direct mode, string = push mode
  const cwd = options.cwd ?? process.cwd();
  const runner = options.runner ?? runProcessCapture;
  const parentSignal = options.signal;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  let processSigReceived = null;
  const handleSigint = () => {
    processSigReceived = 'SIGINT';
    controller.abort(new Error('G2 gate interrupted by SIGINT'));
  };
  const handleSigterm = () => {
    processSigReceived = 'SIGTERM';
    controller.abort(new Error('G2 gate interrupted by SIGTERM'));
  };

  const listenToProcess = options.listenToProcess ?? true;
  if (listenToProcess) {
    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigterm);
  }

  try {
    const gateSignal = controller.signal;

    // 1. Verify exact scanner pins
    const osvPin = await verifyScannerVersion('osv', { runner, cwd, signal: gateSignal });
    const gitleaksPin = await verifyScannerVersion('gitleaks', { runner, cwd, signal: gateSignal });

    if (!silent) {
      console.log(`OSV Scanner verified: ${osvPin.actualVersion}`);
      console.log(`Gitleaks verified: ${gitleaksPin.actualVersion}`);
    }

    // 2. Run OSV scanner on bun.lock (always runs)
    if (!silent) {
      console.log('Running OSV scanner on bun.lock...');
    }
    await runOsvScanner({ runner, cwd, signal: gateSignal });
    if (!silent) {
      console.log('OSV lockfile scan passed.');
    }

    // 3. Determine gitleaks scan ranges
    let rangesToScan = [];
    if (prePushInput !== undefined) {
      const rows = parsePrePushInput(prePushInput);
      rangesToScan = await determinePushScanRanges(rows, {
        cwd,
        runner,
        signal: gateSignal,
        objectChecker: options.objectChecker,
      });
    } else {
      const directRange = determineDirectScanRange();
      rangesToScan = [{ ref: 'direct', logOpts: directRange }];
    }

    // 4. Run gitleaks for each range
    for (const target of rangesToScan) {
      if (!silent) {
        console.log(`Scanning git history for ${target.ref} (${target.logOpts})...`);
      }
      await runGitleaksScan(target.logOpts, { runner, cwd, signal: gateSignal });
    }

    if (!silent) {
      console.log('G2 security quality gates passed.');
    }
    return true;
  } catch (err) {
    if (!silent) {
      console.error(redactSecrets(`G2 Gate failed: ${err.message}`));
    }
    if (processSigReceived === 'SIGINT') {
      process.exitCode = 130;
    } else if (processSigReceived === 'SIGTERM') {
      process.exitCode = 143;
    } else {
      process.exitCode = 1;
    }
    return false;
  } finally {
    if (listenToProcess) {
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

export function parseCliPrePushInput(
  argv = process.argv,
  readStdinFn = () => readFileSync(0, 'utf8'),
) {
  const isPushFlag = argv.includes('--pre-push');
  if (!isPushFlag) {
    return { isPrePush: false, pushInput: undefined };
  }

  const inputArgIdx = argv.indexOf('--input');
  if (inputArgIdx !== -1) {
    const explicitVal = argv[inputArgIdx + 1];
    if (explicitVal === undefined || explicitVal.startsWith('--')) {
      throw new Error('Flag --input specified without an input value argument.');
    }
    return { isPrePush: true, pushInput: explicitVal };
  }

  try {
    const stdinContent = readStdinFn();
    return { isPrePush: true, pushInput: stdinContent };
  } catch (err) {
    throw new Error(`Failed to read pre-push input from stdin: ${err.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let parsed;
  try {
    parsed = parseCliPrePushInput();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  await runG2Gate({ prePushInput: parsed.pushInput });
}
