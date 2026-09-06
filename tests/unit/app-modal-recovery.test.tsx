// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
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

describe('App ordinary-modal pause ownership, checkpoint recovery, and library closure', () => {
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

  const testMatrix = [
    {
      modalName: 'help' as const,
      buttonName: '游玩指南',
      expectedHeading: '你好，训练家。',
    },
    {
      modalName: 'saves' as const,
      buttonName: '我的存档',
      expectedHeading: '把这一刻，好好收起来。',
    },
  ];

  for (const { modalName, buttonName, expectedHeading } of testMatrix) {
    for (const initialStatus of ['running', 'paused'] as const) {
      it(`manages ${modalName} modal ownership when initially ${initialStatus}: awaits auto-save checkpoint and restores/preserves state`, async () => {
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

        // Start adventure
        const startBtn = screen.getByRole('button', { name: '开始冒险' });
        const startPromise = userEvent.click(startBtn);
        await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
        harness.flushEmulatorRafs();
        await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
        harness.flushEmulatorRafs();
        await startPromise;

        await screen.findByText('正在冒险');

        if (initialStatus === 'paused') {
          const pauseToggle = screen.getByRole('button', { name: '暂停游戏' });
          await userEvent.click(pauseToggle);
          await screen.findByText('已暂停');
          // Settle the manual-pause checkpoint write
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
          });
        }

        const pauseCallsBaseline = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
        const resumeCallsBaseline = vi.mocked(harness.testCore.resumeGame).mock.calls.length;
        const putSnapshotCallsBaseline = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls
          .length;

        const originalPutSnapshot = vi
          .mocked(harness.fakeStorage.putSnapshot)
          .getMockImplementation();
        if (!originalPutSnapshot) throw new Error('Missing original putSnapshot implementation');

        let resolveOpeningCheckpoint: () => void = () => {};
        const openingCheckpointPromise = new Promise<void>((resolve) => {
          resolveOpeningCheckpoint = resolve;
        });

        vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
          const res = await originalPutSnapshot(snap);
          resolveOpeningCheckpoint();
          return res;
        });

        // Open modal
        const triggerBtn = screen.getByRole('button', { name: buttonName });
        await userEvent.click(triggerBtn);

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeDefined();
        expect(
          within(dialog).getByRole('heading', { level: 2, name: expectedHeading }),
        ).toBeDefined();

        // Checkpoint must be awaited unconditionally (persists whenever hasCartridge is true)
        await openingCheckpointPromise;
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });

        // Verify opening checkpoint invocation, exact identity, and slot 0 auto-save payload [1, 2, 3, 4]
        expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
          putSnapshotCallsBaseline + 1,
        );
        const autoSnaps = await harness.fakeStorage.listSnapshots('stored-emerald');
        const autoSnap = autoSnaps.find((s) => s.slot === 0);
        expect(autoSnap).toBeDefined();
        expect(autoSnap?.slot).toBe(0);
        expect(autoSnap?.romId).toBe('stored-emerald');
        expect(autoSnap?.key).toBe('stored-emerald:0');
        expect(new Uint8Array(autoSnap?.data ?? new ArrayBuffer(0))).toEqual(
          new Uint8Array([1, 2, 3, 4]),
        );

        // Verify stored battery bytes match the exact cartridge state
        const storedBattery = await harness.fakeStorage.getBattery('stored-emerald');
        expect(storedBattery).not.toBeNull();
        expect(storedBattery?.romId).toBe('stored-emerald');
        expect(new Uint8Array(storedBattery?.data ?? new ArrayBuffer(0))).toEqual(
          new Uint8Array([1, 2, 3, 4]),
        );

        // Core pause count increments if running, untouched if already paused
        if (initialStatus === 'running') {
          expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(
            pauseCallsBaseline + 1,
          );
        } else {
          expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline);
        }

        // Close modal
        const closeBtn = within(dialog).getByRole('button', { name: '关闭窗口' });
        await userEvent.click(closeBtn);

        expect(screen.queryByRole('dialog')).toBeNull();

        // Ownership outcome: restore running vs preserve paused
        if (initialStatus === 'running') {
          expect(screen.getByText('正在冒险')).toBeDefined();
          expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(
            resumeCallsBaseline + 1,
          );
        } else {
          expect(screen.getByText('已暂停')).toBeDefined();
          expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(
            resumeCallsBaseline,
          );
        }
      });
    }
  }

  it('handles opening-checkpoint rejection with visible toast, keeps modal usable, and recovers emulator queue on subsequent checkpoint', async () => {
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

    const startBtn = screen.getByRole('button', { name: '开始冒险' });
    const startPromise = userEvent.click(startBtn);
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await waitFor(() => expect(harness.emulatorRafQueue.length).toBeGreaterThanOrEqual(1));
    harness.flushEmulatorRafs();
    await startPromise;

    await screen.findByText('正在冒险');

    const originalPutSnapshot = vi.mocked(harness.fakeStorage.putSnapshot).getMockImplementation();
    if (!originalPutSnapshot) throw new Error('Missing original putSnapshot implementation');

    const pauseCallsBaseline = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
    const resumeCallsBaseline = vi.mocked(harness.testCore.resumeGame).mock.calls.length;
    const loadCallsBaseline = vi.mocked(harness.testCore.loadGame).mock.calls.length;
    const quitCallsBaseline = vi.mocked(harness.testCore.quitGame).mock.calls.length;
    const putSnapshotCallsBaseline = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;

    // Injected storage failure on opening checkpoint
    vi.mocked(harness.fakeStorage.putSnapshot).mockRejectedValueOnce(
      new Error('QuotaExceededError: Auto-save failed'),
    );

    const helpBtn = screen.getByRole('button', { name: '游玩指南' });
    await userEvent.click(helpBtn);

    // Visible error toast appears from emulator.persist(true).catch(notify)
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText(/QuotaExceededError: Auto-save failed/)).toBeDefined();

    // Opening attempt invoked putSnapshot once, which was rejected
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline + 1,
    );
    // Modal paused the running game: core pause count incremented exactly once
    expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline + 1);

    // No stored automatic snapshot exists after rejected checkpoint
    const snapsAfterRejection = await harness.fakeStorage.listSnapshots('stored-emerald');
    expect(snapsAfterRejection.find((s) => s.slot === 0)).toBeUndefined();

    // Modal is open, intact, and usable
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();
    expect(within(dialog).getByRole('heading', { level: 2, name: '你好，训练家。' })).toBeDefined();

    // Close modal -> resumes running game exactly once
    const closeBtn = within(dialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('正在冒险')).toBeDefined();
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(resumeCallsBaseline + 1);

    // Prove emulator queue recovery: subsequent modal opening performs exactly one new checkpoint
    let resolveSecondCheckpoint: () => void = () => {};
    const secondCheckpointPromise = new Promise<void>((resolve) => {
      resolveSecondCheckpoint = resolve;
    });

    vi.mocked(harness.fakeStorage.putSnapshot).mockImplementationOnce(async (snap) => {
      const res = await originalPutSnapshot(snap);
      resolveSecondCheckpoint();
      return res;
    });

    const settingsBtn = screen.getByRole('button', { name: '打开设置' });
    await userEvent.click(settingsBtn);

    const settingsDialog = await screen.findByRole('dialog');
    expect(settingsDialog).toBeDefined();

    await secondCheckpointPromise;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Exactly one new checkpoint invoked
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline + 2,
    );
    // Core pause incremented again for settings modal
    expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline + 2);

    // Auto-save checkpoint slot 0 is now successfully written into storage with exact payload [1, 2, 3, 4]
    const recoveredSnaps = await harness.fakeStorage.listSnapshots('stored-emerald');
    const recoveredSnap = recoveredSnaps.find((s) => s.slot === 0);
    expect(recoveredSnap).toBeDefined();
    expect(recoveredSnap?.slot).toBe(0);
    expect(recoveredSnap?.romId).toBe('stored-emerald');
    expect(recoveredSnap?.key).toBe('stored-emerald:0');
    expect(new Uint8Array(recoveredSnap?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // Stored battery bytes match exact state
    const batteryAfterSuccess = await harness.fakeStorage.getBattery('stored-emerald');
    expect(batteryAfterSuccess).not.toBeNull();
    expect(batteryAfterSuccess?.romId).toBe('stored-emerald');
    expect(new Uint8Array(batteryAfterSuccess?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // Original loadGame and quitGame counts remain untouched throughout
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(loadCallsBaseline);
    expect(vi.mocked(harness.testCore.quitGame).mock.calls.length).toBe(quitCallsBaseline);

    // Final close restores running intent with exact pause/resume totals
    const closeSettingsBtn = within(settingsDialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeSettingsBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('正在冒险')).toBeDefined();

    expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline + 2);
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(resumeCallsBaseline + 2);
  });

  it('closes modal in library view without cartridge, causing zero resume, persist, or load calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ editions: [] }),
      }),
    );

    render(<App />);
    await screen.findByText('本地存储已就绪');

    const resumeCallsBaseline = vi.mocked(harness.testCore.resumeGame).mock.calls.length;
    const pauseCallsBaseline = vi.mocked(harness.testCore.pauseGame).mock.calls.length;
    const loadCallsBaseline = vi.mocked(harness.testCore.loadGame).mock.calls.length;
    const putSnapshotCallsBaseline = vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length;
    const putBatteryCallsBaseline = vi.mocked(harness.fakeStorage.putBattery).mock.calls.length;

    // Open help modal from library view
    const helpBtn = screen.getByRole('button', { name: '游玩指南' });
    await userEvent.click(helpBtn);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();

    const closeBtn = within(dialog).getByRole('button', { name: '关闭窗口' });
    await userEvent.click(closeBtn);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Verify zero calls made to emulator resume, pause, load, or storage persistence
    expect(vi.mocked(harness.testCore.resumeGame).mock.calls.length).toBe(resumeCallsBaseline);
    expect(vi.mocked(harness.testCore.pauseGame).mock.calls.length).toBe(pauseCallsBaseline);
    expect(vi.mocked(harness.testCore.loadGame).mock.calls.length).toBe(loadCallsBaseline);
    expect(vi.mocked(harness.fakeStorage.putSnapshot).mock.calls.length).toBe(
      putSnapshotCallsBaseline,
    );
    expect(vi.mocked(harness.fakeStorage.putBattery).mock.calls.length).toBe(
      putBatteryCallsBaseline,
    );
  });
});
