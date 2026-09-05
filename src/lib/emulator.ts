import type { mGBAEmulator } from '@thenick775/mgba-wasm';
import { romPath, type Cartridge } from './cartridge';
import type { GameButton } from './input';
import { copyBuffer, storage, type Snapshot } from './storage';

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

export class PocketEmulator {
  private core: mGBAEmulator | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private initializing: Promise<mGBAEmulator> | null = null;
  private loading = false;
  private listeners = new Set<() => void>();
  private frameCount = 0;
  private lastFrameTime = 0;
  private sessionSeconds = 0;
  private lastAutoCapture = 0;
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

  private async initialize(canvas: HTMLCanvasElement) {
    if (this.core) return this.core;
    if (this.initializing) return this.initializing;
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new Error('浏览器未开启共享内存。请使用本地开发地址或已配置隔离响应头的 HTTPS 网站。');
    }
    this.canvas = canvas;
    this.initializing = (async () => {
      // An absolute same-origin URL keeps Vite's dev import rewriting out of the
      // precompiled runtime, including the worker it starts from import.meta.url.
      const url = new URL(`/emulator/${CORE_VERSION}/mgba.js`, window.location.origin).href;
      const {
        default: createCore,
      }: { default: (options: { canvas: HTMLCanvasElement }) => Promise<mGBAEmulator> } =
        await import(/* @vite-ignore */ url);
      const core = await createCore({ canvas });
      await core.FSInit();
      // Keep cartridge bytes out of IDBFS: the library already stores them in IndexedDB.
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
    })();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async load(cartridge: Cartridge, canvas: HTMLCanvasElement, resumeAuto = true) {
    if (this.loading) throw new Error('正在载入卡带，请稍等。');
    this.loading = true;
    this.stopTimer();
    try {
      // Stop new autosaves and checkpoint the old game before changing any paths.
      if (this.state.cartridge && this.core) {
        this.pause();
        await this.persist(true);
      }
      this.update({ status: 'loading', error: null, fps: null, resumedAutomatically: false });
      const core = await this.initialize(canvas);
      if (this.state.cartridge) {
        core.quitGame();
        const previousPath = romPath(this.state.cartridge);
        if (core.FS.analyzePath(previousPath).exists) core.FS.unlink(previousPath);
      }
      const battery = await storage.getBattery(cartridge.id);
      const snapshots = await storage.listSnapshots(cartridge.id);
      const gamePath = romPath(cartridge);
      const savePath = `${core.filePaths().savePath}/${cartridge.id}.sav`;
      core.FS.writeFile(gamePath, new Uint8Array(cartridge.data));
      if (battery) core.FS.writeFile(savePath, new Uint8Array(battery.data));
      if (!core.loadGame(gamePath, savePath))
        throw new Error('模拟器无法启动这枚卡带，请检查 GB / GBC / GBA 文件。');
      // The core starts its CPU thread on the next rendering turn.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      this.frameCount = 0;
      this.lastFrameTime = performance.now();
      this.lastAutoCapture = performance.now();
      this.sessionSeconds = 0;
      this.savedataDirty = false;
      core.addCoreCallbacks({
        videoFrameEndedCallback: () => {
          this.frameCount++;
        },
        saveDataUpdatedCallback: () => {
          this.savedataDirty = true;
        },
        // Do not call thread-interrupting methods inside a synchronous core callback.
        coreCrashedCallback: () => {
          setTimeout(() => this.fail(new Error('游戏内核运行中断，请重新载入卡带。')), 0);
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
        resumedAutomatically = core.loadState(0);
      }
      // Restore before the UI can open a dialog and checkpoint the new session;
      // otherwise a title-screen checkpoint would erase the previous adventure.
      this.update({
        status: 'running',
        cartridge,
        snapshots,
        lastSavedAt: battery?.updatedAt ?? null,
        frames: 0,
        seconds: cartridge.playTime,
        resumedAutomatically,
      });
      await storage.recordPlayTime(cartridge.id, 0);
      this.startTimer();
      this.resumeAudio();
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.state.status !== 'running') return;
      const now = performance.now();
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
    if (this.timer) clearInterval(this.timer);
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
    this.lastFrameTime = performance.now();
    this.core?.resumeGame();
    this.update({ status: 'running' });
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
    if (context?.state === 'suspended')
      void context.resume().catch(() => {
        /* A subsequent user gesture can unlock audio. */
      });
  }

  async reset() {
    if (!this.core || !this.state.cartridge) return;
    await this.persist(true);
    this.core.quickReload();
    if (this.state.status === 'paused') this.resume();
  }

  /** Serialize all IDBFS writes and captures so autosave cannot race a cartridge switch. */
  persist(withSnapshot = false): Promise<void> {
    const task = async () => {
      if (!this.core || !this.state.cartridge) return;
      const cartridge = this.state.cartridge;
      const save = this.core.getSave();
      const now = Date.now();
      if (save?.length)
        await storage.putBattery({ romId: cartridge.id, data: copyBuffer(save), updatedAt: now });
      if (withSnapshot && ['running', 'paused'].includes(this.state.status)) await this.capture(0);
      await this.core.FSSync();
      const elapsed = this.sessionSeconds;
      this.sessionSeconds = 0;
      if (elapsed) await storage.recordPlayTime(cartridge.id, elapsed);
      if (save?.length || withSnapshot) this.update({ lastSavedAt: now });
    };
    const pending = this.saveQueue.then(task);
    this.saveQueue = pending.catch(() => {});
    return pending;
  }

  private async capture(slot: number) {
    const core = this.core;
    const cartridge = this.state.cartridge;
    if (!core || !cartridge || !this.canvas) throw new Error('请先启动游戏，再保存进度。');
    if (!core.saveState(slot)) throw new Error('即时存档失败，请稍后重试。');
    const path = `${core.filePaths().saveStatePath}/${cartridge.id}.ss${slot}`;
    const data = core.FS.readFile(path);
    // mGBA's state includes SRAM, RTC, CPU, video, audio and RAM.
    const snapshot: Snapshot = {
      key: `${cartridge.id}:${slot}`,
      romId: cartridge.id,
      slot,
      data: copyBuffer(data),
      thumbnail: this.screenshot(),
      updatedAt: Date.now(),
      coreVersion: CORE_VERSION,
    };
    await storage.putSnapshot(snapshot);
    if (slot === 0) this.lastAutoCapture = performance.now();
    this.update({
      snapshots: [...this.state.snapshots.filter((item) => item.slot !== slot), snapshot],
      lastSavedAt: snapshot.updatedAt,
    });
    return snapshot;
  }

  async saveSlot(slot: number) {
    const pending = this.saveQueue.then(async () => {
      await this.capture(slot);
      await this.core?.FSSync();
    });
    this.saveQueue = pending.catch(() => {});
    return pending;
  }

  async loadSlot(snapshot: Snapshot) {
    await this.saveQueue;
    if (!this.core || snapshot.romId !== this.state.cartridge?.id)
      throw new Error('这份即时存档不属于当前卡带。');
    if (snapshot.coreVersion !== CORE_VERSION)
      throw new Error('这份即时存档来自不同版本的模拟器，请改用 .sav 游戏存档。');
    const path = `${this.core.filePaths().saveStatePath}/${snapshot.romId}.ss${snapshot.slot}`;
    this.core.FS.writeFile(path, new Uint8Array(snapshot.data));
    if (!this.core.loadState(snapshot.slot))
      throw new Error('即时存档读取失败，原文件可能已损坏。');
    await this.persist();
    if (this.state.status === 'paused') this.resume();
  }

  async exportBattery(): Promise<ArrayBuffer> {
    await this.persist();
    const battery = this.state.cartridge ? await storage.getBattery(this.state.cartridge.id) : null;
    if (!battery?.data.byteLength) throw new Error('尚无游戏存档。请先在游戏菜单中选择 SAVE。');
    return battery.data;
  }

  async importBattery(data: ArrayBuffer) {
    await this.saveQueue;
    const cartridge = this.state.cartridge;
    const core = this.core;
    if (!core || !cartridge || !this.canvas) throw new Error('请先启动对应的卡带。');
    // Close the old save file before replacing it: a later flush must not overwrite the import.
    this.stopTimer();
    core.quitGame();
    await storage.replaceBattery({ romId: cartridge.id, data, updatedAt: Date.now() });
    this.update({ cartridge: null, status: 'idle' });
    // An imported battery save must boot normally, not restore an older snapshot.
    await this.load(cartridge, this.canvas, false);
  }

  screenshot() {
    if (!this.core || !this.state.cartridge) throw new Error('请先启动游戏。');
    // The SDL WebGL canvas does not preserve its drawing buffer between frames.
    // Capture the actual emulated video buffer through mGBA instead of toDataURL.
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
