import { describe, expect, it, vi } from 'vitest';
import { createSnapshotActionController } from '../../src/lib/snapshot-action';
import { createCartridgeOrchestrator } from '../../src/lib/cartridge-orchestrator';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';
import type { Snapshot } from '../../src/lib/storage';

function fixtureGbaBytes(editionCode = 'BPEE') {
  const data = new Uint8Array(1024);
  data.set(new TextEncoder().encode('POKEMON EMER'), 0xa0);
  data.set(new TextEncoder().encode(`${editionCode}01`), 0xac);
  data[0xb2] = 0x96;
  let checksum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= data[i] ?? 0;
  data[0xbd] = (checksum - 0x19) & 0xff;
  data.set(new TextEncoder().encode('FLASH1M_V103\0SIIRTC_V001'), 0x100);
  return data;
}

function createMockCartridge(overrides: Partial<Cartridge> = {}): Cartridge {
  const bytes = fixtureGbaBytes();
  return {
    id: 'cart-emerald-1',
    fileName: 'pokeemerald.gba',
    data: bytes.buffer,
    header: parseHeader(bytes.buffer),
    addedAt: 1000,
    lastPlayed: 2000,
    playTime: 120,
    ...overrides,
  };
}

function createMockSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    key: 'emerald-slot-1',
    romId: 'cart-emerald-1',
    slot: 1,
    thumbnail: 'data:image/png;base64,mock',
    data: new ArrayBuffer(16),
    updatedAt: 1000,
    coreVersion: '2.5.1',
    ...overrides,
  };
}

describe('cross-controller orchestration & busy guard integration', () => {
  it('deferred snapshot action in flight blocks actual production cartridge commands without mutations', async () => {
    const snapshotController = createSnapshotActionController();
    const currentCartridge = createMockCartridge({ id: 'cart-emerald-1' });
    const loadSpy = vi.fn();
    const savePrefsSpy = vi.fn();

    const cartridgeOrchestrator = createCartridgeOrchestrator({
      isExternalBusy: () => snapshotController.getState().busy,
      emulator: {
        getSnapshot: () => ({ status: 'running', cartridge: currentCartridge }),
        load: loadSpy,
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
      },
      savePreferences: savePrefsSpy,
    });

    snapshotController.requestAction('replace', createMockSnapshot());

    let resolveSnapshotMutation: () => void = () => {};
    const mutationPromise = new Promise<void>((resolve) => {
      resolveSnapshotMutation = resolve;
    });

    // Start snapshot action confirmation (deferred / in-flight)
    const confirmPromise = snapshotController.confirmAction({
      getCurrentCartridgeId: () => currentCartridge.id,
      loadSlot: vi.fn(),
      saveSlot: () => mutationPromise,
      deleteSlot: vi.fn(),
    });

    expect(snapshotController.getState().busy).toBe(true);

    // Call production commands directly; they must reject synchronously or return false before any mutation
    const selectResult = await cartridgeOrchestrator.selectEdition('sapphire');
    expect(selectResult).toBe(false);
    expect(cartridgeOrchestrator.getState().selectedEditionId).not.toBe('sapphire');
    expect(savePrefsSpy).not.toHaveBeenCalled();

    const startResult = await cartridgeOrchestrator.startAdventure();
    expect(startResult).toBe(false);

    const switchResult = await cartridgeOrchestrator.selectCartridge(
      createMockCartridge({ id: 'cart-ruby' }),
    );
    expect(switchResult).toBe(false);
    expect(loadSpy).not.toHaveBeenCalled();

    const returnResult = await cartridgeOrchestrator.returnToGallery();
    expect(returnResult).toBe(false);

    // Release deferred snapshot mutation
    resolveSnapshotMutation();
    await confirmPromise;

    expect(snapshotController.getState().busy).toBe(false);

    // Now production commands can proceed normally
    const postResult = await cartridgeOrchestrator.selectEdition('sapphire');
    expect(postResult).toBe(true);
    expect(cartridgeOrchestrator.getState().selectedEditionId).toBe('sapphire');
  });

  it('in-flight cartridge command blocks snapshot confirmation via isExternalBusy', async () => {
    const snapshotController = createSnapshotActionController();
    const currentCartridge = createMockCartridge({ id: 'cart-emerald-1' });

    let resolveCartridgeLoad: () => void = () => {};
    const loadPromise = new Promise<void>((resolve) => {
      resolveCartridgeLoad = resolve;
    });

    const cartridgeOrchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: async () => [currentCartridge],
        putCartridge: vi.fn(),
      },
      emulator: {
        getSnapshot: () => ({ status: 'idle', cartridge: null }),
        load: () => loadPromise,
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
      },
      getCanvas: () => ({ focus: vi.fn() }) as unknown as HTMLCanvasElement,
    });

    await cartridgeOrchestrator.initialize({
      loadPreferences: () => ({ lastCartridgeId: 'cart-emerald-1', lastEditionId: 'emerald' }),
    });

    // Start cartridge operation (in-flight deferred load)
    const startPromise = cartridgeOrchestrator.startAdventure();
    expect(cartridgeOrchestrator.getState().busy).toBe(true);

    // Snapshot confirmation attempted while cartridge is busy
    snapshotController.requestAction('replace', createMockSnapshot());
    const saveSlotSpy = vi.fn();
    const confirmResult = await snapshotController.confirmAction({
      getCurrentCartridgeId: () => currentCartridge.id,
      isExternalBusy: () => cartridgeOrchestrator.getState().busy,
      loadSlot: vi.fn(),
      saveSlot: saveSlotSpy,
      deleteSlot: vi.fn(),
    });

    // Confirmation must reject and not run saveSlot
    expect(confirmResult).toBe(false);
    expect(saveSlotSpy).not.toHaveBeenCalled();
    expect(snapshotController.getState().busy).toBe(false);
    expect(snapshotController.getState().pending).not.toBeNull();

    // Release cartridge load
    resolveCartridgeLoad();
    await startPromise;
    expect(cartridgeOrchestrator.getState().busy).toBe(false);

    // Now snapshot confirmation can succeed
    const retryResult = await snapshotController.confirmAction({
      getCurrentCartridgeId: () => currentCartridge.id,
      isExternalBusy: () => cartridgeOrchestrator.getState().busy,
      loadSlot: vi.fn(),
      saveSlot: saveSlotSpy,
      deleteSlot: vi.fn(),
    });
    expect(retryResult).toBe(true);
    expect(saveSlotSpy).toHaveBeenCalled();
  });
});
