// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyBindings } from '../../src/components/KeyBindings';
import { defaultBindings } from '../../src/lib/key-bindings';

describe('KeyBindings component', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders all keybinding rows with primary and secondary slots', () => {
    const bindings = defaultBindings();
    render(<KeyBindings bindings={bindings} onChange={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 3, name: /按键映射/ })).toBeDefined();
    expect(screen.getByRole('button', { name: '修改 A 主要键位' })).toBeDefined();
    expect(screen.getByRole('button', { name: '修改 B 主要键位' })).toBeDefined();
  });

  it('enters capture state on slot click and cancels on second click', async () => {
    const bindings = defaultBindings();
    render(<KeyBindings bindings={bindings} onChange={vi.fn()} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });
    expect(aSlot.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(aSlot);
    expect(aSlot.getAttribute('aria-pressed')).toBe('true');
    expect(aSlot.textContent).toBe('按键…');
    expect(screen.getByText(/请按下 A 的新键位/)).toBeDefined();

    // Click again cancels capture
    await userEvent.click(aSlot);
    expect(aSlot.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('已取消修改。')).toBeDefined();
  });

  it('captures a valid key successfully, fires onChange, and displays feedback', () => {
    const bindings = defaultBindings();
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlot);

    fireEvent.keyDown(window, { code: 'KeyK' });
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        A: ['KeyK'],
      }),
    );
    expect(screen.getByText(/A 已设为 K，已自动保存。/)).toBeDefined();
  });

  it('cancels capture on Escape or Tab key without firing onChange', () => {
    const bindings = defaultBindings();
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });

    // Cancel via Escape
    fireEvent.click(aSlot);
    fireEvent.keyDown(window, { code: 'Escape' });
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByText('已取消修改。')).toBeDefined();

    // Cancel via Tab
    fireEvent.click(aSlot);
    fireEvent.keyDown(window, { code: 'Tab' });
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByText('已取消修改。')).toBeDefined();
  });

  it('ignores repeat key events', () => {
    const bindings = defaultBindings();
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlot);

    fireEvent.keyDown(window, { code: 'KeyK', repeat: true });
    expect(handleChange).not.toHaveBeenCalled();
    expect(aSlot.textContent).toBe('按键…');
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['altKey', { altKey: true }],
    ['metaKey', { metaKey: true }],
  ])('rejects modifier combinations (%s) with error feedback', (_name, modifier) => {
    const bindings = defaultBindings();
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlot);

    fireEvent.keyDown(window, { code: 'KeyK', ...modifier });
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByText(/请按单个按键，不要同时按下/)).toBeDefined();
  });

  it('reports conflict error when trying to bind an already assigned key and allows successful retry', () => {
    const bindings = defaultBindings(); // A = KeyO, B = KeyP
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlot);

    // Try assigning KeyP (already assigned to B) -> conflict
    fireEvent.keyDown(window, { code: 'KeyP' });
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByText(/已分配给 B/)).toBeDefined();

    // Now retry with unassigned KeyK -> success
    fireEvent.keyDown(window, { code: 'KeyK' });
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        A: ['KeyK'],
      }),
    );
    expect(screen.getByText(/A 已设为 K/)).toBeDefined();
  });

  it('removes secondary binding when clicking the remove button', async () => {
    const bindings = {
      ...defaultBindings(),
      A: ['KeyO', 'KeyJ'],
    };
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const removeBtn = screen.getByRole('button', { name: '移除 A 备用键位' });
    await userEvent.click(removeBtn);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        A: ['KeyO'],
      }),
    );
    expect(screen.getByText('A 的备用键位已移除。')).toBeDefined();
  });

  it('resets all keybindings to default on button click', async () => {
    const bindings = {
      ...defaultBindings(),
      A: ['KeyK'],
    };
    const handleChange = vi.fn();
    render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const resetBtn = screen.getByRole('button', { name: /恢复默认键位/ });
    await userEvent.click(resetBtn);

    expect(handleChange).toHaveBeenCalledWith(defaultBindings());
    expect(screen.getByText(/已恢复默认键位/)).toBeDefined();
  });

  it('cleans up window keydown listener when unmounted during capture, preventing subsequent calls', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const bindings = defaultBindings();
    const handleChange = vi.fn();
    const { unmount } = render(<KeyBindings bindings={bindings} onChange={handleChange} />);

    const aSlot = screen.getByRole('button', { name: '修改 A 主要键位' });
    fireEvent.click(aSlot);

    const keydownCall = addEventListenerSpy.mock.calls.find(
      (call) => (call[0] as string) === 'keydown' && call[2] === true,
    );
    expect(keydownCall).toBeDefined();
    const registeredHandler = keydownCall?.[1];

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', registeredHandler, true);

    // Firing keydown on window after unmount should not trigger onChange
    fireEvent.keyDown(window, { code: 'KeyK' });
    expect(handleChange).not.toHaveBeenCalled();
  });
});
