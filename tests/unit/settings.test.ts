import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings } from '../../src/lib/settings';
import { defaultBindings } from '../../src/lib/key-bindings';

describe('settings persistence and boundaries', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.localStorage = originalLocalStorage;
  });

  it('returns default settings when storage is empty', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps volume to [0, 1] range', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ volume: 1.5 }),
    });
    expect(loadSettings().volume).toBe(1);

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ volume: -0.2 }),
    });
    expect(loadSettings().volume).toBe(0);

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ volume: 0.45 }),
    });
    expect(loadSettings().volume).toBe(0.45);
  });

  it('falls back to default volume when non-finite or not a number', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ volume: 'loud' }),
    });
    expect(loadSettings().volume).toBe(DEFAULT_SETTINGS.volume);

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ volume: null }),
    });
    expect(loadSettings().volume).toBe(DEFAULT_SETTINGS.volume);

    // Valid JSON with 1e309 evaluates to Infinity (non-finite)
    vi.stubGlobal('localStorage', {
      getItem: () => '{"volume":1e309}',
    });
    expect(loadSettings().volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('parses filter values strictly, defaulting to crisp on unrecognized values', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ filter: 'lcd' }),
    });
    expect(loadSettings().filter).toBe('lcd');

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ filter: 'blur' }),
    });
    expect(loadSettings().filter).toBe('crisp');

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ filter: null }),
    });
    expect(loadSettings().filter).toBe('crisp');
  });

  it('handles boolean properties muted and autoPause with safe defaults', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ muted: true, autoPause: false }),
    });
    const s1 = loadSettings();
    expect(s1.muted).toBe(true);
    expect(s1.autoPause).toBe(false);

    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ muted: 'yes', autoPause: 'no' }),
    });
    const s2 = loadSettings();
    expect(s2.muted).toBe(false);
    expect(s2.autoPause).toBe(true);
  });

  it('recovers with complete default settings if localStorage.getItem throws or throws JSON syntax error', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: Access denied');
      },
    });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, bindings: defaultBindings() });

    vi.stubGlobal('localStorage', {
      getItem: () => '{ invalid json',
    });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, bindings: defaultBindings() });
  });
});
