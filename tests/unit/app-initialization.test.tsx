// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from 'fake-indexeddb';
import App from '../../src/App';
import { storage } from '../../src/lib/storage';
import type { EmulatorDependencies } from '../../src/lib/emulator';
import {
  createCartridge,
  createTestAppHarness,
  type TestAppHarness,
} from '../helpers/app-test-helper';

let harness: TestAppHarness;

vi.mock('../../src/lib/emulator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/emulator')>();
  return {
    ...actual,
    PocketEmulator: class MockPocketEmulator extends actual.PocketEmulator {
      constructor(deps?: Partial<EmulatorDependencies>) {
        super({
          checkCrossOriginIsolated: () => true,
          createCore: async () => harness.testCore,
          storage: harness.fakeStorage,
          clock: harness.currentClock,
          ...deps,
        });
      }
    },
  };
});

describe('App initialization readiness and preference restoration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBCursor', IDBCursor);
    vi.stubGlobal('IDBCursorWithValue', IDBCursorWithValue);
    vi.stubGlobal('IDBDatabase', IDBDatabase);
    vi.stubGlobal('IDBFactory', IDBFactory);
    vi.stubGlobal('IDBIndex', IDBIndex);
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubGlobal('IDBObjectStore', IDBObjectStore);
    vi.stubGlobal('IDBOpenDBRequest', IDBOpenDBRequest);
    vi.stubGlobal('IDBRequest', IDBRequest);
    vi.stubGlobal('IDBTransaction', IDBTransaction);
    vi.stubGlobal('IDBVersionChangeEvent', IDBVersionChangeEvent);

    localStorage.clear();
    harness = createTestAppHarness();

    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
      };
    }
  });

  afterEach(() => {
    cleanup();
    harness.cleanup();
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('launches cached cartridge while catalog fetch remains pending and updates available editions upon release', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    let releaseCatalog: () => void = () => {};
    const catalogDeferred = new Promise<Response>((resolve) => {
      releaseCatalog = () =>
        resolve({
          ok: true,
          json: async () => ({
            editions: [{ id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }],
          }),
        } as Response);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => catalogDeferred),
    );

    const { container } = render(<App />);

    try {
      // Storage is ready first while catalog fetch is still deferred
      await screen.findByText('本地存储已就绪');
      expect(await screen.findByText('1 枚卡带就绪')).toBeDefined();

      // Launch cached cartridge immediately from gallery while catalog is pending
      const startBtn = screen.getByRole('button', { name: '开始冒险' });
      const startPromise = userEvent.click(startBtn);

      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await startPromise;

      await screen.findByText('正在冒险');
      expect(harness.testCore.loadGame).toHaveBeenCalledWith(
        '/roms/stored-emerald.gba',
        '/saves/stored-emerald.sav',
      );
      expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');
    } finally {
      releaseCatalog();
    }

    // After release, catalog readiness resolves cleanly and series library reflects catalog
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '返回卡带盘' })).toBeDefined();
    });
  });

  it('catalog settles while storage listing is deferred without premature storage ready, then restores valid saved selection upon storage release', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    let releaseStorage: () => void = () => {};
    const originalList = storage.listCartridges.bind(storage);
    const storageDeferred = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });

    vi.spyOn(storage, 'listCartridges').mockImplementation(async () => {
      await storageDeferred;
      return originalList();
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editions: [{ id: 'ruby', available: true, url: '/roms/pokeruby.gba' }],
        }),
      }),
    );

    render(<App />);

    try {
      // Storage is still connecting while catalog settles first
      expect(screen.getByText('正在连接存储')).toBeDefined();
      expect(screen.queryByText('本地存储已就绪')).toBeNull();

      // Catalog settled with 1 available edition (ruby), so 1 edition is ready
      expect(await screen.findByText('1 枚卡带就绪')).toBeDefined();

      // emerald is not yet in library, so emerald card does not yet show cached badge
      expect(screen.queryByText(/保存在本地/)).toBeNull();
    } finally {
      releaseStorage();
    }

    // Now storage listing finishes and confirms readiness and saved selection
    await screen.findByText('本地存储已就绪');
    // Now both ruby (from catalog) and emerald (from storage) are ready -> 2 editions ready
    expect(await screen.findByText('2 枚卡带就绪')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '绿宝石' })).toBeDefined();
    expect(localStorage.getItem('pocket-last-cartridge')).toBe('stored-emerald');
    expect(localStorage.getItem('pocket-last-edition')).toBe('emerald');
  });

  it('preserves user selection when delayed initial storage listing completes late', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const rubyCart = createCartridge('stored-ruby', {
      header: { ...emeraldCart.header, editionId: 'ruby', title: 'POKEMON RUBY' },
    });
    await storage.putCartridge(emeraldCart);
    await storage.putCartridge(rubyCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    let releaseStorage: () => void = () => {};
    const originalList = storage.listCartridges.bind(storage);
    const storageDeferred = new Promise<void>((resolve) => {
      releaseStorage = resolve;
    });

    vi.spyOn(storage, 'listCartridges').mockImplementation(async () => {
      await storageDeferred;
      return originalList();
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    render(<App />);

    try {
      // While initial storage listing is in flight, user switches edition to FireRed
      const fireredCard = screen.getByRole('button', { name: /火红/ });
      await userEvent.click(fireredCard);

      expect(screen.getByRole('heading', { level: 2, name: '火红' })).toBeDefined();
      expect(localStorage.getItem('pocket-last-edition')).toBe('firered');
    } finally {
      releaseStorage();
    }

    // After delayed initial storage resolves, user-chosen edition is NOT overwritten
    await screen.findByText('本地存储已就绪');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('heading', { level: 2, name: '火红' })).toBeDefined();
    expect(localStorage.getItem('pocket-last-edition')).toBe('firered');
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['500 server error', () => Promise.resolve(new Response('Server Error', { status: 500 }))],
    ['404 not found', () => Promise.resolve(new Response('Not Found', { status: 404 }))],
  ])(
    'falls back to cached cartridge when catalog request encounters %s',
    async (_desc, fetchErrorFactory) => {
      const emeraldCart = createCartridge('stored-emerald');
      await storage.putCartridge(emeraldCart);
      localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
      localStorage.setItem('pocket-last-edition', 'emerald');

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => fetchErrorFactory()),
      );

      const { container } = render(<App />);

      // Storage becomes ready while catalog failed
      await screen.findByText('本地存储已就绪');

      // Cached cartridge is rendered and available in gallery
      expect(await screen.findByText('1 枚卡带就绪')).toBeDefined();
      expect(screen.getByRole('heading', { level: 2, name: '绿宝石' })).toBeDefined();

      // Start adventure runs using cached ROM and save paths
      const startBtn = screen.getByRole('button', { name: '开始冒险' });
      const startPromise = userEvent.click(startBtn);

      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await startPromise;

      await screen.findByText('正在冒险');
      expect(harness.testCore.loadGame).toHaveBeenCalledWith(
        '/roms/stored-emerald.gba',
        '/saves/stored-emerald.sav',
      );
      expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');

      // Stored file data is intact in the virtual file system
      const writtenRom = (
        harness.testCore.FS.writeFile as unknown as { mock: { calls: [string, Uint8Array][] } }
      ).mock.calls.find((call) => call[0] === '/roms/stored-emerald.gba');
      expect(writtenRom).toBeDefined();
      if (!writtenRom) throw new Error('Missing written ROM');
      expect(new Uint8Array(writtenRom[1])).toEqual(new Uint8Array(emeraldCart.data));
    },
  );
});
