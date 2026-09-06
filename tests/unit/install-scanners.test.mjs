import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  downloadFile,
  installScanners,
  resolveBinaryUrl,
  resolveDefaultTargetDir,
  runInstallScannersCli,
  verifyInstalledBinary,
} from '../../scripts/install-scanners.mjs';

describe('install-scanners script policy', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'pokepocket-scanner-install-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('resolveDefaultTargetDir', () => {
    it('uses RUNNER_TEMP/bin when RUNNER_TEMP is defined', () => {
      const orig = process.env.RUNNER_TEMP;
      try {
        process.env.RUNNER_TEMP = '/runner-temp-dir';
        expect(resolveDefaultTargetDir()).toBe('/runner-temp-dir/bin');
      } finally {
        if (orig !== undefined) {
          process.env.RUNNER_TEMP = orig;
        } else {
          delete process.env.RUNNER_TEMP;
        }
      }
    });

    it('falls back to /usr/local/bin when RUNNER_TEMP is unset', () => {
      const orig = process.env.RUNNER_TEMP;
      try {
        delete process.env.RUNNER_TEMP;
        expect(resolveDefaultTargetDir()).toBe('/usr/local/bin');
      } finally {
        if (orig !== undefined) {
          process.env.RUNNER_TEMP = orig;
        }
      }
    });
  });

  describe('resolveBinaryUrl', () => {
    it('resolves OSV scanner linux amd64 asset URL', () => {
      const url = resolveBinaryUrl('osv', { name: 'osv-scanner', version: '2.5.1' });
      expect(url).toBe(
        'https://github.com/google/osv-scanner/releases/download/v2.5.1/osv-scanner_linux_amd64',
      );
    });

    it('resolves Gitleaks linux x64 tarball URL', () => {
      const url = resolveBinaryUrl('gitleaks', { name: 'gitleaks', version: '8.30.1' });
      expect(url).toBe(
        'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz',
      );
    });

    it('throws error for unknown scanner key', () => {
      expect(() => resolveBinaryUrl('unknown', { name: 'unknown', version: '1.0.0' })).toThrow(
        /Unknown scanner "unknown"/,
      );
    });
  });

  describe('downloadFile', () => {
    it('throws error when curl fails or URL is invalid', () => {
      const dest = path.join(tempDir, 'fail.tmp');
      expect(() => downloadFile('http://127.0.0.1:9/nonexistent-file', dest)).toThrow(
        /Download failed for/,
      );
    });
  });

  describe('installScanners', () => {
    it('downloads and extracts expected binaries using mocked downloader and tar', () => {
      const downloaded = [];
      const mockDownload = (url, dest) => {
        downloaded.push({ url, dest });
        if (dest.endsWith('.tar.gz')) {
          const tarSourceDir = mkdtempSync(path.join(tmpdir(), 'mock-tar-'));
          writeFileSync(path.join(tarSourceDir, 'gitleaks'), '#!/bin/sh\necho "8.30.1"');
          const cpRes = require('node:child_process').spawnSync(
            'tar',
            ['-czf', dest, '-C', tarSourceDir, 'gitleaks'],
            { stdio: 'pipe' },
          );
          rmSync(tarSourceDir, { recursive: true, force: true });
          if (cpRes.status !== 0) throw new Error('tar archive generation failed');
        } else {
          writeFileSync(dest, '#!/bin/sh\necho "osv-scanner version: 2.5.1"');
        }
      };

      const result = installScanners({
        targetDir: tempDir,
        downloadFn: mockDownload,
      });

      expect(existsSync(result.osvBinaryPath)).toBe(true);
      expect(existsSync(result.gitleaksBinaryPath)).toBe(true);
      expect(downloaded).toHaveLength(2);
      expect(downloaded[0].url).toContain('osv-scanner_linux_amd64');
      expect(downloaded[1].url).toContain('gitleaks_8.30.1_linux_x64.tar.gz');
    });

    it('overwrites pre-existing binaries cleanly', () => {
      const osvPath = path.join(tempDir, 'osv-scanner');
      writeFileSync(osvPath, 'old-osv');
      const gitleaksPath = path.join(tempDir, 'gitleaks');
      writeFileSync(gitleaksPath, 'old-gitleaks');

      const mockDownload = (_url, dest) => {
        if (dest.endsWith('.tar.gz')) {
          const tarSourceDir = mkdtempSync(path.join(tmpdir(), 'mock-tar-'));
          writeFileSync(path.join(tarSourceDir, 'gitleaks'), 'new-gitleaks');
          require('node:child_process').spawnSync('tar', [
            '-czf',
            dest,
            '-C',
            tarSourceDir,
            'gitleaks',
          ]);
          rmSync(tarSourceDir, { recursive: true, force: true });
        } else {
          writeFileSync(dest, 'new-osv');
        }
      };

      installScanners({
        targetDir: tempDir,
        downloadFn: mockDownload,
      });

      expect(readFileSync(osvPath, 'utf8')).toBe('new-osv');
      expect(readFileSync(gitleaksPath, 'utf8')).toBe('new-gitleaks');
    });

    it('fails closed when download fails', () => {
      const failingDownload = () => {
        throw new Error('404 Not Found');
      };

      expect(() =>
        installScanners({
          targetDir: tempDir,
          downloadFn: failingDownload,
        }),
      ).toThrow(/404 Not Found/);
    });

    it('fails closed when extraction fails', () => {
      const corruptDownload = (_url, dest) => {
        if (dest.endsWith('.tar.gz')) {
          writeFileSync(dest, 'not a valid tar');
        } else {
          writeFileSync(dest, '#!/bin/sh');
        }
      };

      expect(() =>
        installScanners({
          targetDir: tempDir,
          downloadFn: corruptDownload,
        }),
      ).toThrow(/Failed to extract gitleaks/);
    });
  });

  describe('verifyInstalledBinary', () => {
    it('succeeds when binary returns expected version', async () => {
      const mockRunner = async () => ({
        code: 0,
        signal: null,
        stdout: 'osv-scanner version: 2.5.1\n',
        stderr: '',
      });
      const v = await verifyInstalledBinary('/bin/osv-scanner', 'osv', '2.5.1', {
        runner: mockRunner,
      });
      expect(v).toBe('2.5.1');
    });

    it('fails closed when binary terminates with signal or non-zero exit code', async () => {
      const signalRunner = async () => ({
        code: null,
        signal: 'SIGSEGV',
        stdout: '',
        stderr: '',
      });
      await expect(
        verifyInstalledBinary('/bin/osv-scanner', 'osv', '2.5.1', { runner: signalRunner }),
      ).rejects.toThrow(/terminated by signal SIGSEGV/);

      const codeRunner = async () => ({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'error reading',
      });
      await expect(
        verifyInstalledBinary('/bin/osv-scanner', 'osv', '2.5.1', { runner: codeRunner }),
      ).rejects.toThrow(/failed with exit code 1/);
    });

    it('fails closed when runner throws error', async () => {
      const throwingRunner = async () => {
        throw new Error('spawn ENOENT');
      };
      await expect(
        verifyInstalledBinary('/bin/osv-scanner', 'osv', '2.5.1', { runner: throwingRunner }),
      ).rejects.toThrow(/Failed to execute installed binary/);
    });

    it('fails closed on version mismatch', async () => {
      const mockRunner = async () => ({
        code: 0,
        signal: null,
        stdout: 'osv-scanner version: 2.3.5\n',
        stderr: '',
      });
      await expect(
        verifyInstalledBinary('/bin/osv-scanner', 'osv', '2.5.1', { runner: mockRunner }),
      ).rejects.toThrow(/expected exact version "2.5.1", but found "2.3.5"/);
    });
  });

  describe('runInstallScannersCli', () => {
    it('installs, verifies through absolute paths and PATH, and persists to GITHUB_PATH', async () => {
      const mockDownload = (_url, dest) => {
        if (dest.endsWith('.tar.gz')) {
          const tarSourceDir = mkdtempSync(path.join(tmpdir(), 'mock-tar-'));
          writeFileSync(path.join(tarSourceDir, 'gitleaks'), '#!/bin/sh\necho "8.30.1"');
          require('node:child_process').spawnSync('tar', [
            '-czf',
            dest,
            '-C',
            tarSourceDir,
            'gitleaks',
          ]);
          rmSync(tarSourceDir, { recursive: true, force: true });
        } else {
          writeFileSync(dest, '#!/bin/sh\necho "osv-scanner version: 2.5.1"');
        }
      };

      const mockRunner = async (cmd, _args, opts) => {
        if (cmd === 'osv-scanner' || cmd.endsWith('/osv-scanner')) {
          if (cmd === 'osv-scanner' && !opts?.env?.PATH?.startsWith(tempDir)) {
            return { code: 0, signal: null, stdout: 'osv-scanner version: 2.3.5\n', stderr: '' };
          }
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        }
        if (cmd === 'gitleaks' || cmd.endsWith('/gitleaks')) {
          if (cmd === 'gitleaks' && !opts?.env?.PATH?.startsWith(tempDir)) {
            return { code: 0, signal: null, stdout: '7.0.0\n', stderr: '' };
          }
          return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
        }
        return { code: 0, signal: null, stdout: '', stderr: '' };
      };

      const githubPathFile = path.join(tempDir, 'github_path_test');
      writeFileSync(githubPathFile, '');

      await expect(
        runInstallScannersCli({
          targetDir: tempDir,
          downloadFn: mockDownload,
          runner: mockRunner,
          githubPath: githubPathFile,
        }),
      ).resolves.toBeDefined();

      const writtenGithubPath = readFileSync(githubPathFile, 'utf8');
      expect(writtenGithubPath.trim()).toBe(tempDir);
    });

    it('rejects installation if older PATH binary is resolved instead of newly installed pin', async () => {
      const mockDownload = (_url, dest) => {
        if (dest.endsWith('.tar.gz')) {
          const tarSourceDir = mkdtempSync(path.join(tmpdir(), 'mock-tar-'));
          writeFileSync(path.join(tarSourceDir, 'gitleaks'), '#!/bin/sh\necho "8.30.1"');
          require('node:child_process').spawnSync('tar', [
            '-czf',
            dest,
            '-C',
            tarSourceDir,
            'gitleaks',
          ]);
          rmSync(tarSourceDir, { recursive: true, force: true });
        } else {
          writeFileSync(dest, '#!/bin/sh\necho "osv-scanner version: 2.5.1"');
        }
      };

      const stalePathRunner = async (cmd) => {
        if (cmd === 'osv-scanner') {
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.3.5\n', stderr: '' };
        }
        if (cmd.endsWith('/osv-scanner')) {
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        }
        return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
      };

      await expect(
        runInstallScannersCli({
          targetDir: tempDir,
          downloadFn: mockDownload,
          runner: stalePathRunner,
        }),
      ).rejects.toThrow(/expected exact version "2.5.1", but found "2.3.5"/);
    });
  });
});
