import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import { describe, expect, it, vi } from 'vitest';
import {
  PocketEmulator,
  type EmulatorClock,
  type EmulatorStorageAdapter,
} from '../../src/lib/emulator';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';
import type { Snapshot } from '../../src/lib/storage';
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

  it('restores timer and remains live/retryable after failed battery import', async () => {
    const core = createFakeCore();
    let tickTimer: (() => void) | undefined;
    const clock: EmulatorClock = {
      now: vi.fn().mockReturnValue(1000),
      setInterval: (cb: () => void) => {
        tickTimer = cb;
        return 555 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: vi.fn(),
      requestAnimationFrame: (cb) => cb(),
    };

    const storage = createStorageDouble();
    let failReplace = true;
    storage.replaceBattery = vi.fn().mockImplementation(async () => {
      if (failReplace) throw new Error('storage error');
    });

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const cart = createCartridge('cart-import-live');
    await emulator.load(cart, {} as HTMLCanvasElement);

    // Initial failed import
    await expect(emulator.importBattery(new ArrayBuffer(16))).rejects.toThrow('storage error');
    expect(emulator.getSnapshot().status).toBe('running');
    expect(tickTimer).toBeDefined();

    // Verify timer ticks continue to run without crashing
    tickTimer?.();
    expect(emulator.getSnapshot().seconds).toBe(cart.playTime + 1);

    // Retry import succeeds
    failReplace = false;
    await emulator.importBattery(new ArrayBuffer(16));
    expect(emulator.getSnapshot().status).toBe('running');
  });

  it('generation-bounds crash callback so older crash cannot fail a newer loaded cartridge', async () => {
    let capturedCallbacks: Record<string, () => void> = {};
    const core = createFakeCore();
    const mockAddCallbacks = vi.fn().mockImplementation((cb: Record<string, () => void>) => {
      capturedCallbacks = { ...cb };
    });
    core.addCoreCallbacks = mockAddCallbacks;

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-old'), {} as HTMLCanvasElement);
    const oldCallbacks = { ...capturedCallbacks };

    // Old core triggers crash callback
    oldCallbacks.coreCrashedCallback?.();

    // New cartridge is loaded immediately
    await emulator.load(createCartridge('cart-new'), {} as HTMLCanvasElement);

    // Allow any queued setTimeout(..., 0) from the old crash callback to execute
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Must remain running for cart-new, not transitioned to error
    expect(emulator.getSnapshot().status).toBe('running');
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-new');
  });

  it('cleans up created core when FSInit or later initialization fails', async () => {
    const quitMgbaSpy = vi.fn();
    const core = {
      ...createFakeCore(),
      FSInit: vi.fn().mockRejectedValue(new Error('FSInit failed')),
      quitMgba: quitMgbaSpy,
    };

    const emulator = new PocketEmulator({
      createCore: async () => core as unknown as mGBAEmulator,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await expect(
      emulator.load(createCartridge('cart-init-fail'), {} as HTMLCanvasElement),
    ).rejects.toThrow('FSInit failed');
    expect(quitMgbaSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves play time accrued before battery import across the import reload', async () => {
    const core = createFakeCore();
    let tickTimer: (() => void) | undefined;
    let clockTime = 1000;

    const clock: EmulatorClock = {
      now: () => clockTime,
      setInterval: (cb: () => void) => {
        tickTimer = cb;
        return 777 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: vi.fn(),
      requestAnimationFrame: (cb) => cb(),
    };

    const recordedPlayTimes: number[] = [];
    const storage = createStorageDouble();
    storage.recordPlayTime = vi.fn().mockImplementation(async (_id: string, s: number) => {
      recordedPlayTimes.push(s);
    });

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    await emulator.load(createCartridge('cart-import-time'), {} as HTMLCanvasElement);

    // Accrue 7 seconds of session time
    for (let i = 0; i < 7; i++) {
      clockTime += 1000;
      tickTimer?.();
    }

    // Import new battery save
    await emulator.importBattery(new ArrayBuffer(16));

    // Persist after import
    await emulator.persist();

    // 7 seconds accrued before import must be preserved and recorded, not reset to 0
    expect(recordedPlayTimes).toContain(7);
  });

  it('preserves already checkpointed visible play time during battery import from pause', async () => {
    const core = createFakeCore();
    let tickTimer: (() => void) | undefined;
    let clockTime = 1000;

    const clock: EmulatorClock = {
      now: () => clockTime,
      setInterval: (cb: () => void) => {
        tickTimer = cb;
        return 888 as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: vi.fn(),
      requestAnimationFrame: (cb) => cb(),
    };

    const storage = createStorageDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    await emulator.load(createCartridge('cart-paused-import'), {} as HTMLCanvasElement);
    for (let i = 0; i < 7; i++) {
      clockTime += 1000;
      tickTimer?.();
    }
    // Checkpoint persists session time and clears sessionSeconds
    await emulator.persist(true);
    emulator.pause();

    await emulator.importBattery(new ArrayBuffer(16));
    // Visible seconds must remain 127 (120 initial playTime + 7 checkpointed), not reset
    expect(emulator.getSnapshot().seconds).toBe(127);
  });

  it('serializes background save before cartridge switch without early replacement', async () => {
    let deferredFSSync: { promise: Promise<void>; resolve: () => void } | null = null;
    let enteredSync: () => void = () => {};
    const syncEntered = new Promise<void>((r) => {
      enteredSync = r;
    });

    const core = {
      ...createFakeCore(),
      FSSync: vi.fn().mockImplementation(async () => {
        if (deferredFSSync) {
          enteredSync();
          await deferredFSSync.promise;
        }
      }),
      quitGame: vi.fn(),
    } as unknown as mGBAEmulator;

    const storage = createStorageDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    const cartA = createCartridge('cart-a');
    const cartB = createCartridge('cart-b');
    const canvas = {} as HTMLCanvasElement;

    await emulator.load(cartA, canvas);
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-a');

    let resolveSync: () => void = () => {};
    deferredFSSync = {
      promise: new Promise<void>((r) => {
        resolveSync = r;
      }),
      resolve: () => resolveSync(),
    };

    const persistA = emulator.persist(true);
    await syncEntered;

    // While persistA is held in FSSync, putBattery for Cart A was called, but Cart B operations must not start
    const putBatteryCallsBefore = (storage.putBattery as ReturnType<typeof vi.fn>).mock.calls
      .length;

    const loadBPromise = emulator.load(cartB, canvas);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // While save/FSSync is held: no new putBattery calls, core has not quit Cart A, loaded Cart B, or changed snapshot
    expect((storage.putBattery as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      putBatteryCallsBefore,
    );
    expect(core.quitGame).not.toHaveBeenCalled();
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-a');

    deferredFSSync.resolve();
    deferredFSSync = null;
    await Promise.all([persistA, loadBPromise]);

    expect(core.quitGame).toHaveBeenCalledTimes(1);
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-b');
  });

  it('serializes background save before reset without early core reload', async () => {
    let deferredFSSync: { promise: Promise<void>; resolve: () => void } | null = null;
    let enteredSync: () => void = () => {};
    const syncEntered = new Promise<void>((r) => {
      enteredSync = r;
    });

    const core = {
      ...createFakeCore(),
      FSSync: vi.fn().mockImplementation(async () => {
        if (deferredFSSync) {
          enteredSync();
          await deferredFSSync.promise;
        }
      }),
      quickReload: vi.fn(),
    } as unknown as mGBAEmulator;

    const storage = createStorageDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-reset'), {} as HTMLCanvasElement);

    let resolveSync: () => void = () => {};
    deferredFSSync = {
      promise: new Promise<void>((r) => {
        resolveSync = r;
      }),
      resolve: () => resolveSync(),
    };

    const persistPromise = emulator.persist(true);
    await syncEntered;

    const putBatteryCallsBefore = (storage.putBattery as ReturnType<typeof vi.fn>).mock.calls
      .length;
    const resetPromise = emulator.reset();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // While background save is held: quickReload must not execute early, and no new reset persist call starts
    expect((storage.putBattery as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      putBatteryCallsBefore,
    );
    expect(core.quickReload).not.toHaveBeenCalled();

    deferredFSSync.resolve();
    deferredFSSync = null;
    await Promise.all([persistPromise, resetPromise]);

    expect(core.quickReload).toHaveBeenCalledTimes(1);
  });

  it('serializes background save before loadSlot without early state restore', async () => {
    let deferredFSSync: { promise: Promise<void>; resolve: () => void } | null = null;
    let enteredSync: () => void = () => {};
    const syncEntered = new Promise<void>((r) => {
      enteredSync = r;
    });

    const core = {
      ...createFakeCore(),
      FSSync: vi.fn().mockImplementation(async () => {
        if (deferredFSSync) {
          enteredSync();
          await deferredFSSync.promise;
        }
      }),
      loadState: vi.fn().mockReturnValue(true),
    } as unknown as mGBAEmulator;

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-slot'), {} as HTMLCanvasElement);

    let resolveSync: () => void = () => {};
    deferredFSSync = {
      promise: new Promise<void>((r) => {
        resolveSync = r;
      }),
      resolve: () => resolveSync(),
    };

    const persistPromise = emulator.persist(true);
    await syncEntered;

    const slotPromise = emulator.loadSlot({
      key: 'cart-slot:1',
      romId: 'cart-slot',
      slot: 1,
      data: new ArrayBuffer(8),
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // loadState must not be called while prior persist is in flight
    expect(core.loadState).not.toHaveBeenCalled();

    deferredFSSync.resolve();
    deferredFSSync = null;
    await Promise.all([persistPromise, slotPromise]);

    expect(core.loadState).toHaveBeenCalledTimes(1);
  });

  it('serializes exportBattery before cartridge switch retaining original ROM bytes', async () => {
    const files = new Map<string, Uint8Array>();
    const batteries = new Map<string, { romId: string; data: ArrayBuffer; updatedAt: number }>();

    let currentRomId = '';
    let currentSave = new Uint8Array([1, 1, 1, 1]);

    const core: mGBAEmulator = {
      version: { projectName: 'mGBA', projectVersion: '2.5.1' },
      FSInit: vi.fn().mockResolvedValue(undefined),
      FSSync: vi.fn().mockResolvedValue(undefined),
      toggleInput: vi.fn(),
      setCoreSettings: vi.fn(),
      quitGame: vi.fn().mockImplementation(() => {
        files.set(`/saves/${currentRomId}.sav`, currentSave.slice());
        currentRomId = '';
      }),
      loadGame: vi.fn().mockImplementation((path: string, savePath: string) => {
        const parts = path.split('/');
        const last = parts[parts.length - 1];
        currentRomId = (last ?? '').replace(/\.gba$/, '');
        currentSave = files.get(savePath)?.slice() ?? new Uint8Array([1, 1, 1, 1]);
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
      saveState: vi.fn().mockReturnValue(true),
      getSave: vi.fn().mockImplementation(() => (currentRomId ? currentSave.slice() : null)),
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
      SDL2: { audioContext: { state: 'suspended', resume: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as mGBAEmulator;

    let armGetBatteryGate = false;
    let enteredGetBattery: () => void = () => {};
    const getBatteryEntered = new Promise<void>((r) => {
      enteredGetBattery = r;
    });
    let resolveGetBattery: () => void = () => {};
    const deferredGetBattery = new Promise<void>((r) => {
      resolveGetBattery = r;
    });

    const storage: EmulatorStorageAdapter = {
      getBattery: vi.fn().mockImplementation(async (id: string) => {
        if (armGetBatteryGate && id === 'cart-b') {
          enteredGetBattery();
          await deferredGetBattery;
        }
        return batteries.get(id);
      }),
      putBattery: vi.fn().mockImplementation(async (val) => {
        batteries.set(val.romId, val);
      }),
      replaceBattery: vi.fn().mockImplementation(async (val) => {
        batteries.set(val.romId, val);
      }),
      listSnapshots: vi.fn().mockResolvedValue([]),
      putSnapshot: vi.fn().mockResolvedValue(undefined),
      deleteSnapshot: vi.fn().mockResolvedValue(undefined),
      recordPlayTime: vi.fn().mockResolvedValue(undefined),
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    const cartA = createCartridge('cart-a');
    const cartB = createCartridge('cart-b');
    const canvas = {} as HTMLCanvasElement;

    // Load Cart B initially
    await emulator.load(cartB, canvas);
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-b');

    // Update Cart B save data in core
    const bBytes = new Uint8Array([42, 42, 42, 42]);
    currentSave = bBytes.slice();

    // Arm gate only after initial load finishes
    armGetBatteryGate = true;

    const exportPromise = emulator.exportBattery();
    await getBatteryEntered;

    const switchBackToA = emulator.load(cartA, canvas);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Cart B export is in flight; Cart A switch must not replace snapshot early
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-b');

    resolveGetBattery();
    const exportedData = await exportPromise;
    expect(new Uint8Array(exportedData)).toEqual(bBytes);

    await switchBackToA;
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-a');
  });

  it('holds import replacement while autosave is queued and preserves imported bytes', async () => {
    const files = new Map<string, Uint8Array>();
    const batteries = new Map<string, { romId: string; data: ArrayBuffer; updatedAt: number }>();

    let currentRomId = '';
    let currentSave = new Uint8Array([1, 1, 1, 1]);

    const core: mGBAEmulator = {
      version: { projectName: 'mGBA', projectVersion: '2.5.1' },
      FSInit: vi.fn().mockResolvedValue(undefined),
      FSSync: vi.fn().mockResolvedValue(undefined),
      toggleInput: vi.fn(),
      setCoreSettings: vi.fn(),
      quitGame: vi.fn().mockImplementation(() => {
        files.set(`/saves/${currentRomId}.sav`, currentSave.slice());
        currentRomId = '';
      }),
      loadGame: vi.fn().mockImplementation((path: string, savePath: string) => {
        const parts = path.split('/');
        const last = parts[parts.length - 1];
        currentRomId = (last ?? '').replace(/\.gba$/, '');
        currentSave = files.get(savePath)?.slice() ?? new Uint8Array([1, 1, 1, 1]);
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
      saveState: vi.fn().mockReturnValue(true),
      getSave: vi.fn().mockImplementation(() => (currentRomId ? currentSave.slice() : null)),
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
      SDL2: { audioContext: { state: 'suspended', resume: vi.fn().mockResolvedValue(undefined) } },
    } as unknown as mGBAEmulator;

    let armReplaceGate = false;
    let enteredReplace: () => void = () => {};
    const replaceEntered = new Promise<void>((r) => {
      enteredReplace = r;
    });
    let resolveReplace: () => void = () => {};
    const deferredReplace = new Promise<void>((r) => {
      resolveReplace = r;
    });

    const storage: EmulatorStorageAdapter = {
      getBattery: vi.fn().mockImplementation(async (id: string) => batteries.get(id)),
      putBattery: vi.fn().mockImplementation(async (val) => {
        batteries.set(val.romId, val);
      }),
      replaceBattery: vi.fn().mockImplementation(async (val) => {
        if (armReplaceGate) {
          enteredReplace();
          await deferredReplace;
        }
        batteries.set(val.romId, val);
      }),
      listSnapshots: vi.fn().mockResolvedValue([]),
      putSnapshot: vi.fn().mockResolvedValue(undefined),
      deleteSnapshot: vi.fn().mockResolvedValue(undefined),
      recordPlayTime: vi.fn().mockResolvedValue(undefined),
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-import'), {} as HTMLCanvasElement);

    armReplaceGate = true;
    const importedBytes = new Uint8Array([99, 99, 99, 99]);
    const importPromise = emulator.importBattery(importedBytes.buffer);
    await replaceEntered;

    // While replacement is held inside replaceBattery, queue an autosave
    const autoSavePromise = emulator.persist(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert that while replaceBattery is deferred, autosave's putBattery has not run and core has not quit
    expect(storage.putBattery).not.toHaveBeenCalled();
    expect(core.quitGame).not.toHaveBeenCalled();

    resolveReplace();
    await Promise.all([importPromise, autoSavePromise]);

    const finalBattery = await storage.getBattery('cart-import');
    expect(finalBattery).toBeDefined();
    if (finalBattery) {
      expect(new Uint8Array(finalBattery.data)).toEqual(importedBytes);
    }
  });

  it('recovers queue after rejection and executes subsequent queued command successfully', async () => {
    const storage = createStorageDouble();
    const snapshots = new Map<string, Snapshot>();

    storage.putSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(async (val) => {
        snapshots.set(val.key, val);
      });
    storage.listSnapshots = vi
      .fn()
      .mockImplementation(async (id: string) =>
        [...snapshots.values()].filter((s) => s.romId === id),
      );

    const emulator = new PocketEmulator({
      createCore: async () => createFakeCore(),
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-recover'), {} as HTMLCanvasElement);

    const failedSave = emulator.saveSlot(1).catch((err) => err.message);
    const retrySave = emulator.saveSlot(1);

    const [errorMsg] = await Promise.all([failedSave, retrySave]);
    expect(errorMsg).toBe('disk full');

    const slotSnap = await storage.listSnapshots('cart-recover');
    expect(slotSnap.some((s) => s.slot === 1)).toBe(true);
  });

  it('handles button presses, volume, speed, audio resume and screenshot capture', async () => {
    const core = createFakeCore();
    const resumeAudioSpy = vi.fn().mockResolvedValue(undefined);
    core.SDL2 = {
      audio: {
        currentOutputBuffer: {} as AudioBuffer,
        scriptProcessorNode: {} as ScriptProcessorNode,
      },
      audioContext: {
        state: 'suspended',
        resume: resumeAudioSpy,
      } as unknown as AudioContext,
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    // Button before load should not throw or emit
    emulator.button('A', true);
    expect(core.buttonPress).not.toHaveBeenCalled();

    await emulator.load(createCartridge('cart-controls'), {} as HTMLCanvasElement);

    emulator.button('A', true);
    expect(core.buttonPress).toHaveBeenCalledWith('A');

    emulator.button('A', false);
    expect(core.buttonUnpress).toHaveBeenCalledWith('A');

    emulator.setVolume(0.8);
    expect(core.setVolume).toHaveBeenCalledWith(0.8);

    emulator.setSpeed(2);
    expect(core.setFastForwardMultiplier).toHaveBeenCalledWith(2);
    expect(emulator.getSnapshot().speed).toBe(2);

    emulator.resumeAudio();
    expect(resumeAudioSpy).toHaveBeenCalled();

    // Screenshot succeeds when game is running
    const shot = emulator.screenshot();
    expect(shot).toContain('data:image/png;base64,');
  });

  it('rejects screenshot when core or cartridge is missing, or screenshot fails', async () => {
    const emulator = new PocketEmulator();
    expect(() => emulator.screenshot()).toThrow('请先启动游戏');

    const core = createFakeCore();
    core.screenshot = vi.fn().mockReturnValue(false);

    const emuWithFailingShot = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emuWithFailingShot.load(createCartridge('cart-shot-fail'), {} as HTMLCanvasElement);
    expect(() => emuWithFailingShot.screenshot()).toThrow('截图失败');
  });

  it('rejects capture and saveSlot when saveState fails', async () => {
    const core = createFakeCore();
    core.saveState = vi.fn().mockReturnValue(false);

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-save-fail'), {} as HTMLCanvasElement);
    await expect(emulator.saveSlot(1)).rejects.toThrow('即时存档失败');
  });

  it('rejects loadSlot when core.loadState fails', async () => {
    const core = createFakeCore();
    core.loadState = vi.fn().mockReturnValue(false);

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-loadstate-fail'), {} as HTMLCanvasElement);
    await expect(
      emulator.loadSlot({
        key: 'cart-loadstate-fail:1',
        romId: 'cart-loadstate-fail',
        slot: 1,
        data: new ArrayBuffer(4),
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      }),
    ).rejects.toThrow('即时存档读取失败');
  });

  it('rejects deleteSlot for invalid slots or unowned cartridges', async () => {
    const core = createFakeCore();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-del'), {} as HTMLCanvasElement);

    // Slot 0 (automatic slot) cannot be deleted via deleteSlot
    await expect(
      emulator.deleteSlot({
        key: 'cart-del:0',
        romId: 'cart-del',
        slot: 0,
        data: new ArrayBuffer(4),
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      }),
    ).rejects.toThrow('只能清除手动即时存档');

    // Mismatched cartridge ID
    await expect(
      emulator.deleteSlot({
        key: 'cart-other:1',
        romId: 'cart-other',
        slot: 1,
        data: new ArrayBuffer(4),
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      }),
    ).rejects.toThrow('不属于当前卡带');
  });

  it('rejects exportBattery when no battery data exists', async () => {
    const core = createFakeCore();
    const storage = createStorageDouble();
    storage.getBattery = vi.fn().mockResolvedValue(undefined);

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-nobattery'), {} as HTMLCanvasElement);
    await expect(emulator.exportBattery()).rejects.toThrow('尚无游戏存档');
  });
});
