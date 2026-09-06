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

describe('App ROM picker lifecycle', () => {
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

  it('handles picker cancel from running game: pauses during picker, resumes exactly once on cancel, releases held input, and preserves storage and core bytes', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);
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

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    // Baseline storage, FS, and core calls
    const storedListBefore = await storage.listCartridges();
    expect(storedListBefore.length).toBe(1);
    const storedCartBefore = storedListBefore[0];
    expect(storedCartBefore).toBeDefined();
    if (!storedCartBefore) throw new Error('Missing stored cartridge');
    const originalStoredBytes = new Uint8Array(storedCartBefore.data);

    const originalCoreRomBytes = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');
    expect(originalCoreRomBytes).toBeDefined();

    // Spy on storage.putCartridge and clear core loadGame / resumeGame
    const putCartridgeSpy = vi.spyOn(storage, 'putCartridge');
    vi.mocked(harness.testCore.loadGame).mockClear();
    vi.mocked(harness.testCore.resumeGame).mockClear();

    // Hold input button and assert it reaches the core
    const upBtn = container.querySelector('.dpad-up');
    expect(upBtn).not.toBeNull();
    if (!upBtn) throw new Error('Missing dpad-up');

    fireEvent.pointerDown(upBtn, { pointerId: 1 });
    expect(harness.testCore.buttonPress).toHaveBeenCalledWith('Up');

    // Track input click
    let pickerClicked = false;
    const clickListener = () => {
      pickerClicked = true;
    };
    romInput.addEventListener('click', clickListener);

    // Open picker from series sidebar (switching to unavailable edition triggers openCartridgePicker)
    const fireredRow = container.querySelector('button[aria-label="选择宝可梦 火红"]');
    expect(fireredRow).not.toBeNull();
    if (!fireredRow) throw new Error('Missing firered row');

    await userEvent.click(fireredRow);

    // Assert actual input click occurred
    expect(pickerClicked).toBe(true);
    romInput.removeEventListener('click', clickListener);

    // Opening picker pauses the emulator and releases held input to the core
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(harness.testCore.buttonUnpress).toHaveBeenCalledWith('Up');

    // Trigger cancel on picker input
    fireEvent(romInput, new Event('cancel'));

    // Resumes running game exactly once
    await screen.findByText('正在冒险');
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(1);

    // Zero extra loadGame or putCartridge calls occurred
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);
    expect(putCartridgeSpy).not.toHaveBeenCalled();

    // Exact stored cartridge and core FS bytes preserved
    const storedListAfter = await storage.listCartridges();
    expect(storedListAfter.length).toBe(1);
    expect(new Uint8Array(storedListAfter[0]?.data ?? new ArrayBuffer(0))).toEqual(
      originalStoredBytes,
    );

    const currentCoreRomBytes = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');
    expect(new Uint8Array(currentCoreRomBytes)).toEqual(new Uint8Array(originalCoreRomBytes));

    // Canvas identity preserved
    expect(container.querySelector('canvas')).toBe(canvasBefore);
    putCartridgeSpy.mockRestore();
  });

  it('handles picker cancel from already-paused game: stays paused and preserves exact storage and core bytes without extra load or resume', async () => {
    const emeraldCart = createCartridge('stored-emerald');
    await storage.putCartridge(emeraldCart);
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

    // Pause the game explicitly via toolbar play toggle and settle
    const pauseToggle = screen.getByRole('button', { name: '暂停游戏' });
    await userEvent.click(pauseToggle);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    // Set baselines AFTER explicit pause has settled
    const storedListBefore = await storage.listCartridges();
    expect(storedListBefore.length).toBe(1);
    const originalStoredBytes = new Uint8Array(storedListBefore[0]?.data ?? new ArrayBuffer(0));

    const originalCoreRomBytes = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');

    const putCartridgeSpy = vi.spyOn(storage, 'putCartridge');
    vi.mocked(harness.testCore.loadGame).mockClear();
    vi.mocked(harness.testCore.resumeGame).mockClear();

    // Track input click
    let pickerClicked = false;
    const clickListener = () => {
      pickerClicked = true;
    };
    romInput.addEventListener('click', clickListener);

    // Open picker by selecting an unavailable edition from series sidebar
    const leafgreenRow = container.querySelector('button[aria-label="选择宝可梦 叶绿"]');
    expect(leafgreenRow).not.toBeNull();
    if (!leafgreenRow) throw new Error('Missing leafgreen row');
    await userEvent.click(leafgreenRow);

    expect(pickerClicked).toBe(true);
    romInput.removeEventListener('click', clickListener);

    // Trigger cancel on picker input
    fireEvent(romInput, new Event('cancel'));

    // Must stay paused; core resume was NOT called
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(0);
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(0);
    expect(putCartridgeSpy).not.toHaveBeenCalled();

    // Stored cartridge and core FS bytes preserved
    const storedListAfter = await storage.listCartridges();
    expect(storedListAfter.length).toBe(1);
    expect(new Uint8Array(storedListAfter[0]?.data ?? new ArrayBuffer(0))).toEqual(
      originalStoredBytes,
    );

    const currentCoreRomBytes = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');
    expect(new Uint8Array(currentCoreRomBytes)).toEqual(new Uint8Array(originalCoreRomBytes));

    // Canvas identity preserved
    expect(container.querySelector('canvas')).toBe(canvasBefore);
    putCartridgeSpy.mockRestore();
  });

  it('resets input value on selection, rejects invalid header preserving existing cartridge and core, then successfully retries same filename with valid ROM', async () => {
    const initialCart = createCartridge('stored-emerald');
    await storage.putCartridge(initialCart);
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

    // Start initial game
    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    const canvasElementBefore = container.querySelector('canvas');
    expect(canvasElementBefore).not.toBeNull();

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    // Record original stored and core bytes
    const originalStoredList = await storage.listCartridges();
    expect(originalStoredList.length).toBe(1);
    const originalStoredBytes = new Uint8Array(originalStoredList[0]?.data ?? new ArrayBuffer(0));
    const originalCoreRomBytes = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');

    // Listen in capture phase on romInput to verify nonempty value before React's onChange resets it
    let observedValueBeforeReset = '';
    const captureListener = (e: Event) => {
      observedValueBeforeReset = (e.target as HTMLInputElement).value;
    };
    romInput.addEventListener('change', captureListener, { capture: true });

    // 1. Upload invalid ROM file with filename "new-adventure.gba" (invalid header: truncated / unrecognized header)
    const invalidFile = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], 'new-adventure.gba');
    const loadGameCallsBefore = vi.mocked(harness.testCore.loadGame).mock.calls.length;

    await userEvent.upload(romInput, invalidFile);

    // Value was nonempty before reset, and reset to empty string after production handler runs
    expect(observedValueBeforeReset).toContain('new-adventure.gba');
    expect(romInput.value).toBe('');

    // Specific error alert notification shown
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/卡带文件不完整，无法读取文件头/)).toBeDefined();

    // Original stored cartridge and core bytes remain preserved; no new loadGame executed
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(loadGameCallsBefore);
    const storedListAfterFailure = await storage.listCartridges();
    expect(storedListAfterFailure.length).toBe(1);
    expect(storedListAfterFailure[0]?.id).toBe('stored-emerald');
    expect(new Uint8Array(storedListAfterFailure[0]?.data ?? new ArrayBuffer(0))).toEqual(
      originalStoredBytes,
    );

    const coreRomBytesAfterFailure = (
      harness.testCore.FS.readFile as unknown as (p: string) => Uint8Array
    )('/roms/stored-emerald.gba');
    expect(new Uint8Array(coreRomBytesAfterFailure)).toEqual(new Uint8Array(originalCoreRomBytes));

    // Usable controls: busy cleared, play toggle is enabled and functional
    const playToggle = screen.getByRole('button', { name: /暂停游戏|继续游戏/ });
    expect(playToggle.hasAttribute('disabled')).toBe(false);

    // 2. Retry upload with the EXACT SAME filename "new-adventure.gba" but valid ROM binary
    observedValueBeforeReset = '';
    const validRubyData = gbaFixture('AXVE');
    const validFile = new File([validRubyData], 'new-adventure.gba');

    // Reset loadGame mock calls baseline
    vi.mocked(harness.testCore.loadGame).mockClear();

    await userEvent.upload(romInput, validFile);

    // File input value was nonempty and reset again
    expect(observedValueBeforeReset).toContain('new-adventure.gba');
    expect(romInput.value).toBe('');

    // Advance RAFs for newly loaded game
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    // Check actual stored cartridge existence first, then assert exact bytes
    const storedListAfterSuccess = await storage.listCartridges();
    expect(storedListAfterSuccess.length).toBe(2);
    const newCart = storedListAfterSuccess.find((c) => c.fileName === 'new-adventure.gba');
    expect(newCart).toBeDefined();
    if (!newCart) throw new Error('Missing newCart in storage');
    expect(new Uint8Array(newCart.data)).toEqual(validRubyData);

    // Compute expected SHA-256 ID
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', validRubyData));
    const expectedId = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(newCart.id).toBe(expectedId);

    // Assert loadGame called with exact hashed paths /roms/<id>.gba and /saves/<id>.sav
    expect(harness.testCore.loadGame).toHaveBeenCalledWith(
      `/roms/${expectedId}.gba`,
      `/saves/${expectedId}.sav`,
    );

    // Assert virtual filesystem written ROM bytes unconditionally match validRubyData
    const writtenRom = (
      harness.testCore.FS.writeFile as unknown as { mock: { calls: [string, Uint8Array][] } }
    ).mock.calls.find((call) => call[0] === `/roms/${expectedId}.gba`);
    expect(writtenRom).toBeDefined();
    if (!writtenRom) throw new Error('Missing written ROM in core FS');
    expect(new Uint8Array(writtenRom[1])).toEqual(validRubyData);

    // Selected preference updated in localStorage
    expect(localStorage.getItem('pocket-last-cartridge')).toBe(expectedId);
    expect(localStorage.getItem('pocket-last-edition')).toBe('ruby');

    // Canvas identity preserved
    const canvasElementAfter = container.querySelector('canvas');
    expect(canvasElementAfter).toBe(canvasElementBefore);

    // Final status is running
    await screen.findByText('正在冒险');
    expect(container.querySelector('.stage-status')?.textContent).toContain('正在冒险');

    romInput.removeEventListener('change', captureListener, { capture: true });
  });

  it('handles File.arrayBuffer read rejection, preserves current game data, clears busy, and succeeds on valid retry', async () => {
    const initialCart = createCartridge('stored-emerald');
    await storage.putCartridge(initialCart);
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

    // Start initial game
    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    const originalStoredList = await storage.listCartridges();
    expect(originalStoredList.length).toBe(1);
    const originalStoredBytes = new Uint8Array(originalStoredList[0]?.data ?? new ArrayBuffer(0));

    // Inject File.arrayBuffer rejection on an unreadable file
    const unreadableFile = new File([new Uint8Array([1, 2, 3])], 'unreadable.gba');
    vi.spyOn(unreadableFile, 'arrayBuffer').mockRejectedValue(
      new Error('Disk read error / access denied'),
    );

    await userEvent.upload(romInput, unreadableFile);

    // Error alert notification shown with rejection message
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/Disk read error \/ access denied/)).toBeDefined();

    // Current game and data survive untouched
    const storedListAfterReadError = await storage.listCartridges();
    expect(storedListAfterReadError.length).toBe(1);
    expect(new Uint8Array(storedListAfterReadError[0]?.data ?? new ArrayBuffer(0))).toEqual(
      originalStoredBytes,
    );

    // Busy clears: toolbar buttons remain usable
    const playToggle = screen.getByRole('button', { name: /暂停游戏|继续游戏/ });
    expect(playToggle.hasAttribute('disabled')).toBe(false);

    // Valid retry through file input succeeds
    const validRubyData = gbaFixture('AXVE');
    const validFile = new File([validRubyData], 'retry-success.gba');

    await userEvent.upload(romInput, validFile);

    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    const storedListAfterRetry = await storage.listCartridges();
    expect(storedListAfterRetry.length).toBe(2);
    const retriedCart = storedListAfterRetry.find((c) => c.fileName === 'retry-success.gba');
    expect(retriedCart).toBeDefined();
    if (!retriedCart) throw new Error('Missing retried cartridge');
    expect(new Uint8Array(retriedCart.data)).toEqual(validRubyData);

    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', validRubyData));
    const expectedId = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(harness.testCore.loadGame).toHaveBeenCalledWith(
      `/roms/${expectedId}.gba`,
      `/saves/${expectedId}.sav`,
    );
  });

  it('rejects unsupported file extension (.txt), shows error, clears busy, preserves storage, and leaves actionable retry path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    const { container } = render(<App />);
    await screen.findByText('本地存储已就绪');

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    const user = userEvent.setup({ applyAccept: false });
    let observedValue = '';
    const captureListener = (e: Event) => {
      observedValue = (e.target as HTMLInputElement).value;
    };
    romInput.addEventListener('change', captureListener, { capture: true });

    const badExtFile = new File([new Uint8Array([1, 2, 3])], 'readme.txt');
    await user.upload(romInput, badExtFile);

    expect(observedValue).toContain('readme.txt');
    expect(romInput.value).toBe('');
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/请选择 \.gb、\.gbc 或 \.gba 卡带/)).toBeDefined();

    const storedList = await storage.listCartridges();
    expect(storedList.length).toBe(0);

    // Actionable path: upload valid ROM through the same input
    const validRubyData = gbaFixture('AXVE');
    const validFile = new File([validRubyData], 'recovery.gba');
    await userEvent.upload(romInput, validFile);

    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();

    const storedListAfterRecovery = await storage.listCartridges();
    expect(storedListAfterRecovery.length).toBe(1);
    expect(storedListAfterRecovery[0]?.fileName).toBe('recovery.gba');
    expect(new Uint8Array(storedListAfterRecovery[0]?.data ?? new ArrayBuffer(0))).toEqual(
      validRubyData,
    );

    romInput.removeEventListener('change', captureListener, { capture: true });
  });
});
