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

describe('App browser lifecycle, visibility, pagehide, and fullscreen wiring', () => {
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

  it('manages visibilitychange under autoPause=true and autoPause=false, releases held inputs/speed, exposes persistence errors, ignores visible events, and verifies cleanup', async () => {
    // 1) Save original own descriptor on document instance
    const hiddenDescBefore = Object.getOwnPropertyDescriptor(document, 'hidden');
    const hadHiddenOwn = Object.hasOwn(document, 'hidden');
    let isDocumentHidden = false;

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      enumerable: true,
      get: () => isDocumentHidden,
    });

    // 4) Spy on addEventListener and removeEventListener with call-through
    const docAddSpy = vi.spyOn(document, 'addEventListener');
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener');

    try {
      const { unmount } = await startAppWithRunningCartridge();

      // Find registered visibilitychange listener
      const visibilityCalls = docAddSpy.mock.calls.filter(([type]) => type === 'visibilitychange');
      expect(visibilityCalls.length).toBeGreaterThanOrEqual(1);
      const installedVisibilityHandler = visibilityCalls[visibilityCalls.length - 1]?.[1];
      expect(typeof installedVisibilityHandler).toBe('function');

      const origPutSnapshot = vi.mocked(harness.fakeStorage.putSnapshot).getMockImplementation();
      if (!origPutSnapshot) throw new Error('Missing putSnapshot');

      // 1. autoPause=true (default):
      // Hold a key (KeyO -> A button) and hold Backquote for speed 3
      fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');

      const setFastForwardSpy = vi.mocked(harness.testCore.setFastForwardMultiplier);
      fireEvent.keyDown(window, { code: 'Backquote', key: '`' });
      expect(setFastForwardSpy).toHaveBeenLastCalledWith(3);

      const pauseCallsBaseline = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
      const unpressCallsBaseline = vi.mocked(harness.testCore.buttonUnpress).mock.calls.length;
      const putSnapshotCallsBaseline = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;

      // Intercept auto-save checkpoint write
      let resolveCheckpoint1: () => void = () => {};
      const checkpoint1Promise = new Promise<void>((resolve) => {
        resolveCheckpoint1 = resolve;
      });
      vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
        const res = await origPutSnapshot(snap);
        resolveCheckpoint1();
        return res;
      });

      // Switch document to hidden and fire visibilitychange
      isDocumentHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));

      // (a) Held key released: buttonUnpress('A')
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
        unpressCallsBaseline + 1,
      );
      expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

      // (b) Held speed restored to previous speed 1
      expect(setFastForwardSpy).toHaveBeenLastCalledWith(1);

      // (c) Core paused: pauseGame incremented
      expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline + 1);

      // (d) Auto-save checkpoint persisted with exact payload [1, 2, 3, 4] and slot 0
      await checkpoint1Promise;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
        putSnapshotCallsBaseline + 1,
      );
      const snaps1 = await harness.fakeStorage.listSnapshots('stored-emerald');
      const snap1 = snaps1.find((s) => s.slot === 0);
      expect(snap1).toBeDefined();
      expect(snap1?.slot).toBe(0);
      expect(snap1?.key).toBe('stored-emerald:0');
      expect(snap1?.romId).toBe('stored-emerald');
      expect(new Uint8Array(snap1?.data ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      // Verify stored battery save identity and payload
      const battery1 = await harness.fakeStorage.getBattery('stored-emerald');
      expect(battery1).not.toBeNull();
      expect(battery1?.romId).toBe('stored-emerald');
      expect(new Uint8Array(battery1?.data ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      // 2. Visible events do NOT pause or persist:
      isDocumentHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      // Await task turn to ensure no delayed writes escape
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline + 1);
      expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
        putSnapshotCallsBaseline + 1,
      );

      // Resume game manually
      const resumeBtn = screen.getByRole('button', { name: '继续游戏' });
      await userEvent.click(resumeBtn);
      await screen.findByText('正在冒险');

      // 3. autoPause=false:
      // Await settings-opening checkpoint before autoPause=false baselines
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

      const autoPauseSwitch = within(settingsDialog).getByRole('switch', {
        name: '离开时自动暂停',
      });
      await userEvent.click(autoPauseSwitch);

      const closeSettingsBtn = within(settingsDialog).getByRole('button', { name: '关闭窗口' });
      await userEvent.click(closeSettingsBtn);
      await screen.findByText('正在冒险');

      // With autoPause=false, hold key and speed
      fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
      expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');
      fireEvent.keyDown(window, { code: 'Backquote', key: '`' });
      expect(setFastForwardSpy).toHaveBeenLastCalledWith(3);

      const pauseCallsBeforeHidden2 = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
      const unpressCallsBeforeHidden2 = vi.mocked(harness.testCore.buttonUnpress).mock.calls.length;
      const putSnapshotCallsBeforeHidden2 = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls
        .length;
      const putBatteryCallsBeforeHidden2 = vi.mocked(harness.fakeStorage.putBattery).mock.calls
        .length;

      let resolveCheckpoint2: () => void = () => {};
      const checkpoint2Promise = new Promise<void>((resolve) => {
        resolveCheckpoint2 = resolve;
      });
      vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
        const res = await origPutSnapshot(snap);
        resolveCheckpoint2();
        return res;
      });

      isDocumentHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));

      // (a) Held inputs and speed are STILL released even when autoPause=false
      expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
        unpressCallsBeforeHidden2 + 1,
      );
      expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');
      expect(setFastForwardSpy).toHaveBeenLastCalledWith(1);

      // (b) Game is NOT paused by emulator (pauseCalls unchanged)
      expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBeforeHidden2);

      // (c) Persistence still occurs: exact write delta +1 and matching bytes
      await checkpoint2Promise;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
        putSnapshotCallsBeforeHidden2 + 1,
      );
      expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(
        putBatteryCallsBeforeHidden2 + 1,
      );
      const snaps2 = await harness.fakeStorage.listSnapshots('stored-emerald');
      const snap2 = snaps2.find((s) => s.slot === 0);
      expect(snap2).toBeDefined();
      expect(snap2?.slot).toBe(0);
      expect(snap2?.key).toBe('stored-emerald:0');
      expect(snap2?.romId).toBe('stored-emerald');
      expect(new Uint8Array(snap2?.data ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      const battery2 = await harness.fakeStorage.getBattery('stored-emerald');
      expect(battery2).not.toBeNull();
      expect(battery2?.romId).toBe('stored-emerald');
      expect(new Uint8Array(battery2?.data ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      // 4. Persistence rejection exposes visible error toast:
      isDocumentHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));

      vi.mocked(harness.fakeStorage.putSnapshot).mockRejectedValueOnce(
        new Error('Disk quota exceeded on visibility checkpoint'),
      );

      isDocumentHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));

      // Error toast is shown via notify(message(error), true)
      expect(await screen.findByRole('alert')).toBeDefined();
      expect(screen.getByText(/Disk quota exceeded on visibility checkpoint/)).toBeDefined();

      // 5. Unmount cleanup and post-unmount event dispatching:
      // Verify pending window RAF size is 1 during active execution
      expect(harness.windowRafMap.size).toBe(1);

      unmount();

      // Verify pending window RAF size is 0 BEFORE harness.cleanup
      expect(harness.windowRafMap.size).toBe(0);

      // Verify matching removeEventListener was called with the exact installed handler
      expect(docRemoveSpy).toHaveBeenCalledWith('visibilitychange', installedVisibilityHandler);

      const pauseCallsFinal = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
      const putSnapshotCallsFinal = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;

      // Dispatched events after unmount produce zero side effects even after task turn
      document.dispatchEvent(new Event('visibilitychange'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsFinal);
      expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
        putSnapshotCallsFinal,
      );
    } finally {
      if (hadHiddenOwn && hiddenDescBefore) {
        Object.defineProperty(document, 'hidden', hiddenDescBefore);
      } else {
        delete (document as unknown as Record<string, unknown>).hidden;
      }
    }
  });

  it('manages pagehide persistence with real and rejected storage settlement, keeps no-cartridge quiet, and removes listeners on unmount', async () => {
    // Call-through spies on window event listeners
    const winAddSpy = vi.spyOn(window, 'addEventListener');
    const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

    // 1. With running cartridge: pagehide persists cartridge save and releases inputs
    const { unmount } = await startAppWithRunningCartridge();

    const pagehideCalls = (
      winAddSpy.mock.calls as [string, EventListenerOrEventListenerObject][]
    ).filter(([type]) => type === 'pagehide');
    expect(pagehideCalls.length).toBeGreaterThanOrEqual(1);
    const installedPagehideHandler = pagehideCalls[pagehideCalls.length - 1]?.[1];
    expect(typeof installedPagehideHandler).toBe('function');

    const origPutSnapshot = vi.mocked(harness.fakeStorage.putSnapshot).getMockImplementation();
    if (!origPutSnapshot) throw new Error('Missing putSnapshot');

    fireEvent.keyDown(window, { code: 'KeyO', key: 'o' });
    expect(harness.testCore.buttonPress).toHaveBeenLastCalledWith('A');

    const unpressCallsBaseline = vi.mocked(harness.testCore.buttonUnpress).mock.calls.length;
    const putSnapshotCallsBaseline = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;

    let resolvePagehideCheckpoint: () => void = () => {};
    const pagehidePromise = new Promise<void>((resolve) => {
      resolvePagehideCheckpoint = resolve;
    });
    vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
      const res = await origPutSnapshot(snap);
      resolvePagehideCheckpoint();
      return res;
    });

    window.dispatchEvent(new Event('pagehide'));

    // Held key released
    expect(vi.mocked(harness.testCore.buttonUnpress).mock.calls.length).toBe(
      unpressCallsBaseline + 1,
    );
    expect(harness.testCore.buttonUnpress).toHaveBeenLastCalledWith('A');

    // Persistence awaited and verified
    await pagehidePromise;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline + 1,
    );
    const snaps = await harness.fakeStorage.listSnapshots('stored-emerald');
    const snap = snaps.find((s) => s.slot === 0);
    expect(snap).toBeDefined();
    expect(snap?.slot).toBe(0);
    expect(snap?.romId).toBe('stored-emerald');
    expect(snap?.key).toBe('stored-emerald:0');
    expect(new Uint8Array(snap?.data ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3, 4]));

    const storedBattery = await harness.fakeStorage.getBattery('stored-emerald');
    expect(storedBattery).not.toBeNull();
    expect(new Uint8Array(storedBattery?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // 2. Pagehide with rejected storage settles safely without unhandled rejection:
    let rejectPagehidePut: (err: Error) => void = () => {};
    let resolvePagehideStarted: () => void = () => {};
    const pagehideStartedPromise = new Promise<void>((res) => {
      resolvePagehideStarted = res;
    });
    const rejectedPutPromise = new Promise<void>((_res, rej) => {
      rejectPagehidePut = rej;
    });

    vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async () => {
      resolvePagehideStarted();
      await rejectedPutPromise;
    });

    // Dispatch pagehide
    window.dispatchEvent(new Event('pagehide'));
    await pagehideStartedPromise;
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline + 2,
    );

    // Trigger rejection and settle outer catch
    rejectPagehidePut(new Error('Storage failure during pagehide'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Actual snapshot and battery data remain preserved after failure
    const snapsAfterFail = await harness.fakeStorage.listSnapshots('stored-emerald');
    const snapAfterFail = snapsAfterFail.find((s) => s.slot === 0);
    expect(snapAfterFail).toBeDefined();
    expect(snapAfterFail?.slot).toBe(0);
    expect(snapAfterFail?.romId).toBe('stored-emerald');
    expect(snapAfterFail?.key).toBe('stored-emerald:0');
    expect(new Uint8Array(snapAfterFail?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    const batteryAfterFail = await harness.fakeStorage.getBattery('stored-emerald');
    expect(batteryAfterFail).not.toBeNull();
    expect(batteryAfterFail?.romId).toBe('stored-emerald');
    expect(new Uint8Array(batteryAfterFail?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // Prove next pagehide checkpoint succeeds: assert write delta and read both stored payloads
    const putBatteryCallsBeforeSuccess2 = vi.mocked(harness.fakeStorage.putBattery).mock.calls
      .length;
    let resolvePagehideSuccess2: () => void = () => {};
    const pagehideSuccess2Promise = new Promise<void>((resolve) => {
      resolvePagehideSuccess2 = resolve;
    });
    vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (s) => {
      const res = await origPutSnapshot(s);
      resolvePagehideSuccess2();
      return res;
    });

    window.dispatchEvent(new Event('pagehide'));
    await pagehideSuccess2Promise;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline + 3,
    );
    expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(
      putBatteryCallsBeforeSuccess2 + 1,
    );

    const snapsAfterSuccess2 = await harness.fakeStorage.listSnapshots('stored-emerald');
    const snapAfterSuccess2 = snapsAfterSuccess2.find((s) => s.slot === 0);
    expect(snapAfterSuccess2).toBeDefined();
    expect(snapAfterSuccess2?.slot).toBe(0);
    expect(snapAfterSuccess2?.romId).toBe('stored-emerald');
    expect(snapAfterSuccess2?.key).toBe('stored-emerald:0');
    expect(new Uint8Array(snapAfterSuccess2?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    const batteryAfterSuccess2 = await harness.fakeStorage.getBattery('stored-emerald');
    expect(batteryAfterSuccess2).not.toBeNull();
    expect(batteryAfterSuccess2?.romId).toBe('stored-emerald');
    expect(new Uint8Array(batteryAfterSuccess2?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // 3. Unmount and verify matching removeEventListener
    expect(harness.windowRafMap.size).toBe(1);
    unmount();
    expect(harness.windowRafMap.size).toBe(0);

    expect(winRemoveSpy).toHaveBeenCalledWith('pagehide', installedPagehideHandler);

    const putCallsAfterUnmount = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;
    window.dispatchEvent(new Event('pagehide'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(putCallsAfterUnmount);

    // 4. In library view with NO cartridge: pagehide is completely quiet
    cleanup();
    render(<App />);
    await screen.findByText('本地存储已就绪');

    const putCallsInLibrary = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;
    const putBatteryInLibrary = vi.mocked(harness.fakeStorage.putBattery).mock.calls.length;

    window.dispatchEvent(new Event('pagehide'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(putCallsInLibrary);
    expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(putBatteryInLibrary);
  });

  it('handles native requestFullscreen/fullscreenchange/exit, exit errors, rejecting fallback to focusMode, KeyF, Escape, and return-to-gallery cleanup', async () => {
    // 1) Save original own descriptor on document instance
    const fsElementDescBefore = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const hadFsElementOwn = Object.hasOwn(document, 'fullscreenElement');
    let fullscreenElementMock: Element | null = null;

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      enumerable: true,
      get: () => fullscreenElementMock,
    });

    // Save and restore document.exitFullscreen on document instance
    const exitFsDescBefore = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    const hadExitFsOwn = Object.hasOwn(document, 'exitFullscreen');

    const docAddSpy = vi.spyOn(document, 'addEventListener');
    const docRemoveSpy = vi.spyOn(document, 'removeEventListener');

    try {
      const { container, unmount } = await startAppWithRunningCartridge();

      const fsChangeCalls = docAddSpy.mock.calls.filter(([type]) => type === 'fullscreenchange');
      expect(fsChangeCalls.length).toBeGreaterThanOrEqual(1);
      const installedFsChangeHandler = fsChangeCalls[fsChangeCalls.length - 1]?.[1];
      expect(typeof installedFsChangeHandler).toBe('function');

      const stage = container.querySelector('#game-stage') as HTMLElement;
      expect(stage).not.toBeNull();
      if (!stage) throw new Error('Missing game-stage element');

      // Own and restore stage.requestFullscreen
      const stageRequestFsDescBefore = Object.getOwnPropertyDescriptor(stage, 'requestFullscreen');
      const hadStageRequestFsOwn = Object.hasOwn(stage, 'requestFullscreen');

      try {
        // 1. Native requestFullscreen supported on stage:
        let requestFullscreenCalled = 0;
        let exitFullscreenCalled = 0;
        let exitReject = false;

        stage.requestFullscreen = vi.fn().mockImplementation(async () => {
          requestFullscreenCalled++;
          fullscreenElementMock = stage;
          document.dispatchEvent(new Event('fullscreenchange'));
        });

        document.exitFullscreen = vi.fn().mockImplementation(async () => {
          exitFullscreenCalled++;
          if (exitReject) throw new Error('Failed to exit fullscreen');
          fullscreenElementMock = null;
          document.dispatchEvent(new Event('fullscreenchange'));
        });

        // Press KeyF to enter fullscreen
        fireEvent.keyDown(window, { code: 'KeyF', key: 'f' });

        await waitFor(() => expect(requestFullscreenCalled).toBe(1));
        expect(fullscreenElementMock).toBe(stage);

        // Toolbar button reflects full screen state: aria-label="退出全屏"
        const exitFsBtn = await screen.findByRole('button', { name: '退出全屏' });
        expect(exitFsBtn).toBeDefined();

        // Press KeyF again to exit fullscreen
        fireEvent.keyDown(window, { code: 'KeyF', key: 'f' });

        await waitFor(() => expect(exitFullscreenCalled).toBe(1));
        expect(fullscreenElementMock).toBeNull();
        expect(screen.getByRole('button', { name: '全屏游戏' })).toBeDefined();

        // 2. Exit fullscreen rejection retains fullscreen UI, then retries through actual exit control:
        // Re-enter fullscreen
        fireEvent.keyDown(window, { code: 'KeyF', key: 'f' });
        await waitFor(() => expect(requestFullscreenCalled).toBe(2));

        exitReject = true;
        // Attempt exit: rejection occurs
        fireEvent.keyDown(window, { code: 'KeyF', key: 'f' });

        expect(await screen.findByRole('alert')).toBeDefined();
        expect(screen.getByText(/Failed to exit fullscreen/)).toBeDefined();

        // Fullscreen UI is retained (still in fullscreen mode with "退出全屏" button)
        const exitFsBtnAfterError = screen.getByRole('button', { name: '退出全屏' });
        expect(exitFsBtnAfterError).toBeDefined();
        expect(fullscreenElementMock).toBe(stage);

        // Retry through actual exit control button: this time exitFullscreen succeeds
        exitReject = false;
        await userEvent.click(exitFsBtnAfterError);

        await waitFor(() => expect(fullscreenElementMock).toBeNull());
        expect(screen.getByRole('button', { name: '全屏游戏' })).toBeDefined();

        // 3. Rejecting native requestFullscreen falls back to focusMode:
        stage.requestFullscreen = vi.fn().mockRejectedValue(new Error('Fullscreen not allowed'));

        // Click toolbar button
        const fsBtn = screen.getByRole('button', { name: '全屏游戏' });
        await userEvent.click(fsBtn);

        // focusMode fallback activated: stage has 'focus-mode' class and button has '退出全屏'
        await waitFor(() =>
          expect(container.querySelector('.game-stage.focus-mode')).not.toBeNull(),
        );
        expect(screen.getByRole('button', { name: '退出全屏' })).toBeDefined();

        // Press Escape in focusMode: exits focusMode
        fireEvent.keyDown(window, { code: 'Escape', key: 'Escape' });
        expect(container.querySelector('.game-stage.focus-mode')).toBeNull();
        expect(screen.getByRole('button', { name: '全屏游戏' })).toBeDefined();

        // Enter focusMode again via KeyF
        fireEvent.keyDown(window, { code: 'KeyF', key: 'f' });
        await waitFor(() =>
          expect(container.querySelector('.game-stage.focus-mode')).not.toBeNull(),
        );

        // Click toolbar button to exit focusMode
        const exitFocusBtn = screen.getByRole('button', { name: '退出全屏' });
        await userEvent.click(exitFocusBtn);
        expect(container.querySelector('.game-stage.focus-mode')).toBeNull();

        // 4. When stage has no requestFullscreen method (simulated by setting property to undefined):
        Object.defineProperty(stage, 'requestFullscreen', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: undefined,
        });

        fireEvent.keyDown(window, { code: 'KeyF', key: 'f' });
        expect(container.querySelector('.game-stage.focus-mode')).not.toBeNull();

        // 5. Returning to gallery clears focusMode:
        const backBtn = screen.getByRole('button', { name: '返回卡带盘' });
        await userEvent.click(backBtn);

        await screen.findByText(/打开卡带盒，把那个舍不得结束的夏天，再过一遍/);
        expect(container.querySelector('.app-layout')?.hasAttribute('hidden')).toBe(true);
        expect(container.querySelector('.game-stage.focus-mode')).toBeNull();

        // 6. Unmount cleanup: verify matching removeEventListener
        unmount();
        expect(docRemoveSpy).toHaveBeenCalledWith('fullscreenchange', installedFsChangeHandler);
      } finally {
        if (hadStageRequestFsOwn && stageRequestFsDescBefore) {
          Object.defineProperty(stage, 'requestFullscreen', stageRequestFsDescBefore);
        } else {
          delete (stage as unknown as Record<string, unknown>).requestFullscreen;
        }
      }
    } finally {
      if (hadFsElementOwn && fsElementDescBefore) {
        Object.defineProperty(document, 'fullscreenElement', fsElementDescBefore);
      } else {
        delete (document as unknown as Record<string, unknown>).fullscreenElement;
      }
      if (hadExitFsOwn && exitFsDescBefore) {
        Object.defineProperty(document, 'exitFullscreen', exitFsDescBefore);
      } else {
        delete (document as unknown as Record<string, unknown>).exitFullscreen;
      }
    }
  });
});
