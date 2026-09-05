import type { Snapshot } from './storage';

export type SnapshotAction = 'load' | 'replace' | 'delete';

export interface PendingSnapshot {
  action: SnapshotAction;
  snapshot: Snapshot;
  returnTo: 'saves' | null;
}

export interface SnapshotActionState {
  pending: PendingSnapshot | null;
  busy: boolean;
  error: string | null;
}

export interface SnapshotActionController {
  getState: () => SnapshotActionState;
  subscribe: (listener: () => void) => () => void;
  requestAction: (
    action: SnapshotAction,
    snapshot: Snapshot,
    options?: { returnTo?: 'saves' | null; active?: boolean },
  ) => boolean;
  cancelAction: () => boolean;
  confirmAction: (handlers: {
    getCurrentCartridgeId: () => string | undefined;
    loadSlot: (snapshot: Snapshot) => Promise<void>;
    saveSlot: (slot: number) => Promise<void>;
    deleteSlot: (snapshot: Snapshot) => Promise<void>;
    onSuccess?: (result: {
      action: SnapshotAction;
      snapshot: Snapshot;
      returnTo: 'saves' | null;
    }) => void;
  }) => Promise<boolean>;
}

export function createSnapshotActionController(): SnapshotActionController {
  let state: SnapshotActionState = {
    pending: null,
    busy: false,
    error: null,
  };

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setState = (patch: Partial<SnapshotActionState>) => {
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
    requestAction: (action, snapshot, options = {}) => {
      const active = options.active ?? true;
      if (state.busy || !active) return false;
      setState({
        pending: {
          action,
          snapshot,
          returnTo: options.returnTo ?? null,
        },
        error: null,
      });
      return true;
    },
    cancelAction: () => {
      if (state.busy || !state.pending) return false;
      setState({ pending: null, error: null });
      return true;
    },
    confirmAction: async (handlers) => {
      if (state.busy || !state.pending) return false;
      const { action, snapshot, returnTo } = state.pending;
      setState({ busy: true, error: null });

      try {
        const currentRomId = handlers.getCurrentCartridgeId();
        if (snapshot.romId !== currentRomId) {
          throw new Error('当前卡带已切换，请重新选择即时存档。');
        }

        if (action === 'load') {
          await handlers.loadSlot(snapshot);
        } else if (action === 'replace') {
          await handlers.saveSlot(snapshot.slot);
        } else {
          await handlers.deleteSlot(snapshot);
        }

        setState({ pending: null, busy: false, error: null });
        handlers.onSuccess?.({ action, snapshot, returnTo });
        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '即时存档操作失败，请重试。';
        setState({ busy: false, error: errorMessage });
        return false;
      }
    },
  };
}
