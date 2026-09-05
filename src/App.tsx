import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  AudioLines,
  Bookmark,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Heart,
  Keyboard,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { Console, MobileControls } from './components/Console';
import { SeriesLibrary } from './components/SeriesLibrary';
import { CartridgeGallery } from './components/CartridgeGallery';
import { KeyBindings } from './components/KeyBindings';
import {
  DEFAULT_EDITION,
  getEdition,
  type AvailableEdition,
  type PokemonEdition,
} from './lib/catalog';
import { Modal } from './components/Modal';
import { SaveSlots } from './components/SaveSlots';
import { SnapshotConfirmation } from './components/SnapshotConfirmation';
import { createModalPauseController, type ModalName } from './lib/modal-pause';
import { createSnapshotActionController, type SnapshotAction } from './lib/snapshot-action';
import {
  createCartridgeOrchestrator,
  type CartridgePreferences,
} from './lib/cartridge-orchestrator';
import { cartridgeTitle, validateBatterySave, type Cartridge } from './lib/cartridge';
import { CORE_VERSION, PocketEmulator, message } from './lib/emulator';
import { BUTTONS, InputController, gamepadButtons, isEditing, type GameButton } from './lib/input';
import { bindingText, keyLabel, keyMap } from './lib/key-bindings';
import { loadSettings, type Settings } from './lib/settings';
import { download, storage, type Snapshot } from './lib/storage';
import { upscaleScreenshot } from './lib/screenshot';
import { APP_VERSION } from './lib/version';

type Toast = { text: string; error: boolean; id: number };

