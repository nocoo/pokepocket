import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import { romPath, type Cartridge } from './cartridge';
import type { GameButton } from './input';
import { copyBuffer, storage as defaultStorage, type BatterySave, type Snapshot } from './storage';

export const CORE_VERSION = '2.5.1';
export type EmulatorStatus = 'idle' | 'loading' | 'running' | 'paused' | 'error';

export interface EmulatorState {
  status: EmulatorStatus;
  cartridge: Cartridge | null;
  fps: number | null;
  frames: number;
  seconds: number;
  speed: number;
  snapshots: Snapshot[];
  lastSavedAt: number | null;
  error: string | null;
  coreVersion: string;
  resumedAutomatically: boolean;
}

export interface EmulatorStorageAdapter {
  getBattery: (id: string) => Promise<BatterySave | undefined>;
  putBattery: (save: BatterySave) => Promise<void>;
  replaceBattery: (save: BatterySave) => Promise<void>;
  listSnapshots: (id: string) => Promise<Snapshot[]>;
  putSnapshot: (snapshot: Snapshot) => Promise<void>;
  deleteSnapshot: (key: string) => Promise<void>;
  recordPlayTime: (id: string, seconds: number) => Promise<void>;
}

export interface EmulatorClock {
  now: () => number;
  setInterval: (handler: () => void, timeout: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
  requestAnimationFrame: (callback: () => void) => void;
}

export type CoreFactory = (options: { canvas: HTMLCanvasElement }) => Promise<mGBAEmulator>;

export interface EmulatorDependencies {
  storage: EmulatorStorageAdapter;
  clock: EmulatorClock;
  createCore?: CoreFactory;
  checkCrossOriginIsolated?: () => boolean;
}

const defaultClock: EmulatorClock = {
  now: () => performance.now(),
  setInterval: (h, t) => setInterval(h, t),
  clearInterval: (id) => clearInterval(id),
  requestAnimationFrame: (cb) => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(cb);
    } else {
      setTimeout(cb, 16);
    }
  },
};

export class PocketEmulator {
  private deps: EmulatorDependencies;
  private core: mGBAEmulator | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private initializing: Promise<mGBAEmulator> | null = null;
  private loading = false;
  private listeners = new Set<() => void>();
  private frameCount = 0;
  private lastFrameTime = 0;
  private sessionSeconds = 0;
  private lastAutoCapture = 0;
  private loadGeneration = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private savedataDirty = false;
  private volume = 0.65;
  private state: EmulatorState = {
    status: 'idle',
    cartridge: null,
    fps: null,
    frames: 0,
    seconds: 0,
    speed: 1,
    snapshots: [],
    lastSavedAt: null,
    error: null,
    coreVersion: '',
    resumedAutomatically: false,
  };

