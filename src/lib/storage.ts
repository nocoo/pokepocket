import { openDB, type DBSchema } from 'idb';
import { parseHeader, type Cartridge } from './cartridge';

export interface Snapshot {
  key: string;
  romId: string;
  slot: number;
  data: ArrayBuffer;
  thumbnail: string;
  updatedAt: number;
  coreVersion: string;
}

export interface BatterySave {
  romId: string;
  data: ArrayBuffer;
  updatedAt: number;
}

interface PocketDatabase extends DBSchema {
  cartridges: { key: string; value: Cartridge };
  snapshots: { key: string; value: Snapshot; indexes: { 'by-rom': string } };
  batteries: { key: string; value: BatterySave };
}

const database = () =>
  openDB<PocketDatabase>('poke-pocket', 1, {
    upgrade(db) {
      db.createObjectStore('cartridges', { keyPath: 'id' });
      const snapshots = db.createObjectStore('snapshots', { keyPath: 'key' });
      snapshots.createIndex('by-rom', 'romId');
      db.createObjectStore('batteries', { keyPath: 'romId' });
    },
  });

export const storage = {
  async listCartridges() {
    const db = await database();
    try {
      const cartridges = await db.getAll('cartridges');
      for (const cartridge of cartridges) {
        // Upgrade existing Emerald libraries without changing ROM ids or save keys.
        if (!cartridge.header.system) {
          cartridge.header = parseHeader(cartridge.data);
          await db.put('cartridges', cartridge);
        }
      }
      return cartridges.sort((a, b) => b.lastPlayed - a.lastPlayed);
    } finally {
      db.close();
    }
  },
  async putCartridge(cartridge: Cartridge) {
    const db = await database();
    try {
      await db.put('cartridges', cartridge);
    } finally {
      db.close();
    }
  },
  async recordPlayTime(id: string, seconds: number) {
    const db = await database();
    try {
      const tx = db.transaction('cartridges', 'readwrite');
      const settlePromise = tx.done.catch(() => {});
      try {
        const item = await tx.store.get(id);
        if (item)
          await tx.store.put({
            ...item,
            playTime: item.playTime + seconds,
            lastPlayed: Date.now(),
          });
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Already aborted or inactive
        }
        await settlePromise;
        throw error;
      }
    } finally {
      db.close();
    }
  },
  async getBattery(id: string) {
    const db = await database();
    try {
      return await db.get('batteries', id);
    } finally {
      db.close();
    }
  },
  async putBattery(save: BatterySave) {
    const db = await database();
    try {
      await db.put('batteries', save);
    } finally {
      db.close();
    }
  },
  async replaceBattery(save: BatterySave) {
    const db = await database();
    try {
      // Commit the import and invalidate its old automatic resume point together.
      // A tab closed immediately afterwards must not restore the old SRAM data.
      const tx = db.transaction(['batteries', 'snapshots'], 'readwrite');
      const settlePromise = tx.done.catch(() => {});
      try {
        await tx.objectStore('batteries').put(save);
        await tx.objectStore('snapshots').delete(`${save.romId}:0`);
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Transaction might already be inactive
        }
        await settlePromise;
        throw error;
      }
    } finally {
      db.close();
    }
  },
  async listSnapshots(id: string) {
    const db = await database();
    try {
      return await db.getAllFromIndex('snapshots', 'by-rom', id);
    } finally {
      db.close();
    }
  },
  async putSnapshot(snapshot: Snapshot) {
    const db = await database();
    try {
      await db.put('snapshots', snapshot);
    } finally {
      db.close();
    }
  },
  async deleteSnapshot(key: string) {
    const db = await database();
    try {
      await db.delete('snapshots', key);
    } finally {
      db.close();
    }
  },
};

export function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function download(data: BlobPart, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
