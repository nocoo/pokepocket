import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
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
});
