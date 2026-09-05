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
});
