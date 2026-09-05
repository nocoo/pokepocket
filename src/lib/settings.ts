import { defaultBindings, parseBindings, type KeyBindings } from './key-bindings';

export interface Settings {
  volume: number;
  muted: boolean;
  filter: 'crisp' | 'lcd';
  autoPause: boolean;
  bindings: KeyBindings;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.65,
  muted: false,
  filter: 'crisp',
  autoPause: true,
  bindings: defaultBindings(),
};

export function loadSettings(): Settings {
  try {
    const data: Partial<Settings> = JSON.parse(localStorage.getItem('pocket-settings') ?? '{}');
    return {
      volume:
        typeof data.volume === 'number' && Number.isFinite(data.volume)
          ? Math.max(0, Math.min(1, data.volume))
          : DEFAULT_SETTINGS.volume,
      muted: typeof data.muted === 'boolean' ? data.muted : false,
      filter: data.filter === 'lcd' ? 'lcd' : 'crisp',
      autoPause: typeof data.autoPause === 'boolean' ? data.autoPause : true,
      bindings: parseBindings(data.bindings),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, bindings: defaultBindings() };
  }
}
