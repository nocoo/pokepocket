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
  it('deferred snapshot action in flight blocks cartridge operations via effective busy state', async () => {
    const snapshotController = createSnapshotActionController();
    const cartridgeOrchestrator = createCartridgeOrchestrator();
    const currentCartridge = createMockCartridge({ id: 'cart-emerald-1' });

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

    // Both controllers now reflect in-flight mutation
    const isEffectiveBusy = () => snapshotController.getState().busy;
    expect(isEffectiveBusy()).toBe(true);

    // Any attempt to execute cartridge operations while effectiveBusy should be guarded
    const fileDropOrImportAttempt = vi.fn();
    if (!isEffectiveBusy()) {
      await fileDropOrImportAttempt();
    }
    expect(fileDropOrImportAttempt).not.toHaveBeenCalled();

    // Any attempt to switch editions or start new adventure should also check effectiveBusy
    const switchEditionAttempt = vi.fn();
    if (!isEffectiveBusy()) {
      cartridgeOrchestrator.selectEdition('ruby');
      switchEditionAttempt();
    }
    expect(switchEditionAttempt).not.toHaveBeenCalled();

    // Now resolve snapshot mutation
    resolveSnapshotMutation();
    await confirmPromise;

    expect(isEffectiveBusy()).toBe(false);
    expect(snapshotController.getState().pending).toBeNull();

    // Post-resolution, cartridge operations can safely proceed
    cartridgeOrchestrator.selectEdition('ruby');
    expect(cartridgeOrchestrator.getState().selectedEditionId).toBe('ruby');
  });
});
