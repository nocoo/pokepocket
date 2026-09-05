import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gbaFixture } from '../fixtures/headers';

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('blocks ROM bytes renamed as an ordinary asset before distribution', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-distribution-'));
  directories.push(directory);
  await writeFile(path.join(directory, 'index.html'), '<html>Poké Pocket</html>');
  const command = [path.resolve('scripts/check-no-roms.mjs'), directory];
  await expect(execute(process.execPath, command)).resolves.toMatchObject({ stderr: '' });
  await writeFile(path.join(directory, 'renamed-asset.bin'), gbaFixture());
  await expect(execute(process.execPath, command)).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('renamed-asset.bin'),
  });
});
