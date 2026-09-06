// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
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

  it.each(['canvas', 'toolbar', 'keyboard'] as const)(
    'guards resume during pending return-to-gallery via %s and preserves paused gallery',
    async (control) => {
      const cart = createCartridge('return-resume-guard');
      await storage.putCartridge(cart);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ editions: [] }),
        }),
      );

      const { container } = render(<App />);
      await screen.findByText('本地存储已就绪');

      await userEvent.click(screen.getByRole('button', { name: '开始冒险' }));
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThan(0));
      harness.flushEmulatorRafs();
      await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThan(0));
      harness.flushEmulatorRafs();
      await screen.findByText('正在冒险');

      const originalPut = vi.mocked(harness.fakeStorage.putBattery).getMockImplementation();
      if (!originalPut) throw new Error('Missing original storage mutation');

      let releaseWrite: () => void = () => {};
      const writeDeferred = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });

      vi.mocked(harness.fakeStorage.putBattery).mockImplementationOnce(async (save) => {
        await writeDeferred;
        await originalPut(save);
      });

      const coreResumeCallsBefore = vi.mocked(harness.testCore.resumeGame).mock.calls.length;

      const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
      try {
        await userEvent.click(backBtn);

        // Verify putBattery is called and pending
        await waitFor(() => expect(harness.fakeStorage.putBattery).toHaveBeenCalledTimes(1));

        // Attempt resume during pending return
        if (control === 'canvas') {
          const screenBtn = screen.getByRole('button', { name: '点击画面继续游戏' });
          expect(screenBtn.hasAttribute('disabled')).toBe(true);
          await userEvent.click(screenBtn);
        } else if (control === 'toolbar') {
          const playToggle = screen.getByRole('button', { name: '继续游戏' });
          expect(playToggle.hasAttribute('disabled')).toBe(true);
          await userEvent.click(playToggle);
        } else {
          fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        }

        // Event loop turn: resume must not have executed
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(
          coreResumeCallsBefore,
        );
        expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
      } finally {
        // Release deferred write -> finishes return to gallery
        releaseWrite();
        await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
      }

      expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);
      expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
      expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(coreResumeCallsBefore);
    },
  );

  it('blocks Space synchronously before pending return rerenders and verifies data integrity', async () => {
    const cart = createCartridge('return-immediate-guard');
    await storage.putCartridge(cart);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    await userEvent.click(screen.getByRole('button', { name: '开始冒险' }));
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThan(0));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThan(0));
    harness.flushEmulatorRafs();
    await screen.findByText('正在冒险');

    const originalPut = vi.mocked(harness.fakeStorage.putBattery).getMockImplementation();
    if (!originalPut) throw new Error('Missing original storage mutation');

    let releaseWrite: () => void = () => {};
    const writeDeferred = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    vi.mocked(harness.fakeStorage.putBattery).mockImplementationOnce(async (save) => {
      await writeDeferred;
      await originalPut(save);
    });

    const coreResumeCallsBefore = vi.mocked(harness.testCore.resumeGame).mock.calls.length;
    const backBtn = screen.getByRole('button', { name: '返回卡带盘' });

    try {
      act(() => {
        backBtn.click();
        window.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }),
        );
      });

      await waitFor(() => expect(harness.fakeStorage.putBattery).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(coreResumeCallsBefore);
      expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    } finally {
      releaseWrite();
      await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
    }

    expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(coreResumeCallsBefore);
    const savedBattery = await harness.fakeStorage.getBattery(cart.id);
    expect(savedBattery).not.toBeNull();
    if (!savedBattery) throw new Error('Missing expected saved battery');
    expect(new Uint8Array(savedBattery.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('rejects return persistence failure, keeps play paused, clears busy, allows normal resume, and succeeds on retry', async () => {
    const cart = createCartridge('return-retry-guard');
    await storage.putCartridge(cart);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    await userEvent.click(screen.getByRole('button', { name: '开始冒险' }));
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThan(0));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThan(0));
    harness.flushEmulatorRafs();
    await screen.findByText('正在冒险');

    const originalPut = vi.mocked(harness.fakeStorage.putBattery).getMockImplementation();
    if (!originalPut) throw new Error('Missing original storage mutation');

    // First attempt rejects
    vi.mocked(harness.fakeStorage.putBattery).mockImplementationOnce(async () => {
      throw new Error('Disk quota exceeded');
    });

    const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
    await userEvent.click(backBtn);

    // Expect error toast notification
    expect(await screen.findByText(/Disk quota exceeded/)).toBeDefined();

    // Play view remains active (not hidden) and paused
    expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');

    // Controls are no longer busy/disabled
    const playToggle = screen.getByRole('button', { name: '继续游戏' });
    expect(playToggle.hasAttribute('disabled')).toBe(false);

    // Normal resume works after failure
    const coreResumeCallsBefore = vi.mocked(harness.testCore.resumeGame).mock.calls.length;
    await userEvent.click(playToggle);
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(
      coreResumeCallsBefore + 1,
    );
    expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');

    // Successful retry of return-to-gallery calls originalPut implementation
    await userEvent.click(backBtn);
    await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
    expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(2);

    const savedBattery = await harness.fakeStorage.getBattery(cart.id);
    expect(savedBattery).not.toBeNull();
    if (!savedBattery) throw new Error('Missing expected saved battery');
    expect(new Uint8Array(savedBattery.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
  it('refreshes gamepad connection and name across modal changes and handles first-poll disconnect', async () => {
    let mockPads: (Gamepad | null)[] = [
      {
        id: 'review pad',
        index: 0,
        connected: true,
        timestamp: 1000,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      } as unknown as Gamepad,
    ];

    const descriptorBefore = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
    const hadProperty = Object.hasOwn(navigator, 'getGamepads');

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => mockPads as Gamepad[],
    });

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ editions: [] }),
        }),
      );

      const { unmount } = render(<App />);
      await screen.findByText('本地存储已就绪');
      // Exactly one pending window RAF callback for gamepad polling before flush
      expect(harness.windowRafMap.size).toBe(1);

      // Flush window RAF so the connected gamepad poll executes
      act(() => {
        harness.flushWindowRafs();
      });

      // After poll executes, next poll is scheduled -> exactly one pending callback
      expect(harness.windowRafMap.size).toBe(1);

      // Gallery view shows connected gamepad in footer info
      expect(screen.getByText('手柄已连接，准备出发')).toBeDefined();
      expect(screen.getByTitle('review pad')).toBeDefined();

      // Disconnect gamepad BEFORE opening modal's first new RAF poll executes
      mockPads = [];

      // Open help modal: effect is recreated due to modal change
      const helpBtn = screen.getByRole('button', { name: '游玩指南' });
      await userEvent.click(helpBtn);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeDefined();

      // Exactly one pending callback scheduled for modal's poll effect
      expect(harness.windowRafMap.size).toBe(1);

      // Flush the new RAF poll
      act(() => {
        harness.flushWindowRafs();
      });

      // Modal field guide footer should NOT display old '已连接：review pad'
      expect(screen.queryByText(/已连接：review pad/)).toBeNull();
      expect(harness.windowRafMap.size).toBe(1);

      // Reconnect gamepad with a new name while modal is open
      mockPads = [
        {
          id: 'wireless controller',
          index: 0,
          connected: true,
          timestamp: 2000,
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
        } as unknown as Gamepad,
      ];

      act(() => {
        harness.flushWindowRafs();
      });

      // Now modal reflects the reconnected gamepad with updated name
      expect(within(dialog).getByText('已连接：wireless controller')).toBeDefined();
      expect(harness.windowRafMap.size).toBe(1);

      // Close modal -> view returns to gallery
      const closeBtn = within(dialog).getByRole('button', { name: '关闭窗口' });
      await userEvent.click(closeBtn);
      expect(screen.queryByRole('dialog')).toBeNull();

      // Footer info reflects the current controller
      expect(screen.getByText('手柄已连接，准备出发')).toBeDefined();
      expect(screen.getByTitle('wireless controller')).toBeDefined();
      expect(harness.windowRafMap.size).toBe(1);

      // Explicit unmount cancels the pending RAF callback
      unmount();
      expect(harness.windowRafMap.size).toBe(0);
    } finally {
      if (hadProperty && descriptorBefore) {
        Object.defineProperty(navigator, 'getGamepads', descriptorBefore);
      } else {
        delete (navigator as Partial<Navigator>).getGamepads;
      }
    }
  });
});
