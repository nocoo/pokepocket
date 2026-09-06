import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkNoRoms,
  scanDirectoryForRoms,
  checkTrackedFiles,
} from '../../scripts/check-no-roms.mjs';
import { gbFixture, gbaFixture } from '../fixtures/headers';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function createTempRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pocket-check-roms-'));
  roots.push(dir);
  return dir;
}

describe('check-no-roms distribution policy', () => {
  it('detects forbidden file extensions (.gba, .gb, .gbc, .sav) and rom directory names', async () => {
    const root = await createTempRoot();
    const publicDir = path.join(root, 'public');
    await mkdir(path.join(publicDir, 'roms'), { recursive: true });
    await writeFile(path.join(publicDir, 'game.gba'), new Uint8Array(100));
    await writeFile(path.join(publicDir, 'save.sav'), new Uint8Array(100));

    const violations = new Set();
    await scanDirectoryForRoms(publicDir, root, violations);
    const list = [...violations];

    expect(list.some((v) => v.includes('roms'))).toBe(true);
    expect(list.some((v) => v.includes('game.gba'))).toBe(true);
    expect(list.some((v) => v.includes('save.sav'))).toBe(true);
  });

  it('detects raw GB and GBA bytes even when renamed to non-rom extensions', async () => {
    const root = await createTempRoot();
    const distDir = path.join(root, 'dist');
    await mkdir(distDir, { recursive: true });

    // GB file renamed to .png
    await writeFile(path.join(distDir, 'avatar.png'), gbFixture());
    // GBA file renamed to .bin
    await writeFile(path.join(distDir, 'data.bin'), gbaFixture());

    const violations = new Set();
    await scanDirectoryForRoms(distDir, root, violations);
    const list = [...violations];

    expect(list.some((v) => v.includes('avatar.png'))).toBe(true);
    expect(list.some((v) => v.includes('data.bin'))).toBe(true);
  });

  it('detects symlinks as violations', async () => {
    const root = await createTempRoot();
    const publicDir = path.join(root, 'public');
    await mkdir(publicDir, { recursive: true });

    const safeFile = path.join(root, 'safe.txt');
    await writeFile(safeFile, 'safe text');
    await symlink(safeFile, path.join(publicDir, 'link.txt'));

    const violations = new Set();
    await scanDirectoryForRoms(publicDir, root, violations);
    expect([...violations].some((v) => v.includes('link.txt'))).toBe(true);
  });

  it('checkNoRoms passes cleanly on empty/clean directories', async () => {
    const root = await createTempRoot();
    const publicDir = path.join(root, 'public');
    const distDir = path.join(root, 'dist');
    await mkdir(publicDir);
    await mkdir(distDir);
    await writeFile(path.join(publicDir, 'app.js'), 'console.log("clean");');

    const result = await checkNoRoms({
      root,
      directories: ['public', 'dist'],
      checkTracked: false,
      silent: true,
    });
    expect(result.success).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('checkNoRoms throws on missing or unsafe directory', async () => {
    const root = await createTempRoot();
    await expect(
      checkNoRoms({
        root,
        directories: ['non-existent'],
        checkTracked: false,
        silent: true,
      }),
    ).rejects.toThrow('Missing or unsafe directory');
  });

  it('checkTrackedFiles flags forbidden tracked files in an isolated temporary repository', async () => {
    const root = await createTempRoot();

    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });

    // Stage clean and forbidden files
    await writeFile(path.join(root, 'clean.txt'), 'clean file');
    await writeFile(path.join(root, 'leak.gba'), 'forbidden gba');
    await writeFile(path.join(root, 'save.sav'), 'forbidden save');

    execFileSync('git', ['add', 'clean.txt', 'leak.gba', 'save.sav'], { cwd: root });

    const violations = new Set();
    checkTrackedFiles(root, violations);

    const list = [...violations];
    expect(list.some((v) => v.includes('leak.gba'))).toBe(true);
    expect(list.some((v) => v.includes('save.sav'))).toBe(true);
    expect(list.some((v) => v.includes('clean.txt'))).toBe(false);
  });

  it('executes default checkNoRoms options scanning both public and dist alongside tracked repository files', async () => {
    const root = await createTempRoot();

    // Initialize git repository in root
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });

    // Set up default 'public' and 'dist' directories
    const publicDir = path.join(root, 'public');
    const distDir = path.join(root, 'dist');
    await mkdir(publicDir, { recursive: true });
    await mkdir(distDir, { recursive: true });

    await writeFile(path.join(publicDir, 'index.html'), '<!DOCTYPE html>');
    await writeFile(path.join(distDir, 'bundle.js'), 'console.log("ok");');

    // Track legitimate clean files in git
    execFileSync('git', ['add', 'public/index.html', 'dist/bundle.js'], { cwd: root });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // 1. Success path: scans public, dist, and tracked files with success log output
      const cleanResult = await checkNoRoms({
        root,
        silent: false, // tests console.log output
      });

      expect(cleanResult.success).toBe(true);
      expect(cleanResult.violations).toHaveLength(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Distribution check passed'));
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockClear();
      errorSpy.mockClear();

      // 2. Failure path: add violation in dist and tracked file, verify console.error output
      await writeFile(path.join(distDir, 'leaked.sav'), new Uint8Array([1, 2, 3]));
      execFileSync('git', ['add', 'dist/leaked.sav'], { cwd: root });

      const failResult = await checkNoRoms({
        root,
        silent: false, // tests console.error output
      });

      expect(failResult.success).toBe(false);
      expect(failResult.violations.length).toBeGreaterThan(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ROMs, saves and asset symlinks must stay outside Git'),
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('dist/leaked.sav'));
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('verifies deep directory recursion, case-insensitive extensions, benign near-misses, symlink root rejection, and non-traversal of symlinks', async () => {
    const root = await createTempRoot();
    const publicDir = path.join(root, 'public');
    const deepDir = path.join(publicDir, 'assets', 'nested', 'deep');
    await mkdir(deepDir, { recursive: true });

    // 1. Deep directory recursion and case-insensitive extensions (.GBA, .GbC, .SAV)
    await writeFile(path.join(deepDir, 'UPPERCASE.GBA'), new Uint8Array(50));
    await writeFile(path.join(deepDir, 'MixedCase.GbC'), new Uint8Array(50));
    await writeFile(path.join(deepDir, 'savefile.SAV'), new Uint8Array(50));

    // 2. Benign binary/header near-misses:
    // (a) File smaller than 192 bytes
    await writeFile(path.join(deepDir, 'small.bin'), new Uint8Array(50));

    // (b) 256-byte file with 0xb2 === 0x96 but INVALID GBA complement checksum
    const invalidGbaChecksum = new Uint8Array(256);
    invalidGbaChecksum[0xb2] = 0x96;
    invalidGbaChecksum[0xbd] = 0x00; // wrong checksum
    await writeFile(path.join(deepDir, 'near-gba.bin'), invalidGbaChecksum);

    // (c) 350-byte file with partial GB logo bytes mismatch
    const partialGbLogo = new Uint8Array(350);
    partialGbLogo[0x104] = 0xce;
    partialGbLogo[0x105] = 0x00; // corrupted logo byte
    await writeFile(path.join(deepDir, 'near-gb.bin'), partialGbLogo);

    // 3. Symlink file and directory handling:
    // File symlink target outside public
    const externalDir = path.join(root, 'external-outside');
    await mkdir(externalDir, { recursive: true });
    const targetFile = path.join(externalDir, 'target.txt');
    await writeFile(targetFile, 'external content');

    // Create a symlink file inside publicDir
    await symlink(targetFile, path.join(publicDir, 'symlink-file.txt'));

    // Create a directory symlink inside publicDir pointing to external directory containing a rom
    await writeFile(path.join(externalDir, 'hidden-rom.gba'), new Uint8Array(10));
    await symlink(externalDir, path.join(publicDir, 'symlink-dir'));

    const violations = new Set();
    await scanDirectoryForRoms(publicDir, root, violations);
    const list = [...violations];

    // Case-insensitive files in deep hierarchy are flagged
    expect(list.some((v) => v.includes('UPPERCASE.GBA'))).toBe(true);
    expect(list.some((v) => v.includes('MixedCase.GbC'))).toBe(true);
    expect(list.some((v) => v.includes('savefile.SAV'))).toBe(true);

    // Symlinks are flagged as violations directly and not traversed into
    expect(list.some((v) => v.includes('symlink-file.txt'))).toBe(true);
    expect(list.some((v) => v.includes('symlink-dir'))).toBe(true);
    // Did NOT traverse into externalDir target through symlink-dir
    expect(list.some((v) => v.includes('hidden-rom.gba'))).toBe(false);

    // Benign binary near-misses are NOT flagged as violations
    expect(list.some((v) => v.includes('small.bin'))).toBe(false);
    expect(list.some((v) => v.includes('near-gba.bin'))).toBe(false);
    expect(list.some((v) => v.includes('near-gb.bin'))).toBe(false);

    // 4. Rejection of a symlink root directory
    const symlinkedPublic = path.join(root, 'symlinked-public-root');
    await symlink(publicDir, symlinkedPublic);

    await expect(
      checkNoRoms({
        root,
        directories: ['symlinked-public-root'],
        checkTracked: false,
        silent: true,
      }),
    ).rejects.toThrow('Missing or unsafe directory: symlinked-public-root');
  });
});
