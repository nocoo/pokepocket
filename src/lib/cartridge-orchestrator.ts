import { type Cartridge, readCartridge } from './cartridge';
import { DEFAULT_EDITION, getEdition, type AvailableEdition } from './catalog';

export interface CartridgePreferences {
  lastCartridgeId: string | null;
  lastEditionId: string | null;
}

export interface CartridgeStorageAdapter {
  listCartridges: () => Promise<Cartridge[]>;
  putCartridge: (cartridge: Cartridge) => Promise<void>;
}

export interface CartridgeOrchestrationState {
  library: Cartridge[];
  selectedId: string | null;
  selectedEditionId: string;
  available: AvailableEdition[];
  catalogReady: boolean;
  storageReady: boolean;
  view: 'library' | 'play';
  busy: boolean;
}

export interface EmulatorBridge {
  getSnapshot: () => { status: string; cartridge: Cartridge | null };
  load: (cartridge: Cartridge, canvas: HTMLCanvasElement) => Promise<void>;
  resume: () => void;
  pause: () => void;
  persist: (checkpoint: boolean) => Promise<void>;
}

export interface CartridgeOrchestratorDependencies {
  storage: CartridgeStorageAdapter;
  fetchCatalog: () => Promise<AvailableEdition[]>;
  loadPreferences: () => CartridgePreferences;
  savePreferences: (prefs: CartridgePreferences) => void;
  emulator: EmulatorBridge;
  getCanvas: () => HTMLCanvasElement | null;
  releaseInput: () => void;
  isExternalBusy: () => boolean;
  onStorageError?: (error: unknown) => void;
  notify?: (message: string, isError?: boolean) => void;
  openPicker?: () => void;
  onBeforeReturnToGallery?: () => void;
}

export interface CartridgeOrchestrator {
  getState: () => CartridgeOrchestrationState;
  subscribe: (listener: () => void) => () => void;
  initialize: (deps?: Partial<CartridgeOrchestratorDependencies>) => Promise<void>;
  cancel: () => void;
  refreshLibrary: () => Promise<void>;
  selectEdition: (editionId: string) => Promise<boolean>;
  selectCartridge: (cartridge: Cartridge) => Promise<boolean>;
  startAdventure: () => Promise<boolean>;
  insertCartridgeFile: (file: File) => Promise<boolean>;
  returnToGallery: () => Promise<boolean>;
  openCartridgePicker: () => boolean;
  finishCartridgePicker: () => void;
  setView: (view: 'library' | 'play') => void;
  setDependencies: (deps: Partial<CartridgeOrchestratorDependencies>) => void;
}

