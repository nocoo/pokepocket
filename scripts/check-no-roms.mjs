import { execFileSync } from 'node:child_process';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const forbidden = /(?:^|\/)(?:roms?)(?:\/|$)|\.(?:gb|gbc|gba|sav)$/i;
const violations = new Set();

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file);
    if (forbidden.test(relative) || entry.isSymbolicLink()) {
      violations.add(relative);
      continue;
    }
    if (entry.isDirectory()) {
      await scan(file);
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
}

for (const directory of process.argv.slice(2).length ? process.argv.slice(2) : ['public', 'dist']) {
  const fullPath = path.resolve(root, directory);
  const stat = await lstat(fullPath).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Missing or unsafe directory: ${directory}`);
  await scan(fullPath);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split(
  '\0',
);
for (const file of tracked) if (forbidden.test(file)) violations.add(`tracked: ${file}`);
if (violations.size) {
  console.error('ROMs, saves and asset symlinks must stay outside Git and deployment assets:');
  for (const file of violations) console.error(`  ${file}`);
  process.exitCode = 1;
} else {
  console.log('Distribution check passed: no cartridge ROMs or saves in assets or tracked paths.');
}
