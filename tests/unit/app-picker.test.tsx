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

  it('handles picker cancel from running game: pauses during picker, resumes exactly once on cancel, releases input, and leaves storage untouched', async () => {
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

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    // Baseline assertions
    const storedCountBefore = (await storage.listCartridges()).length;
    const coreResumeCallsBefore = vi.mocked(harness.testCore.resumeGame).mock.calls.length;

    // Simulate held input button
    const upBtn = container.querySelector('.dpad-up');
    if (upBtn) fireEvent.pointerDown(upBtn, { pointerId: 1 });

    // Open picker from series sidebar (switching to unavailable edition triggers openPicker)
    const fireredRow = container.querySelector('button[aria-label="选择宝可梦 火红"]');
    expect(fireredRow).not.toBeNull();
    if (!fireredRow) throw new Error('Missing firered row');

    await userEvent.click(fireredRow);

    // Opening picker pauses the emulator
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');

    // Trigger cancel on picker input
    fireEvent(romInput, new Event('cancel'));

    // Resumes running game exactly once
    await screen.findByText('正在冒险');
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(
      coreResumeCallsBefore + 1,
    );

    // Stored cartridges are untouched
    const storedCountAfter = (await storage.listCartridges()).length;
    expect(storedCountAfter).toBe(storedCountBefore);
  });

  it('handles picker cancel from already-paused game: stays paused and does not resume core', async () => {
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

    // Pause the game explicitly via toolbar play toggle
    const pauseToggle = screen.getByRole('button', { name: '暂停游戏' });
    await userEvent.click(pauseToggle);
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');

    const romInput = container.querySelector(
      'input[type="file"][accept*=".gba"]',
    ) as HTMLInputElement;
    expect(romInput).not.toBeNull();

    const coreResumeCallsBefore = vi.mocked(harness.testCore.resumeGame).mock.calls.length;

    // Open picker by selecting an unavailable edition from series sidebar
    const leafgreenRow = container.querySelector('button[aria-label="选择宝可梦 叶绿"]');
    expect(leafgreenRow).not.toBeNull();
    if (!leafgreenRow) throw new Error('Missing leafgreen row');
    await userEvent.click(leafgreenRow);

    // Trigger cancel on picker input
    fireEvent(romInput, new Event('cancel'));

    // Must stay paused; core resume was NOT called
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('.stage-status')?.textContent).toContain('已暂停');
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(coreResumeCallsBefore);
  });

  it('resets input value on selection, rejects invalid selection preserving existing cartridge and core, then successfully retries same filename with valid ROM', async () => {
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

    // 1. Upload invalid ROM file (invalid header/extension or corrupted data) with filename "new-adventure.gba"
    const invalidFile = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], 'new-adventure.gba');
    const loadGameCallsBefore = vi.mocked(harness.testCore.loadGame).mock.calls.length;

    fireEvent.change(romInput, { target: { files: [invalidFile] } });

    // File input value is immediately cleared/reset
    expect(romInput.value).toBe('');

    // Useful error notification shown
    expect(await screen.findByRole('alert')).toBeDefined();

    // Existing cartridge and core bytes remain preserved; no new loadGame executed
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(loadGameCallsBefore);
    const storedListAfterFailure = await storage.listCartridges();
    expect(storedListAfterFailure.length).toBe(1);
    expect(storedListAfterFailure[0]?.id).toBe('stored-emerald');

    // Busy cleared: return/play toggle is not disabled
    const playToggle = screen.getByRole('button', { name: /暂停游戏|继续游戏/ });
    expect(playToggle.hasAttribute('disabled')).toBe(false);

    // 2. Retry upload with the SAME filename "new-adventure.gba" but valid ROM binary
    const validRubyData = gbaFixture('AXVE');
    const validFile = new File([validRubyData], 'new-adventure.gba');

    // Reset loadGame mock calls baseline to assert exact new invocation
    vi.mocked(harness.testCore.loadGame).mockClear();

    fireEvent.change(romInput, { target: { files: [validFile] } });

    // File input value is cleared again
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
  });

  it('rejects unsupported file extension (.txt), shows error, and preserves storage', async () => {
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

    const badExtFile = new File([new Uint8Array([1, 2, 3])], 'readme.txt');
    fireEvent.change(romInput, { target: { files: [badExtFile] } });

    expect(romInput.value).toBe('');
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/请选择 \.gb、\.gbc 或 \.gba 卡带/)).toBeDefined();

    const storedList = await storage.listCartridges();
    expect(storedList.length).toBe(0);
  });
});
