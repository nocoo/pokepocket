// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
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
import { storage, type Snapshot } from '../../src/lib/storage';
import { CORE_VERSION, type EmulatorDependencies } from '../../src/lib/emulator';
import type { Cartridge } from '../../src/lib/cartridge';
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

describe('App snapshots, battery imports, export, and screenshot integration', () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

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
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function startLoadedApp(cart: Cartridge) {
    await storage.putCartridge(cart);

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

  it('manages manual slot creation and replacement with deferred busy, failure retry, and load execution', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    // Open saves manager modal
    const savesNavBtn = screen.getByRole('button', { name: '我的存档' });
    await userEvent.click(savesNavBtn);

    const savesDialog = await screen.findByRole('dialog');
    expect(
      within(savesDialog).getByRole('heading', { level: 2, name: '把这一刻，好好收起来。' }),
    ).toBeDefined();

    // 1. Creation on blank slot 1
    const initialSlot1Bytes = new Uint8Array([11, 22, 33, 44]);
    harness.testCore.saveState = vi.fn().mockImplementation((slot: number) => {
      (harness.testCore.FS.writeFile as unknown as (p: string, d: Uint8Array) => void)(
        `/states/stored-emerald.ss${slot}`,
        initialSlot1Bytes,
      );
      return true;
    });

    const saveSlot1Btn = within(savesDialog).getByRole('button', { name: '保存到位置 1' });
    await userEvent.click(saveSlot1Btn);

    // Initial creation succeeds and saves slot 1
    const storedAfterCreate = await harness.fakeStorage.listSnapshots('stored-emerald');
    const slot1Created = storedAfterCreate.find((s) => s.slot === 1);
    expect(slot1Created).toBeDefined();
    expect(new Uint8Array(slot1Created?.data ?? new ArrayBuffer(0))).toEqual(initialSlot1Bytes);

    // 2. Click replace on slot 1 -> opens confirmation modal
    const replaceBtn = within(savesDialog).getByRole('button', { name: '替换即时存档 1' });
    const slot1PutCallsBefore = (
      harness.fakeStorage.putSnapshot as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: unknown[]) => (c[0] as Snapshot | undefined)?.slot === 1).length;
    await userEvent.click(replaceBtn);

    const confirmDialog = await screen.findByRole('dialog');
    expect(
      within(confirmDialog).getByRole('heading', { level: 2, name: '替换即时存档 01？' }),
    ).toBeDefined();

    // Cancel first -> original bytes remain completely untouched and zero extra writes
    const cancelConfirmBtn = within(confirmDialog).getByRole('button', { name: '取消' });
    await userEvent.click(cancelConfirmBtn);

    const slot1PutCallsAfterCancel = (
      harness.fakeStorage.putSnapshot as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: unknown[]) => (c[0] as Snapshot | undefined)?.slot === 1).length;
    expect(slot1PutCallsAfterCancel).toBe(slot1PutCallsBefore);

    const returnedSavesDialog = await screen.findByRole('dialog');
    expect(
      within(returnedSavesDialog).getByRole('heading', {
        level: 2,
        name: '把这一刻，好好收起来。',
      }),
    ).toBeDefined();
    const storedAfterCancel = await harness.fakeStorage.listSnapshots('stored-emerald');
    const slot1AfterCancel = storedAfterCancel.find((s) => s.slot === 1);
    expect(new Uint8Array(slot1AfterCancel?.data ?? new ArrayBuffer(0))).toEqual(initialSlot1Bytes);

    // 3. Test failed replacement write followed by successful retry
    const replaceBtn2 = within(returnedSavesDialog).getByRole('button', { name: '替换即时存档 1' });
    await userEvent.click(replaceBtn2);

    const confirmDialog2 = await screen.findByRole('dialog');
    const confirmBtn = within(confirmDialog2).getByRole('button', { name: '确认替换' });

    // Set new distinct replacement bytes
    const newReplacementBytes = new Uint8Array([88, 77, 66, 55]);
    harness.testCore.saveState = vi.fn().mockImplementation((slot: number) => {
      (harness.testCore.FS.writeFile as unknown as (p: string, d: Uint8Array) => void)(
        `/states/stored-emerald.ss${slot}`,
        newReplacementBytes,
      );
      return true;
    });

    // Defer the real storage write
    let rejectStoragePut: ((err: Error) => void) | null = null;
    let deferredPutPromise = new Promise<void>((_resolve, reject) => {
      rejectStoragePut = reject;
    });

    const origPutSnapshot = harness.fakeStorage.putSnapshot;
    let putAttempts = 0;
    harness.fakeStorage.putSnapshot = vi.fn().mockImplementation(async (snap: Snapshot) => {
      if (snap.slot === 1) {
        putAttempts++;
        await deferredPutPromise;
      }
      return origPutSnapshot(snap);
    });

    // Click confirm -> mutation is in-flight
    const loadGameCallsBefore = (harness.testCore.loadGame as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await userEvent.click(confirmBtn);

    // Advance event loop turn: dialog is busy, confirm button shows processing
    await new Promise((resolve) => setTimeout(resolve, 0));
    const processingBtn = within(confirmDialog2).getByRole('button', { name: '处理中…' });
    expect(processingBtn.hasAttribute('disabled')).toBe(true);
    expect(putAttempts).toBe(1);

    // Repeat confirm, cancel button click, Escape key, backdrop click, and return to gallery while busy are rejected
    await userEvent.click(processingBtn);
    const cancelBtnWhileBusy = within(confirmDialog2).getByRole('button', { name: '取消' });
    expect(cancelBtnWhileBusy.hasAttribute('disabled')).toBe(true);
    await userEvent.click(cancelBtnWhileBusy);

    // Attempt return to gallery while busy -> rejected, view remains play and dialog stays open
    const backBtnWhileBusy = screen.getByRole('button', { name: '返回卡带盘' });
    expect(backBtnWhileBusy.hasAttribute('disabled')).toBe(true);
    fireEvent.click(backBtnWhileBusy);

    const escapePrevented = !fireEvent.keyDown(confirmDialog2, { key: 'Escape', cancelable: true });
    expect(escapePrevented).toBe(true);
    fireEvent.click(confirmDialog2);
    expect(confirmDialog2.getAttribute('open')).not.toBeNull();

    // Advance event loop turn after rejected attempts
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both putAttempts and core loadGame calls remain unchanged while write is pending
    expect(putAttempts).toBe(1);
    expect((harness.testCore.loadGame as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      loadGameCallsBefore,
    );

    // Opening saves modal paused the game; play layout remains active and not hidden
    expect(screen.getByText('已暂停')).toBeDefined();
    const playLayout = document.querySelector('.app-layout');
    expect(playLayout?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('.pocket-app.view-play')).not.toBeNull();

    // Data in storage is STILL original bytes while mutation is in flight
    const snapshotsDuringBusy = await harness.fakeStorage.listSnapshots('stored-emerald');
    const slot1DuringBusy = snapshotsDuringBusy.find((s) => s.slot === 1);
    expect(new Uint8Array(slot1DuringBusy?.data ?? new ArrayBuffer(0))).toEqual(initialSlot1Bytes);

    // First attempt rejects with storage error
    const reject = rejectStoragePut as unknown as (err: Error) => void;
    reject(new Error('IndexedDB storage quota exceeded'));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('IndexedDB storage quota exceeded')).toBeDefined();

    // Original bytes retained after error
    const snapshotsAfterError = await harness.fakeStorage.listSnapshots('stored-emerald');
    const slot1AfterError = snapshotsAfterError.find((s) => s.slot === 1);
    expect(new Uint8Array(slot1AfterError?.data ?? new ArrayBuffer(0))).toEqual(initialSlot1Bytes);

    // Set up successful retry
    deferredPutPromise = Promise.resolve();
    await userEvent.click(confirmBtn);

    // Successful retry resolves, closes confirmation, and updates stored bytes
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2, name: '替换即时存档 01？' })).toBeNull(),
    );
    const postReplaceDialog = await screen.findByRole('dialog');
    expect(
      within(postReplaceDialog).getByRole('heading', { level: 2, name: '把这一刻，好好收起来。' }),
    ).toBeDefined();

    const snapshotsFinal = await harness.fakeStorage.listSnapshots('stored-emerald');
    const slot1Final = snapshotsFinal.find((s) => s.slot === 1);
    expect(new Uint8Array(slot1Final?.data ?? new ArrayBuffer(0))).toEqual(newReplacementBytes);
    expect(putAttempts).toBe(2);

    // 4. Load slot 1 from saves dialog -> verifies core path receives exact snapshot data
    (harness.testCore.FS.writeFile as ReturnType<typeof vi.fn>).mockClear();
    const loadPreviewBtn = within(postReplaceDialog).getByRole('button', {
      name: '读取即时存档 1',
    });
    await userEvent.click(loadPreviewBtn);

    const loadConfirmDialog = await screen.findByRole('dialog');
    expect(
      within(loadConfirmDialog).getByRole('heading', { level: 2, name: '读取即时存档 01？' }),
    ).toBeDefined();

    // Before confirming load: core loadState has not been called
    expect(harness.testCore.loadState).not.toHaveBeenCalledWith(1);
    expect(harness.testCore.FS.writeFile).not.toHaveBeenCalled();

    const confirmLoadBtn = within(loadConfirmDialog).getByRole('button', { name: '确认读取' });
    await userEvent.click(confirmLoadBtn);

    // Modal closes upon load completion
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.testCore.loadState).toHaveBeenCalledWith(1);
    expect(harness.testCore.FS.writeFile).toHaveBeenCalledWith(
      '/states/stored-emerald.ss1',
      newReplacementBytes,
    );
  });

  it('manages auto-save slot 0 confirmation and delete confirmation with error retry', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    // Pre-seed manual slot 2 and automatic slot 0 before boot
    const autoSlot0Bytes = new Uint8Array([100, 100, 100, 100]);
    const snap0 = {
      key: 'stored-emerald:0',
      romId: 'stored-emerald',
      slot: 0,
      data: autoSlot0Bytes.buffer,
      thumbnail: 'data:image/png;base64,auto-preview',
      updatedAt: 1700000000000,
      coreVersion: CORE_VERSION,
    };
    const slot2Bytes = new Uint8Array([2, 2, 2, 2]);
    const snap2 = {
      key: 'stored-emerald:2',
      romId: 'stored-emerald',
      slot: 2,
      data: slot2Bytes.buffer,
      thumbnail: 'data:image/png;base64,slot2-preview',
      updatedAt: 1700000020000,
      coreVersion: CORE_VERSION,
    };
    await harness.fakeStorage.putSnapshot(snap0);
    await harness.fakeStorage.putSnapshot(snap2);

    await startLoadedApp(emeraldCart);
    const bootLoadStateCalls = (harness.testCore.loadState as ReturnType<typeof vi.fn>).mock.calls
      .length;

    // 1. Confirm automatic resume point recovery from saves manager
    const savesNavBtn = screen.getByRole('button', { name: '我的存档' });
    await userEvent.click(savesNavBtn);
    const dialog = await screen.findByRole('dialog');

    const restoreAutoBtn = within(dialog).getByRole('button', { name: /恢复进度/ });
    await userEvent.click(restoreAutoBtn);

    const autoConfirmDialog = await screen.findByRole('dialog');
    expect(
      within(autoConfirmDialog).getByRole('heading', { level: 2, name: '读取自动存档？' }),
    ).toBeDefined();

    // Cancel auto load first -> no extra loadState call
    const cancelAutoBtn = within(autoConfirmDialog).getByRole('button', { name: '取消' });
    await userEvent.click(cancelAutoBtn);
    expect((harness.testCore.loadState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      bootLoadStateCalls,
    );

    // Open auto load confirm again and confirm -> exactly one confirmation loadState(0)
    const dialogReturned = await screen.findByRole('dialog');
    const restoreAutoBtn2 = within(dialogReturned).getByRole('button', { name: /恢复进度/ });
    await userEvent.click(restoreAutoBtn2);

    const autoConfirmDialog2 = await screen.findByRole('dialog');
    const confirmAutoBtn = within(autoConfirmDialog2).getByRole('button', { name: '确认读取' });
    await userEvent.click(confirmAutoBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect((harness.testCore.loadState as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      bootLoadStateCalls + 1,
    );
    expect(harness.testCore.loadState).toHaveBeenLastCalledWith(0);

    // 2. Open saves manager again to test manual slot 2 delete with error and retry
    await userEvent.click(savesNavBtn);
    const dialogSaves = await screen.findByRole('dialog');

    const deleteBtn = within(dialogSaves).getByRole('button', { name: '清除即时存档 2' });
    await userEvent.click(deleteBtn);

    const deleteConfirmDialog = await screen.findByRole('dialog');
    expect(
      within(deleteConfirmDialog).getByRole('heading', { level: 2, name: '清除即时存档 02？' }),
    ).toBeDefined();

    // Injected storage failure on delete
    vi.spyOn(harness.fakeStorage, 'deleteSnapshot').mockRejectedValueOnce(
      new Error('IndexedDB blocked'),
    );
    const confirmDeleteBtn = within(deleteConfirmDialog).getByRole('button', { name: '确认清除' });
    await userEvent.click(confirmDeleteBtn);

    // Shows error alert inside confirmation modal
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('IndexedDB blocked')).toBeDefined();

    // Original snapshot still exists with identical data after rejection
    const storedDuringError = await harness.fakeStorage.listSnapshots('stored-emerald');
    const slot2DuringError = storedDuringError.find((s) => s.slot === 2);
    expect(slot2DuringError).toBeDefined();
    expect(new Uint8Array(slot2DuringError?.data ?? new ArrayBuffer(0))).toEqual(slot2Bytes);

    // Retry delete succeeds and calls original delete implementation
    await userEvent.click(confirmDeleteBtn);
    expect(harness.fakeStorage.deleteSnapshot).toHaveBeenCalledWith('stored-emerald:2');
    expect((harness.fakeStorage.deleteSnapshot as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      2,
    );

    // Confirm dialog closes and returns to empty slot in saves manager
    const dialogAfterDelete = await screen.findByRole('dialog');
    expect(within(dialogAfterDelete).getByRole('button', { name: '保存到位置 2' })).toBeDefined();
    expect(within(dialogAfterDelete).queryByRole('button', { name: '清除即时存档 2' })).toBeNull();

    // Slot 2 is completely removed from storage
    const storedAfterSuccess = await harness.fakeStorage.listSnapshots('stored-emerald');
    expect(storedAfterSuccess.find((s) => s.slot === 2)).toBeUndefined();
  });

  it('handles battery save export downloading the exact sav filename and bytes with owned clock advancement', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    const savBytes = new Uint8Array([55, 66, 77, 88]);
    await harness.fakeStorage.putBattery({
      romId: 'stored-emerald',
      data: savBytes.buffer,
      updatedAt: Date.now(),
    });

    let downloadedName = '';
    let downloadedBlob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      downloadedBlob = blob as Blob;
      return 'blob:http://localhost/sav-uuid';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download;
    });

    // Open saves modal and click export battery button
    const savesNavBtn = screen.getByRole('button', { name: '我的存档' });
    await userEvent.click(savesNavBtn);
    const dialog = screen.getByRole('dialog');

    const exportBtn = within(dialog).getByRole('button', { name: '导出存档' });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.click(exportBtn);
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(clickSpy).toHaveBeenCalled();
      expect(downloadedName).toBe('stored-emerald.sav');

      // Unconditionally assert exact Blob bytes
      expect(downloadedBlob).toBeInstanceOf(Blob);
      const buffer = await (downloadedBlob as unknown as Blob).arrayBuffer();
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));

      // Advance 1000ms timer so download's URL.revokeObjectURL executes before restoring timers
      expect(revokeSpy).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/sav-uuid');
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates and confirms battery import from file input, or rejects invalid files', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const { container } = await startLoadedApp(emeraldCart);

    const saveInput = container.querySelector(
      'input[type="file"][accept=".sav"]',
    ) as HTMLInputElement;
    expect(saveInput).toBeDefined();

    // 1. Non-sav file rejected with toast
    const invalidFile = new File([new Uint8Array(100)], 'invalid.txt');
    fireEvent.change(saveInput, { target: { files: [invalidFile] } });
    expect(await screen.findByText('请选择 .sav 格式的游戏存档。')).toBeDefined();

    // 2. Valid 128KB sav file for GBA FLASH1M
    const validSavData = new Uint8Array(131072);
    validSavData.fill(9);
    const validFile = new File([validSavData], 'backup.sav');
    fireEvent.change(saveInput, { target: { files: [validFile] } });

    // Confirmation modal appears
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { level: 2, name: '从这份存档继续？' }),
    ).toBeDefined();
    expect(within(dialog).getByText('backup.sav')).toBeDefined();

    // Verify no import mutation occurs before confirmation
    expect(harness.fakeStorage.replaceBattery).not.toHaveBeenCalled();

    // Cancel import -> no mutation occurs
    const cancelImportBtn = within(dialog).getByRole('button', { name: '取消' });
    await userEvent.click(cancelImportBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.fakeStorage.replaceBattery).not.toHaveBeenCalled();

    // Reselect file and confirm
    fireEvent.change(saveInput, { target: { files: [validFile] } });
    const dialogToConfirm = await screen.findByRole('dialog');
    const importConfirmBtn = within(dialogToConfirm).getByRole('button', { name: '导入并启动' });
    const importPromise = userEvent.click(importConfirmBtn);

    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await importPromise;

    // Exactly one replaceBattery call with exact bytes
    expect(harness.fakeStorage.replaceBattery).toHaveBeenCalledTimes(1);
    const replaceCalls = (harness.fakeStorage.replaceBattery as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(replaceCalls.length).toBe(1);
    const callArgs = replaceCalls[0]?.[0];
    expect(callArgs.romId).toBe('stored-emerald');
    expect(new Uint8Array(callArgs.data)).toEqual(validSavData);
  });

  it('rejects battery save import when size does not match cartridge capacity', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    const { container } = await startLoadedApp(emeraldCart);

    const saveInput = container.querySelector(
      'input[type="file"][accept=".sav"]',
    ) as HTMLInputElement;

    // FLASH1M requires 128KB (131072); provide 32KB (32768)
    const wrongSizeData = new Uint8Array(32768);
    const wrongFile = new File([wrongSizeData], 'wrong.sav');
    fireEvent.change(saveInput, { target: { files: [wrongFile] } });

    expect(await screen.findByText(/这枚卡带需要/)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.fakeStorage.replaceBattery).not.toHaveBeenCalled();
  });

  it('handles screenshot capture success and download invocation with exact payload and toast dismissal/expiry', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    let imageSrc = '';
    class FakeImage {
      naturalWidth = 240;
      naturalHeight = 160;
      private _src = '';
      get src() {
        return this._src;
      }
      set src(val: string) {
        this._src = val;
        imageSrc = val;
      }
      async decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);

    let drawWidth = 0;
    let drawHeight = 0;
    let imageSmoothing = true;
    let exportMimeType = '';
    const shotPayload = new Uint8Array([111, 222, 233]);

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        const el = origCreateElement(tagName, options);
        if (tagName === 'canvas') {
          const canvasEl = el as HTMLCanvasElement;
          canvasEl.getContext = vi.fn().mockImplementation((contextId: string) => {
            if (contextId === '2d') {
              return {
                set imageSmoothingEnabled(val: boolean) {
                  imageSmoothing = val;
                },
                get imageSmoothingEnabled() {
                  return imageSmoothing;
                },
                drawImage: vi
                  .fn()
                  .mockImplementation(
                    (_img: CanvasImageSource, _sx: number, _sy: number, w: number, h: number) => {
                      drawWidth = w;
                      drawHeight = h;
                    },
                  ),
              } as unknown as CanvasRenderingContext2D;
            }
            return null;
          });
          canvasEl.toBlob = vi
            .fn()
            .mockImplementation((cb: (b: Blob | null) => void, type?: string) => {
              exportMimeType = type ?? '';
              cb(new Blob([shotPayload], { type: 'image/png' }));
            });
        }
        return el;
      },
    );

    let downloadedName = '';
    let downloadedBlob: Blob | null = null;
    let capturedHref = '';
    let anchorConnectedDuringClick = false;
    let anchorDisconnectedAfter = false;
    let capturedAnchor: HTMLAnchorElement | null = null;

    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      downloadedBlob = blob as Blob;
      return 'blob:http://localhost/shot-uuid';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      capturedAnchor = this;
      downloadedName = this.download;
      capturedHref = this.href;
      anchorConnectedDuringClick = this.isConnected;
      queueMicrotask(() => {
        anchorDisconnectedAfter = !this.isConnected;
      });
    });

    const shotBtn = screen.getByRole('button', { name: '保存游戏截图' });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.click(shotBtn);
        await vi.advanceTimersByTimeAsync(0);
      });

      const toastText = '1080p 截图已保存，这一刻留下了。';
      expect(screen.getByText(toastText)).toBeDefined();

      // Verify Image source received data URL from emulator screenshot (exact iVBORw0KGgo base64 for PNG)
      expect(imageSrc).toBe('data:image/png;base64,iVBORw==');
      expect(drawWidth).toBe(1620);
      expect(drawHeight).toBe(1080);
      expect(imageSmoothing).toBe(false);
      expect(exportMimeType).toBe('image/png');

      expect(clickSpy).toHaveBeenCalled();
      expect(downloadedName).toMatch(/^pocket-.*\.png$/);
      expect(capturedHref).toBe('blob:http://localhost/shot-uuid');
      expect(anchorConnectedDuringClick).toBe(true);
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(anchorDisconnectedAfter).toBe(true);
      expect(capturedAnchor ? (capturedAnchor as HTMLAnchorElement).isConnected : true).toBe(false);
      expect(downloadedBlob).toBeInstanceOf(Blob);
      expect((downloadedBlob as unknown as Blob).type).toBe('image/png');
      const buf = await (downloadedBlob as unknown as Blob).arrayBuffer();
      expect(new Uint8Array(buf)).toEqual(shotPayload);

      // Verify delayed URL revocation (1000ms delay in download function)
      expect(revokeSpy).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(999);
      });
      expect(revokeSpy).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/shot-uuid');

      // Verify toast auto-expiry (3800ms)
      expect(screen.getByText(toastText)).toBeDefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2799); // total 3799ms
      });
      expect(screen.getByText(toastText)).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1); // total 3800ms
      });
      expect(screen.queryByText(toastText)).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts download and displays error toast when screenshot decode fails', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    class FailingDecodeImage {
      naturalWidth = 240;
      naturalHeight = 160;
      src = '';
      async decode() {
        throw new Error('Image decoding corrupted');
      }
    }
    vi.stubGlobal('Image', FailingDecodeImage);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    const shotBtn = screen.getByRole('button', { name: '保存游戏截图' });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => {
        fireEvent.click(shotBtn);
        await vi.advanceTimersByTimeAsync(0);
      });

      const errorToast = screen.getByText('Image decoding corrupted');
      expect(errorToast).toBeDefined();
      expect(clickSpy).not.toHaveBeenCalled();

      // Error toast auto-expires after 7500ms
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7499);
      });
      expect(screen.getByText('Image decoding corrupted')).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.queryByText('Image decoding corrupted')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles battery export failure without download and displays error toast', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    // Make exportBattery reject
    vi.spyOn(harness.fakeStorage, 'getBattery').mockRejectedValueOnce(
      new Error('Disk read failure'),
    );

    const savesNavBtn = screen.getByRole('button', { name: '我的存档' });
    await userEvent.click(savesNavBtn);
    const dialog = screen.getByRole('dialog');

    const exportBtn = within(dialog).getByRole('button', { name: '导出存档' });
    await userEvent.click(exportBtn);

    expect(await screen.findByText('Disk read failure')).toBeDefined();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('handles screenshot capture rejection when core screenshot returns false without downloading and manually closes error toast', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    harness.testCore.screenshot = vi.fn().mockReturnValue(false);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    const shotBtn = screen.getByRole('button', { name: '保存游戏截图' });
    await userEvent.click(shotBtn);

    const errorMsg = '截图失败，请稍后重试。';
    expect(await screen.findByText(errorMsg)).toBeDefined();
    expect(clickSpy).not.toHaveBeenCalled();

    // Manually close error toast
    const alertToast = screen.getByRole('alert');
    expect(alertToast).toBeDefined();
    const closeToastBtn = within(alertToast).getByRole('button', { name: '关闭提示' });
    await userEvent.click(closeToastBtn);
    expect(screen.queryByText(errorMsg)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
