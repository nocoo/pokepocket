import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { discoverLocalCartridges, localCartridges } from '../../scripts/local-roms';
import { gbFixture, gbaFixture } from '../fixtures/headers';

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-local-'));
  roots.push(directory);
  return directory;
}
async function serve(directory: string) {
  const server = await createServer({
    root: directory,
    configFile: false,
    logLevel: 'silent',
    plugins: [localCartridges()],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
  });
  servers.push(server);
  await server.listen();
  const httpServer = server.httpServer;
  if (!httpServer) throw new Error('Expected an HTTP server instance');
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  return `http://127.0.0.1:${address.port}`;
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

  it('discovers newly added files, streams only recognized ROMs and supports HEAD', async () => {
    const directory = await root();
    const origin = await serve(directory);
    const first = (await (await fetch(`${origin}/api/catalog`)).json()) as {
      mode: string;
      editions: { available: boolean }[];
    };
    expect(first.mode).toBe('local');
    expect(first.editions.every((item: { available: boolean }) => !item.available)).toBe(true);
    await mkdir(path.join(directory, 'roms'));
    const bytes = gbaFixture();
    await writeFile(path.join(directory, 'roms', 'emerald.gba'), bytes);
    expect(await (await fetch(`${origin}/api/cartridge`)).json()).toEqual({
      available: true,
      url: '/roms/pokeemerald.gba',
    });
    const rom = await fetch(`${origin}/roms/pokeemerald.gba`);
    expect(rom.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(new Uint8Array(await rom.arrayBuffer())).toEqual(bytes);
    const head = await fetch(`${origin}/roms/pokeemerald.gba`, { method: 'HEAD' });
    expect(head.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    for (const url of ['/roms/emerald.gba', '/roms/unknown.gba', '/roms/%2e%2e%2foutside.gba'])
      expect((await fetch(origin + url)).status).toBe(404);
    const denied = await fetch(`${origin}/api/catalog`, { method: 'POST' });
    expect(denied.status).toBe(405);
    expect(denied.headers.get('Allow')).toBe('GET, HEAD');
    await writeFile(path.join(directory, 'roms', 'emerald.gba'), new Uint8Array(1024));
    expect((await fetch(`${origin}/roms/pokeemerald.gba`)).status).toBe(404);
  });
});
