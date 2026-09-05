import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindKey, defaultBindings, keyMap, parseBindings } from '../../src/lib/key-bindings';
import { loadSettings } from '../../src/lib/settings';

afterEach(() => vi.unstubAllGlobals());

describe('persistent keyboard mappings', () => {
  it('uses O/P for A/B while retaining both left-hand and arrow movement', () => {
    const keys = keyMap(defaultBindings());
    expect(keys).toMatchObject({
      KeyO: 'A',
      KeyP: 'B',
      KeyW: 'Up',
      KeyA: 'Left',
      ArrowLeft: 'Left',
    });
    expect(keys.KeyX).toBeUndefined();
    expect(keys.KeyZ).toBeUndefined();
  });

  it('migrates existing display preferences without retaining the old X/Z defaults', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ volume: 0.3, filter: 'lcd', muted: true, autoPause: false }),
    });
    expect(loadSettings()).toEqual({
      volume: 0.3,
      filter: 'lcd',
      muted: true,
      autoPause: false,
      bindings: defaultBindings(),
    });
  });

  it('round-trips remapped buttons and alternative keys without changing other controls', () => {
    const original = defaultBindings();
    const remapped = bindKey(bindKey(original, 'A', 0, 'KeyK'), 'B', 1, 'KeyJ');
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ bindings: remapped }) });
    const keys = keyMap(loadSettings().bindings);
    expect(keys.KeyK).toBe('A');
    expect(keys.KeyJ).toBe('B');
    expect(keys.KeyP).toBe('B');
    expect(keys.KeyO).toBeUndefined();
    expect(original.A).toEqual(['KeyO']);
    expect(original.B).toEqual(['KeyP']);
  });

  it('refuses duplicate controls or application shortcuts instead of silently shadowing them', () => {
    const bindings = defaultBindings();
    expect(() => bindKey(bindings, 'A', 0, 'KeyW')).toThrow('已分配给');
    expect(() => bindKey(bindings, 'A', 1, 'KeyO')).toThrow('已分配给');
    for (const code of ['Space', 'KeyM', 'KeyF', 'Backquote', 'Tab', 'Escape']) {
      expect(() => bindKey(bindings, 'A', 0, code)).toThrow('已用于');
    }
    expect(() => bindKey(bindings, 'A', 0, 'MetaLeft')).toThrow('浏览器或系统');
    expect(bindings.A).toEqual(['KeyO']);
  });

  it('recovers from corrupt, incomplete, conflicting or unsafe stored mappings', () => {
    for (const value of [
      null,
      [],
      { A: ['KeyK'] },
      { ...defaultBindings(), A: ['KeyW'] },
      { ...defaultBindings(), Start: [] },
      { ...defaultBindings(), B: ['Space'] },
      { ...defaultBindings(), B: [42] },
      { ...defaultBindings(), B: ['KeyX', 'KeyJ', 'KeyK'] },
    ]) {
      expect(parseBindings(value)).toEqual(defaultBindings());
    }
    vi.stubGlobal('localStorage', { getItem: () => '{' });
    expect(loadSettings().bindings).toEqual(defaultBindings());
  });
});