  constructor(dependencies?: Partial<EmulatorDependencies>) {
    this.deps = {
      storage: defaultStorage,
      clock: defaultClock,
      ...dependencies,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.state;

  private update(patch: Partial<EmulatorState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.saveQueue.then(task);
    this.saveQueue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private async initialize(canvas: HTMLCanvasElement): Promise<mGBAEmulator> {
    if (this.core) return this.core;
    if (this.initializing) return this.initializing;

    const checkIsolated =
      this.deps.checkCrossOriginIsolated ??
      (() =>
        typeof window !== 'undefined' &&
        Boolean(window.crossOriginIsolated) &&
        typeof SharedArrayBuffer !== 'undefined');

    if (!checkIsolated()) {
      throw new Error('浏览器未开启共享内存。请使用本地开发地址或已配置隔离响应头的 HTTPS 网站。');
    }

    this.canvas = canvas;
    this.initializing = (async () => {
      let core: mGBAEmulator;
      if (this.deps.createCore) {
        core = await this.deps.createCore({ canvas });
      } else {
        const url = new URL(`/emulator/${CORE_VERSION}/mgba.js`, window.location.origin).href;
        const {
          default: createCore,
        }: { default: (options: { canvas: HTMLCanvasElement }) => Promise<mGBAEmulator> } =
          await import(/* @vite-ignore */ url);
        core = await createCore({ canvas });
      }

      try {
        await core.FSInit();
        core.FS.mkdir('/roms');
        core.toggleInput(false);
        core.setCoreSettings({
          autoSaveStateEnable: false,
          restoreAutoSaveStateOnLoad: false,
          rewindEnable: false,
          allowOpposingDirections: false,
        });
        this.core = core;
        this.update({ coreVersion: `${core.version.projectName} ${core.version.projectVersion}` });
        return core;
      } catch (err) {
        try {
          (core as { quitMgba?: () => void }).quitMgba?.();
        } catch {
          // Ignore cleanup errors
        }
        throw err;
      }
    })();

    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  private async internalLoad(
    cartridge: Cartridge,
    canvas: HTMLCanvasElement,
    resumeAuto = true,
    preserveSessionSeconds = false,
  ): Promise<void> {
    if (this.loading) throw new Error('正在载入卡带，请稍等。');
    this.loading = true;
    this.stopTimer();
    const currentGeneration = ++this.loadGeneration;

    try {
      if (!preserveSessionSeconds && this.state.cartridge && this.core) {
        this.pause();
        await this.internalPersist(true);
      }
      this.update({ status: 'loading', error: null, fps: null, resumedAutomatically: false });
      const core = await this.initialize(canvas);
      if (this.state.cartridge) {
        core.quitGame();
        const previousPath = romPath(this.state.cartridge);
        if (core.FS.analyzePath(previousPath).exists) core.FS.unlink(previousPath);
      }

      const battery = await this.deps.storage.getBattery(cartridge.id);
      const snapshots = await this.deps.storage.listSnapshots(cartridge.id);
      const gamePath = romPath(cartridge);
      const savePath = `${core.filePaths().savePath}/${cartridge.id}.sav`;
      core.FS.writeFile(gamePath, new Uint8Array(cartridge.data));
      if (battery) core.FS.writeFile(savePath, new Uint8Array(battery.data));
      if (!core.loadGame(gamePath, savePath)) {
        throw new Error('模拟器无法启动这枚卡带，请检查 GB / GBC / GBA 文件。');
      }

      await new Promise<void>((resolve) =>
        this.deps.clock.requestAnimationFrame(() =>
          this.deps.clock.requestAnimationFrame(() => resolve()),
        ),
      );

      this.frameCount = 0;
      this.lastFrameTime = this.deps.clock.now();
      this.lastAutoCapture = this.deps.clock.now();
      if (!preserveSessionSeconds) {
        this.sessionSeconds = 0;
      }
      this.savedataDirty = false;

      core.addCoreCallbacks({
        videoFrameEndedCallback: () => {
          if (this.loadGeneration === currentGeneration) {
            this.frameCount++;
          }
        },
        saveDataUpdatedCallback: () => {
          if (this.loadGeneration === currentGeneration) {
            this.savedataDirty = true;
          }
        },
        coreCrashedCallback: () => {
          setTimeout(() => {
            if (this.loadGeneration === currentGeneration) {
              this.fail(new Error('游戏内核运行中断，请重新载入卡带。'));
            }
          }, 0);
        },
      });

      core.setCoreSettings({ allowOpposingDirections: false });
      core.setVolume(this.volume);
      core.setFastForwardMultiplier(this.state.speed);

      const previous = snapshots.find((snapshot) => snapshot.slot === 0);
      let resumedAutomatically = false;
      if (resumeAuto && previous?.coreVersion === CORE_VERSION) {
        const path = `${core.filePaths().saveStatePath}/${cartridge.id}.ss0`;
        core.FS.writeFile(path, new Uint8Array(previous.data));
        resumedAutomatically = this.restoreState(core, 0, true);
      }

      this.update({
        status: 'running',
        cartridge,
        snapshots,
        lastSavedAt: battery?.updatedAt ?? null,
        frames: 0,
        seconds: cartridge.playTime + this.sessionSeconds,
        resumedAutomatically,
      });

      await this.deps.storage.recordPlayTime(cartridge.id, 0);
      this.startTimer();
      this.resumeAudio();
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  load(cartridge: Cartridge, canvas: HTMLCanvasElement, resumeAuto = true): Promise<void> {
    return this.enqueue(() => this.internalLoad(cartridge, canvas, resumeAuto));
  }

  private startTimer() {
    this.stopTimer();
    this.timer = this.deps.clock.setInterval(() => {
      if (this.state.status !== 'running') return;
      const now = this.deps.clock.now();
      const elapsed = now - this.lastFrameTime;
      const frames = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
      this.sessionSeconds++;

      this.update({
        fps: Math.round((frames * 1000) / elapsed),
        frames: this.state.frames + frames,
        seconds: this.state.seconds + 1,
      });

      const snapshot = now - this.lastAutoCapture >= 30000;
      if (this.savedataDirty || snapshot) {
        if (snapshot) this.lastAutoCapture = now;
        this.savedataDirty = false;
        void this.persist(snapshot).catch((error) =>
          this.update({ error: `存档写入失败：${message(error)}` }),
        );
      }
    }, 1000);
  }

  private stopTimer() {
    if (this.timer) this.deps.clock.clearInterval(this.timer);
    this.timer = null;
  }

  pause() {
    if (this.state.status !== 'running') return;
    this.core?.pauseGame();
    this.update({ status: 'paused', fps: null });
  }

  resume() {
    if (this.state.status !== 'paused') return;
    this.frameCount = 0;
    this.lastFrameTime = this.deps.clock.now();
    this.core?.resumeGame();
    this.update({ status: 'running' });
    this.startTimer();
    this.resumeAudio();
  }

  button(button: GameButton, down: boolean) {
    if (!this.core || (down && this.state.status !== 'running')) return;
    if (down) this.core.buttonPress(button);
    else this.core.buttonUnpress(button);
  }

  setVolume(volume: number) {
    this.volume = volume;
    this.core?.setVolume(volume);
  }

  setSpeed(speed: number) {
    this.core?.setFastForwardMultiplier(speed);
    this.update({ speed });
  }

  resumeAudio() {
    const context = this.core?.SDL2?.audioContext;
    if (context?.state === 'suspended') {
      void context.resume().catch(() => {});
    }
  }

  private async internalReset(): Promise<void> {
    if (!this.core || !this.state.cartridge) return;
    await this.internalPersist(true);
    this.core.quickReload();
    if (this.state.status === 'paused') this.resume();
  }

  reset(): Promise<void> {
    return this.enqueue(() => this.internalReset());
  }

  private async internalPersist(withSnapshot = false): Promise<void> {
    if (!this.core || !this.state.cartridge) return;
    const cartridge = this.state.cartridge;
    const save = this.core.getSave();
    const now = Date.now();
    if (save?.length) {
      await this.deps.storage.putBattery({
        romId: cartridge.id,
        data: copyBuffer(save),
        updatedAt: now,
      });
    }
    if (withSnapshot && ['running', 'paused'].includes(this.state.status)) {
      await this.capture(0);
    }
    await this.core.FSSync();
    const elapsed = this.sessionSeconds;
    if (elapsed) {
      await this.deps.storage.recordPlayTime(cartridge.id, elapsed);
      this.sessionSeconds -= elapsed;
    }
    if (save?.length || withSnapshot) this.update({ lastSavedAt: now });
  }

  persist(withSnapshot = false): Promise<void> {
    return this.enqueue(() => this.internalPersist(withSnapshot));
  }

  private async capture(slot: number) {
    const core = this.core;
    const cartridge = this.state.cartridge;
    if (!core || !cartridge || !this.canvas) throw new Error('请先启动游戏，再保存进度。');
    if (!core.saveState(slot)) throw new Error('即时存档失败，请稍后重试。');
    const path = `${core.filePaths().saveStatePath}/${cartridge.id}.ss${slot}`;
    const data = core.FS.readFile(path);
    const snapshot: Snapshot = {
      key: `${cartridge.id}:${slot}`,
      romId: cartridge.id,
      slot,
      data: copyBuffer(data),
      thumbnail: this.screenshot(),
      updatedAt: Date.now(),
      coreVersion: CORE_VERSION,
    };
    await this.deps.storage.putSnapshot(snapshot);
    if (slot === 0) this.lastAutoCapture = this.deps.clock.now();
    this.update({
      snapshots: [
        ...this.state.snapshots.filter((item) => item.slot !== slot && item.romId === cartridge.id),
        snapshot,
      ],
      lastSavedAt: snapshot.updatedAt,
    });
    return snapshot;
  }

  saveSlot(slot: number): Promise<void> {
    return this.enqueue(async () => {
      await this.capture(slot);
      await this.core?.FSSync();
    });
  }

  /**
   * Restores an active snapshot into running CPU/video/active SRAM memory.
   *
   * In mGBA 2.5.1 (specifically GB/GBC _GBCoreSavedataRestore in src/gb/core.c),
   * forced writeback (flags & SAVESTATE_SAVEDATA, used by loadState with SAVESTATE_ALL=31)
   * flushes to the backing VFile without refreshing live mapped SRAM. The non-writeback
   * path uses GBSavedataMask and immediately updates active SRAM memory.
   *
   * The pinned SDK's raw loadStateSlot default mask is 61 (which excludes flag 2),
   * correctly restoring active memory across all platforms while leaving synchronous file
   * writeback to in-game saves. Because loadStateSlot lacks internal thread interrupt
   * wrappers, we explicitly pause the core around it and preserve original running ownership.
   */
  private restoreState(core: mGBAEmulator, slot: number, resumeAfter: boolean): boolean {
    core.pauseGame();
    try {
      return core.loadStateSlot(slot, 61);
    } finally {
      if (resumeAfter) core.resumeGame();
    }
  }

  private async internalLoadSlot(snapshot: Snapshot): Promise<void> {
    if (!this.core || snapshot.romId !== this.state.cartridge?.id) {
      throw new Error('这份即时存档不属于当前卡带。');
    }
    if (snapshot.coreVersion !== CORE_VERSION) {
      throw new Error('这份即时存档来自不同版本的模拟器，请改用 .sav 游戏存档。');
    }
    const path = `${this.core.filePaths().saveStatePath}/${snapshot.romId}.ss${snapshot.slot}`;
    this.core.FS.writeFile(path, new Uint8Array(snapshot.data));
    if (!this.restoreState(this.core, snapshot.slot, this.state.status === 'running')) {
      throw new Error('即时存档读取失败，原文件可能已损坏。');
    }
    await this.internalPersist();
    if (this.state.status === 'paused') this.resume();
  }

  loadSlot(snapshot: Snapshot): Promise<void> {
    return this.enqueue(() => this.internalLoadSlot(snapshot));
  }

  deleteSlot(snapshot: Snapshot): Promise<void> {
    return this.enqueue(async () => {
      const core = this.core;
      const cartridge = this.state.cartridge;
      if (!core || snapshot.romId !== cartridge?.id) {
        throw new Error('这份即时存档不属于当前卡带。');
      }
      if (![1, 2, 3].includes(snapshot.slot)) throw new Error('只能清除手动即时存档。');

      const key = `${cartridge.id}:${snapshot.slot}`;
      await this.deps.storage.deleteSnapshot(key);
      this.update({ snapshots: this.state.snapshots.filter((item) => item.key !== key) });

      const path = `${core.filePaths().saveStatePath}/${cartridge.id}.ss${snapshot.slot}`;
      if (core.FS.analyzePath(path).exists) core.FS.unlink(path);
      await core.FSSync();
    });
  }

  exportBattery(): Promise<ArrayBuffer> {
    return this.enqueue(async () => {
      await this.internalPersist();
      const battery = this.state.cartridge
        ? await this.deps.storage.getBattery(this.state.cartridge.id)
        : null;
      if (!battery?.data.byteLength) throw new Error('尚无游戏存档。请先在游戏菜单中选择 SAVE。');
      return battery.data;
    });
  }

  private async internalImportBattery(data: ArrayBuffer): Promise<void> {
    const cartridge = this.state.cartridge;
    const core = this.core;
    const canvas = this.canvas;
    const wasRunning = this.state.status === 'running';
    if (!core || !cartridge || !canvas) throw new Error('请先启动对应的卡带。');

    this.stopTimer();
    try {
      await this.deps.storage.replaceBattery({
        romId: cartridge.id,
        data,
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (wasRunning) {
        this.startTimer();
      }
      throw error;
    }

    core.quitGame();
    try {
      const livePlayTime = this.state.seconds;
      await this.internalLoad(
        {
          ...cartridge,
          playTime: Math.max(cartridge.playTime, livePlayTime - this.sessionSeconds),
        },
        canvas,
        false,
        true,
      );
    } catch (bootError) {
      this.update({ cartridge, status: 'error', error: message(bootError) });
      throw bootError;
    }
  }

  importBattery(data: ArrayBuffer): Promise<void> {
    return this.enqueue(() => this.internalImportBattery(data));
  }

  screenshot() {
    if (!this.core || !this.state.cartridge) throw new Error('请先启动游戏。');
    const filename = 'pocket-preview.png';
    if (!this.core.screenshot(filename)) throw new Error('截图失败，请稍后重试。');
    const path = `${this.core.filePaths().screenshotsPath}/${filename}`;
    const png = this.core.FS.readFile(path);
    this.core.FS.unlink(path);
    let binary = '';
    for (let offset = 0; offset < png.length; offset += 32768) {
      binary += String.fromCharCode(...png.subarray(offset, offset + 32768));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  }

  private fail(error: unknown) {
    this.stopTimer();
    if (this.core?.gameName) this.core.pauseGame();
    this.update({ status: 'error', error: message(error), fps: null });
  }
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
