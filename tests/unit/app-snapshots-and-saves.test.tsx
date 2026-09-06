// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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

  it('manages snapshot creation, replacement confirmation, cancellation without mutation, and load close', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

    // Open saves manager modal
    const savesNavBtn = screen.getByRole('button', { name: '我的存档' });
    await userEvent.click(savesNavBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();

    // In saves modal, find slot 1 blank save button within dialog
    const saveSlot1Btn = within(dialog).getByRole('button', { name: '保存到位置 1' });
    const slot1PutCallsBefore = (
      harness.fakeStorage.putSnapshot as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: unknown[]) => (c[0] as Snapshot | undefined)?.slot === 1).length;
    await userEvent.click(saveSlot1Btn);

    const slot1PutCallsAfter = (
      harness.fakeStorage.putSnapshot as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: unknown[]) => (c[0] as Snapshot | undefined)?.slot === 1).length;
    expect(slot1PutCallsAfter).toBe(slot1PutCallsBefore + 1);
    expect(harness.fakeStorage.putSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 1, romId: 'stored-emerald' }),
    );

    // Now slot 1 exists; clicking replace button opens confirmation modal
    const replaceBtn = within(dialog).getByRole('button', { name: '替换即时存档 1' });
    await userEvent.click(replaceBtn);

    // Dialog transitions to snapshot confirmation
    expect(
      await screen.findByRole('heading', { level: 2, name: '替换即时存档 01？' }),
    ).toBeDefined();

    // Cancelling snapshot confirmation returns to saves modal without extra mutations to slot 1
    const cancelBtn = screen.getByRole('button', { name: '取消' });
    await userEvent.click(cancelBtn);
    const slot1PutCallsFinal = (
      harness.fakeStorage.putSnapshot as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: unknown[]) => (c[0] as Snapshot | undefined)?.slot === 1).length;
    expect(slot1PutCallsFinal).toBe(slot1PutCallsAfter);

    // Returned to saves dialog
    const returnDialog = await screen.findByRole('dialog');
    expect(
      within(returnDialog).getByRole('heading', { level: 2, name: '把这一刻，好好收起来。' }),
    ).toBeDefined();

    // Load slot 1 from saves manager opens load confirmation
    const loadPreviewBtn = within(returnDialog).getByRole('button', { name: '读取即时存档 1' });
    await userEvent.click(loadPreviewBtn);

    const loadDialog = await screen.findByRole('dialog');
    expect(
      within(loadDialog).getByRole('heading', { level: 2, name: '读取即时存档 01？' }),
    ).toBeDefined();

    // Confirm load closes modal and resumes play view
    const confirmLoadBtn = within(loadDialog).getByRole('button', { name: '确认读取' });
    await userEvent.click(confirmLoadBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.testCore.loadState).toHaveBeenCalledWith(1);
  });

  it('manages auto-save slot 0 confirmation and delete confirmation with error retry', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    // Pre-seed manual slot 2 and automatic slot 0 before boot
    const snap0 = {
      key: 'stored-emerald:0',
      romId: 'stored-emerald',
      slot: 0,
      data: new Uint8Array([0, 0, 0, 0]).buffer,
      thumbnail: 'data:image/png;base64,auto-preview',
      updatedAt: 1700000000000,
      coreVersion: CORE_VERSION,
    };
    const snap2 = {
      key: 'stored-emerald:2',
      romId: 'stored-emerald',
      slot: 2,
      data: new Uint8Array([2, 2, 2, 2]).buffer,
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

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('IndexedDB blocked')).toBeDefined();

    // Retry delete succeeds
    await userEvent.click(confirmDeleteBtn);
    expect(harness.fakeStorage.deleteSnapshot).toHaveBeenCalledWith('stored-emerald:2');
  });

  it('handles battery save export downloading the exact sav filename and bytes', async () => {
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
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

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
    await userEvent.click(exportBtn);

    expect(clickSpy).toHaveBeenCalled();
    expect(downloadedName).toBe('stored-emerald.sav');

    // Unconditionally assert exact Blob bytes
    expect(downloadedBlob).toBeInstanceOf(Blob);
    const buffer = await (downloadedBlob as unknown as Blob).arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
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
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      downloadedBlob = blob as Blob;
      return 'blob:http://localhost/shot-uuid';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download;
    });

    const shotBtn = screen.getByRole('button', { name: '保存游戏截图' });
    await userEvent.click(shotBtn);

    const toastText = '1080p 截图已保存，这一刻留下了。';
    expect(await screen.findByText(toastText)).toBeDefined();

    // Verify Image source received data URL from emulator screenshot (exact iVBORw0KGgo base64 for PNG)
    expect(imageSrc).toBe('data:image/png;base64,iVBORw==');
    // Draw size: 240x160 scaled to 1080p height -> 1620 x 1080
    expect(drawWidth).toBe(1620);
    expect(drawHeight).toBe(1080);
    expect(imageSmoothing).toBe(false);
    expect(exportMimeType).toBe('image/png');

    expect(clickSpy).toHaveBeenCalled();
    expect(downloadedName).toMatch(/^pocket-.*\.png$/);
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect((downloadedBlob as unknown as Blob).type).toBe('image/png');
    const buf = await (downloadedBlob as unknown as Blob).arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(shotPayload);

    // Close toast manually and assert status element is removed
    const statusToast = screen.getByRole('status');
    expect(statusToast).toBeDefined();
    const closeToastBtn = within(statusToast).getByRole('button', { name: '关闭提示' });
    await userEvent.click(closeToastBtn);
    expect(screen.queryByText(toastText)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
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
    await userEvent.click(shotBtn);

    expect(await screen.findByText('Image decoding corrupted')).toBeDefined();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('handles battery export failure and displays error toast', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await startLoadedApp(emeraldCart);

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
  });
});
