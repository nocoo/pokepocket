import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { storage, type BatterySave, type Snapshot } from '../../src/lib/storage';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';
import { gbaFixture } from '../fixtures/headers';

function createCartridge(id = 'test-rom', overrides: Partial<Cartridge> = {}): Cartridge {
  const bytes = gbaFixture();
  return {
    id,
    fileName: `${id}.gba`,
    data: bytes.buffer,
    header: parseHeader(bytes.buffer),
    addedAt: 1000,
    lastPlayed: 2000,
    playTime: 120,
    ...overrides,
  };
}

describe('isolated storage transactions', () => {
  const originalGlobals = {
    indexedDB: globalThis.indexedDB,
    IDBCursor: globalThis.IDBCursor,
    IDBCursorWithValue: globalThis.IDBCursorWithValue,
    IDBDatabase: globalThis.IDBDatabase,
    IDBFactory: globalThis.IDBFactory,
    IDBIndex: globalThis.IDBIndex,
    IDBKeyRange: globalThis.IDBKeyRange,
    IDBObjectStore: globalThis.IDBObjectStore,
    IDBOpenDBRequest: globalThis.IDBOpenDBRequest,
    IDBRequest: globalThis.IDBRequest,
    IDBTransaction: globalThis.IDBTransaction,
    IDBVersionChangeEvent: globalThis.IDBVersionChangeEvent,
  };

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    globalThis.IDBCursor = IDBCursor;
    globalThis.IDBCursorWithValue = IDBCursorWithValue;
    globalThis.IDBDatabase = IDBDatabase;
    globalThis.IDBFactory = IDBFactory;
    globalThis.IDBIndex = IDBIndex;
    globalThis.IDBKeyRange = IDBKeyRange;
    globalThis.IDBObjectStore = IDBObjectStore;
    globalThis.IDBOpenDBRequest = IDBOpenDBRequest;
    globalThis.IDBRequest = IDBRequest;
    globalThis.IDBTransaction = IDBTransaction;
    globalThis.IDBVersionChangeEvent = IDBVersionChangeEvent;
  });

  afterEach(() => {
    Object.assign(globalThis, originalGlobals);
  });

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

  it('sorts cartridges by lastPlayed descending', async () => {
    const cart1 = createCartridge('cart-old', { lastPlayed: 100 });
    const cart2 = createCartridge('cart-recent', { lastPlayed: 500 });
    const cart3 = createCartridge('cart-mid', { lastPlayed: 300 });

    await storage.putCartridge(cart1);
    await storage.putCartridge(cart2);
    await storage.putCartridge(cart3);

    const list = await storage.listCartridges();
    expect(list.map((c) => c.id)).toEqual(['cart-recent', 'cart-mid', 'cart-old']);
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

  it('records play time and updates lastPlayed timestamp atomically with abort protection', async () => {
    const cart = createCartridge('cart-time');
    await storage.putCartridge(cart);

    await storage.recordPlayTime('cart-time', 25);
    const list = await storage.listCartridges();
    const updated = list.find((c) => c.id === 'cart-time');
    expect(updated?.playTime).toBe(145); // 120 + 25

    // Simulate async abort in transaction
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = originalPut.call(this, value, key);
      if (this.name === 'cartridges') {
        const tx = this.transaction;
        queueMicrotask(() => tx.abort());
      }
      return request;
    };

    let caughtError: unknown;
    try {
      await storage.recordPlayTime('cart-time', 10);
    } catch (err) {
      caughtError = err;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    expect(caughtError).toBeDefined();

    // Retry succeeds without unhandled rejections
    await storage.recordPlayTime('cart-time', 10);
    const afterRetry = (await storage.listCartridges()).find((c) => c.id === 'cart-time');
    expect(afterRetry?.playTime).toBe(155);
  });

  it('skips play time update when the cartridge is missing', async () => {
    await storage.recordPlayTime('missing-cart', 10);
    expect(await storage.listCartridges()).toEqual([]);
  });

  it('handles database open failure gracefully', async () => {
    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = () => {
      throw new DOMException('Blocked open', 'UnknownError');
    };

    try {
      await expect(storage.listCartridges()).rejects.toThrow('Blocked open');
    } finally {
      IDBFactory.prototype.open = originalOpen;
    }
  });

  it('handles replaceBattery failure followed by successful retry, preserving other ROMs and manual slots', async () => {
    const targetRom = 'target-rom';
    const otherRom = 'other-rom';

    // Seed target ROM battery, auto snapshot, and manual snapshot
    await storage.putBattery({
      romId: targetRom,
      data: new Uint8Array([1, 1, 1]).buffer,
      updatedAt: 100,
    });
    await storage.putSnapshot({
      key: `${targetRom}:0`,
      romId: targetRom,
      slot: 0,
      data: new Uint8Array([0, 0, 0]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });
    await storage.putSnapshot({
      key: `${targetRom}:1`,
      romId: targetRom,
      slot: 1,
      data: new Uint8Array([7, 7, 7]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });

    // Seed other ROM battery, auto snapshot, and manual snapshot
    await storage.putBattery({
      romId: otherRom,
      data: new Uint8Array([5, 5, 5]).buffer,
      updatedAt: 100,
    });
    await storage.putSnapshot({
      key: `${otherRom}:0`,
      romId: otherRom,
      slot: 0,
      data: new Uint8Array([5, 0, 0]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });
    await storage.putSnapshot({
      key: `${otherRom}:1`,
      romId: otherRom,
      slot: 1,
      data: new Uint8Array([5, 1, 1]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });

    // 1. Failure phase: synchronous throw on snapshot delete
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'snapshots' && String(key).includes(`${targetRom}:0`)) {
        throw new DOMException('Simulated synchronous delete failure', 'UnknownError');
      }
      return originalDelete.call(this, key);
    };

    try {
      await expect(
        storage.replaceBattery({
          romId: targetRom,
          data: new Uint8Array([2, 2, 2]).buffer,
          updatedAt: 200,
        }),
      ).rejects.toThrow('Simulated synchronous delete failure');
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }

    // Target ROM battery and slot 0 must be intact after rollback
    const targetBatteryRollback = await storage.getBattery(targetRom);
    expect(targetBatteryRollback).toBeDefined();
    if (targetBatteryRollback) {
      expect(new Uint8Array(targetBatteryRollback.data)).toEqual(new Uint8Array([1, 1, 1]));
    }
    const targetSnapsRollback = await storage.listSnapshots(targetRom);
    expect(targetSnapsRollback).toHaveLength(2);

    // Other ROM must be completely untouched
    const otherBatteryRollback = await storage.getBattery(otherRom);
    expect(otherBatteryRollback).toBeDefined();
    if (otherBatteryRollback) {
      expect(new Uint8Array(otherBatteryRollback.data)).toEqual(new Uint8Array([5, 5, 5]));
    }
    const otherSnapsRollback = await storage.listSnapshots(otherRom);
    expect(otherSnapsRollback).toHaveLength(2);

    // 2. Retry phase on the exact same state without failure
    await storage.replaceBattery({
      romId: targetRom,
      data: new Uint8Array([2, 2, 2]).buffer,
      updatedAt: 200,
    });

    // Target ROM updated: battery is [2, 2, 2], slot 0 removed, manual slot 1 preserved
    const targetBatterySuccess = await storage.getBattery(targetRom);
    expect(targetBatterySuccess).toBeDefined();
    if (targetBatterySuccess) {
      expect(new Uint8Array(targetBatterySuccess.data)).toEqual(new Uint8Array([2, 2, 2]));
    }
    const targetSnapsSuccess = await storage.listSnapshots(targetRom);
    expect(targetSnapsSuccess).toHaveLength(1);
    expect(targetSnapsSuccess[0]?.slot).toBe(1);

    // Other ROM still completely intact
    const otherBatterySuccess = await storage.getBattery(otherRom);
    expect(otherBatterySuccess).toBeDefined();
    if (otherBatterySuccess) {
      expect(new Uint8Array(otherBatterySuccess.data)).toEqual(new Uint8Array([5, 5, 5]));
    }
    const otherSnapsSuccess = await storage.listSnapshots(otherRom);
    expect(otherSnapsSuccess).toHaveLength(2);
  });
});
