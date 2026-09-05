import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { localCartridges } from '../../scripts/local-roms';
import { gbaFixture } from '../fixtures/headers';

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-local-http-'));
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

describe('development ROM TCP server plugin', () => {
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
