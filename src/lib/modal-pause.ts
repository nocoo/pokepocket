export type ModalName =
  'settings' | 'saves' | 'help' | 'restart' | 'import-save' | 'snapshot' | null;

export interface ModalPauseState {
  modal: ModalName;
  runningIntent: boolean;
}

export interface ModalPauseController {
  getState: () => ModalPauseState;
  subscribe: (listener: () => void) => () => void;
  openModal: (
    modal: Exclude<ModalName, null>,
    options?: { isRunning?: boolean; hasCartridge?: boolean },
  ) => { shouldPause: boolean; shouldPersist: boolean };
  closeModal: (options?: { currentView?: 'library' | 'play' }) => { shouldResume: boolean };
  setModalDirectly: (modal: ModalName) => void;
}

export function createModalPauseController(): ModalPauseController {
  let state: ModalPauseState = {
    modal: null,
    runningIntent: false,
  };

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openModal: (modal, options = {}) => {
      const isRunning = options.isRunning ?? false;
      const hasCartridge = options.hasCartridge ?? false;
      const runningIntent = state.modal === null ? isRunning : state.runningIntent;
      state = {
        modal,
        runningIntent,
      };
      emit();
      return {
        shouldPause: isRunning,
        shouldPersist: hasCartridge,
      };
    },
    closeModal: (options = {}) => {
      const currentView = options.currentView ?? 'play';
      const shouldResume = state.runningIntent && currentView === 'play';
      state = {
        modal: null,
        runningIntent: false,
      };
      emit();
      return { shouldResume };
    },
    setModalDirectly: (modal) => {
      state = {
        ...state,
        modal,
        runningIntent: modal === null ? false : state.runningIntent,
      };
      emit();
    },
  };
}
