export const BUTTONS = [
  'A',
  'B',
  'Select',
  'Start',
  'Right',
  'Left',
  'Up',
  'Down',
  'R',
  'L',
] as const;
export type GameButton = (typeof BUTTONS)[number];

/** Multiple input sources can hold the same button without releasing one another. */
export class InputController {
  private held = new Map<GameButton, Set<string>>();
  constructor(private emit: (button: GameButton, down: boolean) => void) {}

  set(source: string, button: GameButton, down: boolean) {
    const sources = this.held.get(button) ?? new Set<string>();
    const wasDown = sources.size > 0;
    if (down) sources.add(source);
    else sources.delete(source);
    if (sources.size) this.held.set(button, sources);
    else this.held.delete(button);
    if (wasDown !== sources.size > 0) this.emit(button, sources.size > 0);
  }

  releaseAll() {
    for (const button of this.held.keys()) this.emit(button, false);
    this.held.clear();
  }
}

export function gamepadButtons(gamepad: Gamepad): Set<GameButton> {
  const down = new Set<GameButton>();
  const map: [number, GameButton][] = [
    [0, 'A'],
    [1, 'B'],
    [4, 'L'],
    [5, 'R'],
    [8, 'Select'],
    [9, 'Start'],
    [12, 'Up'],
    [13, 'Down'],
    [14, 'Left'],
    [15, 'Right'],
  ];
  for (const [index, button] of map) if (gamepad.buttons[index]?.pressed) down.add(button);
  const x = gamepad.axes[0] ?? 0;
  const y = gamepad.axes[1] ?? 0;
  if (x < -0.45) down.add('Left');
  if (x > 0.45) down.add('Right');
  if (y < -0.45) down.add('Up');
  if (y > 0.45) down.add('Down');
  return down;
}

export function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}
