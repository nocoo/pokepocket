import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadQualityToolsConfig,
  parseScannerVersion,
  redactSecrets,
  runProcessCapture,
} from './run-g2.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, 'quality-tools.json');

export function resolveBinaryUrl(scannerKey, info) {
  const { name, version } = info;
  if (scannerKey === 'osv' || name === 'osv-scanner') {
    return `https://github.com/google/osv-scanner/releases/download/v${version}/osv-scanner_linux_amd64`;
  }
  if (scannerKey === 'gitleaks' || name === 'gitleaks') {
    return `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`;
  }
  throw new Error(`Unknown scanner "${scannerKey}"`);
}

export function downloadFile(url, destPath) {
  const res = spawnSync('curl', ['-sSL', '--fail', url, '-o', destPath], { stdio: 'pipe' });
  if (res.status !== 0) {
    const err = res.stderr ? res.stderr.toString('utf8') : '';
    throw new Error(`Download failed for ${url} (exit code ${res.status}): ${err}`);
  }
}

export function installScanners(options = {}) {
  const config = options.config ?? loadQualityToolsConfig(CONFIG_PATH);
  const targetDir = options.targetDir;
  const downloadFn = options.downloadFn ?? downloadFile;

  mkdirSync(targetDir, { recursive: true });

  const osvInfo = config.scanners.osv;
  const gitleaksInfo = config.scanners.gitleaks;

  // 1. Install osv-scanner
  const osvUrl = resolveBinaryUrl('osv', osvInfo);
  const osvBinaryPath = path.join(targetDir, osvInfo.name);
  if (existsSync(osvBinaryPath)) {
    rmSync(osvBinaryPath, { force: true });
  }
  downloadFn(osvUrl, osvBinaryPath);
  chmodSync(osvBinaryPath, 0o755);

  // 2. Install gitleaks (tar.gz)
  const gitleaksUrl = resolveBinaryUrl('gitleaks', gitleaksInfo);
  const tempArchive = path.join(
    os.tmpdir(),
    `gitleaks-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`,
  );
  const gitleaksBinaryPath = path.join(targetDir, gitleaksInfo.name);
  try {
    downloadFn(gitleaksUrl, tempArchive);
    if (existsSync(gitleaksBinaryPath)) {
      rmSync(gitleaksBinaryPath, { force: true });
    }
    const tarRes = spawnSync('tar', ['-xzf', tempArchive, '-C', targetDir, gitleaksInfo.name], {
      stdio: 'pipe',
    });
    if (tarRes.status !== 0) {
      const err = tarRes.stderr ? tarRes.stderr.toString('utf8') : '';
      throw new Error(`Failed to extract gitleaks from ${tempArchive}: ${err}`);
    }
    chmodSync(gitleaksBinaryPath, 0o755);
  } finally {
    if (existsSync(tempArchive)) {
      rmSync(tempArchive, { force: true });
    }
  }

  return { targetDir, osvBinaryPath, gitleaksBinaryPath };
}

export async function verifyInstalledBinary(binaryPath, scannerKey, expectedVersion, options = {}) {
  const runner = options.runner ?? runProcessCapture;
  const versionFlag = scannerKey === 'osv' ? '--version' : 'version';

  let result;
  try {
    result = await runner(binaryPath, [versionFlag], {
      timeoutMs: options.timeoutMs ?? 10_000,
      env: options.env,
      cwd: options.cwd,
    });
  } catch (err) {
    throw new Error(`Failed to execute installed binary at "${binaryPath}": ${err.message}`);
  }

  if (result.signal !== null) {
    throw new Error(`Version check for "${binaryPath}" terminated by signal ${result.signal}`);
  }

  if (result.code !== 0) {
    throw new Error(
      `Version check for "${binaryPath}" failed with exit code ${result.code}: ${redactSecrets(result.stderr || '')}`,
    );
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const actualVersion = parseScannerVersion(scannerKey, combinedOutput);

  if (!actualVersion || actualVersion !== expectedVersion) {
    throw new Error(
      `Version mismatch for installed binary at "${binaryPath}": expected exact version "${expectedVersion}", but found "${actualVersion || 'unknown'}". Output: ${redactSecrets(combinedOutput).trim()}`,
    );
  }

  return actualVersion;
}

export async function runInstallScannersCli(options = {}) {
  const targetDir = options.targetDir;
  const config = options.config ?? loadQualityToolsConfig(CONFIG_PATH);

  const installResult = installScanners({ ...options, targetDir, config });

  const osvExpected = config.scanners.osv.version;
  const gitleaksExpected = config.scanners.gitleaks.version;

  await verifyInstalledBinary(installResult.osvBinaryPath, 'osv', osvExpected, options);
  await verifyInstalledBinary(
    installResult.gitleaksBinaryPath,
    'gitleaks',
    gitleaksExpected,
    options,
  );

  const extendedEnv = {
    ...process.env,
    ...options.env,
    PATH: `${targetDir}:${options.env?.PATH ?? process.env.PATH ?? ''}`,
  };
  await verifyInstalledBinary(config.scanners.osv.name, 'osv', osvExpected, {
    ...options,
    env: extendedEnv,
  });
  await verifyInstalledBinary(config.scanners.gitleaks.name, 'gitleaks', gitleaksExpected, {
    ...options,
    env: extendedEnv,
  });

  const githubPath = options.githubPath ?? process.env.GITHUB_PATH;
  if (githubPath && existsSync(githubPath)) {
    appendFileSync(githubPath, `${targetDir}\n`, 'utf8');
  }

  return installResult;
}

export function resolveDefaultTargetDir() {
  if (process.env.RUNNER_TEMP) {
    return path.join(process.env.RUNNER_TEMP, 'bin');
  }
  return '/usr/local/bin';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await runInstallScannersCli({ targetDir: resolveDefaultTargetDir() });
    console.log('Quality scanners installed and verified successfully.');
  } catch (err) {
    console.error(`Scanner installation failed: ${err.message}`);
    process.exit(1);
  }
}
