import type { Cartridge } from './cartridge';
import { DEFAULT_EDITION, getEdition, type AvailableEdition, type PokemonEdition } from './catalog';

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
}

export interface CartridgeOrchestrator {
  getState: () => CartridgeOrchestrationState;
  subscribe: (listener: () => void) => () => void;
  initialize: (deps: {
    storage: CartridgeStorageAdapter;
    fetchCatalog: () => Promise<AvailableEdition[]>;
    loadPreferences: () => CartridgePreferences;
    onStorageError?: (error: unknown) => void;
  }) => Promise<void>;
  selectEdition: (
    editionId: string,
    savePreferences?: (prefs: CartridgePreferences) => void,
  ) => {
    selectedCartridge: Cartridge | null;
    edition: PokemonEdition;
  };
  selectCartridge: (
    cartridge: Cartridge,
    savePreferences?: (prefs: CartridgePreferences) => void,
  ) => void;
  insertCartridge: (
    cartridge: Cartridge,
    saveToStorage: (cartridge: Cartridge) => Promise<void>,
    savePreferences?: (prefs: CartridgePreferences) => void,
  ) => Promise<void>;
  setView: (view: 'library' | 'play') => void;
}

export function createCartridgeOrchestrator(): CartridgeOrchestrator {
  let state: CartridgeOrchestrationState = {
    library: [],
    selectedId: null,
    selectedEditionId: DEFAULT_EDITION.id,
    available: [],
    catalogReady: false,
    storageReady: false,
    view: 'library',
  };

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setState = (patch: Partial<CartridgeOrchestrationState>) => {
    state = { ...state, ...patch };
    emit();
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: async ({ storage, fetchCatalog, loadPreferences, onStorageError }) => {
      try {
        const cartridges = await storage.listCartridges();
        let prefs: CartridgePreferences = { lastCartridgeId: null, lastEditionId: null };
        try {
          prefs = loadPreferences();
        } catch {
          // Defaults if preferences corrupt or blocked
        }

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
      } catch (err) {
        onStorageError?.(err);
      }

      try {
        const editions = await fetchCatalog();
        setState({ available: editions, catalogReady: true });
      } catch {
        setState({ catalogReady: true });
      }
    },
    selectEdition: (editionId, savePreferences) => {
      const edition = getEdition(editionId) ?? DEFAULT_EDITION;
      const owned = state.library.find((item) => item.header.editionId === edition.id) ?? null;
      const nextId = owned?.id ?? null;

      setState({
        selectedEditionId: edition.id,
        selectedId: nextId,
      });

      try {
        savePreferences?.({
          lastEditionId: edition.id,
          lastCartridgeId: nextId,
        });
      } catch {
        // Preferences are optional
      }

      return {
        selectedCartridge: owned,
        edition,
      };
    },
    selectCartridge: (cartridge, savePreferences) => {
      const editionId = cartridge.header.editionId ?? state.selectedEditionId;
      setState({
        selectedId: cartridge.id,
        selectedEditionId: editionId,
      });

      try {
        savePreferences?.({
          lastCartridgeId: cartridge.id,
          lastEditionId: editionId,
        });
      } catch {
        // Preferences are optional
      }
    },
    insertCartridge: async (cartridge, saveToStorage, savePreferences) => {
      await saveToStorage(cartridge);
      const existingIndex = state.library.findIndex((item) => item.id === cartridge.id);
      const newLibrary =
        existingIndex >= 0
          ? state.library.map((item, idx) => (idx === existingIndex ? cartridge : item))
          : [...state.library, cartridge];

      const editionId = cartridge.header.editionId ?? state.selectedEditionId;
      setState({
        library: newLibrary,
        selectedId: cartridge.id,
        selectedEditionId: editionId,
        view: 'play',
      });

      try {
        savePreferences?.({
          lastCartridgeId: cartridge.id,
          lastEditionId: editionId,
        });
      } catch {
        // Preferences are optional
      }
    },
    setView: (view) => {
      setState({ view });
    },
  };
}
