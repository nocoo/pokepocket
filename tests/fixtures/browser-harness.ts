import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
// @ts-expect-error production-runtime is a maintained mjs script without ambient declarations
import { createProductionRuntime } from '../../scripts/production-runtime.mjs';
import type { Snapshot } from '../../src/lib/storage';

export interface ProductionWorkerHarness {
  runtime: {
    url: string;
    dispose: () => Promise<void>;
    signToken: (claims?: Record<string, unknown>) => Promise<string>;
  };
}

export type StoredSnapshotRecord = Omit<Snapshot, 'data'> & {
  data: number[];
};

export const test = base.extend<
  {
    authorizedContext: BrowserContext;
  },
  {
    productionWorker: ProductionWorkerHarness;
  }
>({
  // Worker-scoped fixture: spins up Miniflare on port 27047 for this test worker, disposes when worker finishes
  productionWorker: [
    // biome-ignore lint/correctness/noEmptyPattern: playwright fixtures require object destructuring
    async ({}, use) => {
      const runtime = await createProductionRuntime({
        root: process.cwd(),
        port: 27047,
      });
      try {
        await use({ runtime });
      } finally {
        await runtime.dispose();
      }
    },
    { scope: 'worker' },
  ],

  // Override extraHTTPHeaders fixture so request & native context get real CF-Access authorization
  extraHTTPHeaders: async ({ productionWorker }, use) => {
    const token = await productionWorker.runtime.signToken();
    await use({
      'Cf-Access-Jwt-Assertion': token,
    });
  },

  baseURL: async ({ productionWorker }, use) => {
    await use(productionWorker.runtime.url);
  },

  authorizedContext: async ({ context }, use) => {
    await use(context);
  },
});

export { expect, type Page, type BrowserContext };

/**
 * Samples the live WebGL/2D canvas within requestAnimationFrame.
 * Essential: reading directly outside requestAnimationFrame can observe SDL's discarded/blank WebGL buffer.
 */
export async function sampleCanvasPixels(page: Page, width = 8, height = 1): Promise<number[]> {
  return page.evaluate(
    ({ w, h }) =>
      new Promise<number[]>((resolve, reject) => {
        requestAnimationFrame(() => {
          try {
            const canvas = document.querySelector(
              '.console-wrap canvas',
            ) as HTMLCanvasElement | null;
            if (!canvas) throw new Error('Missing game canvas in .console-wrap');
            const copy = document.createElement('canvas');
            copy.width = canvas.width;
            copy.height = canvas.height;
            const ctx = copy.getContext('2d');
            if (!ctx) throw new Error('Missing 2d canvas context');
            ctx.drawImage(canvas, 0, 0);
            const data = ctx.getImageData(0, 0, w, h).data;
            resolve([...data]);
          } catch (err) {
            reject(err);
          }
        });
      }),
    { w: width, h: height },
  );
}

/**
 * Reads all stored battery saves from indexedDB.
 */
export async function readIndexedDBBatteries(
  page: Page,
): Promise<Array<{ romId: string; data: number[]; updatedAt: number }>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('poke-pocket');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const values = await new Promise<
        Array<{ romId: string; data: ArrayBuffer; updatedAt: number }>
      >((resolve, reject) => {
        const tx = db.transaction('batteries', 'readonly');
        const req = tx.objectStore('batteries').getAll();
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error);
      });
      return values.map((v) => ({
        romId: v.romId,
        data: [...new Uint8Array(v.data)],
        updatedAt: v.updatedAt,
      }));
    } finally {
      db.close();
    }
  });
}

/**
 * Reads all stored snapshots from indexedDB with complete record fields.
 */
export async function readIndexedDBSnapshots(page: Page): Promise<StoredSnapshotRecord[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('poke-pocket');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const values = await new Promise<
        Array<{
          key: string;
          romId: string;
          slot: number;
          data: ArrayBuffer;
          thumbnail: string;
          updatedAt: number;
          coreVersion: string;
        }>
      >((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const req = tx.objectStore('snapshots').getAll();
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(tx.error);
      });
      return values.map((v) => ({
        key: v.key,
        romId: v.romId,
        slot: v.slot,
        data: [...new Uint8Array(v.data)],
        thumbnail: v.thumbnail,
        updatedAt: v.updatedAt,
        coreVersion: v.coreVersion,
      }));
    } finally {
      db.close();
    }
  });
}
