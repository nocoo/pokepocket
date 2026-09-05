import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import { describe, expect, it, vi } from 'vitest';
import {
  PocketEmulator,
  type EmulatorClock,
  type EmulatorStorageAdapter,
} from '../../src/lib/emulator';
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

function createFakeCore(): mGBAEmulator {
  const files = new Map<string, Uint8Array>();
  const callbacks: Record<string, () => void> = {};

  return {
    version: { projectName: 'mGBA', projectVersion: '2.5.1' },
    FSInit: vi.fn().mockResolvedValue(undefined),
    FSSync: vi.fn().mockResolvedValue(undefined),
    toggleInput: vi.fn(),
    setCoreSettings: vi.fn(),
    quitGame: vi.fn(),
    loadGame: vi.fn().mockReturnValue(true),
    pauseGame: vi.fn(),
    resumeGame: vi.fn(),
    quickReload: vi.fn(),
    buttonPress: vi.fn(),
    buttonUnpress: vi.fn(),
    setVolume: vi.fn(),
    setFastForwardMultiplier: vi.fn(),
    addCoreCallbacks: vi.fn().mockImplementation((cb) => Object.assign(callbacks, cb)),
    loadState: vi.fn().mockReturnValue(true),
    saveState: vi.fn().mockReturnValue(true),
    getSave: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4])),
    screenshot: vi.fn().mockReturnValue(true),
    filePaths: vi.fn().mockReturnValue({
      savePath: '/saves',
      saveStatePath: '/states',
      screenshotsPath: '/screenshots',
    }),
    FS: {
      mkdir: vi.fn(),
      writeFile: vi.fn().mockImplementation((p: string, data: Uint8Array) => files.set(p, data)),
      readFile: vi.fn().mockImplementation((p: string) => files.get(p) ?? new Uint8Array([0])),
      unlink: vi.fn().mockImplementation((p: string) => files.delete(p)),
      analyzePath: vi.fn().mockImplementation((p: string) => ({ exists: files.has(p) })),
    },
    SDL2: {
      audioContext: {
        state: 'suspended',
        resume: vi.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as mGBAEmulator;
}

function createStorageDouble(): EmulatorStorageAdapter {
  return {
    getBattery: vi.fn().mockResolvedValue(undefined),
    putBattery: vi.fn().mockResolvedValue(undefined),
    replaceBattery: vi.fn().mockResolvedValue(undefined),
    listSnapshots: vi.fn().mockResolvedValue([]),
    putSnapshot: vi.fn().mockResolvedValue(undefined),
    deleteSnapshot: vi.fn().mockResolvedValue(undefined),
    recordPlayTime: vi.fn().mockResolvedValue(undefined),
  };
}

function createClockDouble(): EmulatorClock {
  const currentTime = 1000;
  return {
    now: () => currentTime,
    setInterval: vi.fn().mockReturnValue(123 as unknown as ReturnType<typeof setInterval>),
    clearInterval: vi.fn(),
    requestAnimationFrame: (cb) => cb(),
  };
}

describe('PocketEmulator with injected dependencies', () => {
  it('instantiates with idle snapshot and respects isolated check', () => {
    const emulator = new PocketEmulator({
      checkCrossOriginIsolated: () => true,
    });
    expect(emulator.getSnapshot().status).toBe('idle');
  });

  it('rejects load when crossOriginIsolated check fails', async () => {
    const emulator = new PocketEmulator({
      checkCrossOriginIsolated: () => false,
    });
    const canvas = {} as HTMLCanvasElement;
    await expect(emulator.load(createCartridge(), canvas)).rejects.toThrow('共享内存');
    expect(emulator.getSnapshot().status).toBe('error');
  });

  it('loads cartridge successfully and transitions to running', async () => {
    const core = createFakeCore();
    const storage = createStorageDouble();
    const clock = createClockDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const canvas = {} as HTMLCanvasElement;
    const cart = createCartridge('emerald-test');
    await emulator.load(cart, canvas);

    const snapshot = emulator.getSnapshot();
    expect(snapshot.status).toBe('running');
    expect(snapshot.cartridge?.id).toBe('emerald-test');
    expect(storage.recordPlayTime).toHaveBeenCalledWith('emerald-test', 0);
    expect(core.loadGame).toHaveBeenCalled();
  });

  it('pauses and resumes cleanly', async () => {
    const core = createFakeCore();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge(), {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');

    emulator.pause();
    expect(core.pauseGame).toHaveBeenCalled();
    expect(emulator.getSnapshot().status).toBe('paused');

    emulator.resume();
    expect(core.resumeGame).toHaveBeenCalled();
    expect(emulator.getSnapshot().status).toBe('running');
  });

  it('handles reset by persisting and reloading the core', async () => {
    const core = createFakeCore();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge(), {} as HTMLCanvasElement);
    await emulator.reset();

    expect(core.quickReload).toHaveBeenCalled();
    expect(core.FSSync).toHaveBeenCalled();
  });

  it('cleans up previous game core on loading a new cartridge', async () => {
    const core = createFakeCore();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    const canvas = {} as HTMLCanvasElement;
    await emulator.load(createCartridge('cart-1'), canvas);
    await emulator.load(createCartridge('cart-2'), canvas);

    expect(core.quitGame).toHaveBeenCalled();
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-2');
  });

  it('retains accrued play time upon storage error and commits it on retry', async () => {
    const core = createFakeCore();
    let tickTimer: (() => void) | undefined;
    let clockTime = 1000;

    const clock: EmulatorClock = {
      now: () => clockTime,
      setInterval: (cb: () => void) => {
        tickTimer = cb;
        return 999 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: vi.fn(),
      requestAnimationFrame: (cb) => cb(),
    };

    const recordedSeconds: number[] = [];
    let throwStorage = true;
    const storage = createStorageDouble();
    storage.recordPlayTime = vi.fn().mockImplementation(async (_id: string, s: number) => {
      recordedSeconds.push(s);
      if (s > 0 && throwStorage) {
        throw new Error('storage error');
      }
    });

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    await emulator.load(createCartridge('cart-accrue'), {} as HTMLCanvasElement);

    // Simulate 7 seconds passing
    for (let i = 0; i < 7; i++) {
      clockTime += 1000;
      tickTimer?.();
    }

    // Persist fails due to storage error
    await expect(emulator.persist()).rejects.toThrow('storage error');

    // Simulate 3 more seconds passing while uncommitted time is retained
    for (let i = 0; i < 3; i++) {
      clockTime += 1000;
      tickTimer?.();
    }

    // Storage is recovered
    throwStorage = false;
    await emulator.persist();

    // 7 seconds from first attempt + 3 seconds from second attempt = 10 total seconds
    expect(recordedSeconds).toEqual([0, 7, 10]);
  });

  it('prevents battery import from quitting core if replaceBattery fails', async () => {
    const core = createFakeCore();
    const storage = createStorageDouble();
    storage.replaceBattery = vi.fn().mockRejectedValue(new Error('IndexedDB replace failed'));

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    const cart = createCartridge('cart-import-fail');
    await emulator.load(cart, {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');

    await expect(emulator.importBattery(new ArrayBuffer(16))).rejects.toThrow(
      'IndexedDB replace failed',
    );

    // Core must NOT have been quit, and snapshot status must remain running with cartridge
    expect(core.quitGame).not.toHaveBeenCalled();
    expect(emulator.getSnapshot().status).toBe('running');
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-import-fail');
  });

  it('serializes manual saveSlot and deleteSlot operations via queue', async () => {
    const core = createFakeCore();
    const storage = createStorageDouble();
    const sequence: string[] = [];

    storage.putSnapshot = vi.fn().mockImplementation(async () => {
      sequence.push('putSnapshot');
    });
    storage.deleteSnapshot = vi.fn().mockImplementation(async () => {
      sequence.push('deleteSnapshot');
    });

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    const cart = createCartridge('cart-queue');
    await emulator.load(cart, {} as HTMLCanvasElement);

    const savePromise = emulator.saveSlot(1);
    const deletePromise = emulator.deleteSlot({
      key: 'cart-queue:1',
      romId: 'cart-queue',
      slot: 1,
      data: new ArrayBuffer(4),
      thumbnail: '',
      updatedAt: 1000,
      coreVersion: '2.5.1',
    });

    await Promise.all([savePromise, deletePromise]);
    expect(sequence).toEqual(['putSnapshot', 'deleteSnapshot']);
  });

  it('rejects loadSlot if snapshot coreVersion does not match current core', async () => {
    const core = createFakeCore();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    const cart = createCartridge('cart-compat');
    await emulator.load(cart, {} as HTMLCanvasElement);

    const incompatibleSnapshot = {
      key: 'cart-compat:1',
      romId: 'cart-compat',
      slot: 1,
      data: new ArrayBuffer(4),
      thumbnail: '',
      updatedAt: 1000,
      coreVersion: '1.0.0', // Different version
    };

    await expect(emulator.loadSlot(incompatibleSnapshot)).rejects.toThrow('不同版本的模拟器');
  });
});
