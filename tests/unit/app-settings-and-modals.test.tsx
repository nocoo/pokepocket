// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
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

describe('App settings and modal management', () => {
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

  it('manages settings modal, wires emulator volume/filter, preserves pause ownership, and persists to localStorage', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);

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
        if (url.includes('/roms/')) {
          return {
            ok: true,
            headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
            blob: async () => new Blob([gbaFixture()]),
          };
        }
        return { ok: false };
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    // Start game to test live emulator wiring and running-vs-paused modal ownership
    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    // 1. Open settings while game is running -> core should pause
    const settingsBtn = screen.getByRole('button', { name: '打开设置' });
    await userEvent.click(settingsBtn);

    expect(harness.testCore.pauseGame).toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { level: 2, name: '让掌机，更像你的。' }),
    ).toBeDefined();

    // Toggle mute -> emulator setVolume(0)
    const muteToggle = within(dialog).getByRole('button', { name: '静音游戏' });
    await userEvent.click(muteToggle);
    expect(harness.testCore.setVolume).toHaveBeenCalledWith(0);
    const persistedSettings1 = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    expect(persistedSettings1.muted).toBe(true);

    // Toggle filter to LCD -> game-screen gets lcd-filter class
    const lcdFilterBtn = within(dialog).getByRole('button', { name: '复古液晶' });
    await userEvent.click(lcdFilterBtn);
    const persistedSettings2 = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    expect(persistedSettings2.filter).toBe('lcd');
    const screenElement = container.querySelector('.game-screen');
    expect(screenElement?.classList.contains('lcd-filter')).toBe(true);

    // Toggle volume slider -> core.setVolume(0.9)
    const volumeSlider = within(dialog).getByRole('slider', { name: '设置游戏音量' });
    fireEvent.change(volumeSlider, { target: { value: '0.9' } });
    expect(harness.testCore.setVolume).toHaveBeenCalledWith(0.9);
    const persistedSettingsVolume = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    expect(persistedSettingsVolume.volume).toBe(0.9);
    expect(persistedSettingsVolume.muted).toBe(false);

    // Rebind key in KeyBindings inside settings dialog
    const aSlot = within(dialog).getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlot);
    fireEvent.keyDown(window, { code: 'KeyK' });
    const persistedSettingsBindings = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    expect(persistedSettingsBindings.bindings.A).toEqual(['KeyK']);

    // Toggle autoPause
    const autoPauseBtn = within(dialog).getByRole('switch', { name: '离开时自动暂停' });
    await userEvent.click(autoPauseBtn);
    const persistedSettings3 = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    expect(persistedSettings3.autoPause).toBe(false);

    // Close settings modal -> game resumes because it was running before opening modal
    const closeBtn = within(dialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.testCore.resumeGame).toHaveBeenCalled();

    // 2. Pause game manually first, then open settings modal
    const playToggle = screen.getByRole('button', { name: '暂停游戏' });
    await userEvent.click(playToggle);
    await screen.findByText('已暂停');

    await userEvent.click(settingsBtn);
    const dialogPaused = await screen.findByRole('dialog');
    const closeBtn2 = within(dialogPaused).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeBtn2);

    // Should NOT resume because it was already paused before modal opened
    expect(screen.getByText('已暂停')).toBeDefined();
  });

  it('opens and closes help guide modal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    render(<App />);
    await screen.findByText('本地存储已就绪');

    const helpBtn = screen.getByRole('button', { name: '游玩指南' });
    await userEvent.click(helpBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(within(dialog).getByRole('heading', { level: 2, name: '你好，训练家。' })).toBeDefined();

    const closeBtn = within(dialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('manages restart confirmation modal: cancels without reset, confirms with emulator reset', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);

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
        if (url.includes('/roms/')) {
          return {
            ok: true,
            headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
            blob: async () => new Blob([gbaFixture()]),
          };
        }
        return { ok: false };
      }),
    );

    render(<App />);
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

    // Click restart button in stage toolbar
    const restartToolbarBtn = screen.getByRole('button', { name: '重新启动游戏' });
    await userEvent.click(restartToolbarBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(
      within(dialog).getByRole('heading', { level: 2, name: '重新开启这段冒险？' }),
    ).toBeDefined();

    // 1. Cancel via '再玩一会儿'
    const cancelRestartBtn = within(dialog).getByRole('button', { name: '再玩一会儿' });
    await userEvent.click(cancelRestartBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.testCore.quickReload).not.toHaveBeenCalled();

    // 2. Open restart modal again and confirm
    await userEvent.click(restartToolbarBtn);
    const dialogConfirm = await screen.findByRole('dialog');
    const confirmRestartBtn = within(dialogConfirm).getByRole('button', { name: '重新启动' });
    await userEvent.click(confirmRestartBtn);

    expect(harness.testCore.quickReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