export function createCartridgeOrchestrator(
  initialDeps?: Partial<CartridgeOrchestratorDependencies>,
): CartridgeOrchestrator {
  let deps: CartridgeOrchestratorDependencies = {
    storage: {
      listCartridges: async () => [],
      putCartridge: async () => {},
    },
    fetchCatalog: async () => [],
    loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: null }),
    savePreferences: () => {},
    emulator: {
      getSnapshot: () => ({ status: 'stopped', cartridge: null }),
      load: async () => {},
      resume: () => {},
      pause: () => {},
      persist: async () => {},
    },
    getCanvas: () => null,
    releaseInput: () => {},
    isExternalBusy: () => false,
    ...initialDeps,
  };

  let state: CartridgeOrchestrationState = {
    library: [],
    selectedId: null,
    selectedEditionId: DEFAULT_EDITION.id,
    available: [],
    catalogReady: false,
    storageReady: false,
    view: 'library',
    busy: false,
  };

  let storageInitSeq = 0;
  let catalogInitSeq = 0;
  let userSelected = false;
  let isCancelled = false;
  let pickerWasRunning = false;

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setState = (patch: Partial<CartridgeOrchestrationState>) => {
    state = { ...state, ...patch };
    emit();
  };

  const isOperationBusy = () => {
    return state.busy || deps.isExternalBusy();
  };

  const runWithBusy = async <T>(action: () => Promise<T>): Promise<T | null> => {
    if (isOperationBusy()) return null;
    setState({ busy: true });
    try {
      return await action();
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : '操作失败，请检查文件或稍后重试。';
      deps.notify?.(errMessage, true);
      return null;
    } finally {
      setState({ busy: false });
    }
  };

  const executeInsertCartridgeFile = async (file: File) => {
    const incoming = await readCartridge(file);
    const existingList = await deps.storage.listCartridges();
    const existing = existingList.find((item) => item.id === incoming.id);
    const cartridge = existing ?? incoming;

    await deps.storage.putCartridge(cartridge);
    const updatedList = await deps.storage.listCartridges();

    userSelected = true;
    storageInitSeq++;

    const editionId = cartridge.header.editionId ?? state.selectedEditionId;
    setState({
      library: updatedList,
      selectedId: cartridge.id,
      selectedEditionId: editionId,
      storageReady: true,
      view: 'play',
    });

    try {
      deps.savePreferences({
        lastCartridgeId: cartridge.id,
        lastEditionId: editionId,
      });
    } catch {
      // Optional
    }

    const canvas = deps.getCanvas();
    if (!canvas) throw new Error('游戏画面尚未就绪，请重试。');
    await deps.emulator.load(cartridge, canvas);
    canvas.focus({ preventScroll: true });

    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false);
    }
  };

  const orchestrator: CartridgeOrchestrator = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDependencies: (newDeps) => {
      deps = { ...deps, ...newDeps };
    },
    cancel: () => {
      isCancelled = true;
      storageInitSeq++;
      catalogInitSeq++;
    },
    initialize: async (customDeps) => {
      if (customDeps) deps = { ...deps, ...customDeps };
      isCancelled = false;
      const currentStorageSeq = ++storageInitSeq;
      const currentCatalogSeq = ++catalogInitSeq;

      // Independent, concurrent execution for storage and catalog fetching
      const storagePromise = (async () => {
        try {
          const cartridges = await deps.storage.listCartridges();
          if (isCancelled || currentStorageSeq !== storageInitSeq) return;

          let prefs: CartridgePreferences = { lastCartridgeId: null, lastEditionId: null };
          try {
            prefs = deps.loadPreferences();
          } catch {
            // Preferences fallback
          }

          if (userSelected) {
            // If user already interacted, preserve user selection and update only library
            setState({
              library: cartridges,
              storageReady: true,
            });
          } else {
            const previous = cartridges.find((item) => item.id === prefs.lastCartridgeId);
            const selectedId = previous?.id ?? null;
            const selectedEditionId =
              previous?.header.editionId ?? prefs.lastEditionId ?? DEFAULT_EDITION.id;
            setState({
              library: cartridges,
              storageReady: true,
              selectedId,
              selectedEditionId,
            });
          }
        } catch (err) {
          if (!isCancelled && currentStorageSeq === storageInitSeq) {
            deps.onStorageError?.(err);
          }
        }
      })();

      const catalogPromise = (async () => {
        try {
          const editions = await deps.fetchCatalog();
          if (isCancelled || currentCatalogSeq !== catalogInitSeq) return;
          setState({ available: editions, catalogReady: true });
        } catch {
          if (!isCancelled && currentCatalogSeq === catalogInitSeq) {
            setState({ catalogReady: true });
          }
        }
      })();

      await Promise.all([storagePromise, catalogPromise]);
    },
    refreshLibrary: async () => {
      try {
        const cartridges = await deps.storage.listCartridges();
        if (!isCancelled) {
          setState({ library: cartridges, storageReady: true });
        }
      } catch (err) {
        if (!isCancelled) {
          deps.onStorageError?.(err);
        }
      }
    },
    selectEdition: async (editionId) => {
      if (isOperationBusy()) return false;
      userSelected = true;

      const edition = getEdition(editionId) ?? DEFAULT_EDITION;
      const owned = state.library.find((item) => item.header.editionId === edition.id) ?? null;
      const nextId = owned?.id ?? null;

      setState({
        selectedEditionId: edition.id,
        selectedId: nextId,
      });

      try {
        deps.savePreferences({
          lastEditionId: edition.id,
          lastCartridgeId: nextId,
        });
      } catch {
        // Preferences are optional
      }

      // If in play view and cartridge changed, switch game
      const emuSnapshot = deps.emulator.getSnapshot();
      const isPlayActive =
        state.view === 'play' &&
        (emuSnapshot.status === 'running' || emuSnapshot.status === 'paused');

      if (isPlayActive && emuSnapshot.cartridge?.id !== owned?.id) {
        deps.releaseInput();
        const canvas = deps.getCanvas();
        if (owned && canvas) {
          const loadSuccess = await runWithBusy(async () => {
            await deps.emulator.load(owned, canvas);
          });
          return loadSuccess !== null;
        } else if (state.available.some((item) => item.id === edition.id && item.available)) {
          return await orchestrator.startAdventure();
        } else {
          orchestrator.openCartridgePicker();
          return true;
        }
      }
      return true;
    },
    selectCartridge: async (cartridge) => {
      if (isOperationBusy()) return false;
      userSelected = true;

      const editionId = cartridge.header.editionId ?? state.selectedEditionId;
      setState({
        selectedId: cartridge.id,
        selectedEditionId: editionId,
      });

      try {
        deps.savePreferences({
          lastCartridgeId: cartridge.id,
          lastEditionId: editionId,
        });
      } catch {
        // Optional
      }

      const emuSnapshot = deps.emulator.getSnapshot();
      const isPlayActive =
        state.view === 'play' &&
        (emuSnapshot.status === 'running' || emuSnapshot.status === 'paused');

      if (isPlayActive && emuSnapshot.cartridge?.id !== cartridge.id) {
        const canvas = deps.getCanvas();
        if (canvas) {
          deps.releaseInput();
          const loadSuccess = await runWithBusy(async () => {
            await deps.emulator.load(cartridge, canvas);
          });
          return loadSuccess !== null;
        }
      }
      return true;
    },
    startAdventure: async () => {
      if (isOperationBusy()) return false;
      const emuSnapshot = deps.emulator.getSnapshot();
      if (emuSnapshot.status === 'loading') return false;

      const preferredEdition = getEdition(state.selectedEditionId) ?? DEFAULT_EDITION;
      const selected =
        state.library.find((item) => item.id === state.selectedId) ??
        state.library.find((item) => item.header.editionId === preferredEdition.id) ??
        null;
      const localAvailable = state.available.some(
        (item) => item.id === preferredEdition.id && item.available,
      );

      if (!selected && !localAvailable) {
        orchestrator.openCartridgePicker();
        return true;
      }

      setState({ view: 'play' });

      if (selected?.id === emuSnapshot.cartridge?.id && emuSnapshot.status === 'paused') {
        deps.emulator.resume();
        deps.getCanvas()?.focus({ preventScroll: true });
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' });
        return true;
      }

      if (selected) {
        const success = await runWithBusy(async () => {
          const canvas = deps.getCanvas();
          if (!canvas) throw new Error('游戏画面尚未就绪，请重试。');
          await deps.emulator.load(selected, canvas);
          canvas.focus({ preventScroll: true });
          if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' });
        });
        return success !== null;
      }

      // Load local cartridge from catalog
      const success = await runWithBusy(async () => {
        const entry = state.available.find(
          (item) => item.id === preferredEdition.id && item.available,
        );
        if (!entry?.url) throw new Error('本地目录中未找到这枚卡带，请导入你的 ROM。');
        const response = await fetch(entry.url);
        if (!response.ok || response.headers.get('Content-Type')?.includes('text/html')) {
          throw new Error('无法读取本地卡带，请检查文件后刷新页面。');
        }
        const blob = await response.blob();
        const file = new File([blob], preferredEdition.fileName);
        await executeInsertCartridgeFile(file);
      });
      return success !== null;
    },
    insertCartridgeFile: async (file) => {
      if (isOperationBusy()) return false;

      const result = await runWithBusy(async () => {
        await executeInsertCartridgeFile(file);
      });

      return result !== null;
    },
    returnToGallery: async () => {
      if (isOperationBusy()) return false;
      const emuSnapshot = deps.emulator.getSnapshot();
      if (emuSnapshot.status === 'loading' || state.view === 'library') return false;

      deps.releaseInput();
      deps.emulator.pause();
      deps.onBeforeReturnToGallery?.();

      const success = await runWithBusy(async () => {
        if (typeof document !== 'undefined' && document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
        }
        if (emuSnapshot.cartridge) {
          await deps.emulator.persist(true);
        }
        await orchestrator.refreshLibrary();
        setState({ view: 'library' });
        if (typeof window !== 'undefined') {
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      });

      return success !== null;
    },
    openCartridgePicker: () => {
      if (isOperationBusy()) return false;
      const emuSnapshot = deps.emulator.getSnapshot();
      pickerWasRunning = emuSnapshot.status === 'running';
      deps.releaseInput();
      deps.emulator.pause();
      deps.openPicker?.();
      return true;
    },
    finishCartridgePicker: () => {
      const emuSnapshot = deps.emulator.getSnapshot();
      if (pickerWasRunning && emuSnapshot.status === 'paused') {
        deps.emulator.resume();
      }
      pickerWasRunning = false;
    },
    setView: (view) => {
      setState({ view });
    },
  };

  return orchestrator;
}
