// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ComponentProps } from 'react';
import { Console, MobileControls } from '../../src/components/Console';
import { InputController, type GameButton } from '../../src/lib/input';
import { DEFAULT_EDITION } from '../../src/lib/catalog';

describe('Console and MobileControls components', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setupConsole(props: Partial<ComponentProps<typeof Console>> = {}) {
    const canvasRef = createRef<HTMLCanvasElement>();
    const emit = vi.fn();
    const input = new InputController(emit);
    const pressed = new Set<GameButton>();
    const onStart = vi.fn();
    const onResume = vi.fn();

    const defaultProps: ComponentProps<typeof Console> = {
      edition: DEFAULT_EDITION,
      system: 'GBA',
      canvasRef,
      status: 'running',
      filter: 'crisp',
      input,
      pressed,
      hasCartridge: true,
      expanded: false,
      onStart,
      onResume,
      ...props,
    };

    const utils = render(<Console {...defaultProps} />);
    return { ...utils, canvasRef, emit, input, onStart, onResume };
  }

  it('renders canvas element with DOM identity preserved across rerenders and systems', () => {
    const canvasRef = createRef<HTMLCanvasElement>();
    const emit = vi.fn();
    const input = new InputController(emit);

    const { rerender } = render(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="running"
        filter="crisp"
        input={input}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    const initialCanvas = canvasRef.current;
    expect(initialCanvas).toBeInstanceOf(HTMLCanvasElement);

    // Rerender with different edition, status, and system
    rerender(
      <Console
        edition={{ ...DEFAULT_EDITION, english: 'Sapphire' }}
        system="GBC"
        canvasRef={canvasRef}
        status="paused"
        filter="lcd"
        input={input}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    expect(canvasRef.current).toBe(initialCanvas);
  });

  it('displays boot screen for idle, loading, and error states with correct cartridge label', async () => {
    // 1. Idle with hasCartridge=true
    const { onStart, rerender, canvasRef, input } = setupConsole({
      status: 'idle',
      hasCartridge: true,
    });

    const startBtn = screen.getByRole('button', { name: /开始冒险/ });
    expect(startBtn).toBeDefined();
    await userEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledTimes(1);

    // 2. Idle with hasCartridge=false and unknown edition
    rerender(
      <Console
        edition={undefined}
        system="GB"
        canvasRef={canvasRef}
        status="idle"
        filter="crisp"
        input={input}
        pressed={new Set()}
        hasCartridge={false}
        expanded={false}
        onStart={onStart}
        onResume={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /载入游戏卡带/ })).toBeDefined();
    expect(screen.getByText('WELCOME TO YOUR NEXT ADVENTURE')).toBeDefined();

    // 3. Error state
    rerender(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="error"
        filter="crisp"
        input={input}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={onStart}
        onResume={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /开始冒险/ })).toBeDefined();

    // 4. Loading state disables button
    rerender(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="loading"
        filter="crisp"
        input={input}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={onStart}
        onResume={vi.fn()}
      />,
    );

    expect(screen.getByText(/正在唤醒掌机/)).toBeDefined();
    expect(screen.getByRole('button', { name: /正在唤醒掌机/ }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('displays paused screen and triggers onResume when clicked', async () => {
    const { onResume } = setupConsole({ status: 'paused' });

    const pauseBtn = screen.getByRole('button', { name: '点击画面继续游戏' });
    expect(pauseBtn).toBeDefined();
    await userEvent.click(pauseBtn);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('enables shoulder buttons L and R only on GBA system, disabling on GB/GBC and when inactive', () => {
    // On GBA running, shoulder buttons are active
    const { rerender, canvasRef, input } = setupConsole({ system: 'GBA', status: 'running' });
    const lButtonGBA = screen.getByRole('button', { name: '游戏按键 L' });
    const rButtonGBA = screen.getByRole('button', { name: '游戏按键 R' });
    expect(lButtonGBA.hasAttribute('disabled')).toBe(false);
    expect(rButtonGBA.hasAttribute('disabled')).toBe(false);

    // On GBA paused (inactive), shoulder buttons and d-pad are disabled
    rerender(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="paused"
        filter="crisp"
        input={input}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '游戏按键 L' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '方向上' }).hasAttribute('disabled')).toBe(true);

    // On GBC running, shoulder buttons are disabled
    rerender(
      <Console
        edition={DEFAULT_EDITION}
        system="GBC"
        canvasRef={canvasRef}
        status="running"
        filter="crisp"
        input={input}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    const lButtonGBC = screen.getByRole('button', { name: '游戏按键 L' });
    expect(lButtonGBC.hasAttribute('disabled')).toBe(true);
  });

  it('handles complete ordered pointer transitions (down, up, cancel, lostCapture)', () => {
    const { emit } = setupConsole({ status: 'running' });
    const aButton = screen.getByRole('button', { name: '游戏按键 A' });
    aButton.setPointerCapture = vi.fn();

    // 1. PointerDown -> PointerUp
    fireEvent.pointerDown(aButton, { pointerId: 10 });
    expect(aButton.setPointerCapture).toHaveBeenCalledWith(10);
    fireEvent.pointerUp(aButton, { pointerId: 10 });

    // 2. PointerDown -> PointerCancel
    fireEvent.pointerDown(aButton, { pointerId: 20 });
    fireEvent.pointerCancel(aButton, { pointerId: 20 });

    // 3. PointerDown -> LostPointerCapture
    fireEvent.pointerDown(aButton, { pointerId: 30 });
    fireEvent.lostPointerCapture(aButton, { pointerId: 30 });

    expect(emit.mock.calls).toEqual([
      ['A', true],
      ['A', false],
      ['A', true],
      ['A', false],
      ['A', true],
      ['A', false],
    ]);
  });

  it('handles virtual keyboard events (Space, Enter, blur) with exact ordered transitions', () => {
    const { emit } = setupConsole({ status: 'running' });
    const bButton = screen.getByRole('button', { name: '游戏按键 B' });

    // KeyDown Space -> KeyUp Space
    fireEvent.keyDown(bButton, { code: 'Space' });
    fireEvent.keyUp(bButton, { code: 'Space' });

    // KeyDown Enter -> blur
    fireEvent.keyDown(bButton, { code: 'Enter' });
    fireEvent.blur(bButton);

    expect(emit.mock.calls).toEqual([
      ['B', true],
      ['B', false],
      ['B', true],
      ['B', false],
    ]);
  });

  it('observes resize and calculates proportional --console-scale with padding and unequal dimensions', () => {
    let resizeCallback: (() => void) | undefined;
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();

    class FakeResizeObserver {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      observe = observeSpy;
      disconnect = disconnectSpy;
      unobserve = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const parent = document.createElement('div');
    // Parent client size 1000 x 600, padding 20 on each side -> available: width 960, height 560
    Object.defineProperty(parent, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(parent, 'clientHeight', { value: 600, configurable: true });
    document.body.appendChild(parent);

    // Use real spy on getComputedStyle before render so initial fitConsole gets padding
    const computedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingTop: '20px',
          paddingBottom: '20px',
        }) as CSSStyleDeclaration,
    );

    const canvasRef = createRef<HTMLCanvasElement>();
    const { container, unmount, rerender } = render(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="running"
        filter="crisp"
        input={new InputController(vi.fn())}
        pressed={new Set()}
        hasCartridge={true}
        expanded={true}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
      { container: parent },
    );

    const consoleWrap = container.querySelector('.console-wrap') as HTMLElement;
    // Console element size 480 x 320 -> ratios: 960/480 = 2.0, 560/320 = 1.75 -> scale: 1.75 (limiting height)
    Object.defineProperty(consoleWrap, 'offsetWidth', { value: 480, configurable: true });
    Object.defineProperty(consoleWrap, 'offsetHeight', { value: 320, configurable: true });

    // Assert both elements were observed (viewport and device)
    expect(observeSpy).toHaveBeenCalledWith(parent);
    expect(observeSpy).toHaveBeenCalledWith(consoleWrap);

    // Initial scale calculation via observer callback
    resizeCallback?.();
    expect(consoleWrap.style.getPropertyValue('--console-scale')).toBe('1.75');

    // Trigger second resize where width becomes the limiting axis
    // available width: 500 - 40 = 460 -> 460/480 = ~0.9583
    Object.defineProperty(parent, 'clientWidth', { value: 500, configurable: true });
    resizeCallback?.();
    const secondScale = parseFloat(consoleWrap.style.getPropertyValue('--console-scale'));
    expect(secondScale).toBeCloseTo(460 / 480, 4);

    // When dimensions are invalid or zero, previous valid scale is retained and finite/positive
    Object.defineProperty(parent, 'clientWidth', { value: 0, configurable: true });
    resizeCallback?.();
    const retainedScale = parseFloat(consoleWrap.style.getPropertyValue('--console-scale'));
    expect(retainedScale).toBeCloseTo(secondScale, 4);
    expect(retainedScale).toBeGreaterThan(0);
    expect(Number.isFinite(retainedScale)).toBe(true);

    // Rerender with expanded=false removes --console-scale and disconnects observer
    rerender(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="running"
        filter="crisp"
        input={new InputController(vi.fn())}
        pressed={new Set()}
        hasCartridge={true}
        expanded={false}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(consoleWrap.style.getPropertyValue('--console-scale')).toBe('');

    // Re-expanding attaches observer again
    rerender(
      <Console
        edition={DEFAULT_EDITION}
        system="GBA"
        canvasRef={canvasRef}
        status="running"
        filter="crisp"
        input={new InputController(vi.fn())}
        pressed={new Set()}
        hasCartridge={true}
        expanded={true}
        onStart={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(observeSpy).toHaveBeenCalledTimes(4); // 2 elements observed twice

    // Final unmount disconnects observer
    unmount();
    expect(disconnectSpy).toHaveBeenCalledTimes(2);
    expect(consoleWrap.style.getPropertyValue('--console-scale')).toBe('');
    computedStyleSpy.mockRestore();
    parent.remove();
  });

  it('renders MobileControls and handles shoulder buttons for GBA vs GBC', () => {
    const emit = vi.fn();
    const input = new InputController(emit);

    const { rerender } = render(
      <MobileControls system="GBA" status="running" input={input} pressed={new Set()} />,
    );

    const lTouchGBA = screen.getByRole('button', { name: '游戏按键 L' });
    const rTouchGBA = screen.getByRole('button', { name: '游戏按键 R' });
    expect(lTouchGBA.hasAttribute('disabled')).toBe(false);
    expect(rTouchGBA.hasAttribute('disabled')).toBe(false);

    lTouchGBA.setPointerCapture = vi.fn();
    fireEvent.pointerDown(lTouchGBA, { pointerId: 5 });
    expect(emit).toHaveBeenCalledWith('L', true);

    fireEvent.pointerUp(lTouchGBA, { pointerId: 5 });
    expect(emit).toHaveBeenCalledWith('L', false);

    // On GBC, shoulder buttons are disabled
    rerender(<MobileControls system="GBC" status="running" input={input} pressed={new Set()} />);
    const lTouchGBC = screen.getByRole('button', { name: '游戏按键 L' });
    expect(lTouchGBC.hasAttribute('disabled')).toBe(true);
  });
});
