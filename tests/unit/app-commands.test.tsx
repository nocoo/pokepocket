// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
import { gbaFixture } from '../fixtures/headers';
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

describe('App cartridge command recovery and competing-command guards', () => {
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

  it.each([
    [
      'non-ok HTTP 500 status',
      () => ({
        ok: false,
        status: 500,
        headers: new Headers(),
      }),
    ],
    [
      'HTML response (e.g. captive portal or proxy error)',
      () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
      }),
    ],
    ['transport failure', () => Promise.reject(new TypeError('Network request failed'))],
  ])(
    'recovers from catalog-ROM fetch failure via %s: surfaces error toast, clears busy, remains retryable, and retry loads exact ROM and save paths',
    async (_desc, fetchFailureFactory) => {
      const validEmeraldData = gbaFixture();
      let romFetchCount = 0;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/api/catalog')) {
            return {
              ok: true,
              json: async () => ({
                editions: [{ id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }],
              }),
            };
          }
          if (url.includes('/roms/pokeemerald.gba')) {
            romFetchCount++;
            if (romFetchCount === 1) {
              return fetchFailureFactory();
            }
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
              blob: async () => new Blob([validEmeraldData]),
            };
          }
          return { ok: false, status: 404 };
        }),
      );

      const { container } = render(<App />);
      await screen.findByText('本地存储已就绪');
      expect(await screen.findByText('1 枚卡带就绪')).toBeDefined();

      const startBtn = screen.getByRole('button', { name: '开始冒险' });
      await userEvent.click(startBtn);

      // Error alert displayed
      expect(await screen.findByRole('alert')).toBeDefined();
      expect(
        screen.getByText(/无法读取本地卡带，请检查文件后刷新页面。|Network request failed/),
      ).toBeDefined();

      // Zero cartridges committed to IndexedDB storage
      const storedListAfterFailure = await storage.listCartridges();
      expect(storedListAfterFailure.length).toBe(0);

      // Zero loadGame calls executed
      expect(harness.testCore.loadGame).not.toHaveBeenCalled();

      // Return to library view via header button to retry catalog start through real UI
      const backNavBtn = screen.getByRole('button', { name: '卡带收藏' });
      await userEvent.click(backNavBtn);
      const galleryStartBtn = await screen.findByRole('button', { name: '开始冒险' });
      expect(galleryStartBtn.hasAttribute('disabled')).toBe(false);

      // Successful retry: click start adventure again
      const retryPromise = userEvent.click(galleryStartBtn);
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await retryPromise;

      // Stored cartridge committed with exact binary bytes
      const storedListAfterRetry = await storage.listCartridges();
      expect(storedListAfterRetry.length).toBe(1);
      const savedCart = storedListAfterRetry[0];
      expect(savedCart).toBeDefined();
      if (!savedCart) throw new Error('Missing saved cartridge');
      expect(new Uint8Array(savedCart.data)).toEqual(validEmeraldData);

      // Expected SHA-256 hash ID
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', validEmeraldData));
      const expectedId = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(savedCart.id).toBe(expectedId);

      // Core loaded with exact /roms/<id>.gba and /saves/<id>.sav paths
      expect(harness.testCore.loadGame).toHaveBeenCalledWith(
        `/roms/${expectedId}.gba`,
        `/saves/${expectedId}.sav`,
      );

      // Core FS written with exact bytes
      const writtenRom = (
        harness.testCore.FS.writeFile as unknown as { mock: { calls: [string, Uint8Array][] } }
      ).mock.calls.find((call) => call[0] === `/roms/${expectedId}.gba`);
      expect(writtenRom).toBeDefined();
      if (!writtenRom) throw new Error('Missing written ROM in core FS');
      expect(new Uint8Array(writtenRom[1])).toEqual(validEmeraldData);

      // Final status is running
      await screen.findByText('正在冒险');
      expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');
    },
  );

  it('guards against competing start, edition switch, file drop, and return during deferred cartridge load', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const rubyCart = createCartridge('stored-ruby', {
      header: { ...emeraldCart.header, editionId: 'ruby', title: 'POKEMON RUBY' },
      fileName: 'pokemon-ruby.gba',
    });
    await storage.putCartridge(emeraldCart);
    await storage.putCartridge(rubyCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    // Defer emulator.load via fakeStorage.listSnapshots
    const originalListSnapshots = vi
      .mocked(harness.fakeStorage.listSnapshots)
      .getMockImplementation();
    if (!originalListSnapshots) throw new Error('Missing original listSnapshots implementation');

    let releaseLoad: () => void = () => {};
    let loadDeferredPromise: Promise<void> | null = null;
    const loadDeferred = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });

    vi.mocked(harness.fakeStorage.listSnapshots).mockImplementation(async (romId: string) => {
      loadDeferredPromise = (async () => {
        await loadDeferred;
      })();
      await loadDeferredPromise;
      return originalListSnapshots(romId);
    });

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    const canvasBefore = container.querySelector('canvas');
    expect(canvasBefore).not.toBeNull();

    const startBtn = screen.getByRole('button', { name: '开始冒险' });

    try {
      // Trigger initial adventure start -> goes busy and awaits deferred load
      void userEvent.click(startBtn);

      // Wait until listSnapshots has been called and is deferred
      await waitFor(() => expect(harness.fakeStorage.listSnapshots).toHaveBeenCalledTimes(1));

      // 1. Competing duplicate start attempt
      await userEvent.click(startBtn);

      // 2. Competing edition selection attempt from series sidebar
      const rubyRow = container.querySelector('button[aria-label="选择宝可梦 红宝石"]');
      expect(rubyRow).not.toBeNull();
      if (!rubyRow) throw new Error('Missing ruby row');
      await userEvent.click(rubyRow);

      // 3. Competing file drop attempt
      const dropZone = container.querySelector('.pocket-app');
      expect(dropZone).not.toBeNull();
      if (!dropZone) throw new Error('Missing dropZone');
      const droppedFile = new File([gbaFixture('AXVE')], 'dropped.gba');
      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [droppedFile],
          types: ['Files'],
        },
      });

      // 4. Competing return to gallery attempt
      const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
      expect(backBtn.hasAttribute('disabled')).toBe(true);
      await userEvent.click(backBtn);

      // Advance event loop turn to confirm competing commands were rejected
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // loadGame has not completed yet while load is deferred
      expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);

      // Stored cartridges unchanged (droppedFile was rejected)
      const storedList = await storage.listCartridges();
      expect(storedList.length).toBe(2);
      expect(storedList.find((c) => c.fileName === 'dropped.gba')).toBeUndefined();

      // Edition remains emerald
      expect(screen.getByRole('heading', { level: 2, name: '宝可梦 绿宝石' })).toBeDefined();
    } finally {
      releaseLoad();
      if (loadDeferredPromise) await loadDeferredPromise;
    }

    // Flush RAFs after load settles
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    // Now exactly ONE loadGame call occurred for emerald
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(1);
    expect(vi.mocked(harness.testCore.loadGame).mock.calls[0]?.[0]).toBe(
      '/roms/stored-emerald.gba',
    );

    await screen.findByText('正在冒险');
    expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');
    expect(container.querySelector('canvas')).toBe(canvasBefore);
  });

  it('guards against competing cartridge switch, picker, and drop during deferred return-to-gallery', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const rubyCart = createCartridge('stored-ruby', {
      header: { ...emeraldCart.header, editionId: 'ruby', title: 'POKEMON RUBY' },
      fileName: 'pokemon-ruby.gba',
    });
    await storage.putCartridge(emeraldCart);
    await storage.putCartridge(rubyCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    // Start game
    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    const canvasBefore = container.querySelector('canvas');
    expect(canvasBefore).not.toBeNull();

    // Defer storage.putBattery during returnToGallery
    const originalPutBattery = vi.mocked(harness.fakeStorage.putBattery).getMockImplementation();
    if (!originalPutBattery) throw new Error('Missing original putBattery implementation');

    let releaseReturn: () => void = () => {};
    let returnDeferredPromise: Promise<void> | null = null;
    const returnDeferred = new Promise<void>((resolve) => {
      releaseReturn = resolve;
    });

    vi.mocked(harness.fakeStorage.putBattery).mockImplementation(async (save) => {
      returnDeferredPromise = (async () => {
        await returnDeferred;
      })();
      await returnDeferredPromise;
      return originalPutBattery(save);
    });

    const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
    vi.mocked(harness.testCore.loadGame).mockClear();

    try {
      // Trigger returnToGallery
      void userEvent.click(backBtn);

      await waitFor(() => expect(harness.fakeStorage.putBattery).toHaveBeenCalledTimes(1));

      // 1. Competing duplicate return click
      await userEvent.click(backBtn);

      // 2. Competing edition switch from series library
      const rubyRow = container.querySelector('button[aria-label="选择宝可梦 红宝石"]');
      expect(rubyRow).not.toBeNull();
      if (!rubyRow) throw new Error('Missing ruby row');
      await userEvent.click(rubyRow);

      // 3. Competing file drop attempt
      const dropZone = container.querySelector('.pocket-app');
      expect(dropZone).not.toBeNull();
      if (!dropZone) throw new Error('Missing dropZone');
      const droppedFile = new File([gbaFixture('AXVE')], 'dropped2.gba');
      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [droppedFile],
          types: ['Files'],
        },
      });

      // 4. Competing file input change
      const romInput = container.querySelector(
        'input[type="file"][accept*=".gba"]',
      ) as HTMLInputElement;
      expect(romInput).not.toBeNull();
      if (!romInput) throw new Error('Missing romInput');
      fireEvent.change(romInput, { target: { files: [droppedFile] } });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // No new loadGame called during return
      expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);

      // Stored cartridges unchanged (dropped file rejected)
      const storedList = await storage.listCartridges();
      expect(storedList.length).toBe(2);
      expect(storedList.find((c) => c.fileName === 'dropped2.gba')).toBeUndefined();
    } finally {
      releaseReturn();
      if (returnDeferredPromise) await returnDeferredPromise;
    }

    // Settles return to gallery
    await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
    expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(container.querySelector('canvas')).toBe(canvasBefore);
  });
});
