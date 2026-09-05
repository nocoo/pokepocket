import { describe, expect, it, vi } from 'vitest';
import { InputController } from '../../src/lib/input';

describe('input from concurrent devices', () => {
  it('keeps a key down until both touch and keyboard release it', () => {
    const emit = vi.fn();
    const input = new InputController(emit);
    input.set('keyboard', 'A', true);
    input.set('touch', 'A', true);
    input.set('keyboard', 'A', false);
    expect(emit.mock.calls).toEqual([['A', true]]);
    input.set('touch', 'A', false);
    expect(emit.mock.calls).toEqual([
      ['A', true],
      ['A', false],
    ]);
  });

  it('releases all held buttons on focus loss and ignores late releases', () => {
    const emit = vi.fn();
    const input = new InputController(emit);
    input.set('pad', 'Up', true);
    input.set('keyboard', 'B', true);
    input.set('keyboard', 'B', true);
    input.releaseAll();
    input.set('pad', 'Up', false);
    input.releaseAll();
    expect(emit.mock.calls).toEqual([
      ['Up', true],
      ['B', true],
      ['Up', false],
      ['B', false],
    ]);
  });
});
