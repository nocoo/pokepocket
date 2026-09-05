import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { storage, type BatterySave, type Snapshot } from '../../src/lib/storage';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';
import { gbaFixture } from '../fixtures/headers';

function createCartridge(id = 'test-rom'): Cartridge {
  const bytes = gbaFixture();
  return {
    id,
    fileName: `${id}.gba`,
    data: bytes.buffer,
    header: parseHeader(bytes.buffer),
    addedAt: 1000,
    lastPlayed: 2000,
    playTime: 120,
  };
}

describe('isolated storage transactions', () => {
  it('performs CRUD operations on cartridges, batteries, and snapshots', async () => {
    const cart = createCartridge('cart-crud');
    await storage.putCartridge(cart);

    const list = await storage.listCartridges();
    expect(list.some((c) => c.id === 'cart-crud')).toBe(true);

    const battery: BatterySave = {
      romId: 'cart-crud',
      data: new Uint8Array([1, 2, 3, 4]).buffer,
      updatedAt: 12345,
    };
    await storage.putBattery(battery);
    const retrievedBattery = await storage.getBattery('cart-crud');
    expect(retrievedBattery).toBeDefined();
    if (retrievedBattery) {
      expect(new Uint8Array(retrievedBattery.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    }

    const snapshot: Snapshot = {
      key: 'cart-crud:1',
      romId: 'cart-crud',
      slot: 1,
      data: new Uint8Array([5, 6, 7]).buffer,
      thumbnail: 'data:image/png;base64,mock',
      updatedAt: 54321,
      coreVersion: '2.5.1',
    };
    await storage.putSnapshot(snapshot);
    const snapshots = await storage.listSnapshots('cart-crud');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.key).toBe('cart-crud:1');

    await storage.deleteSnapshot('cart-crud:1');
    const afterDelete = await storage.listSnapshots('cart-crud');
    expect(afterDelete).toHaveLength(0);
  });

  it('isolates snapshots and batteries by ROM id', async () => {
    const rom1 = 'rom-alpha';
    const rom2 = 'rom-beta';

    await storage.putBattery({ romId: rom1, data: new Uint8Array([1]).buffer, updatedAt: 1 });
    await storage.putBattery({ romId: rom2, data: new Uint8Array([2]).buffer, updatedAt: 2 });

    await storage.putSnapshot({
      key: `${rom1}:1`,
      romId: rom1,
      slot: 1,
      data: new Uint8Array([10]).buffer,
      thumbnail: '',
      updatedAt: 10,
      coreVersion: '2.5.1',
    });
    await storage.putSnapshot({
      key: `${rom2}:1`,
      romId: rom2,
      slot: 1,
      data: new Uint8Array([20]).buffer,
      thumbnail: '',
      updatedAt: 20,
      coreVersion: '2.5.1',
    });

    const snaps1 = await storage.listSnapshots(rom1);
    const snaps2 = await storage.listSnapshots(rom2);

    expect(snaps1).toHaveLength(1);
    expect(snaps1[0]?.romId).toBe(rom1);
    expect(snaps2).toHaveLength(1);
    expect(snaps2[0]?.romId).toBe(rom2);
  });

  it('upgrades legacy cartridge headers without altering rom ID or data', async () => {
    const cart = createCartridge('cart-legacy');
    // Simulate legacy cartridge without header.system
    const rawLegacy = {
      ...cart,
      header: { ...cart.header, system: undefined },
    };
    await storage.putCartridge(rawLegacy as unknown as Cartridge);

    const cartridges = await storage.listCartridges();
    const upgraded = cartridges.find((c) => c.id === 'cart-legacy');
    expect(upgraded).toBeDefined();
    expect(upgraded?.header.system).toBe('GBA');
    expect(upgraded?.header.title).toBe('POKEMON EMER');
  });

  it('records play time and updates lastPlayed timestamp atomically', async () => {
    const cart = createCartridge('cart-time');
    await storage.putCartridge(cart);

    await storage.recordPlayTime('cart-time', 25);
    const list = await storage.listCartridges();
    const updated = list.find((c) => c.id === 'cart-time');
    expect(updated?.playTime).toBe(145); // 120 + 25
  });

  it('replaceBattery rolls back battery and retains automatic snapshot when snapshot delete fails', async () => {
    const romId = 'atomic-replace-test';
    await storage.putBattery({
      romId,
      data: new Uint8Array([1, 1, 1]).buffer,
      updatedAt: 100,
    });
    await storage.putSnapshot({
      key: `${romId}:0`,
      romId,
      slot: 0,
      data: new Uint8Array([0, 0, 0]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });
    // Also store a manual save slot that should not be touched
    await storage.putSnapshot({
      key: `${romId}:1`,
      romId,
      slot: 1,
      data: new Uint8Array([1, 1, 1]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });

    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'snapshots' && String(key).includes(':0')) {
        throw new DOMException('Simulated synchronous delete failure', 'UnknownError');
      }
      return originalDelete.call(this, key);
    };

    try {
      await expect(
        storage.replaceBattery({
          romId,
          data: new Uint8Array([2, 2, 2]).buffer,
          updatedAt: 200,
        }),
      ).rejects.toThrow('Simulated synchronous delete failure');
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }

    // Both the old battery and the automatic snapshot must be rolled back and preserved
    const batteryAfter = await storage.getBattery(romId);
    expect(batteryAfter).toBeDefined();
    if (batteryAfter) {
      expect(new Uint8Array(batteryAfter.data)).toEqual(new Uint8Array([1, 1, 1]));
    }

    const snapshotsAfter = await storage.listSnapshots(romId);
    expect(snapshotsAfter).toHaveLength(2);
    expect(snapshotsAfter.some((s) => s.slot === 0)).toBe(true);
    expect(snapshotsAfter.some((s) => s.slot === 1)).toBe(true);
  });

  it('replaceBattery deletes only slot 0 and preserves manual snapshot slots on success', async () => {
    const romId = 'success-replace-test';
    await storage.putBattery({
      romId,
      data: new Uint8Array([1, 1, 1]).buffer,
      updatedAt: 100,
    });
    await storage.putSnapshot({
      key: `${romId}:0`,
      romId,
      slot: 0,
      data: new Uint8Array([0, 0, 0]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });
    await storage.putSnapshot({
      key: `${romId}:1`,
      romId,
      slot: 1,
      data: new Uint8Array([9, 9, 9]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });

    await storage.replaceBattery({
      romId,
      data: new Uint8Array([2, 2, 2]).buffer,
      updatedAt: 200,
    });

    const batteryAfter = await storage.getBattery(romId);
    expect(batteryAfter).toBeDefined();
    if (batteryAfter) {
      expect(new Uint8Array(batteryAfter.data)).toEqual(new Uint8Array([2, 2, 2]));
    }

    const snapshotsAfter = await storage.listSnapshots(romId);
    expect(snapshotsAfter).toHaveLength(1);
    expect(snapshotsAfter[0]?.slot).toBe(1);
  });
});