function playTime(seconds: number) {
  const h = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function relativeTime(timestamp: number | null) {
  if (!timestamp) return '等待你的第一次冒险';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  return minutes < 1
    ? '刚刚保存在此设备'
    : minutes < 60
      ? `${minutes} 分钟前已保存`
      : new Date(timestamp).toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
}

export default function App() {
  const [emulator] = useState(() => new PocketEmulator());
  const game = useSyncExternalStore(emulator.subscribe, emulator.getSnapshot);
  const [pressed, setPressed] = useState<Set<GameButton>>(new Set());
  const [input] = useState(
    () =>
      new InputController((button, down) => {
        emulator.button(button, down);
        setPressed((current) => {
          const next = new Set(current);
          if (down) next.add(button);
          else next.delete(button);
          return next;
        });
      }),
  );
  const [cartridgeOrchestrator] = useState(() => createCartridgeOrchestrator());
  const cartridgeState = useSyncExternalStore(
    cartridgeOrchestrator.subscribe,
    cartridgeOrchestrator.getState,
  );
  const { library, selectedId, selectedEditionId, available, catalogReady, storageReady, view } =
    cartridgeState;
  const setView = useCallback(
    (nextView: 'library' | 'play') => {
      cartridgeOrchestrator.setView(nextView);
    },
    [cartridgeOrchestrator],
  );
  const [settings, setSettings] = useState(loadSettings);
  const keyboardMap = useMemo(() => keyMap(settings.bindings), [settings.bindings]);
  const [modalPause] = useState(() => createModalPauseController());
  const modalPauseState = useSyncExternalStore(modalPause.subscribe, modalPause.getState);
  const modal = modalPauseState.modal;
  const [snapshotActions] = useState(() => createSnapshotActionController());
  const snapshotActionState = useSyncExternalStore(
    snapshotActions.subscribe,
    snapshotActions.getState,
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const isGeneralBusy = useRef(false);
  const [busy, setBusy] = useState(false);
  const effectiveBusy =
    busy || cartridgeState.busy || snapshotActionState.busy || snapshotActions.getState().busy;
  const [dragging, setDragging] = useState(false);
  const [gamepad, setGamepad] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ data: ArrayBuffer; name: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const romInput = useRef<HTMLInputElement>(null);
  const saveInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const preferredEdition = getEdition(selectedEditionId) ?? DEFAULT_EDITION;
  const selected =
    library.find((item) => item.id === selectedId) ??
    library.find((item) => item.header.editionId === preferredEdition.id) ??
    null;
  const current = game.cartridge ?? selected;
  const selectedEdition = selected ? getEdition(selected.header.editionId) : preferredEdition;
  const edition = current ? getEdition(current.header.editionId) : preferredEdition;
  const active = game.status === 'running' || game.status === 'paused';
  const localAvailable = available.some(
    (item) => item.id === preferredEdition.id && item.available,
  );
  const title = current ? cartridgeTitle(current) : `宝可梦 ${preferredEdition.name}`;
  const autoSnapshot = game.snapshots.find((item) => item.slot === 0);

  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error, id: Date.now() }),
    [],
  );
  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      if (
        isGeneralBusy.current ||
        snapshotActions.getState().busy ||
        cartridgeOrchestrator.getState().busy
      )
        return;
      isGeneralBusy.current = true;
      setBusy(true);
      try {
        await action();
        if (success) notify(success);
      } catch (error) {
        notify(message(error), true);
      } finally {
        isGeneralBusy.current = false;
        setBusy(false);
      }
    },
    [notify, snapshotActions, cartridgeOrchestrator],
  );

  const savePreferences = useCallback((prefs: CartridgePreferences) => {
    try {
      if (prefs.lastCartridgeId !== undefined) {
        if (prefs.lastCartridgeId)
          localStorage.setItem('pocket-last-cartridge', prefs.lastCartridgeId);
        else localStorage.removeItem('pocket-last-cartridge');
      }
      if (prefs.lastEditionId) {
        localStorage.setItem('pocket-last-edition', prefs.lastEditionId);
      }
    } catch {
      /* Optional preference */
    }
  }, []);

  useEffect(() => {
    cartridgeOrchestrator.setDependencies({
      storage: {
        listCartridges: () => storage.listCartridges(),
        putCartridge: (cart) => storage.putCartridge(cart),
      },
      fetchCatalog: async () => {
        const response = await fetch('/api/catalog');
        if (!response.ok) throw new Error('Catalog fetch failed');
        const data: { editions: AvailableEdition[] } = await response.json();
        return data.editions;
      },
      loadPreferences: () => ({
        lastCartridgeId: localStorage.getItem('pocket-last-cartridge'),
        lastEditionId: localStorage.getItem('pocket-last-edition'),
      }),
      savePreferences,
      emulator: {
        getSnapshot: () => emulator.getSnapshot(),
        load: (cart, canvas) => emulator.load(cart, canvas),
        resume: () => emulator.resume(),
        pause: () => emulator.pause(),
        persist: (cp) => emulator.persist(cp),
      },
      getCanvas: () => canvasRef.current,
      releaseInput: () => input.releaseAll(),
      isExternalBusy: () => isGeneralBusy.current || snapshotActions.getState().busy,
      openPicker: () => romInput.current?.click(),
      onBeforeReturnToGallery: () => setFocusMode(false),
      notify,
    });
  }, [cartridgeOrchestrator, emulator, input, notify, savePreferences, snapshotActions]);

  useEffect(() => {
    let cancelled = false;
    void cartridgeOrchestrator.initialize({
      onStorageError: (error) => {
        if (!cancelled) notify(`无法访问本地存储：${message(error)}`, true);
      },
    });
    return () => {
      cancelled = true;
      cartridgeOrchestrator.cancel();
    };
  }, [cartridgeOrchestrator, notify]);

  useEffect(() => {
    emulator.setVolume(settings.muted ? 0 : settings.volume);
    try {
      localStorage.setItem('pocket-settings', JSON.stringify(settings));
    } catch {
      /* Settings remain in memory. */
    }
  }, [settings, emulator]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 7500 : 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (game.error) notify(game.error, true);
  }, [game.error, notify]);
  useEffect(() => {
    if (game.resumedAutomatically) notify('已继续上次的冒险，欢迎回来。');
  }, [game.resumedAutomatically, notify]);
  useEffect(() => {
    if (game.status !== 'running') input.releaseAll();
  }, [game.status, input]);

  const openModal = useCallback(
    (name: Exclude<ModalName, null>) => {
      input.releaseAll();
      const currentSnapshot = emulator.getSnapshot();
      const { shouldPause, shouldPersist } = modalPause.openModal(name, {
        isRunning: currentSnapshot.status === 'running',
        hasCartridge: Boolean(currentSnapshot.cartridge),
      });
      if (shouldPause) emulator.pause();
      if (shouldPersist && currentSnapshot.cartridge) {
        void emulator.persist(true).catch((error) => notify(message(error), true));
      }
    },
    [emulator, input, modalPause, notify],
  );

  const closeModal = useCallback(() => {
    const { shouldResume } = modalPause.closeModal({ currentView: view });
    if (shouldResume) emulator.resume();
  }, [emulator, modalPause, view]);

  const insertCartridge = useCallback(
    async (file: File) => {
      await cartridgeOrchestrator.insertCartridgeFile(file);
    },
    [cartridgeOrchestrator],
  );

  const finishCartridgePicker = useCallback(() => {
    cartridgeOrchestrator.finishCartridgePicker();
  }, [cartridgeOrchestrator]);

  useEffect(() => {
    const picker = romInput.current;
    picker?.addEventListener('cancel', finishCartridgePicker);
    return () => picker?.removeEventListener('cancel', finishCartridgePicker);
  }, [finishCartridgePicker]);

  const startAdventure = useCallback(() => {
    void cartridgeOrchestrator.startAdventure();
  }, [cartridgeOrchestrator]);

  const chooseCartridge = (cartridge: Cartridge) => {
    void cartridgeOrchestrator.selectCartridge(cartridge);
  };

  const chooseEdition = (next: PokemonEdition) => {
    void cartridgeOrchestrator.selectEdition(next.id);
  };

  const returnToGallery = useCallback(() => {
    void cartridgeOrchestrator.returnToGallery();
  }, [cartridgeOrchestrator]);

  const toggleFullscreen = useCallback(() => {
    if (focusMode) {
      setFocusMode(false);
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch((error) => notify(message(error), true));
      return;
    }
    if (stageRef.current?.requestFullscreen)
      void stageRef.current.requestFullscreen().catch(() => setFocusMode(true));
    else setFocusMode(true);
  }, [focusMode, notify]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    let heldSpeed: number | null = null;
    const keydown = (event: KeyboardEvent) => {
      if (
        view !== 'play' ||
        modal ||
        isEditing(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button, a') &&
        ['Enter', 'Space'].includes(event.code)
      )
        return;
      const state = emulator.getSnapshot();
      const button = keyboardMap[event.code];
      if (button && state.status === 'running') {
        event.preventDefault();
        input.set(`key:${event.code}`, button, true);
        return;
      }
      if (event.repeat) return;
      if (event.code === 'Space' && ['running', 'paused'].includes(state.status)) {
        event.preventDefault();
        if (state.status === 'running') {
          emulator.pause();
          void emulator.persist(true).catch((error) => notify(message(error), true));
        } else emulator.resume();
      }
      if (event.code === 'KeyM')
        setSettings((currentSettings) => ({ ...currentSettings, muted: !currentSettings.muted }));
      if (event.code === 'KeyF') toggleFullscreen();
      if (event.code === 'Escape' && focusMode) setFocusMode(false);
      if (event.code === 'Backquote' && state.status === 'running') {
        event.preventDefault();
        heldSpeed = state.speed;
        emulator.setSpeed(3);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      const button = keyboardMap[event.code];
      if (button) input.set(`key:${event.code}`, button, false);
      if (event.code === 'Backquote' && heldSpeed !== null) {
        emulator.setSpeed(heldSpeed);
        heldSpeed = null;
      }
    };
    const blur = () => {
      input.releaseAll();
      if (heldSpeed !== null) {
        emulator.setSpeed(heldSpeed);
        heldSpeed = null;
      }
    };
    const visibility = () => {
      if (document.hidden) {
        blur();
        if (settings.autoPause) emulator.pause();
        if (emulator.getSnapshot().cartridge)
          void emulator.persist(true).catch((error) => notify(message(error), true));
      }
    };
    const pagehide = () => {
      blur();
      if (emulator.getSnapshot().cartridge) void emulator.persist(true).catch(() => {});
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      blur();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [
    emulator,
    input,
    modal,
    settings.autoPause,
    toggleFullscreen,
    focusMode,
    notify,
    keyboardMap,
    view,
  ]);

  useEffect(() => {
    let frame = 0;
    let previousPads = new Set<number>();
    let lastName = '';
    const poll = () => {
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter((pad): pad is Gamepad =>
        Boolean(pad?.connected),
      );
      const name = pads[0]?.id ?? '';
      if (name !== lastName) {
        setGamepad(name);
        lastName = name;
      }
      const enabled = view === 'play' && !modal && emulator.getSnapshot().status === 'running';
      const currentPads = new Set(pads.map((pad) => pad.index));
      for (const pad of pads) {
        const down = enabled ? gamepadButtons(pad) : new Set<GameButton>();
        for (const button of BUTTONS) input.set(`pad:${pad.index}`, button, down.has(button));
      }
      for (const index of previousPads)
        if (!currentPads.has(index))
          for (const button of BUTTONS) input.set(`pad:${index}`, button, false);
      previousPads = currentPads;
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      for (const index of previousPads)
        for (const button of BUTTONS) input.set(`pad:${index}`, button, false);
    };
  }, [emulator, input, modal, view]);

  const requestSnapshotAction = (action: SnapshotAction, snapshot: Snapshot) => {
    if (effectiveBusy || !active) return;
    const requested = snapshotActions.requestAction(action, snapshot, {
      returnTo: modal === 'saves' ? 'saves' : null,
      active,
    });
    if (!requested) return;
    if (modal === 'saves') modalPause.setModalDirectly('snapshot');
    else openModal('snapshot');
  };

  const closeSnapshotConfirmation = () => {
    if (snapshotActionState.busy) return;
    const returnTo = snapshotActionState.pending?.returnTo;
    snapshotActions.cancelAction();
    if (returnTo === 'saves') modalPause.setModalDirectly('saves');
    else closeModal();
  };

  const confirmSnapshotAction = async () => {
    await snapshotActions.confirmAction({
      getCurrentCartridgeId: () => emulator.getSnapshot().cartridge?.id,
      isExternalBusy: () => isGeneralBusy.current || cartridgeOrchestrator.getState().busy,
      loadSlot: (slotSnapshot) => emulator.loadSlot(slotSnapshot),
      saveSlot: (slot) => emulator.saveSlot(slot),
      deleteSlot: (slotSnapshot) => emulator.deleteSlot(slotSnapshot),
      onSuccess: ({ action, snapshot, returnTo }) => {
        if (action !== 'load' && returnTo === 'saves') modalPause.setModalDirectly('saves');
        else closeModal();
        if (action === 'load') setView('play');
        notify(
          action === 'load'
            ? '欢迎回来，接着冒险吧。'
            : `即时存档 0${snapshot.slot} 已${action === 'replace' ? '替换为当前进度' : '清除'}`,
        );
      },
    });
  };

  const saveSlot = (slot: number) => {
    if (effectiveBusy || !active) return;
    const snapshot = game.snapshots.find((item) => item.slot === slot);
    if (snapshot) requestSnapshotAction('replace', snapshot);
    else void run(() => emulator.saveSlot(slot), `冒险已记录在存档 0${slot}`);
  };
  const loadSlot = (snapshot: Snapshot) => requestSnapshotAction('load', snapshot);
  const deleteSlot = (snapshot: Snapshot) => requestSnapshotAction('delete', snapshot);
  const exportSave = () => {
    void run(async () => {
      const data = await emulator.exportBattery();
      download(data, `${current?.fileName.replace(/\.(gba|gbc|gb)$/i, '') ?? 'game'}.sav`);
    }, '游戏存档已导出');
  };
  const patchSettings = (patch: Partial<Settings>) =>
    setSettings((previous) => ({ ...previous, ...patch }));
  const screenshot = () => {
    void run(async () => {
      const url = emulator.screenshot();
      const blob = await upscaleScreenshot(url);
      download(blob, `pocket-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, 'image/png');
    }, '1080p 截图已保存，这一刻留下了。');
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop file target on full page container
    <div
      className={`pocket-app view-${view}`}
      style={
        {
          '--edition-color':
            (view === 'library' ? preferredEdition : edition)?.color ?? DEFAULT_EDITION.color,
        } as CSSProperties
      }
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !effectiveBusy) void insertCartridge(file);
      }}
    >
      <a href={view === 'library' ? '#cartridge-gallery' : '#game-stage'} className="skip-link">
        {view === 'library' ? '跳转到卡带盘' : '跳转到游戏'}
      </a>
      <input
        type="file"
        ref={romInput}
        tabIndex={-1}
        accept=".gb,.gbc,.gba"
        className="file-input"
        aria-label="载入 GB / GBC / GBA 卡带"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file && !effectiveBusy) {
            void insertCartridge(file).finally(() => {
              finishCartridgePicker();
            });
          } else {
            finishCartridgePicker();
          }
        }}
      />
      <input
        type="file"
        ref={saveInput}
        tabIndex={-1}
        accept=".sav"
        className="file-input"
        aria-label="导入游戏存档"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file && current && !effectiveBusy)
            void run(async () => {
              if (!/\.sav$/i.test(file.name)) throw new Error('请选择 .sav 格式的游戏存档。');
              validateBatterySave(file.size, current.header);
              setPendingSave({ data: await file.arrayBuffer(), name: file.name });
              openModal('import-save');
            });
        }}
      />

      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href="/"
            aria-label="Poké Pocket 首页"
            onClick={(event) => {
              event.preventDefault();
              returnToGallery();
            }}
          >
            <img src="/favicon.svg" width="36" height="36" alt="" />
            <span>
              poké<span className="brand-light">pocket</span>
              <small>小小口袋，大大冒险。</small>
            </span>
          </a>
          <nav className="header-nav" aria-label="主导航">
            <button
              type="button"
              aria-label="卡带收藏"
              className={!modal && view === 'library' ? 'nav-item active' : 'nav-item'}
              disabled={effectiveBusy}
              onClick={returnToGallery}
            >
              <Gamepad2 size={17} />
              <span>卡带收藏</span>
            </button>
            <button
              type="button"
              aria-label="我的存档"
              disabled={effectiveBusy || game.status === 'loading'}
              className={modal === 'saves' ? 'nav-item active' : 'nav-item'}
              onClick={() => openModal('saves')}
            >
              <Bookmark size={16} />
              <span>我的存档</span>
            </button>
            <button
              type="button"
              aria-label="游玩指南"
              disabled={effectiveBusy || game.status === 'loading'}
              className={modal === 'help' ? 'nav-item active' : 'nav-item'}
              onClick={() => openModal('help')}
            >
              <CircleHelp size={17} />
              <span>游玩指南</span>
            </button>
          </nav>
          <div className="header-right">
            <span className={`local-status ${storageReady ? 'ready' : ''}`}>
              <i />
              {storageReady ? '本地存储已就绪' : '正在连接存储'}
            </span>
            <button
              type="button"
              className="icon-button settings-button"
              disabled={effectiveBusy || game.status === 'loading'}
              onClick={() => openModal('settings')}
              aria-label="打开设置"
            >
              <Settings2 size={19} />
            </button>
          </div>
        </div>
      </header>

      {view === 'library' && (
        <CartridgeGallery
          edition={preferredEdition}
          library={library}
          available={available}
          catalogReady={catalogReady}
          busy={effectiveBusy}
          onEdition={chooseEdition}
          onStart={startAdventure}
        />
      )}

      {/* mGBA owns this canvas for its lifetime. Hide the stage; never remount it when browsing. */}
      <div className="app-layout" hidden={view !== 'play'}>
        <SeriesLibrary
          edition={selectedEdition}
          cartridge={selected}
          library={library}
          available={available}
          busy={effectiveBusy}
          onEdition={chooseEdition}
          onCartridge={chooseCartridge}
        />

        <main className="main-column">
          <div className="page-heading">
            <div>
              <button
                type="button"
                className="back-to-gallery"
                aria-label="返回卡带盘"
                onClick={returnToGallery}
                disabled={effectiveBusy}
              >
                <ArrowLeft size={14} />
                返回卡带盘<span>THE POKÉMON COLLECTION</span>
              </button>
              <h1>
                把冒险，装进口袋<span>。</span>
              </h1>
              <p>从关都到丰缘，选一枚卡带，继续你的冒险。</p>
            </div>
            <div className="region-stamp">
              <Sun size={21} strokeWidth={1.4} />
              <span>
                {edition?.regionEn ?? 'POKÉMON'} REGION
                <small>
                  {edition
                    ? `${edition.region}地区 · 第 ${edition.generation} 世代`
                    : '今天也是冒险的好日子'}
                </small>
              </span>
            </div>
          </div>
          <section
            ref={stageRef}
            id="game-stage"
            className={`game-stage ${focusMode ? 'focus-mode' : ''}`}
            aria-label="掌机模拟器"
          >
            <div className="stage-heading">
              <div>
                <span className={`live-dot ${game.status === 'running' ? 'is-live' : ''}`} />
                <h2>{title}</h2>
                <span className="stage-edition">
                  {edition?.english.toUpperCase() ?? current?.header.gameCode}
                </span>
              </div>
              <div className="stage-status">
                <span>
                  {game.status === 'running'
                    ? '正在冒险'
                    : game.status === 'paused'
                      ? '已暂停'
                      : game.status === 'loading'
                        ? '正在载入'
                        : '准备就绪'}
                </span>
                <i />
                <span className="fps" data-testid="fps">
                  {game.fps === null ? '—' : game.fps} FPS
                </span>
              </div>
            </div>
            <div className="console-viewport">
              <Console
                edition={edition}
                system={current?.header.system ?? preferredEdition.system}
                canvasRef={canvasRef}
                status={!active && busy ? 'loading' : game.status}
                filter={settings.filter}
                input={input}
                pressed={pressed}
                hasCartridge={Boolean(selected || localAvailable)}
                expanded={fullscreen || focusMode}
                onStart={startAdventure}
                onResume={() => emulator.resume()}
              />
            </div>
            <div className="stage-toolbar">
              <div className="toolbar-group">
                <button
                  type="button"
                  className="play-toggle"
                  disabled={!active || busy}
                  aria-label={game.status === 'paused' ? '继续游戏' : '暂停游戏'}
                  onClick={() => {
                    if (game.status === 'paused') emulator.resume();
                    else {
                      emulator.pause();
                      void run(() => emulator.persist(true));
                    }
                  }}
                >
                  {game.status === 'paused' ? (
                    <Play size={15} fill="currentColor" />
                  ) : (
                    <Pause size={15} fill="currentColor" />
                  )}
                  <span>{game.status === 'paused' ? '继续' : '暂停'}</span>
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  disabled={!active || busy}
                  onClick={() => openModal('restart')}
                  aria-label="重新启动游戏"
                  title="重新启动"
                >
                  <RotateCcw size={17} />
                </button>
                <span className="toolbar-divider" />
                <button
                  type="button"
                  className="toolbar-button"
                  aria-label={settings.muted ? '开启声音' : '静音'}
                  title="声音 · M"
                  onClick={() => {
                    patchSettings({ muted: !settings.muted });
                    emulator.resumeAudio();
                  }}
                >
                  {settings.muted || settings.volume === 0 ? (
                    <VolumeX size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>
                <input
                  className="volume-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.muted ? 0 : settings.volume}
                  aria-label="音量"
                  onChange={(event) => {
                    patchSettings({ volume: Number(event.target.value), muted: false });
                    emulator.resumeAudio();
                  }}
                />
              </div>
              <div className="session-clock">
                <Clock3 size={13} />
                <span data-testid="play-time">{playTime(game.seconds)}</span>
              </div>
              <div className="toolbar-group right-tools">
                <button
                  type="button"
                  className={`speed-button ${game.speed !== 1 ? 'is-fast' : ''}`}
                  onClick={() => emulator.setSpeed(game.speed === 1 ? 2 : game.speed === 2 ? 3 : 1)}
                  aria-label={`游戏速度 ${game.speed} 倍，点击切换`}
                  title="切换倍速"
                >
                  <Zap size={14} />
                  <span>{game.speed}×</span>
                </button>
                <span className="toolbar-divider" />
                <button
                  type="button"
                  className="toolbar-button screenshot-button"
                  onClick={screenshot}
                  disabled={!active || busy}
                  aria-label="保存游戏截图"
                  title="保存 1080p 截图"
                >
                  <Download size={17} />
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={toggleFullscreen}
                  aria-label={fullscreen || focusMode ? '退出全屏' : '全屏游戏'}
                  title="全屏 · F"
                >
                  {fullscreen || focusMode ? <Minimize size={17} /> : <Maximize size={17} />}
                </button>
              </div>
            </div>
            <MobileControls
              status={game.status}
              input={input}
              pressed={pressed}
              system={current?.header.system ?? preferredEdition.system}
            />
          </section>

          <div className="below-grid">
            <section className="info-card controls-card">
              <div className="card-heading">
                <h2>
                  <Keyboard size={17} />
                  操作指南
                </h2>
                <button type="button" className="text-button" onClick={() => openModal('help')}>
                  全部按键
                  <ArrowRight size={13} />
                </button>
              </div>
              <div className="control-grid">
                <div>
                  <span>移动</span>
                  <span className="key-group">
                    {(['Up', 'Down', 'Left', 'Right'] as const).map((button) => {
                      const code = settings.bindings[button][0];
                      return <kbd key={button}>{code ? keyLabel(code) : ''}</kbd>;
                    })}
                  </span>
                </div>
                <div>
                  <span>确认 / 取消</span>
                  <span className="key-group">
                    <kbd>{settings.bindings.A[0] ? keyLabel(settings.bindings.A[0]) : ''}</kbd>
                    <i>/</i>
                    <kbd>{settings.bindings.B[0] ? keyLabel(settings.bindings.B[0]) : ''}</kbd>
                  </span>
                </div>
                <div>
                  <span>开始</span>
                  <kbd className="wide-key">
                    {settings.bindings.Start[0] ? keyLabel(settings.bindings.Start[0]) : ''}
                  </kbd>
                </div>
                <div>
                  <span>选择</span>
                  <kbd className="wide-key">
                    {settings.bindings.Select[0] ? keyLabel(settings.bindings.Select[0]) : ''}
                  </kbd>
                </div>
              </div>
              <div className="controls-footnote">
                <Gamepad2 size={14} />
                <span title={gamepad}>
                  {gamepad ? '手柄已连接，准备出发' : '设置中可调整键位 · 也支持触屏与手柄'}
                </span>
              </div>
            </section>
            <section className="info-card saves-card">
              <div className="card-heading">
                <h2>
                  <Save size={16} />
                  即时存档
                </h2>
                <span className="save-location">
                  <HardDrive size={11} />
                  保存在此设备
                </span>
              </div>
              <SaveSlots
                snapshots={game.snapshots}
                active={active}
                busy={busy}
                onSave={saveSlot}
                onLoad={loadSlot}
                onDelete={deleteSlot}
              />
              <div className="saves-footnote">
                <span>
                  <CheckCheck size={13} />
                  {relativeTime(game.lastSavedAt)}
                </span>
                <button type="button" className="text-button" onClick={() => openModal('saves')}>
                  管理
                  <ChevronRight size={13} />
                </button>
              </div>
            </section>
          </div>
          <footer className="main-footer">
            <span>
              <Heart size={12} /> 为每一个舍不得结束的冒险。
            </span>
            <span>
              POKÉ POCKET <i>·</i> EST. 2026
            </span>
          </footer>
        </main>
      </div>

      {modal === 'settings' && (
        <Modal title="让掌机，更像你的。" eyebrow="MAKE IT YOURS" onClose={closeModal} wide>
          <KeyBindings
            bindings={settings.bindings}
            onChange={(bindings) => patchSettings({ bindings })}
          />
          <div className="setting-row">
            <div>
              <strong>
                <AudioLines size={17} />
                游戏音量
              </strong>
              <p>让熟悉的旋律，再次响起。</p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => patchSettings({ muted: !settings.muted })}
              aria-label={settings.muted ? '取消静音' : '静音游戏'}
            >
              {settings.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          </div>
          <div className="setting-volume">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              aria-label="设置游戏音量"
              onChange={(event) =>
                patchSettings({ volume: Number(event.target.value), muted: false })
              }
            />
            <span>{Math.round(settings.volume * 100)}%</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>屏幕风格</strong>
              <p>原生像素，或记忆中的液晶纹理。</p>
            </div>
          </div>
          <div className="filter-options">
            <button
              type="button"
              className={settings.filter === 'crisp' ? 'selected' : ''}
              onClick={() => patchSettings({ filter: 'crisp' })}
            >
              <span className="filter-preview crisp-preview" />
              清晰像素{settings.filter === 'crisp' && <Check size={14} />}
            </button>
            <button
              type="button"
              className={settings.filter === 'lcd' ? 'selected' : ''}
              onClick={() => patchSettings({ filter: 'lcd' })}
            >
              <span className="filter-preview lcd-preview" />
              复古液晶{settings.filter === 'lcd' && <Check size={14} />}
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>离开时自动暂停</strong>
              <p>切换标签页时，帮你按下暂停。</p>
            </div>
            <button
              type="button"
              className={`toggle-switch ${settings.autoPause ? 'on' : ''}`}
              role="switch"
              aria-checked={settings.autoPause}
              aria-label="离开时自动暂停"
              onClick={() => patchSettings({ autoPause: !settings.autoPause })}
            >
              <span />
            </button>
          </div>
          <div className="settings-about">
            <img src="/favicon.svg" alt="" width="30" height="30" />
            <div>
              <strong>Poké Pocket v{APP_VERSION}</strong>
              <span>{game.coreVersion || `mGBA WASM ${CORE_VERSION}`} · 冒险始于一枚卡带</span>
              <a
                className="text-button"
                href="/licenses/NOTICE.txt"
                target="_blank"
                rel="noreferrer"
              >
                开源组件与许可
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'saves' && (
        <Modal
          title="把这一刻，好好收起来。"
          eyebrow="YOUR ADVENTURE, SAVED"
          onClose={closeModal}
          wide
        >
          <p className="modal-intro">
            {active
              ? `${title} · ${playTime(game.seconds)} 的冒险时光`
              : '启动卡带后，就可以在这里管理你的游戏进度。'}
          </p>
          <SaveSlots
            snapshots={game.snapshots}
            active={active}
            busy={busy}
            onSave={saveSlot}
            onLoad={loadSlot}
            onDelete={deleteSlot}
          />
          <div className="autosave-row">
            <span className="autosave-icon">
              <Clock3 size={19} />
            </span>
            <div>
              <strong>自动记录</strong>
              <p>
                {autoSnapshot
                  ? relativeTime(autoSnapshot.updatedAt)
                  : '游戏中每 30 秒，以及暂停时，自动记录进度。'}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={!active || !autoSnapshot || busy}
              onClick={() => autoSnapshot && loadSlot(autoSnapshot)}
            >
              恢复进度
              <ArrowRight size={14} />
            </button>
          </div>
          <div className="save-transfer">
            <div>
              <h3>游戏存档 · .sav</h3>
              <p>与游戏内的 SAVE 对应，也可在其他模拟器中继续。</p>
            </div>
            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={!active || busy}
                onClick={() => saveInput.current?.click()}
              >
                <ArrowUpFromLine size={15} />
                导入
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!active || busy}
                onClick={exportSave}
              >
                <ArrowDownToLine size={15} />
                导出存档
              </button>
            </div>
          </div>
          <div className="modal-tip">
            <ShieldCheck size={17} />
            <span>进度保存在当前浏览器。换设备或清理浏览器数据前，请导出 .sav 存档。</span>
          </div>
        </Modal>
      )}

      {modal === 'snapshot' && snapshotActionState.pending && (
        <SnapshotConfirmation
          action={snapshotActionState.pending.action}
          snapshot={snapshotActionState.pending.snapshot}
          gameTitle={title}
          busy={snapshotActionState.busy}
          error={snapshotActionState.error}
          onClose={closeSnapshotConfirmation}
          onConfirm={() => void confirmSnapshotAction()}
        />
      )}

      {modal === 'help' && (
        <Modal title="你好，训练家。" eyebrow="A SMALL FIELD GUIDE" onClose={closeModal} wide>
          <p className="modal-intro">载入卡带，按下开始。剩下的，交给你的冒险精神。</p>
          <div className="help-steps">
            <div>
              <span>01</span>
              <strong>插入你的卡带</strong>
              <p>
                选择喜欢的版本，导入你的 GB、GBC 或 GBA 卡带。卡带只保存在当前浏览器，
                下次回来直接开始；已就绪的卡带无需再次导入。
              </p>
            </div>
            <div>
              <span>02</span>
              <strong>从熟悉的地方出发</strong>
              <p>游戏内选择 CONTINUE 读取 .sav，或通过「我的存档」恢复即时进度。</p>
            </div>
          </div>
          <div className="full-keyboard">
            {[
              [
                '向上 / 向下',
                `${bindingText(settings.bindings, 'Up')} · ${bindingText(settings.bindings, 'Down')}`,
              ],
              [
                '向左 / 向右',
                `${bindingText(settings.bindings, 'Left')} · ${bindingText(settings.bindings, 'Right')}`,
              ],
              ['A · 确认 / 互动', bindingText(settings.bindings, 'A')],
              ['B · 取消 / 返回', bindingText(settings.bindings, 'B')],
              ['START · 游戏菜单', bindingText(settings.bindings, 'Start')],
              ['SELECT · 选择', bindingText(settings.bindings, 'Select')],
              [
                'L / R · 肩键',
                `${bindingText(settings.bindings, 'L')} · ${bindingText(settings.bindings, 'R')}`,
              ],
              ['暂停 / 继续', 'Space'],
              ['静音 / 全屏', 'M / F'],
              ['按住加速至 3×', '`'],
            ].map(([label, keys]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
          <div className="modal-tip">
            <Gamepad2 size={19} />
            <span>
              {gamepad
                ? `已连接：${gamepad}`
                : '连接标准游戏手柄后，按任意键即可启用。手机也可使用画面下方的触摸按键。'}
            </span>
          </div>
          {current && (
            <details className="cartridge-details">
              <summary>
                查看当前卡带信息
                <ChevronRight size={14} />
              </summary>
              <dl>
                <div>
                  <dt>文件</dt>
                  <dd>{current.fileName}</dd>
                </div>
                <div>
                  <dt>游戏代码</dt>
                  <dd>
                    {current.header.gameCode} · v{current.header.version}
                  </dd>
                </div>
                <div>
                  <dt>容量 / 存储</dt>
                  <dd>
                    {(current.header.size / 1048576).toFixed(2)} MB · {current.header.saveType}
                  </dd>
                </div>
                <div>
                  <dt>实时时钟</dt>
                  <dd>{current.header.rtc ? '已识别，使用设备时间' : '卡带未声明 RTC'}</dd>
                </div>
                <div>
                  <dt>ROM SHA-256</dt>
                  <dd className="hash-value">{current.id}</dd>
                </div>
              </dl>
            </details>
          )}
          <div className="help-note">
            <Sparkles size={15} />
            <p>
              GB / GBC 游戏画面为 160 × 144，支持的初代卡带会显示 Super Game Boy 原生边框；GBA 为
              240 × 160。暂不支持联机交换与对战。
            </p>
          </div>
        </Modal>
      )}

      {modal === 'restart' && (
        <Modal title="重新开启这段冒险？" eyebrow="BACK TO THE TITLE" onClose={closeModal}>
          <p className="modal-intro">
            掌机会回到游戏标题画面。当前进度会先记录为自动存档，也可以继续读取游戏内的 SAVE。
          </p>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={closeModal}>
              再玩一会儿
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await emulator.reset();
                  closeModal();
                  setView('play');
                }, '掌机已重新启动');
              }}
            >
              <RotateCcw size={15} />
              重新启动
            </button>
          </div>
        </Modal>
      )}

      {modal === 'import-save' && (
        <Modal title="从这份存档继续？" eyebrow="WELCOME BACK" onClose={closeModal}>
          <p className="modal-intro">
            <strong>{pendingSave?.name}</strong>
            <br />
            将替换当前卡带的游戏存档并重新启动。已有的即时存档仍会保留。
          </p>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={closeModal}>
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !pendingSave}
              onClick={() => {
                if (pendingSave)
                  void run(async () => {
                    await emulator.importBattery(pendingSave.data);
                    setPendingSave(null);
                    closeModal();
                    setView('play');
                  }, '存档已导入，请在游戏中选择 CONTINUE');
              }}
            >
              <Upload size={15} />
              导入并启动
            </button>
          </div>
        </Modal>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <FolderOpen size={42} />
            <strong>把卡带放进来。</strong>
            <span>松开即可载入 GB / GBC / GBA 游戏</span>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
