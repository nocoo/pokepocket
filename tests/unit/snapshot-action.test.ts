import { describe, expect, it, vi } from 'vitest';
import { createSnapshotActionController } from '../../src/lib/snapshot-action';
import type { Snapshot } from '../../src/lib/storage';

function createMockSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    key: 'emerald-slot-1',
    romId: 'rom-emerald-123',
    slot: 1,
    thumbnail: 'data:image/png;base64,mock',
    data: new ArrayBuffer(16),
    updatedAt: 1000,
    coreVersion: '2.5.1',
    ...overrides,
  };
}

describe('snapshot-action controller', () => {
  it('initializes with idle state', () => {
    const controller = createSnapshotActionController();
    expect(controller.getState()).toEqual({
      pending: null,
      busy: false,
      error: null,
    });
  });

  it('requests load, replace, and delete actions when active', () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot({ slot: 2 });

    const requested = controller.requestAction('load', snapshot, {
      returnTo: 'saves',
      active: true,
    });
    expect(requested).toBe(true);
    expect(controller.getState()).toEqual({
      pending: {
        action: 'load',
        snapshot,
        returnTo: 'saves',
      },
      busy: false,
      error: null,
    });
  });

  it('rejects action requests when inactive or busy', async () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot();

    const inactiveResult = controller.requestAction('load', snapshot, { active: false });
    expect(inactiveResult).toBe(false);
    expect(controller.getState().pending).toBeNull();

    controller.requestAction('replace', snapshot);
    let resolveSave: () => void = () => {};
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });

    const confirmPromise = controller.confirmAction({
      getCurrentCartridgeId: () => snapshot.romId,
      loadSlot: vi.fn(),
      saveSlot: () => savePromise,
      deleteSlot: vi.fn(),
    });

    expect(controller.getState().busy).toBe(true);
    const busyResult = controller.requestAction('delete', snapshot);
    expect(busyResult).toBe(false);

    resolveSave();
    await confirmPromise;
    expect(controller.getState().busy).toBe(false);
  });

  it('cancels pending action and clears errors without mutating slots', () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot();

    controller.requestAction('delete', snapshot);
    expect(controller.getState().pending).not.toBeNull();

    const cancelled = controller.cancelAction();
    expect(cancelled).toBe(true);
    expect(controller.getState()).toEqual({
      pending: null,
      busy: false,
      error: null,
    });
  });

  it('cannot cancel while busy executing a confirmation', async () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot();

    controller.requestAction('replace', snapshot);
    let resolveSave: () => void = () => {};
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });

    const confirmPromise = controller.confirmAction({
      getCurrentCartridgeId: () => snapshot.romId,
      loadSlot: vi.fn(),
      saveSlot: () => savePromise,
      deleteSlot: vi.fn(),
    });

    expect(controller.cancelAction()).toBe(false);
    expect(controller.getState().busy).toBe(true);
    expect(controller.getState().pending).not.toBeNull();

    resolveSave();
    await confirmPromise;
    expect(controller.getState().busy).toBe(false);
  });

  it('deduplicates concurrent confirm calls while busy', async () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot();
    const saveSlot = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));

    controller.requestAction('replace', snapshot);
    const firstCall = controller.confirmAction({
      getCurrentCartridgeId: () => snapshot.romId,
      loadSlot: vi.fn(),
      saveSlot,
      deleteSlot: vi.fn(),
    });
    const secondCall = controller.confirmAction({
      getCurrentCartridgeId: () => snapshot.romId,
      loadSlot: vi.fn(),
      saveSlot,
      deleteSlot: vi.fn(),
    });

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
    expect(firstResult).toBe(true);
    expect(secondResult).toBe(false);
    expect(saveSlot).toHaveBeenCalledTimes(1);
  });

  it('fails with clear error if cartridge switched before confirmation and allows retry after fix', async () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot({ romId: 'emerald-1' });

    controller.requestAction('load', snapshot);
    let currentRomId = 'ruby-2';

    const successSpy = vi.fn();
    const loadSlot = vi.fn();

    const firstSuccess = await controller.confirmAction({
      getCurrentCartridgeId: () => currentRomId,
      loadSlot,
      saveSlot: vi.fn(),
      deleteSlot: vi.fn(),
      onSuccess: successSpy,
    });

    expect(firstSuccess).toBe(false);
    expect(controller.getState().error).toBe('当前卡带已切换，请重新选择即时存档。');
    expect(controller.getState().pending).not.toBeNull();
    expect(successSpy).not.toHaveBeenCalled();

    // Fix the condition (e.g. user or system aligns cartridge) and retry
    currentRomId = 'emerald-1';
    const retrySuccess = await controller.confirmAction({
      getCurrentCartridgeId: () => currentRomId,
      loadSlot,
      saveSlot: vi.fn(),
      deleteSlot: vi.fn(),
      onSuccess: successSpy,
    });

    expect(retrySuccess).toBe(true);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().pending).toBeNull();
    expect(loadSlot).toHaveBeenCalledWith(snapshot);
    expect(successSpy).toHaveBeenCalledWith({
      action: 'load',
      snapshot,
      returnTo: null,
    });
  });

  it('handles handler exceptions during confirm and remains retryable', async () => {
    const controller = createSnapshotActionController();
    const snapshot = createMockSnapshot({ slot: 3 });

    controller.requestAction('delete', snapshot, { returnTo: 'saves' });
    const deleteSlot = vi
      .fn()
      .mockRejectedValueOnce(new Error('IndexedDB storage blocked'))
      .mockResolvedValueOnce(undefined);

    const firstResult = await controller.confirmAction({
      getCurrentCartridgeId: () => snapshot.romId,
      loadSlot: vi.fn(),
      saveSlot: vi.fn(),
      deleteSlot,
    });

    expect(firstResult).toBe(false);
    expect(controller.getState().error).toBe('IndexedDB storage blocked');
    expect(controller.getState().busy).toBe(false);
    expect(controller.getState().pending).not.toBeNull();

    // Retry succeeds
    const retryResult = await controller.confirmAction({
      getCurrentCartridgeId: () => snapshot.romId,
      loadSlot: vi.fn(),
      saveSlot: vi.fn(),
      deleteSlot,
    });

    expect(retryResult).toBe(true);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().pending).toBeNull();
    expect(deleteSlot).toHaveBeenCalledTimes(2);
  });
});
