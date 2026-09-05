import { describe, expect, it, vi } from 'vitest';
import { GlobalWindow } from 'happy-dom';
import { BUTTONS, InputController, gamepadButtons, isEditing } from '../../src/lib/input';

describe('input controller and gamepad mapping', () => {
  const window = new GlobalWindow();
  const document = window.document;
  it('BUTTONS constant has all 10 standard buttons', () => {
    expect(BUTTONS).toEqual(['A', 'B', 'Select', 'Start', 'Right', 'Left', 'Up', 'Down', 'R', 'L']);
  });

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

  it('maps gamepad buttons accurately based on pressed states', () => {
    const mockGamepad = {
      buttons: [
        { pressed: true }, // 0: A
        { pressed: false }, // 1: B
        { pressed: false },
        { pressed: false },
        { pressed: true }, // 4: L
        { pressed: false }, // 5: R
        { pressed: false },
        { pressed: false },
        { pressed: true }, // 8: Select
        { pressed: false }, // 9: Start
        { pressed: false },
        { pressed: false },
        { pressed: false }, // 12: Up
        { pressed: true }, // 13: Down
        { pressed: false }, // 14: Left
        { pressed: false }, // 15: Right
      ],
      axes: [0, 0],
    } as unknown as Gamepad;

    const pressed = gamepadButtons(mockGamepad);
    expect(pressed.has('A')).toBe(true);
    expect(pressed.has('L')).toBe(true);
    expect(pressed.has('Select')).toBe(true);
    expect(pressed.has('Down')).toBe(true);
    expect(pressed.has('B')).toBe(false);
    expect(pressed.has('R')).toBe(false);
    expect(pressed.has('Up')).toBe(false);
  });

  it('detects directional d-pad input from analog axes thresholds', () => {
    // Left & Up
    const gpLeftUp = {
      buttons: [],
      axes: [-0.8, -0.6],
    } as unknown as Gamepad;
    const pressedLeftUp = gamepadButtons(gpLeftUp);
    expect(pressedLeftUp.has('Left')).toBe(true);
    expect(pressedLeftUp.has('Up')).toBe(true);
    expect(pressedLeftUp.has('Right')).toBe(false);
    expect(pressedLeftUp.has('Down')).toBe(false);

    // Right & Down
    const gpRightDown = {
      buttons: [],
      axes: [0.9, 0.5],
    } as unknown as Gamepad;
    const pressedRightDown = gamepadButtons(gpRightDown);
    expect(pressedRightDown.has('Right')).toBe(true);
    expect(pressedRightDown.has('Down')).toBe(true);
    expect(pressedRightDown.has('Left')).toBe(false);
    expect(pressedRightDown.has('Up')).toBe(false);

    // Deadzone (below 0.45)
    const gpDeadzone = {
      buttons: [],
      axes: [-0.3, 0.4],
    } as unknown as Gamepad;
    const pressedDeadzone = gamepadButtons(gpDeadzone);
    expect(pressedDeadzone.size).toBe(0);

    // Empty axes / undefined handling
    const gpEmpty = {
      buttons: [],
      axes: [],
    } as unknown as Gamepad;
    expect(gamepadButtons(gpEmpty).size).toBe(0);
  });

  it('determines if an event target is an editing field', () => {
    const origHTMLElement = globalThis.HTMLElement;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
    try {
      expect(isEditing(null)).toBe(false);

      const div = document.createElement('div') as unknown as EventTarget;
      expect(isEditing(div)).toBe(false);

      const editableDiv = document.createElement('div');
      editableDiv.contentEditable = 'true';
      expect(isEditing(editableDiv as unknown as EventTarget)).toBe(true);

      const inputEl = document.createElement('input') as unknown as EventTarget;
      expect(isEditing(inputEl)).toBe(true);

      const textareaEl = document.createElement('textarea') as unknown as EventTarget;
      expect(isEditing(textareaEl)).toBe(true);

      const selectEl = document.createElement('select') as unknown as EventTarget;
      expect(isEditing(selectEl)).toBe(true);
    } finally {
      globalThis.HTMLElement = origHTMLElement;
    }
  });
});
