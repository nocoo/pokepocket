import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  DEFAULT_EDITION,
  EDITIONS,
  identifyEdition,
  type AvailableEdition,
} from '../src/lib/catalog.ts';
import { readHardwareHeader } from '../src/lib/rom-header.ts';

interface LocalCartridge {
  id: string;
  file: string;
  url: string;
}

async function inspect(file: string, expectedId?: string) {
  // Do not follow a file symlink, including one swapped in after discovery.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 192 || stat.size > 32 * 1024 * 1024)
      throw new Error('Invalid cartridge size');
    const bytes = new Uint8Array(Math.min(336, stat.size));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error('Incomplete cartridge header');
    const header = readHardwareHeader(bytes);
    if (header.declaredSize !== null && header.declaredSize !== stat.size)
      throw new Error('Incomplete cartridge');
    const id = identifyEdition(header.system, header.title, header.gameCode);
    const edition = EDITIONS.find((item) => item.id === id && item.system === header.system);
    if (!edition || (expectedId && edition.id !== expectedId))
      throw new Error('Unrecognized cartridge');
    return { handle, size: stat.size, edition };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** Flat, private development directories. File names never determine the edition. */
export async function discoverLocalCartridges(root: string): Promise<LocalCartridge[]> {
  const cartridges = new Map<string, LocalCartridge>();
  for (const name of ['roms', 'rom']) {
    const directory = path.join(root, name);
    const stat = await lstat(directory).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !/\.(gb|gbc|gba)$/i.test(file.name)) continue;
      try {
        const fullPath = path.join(directory, file.name);
        const { handle, edition } = await inspect(fullPath);
        await handle.close();
        if (!cartridges.has(edition.id))
          cartridges.set(edition.id, {
            id: edition.id,
            file: fullPath,
            url: `/roms/${edition.fileName}`,
          });
      } catch {
        // An invalid file must not prevent other cartridges from loading.
      }
    }
  }
  return [...cartridges.values()];
}

function json(response: ServerResponse, request: IncomingMessage, value: unknown) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
}

export function localCartridges(): Plugin {
  return {
    name: 'pocket-local-cartridges',
    apply: 'serve',
    enforce: 'pre',
    async configureServer(server) {
      const root = server.config.root;
      const initial = await discoverLocalCartridges(root);
      server.config.logger.info(
        `[cartridges] Local development: ${initial.length} cartridges ready.`,
      );
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const catalog = pathname === '/api/catalog' || pathname === '/api/cartridge';
        const rom = /^\/roms?(?:\/|$)/i.test(pathname);
        if (!catalog && !rom) return next();
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          return json(response, request, { error: 'Method not allowed' });
        }
        void (async () => {
          const cartridges = await discoverLocalCartridges(root);
          if (catalog) {
            const editions: AvailableEdition[] = EDITIONS.map((edition) => {
              const local = cartridges.find((item) => item.id === edition.id);
              return { id: edition.id, available: Boolean(local), url: local?.url ?? null };
            });
            const fallback = editions.find((item) => item.id === DEFAULT_EDITION.id);
            if (!fallback) throw new Error('默认版本未找到');
            return json(
              response,
              request,
              pathname === '/api/catalog'
                ? { mode: 'local', editions, systems: ['GB', 'GBC', 'GBA'] }
                : { available: fallback.available, url: fallback.url },
            );
          }
          const cartridge = cartridges.find((item) => item.url === pathname);
          if (!cartridge) {
            response.statusCode = 404;
            return json(response, request, { error: 'Not found' });
          }
          const { handle, size } = await inspect(cartridge.file, cartridge.id);
          response.setHeader('Content-Type', 'application/octet-stream');
          response.setHeader('Content-Length', size);
          if (request.method === 'HEAD') {
            await handle.close();
            return response.end();
          }
          const stream = handle.createReadStream({ start: 0 });
          stream.on('error', () => response.destroy());
          response.on('close', () => stream.destroy());
          stream.pipe(response);
        })().catch(() => {
          if (response.headersSent) return response.destroy();
          response.removeHeader('Content-Length');
          response.statusCode = 503;
          json(response, request, { error: 'Local cartridge unavailable' });
        });
      });
    },
  };
}
