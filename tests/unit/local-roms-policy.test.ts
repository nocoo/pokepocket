import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import {
  discoverLocalCartridges,
  inspectCartridgeFile,
  localCartridges,
} from '../../scripts/local-roms';
import { gbFixture, gbaFixture } from '../fixtures/headers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pocket-discovery-'));
  roots.push(directory);
  return directory;
}

describe('development ROM discovery and inspect policy', () => {
  it('inspectCartridgeFile throws on too small or non-ROM files', async () => {
    const root = await createTempRoot();
    const smallFile = path.join(root, 'small.bin');
    await writeFile(smallFile, new Uint8Array(100));

    await expect(inspectCartridgeFile(smallFile)).rejects.toThrow('Invalid cartridge size');
  });

  it('inspectCartridgeFile throws on unrecognized header contents', async () => {
    const root = await createTempRoot();
    const invalidHeader = path.join(root, 'invalid.gba');
    await writeFile(invalidHeader, new Uint8Array(512));

    await expect(inspectCartridgeFile(invalidHeader)).rejects.toThrow();
  });

  it('discovers valid cartridges in roms and rom directories', async () => {
    const root = await createTempRoot();
    await mkdir(path.join(root, 'roms'));
    await mkdir(path.join(root, 'rom'));

    await writeFile(path.join(root, 'roms', 'emerald.gba'), gbaFixture());
    await writeFile(path.join(root, 'rom', 'red.gb'), gbFixture());

    const discovered = await discoverLocalCartridges(root);
    expect(discovered.map((c) => c.id).sort()).toEqual(['emerald', 'red']);
    expect(discovered.find((c) => c.id === 'emerald')?.url).toBe('/roms/pokeemerald.gba');
  });

  it('middleware policy handles method restrictions, headers, and 404/405/catalog responses', async () => {
    const root = await createTempRoot();
    await mkdir(path.join(root, 'roms'));
    await writeFile(path.join(root, 'roms', 'emerald.gba'), gbaFixture());

    const plugin = localCartridges();
    type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
    let middleware: MiddlewareFn | undefined;

    const fakeServer = {
      config: {
        root,
        logger: { info: () => {} },
      },
      middlewares: {
        use: (fn: MiddlewareFn) => {
          middleware = fn;
        },
      },
    } as unknown as ViteDevServer;

    if (typeof plugin.configureServer === 'function') {
      const configure = plugin.configureServer as unknown as (
        server: ViteDevServer,
      ) => Promise<void>;
      await configure(fakeServer);
    }
    expect(middleware).toBeTypeOf('function');
    const dispatch = middleware as unknown as MiddlewareFn;

    const createReqRes = (url: string, method = 'GET') => {
      let resolveEnd: (value: { body?: string | Buffer | undefined }) => void = () => {};
      const endPromise = new Promise<{ body?: string | Buffer | undefined }>((r) => {
        resolveEnd = r;
      });

      const headers: Record<string, string> = {};
      const res = {
        statusCode: 200,
        setHeader: (k: string, v: string) => {
          headers[k.toLowerCase()] = v;
        },
        end: vi.fn().mockImplementation((chunk?: string | Buffer) => {
          resolveEnd({ body: chunk });
        }),
      } as unknown as ServerResponse;
      const req = { url, method } as unknown as IncomingMessage;
      return { req, res, headers, endPromise };
    };

    // 1. Pass-through for unrelated route
    let nextCalled = false;
    const { req: reqApp, res: resApp } = createReqRes('/app.js');
    dispatch(reqApp, resApp, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    // 2. Disallowed method on /api/catalog -> 405
    const {
      req: reqPost,
      res: resPost,
      headers: hPost,
      endPromise: pPost,
    } = createReqRes('/api/catalog', 'POST');
    dispatch(reqPost, resPost, () => {});
    const postRes = await pPost;
    expect(resPost.statusCode).toBe(405);
    expect(hPost.allow).toBe('GET, HEAD');
    expect(JSON.parse(postRes.body as string)).toEqual({ error: 'Method not allowed' });

    // 3. GET /api/catalog -> returns local catalog with emerald available
    const {
      req: reqCat,
      res: resCat,
      headers: hCat,
      endPromise: pCat,
    } = createReqRes('/api/catalog', 'GET');
    dispatch(reqCat, resCat, () => {});
    const catRes = await pCat;
    expect(hCat['cache-control']).toBe('no-store');
    expect(hCat['content-type']).toContain('application/json');
    const catData = JSON.parse(catRes.body as string) as {
      mode: string;
      editions: { id: string; available: boolean }[];
    };
    expect(catData.mode).toBe('local');
    expect(catData.editions.find((e) => e.id === 'emerald')?.available).toBe(true);

    // 4. HEAD /api/catalog -> returns 200 without body
    const { req: reqHead, res: resHead, endPromise: pHead } = createReqRes('/api/catalog', 'HEAD');
    dispatch(reqHead, resHead, () => {});
    const headRes = await pHead;
    expect(resHead.statusCode).toBe(200);
    expect(headRes.body).toBeUndefined();

    // 5. GET unknown ROM -> 404
    const {
      req: reqNotFound,
      res: resNotFound,
      endPromise: pNotFound,
    } = createReqRes('/roms/unknown.gba', 'GET');
    dispatch(reqNotFound, resNotFound, () => {});
    const notFoundRes = await pNotFound;
    expect(resNotFound.statusCode).toBe(404);
    expect(JSON.parse(notFoundRes.body as string)).toEqual({ error: 'Not found' });
  });
});
