import { BUTTONS, type GameButton } from './input';

export type KeyBindings = Record<GameButton, string[]>;

export const BINDING_LABELS: { button: GameButton; label: string }[] = [
  { button: 'Up', label: '↑ 上' },
  { button: 'A', label: 'A · 确认' },
  { button: 'Down', label: '↓ 下' },
  { button: 'B', label: 'B · 取消' },
  { button: 'Left', label: '← 左' },
  { button: 'Start', label: 'START' },
  { button: 'Right', label: '→ 右' },
  { button: 'Select', label: 'SELECT' },
  { button: 'L', label: 'L · 肩键' },
  { button: 'R', label: 'R · 肩键' },
];

export const DEFAULT_BINDINGS: Readonly<Record<GameButton, readonly string[]>> = {
  A: ['KeyO'],
  B: ['KeyP'],
  Up: ['ArrowUp', 'KeyW'],
  Down: ['ArrowDown', 'KeyS'],
  Left: ['ArrowLeft', 'KeyA'],
  Right: ['ArrowRight', 'KeyD'],
  Start: ['Enter'],
  Select: ['ShiftLeft', 'ShiftRight'],
  L: ['KeyQ'],
  R: ['KeyE'],
};

const SHORTCUTS: Record<string, string> = {
  Space: '暂停 / 继续',
  KeyM: '静音',
  KeyF: '全屏',
  Backquote: '临时加速',
  Escape: '取消 / 关闭窗口',
  Tab: '切换焦点',
};

export function defaultBindings(): KeyBindings {
  return Object.fromEntries(
    BUTTONS.map((button) => [button, [...DEFAULT_BINDINGS[button]]]),
  ) as KeyBindings;
}

export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: '左 Shift',
    ShiftRight: '右 Shift',
    Enter: 'Enter',
    Space: 'Space',
    Backquote: '`',
    Backspace: '⌫',
    Minus: '−',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    IntlBackslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    NumpadEnter: 'Num ↵',
    NumpadAdd: 'Num +',
    NumpadSubtract: 'Num −',
    NumpadMultiply: 'Num ×',
    NumpadDivide: 'Num ÷',
    NumpadDecimal: 'Num .',
  };
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return names[code] ?? code;
}

export function bindingText(bindings: KeyBindings, button: GameButton): string {
  return bindings[button].map(keyLabel).join(' / ');
}

export function keyRestriction(code: string): string | null {
  if (SHORTCUTS[code]) return `${keyLabel(code)} 已用于${SHORTCUTS[code]}，请选择其他按键。`;
  if (
    /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Enter|Backspace|Minus|Equal|Bracket(Left|Right)|Backslash|IntlBackslash|Semicolon|Quote|Comma|Period|Slash|Home|End|PageUp|PageDown|Insert|Delete|Numpad(Enter|Add|Subtract|Multiply|Divide|Decimal))$/.test(
      code,
    )
  )
    return null;
  return '这个按键由浏览器或系统保留，请选择字母、方向键或数字键。';
}

export function keyMap(bindings: KeyBindings): Readonly<Record<string, GameButton>> {
  return Object.fromEntries(
    BUTTONS.flatMap((button) => bindings[button].map((code) => [code, button])),
  );
}

/** Accept only complete, non-conflicting maps; old or damaged preferences get safe defaults. */
export function parseBindings(value: unknown): KeyBindings {
  if (!value || typeof value !== 'object') return defaultBindings();
  const candidate = value as Record<string, unknown>;
  const used = new Set<string>();
  const parsed = {} as KeyBindings;
  for (const button of BUTTONS) {
    const codes = candidate[button];
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > 2) return defaultBindings();
    for (const code of codes) {
      if (typeof code !== 'string' || keyRestriction(code) || used.has(code))
        return defaultBindings();
      used.add(code);
    }
    parsed[button] = [...codes];
  }
  return parsed;
}

export function bindKey(
  bindings: KeyBindings,
  button: GameButton,
  index: number,
  code: string,
): KeyBindings {
  const restriction = keyRestriction(code);
  if (restriction) throw new Error(restriction);
  const conflict = BUTTONS.find((other) =>
    bindings[other].some((key, slot) => key === code && (other !== button || slot !== index)),
  );
  if (conflict) {
    const label = BINDING_LABELS.find((item) => item.button === conflict)?.label ?? conflict;
    throw new Error(`${keyLabel(code)} 已分配给 ${label}，请先修改该键位或选择其他按键。`);
  }
  const codes = [...bindings[button]];
  codes[index] = code;
  return { ...bindings, [button]: codes };
}
