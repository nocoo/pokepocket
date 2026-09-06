// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
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

describe('App real keyboard and gamepad wiring', () => {
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

  async function startAppWithRunningCartridge() {
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

    const utils = render(<App />);
    await screen.findByText('本地存储已就绪');

    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');
    return utils;
  }

  it('handles keyboard mapping, repeats, focus change keyup, editing/modifier guards, space pause persistence, mute, backquote restore, and rebindings', async () => {
    const { container, unmount } = await startAppWithRunningCartridge();

    // 1. Core mapping and repeat suppression
    const pressCallsBaseline = vi.mocked(harness.testCore.buttonPress).mock.calls.length;
    const unpressCallsBaseline = vi.mocked(harness.testCore.buttonUnpress).mock.calls.length;

    // Default mapping: KeyO -> A
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsBaseline + 1);
    expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');

    // Repeated keydown does not cause extra press
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o', repeat: true });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsBaseline + 1);

    // keyUp releases input
    fireEvent.keyUp(window, { code: 'KeyO', key: 'o' });
    expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
      unpressCallsBaseline + 1,
    );
    expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

    // 2. Focus change / blur releases held keys
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsBaseline + 2);
    // Window blur event triggers releaseAll
    fireEvent.blur(window);
    expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
      unpressCallsBaseline + 2,
    );
    expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

    // KeyUp after focus change should safely complete without duplicate unpress
    fireEvent.keyUp(window, { code: 'KeyO', key: 'o' });
    expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
      unpressCallsBaseline + 2,
    );

    // 2b. Correction 1: Hold KeyO, move focus into editable without blur, dispatch keyUp on editable element
    // Press KeyO on window
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsBaseline + 3);

    const editableInput = document.createElement('input');
    container.appendChild(editableInput);
    // Focus without dispatching blur on window
    editableInput.focus();

    // KeyUp bubbles from editableInput to window
    fireEvent.keyUp(editableInput, { code: 'KeyO', key: 'o' });
    // Exactly one A release
    expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
      unpressCallsBaseline + 3,
    );
    expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');
    editableInput.remove();

    // 3. Ignored targets in play view with NO modal:
    // (a) Editable inputs (input, textarea, select, contenteditable)
    const testInput = document.createElement('input');
    const testTextarea = document.createElement('textarea');
    const testSelect = document.createElement('select');
    const testEditable = document.createElement('div');
    // In happy-dom, ensure isContentEditable evaluates to true
    Object.defineProperty(testEditable, 'isContentEditable', { value: true, configurable: true });

    container.appendChild(testInput);
    container.appendChild(testTextarea);
    container.appendChild(testSelect);
    container.appendChild(testEditable);

    const pressCountBeforeGuards = vi.mocked(harness.testCore.buttonPress).mock.calls.length;

    for (const elem of [testInput, testTextarea, testSelect, testEditable]) {
      elem.focus();
      fireEvent.keyDown(elem, { code: 'KeyO', key: 'o' });
      fireEvent.keyDown(elem, { code: 'Enter', key: 'Enter' });
      fireEvent.keyDown(elem, { code: 'Space', key: ' ' });
    }
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCountBeforeGuards);

    testInput.remove();
    testTextarea.remove();
    testSelect.remove();
    testEditable.remove();

    // (b) Modifier keys (metaKey, ctrlKey, altKey)
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o', metaKey: true });
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o', ctrlKey: true });
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o', altKey: true });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCountBeforeGuards);

    // (c) Button AND actual anchor/nested activation targets:
    // Enter must cause no core Start press and Space no pause/save
    const pauseCallsBaseline = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
    const resumeCallsBaseline = vi.mocked(harness.testCore.resumeGame).mock.calls.length;
    const putSnapshotCallsBaseline = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;

    // Test button target
    const toolbarButton = screen.getByRole('button', { name: '打开设置' });
    toolbarButton.focus();
    fireEvent.keyDown(toolbarButton, { code: 'Space', key: ' ' });
    fireEvent.keyDown(toolbarButton, { code: 'Enter', key: 'Enter' });

    // Test anchor target (e.g. skip-link or brand link)
    const brandLink = screen.getByRole('link', { name: 'Poké Pocket 首页' });
    brandLink.focus();
    fireEvent.keyDown(brandLink, { code: 'Space', key: ' ' });
    fireEvent.keyDown(brandLink, { code: 'Enter', key: 'Enter' });

    // Test nested element inside link/button
    const nestedSpan = brandLink.querySelector('span');
    if (nestedSpan) {
      fireEvent.keyDown(nestedSpan, { code: 'Space', key: ' ', bubbles: true });
      fireEvent.keyDown(nestedSpan, { code: 'Enter', key: 'Enter', bubbles: true });
    }

    // Assert exact baselines unchanged: no extra buttonPress (Start), no pauseGame, no putSnapshot
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCountBeforeGuards);
    expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline);
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline,
    );
    expect(screen.getByText('正在冒险')).toBeDefined();

    // 4. Space bar toggle on window: pause persistence and ordinary resume
    let resolvePauseCheckpoint: () => void = () => {};
    const pauseCheckpointPromise = new Promise<void>((resolve) => {
      resolvePauseCheckpoint = resolve;
    });
    const origPutSnapshot = vi.mocked(harness.fakeStorage.putSnapshot).getMockImplementation();
    if (!origPutSnapshot) throw new Error('Missing putSnapshot');

    vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
      const res = await origPutSnapshot(snap);
      resolvePauseCheckpoint();
      return res;
    });

    toolbarButton.blur();
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });

    expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline + 1);
    await screen.findByText('已暂停');

    await pauseCheckpointPromise;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline + 1,
    );
    const pauseSnaps = await harness.fakeStorage.listSnapshots('stored-emerald');
    const pauseSnap = pauseSnaps.find((s) => s.slot === 0);
    expect(pauseSnap).toBeDefined();
    expect(pauseSnap?.slot).toBe(0);
    expect(pauseSnap?.romId).toBe('stored-emerald');
    expect(pauseSnap?.key).toBe('stored-emerald:0');
    expect(new Uint8Array(pauseSnap?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // Space on window again -> resumes game
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(resumeCallsBaseline + 1);
    await screen.findByText('正在冒险');

    // 5. KeyM toggles mute
    const volumeCallsBaseline = vi.mocked(harness.testCore.setVolume).mock.calls.length;
    fireEvent.keyDown(window, { code: 'KeyM', key: 'm' });
    await waitFor(() =>
      expect(vi.mocked(harness.testCore.setVolume).mock.calls.length).toBe(volumeCallsBaseline + 1),
    );
    expect(harness.testCore.setVolume).toHaveBeenLastCalledWith(0);

    // KeyM again -> restores volume (0.65)
    fireEvent.keyDown(window, { code: 'KeyM', key: 'm' });
    await waitFor(() =>
      expect(vi.mocked(harness.testCore.setVolume).mock.calls.length).toBe(volumeCallsBaseline + 2),
    );
    expect(harness.testCore.setVolume).toHaveBeenLastCalledWith(0.65);

    // 6. Held Backquote restoring previous nondefault speed on keyup/blur
    // First set nondefault baseline speed to 2 via speed toggle button
    const setFastForwardSpy = vi.mocked(harness.testCore.setFastForwardMultiplier);
    const speedBtn = screen.getByRole('button', { name: /游戏速度.*点击切换/ });
    await userEvent.click(speedBtn);
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(2);

    // Hold Backquote: speed increases to 3
    fireEvent.keyDown(window, { code: 'Backquote', key: '`' });
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(3);

    // Repeated Backquote keydown does NOT overwrite previous restore speed (remains 2)
    fireEvent.keyDown(window, { code: 'Backquote', key: '`', repeat: true });
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(3);

    // KeyUp on Backquote restores previous speed 2
    fireEvent.keyUp(window, { code: 'Backquote', key: '`' });
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(2);

    // Hold Backquote and blur window: restores previous speed 2
    fireEvent.keyDown(window, { code: 'Backquote', key: '`' });
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(3);
    fireEvent.blur(window);
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(2);

    // Hold Backquote and trigger effect cleanup by entering/exiting focusMode:
    const fullscreenBtn = screen.getByRole('button', { name: '全屏游戏' });
    await userEvent.click(fullscreenBtn);
    expect(container.querySelector('.game-stage.focus-mode')).not.toBeNull();

    // While in focus mode, hold Backquote
    fireEvent.keyDown(window, { code: 'Backquote', key: '`' });
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(3);

    // Escape exits focus mode -> re-renders effect with focusMode=false, effect cleanup restores speed 2
    fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
    expect(setFastForwardSpy).toHaveBeenLastCalledWith(2);
    expect(container.querySelector('.game-stage.focus-mode')).toBeNull();

    // 7. Changed key bindings
    let resolveSettingsCheckpoint: () => void = () => {};
    const settingsCheckpointPromise = new Promise<void>((resolve) => {
      resolveSettingsCheckpoint = resolve;
    });
    vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
      const res = await origPutSnapshot(snap);
      resolveSettingsCheckpoint();
      return res;
    });

    const settingsBtn = screen.getByRole('button', { name: '打开设置' });
    await userEvent.click(settingsBtn);
    const settingsDialog = await screen.findByRole('dialog');

    await settingsCheckpointPromise;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const aSlotBtn = within(settingsDialog).getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlotBtn);
    fireEvent.keyDown(window, { code: 'KeyJ' });

    const closeSettingsBtn = within(settingsDialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeSettingsBtn);
    await screen.findByText('正在冒险');

    // Old KeyO no longer triggers buttonPress
    const pressCallsBeforeJ = vi.mocked(harness.testCore.buttonPress).mock.calls.length;
    fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsBeforeJ);

    // New KeyJ triggers buttonPress for A
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j' });
    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsBeforeJ + 1);
    expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
    fireEvent.keyUp(window, { code: 'KeyJ', key: 'j' });
    expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

    // 8. Unmount cleanup and DOM event dispatching after unmount
    unmount();

    const pressCallsFinal = vi.mocked(harness.testCore.buttonPress).mock.calls.length;
    const unpressCallsFinal = vi.mocked(harness.testCore.buttonUnpress).mock.calls.length;

    // Dispatch DOM events on window after unmount -> zero side effects
    fireEvent.keyDown(window, { code: 'KeyJ', key: 'j' });
    fireEvent.keyUp(window, { code: 'KeyJ', key: 'j' });
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.blur(window);

    expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCallsFinal);
    expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCallsFinal);
  });

  it('handles gamepad polling with multiple pads, keyboard coexistence, disconnect releasing only that pad, view/modal enablement, and owned RAF cleanup', async () => {
    let mockPads: (Gamepad | null)[] = [];

    const descriptorBefore = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
    const hadProperty = Object.hasOwn(navigator, 'getGamepads');

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => mockPads as Gamepad[],
    });

    try {
      const { container, unmount } = await startAppWithRunningCartridge();

      // Ensure window RAF polling callback is registered (exactly 1 pending RAF)
      expect(harness.windowRafMap.size).toBe(1);

      // Helper to construct mock Gamepad
      // Production mapping in input.ts:
      // 0: 'A', 1: 'B', 4: 'L', 5: 'R', 8: 'Select', 9: 'Start', 12: 'Up', 13: 'Down', 14: 'Left', 15: 'Right'
      const makePad = (
        index: number,
        id: string,
        pressedIndices: number[] = [],
        connected = true,
      ): Gamepad =>
        ({
          index,
          id,
          connected,
          timestamp: Date.now(),
          mapping: 'standard',
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 16 }, (_, i) => ({
            pressed: pressedIndices.includes(i),
            touched: pressedIndices.includes(i),
            value: pressedIndices.includes(i) ? 1 : 0,
          })),
        }) as unknown as Gamepad;

      // 1. Single pad with button 0 pressed (A button)
      mockPads = [makePad(0, 'pad-one', [0])];

      let pressCalls = vi.mocked(harness.testCore.buttonPress).mock.calls.length;
      let unpressCalls = vi.mocked(harness.testCore.buttonUnpress).mock.calls.length;

      act(() => {
        harness.flushWindowRafs();
      });

      // Press A triggered: exact delta +1
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls + 1);
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCalls);
      pressCalls += 1;

      // 2. Both pads + keyboard holding A simultaneously:
      // Pad 0 holds A (button 0)
      // Pad 1 connects with button 0 (A) and button 1 (B) pressed
      // Keyboard presses KeyO (A)
      mockPads = [makePad(0, 'pad-one', [0]), makePad(1, 'pad-two', [0, 1])];

      act(() => {
        harness.flushWindowRafs();
      });

      // Pad 1 added B -> exactly 1 new buttonPress ('B')
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls + 1);
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('B');
      pressCalls += 1;

      // Keyboard presses KeyO (A button) while both Pad 0 and Pad 1 already hold A
      fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
      // Input controller coalesces holding sources: no new buttonPress
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls);

      // Disconnect Pad 0: test connected: false or null
      mockPads = [makePad(0, 'pad-one', [0], false), makePad(1, 'pad-two', [0, 1])];
      act(() => {
        harness.flushWindowRafs();
      });

      // Pad 1 and Keyboard still hold A -> zero unpress for A!
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCalls);

      // Disconnect Pad 1 (using null slot)
      mockPads = [null, null];
      act(() => {
        harness.flushWindowRafs();
      });

      // Pad 1 held B exclusively -> B is unpressed (delta +1). But A is STILL held by keyboard!
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCalls + 1);
      expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('B');
      unpressCalls += 1;

      // Finally release keyboard KeyO -> now A has zero holders and is released (delta +1)
      fireEvent.keyUp(window, { code: 'KeyO', key: 'o' });
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCalls + 1);
      expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');
      unpressCalls += 1;

      // 3. Connect Pad 0 with button 0 (A), then open modal:
      mockPads = [makePad(0, 'pad-one', [0])];
      act(() => {
        harness.flushWindowRafs();
      });
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls + 1);
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
      pressCalls += 1;

      // Await opening checkpoint when opening help modal
      let resolveModalCheckpoint: () => void = () => {};
      const modalCheckpointPromise = new Promise<void>((resolve) => {
        resolveModalCheckpoint = resolve;
      });
      const origPutSnapshot = vi.mocked(harness.fakeStorage.putSnapshot).getMockImplementation();
      if (!origPutSnapshot) throw new Error('Missing putSnapshot');

      vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
        const res = await origPutSnapshot(snap);
        resolveModalCheckpoint();
        return res;
      });

      const helpBtn = screen.getByRole('button', { name: '游玩指南' });
      await userEvent.click(helpBtn);
      const helpDialog = await screen.findByRole('dialog');
      expect(helpDialog).toBeDefined();

      await modalCheckpointPromise;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Verify slot 0 auto-save written
      const modalSnaps = await harness.fakeStorage.listSnapshots('stored-emerald');
      const modalSnap = modalSnaps.find((s) => s.slot === 0);
      expect(modalSnap).toBeDefined();
      expect(modalSnap?.slot).toBe(0);
      expect(modalSnap?.romId).toBe('stored-emerald');
      expect(modalSnap?.key).toBe('stored-emerald:0');
      expect(new Uint8Array(modalSnap?.data ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      // Flush RAF while modal is open -> gamepad input is disabled, so held button A is released
      act(() => {
        harness.flushWindowRafs();
      });
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCalls + 1);
      expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');
      unpressCalls += 1;

      // While modal is open, any buttons pressed on gamepad do NOT trigger press
      mockPads = [makePad(0, 'pad-one', [0, 1])];
      act(() => {
        harness.flushWindowRafs();
      });
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls);

      // Close modal -> game resumes and Pad 0's held buttons [0, 1] (A and B) are re-enabled
      const closeHelpBtn = within(helpDialog).getByRole('button', { name: '关闭窗口' });
      await userEvent.click(closeHelpBtn);
      await screen.findByText('正在冒险');

      act(() => {
        harness.flushWindowRafs();
      });

      // Assert NEW exact press deltas and identities (+2 for A and B)
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls + 2);
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.slice(pressCalls)).toEqual([
        ['A'],
        ['B'],
      ]);
      pressCalls += 2;

      // 4. Paused Game Enablement:
      // While paused, gamepad input is disabled -> held buttons are released
      let resolvePauseCheckpoint2: () => void = () => {};
      const pauseCheckpoint2Promise = new Promise<void>((resolve) => {
        resolvePauseCheckpoint2 = resolve;
      });
      vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
        const res = await origPutSnapshot(snap);
        resolvePauseCheckpoint2();
        return res;
      });

      const pauseToggle = screen.getByRole('button', { name: '暂停游戏' });
      await userEvent.click(pauseToggle);
      await screen.findByText('已暂停');

      await pauseCheckpoint2Promise;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      act(() => {
        harness.flushWindowRafs();
      });

      // Held buttons A and B are unpressed when paused (+2)
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(unpressCalls + 2);
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.slice(unpressCalls)).toEqual([
        ['A'],
        ['B'],
      ]);
      unpressCalls += 2;

      // Pressing buttons while paused has no effect on core buttonPress
      mockPads = [makePad(0, 'pad-one', [0])];
      act(() => {
        harness.flushWindowRafs();
      });
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls);

      // Resume game -> button A is re-pressed (+1)
      const resumeToggle = screen.getByRole('button', { name: '继续游戏' });
      await userEvent.click(resumeToggle);
      await screen.findByText('正在冒险');

      act(() => {
        harness.flushWindowRafs();
      });
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls + 1);
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
      pressCalls += 1;

      // 5. Return to Library while a pad button is held:
      // Pad 0 is currently holding button 0 (A)
      // Click return to gallery, await real battery persistence and library UI
      let resolveReturnBattery: () => void = () => {};
      const returnBatteryPromise = new Promise<void>((resolve) => {
        resolveReturnBattery = resolve;
      });
      const origPutBattery = vi.mocked(harness.fakeStorage.putBattery).getMockImplementation();
      if (!origPutBattery) throw new Error('Missing putBattery');

      vi.mocked(harness.fakeStorage.putBattery).mockImplementationOnce(async (bat) => {
        const res = await origPutBattery(bat);
        resolveReturnBattery();
        return res;
      });

      const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
      await userEvent.click(backBtn);

      await returnBatteryPromise;
      await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
      expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);

      // While in library view, poll with still-held pad -> NO new presses occur
      mockPads = [makePad(0, 'pad-one', [0, 1])];
      act(() => {
        harness.flushWindowRafs();
      });
      expect(vi.mocked(harness.testCore.buttonPress).mock.calls.length).toBe(pressCalls);

      // 6. Unmount cleanup: verify harness.windowRafMap is clean (size === 0) BEFORE harness.cleanup()
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
