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

  it('guards against competing start, edition switch, local cartridge selection, picker open, file drop, and return during deferred cartridge load', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const rubyCart = createCartridge('stored-ruby', {
      header: { ...emeraldCart.header, editionId: 'ruby', title: 'POKEMON RUBY' },
      fileName: 'pokemon-ruby.gba',
    });
    const customCart = createCartridge('stored-custom', {
      header: { ...emeraldCart.header, editionId: null, title: 'CUSTOM REV' },
      fileName: 'custom-rev.gba',
    });
    await storage.putCartridge(emeraldCart);
    await storage.putCartridge(rubyCart);
    await storage.putCartridge(customCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    // Baseline storage bytes
    const originalEmeraldBytes = new Uint8Array(emeraldCart.data);

    // Defer emulator.load via fakeStorage.listSnapshots
    const originalListSnapshots = vi
      .mocked(harness.fakeStorage.listSnapshots)
      .getMockImplementation();
    if (!originalListSnapshots) throw new Error('Missing original listSnapshots implementation');

    let releaseLoad: () => void = () => {};
    let loadWorkPromise: ReturnType<typeof originalListSnapshots> | null = null;
    const loadDeferred = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });

    vi.mocked(harness.fakeStorage.listSnapshots).mockImplementation((romId: string) => {
      loadWorkPromise = (async () => {
        await loadDeferred;
        return originalListSnapshots(romId);
      })();
      return loadWorkPromise;
    });

    // Spy on actual storage.putCartridge without replacing implementation
    const putCartridgeSpy = vi.spyOn(storage, 'putCartridge');

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    const canvasBefore = container.querySelector('canvas');
    expect(canvasBefore).not.toBeNull();

    const startBtn = screen.getByRole('button', { name: '开始冒险' });

    // Track file picker click
    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();
    let pickerClicked = false;
    const clickListener = () => {
      pickerClicked = true;
    };
    romInput.addEventListener('click', clickListener);

    try {
      // Trigger initial adventure start -> goes busy and awaits deferred load
      void userEvent.click(startBtn);

      // Wait until listSnapshots has been called and is deferred
      await waitFor(() => expect(harness.fakeStorage.listSnapshots).toHaveBeenCalledTimes(1));

      // 1. Competing duplicate start attempt through current live .boot-start button
      const bootStartBtn = container.querySelector('button.boot-start');
      expect(bootStartBtn).not.toBeNull();
      if (!bootStartBtn) throw new Error('Missing boot-start button');
      expect(bootStartBtn.isConnected).toBe(true);
      expect((bootStartBtn as HTMLButtonElement).disabled).toBe(true);
      await userEvent.click(bootStartBtn);

      // 2. Competing edition selection attempt from series sidebar
      const rubyRow = container.querySelector('button[aria-label="选择宝可梦 红宝石"]');
      expect(rubyRow).not.toBeNull();
      if (!rubyRow) throw new Error('Missing ruby row');
      await userEvent.click(rubyRow);

      // 3. Competing local custom cartridge selection from sidebar details
      const localDetails = container.querySelector('details.local-cartridges');
      expect(localDetails).not.toBeNull();
      if (!localDetails) throw new Error('Missing localDetails');
      (localDetails as HTMLDetailsElement).open = true;

      const customBtn = screen.getByRole('button', { name: '载入本地卡带 custom-rev.gba' });
      expect(customBtn).toBeDefined();
      await userEvent.click(customBtn);

      // 4. Competing attempt to open ROM picker by clicking an unavailable edition
      const leafgreenRow = container.querySelector('button[aria-label="选择宝可梦 叶绿"]');
      expect(leafgreenRow).not.toBeNull();
      if (!leafgreenRow) throw new Error('Missing leafgreen row');
      await userEvent.click(leafgreenRow);
      expect(pickerClicked).toBe(false); // Picker click must not be triggered while busy

      // 5. Competing file drop attempt
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

      // 6. Competing return to gallery attempt
      const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
      expect(backBtn.hasAttribute('disabled')).toBe(true);
      await userEvent.click(backBtn);

      // Advance event loop turn to confirm competing commands were rejected
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Zero loadGame calls and zero storage.putCartridge calls executed while load is deferred
      expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);
      expect(putCartridgeSpy).not.toHaveBeenCalled();

      // Stored cartridges unchanged (droppedFile was rejected)
      const storedList = await storage.listCartridges();
      expect(storedList.length).toBe(3);
      expect(storedList.find((c) => c.fileName === 'dropped.gba')).toBeUndefined();

      // Intended selection and preferences remain emerald while pending
      expect(screen.getByRole('heading', { level: 2, name: '宝可梦 绿宝石' })).toBeDefined();
      expect(localStorage.getItem('pocket-last-cartridge')).toBe('stored-emerald');
      expect(localStorage.getItem('pocket-last-edition')).toBe('emerald');
      const emeraldSidebarItem = container.querySelector(
        'button.carousel-cartridge[aria-label="选择宝可梦 绿宝石"]',
      );
      expect(emeraldSidebarItem?.classList.contains('is-selected')).toBe(true);
    } finally {
      romInput.removeEventListener('click', clickListener);
      releaseLoad();
      if (loadWorkPromise) await loadWorkPromise;
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
      harness.flushEmulatorRafs();
      await screen.findByText('正在冒险');
      // Assert zero post-release storage writes and restore spy
      expect(putCartridgeSpy).not.toHaveBeenCalled();
      putCartridgeSpy.mockRestore();
    }

    // Now exactly ONE loadGame call occurred for emerald with exact paths
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(1);
    expect(vi.mocked(harness.testCore.loadGame).mock.calls[0]?.[0]).toBe(
      '/roms/stored-emerald.gba',
    );
    expect(vi.mocked(harness.testCore.loadGame).mock.calls[0]?.[1]).toBe(
      '/saves/stored-emerald.sav',
    );

    // Exact stored and core FS ROM bytes match original
    const storedEmeraldAfter = (await storage.listCartridges()).find(
      (c) => c.id === 'stored-emerald',
    );
    expect(storedEmeraldAfter).toBeDefined();
    if (!storedEmeraldAfter) throw new Error('Missing stored emerald');
    expect(new Uint8Array(storedEmeraldAfter.data)).toEqual(originalEmeraldBytes);

    const coreRomBytesAfter = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');
    expect(new Uint8Array(coreRomBytesAfter)).toEqual(originalEmeraldBytes);

    // Selection and preferences remain emerald after completion
    expect(localStorage.getItem('pocket-last-cartridge')).toBe('stored-emerald');
    expect(localStorage.getItem('pocket-last-edition')).toBe('emerald');
    const emeraldSidebarItemAfter = container.querySelector(
      'button.carousel-cartridge[aria-label="选择宝可梦 绿宝石"]',
    );
    expect(emeraldSidebarItemAfter?.classList.contains('is-selected')).toBe(true);

    expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');
    expect(container.querySelector('canvas')).toBe(canvasBefore);
  });

  it('guards against competing cartridge switch, picker, and drop during deferred return-to-gallery', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const rubyCart = createCartridge('stored-ruby', {
      header: { ...emeraldCart.header, editionId: 'ruby', title: 'POKEMON RUBY' },
      fileName: 'pokemon-ruby.gba',
    });
    const customCart = createCartridge('stored-custom', {
      header: { ...emeraldCart.header, editionId: null, title: 'CUSTOM REV' },
      fileName: 'custom-rev.gba',
    });
    await storage.putCartridge(emeraldCart);
    await storage.putCartridge(rubyCart);
    await storage.putCartridge(customCart);
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
    let returnWorkPromise: ReturnType<typeof originalPutBattery> | null = null;
    const returnDeferred = new Promise<void>((resolve) => {
      releaseReturn = resolve;
    });

    vi.mocked(harness.fakeStorage.putBattery).mockImplementation((save) => {
      returnWorkPromise = (async () => {
        await returnDeferred;
        return originalPutBattery(save);
      })();
      return returnWorkPromise;
    });

    // Spy on actual storage.putCartridge without replacing implementation
    const putCartridgeSpy = vi.spyOn(storage, 'putCartridge');

    // Track file picker click
    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();
    let pickerClicked = false;
    const clickListener = () => {
      pickerClicked = true;
    };
    romInput.addEventListener('click', clickListener);

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

      // 3. Competing local custom cartridge selection from sidebar details
      const localDetails = container.querySelector('details.local-cartridges');
      expect(localDetails).not.toBeNull();
      if (!localDetails) throw new Error('Missing localDetails');
      (localDetails as HTMLDetailsElement).open = true;

      const customBtn = screen.getByRole('button', { name: '载入本地卡带 custom-rev.gba' });
      expect(customBtn).toBeDefined();
      await userEvent.click(customBtn);

      // 4. Competing attempt to open ROM picker by selecting an unavailable edition
      const leafgreenRow = container.querySelector('button[aria-label="选择宝可梦 叶绿"]');
      expect(leafgreenRow).not.toBeNull();
      if (!leafgreenRow) throw new Error('Missing leafgreen row');
      await userEvent.click(leafgreenRow);
      expect(pickerClicked).toBe(false);

      // 5. Competing file drop attempt
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

      // 6. Competing file input change
      fireEvent.change(romInput, { target: { files: [droppedFile] } });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Assert putBattery count is STILL 1 while return is pending
      expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(1);

      // Zero new loadGame calls and zero storage.putCartridge calls
      expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);
      expect(putCartridgeSpy).not.toHaveBeenCalled();

      // Stored cartridges unchanged (dropped file rejected)
      const storedList = await storage.listCartridges();
      expect(storedList.length).toBe(3);
      expect(storedList.find((c) => c.fileName === 'dropped2.gba')).toBeUndefined();

      // Intended preferences and sidebar selection remain emerald while pending
      expect(localStorage.getItem('pocket-last-cartridge')).toBe('stored-emerald');
      expect(localStorage.getItem('pocket-last-edition')).toBe('emerald');
      const emeraldSidebarItem = container.querySelector(
        'button.carousel-cartridge[aria-label="选择宝可梦 绿宝石"]',
      );
      expect(emeraldSidebarItem?.classList.contains('is-selected')).toBe(true);
    } finally {
      romInput.removeEventListener('click', clickListener);
      releaseReturn();
      if (returnWorkPromise) await returnWorkPromise;
      await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
      // Assert zero post-release storage writes and restore spy
      expect(putCartridgeSpy).not.toHaveBeenCalled();
      putCartridgeSpy.mockRestore();
    }

    // After completion: putBattery count is exactly 1 (zero extra calls)
    expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(1);
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);

    // Persisted original battery save bytes exist and match [1, 2, 3, 4]
    const persistedBattery = await harness.fakeStorage.getBattery('stored-emerald');
    expect(persistedBattery).not.toBeNull();
    if (!persistedBattery) throw new Error('Missing persisted battery');
    expect(new Uint8Array(persistedBattery.data)).toEqual(new Uint8Array([1, 2, 3, 4]));

    // Intended preferences and gallery tray selection remain emerald after completion
    expect(localStorage.getItem('pocket-last-cartridge')).toBe('stored-emerald');
    expect(localStorage.getItem('pocket-last-edition')).toBe('emerald');
    const emeraldTraySlot = container.querySelector(
      'button.tray-slot[aria-label="选择宝可梦 绿宝石"]',
    );
    expect(emeraldTraySlot?.classList.contains('is-selected')).toBe(true);

    // Settles return to gallery
    expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(container.querySelector('canvas')).toBe(canvasBefore);
  });
});
