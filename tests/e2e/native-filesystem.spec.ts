import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import { CORE_VERSION } from '../../src/lib/emulator';
import { test, expect } from '../fixtures/browser-harness';

test('imports legacy native save bytes into memory without rewriting the old IndexedDB caches', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async (version) => {
    const fixtures = [
      {
        database: '/data',
        directory: '/data/saves',
        file: '/data/saves/legacy.sav',
        bytes: [0, 128, 255],
      },
      {
        database: '/autosave',
        directory: '/autosave/old',
        file: '/autosave/old/game.ss0',
        bytes: [9, 8, 7],
      },
    ];
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        // The reviewed SDK's IDBFS database schema is version 21.
        const request = indexedDB.open(name, 21);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('FILE_DATA').createIndex('timestamp', 'timestamp');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    for (const fixture of fixtures) {
      const db = await open(fixture.database);
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('FILE_DATA', 'readwrite');
          const store = tx.objectStore('FILE_DATA');
          const timestamp = new Date('2026-01-01T00:00:00Z');
          store.put({ timestamp, mode: 0o40755 }, fixture.directory);
          store.put(
            { timestamp, mode: 0o100644, contents: new Uint8Array(fixture.bytes) },
            fixture.file,
          );
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }

    const url = new URL(`/emulator/${version}/mgba.js`, window.location.origin).href;
    const { default: createCore } = (await import(/* @vite-ignore */ url)) as {
      default: (options: { canvas: HTMLCanvasElement }) => Promise<mGBAEmulator>;
    };
    const core = await createCore({ canvas: document.createElement('canvas') });
    await core.FSInit();
    const imported = fixtures.map(({ file }) => [...core.FS.readFile(file)]);
    for (const fixture of fixtures) core.FS.writeFile(fixture.file, new Uint8Array([42]));
    await core.FSSync();

    const oldDatabases = [];
    for (const fixture of fixtures) {
      const db = await open(fixture.database);
      try {
        oldDatabases.push(
          await new Promise<number[]>((resolve, reject) => {
            const tx = db.transaction('FILE_DATA', 'readonly');
            const request = tx.objectStore('FILE_DATA').get(fixture.file);
            tx.oncomplete = () => resolve([...request.result.contents]);
            tx.onabort = () => reject(tx.error);
          }),
        );
      } finally {
        db.close();
      }
    }
    return {
      imported,
      oldDatabases,
      working: fixtures.map(({ file }) => [...core.FS.readFile(file)]),
    };
  }, CORE_VERSION);

  expect(result.imported).toEqual([
    [0, 128, 255],
    [9, 8, 7],
  ]);
  expect(result.working).toEqual([[42], [42]]);
  expect(result.oldDatabases).toEqual(result.imported);
});
