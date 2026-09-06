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

  it('restores persisted settings on fresh mount and keeps memory state usable when localStorage.setItem rejects', async () => {
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
        return { ok: false };
      }),
    );

    // 1. Initial mount: configure custom nondefault preferences through real UI
    const firstRender = render(<App />);
    await screen.findByText('本地存储已就绪');

    const settingsBtn = screen.getByRole('button', { name: '打开设置' });
    await userEvent.click(settingsBtn);
    const settingsDialog = await screen.findByRole('dialog');

    // Set nondefault volume to 0.40
    const volumeSlider = within(settingsDialog).getByRole('slider', { name: '设置游戏音量' });
    fireEvent.change(volumeSlider, { target: { value: '0.4' } });

    // Set muted to true
    const muteToggle = within(settingsDialog).getByRole('button', { name: '静音游戏' });
    await userEvent.click(muteToggle);

    // Set filter to 'lcd'
    const lcdBtn = within(settingsDialog).getByRole('button', { name: '复古液晶' });
    await userEvent.click(lcdBtn);

    // Set autoPause to false
    const autoPauseSwitch = within(settingsDialog).getByRole('switch', { name: '离开时自动暂停' });
    await userEvent.click(autoPauseSwitch);

    // Rebind A key to 'KeyJ'
    const aBindingBtn = within(settingsDialog).getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aBindingBtn);
    fireEvent.keyDown(window, { code: 'KeyJ' });

    // Close settings modal
    const closeBtn = within(settingsDialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeBtn);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Verify localStorage has persisted the exact nondefault settings
    const storedBeforeUnmount = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    expect(storedBeforeUnmount.volume).toBe(0.4);
    expect(storedBeforeUnmount.muted).toBe(true);
    expect(storedBeforeUnmount.filter).toBe('lcd');
    expect(storedBeforeUnmount.autoPause).toBe(false);
    expect(storedBeforeUnmount.bindings.A).toEqual(['KeyJ']);

    // Unmount first app instance and clean up harness while retaining localStorage
    firstRender.unmount();
    cleanup();
    harness.cleanup();

    // 2. Fresh mount with a fresh harness: verify restoration of persisted settings
    harness = createTestAppHarness();
    const secondRender = render(<App />);
    await screen.findByText('本地存储已就绪');

    // Launch emerald game
    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    // (a) Core volume initialized to 0 because muted=true (even though volume is 0.4)
    expect(harness.testCore.setVolume).toHaveBeenCalledWith(0);

    // (b) Screen element has restored 'lcd-filter' class
    const screenElement = secondRender.container.querySelector('.game-screen');
    expect(screenElement?.classList.contains('lcd-filter')).toBe(true);

    // (c) Help / Operation guide renders restored key label 'J' for A button
    const controlsCard = secondRender.container.querySelector('.controls-card');
    expect(controlsCard).not.toBeNull();
    if (!controlsCard) throw new Error('Missing controls card');
    expect(within(controlsCard as HTMLElement).getByText('J')).toBeDefined();

    // Query actual '游玩指南' modal and verify its .full-keyboard A row displays restored 'J'
    const helpNavBtn = screen.getByRole('button', { name: '游玩指南' });
    await userEvent.click(helpNavBtn);
    const helpDialog = await screen.findByRole('dialog');
    expect(
      within(helpDialog).getByRole('heading', { level: 2, name: '你好，训练家。' }),
    ).toBeDefined();

    const fullKeyboard = helpDialog.querySelector('.full-keyboard');
    expect(fullKeyboard).not.toBeNull();
    if (!fullKeyboard) throw new Error('Missing full keyboard container in help guide');
    const fullKeyboardRows = Array.from(fullKeyboard.querySelectorAll('div'));
    const aRow = fullKeyboardRows.find((row) =>
      row.querySelector('span')?.textContent?.includes('A · 确认 / 互动'),
    );
    expect(aRow).toBeDefined();
    if (!aRow) throw new Error('Missing A button row in full keyboard guide');
    expect(aRow.querySelector('kbd')?.textContent).toBe('J');

    const closeHelpBtn = within(helpDialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeHelpBtn);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // (d) Keyboard behavior responds to restored 'KeyJ' binding and reaches core buttonPress
    vi.mocked(harness.testCore.buttonPress).mockClear();
    vi.mocked(harness.testCore.buttonUnpress).mockClear();
    fireEvent.keyDown(window, { code: 'KeyJ' });
    expect(harness.testCore.buttonPress).toHaveBeenCalledTimes(1);
    expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
    fireEvent.keyUp(window, { code: 'KeyJ' });
    expect(harness.testCore.buttonUnpress).toHaveBeenCalledTimes(1);
    expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

    // (e) Open settings dialog on fresh mount and verify rendered values
    const secondSettingsBtn = screen.getByRole('button', { name: '打开设置' });
    await userEvent.click(secondSettingsBtn);
    const restoredDialog = await screen.findByRole('dialog');

    const restoredSlider = within(restoredDialog).getByRole('slider', {
      name: '设置游戏音量',
    }) as HTMLInputElement;
    expect(restoredSlider.value).toBe('0.4');

    expect(within(restoredDialog).getByRole('button', { name: '取消静音' })).toBeDefined();

    const restoredAutoPause = within(restoredDialog).getByRole('switch', {
      name: '离开时自动暂停',
    });
    expect(restoredAutoPause.getAttribute('aria-checked')).toBe('false');

    const restoredLcdBtn = within(restoredDialog).getByRole('button', { name: '复古液晶' });
    expect(restoredLcdBtn.classList.contains('selected')).toBe(true);

    const restoredABtn = within(restoredDialog).getByRole('button', { name: '修改 A 主要键位' });
    expect(restoredABtn.textContent).toContain('J');

    // Close settings dialog before testing persistence failure
    const closeSecondSettings = within(restoredDialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeSecondSettings);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // 3. Test persistence failure: when localStorage.setItem rejects, memory state and UI/core remain usable
    const originalSettingsInStorage = localStorage.getItem('pocket-settings');
    let setItemAttempts = 0;
    const originalSetItem = localStorage.setItem.bind(localStorage);

    const setItemSpy = vi
      .spyOn(localStorage, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === 'pocket-settings') {
          setItemAttempts++;
          throw new Error('QuotaExceededError: storage is full');
        }
        originalSetItem(key, value);
      });

    try {
      // (3a) Open settings and modify volume and unmute via toolbar button
      const volumeMuteBtn = screen.getByRole('button', { name: '开启声音' });
      await userEvent.click(volumeMuteBtn);

      // Verify setItem was called and rejected
      expect(setItemAttempts).toBeGreaterThanOrEqual(1);

      // Core volume updated to unmuted volume (0.4) despite rejected storage write
      expect(harness.testCore.setVolume).toHaveBeenLastCalledWith(0.4);

      // Storage has NOT been updated with unmuted state; remains exact original rejected string
      expect(localStorage.getItem('pocket-settings')).toBe(originalSettingsInStorage);

      // (3b) Re-open settings modal and modify key binding from KeyJ to KeyU while rejection is active
      await userEvent.click(secondSettingsBtn);
      const thirdDialog = await screen.findByRole('dialog');
      expect(within(thirdDialog).getByRole('button', { name: '静音游戏' })).toBeDefined();

      // Switch filter to 'crisp' in memory
      const crispBtn = within(thirdDialog).getByRole('button', { name: '清晰像素' });
      await userEvent.click(crispBtn);
      expect(screenElement?.classList.contains('lcd-filter')).toBe(false);

      // Change A binding from KeyJ to KeyU in settings UI
      const aSlotThird = within(thirdDialog).getByRole('button', { name: '修改 A 主要键位' });
      fireEvent.click(aSlotThird);
      fireEvent.keyDown(window, { code: 'KeyU' });

      // Verify binding button in settings modal updates to show 'U'
      expect(
        within(thirdDialog).getByRole('button', { name: '修改 A 主要键位' }).textContent,
      ).toContain('U');

      // Close settings modal back to running
      const closeThird = within(thirdDialog).getByRole('button', { name: '关闭窗口' });
      await userEvent.click(closeThird);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      // (3c) Help modal reflects unsaved in-memory binding 'U'
      await userEvent.click(helpNavBtn);
      const helpDialogThird = await screen.findByRole('dialog');
      const fullKeyboardThird = helpDialogThird.querySelector('.full-keyboard');
      const aRowThird = Array.from(fullKeyboardThird?.querySelectorAll('div') ?? []).find((row) =>
        row.querySelector('span')?.textContent?.includes('A · 确认 / 互动'),
      );
      expect(aRowThird?.querySelector('kbd')?.textContent).toBe('U');

      const closeHelpThird = within(helpDialogThird).getByRole('button', { name: '关闭窗口' });
      await userEvent.click(closeHelpThird);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      // (3d) In-memory key dispatch: new KeyU reaches core A, while old KeyJ no longer does
      vi.mocked(harness.testCore.buttonPress).mockClear();
      vi.mocked(harness.testCore.buttonUnpress).mockClear();

      // Press old KeyJ -> ignored by core
      fireEvent.keyDown(window, { code: 'KeyJ' });
      expect(harness.testCore.buttonPress).not.toHaveBeenCalled();
      fireEvent.keyUp(window, { code: 'KeyJ' });
      expect(harness.testCore.buttonUnpress).not.toHaveBeenCalled();

      // Press new KeyU -> reaches core A
      fireEvent.keyDown(window, { code: 'KeyU' });
      expect(harness.testCore.buttonPress).toHaveBeenCalledTimes(1);
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
      fireEvent.keyUp(window, { code: 'KeyU' });
      expect(harness.testCore.buttonUnpress).toHaveBeenCalledTimes(1);
      expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

      // (3e) Storage remains strictly unchanged matching the exact initial persisted string
      expect(localStorage.getItem('pocket-settings')).toBe(originalSettingsInStorage);
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
