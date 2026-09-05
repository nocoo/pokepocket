import { execFileSync } from 'node:child_process';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FORBIDDEN_PATTERN = /(?:^|\/)(?:roms?)(?:\/|$)|\.(?:gb|gbc|gba|sav)$/i;

export async function scanDirectoryForRoms(directory, root, violations = new Set()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file);
    if (FORBIDDEN_PATTERN.test(relative) || entry.isSymbolicLink()) {
      violations.add(relative);
      continue;
    }
    if (entry.isDirectory()) {
      await scanDirectoryForRoms(file, root, violations);
      continue;
    }
    if (!entry.isFile()) continue;
    const handle = await open(file, 'r');
    try {
      const bytes = new Uint8Array(336);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      // Catch raw ROMs renamed with a non-ROM extension as well.
      const gb =
        bytesRead >= 336 &&
        [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b].every(
          (byte, i) => bytes[0x104 + i] === byte,
        );
      let checksum = -0x19;
      for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i];
      const gba = bytesRead >= 192 && bytes[0xb2] === 0x96 && (checksum & 0xff) === bytes[0xbd];
      if (gb || gba) violations.add(relative);
    } finally {
      await handle.close();
    }
  }
  return violations;
}

export function checkTrackedFiles(root, violations = new Set()) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split(
    '\0',
  );
  for (const file of tracked) {
    if (file && FORBIDDEN_PATTERN.test(file)) {
      violations.add(`tracked: ${file}`);
    }
  }
  return violations;
}

export async function checkNoRoms(options = {}) {
  const root = options.root ?? fileURLToPath(new URL('../', import.meta.url));
  const directories = options.directories ?? ['public', 'dist'];
  const violations = new Set();

  for (const directory of directories) {
    const fullPath = path.resolve(root, directory);
    const stat = await lstat(fullPath).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Missing or unsafe directory: ${directory}`);
    }
    await scanDirectoryForRoms(fullPath, root, violations);
  }

  if (options.checkTracked !== false) {
    checkTrackedFiles(root, violations);
  }

  const success = violations.size === 0;
  if (!success) {
    if (!options.silent) {
      console.error('ROMs, saves and asset symlinks must stay outside Git and deployment assets:');
      for (const file of violations) console.error(`  ${file}`);
    }
  } else {
    if (!options.silent) {
      console.log(
        'Distribution check passed: no cartridge ROMs or saves in assets or tracked paths.',
      );
    }
  }

  return { success, violations: [...violations] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2);
  const result = await checkNoRoms({
    directories: dirs.length ? dirs : undefined,
  });
  if (!result.success) {
    process.exitCode = 1;
  }
}
