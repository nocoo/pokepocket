import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import { describe, expect, it, vi } from 'vitest';
import {
  PocketEmulator,
  type EmulatorClock,
  type EmulatorStorageAdapter,
} from '../../src/lib/emulator';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';
import type { BatterySave, Snapshot } from '../../src/lib/storage';
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
    loadStateSlot: vi.fn().mockReturnValue(true),
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

  it('manages pauseGame/resumeGame lifecycle and ownership across loadSlot success and failures', async () => {
    const callOrder: string[] = [];
    let corePaused = false;
    const core = createFakeCore();
    core.pauseGame = vi.fn().mockImplementation(() => {
      callOrder.push('pauseGame');
      corePaused = true;
    });
    core.resumeGame = vi.fn().mockImplementation(() => {
      callOrder.push('resumeGame');
      corePaused = false;
    });
    core.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder.push(`loadStateSlot:${slot}:${flags}:paused=${corePaused}`);
      return true;
    });

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage: createStorageDouble(),
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-lifecycle'), {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 1. Successful loadSlot while running: pauses, restores with flag 61 observing core paused, resumes
    callOrder.length = 0;
    const snap1: Snapshot = {
      key: 'cart-lifecycle:1',
      romId: 'cart-lifecycle',
      slot: 1,
      data: new Uint8Array([1, 1, 1, 1]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    };
    await emulator.loadSlot(snap1);
    expect(callOrder).toEqual(['pauseGame', 'loadStateSlot:1:61:paused=true', 'resumeGame']);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 2. Successful loadSlot while paused:
    // restoreState keeps core paused during load and persist (resumeAfter=false),
    // and then internalLoadSlot's success logic calls this.resume()
    emulator.pause();
    expect(emulator.getSnapshot().status).toBe('paused');
    expect(corePaused).toBe(true);
    callOrder.length = 0;
    await emulator.loadSlot(snap1);
    expect(callOrder).toEqual(['pauseGame', 'loadStateSlot:1:61:paused=true', 'resumeGame']);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 3. Failed loadSlot returning false while paused:
    // restoreState has resumeAfter=false, so core stays paused on failure and does not resume
    emulator.pause();
    expect(emulator.getSnapshot().status).toBe('paused');
    expect(corePaused).toBe(true);
    core.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder.push(`loadStateSlot:${slot}:${flags}:paused=${corePaused}`);
      return false;
    });
    callOrder.length = 0;
    await expect(emulator.loadSlot(snap1)).rejects.toThrow('即时存档读取失败');
    expect(callOrder).toEqual(['pauseGame', 'loadStateSlot:1:61:paused=true']);
    expect(emulator.getSnapshot().status).toBe('paused');
    expect(corePaused).toBe(true);

    // Resume for failure tests while running
    emulator.resume();
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 4. Failed loadSlot returning false while running:
    // pauses, attempts loadStateSlot observing core paused, resumes in finally (resumeAfter=true), then throws
    core.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder.push(`loadStateSlot:${slot}:${flags}:paused=${corePaused}`);
      return false;
    });
    callOrder.length = 0;
    await expect(emulator.loadSlot(snap1)).rejects.toThrow('即时存档读取失败');
    expect(callOrder).toEqual(['pauseGame', 'loadStateSlot:1:61:paused=true', 'resumeGame']);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 5. Failed loadSlot throwing an exception: pauses, attempts loadStateSlot, resumes in finally, re-throws
    core.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder.push(`loadStateSlot:${slot}:${flags}:paused=${corePaused}`);
      throw new Error('low-level wasm trap');
    });
    callOrder.length = 0;
    await expect(emulator.loadSlot(snap1)).rejects.toThrow('low-level wasm trap');
    expect(callOrder).toEqual(['pauseGame', 'loadStateSlot:1:61:paused=true', 'resumeGame']);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 6. Retry settles cleanly after failure
    core.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder.push(`loadStateSlot:${slot}:${flags}:paused=${corePaused}`);
      return true;
    });
    callOrder.length = 0;
    await emulator.loadSlot(snap1);
    expect(callOrder).toEqual(['pauseGame', 'loadStateSlot:1:61:paused=true', 'resumeGame']);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);
  });

  it('keeps core and public state paused during pending persist of manual loadSlot and resumes only after release', async () => {
    let corePaused = false;
    const callOrder: string[] = [];

    let deferredBatteryPut: { promise: Promise<void>; resolve: () => void } | null = null;
    let enteredPut: () => void = () => {};
    const putEntered = new Promise<void>((r) => {
      enteredPut = r;
    });

    const core = createFakeCore();
    core.pauseGame = vi.fn().mockImplementation(() => {
      callOrder.push('pauseGame');
      corePaused = true;
    });
    core.resumeGame = vi.fn().mockImplementation(() => {
      callOrder.push('resumeGame');
      corePaused = false;
    });
    core.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder.push(`loadStateSlot:${slot}:${flags}:paused=${corePaused}`);
      return true;
    });

    const storage = createStorageDouble();
    storage.putBattery = vi.fn().mockImplementation(async (_save) => {
      callOrder.push('storage:putBattery');
      if (deferredBatteryPut) {
        enteredPut();
        await deferredBatteryPut.promise;
      }
    });

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-deferred-persist'), {} as HTMLCanvasElement);
    emulator.pause();
    expect(emulator.getSnapshot().status).toBe('paused');
    expect(corePaused).toBe(true);

    let resolvePut: () => void = () => {};
    deferredBatteryPut = {
      promise: new Promise<void>((r) => {
        resolvePut = r;
      }),
      resolve: () => resolvePut(),
    };

    let slotSettled = false;
    const snap: Snapshot = {
      key: 'cart-deferred-persist:1',
      romId: 'cart-deferred-persist',
      slot: 1,
      data: new Uint8Array([5, 6, 7, 8]).buffer,
      thumbnail: '',
      updatedAt: 200,
      coreVersion: '2.5.1',
    };

    const slotPromise = emulator.loadSlot(snap).then(() => {
      slotSettled = true;
    });

    try {
      await putEntered;

      // Persistence is in flight: loadStateSlot finished, but persist is NOT complete.
      // Crucial boundary: neither public state nor core may be resumed before persist completes!
      expect(slotSettled).toBe(false);
      expect(emulator.getSnapshot().status).toBe('paused');
      expect(corePaused).toBe(true);
      expect(callOrder).toEqual([
        'pauseGame', // initial load setup or pause
        'pauseGame', // restoreState pauseGame
        'loadStateSlot:1:61:paused=true',
        'storage:putBattery',
      ]);
      expect(callOrder).not.toContain('resumeGame');
    } finally {
      deferredBatteryPut.resolve();
      deferredBatteryPut = null;
      await slotPromise;
    }

    // Now persistence settled: slot settled, core and public state resumed
    expect(slotSettled).toBe(true);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);
    expect(callOrder[callOrder.length - 1]).toBe('resumeGame');
  });

  it('verifies failed manual restores perform no persistence mutation and retry settles cleanly', async () => {
    let corePaused = false;
    const core = createFakeCore();
    core.pauseGame = vi.fn().mockImplementation(() => {
      corePaused = true;
    });
    core.resumeGame = vi.fn().mockImplementation(() => {
      corePaused = false;
    });

    const storage = createStorageDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock: createClockDouble(),
    });

    await emulator.load(createCartridge('cart-no-mutation'), {} as HTMLCanvasElement);

    const putBatteryBaseline = vi.mocked(storage.putBattery).mock.calls.length;
    const fsSyncBaseline = vi.mocked(core.FSSync).mock.calls.length;
    const recordPlayTimeBaseline = vi.mocked(storage.recordPlayTime).mock.calls.length;

    const snap: Snapshot = {
      key: 'cart-no-mutation:1',
      romId: 'cart-no-mutation',
      slot: 1,
      data: new Uint8Array([11, 22, 33, 44]).buffer,
      thumbnail: '',
      updatedAt: 100,
      coreVersion: '2.5.1',
    };

    // 1. Core loadStateSlot returns false
    core.loadStateSlot = vi.fn().mockReturnValue(false);
    await expect(emulator.loadSlot(snap)).rejects.toThrow('即时存档读取失败');

    // No persistence mutation on false return
    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryBaseline);
    expect(vi.mocked(core.FSSync).mock.calls.length).toBe(fsSyncBaseline);
    expect(vi.mocked(storage.recordPlayTime).mock.calls.length).toBe(recordPlayTimeBaseline);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 2. Core loadStateSlot throws an error
    core.loadStateSlot = vi.fn().mockImplementation(() => {
      throw new Error('corrupted snapshot chunk');
    });
    await expect(emulator.loadSlot(snap)).rejects.toThrow('corrupted snapshot chunk');

    // Still no persistence mutation on thrown error
    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryBaseline);
    expect(vi.mocked(core.FSSync).mock.calls.length).toBe(fsSyncBaseline);
    expect(vi.mocked(storage.recordPlayTime).mock.calls.length).toBe(recordPlayTimeBaseline);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);

    // 3. Retry succeeds: settles and persists exactly once
    core.loadStateSlot = vi.fn().mockReturnValue(true);
    await emulator.loadSlot(snap);

    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryBaseline + 1);
    expect(vi.mocked(core.FSSync).mock.calls.length).toBe(fsSyncBaseline + 1);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(corePaused).toBe(false);
  });

  it('handles automatic slot 0 restore lifecycle on load: success, false fallback, version mismatch, and thrown failure', async () => {
    const autoData = new Uint8Array([9, 8, 7, 6]).buffer;
    const cart = createCartridge('cart-auto-lifecycle');

    // 1. Success on matching coreVersion: calls restoreState with (0, 61) observing core paused, restores ss0 file bytes, resumes and sets resumedAutomatically=true
    const callOrder1: string[] = [];
    let core1Paused = false;
    const core1 = createFakeCore();
    core1.pauseGame = vi.fn().mockImplementation(() => {
      callOrder1.push('pauseGame');
      core1Paused = true;
    });
    core1.resumeGame = vi.fn().mockImplementation(() => {
      callOrder1.push('resumeGame');
      core1Paused = false;
    });
    core1.loadStateSlot = vi.fn().mockImplementation((slot: number, flags?: number) => {
      callOrder1.push(`loadStateSlot:${slot}:${flags}:paused=${core1Paused}`);
      return true;
    });

    const storage1 = createStorageDouble();
    storage1.listSnapshots = vi.fn().mockResolvedValue([
      {
        key: 'cart-auto-lifecycle:0',
        romId: 'cart-auto-lifecycle',
        slot: 0,
        data: autoData,
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      },
    ]);

    const emu1 = new PocketEmulator({
      createCore: async () => core1,
      checkCrossOriginIsolated: () => true,
      storage: storage1,
      clock: createClockDouble(),
    });

    await emu1.load(cart, {} as HTMLCanvasElement, true);
    expect(callOrder1).toEqual(['pauseGame', 'loadStateSlot:0:61:paused=true', 'resumeGame']);
    expect(core1.FS.writeFile).toHaveBeenCalledWith(
      '/states/cart-auto-lifecycle.ss0',
      new Uint8Array(autoData),
    );
    expect(core1.loadState).not.toHaveBeenCalled();
    expect(emu1.getSnapshot().resumedAutomatically).toBe(true);
    expect(emu1.getSnapshot().status).toBe('running');
    expect(core1Paused).toBe(false);

    // 2. loadStateSlot returns false (e.g. corrupted state): fallback keeps running with resumedAutomatically=false
    let core2Paused = false;
    const core2 = createFakeCore();
    core2.pauseGame = vi.fn().mockImplementation(() => {
      core2Paused = true;
    });
    core2.resumeGame = vi.fn().mockImplementation(() => {
      core2Paused = false;
    });
    core2.loadStateSlot = vi.fn().mockImplementation((_slot: number, flags?: number) => {
      expect(core2Paused).toBe(true);
      expect(flags).toBe(61);
      return false;
    });
    const storage2 = createStorageDouble();
    storage2.listSnapshots = vi.fn().mockResolvedValue([
      {
        key: 'cart-auto-lifecycle:0',
        romId: 'cart-auto-lifecycle',
        slot: 0,
        data: autoData,
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      },
    ]);

    const emu2 = new PocketEmulator({
      createCore: async () => core2,
      checkCrossOriginIsolated: () => true,
      storage: storage2,
      clock: createClockDouble(),
    });

    await emu2.load(cart, {} as HTMLCanvasElement, true);
    expect(core2.loadStateSlot).toHaveBeenCalledWith(0, 61);
    expect(emu2.getSnapshot().resumedAutomatically).toBe(false);
    expect(emu2.getSnapshot().status).toBe('running');
    expect(core2Paused).toBe(false);

    // 3. Incompatible coreVersion: ignored completely, loadStateSlot not called
    const core3 = createFakeCore();
    const storage3 = createStorageDouble();
    storage3.listSnapshots = vi.fn().mockResolvedValue([
      {
        key: 'cart-auto-lifecycle:0',
        romId: 'cart-auto-lifecycle',
        slot: 0,
        data: autoData,
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.4.0', // older incompatible version
      },
    ]);

    const emu3 = new PocketEmulator({
      createCore: async () => core3,
      checkCrossOriginIsolated: () => true,
      storage: storage3,
      clock: createClockDouble(),
    });

    await emu3.load(cart, {} as HTMLCanvasElement, true);
    expect(core3.loadStateSlot).not.toHaveBeenCalled();
    expect(emu3.getSnapshot().resumedAutomatically).toBe(false);
    expect(emu3.getSnapshot().status).toBe('running');

    // 4. Automatic thrown failure: realistic fake core exposes gameName after loadGame so fail() pauses it, resulting in core paused and public error
    let core4Paused = false;
    const core4 = {
      ...createFakeCore(),
      gameName: 'Pokemon Emerald',
      pauseGame: vi.fn().mockImplementation(() => {
        core4Paused = true;
      }),
      resumeGame: vi.fn().mockImplementation(() => {
        core4Paused = false;
      }),
      loadStateSlot: vi.fn().mockImplementation(() => {
        throw new Error('auto-slot corrupted');
      }),
    } as unknown as mGBAEmulator;

    const storage4 = createStorageDouble();
    storage4.listSnapshots = vi.fn().mockResolvedValue([
      {
        key: 'cart-auto-lifecycle:0',
        romId: 'cart-auto-lifecycle',
        slot: 0,
        data: autoData,
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      },
    ]);

    const emu4 = new PocketEmulator({
      createCore: async () => core4,
      checkCrossOriginIsolated: () => true,
      storage: storage4,
      clock: createClockDouble(),
    });

    await expect(emu4.load(cart, {} as HTMLCanvasElement, true)).rejects.toThrow(
      'auto-slot corrupted',
    );
    expect(emu4.getSnapshot().status).toBe('error');
    expect(emu4.getSnapshot().error).toContain('auto-slot corrupted');
    expect(core4Paused).toBe(true);
    expect(core4.pauseGame).toHaveBeenCalled();
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
      loadStateSlot: vi.fn().mockReturnValue(true),
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

    // loadStateSlot must not be called while prior persist is in flight
    expect(core.loadStateSlot).not.toHaveBeenCalled();

    deferredFSSync.resolve();
    deferredFSSync = null;
    await Promise.all([persistPromise, slotPromise]);

    expect(core.loadStateSlot).toHaveBeenCalledTimes(1);
    expect(core.loadStateSlot).toHaveBeenCalledWith(1, 61);
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
      loadStateSlot: vi.fn().mockReturnValue(true),
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
      loadStateSlot: vi.fn().mockReturnValue(true),
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

  it('rejects loadSlot when core.loadStateSlot fails', async () => {
    const core = createFakeCore();
    core.loadStateSlot = vi.fn().mockReturnValue(false);

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

  it('exercises core callbacks: frames, dirty-save persistence, stale generation protection, and crash error handling', async () => {
    interface CoreCallbacksBundle {
      videoFrameEndedCallback: () => void;
      saveDataUpdatedCallback: () => void;
      coreCrashedCallback: () => void;
    }
    let capturedCallbacks1: CoreCallbacksBundle | null = null;
    let capturedCallbacks2: CoreCallbacksBundle | null = null;

    let callbackRegistrationCount = 0;
    const core = createFakeCore();
    const batterySaveBytes1 = new Uint8Array([10, 20, 30, 40]);
    const batterySaveBytes2 = new Uint8Array([50, 60, 70, 80]);

    // Drive getSave by active loaded cartridge
    let loadedRomId = '';
    core.loadGame = vi.fn().mockImplementation((path: string) => {
      const parts = path.split('/');
      const last = parts[parts.length - 1];
      loadedRomId = (last ?? '').replace(/\.(gba|gbc|gb)$/i, '');
      return true;
    });
    core.getSave = vi.fn().mockImplementation(() => {
      if (loadedRomId === 'cart-cb-1') return batterySaveBytes1.slice();
      if (loadedRomId === 'cart-cb-2') return batterySaveBytes2.slice();
      return null;
    });

    core.addCoreCallbacks = vi.fn().mockImplementation((cb) => {
      callbackRegistrationCount++;
      if (callbackRegistrationCount === 1) {
        capturedCallbacks1 = cb as unknown as CoreCallbacksBundle;
      } else {
        capturedCallbacks2 = cb as unknown as CoreCallbacksBundle;
      }
    });

    let intervalHandler: (() => void) | null = null;
    let timerCleanedUp = false;
    let clockTime = 1000;
    const clock: EmulatorClock = {
      now: () => clockTime,
      setInterval: vi.fn().mockImplementation((h: () => void) => {
        intervalHandler = h;
        timerCleanedUp = false;
        return 101 as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn().mockImplementation(() => {
        intervalHandler = null;
        timerCleanedUp = true;
      }),
      requestAnimationFrame: (cb) => cb(),
    };

    const batteryStorage = new Map<string, BatterySave>();
    const recordedSeconds = new Map<string, number>();
    const storage: EmulatorStorageAdapter = {
      ...createStorageDouble(),
      putBattery: vi.fn().mockImplementation(async (save) => {
        batteryStorage.set(save.romId, save);
      }),
      getBattery: vi.fn().mockImplementation(async (romId) => batteryStorage.get(romId)),
      recordPlayTime: vi.fn().mockImplementation(async (romId, secs) => {
        recordedSeconds.set(romId, (recordedSeconds.get(romId) ?? 0) + secs);
      }),
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const cart1 = createCartridge('cart-cb-1');
    await emulator.load(cart1, {} as HTMLCanvasElement);

    expect(capturedCallbacks1).not.toBeNull();
    const cb1: CoreCallbacksBundle = capturedCallbacks1 ?? {
      videoFrameEndedCallback: () => {},
      saveDataUpdatedCallback: () => {},
      coreCrashedCallback: () => {},
    };
    expect(typeof cb1.videoFrameEndedCallback).toBe('function');
    expect(typeof cb1.saveDataUpdatedCallback).toBe('function');
    expect(typeof cb1.coreCrashedCallback).toBe('function');

    // Switch to second cartridge: checkpoints cart1 with its original bytes
    const cart2 = createCartridge('cart-cb-2');
    await emulator.load(cart2, {} as HTMLCanvasElement);

    expect(capturedCallbacks2).not.toBeNull();
    const cb2: CoreCallbacksBundle = capturedCallbacks2 ?? {
      videoFrameEndedCallback: () => {},
      saveDataUpdatedCallback: () => {},
      coreCrashedCallback: () => {},
    };

    // Verify cart1 bytes were checkpointed during switch and retained
    const cart1Saved = batteryStorage.get('cart-cb-1');
    expect(cart1Saved).toBeDefined();
    expect(new Uint8Array(cart1Saved?.data ?? new ArrayBuffer(0))).toEqual(batterySaveBytes1);

    // Take write baselines after legitimate switch
    const putBatteryCallsBaseline = vi.mocked(storage.putBattery).mock.calls.length;
    const recordPlayTimeCallsBaseline = vi.mocked(storage.recordPlayTime).mock.calls.length;

    // 1. Invoke stale callbacks from generation 1: must cause zero writes and zero frame attribution
    for (let i = 0; i < 100; i++) {
      cb1.videoFrameEndedCallback();
    }
    cb1.saveDataUpdatedCallback();

    clockTime += 1000;
    expect(intervalHandler).not.toBeNull();
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));

    expect(emulator.getSnapshot().frames).toBe(0);
    expect(emulator.getSnapshot().fps).toBe(0);
    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryCallsBaseline);
    expect(vi.mocked(storage.recordPlayTime).mock.calls.length).toBe(recordPlayTimeCallsBaseline);
    expect(batteryStorage.has('cart-cb-2')).toBe(false);

    // 2. Invoke active callbacks from generation 2: exact counts and bytes
    for (let i = 0; i < 60; i++) {
      cb2.videoFrameEndedCallback();
    }
    cb2.saveDataUpdatedCallback();

    clockTime += 1000;
    expect(intervalHandler).not.toBeNull();
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));

    const snap2 = emulator.getSnapshot();
    expect(snap2.frames).toBe(60);
    expect(snap2.fps).toBe(60);
    expect(snap2.seconds).toBe(cart2.playTime + 2); // 2 timer intervals elapsed

    // Stored battery payload matches exact bytes, romId, and recorded seconds
    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryCallsBaseline + 1);
    const storedBat = batteryStorage.get('cart-cb-2');
    expect(storedBat).toBeDefined();
    expect(storedBat?.romId).toBe('cart-cb-2');
    expect(new Uint8Array(storedBat?.data ?? new ArrayBuffer(0))).toEqual(batterySaveBytes2);
    expect(recordedSeconds.get('cart-cb-2')).toBe(2);

    // 3. Stale crash callback from generation 1 is ignored
    cb1.coreCrashedCallback();
    await new Promise((r) => setTimeout(r, 10));
    expect(emulator.getSnapshot().status).toBe('running');
    expect(timerCleanedUp).toBe(false);

    // 4. Active crash callback from generation 2 triggers fail and clears the owned interval
    cb2.coreCrashedCallback();
    await new Promise((r) => setTimeout(r, 10));
    expect(emulator.getSnapshot().status).toBe('error');
    expect(emulator.getSnapshot().error).toContain('运行中断');
    expect(timerCleanedUp).toBe(true);
    expect(intervalHandler).toBeNull();
  });

  it('manages 30-second automatic snapshot boundary (at 29,999ms vs 30,000ms) with exact payload, unchanged recordPlayTime, and strictly read-only pause tick', async () => {
    const core = createFakeCore();
    const saveStateBytes = new Uint8Array([77, 88, 99, 111]);
    core.FS.readFile = vi.fn().mockImplementation((path: string) => {
      if (path.includes('.ss0')) return saveStateBytes.slice();
      return new Uint8Array([0]);
    });

    let intervalHandler: (() => void) | null = null;
    let clockTime = 10000;
    const clock: EmulatorClock = {
      now: () => clockTime,
      setInterval: vi.fn().mockImplementation((h: () => void) => {
        intervalHandler = h;
        return 202 as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn().mockImplementation(() => {
        intervalHandler = null;
      }),
      requestAnimationFrame: (cb) => cb(),
    };

    const snapshotsMap = new Map<string, Snapshot>();
    const storage: EmulatorStorageAdapter = {
      ...createStorageDouble(),
      putSnapshot: vi.fn().mockImplementation(async (snap) => {
        snapshotsMap.set(snap.key, snap);
      }),
      listSnapshots: vi
        .fn()
        .mockImplementation(async (romId) =>
          Array.from(snapshotsMap.values()).filter((s) => s.romId === romId),
        ),
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const cart = createCartridge('cart-autosnap');
    await emulator.load(cart, {} as HTMLCanvasElement);

    // Initial load: 0 auto snapshots
    expect(snapshotsMap.size).toBe(0);

    // 1. Advance to 29,999 ms from lastAutoCapture: must NOT trigger snapshot
    clockTime = 10000 + 29999;
    expect(intervalHandler).not.toBeNull();
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));
    expect(snapshotsMap.size).toBe(0);
    expect(storage.putSnapshot).not.toHaveBeenCalled();

    // 2. Advance by 1 ms to reach exactly 30,000 ms: triggers slot 0 snapshot with exact payload
    clockTime = 10000 + 30000;
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));

    expect(storage.putSnapshot).toHaveBeenCalledTimes(1);
    const autoSnap = snapshotsMap.get('cart-autosnap:0');
    expect(autoSnap).toBeDefined();
    expect(autoSnap?.key).toBe('cart-autosnap:0');
    expect(autoSnap?.romId).toBe('cart-autosnap');
    expect(autoSnap?.slot).toBe(0);
    expect(autoSnap?.coreVersion).toBe('2.5.1');
    expect(new Uint8Array(autoSnap?.data ?? new ArrayBuffer(0))).toEqual(saveStateBytes);

    // 3. Pause emulator: timer tick while paused is strictly read-only
    emulator.pause();
    expect(emulator.getSnapshot().status).toBe('paused');

    const framesBefore = emulator.getSnapshot().frames;
    const secondsBefore = emulator.getSnapshot().seconds;
    const putSnapshotsCountBefore = vi.mocked(storage.putSnapshot).mock.calls.length;
    const putBatteryCountBefore = vi.mocked(storage.putBattery).mock.calls.length;
    const recordPlayTimeCountBefore = vi.mocked(storage.recordPlayTime).mock.calls.length;

    // Advance clock by another 40 seconds while paused
    clockTime += 40000;
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));

    expect(emulator.getSnapshot().frames).toBe(framesBefore);
    expect(emulator.getSnapshot().seconds).toBe(secondsBefore);
    expect(vi.mocked(storage.putSnapshot).mock.calls.length).toBe(putSnapshotsCountBefore);
    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryCountBefore);
    expect(vi.mocked(storage.recordPlayTime).mock.calls.length).toBe(recordPlayTimeCountBefore);
  });

  it('handles automatic snapshot rejection error feedback, leaves storage absent, preserves unrecorded seconds, and recovers on subsequent checkpoint', async () => {
    const core = createFakeCore();
    const batteryBytes = new Uint8Array([33, 44, 55, 66]);
    core.getSave = vi.fn().mockImplementation(() => batteryBytes.slice());

    const saveStateBytes = new Uint8Array([11, 22, 33, 44]);
    core.FS.readFile = vi.fn().mockImplementation((path: string) => {
      if (path.includes('.ss0')) return saveStateBytes.slice();
      return new Uint8Array([0]);
    });

    let intervalHandler: (() => void) | null = null;
    let clockTime = 10000;
    const clock: EmulatorClock = {
      now: () => clockTime,
      setInterval: vi.fn().mockImplementation((h: () => void) => {
        intervalHandler = h;
        return 303 as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn(),
      requestAnimationFrame: (cb) => cb(),
    };

    const snapshotsMap = new Map<string, Snapshot>();
    const batteryMap = new Map<string, BatterySave>();
    const recordedSeconds = new Map<string, number>();
    let rejectNextPutSnapshot = false;

    const storage: EmulatorStorageAdapter = {
      ...createStorageDouble(),
      putBattery: vi.fn().mockImplementation(async (save) => {
        batteryMap.set(save.romId, save);
      }),
      getBattery: vi.fn().mockImplementation(async (id) => batteryMap.get(id)),
      putSnapshot: vi.fn().mockImplementation(async (snap) => {
        if (rejectNextPutSnapshot) {
          throw new Error('IndexedDB quota exceeded');
        }
        snapshotsMap.set(snap.key, snap);
      }),
      listSnapshots: vi
        .fn()
        .mockImplementation(async (romId) =>
          Array.from(snapshotsMap.values()).filter((s) => s.romId === romId),
        ),
      recordPlayTime: vi.fn().mockImplementation(async (romId, secs) => {
        recordedSeconds.set(romId, (recordedSeconds.get(romId) ?? 0) + secs);
      }),
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const cart = createCartridge('cart-err-snap');
    await emulator.load(cart, {} as HTMLCanvasElement);
    expect(recordedSeconds.get('cart-err-snap')).toBe(0);

    // 1. First auto-snapshot rejects: leaves storage absent and exposes error feedback
    rejectNextPutSnapshot = true;
    clockTime += 30000; // 30s elapsed
    expect(intervalHandler).not.toBeNull();
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));

    expect(snapshotsMap.has('cart-err-snap:0')).toBe(false);
    expect(emulator.getSnapshot().error).toBe('存档写入失败：IndexedDB quota exceeded');
    // Failed persist did not record playtime
    expect(recordedSeconds.get('cart-err-snap')).toBe(0);

    // 2. Subsequent auto-snapshot succeeds: exact bytes stored and accumulated seconds recorded exactly once
    rejectNextPutSnapshot = false;
    clockTime += 30000; // another 30s elapsed (total 60s session)
    if (intervalHandler) (intervalHandler as () => void)();
    await new Promise((r) => setTimeout(r, 0));

    expect(snapshotsMap.has('cart-err-snap:0')).toBe(true);
    const snap = snapshotsMap.get('cart-err-snap:0');
    expect(snap).toBeDefined();
    if (!snap) throw new Error('Missing snapshot');
    expect(snap.key).toBe('cart-err-snap:0');
    expect(snap.romId).toBe('cart-err-snap');
    expect(snap.slot).toBe(0);
    expect(snap.coreVersion).toBe('2.5.1');
    expect(new Uint8Array(snap.data)).toEqual(saveStateBytes);

    const storedBat = batteryMap.get('cart-err-snap');
    expect(storedBat).toBeDefined();
    expect(storedBat?.romId).toBe('cart-err-snap');
    expect(new Uint8Array(storedBat?.data ?? new ArrayBuffer(0))).toEqual(batteryBytes);

    // Accumulated seconds (60 seconds) recorded exactly once
    // 2 timer ticks elapsed before successful persist: 2 seconds recorded
    expect(recordedSeconds.get('cart-err-snap')).toBe(2);

    // 3. Subsequent persist with no elapsed time does not record extra seconds
    const recordCallsBefore = vi.mocked(storage.recordPlayTime).mock.calls.length;
    await emulator.persist();
    expect(vi.mocked(storage.recordPlayTime).mock.calls.length).toBe(recordCallsBefore);
  });

  it('handles loadGame=false: asserts no timer on initial load failure, and removes owned timer on runtime reload failure with retry possible', async () => {
    const core = createFakeCore();
    let timerInstalled = false;
    let timerRemoved = false;
    const clock: EmulatorClock = {
      now: () => 1000,
      setInterval: vi.fn().mockImplementation(() => {
        timerInstalled = true;
        return 404 as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn().mockImplementation(() => {
        timerRemoved = true;
        timerInstalled = false;
      }),
      requestAnimationFrame: (cb) => cb(),
    };

    const storage = createStorageDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const cart = createCartridge('cart-bad-load');

    // 1. Initial load failure: core.loadGame returns false
    core.loadGame = vi.fn().mockReturnValue(false);
    await expect(emulator.load(cart, {} as HTMLCanvasElement)).rejects.toThrow('无法启动这枚卡带');

    expect(emulator.getSnapshot().status).toBe('error');
    expect(emulator.getSnapshot().error).toContain('无法启动这枚卡带');
    // On first loadGame failure before running, no timer was ever installed
    expect(timerInstalled).toBe(false);

    // 2. Successful load installs live timer
    core.loadGame = vi.fn().mockReturnValue(true);
    await emulator.load(cart, {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(timerInstalled).toBe(true);
    timerRemoved = false;

    // 3. Subsequent reload failure removes the previously running timer
    core.loadGame = vi.fn().mockReturnValue(false);
    await expect(emulator.load(cart, {} as HTMLCanvasElement)).rejects.toThrow('无法启动这枚卡带');
    expect(emulator.getSnapshot().status).toBe('error');
    expect(timerRemoved).toBe(true);
    expect(timerInstalled).toBe(false);

    // 4. Successful retry restores running state and reinstalls timer
    core.loadGame = vi.fn().mockReturnValue(true);
    await emulator.load(cart, {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(timerInstalled).toBe(true);
  });

  it('handles failed battery-import reboot: preserves imported battery in storage, stops timer, and allows recovery', async () => {
    const sharedFiles = new Map<string, Uint8Array>();
    let currentRomId = '';
    const initialBatteryBytes = new Uint8Array([1, 2, 3, 4]);
    const importedBatteryBytes = new Uint8Array([99, 88, 77, 66]);
    let currentSave = initialBatteryBytes.slice();

    const core = {
      ...createFakeCore(),
      loadGame: vi.fn().mockImplementation((path: string, savePath: string) => {
        const parts = path.split('/');
        const last = parts[parts.length - 1];
        currentRomId = (last ?? '').replace(/\.(gba|gbc|gb)$/i, '');
        const existing = sharedFiles.get(savePath);
        currentSave = existing ? existing.slice() : initialBatteryBytes.slice();
        return true;
      }),
      quitGame: vi.fn().mockImplementation(() => {
        if (currentRomId) {
          sharedFiles.set(`/saves/${currentRomId}.sav`, currentSave.slice());
        }
        currentRomId = '';
      }),
      getSave: vi.fn().mockImplementation(() => (currentRomId ? currentSave.slice() : null)),
      FS: {
        mkdir: vi.fn(),
        writeFile: vi.fn().mockImplementation((p: string, data: Uint8Array) => {
          sharedFiles.set(p, new Uint8Array(data));
        }),
        readFile: vi.fn().mockImplementation((p: string) => {
          const value = sharedFiles.get(p);
          if (!value) throw new Error(`File not found: ${p}`);
          return value.slice();
        }),
        unlink: vi.fn().mockImplementation((p: string) => {
          sharedFiles.delete(p);
        }),
        analyzePath: vi.fn().mockImplementation((p: string) => ({ exists: sharedFiles.has(p) })),
      },
    } as unknown as mGBAEmulator;

    let timerRunning = false;
    const clock: EmulatorClock = {
      now: () => 1000,
      setInterval: vi.fn().mockImplementation(() => {
        timerRunning = true;
        return 505 as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn().mockImplementation(() => {
        timerRunning = false;
      }),
      requestAnimationFrame: (cb) => cb(),
    };

    const batteryStorage = new Map<string, BatterySave>();
    batteryStorage.set('cart-import-reboot', {
      romId: 'cart-import-reboot',
      data: initialBatteryBytes.buffer,
      updatedAt: 1000,
    });

    const storage: EmulatorStorageAdapter = {
      ...createStorageDouble(),
      putBattery: vi.fn().mockImplementation(async (save) => {
        batteryStorage.set(save.romId, save);
      }),
      replaceBattery: vi.fn().mockImplementation(async (save) => {
        batteryStorage.set(save.romId, save);
      }),
      getBattery: vi.fn().mockImplementation(async (id) => batteryStorage.get(id)),
    };

    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    const cart = createCartridge('cart-import-reboot');
    await emulator.load(cart, {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-import-reboot');
    expect(timerRunning).toBe(true);

    // Initial core save matches initial bytes
    const initialCoreSave = core.getSave();
    expect(initialCoreSave).not.toBeNull();
    expect(new Uint8Array(initialCoreSave ?? new Uint8Array(0))).toEqual(initialBatteryBytes);

    // Core loadGame fails during post-import reboot
    core.loadGame = vi.fn().mockReturnValue(false);

    await expect(emulator.importBattery(importedBatteryBytes.buffer)).rejects.toThrow(
      '无法启动这枚卡带',
    );

    // 1. Imported battery was preserved in the SAME battery storage despite reboot failure
    const stored = batteryStorage.get('cart-import-reboot');
    expect(stored).toBeDefined();
    expect(new Uint8Array(stored?.data ?? new ArrayBuffer(0))).toEqual(importedBatteryBytes);

    // 2. Emulator transitions to error, cartridge identity preserved, and timer is stopped
    expect(emulator.getSnapshot().status).toBe('error');
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-import-reboot');
    expect(emulator.getSnapshot().error).toContain('无法启动这枚卡带');
    expect(timerRunning).toBe(false);

    // 3. Recovery succeeds when loadGame succeeds again, loading the imported save bytes
    core.loadGame = vi.fn().mockImplementation((path: string, savePath: string) => {
      const parts = path.split('/');
      const last = parts[parts.length - 1];
      currentRomId = (last ?? '').replace(/\.(gba|gbc|gb)$/i, '');
      const existing = sharedFiles.get(savePath);
      currentSave = existing ? existing.slice() : initialBatteryBytes.slice();
      return true;
    });

    await emulator.load(cart, {} as HTMLCanvasElement);
    expect(emulator.getSnapshot().status).toBe('running');
    expect(emulator.getSnapshot().cartridge?.id).toBe('cart-import-reboot');
    expect(timerRunning).toBe(true);
    const recoveredCoreSave = core.getSave();
    expect(recoveredCoreSave).not.toBeNull();
    expect(new Uint8Array(recoveredCoreSave ?? new Uint8Array(0))).toEqual(importedBatteryBytes);

    // 4. One subsequent persist preserves the exact imported save bytes
    await emulator.persist();
    const storedAfterPersist = batteryStorage.get('cart-import-reboot');
    expect(new Uint8Array(storedAfterPersist?.data ?? new ArrayBuffer(0))).toEqual(
      importedBatteryBytes,
    );
  });

  it('treats idle persist and reset as no-ops without mutation, and asserts zero mutations before idle/foreign rejections', async () => {
    const core = createFakeCore();
    const storage = createStorageDouble();
    const clock = createClockDouble();
    const emulator = new PocketEmulator({
      createCore: async () => core,
      checkCrossOriginIsolated: () => true,
      storage,
      clock,
    });

    // 1. Idle persist and reset are no-ops
    await expect(emulator.persist()).resolves.toBeUndefined();
    await expect(emulator.reset()).resolves.toBeUndefined();
    expect(core.quickReload).not.toHaveBeenCalled();
    expect(storage.putBattery).not.toHaveBeenCalled();
    expect(storage.putSnapshot).not.toHaveBeenCalled();
    expect(core.FS.writeFile).not.toHaveBeenCalled();

    // 2. Idle importBattery rejects before any replacement or file write
    await expect(emulator.importBattery(new ArrayBuffer(512))).rejects.toThrow(
      '请先启动对应的卡带',
    );
    expect(storage.replaceBattery).not.toHaveBeenCalled();
    expect(core.FS.writeFile).not.toHaveBeenCalled();

    // 3. Idle saveSlot rejects before any capture or file write
    await expect(emulator.saveSlot(1)).rejects.toThrow('请先启动游戏');
    expect(storage.putSnapshot).not.toHaveBeenCalled();
    expect(core.saveState).not.toHaveBeenCalled();

    // 4. Load valid cartridge to establish baseline
    await emulator.load(createCartridge('cart-real'), {} as HTMLCanvasElement);
    const putSnapshotBaseline = vi.mocked(storage.putSnapshot).mock.calls.length;
    const putBatteryBaseline = vi.mocked(storage.putBattery).mock.calls.length;
    const replaceBatteryBaseline = vi.mocked(storage.replaceBattery).mock.calls.length;
    const writeFileBaseline = vi.mocked(core.FS.writeFile).mock.calls.length;
    const loadStateBaseline = vi.mocked(core.loadStateSlot).mock.calls.length;
    const fsSyncBaseline = vi.mocked(core.FSSync).mock.calls.length;

    // Foreign cartridge loadSlot rejects before any file write, state load, or storage mutation
    await expect(
      emulator.loadSlot({
        key: 'cart-foreign:1',
        romId: 'cart-foreign',
        slot: 1,
        data: new ArrayBuffer(4),
        thumbnail: '',
        updatedAt: 100,
        coreVersion: '2.5.1',
      }),
    ).rejects.toThrow('不属于当前卡带');

    expect(vi.mocked(storage.putSnapshot).mock.calls.length).toBe(putSnapshotBaseline);
    expect(vi.mocked(storage.putBattery).mock.calls.length).toBe(putBatteryBaseline);
    expect(vi.mocked(storage.replaceBattery).mock.calls.length).toBe(replaceBatteryBaseline);
    expect(vi.mocked(core.FS.writeFile).mock.calls.length).toBe(writeFileBaseline);
    expect(vi.mocked(core.loadStateSlot).mock.calls.length).toBe(loadStateBaseline);
    expect(vi.mocked(core.FSSync).mock.calls.length).toBe(fsSyncBaseline);
  });

  it('exercises default crossOriginIsolated check and default clock under controlled global stubs', async () => {
    vi.useFakeTimers();

    let ownedLoadPromise: Promise<void> | null = null;
    let emulatorInstance: PocketEmulator | null = null;

    try {
      // 1. When crossOriginIsolated is false, load fails with actionable error
      vi.stubGlobal('window', { crossOriginIsolated: false });

      const core = createFakeCore();
      const emulatorFail = new PocketEmulator({
        createCore: async () => core,
        storage: createStorageDouble(),
      });

      await expect(
        emulatorFail.load(createCartridge('cart-noiso'), {} as HTMLCanvasElement),
      ).rejects.toThrow('浏览器未开启共享内存');
      expect(emulatorFail.getSnapshot().status).toBe('error');

      // 2. When crossOriginIsolated is true and SharedArrayBuffer is available, load succeeds with default clock
      vi.stubGlobal('window', { crossOriginIsolated: true });
      if (typeof globalThis.SharedArrayBuffer === 'undefined') {
        vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
      }

      // Ensure deterministic requestAnimationFrame fallback using setTimeout
      vi.stubGlobal('requestAnimationFrame', undefined);

      const cart = createCartridge('cart-iso-ok');
      emulatorInstance = new PocketEmulator({
        createCore: async () => core,
        storage: createStorageDouble(),
      });

      ownedLoadPromise = emulatorInstance.load(cart, {} as HTMLCanvasElement);

      // Advance by 32ms (two 16ms setTimeout hops for RAF fallback in internalLoad)
      await vi.advanceTimersByTimeAsync(32);
      await ownedLoadPromise;
      ownedLoadPromise = null;

      expect(emulatorInstance.getSnapshot().status).toBe('running');

      // Advance fake timers by exactly 1000ms: seconds is exactly cart.playTime + 1
      await vi.advanceTimersByTimeAsync(1000);
      expect(emulatorInstance.getSnapshot().seconds).toBe(cart.playTime + 1);

      // Pause emulator: advance by 1000ms, seconds remains unchanged
      emulatorInstance.pause();
      expect(emulatorInstance.getSnapshot().status).toBe('paused');
      await vi.advanceTimersByTimeAsync(1000);
      expect(emulatorInstance.getSnapshot().seconds).toBe(cart.playTime + 1);

      // Resume emulator: advance by 1000ms, seconds increments by exactly +1
      emulatorInstance.resume();
      expect(emulatorInstance.getSnapshot().status).toBe('running');
      await vi.advanceTimersByTimeAsync(1000);
      expect(emulatorInstance.getSnapshot().seconds).toBe(cart.playTime + 2);
    } finally {
      // Always settle pending load promise if still active
      if (ownedLoadPromise && emulatorInstance) {
        try {
          await vi.advanceTimersByTimeAsync(64);
          await ownedLoadPromise;
        } catch {
          // Ignore settlement error during teardown
        }
      }
      // Stop emulator timer if running
      if (emulatorInstance) {
        emulatorInstance.pause();
      }
      // Clear all pending fake timers before restoring real timers
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
