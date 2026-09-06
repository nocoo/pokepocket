import { vi } from 'vitest';
import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import {
  CORE_VERSION,
  type EmulatorClock,
  type EmulatorStorageAdapter,
} from '../../src/lib/emulator';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';
import { gbaFixture } from '../fixtures/headers';
import type { BatterySave, Snapshot } from '../../src/lib/storage';

export interface TestAppHarness {
  testCore: mGBAEmulator;
  fakeStorage: EmulatorStorageAdapter;
  currentClock: EmulatorClock;
  activeIntervals: Set<ReturnType<typeof setInterval>>;
  emulatorRafQueue: Array<() => void>;
  windowRafMap: Map<number, FrameRequestCallback>;
  flushEmulatorRafs: () => void;
  flushWindowRafs: () => void;
  cleanup: () => void;
}

export function createCartridge(
  id = 'test-emerald',
  overrides: Partial<Cartridge> = {},
): Cartridge {
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

export function createTestAppHarness(): TestAppHarness {
  const files = new Map<string, Uint8Array>();
  let currentRomId = '';
  let currentSave = new Uint8Array([1, 2, 3, 4]);

  const testCore: mGBAEmulator = {
    version: { projectName: 'mGBA', projectVersion: CORE_VERSION },
    FSInit: vi.fn().mockResolvedValue(undefined),
    FSSync: vi.fn().mockResolvedValue(undefined),
    toggleInput: vi.fn(),
    setCoreSettings: vi.fn(),
    quitGame: vi.fn().mockImplementation(() => {
      if (currentRomId) {
        files.set(`/saves/${currentRomId}.sav`, currentSave.slice());
      }
      currentRomId = '';
    }),
    loadGame: vi.fn().mockImplementation((path: string, savePath: string) => {
      const parts = path.split('/');
      const last = parts[parts.length - 1];
      currentRomId = (last ?? '').replace(/\.(gba|gbc|gb)$/i, '');
      const existing = files.get(savePath);
      currentSave = existing ? existing.slice() : new Uint8Array([1, 2, 3, 4]);
      return true;
    }),
    pauseGame: vi.fn(),
    resumeGame: vi.fn(),
    quickReload: vi.fn(),
    buttonPress: vi.fn(),
    buttonUnpress: vi.fn(),
    setVolume: vi.fn(),
    setFastForwardMultiplier: vi.fn(),
    addCoreCallbacks: vi.fn(),
    loadState: vi.fn().mockReturnValue(true),
    saveState: vi.fn().mockImplementation((slot: number) => {
      if (!currentRomId) return false;
      files.set(`/states/${currentRomId}.ss${slot}`, currentSave.slice());
      return true;
    }),
    getSave: vi.fn().mockImplementation(() => (currentRomId ? currentSave.slice() : null)),
    screenshot: vi.fn().mockImplementation((filename: string) => {
      files.set(`/screenshots/${filename}`, new Uint8Array([137, 80, 78, 71]));
      return true;
    }),
    filePaths: vi.fn().mockReturnValue({
      savePath: '/saves',
      saveStatePath: '/states',
      screenshotsPath: '/screenshots',
    }),
    FS: {
      mkdir: vi.fn(),
      writeFile: vi.fn().mockImplementation((p: string, data: Uint8Array) => {
        files.set(p, new Uint8Array(data));
      }),
      readFile: vi.fn().mockImplementation((p: string) => {
        const value = files.get(p);
        if (!value) throw new Error(`File not found: ${p}`);
        return value.slice();
      }),
      unlink: vi.fn().mockImplementation((p: string) => {
        files.delete(p);
      }),
      analyzePath: vi.fn().mockImplementation((p: string) => ({ exists: files.has(p) })),
    },
    SDL2: {
      audio: {
        currentOutputBuffer: {} as AudioBuffer,
        scriptProcessorNode: {} as ScriptProcessorNode,
      },
      audioContext: {
        state: 'suspended',
        resume: vi.fn().mockResolvedValue(undefined),
      } as unknown as AudioContext,
    },
  } as unknown as mGBAEmulator;

  const batteries = new Map<string, BatterySave>();
  const snapshots = new Map<string, Snapshot>();
  const fakeStorage: EmulatorStorageAdapter = {
    getBattery: vi.fn().mockImplementation(async (id: string) => batteries.get(id)),
    putBattery: vi.fn().mockImplementation(async (save: BatterySave) => {
      batteries.set(save.romId, save);
    }),
    replaceBattery: vi.fn().mockImplementation(async (save: BatterySave) => {
      batteries.set(save.romId, save);
      snapshots.delete(`${save.romId}:0`);
    }),
    listSnapshots: vi.fn().mockImplementation(async (romId: string) => {
      return [...snapshots.values()].filter((s) => s.romId === romId);
    }),
    putSnapshot: vi.fn().mockImplementation(async (snap: Snapshot) => {
      snapshots.set(snap.key, snap);
    }),
    deleteSnapshot: vi.fn().mockImplementation(async (key: string) => {
      snapshots.delete(key);
    }),
    recordPlayTime: vi.fn().mockResolvedValue(undefined),
  };

  const activeIntervals = new Set<ReturnType<typeof setInterval>>();
  const emulatorRafQueue: Array<() => void> = [];
  const windowRafMap = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextRafId++;
    windowRafMap.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    windowRafMap.delete(id);
  });

  const currentClock: EmulatorClock = {
    now: () => Date.now(),
    setInterval: (cb, ms) => {
      const id = setInterval(cb, ms);
      activeIntervals.add(id);
      return id;
    },
    clearInterval: (id) => {
      clearInterval(id);
      activeIntervals.delete(id);
    },
    requestAnimationFrame: (cb) => {
      emulatorRafQueue.push(cb);
    },
  };

  const flushEmulatorRafs = () => {
    const rafs = emulatorRafQueue.splice(0);
    for (const cb of rafs) cb();
  };

  const flushWindowRafs = () => {
    const entries = Array.from(windowRafMap.entries());
    windowRafMap.clear();
    const now = performance.now();
    for (const [, cb] of entries) cb(now);
  };

  const cleanup = () => {
    for (const id of activeIntervals) clearInterval(id);
    activeIntervals.clear();
    emulatorRafQueue.length = 0;
    windowRafMap.clear();
  };

  return {
    testCore,
    fakeStorage,
    currentClock,
    activeIntervals,
    emulatorRafQueue,
    windowRafMap,
    flushEmulatorRafs,
    flushWindowRafs,
    cleanup,
  };
}
