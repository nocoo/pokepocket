// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

describe('App cartridge lifecycle and gallery orchestration', () => {
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

  it('initializes library, catalog, and preferences successfully', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);
    localStorage.setItem('pocket-last-cartridge', 'stored-emerald');
    localStorage.setItem('pocket-last-edition', 'emerald');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          editions: [{ id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }],
        }),
      }),
    );

    render(<App />);

    await screen.findByText('本地存储已就绪');
    expect(await screen.findByText('1 枚卡带就绪')).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: '绿宝石' })).toBeDefined();
  });

  it('notifies error when storage listing fails', async () => {
    const listSpy = vi
      .spyOn(storage, 'listCartridges')
      .mockRejectedValue(new Error('IndexedDB blocked'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    render(<App />);

    expect(await screen.findByText(/无法访问本地存储：IndexedDB blocked/)).toBeDefined();
    listSpy.mockRestore();
  });

  it('chooses available edition, starts adventure, switches to play view and preserves canvas', async () => {
    const rubyBytes = gbaFixture('AXVE');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/catalog')) {
          return {
            ok: true,
            json: async () => ({
              editions: [
                { id: 'emerald', available: true, url: '/roms/pokeemerald.gba' },
                { id: 'ruby', available: true, url: '/roms/pokeruby.gba' },
              ],
            }),
          };
        }
        if (url.includes('/roms/')) {
          return {
            ok: true,
            headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
            blob: async () => new Blob([rubyBytes]),
          };
        }
        return { ok: false };
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    const rubyTrayBtn = screen.getByRole('button', { name: '选择宝可梦 红宝石' });
    await userEvent.click(rubyTrayBtn);
    expect(screen.getByRole('heading', { level: 2, name: '红宝石' })).toBeDefined();

    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);

    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    await startPromise;

    await screen.findByText('正在冒险');
    const canvas = container.querySelector('#game-canvas');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);

    expect(harness.testCore.loadGame).toHaveBeenCalledWith(
      expect.stringMatching(/\/roms\/[a-f0-9]+\.gba$/),
      expect.stringMatching(/\/saves\/[a-f0-9]+\.sav$/),
    );

    const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
    await userEvent.click(backBtn);

    expect(await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/)).toBeDefined();
    const layout = container.querySelector('.app-layout');
    expect(layout?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('#game-canvas')).toBe(canvas);
  });

  it('imports cartridge via file drop and starts game', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    const appContainer = container.querySelector('.pocket-app') as HTMLElement;
    const gbaFile = new File([gbaFixture()], 'custom-emerald.gba');

    fireEvent.dragEnter(appContainer, {
      dataTransfer: { types: ['Files'] },
    });
    const overlay = container.querySelector('.drop-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay).toBeInstanceOf(HTMLDivElement);

    fireEvent.drop(appContainer, {
      dataTransfer: { files: [gbaFile] },
    });

    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    await screen.findByText('正在冒险');
    expect(harness.testCore.loadGame).toHaveBeenCalledWith(
      expect.stringMatching(/\/roms\/[a-f0-9]+\.gba$/),
      expect.stringMatching(/\/saves\/[a-f0-9]+\.sav$/),
    );

    // Verify stored cartridge bytes
    const storedList = await storage.listCartridges();
    const droppedCart = storedList.find((c) => c.fileName === 'custom-emerald.gba');
    expect(droppedCart).toBeDefined();
    if (droppedCart) {
      expect(new Uint8Array(droppedCart.data)).toEqual(gbaFixture());
    }
  });

  it('opens cartridge picker when starting an unavailable edition without cartridge and handles picker cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    const importBtn = screen.getByRole('button', { name: '导入卡带' });
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    await userEvent.click(importBtn);

    expect(clickSpy).toHaveBeenCalled();

    // Trigger cancel on romInput file input element
    const romInput = container.querySelector('input[type="file"][accept*=".gba"]');
    expect(romInput).not.toBeNull();
    expect(romInput).toBeInstanceOf(HTMLInputElement);
    fireEvent(romInput as HTMLInputElement, new Event('cancel'));
  });

  it('selects local custom cartridge from sidebar details and runs in console', async () => {
    const emeraldCart = createCartridge('local-emerald');
    const customCart = createCartridge('local-custom-rev1', {
      fileName: 'custom-game.gba',
      header: { ...createCartridge().header, editionId: null, title: 'CUSTOM ROM', version: 1 },
    });
    await storage.putCartridge(emeraldCart);
    await storage.putCartridge(customCart);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    // Start with default emerald cartridge
    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);

    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    // In play view sidebar, details element lists local revisions
    const details = container.querySelector('details.local-cartridges');
    expect(details).not.toBeNull();
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    (details as HTMLDetailsElement).open = true;

    const localBtn = screen.getByRole('button', { name: '载入本地卡带 custom-game.gba' });
    expect(localBtn).toBeDefined();

    // Select custom cartridge
    await userEvent.click(localBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    expect(await screen.findByRole('heading', { level: 2, name: 'CUSTOM ROM' })).toBeDefined();
    expect(harness.testCore.loadGame).toHaveBeenCalledWith(
      '/roms/local-custom-rev1.gba',
      '/saves/local-custom-rev1.sav',
    );
    expect(localStorage.getItem('pocket-last-cartridge')).toBe('local-custom-rev1');
  });
});
