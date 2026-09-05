import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverLocalCartridges } from '../../scripts/local-roms';
import { gbFixture, gbaFixture } from '../fixtures/headers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-local-'));
  roots.push(directory);
  return directory;
}

describe('development ROM directory discovery', () => {
  it('identifies versions from bytes in roms/ and rom/, regardless of filenames', async () => {
    const directory = await root();
    await mkdir(path.join(directory, 'roms'));
    await mkdir(path.join(directory, 'rom'));
    await writeFile(path.join(directory, 'roms', 'My Emerald copy.GBA'), gbaFixture());
    await writeFile(path.join(directory, 'rom', '任意文件名.gb'), gbFixture());
    await writeFile(path.join(directory, 'rom', 'pokeruby.gba'), gbaFixture());
    const discovered = await discoverLocalCartridges(directory);
    expect(discovered.map((entry) => entry.id).sort()).toEqual(['emerald', 'red']);
    expect(discovered.find((entry) => entry.id === 'emerald')?.url).toBe('/roms/pokeemerald.gba');
    expect(discovered.find((entry) => entry.id === 'emerald')?.file).toContain(
      'My Emerald copy.GBA',
    );
  });

  it('ignores missing directories, malformed or truncated files and symlinks', async () => {
    const directory = await root();
    expect(await discoverLocalCartridges(directory)).toEqual([]);
    await mkdir(path.join(directory, 'roms'));
    await writeFile(path.join(directory, 'roms', 'html.gba'), '<html>not a cartridge</html>');
    await writeFile(path.join(directory, 'roms', 'truncated.gb'), gbFixture().subarray(0, 336));
    await writeFile(path.join(directory, 'outside.gba'), gbaFixture());
    await symlink(path.join(directory, 'outside.gba'), path.join(directory, 'roms', 'linked.gba'));
    const external = await root();
    await writeFile(path.join(external, 'emerald.gba'), gbaFixture());
    await symlink(external, path.join(directory, 'rom'));
    expect(await discoverLocalCartridges(directory)).toEqual([]);
  });
});
