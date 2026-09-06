import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  Play,
} from 'lucide-react';
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { PokemonEdition } from '../lib/catalog';
import type { GameSystem } from '../lib/rom-header';
import type { EmulatorStatus } from '../lib/emulator';
import type { GameButton, InputController } from '../lib/input';

interface ConsoleProps {
  edition: PokemonEdition | undefined;
  system: GameSystem;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: EmulatorStatus;
  filter: 'crisp' | 'lcd';
  input: InputController;
  pressed: Set<GameButton>;
  hasCartridge: boolean;
  expanded: boolean;
  busy?: boolean;
  onStart: () => void;
  onResume: () => void;
}

function ConsoleButton({
  button,
  children,
  className = '',
  input,
  pressed,
  active,
  label,
}: {
  button: GameButton;
  children: ReactNode;
  className?: string;
  input: InputController;
  pressed: Set<GameButton>;
  active: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`console-button ${className} ${pressed.has(button) ? 'is-pressed' : ''}`}
      aria-label={label ?? `游戏按键 ${button}`}
      disabled={!active}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        input.set(`pointer:${event.pointerId}`, button, true);
      }}
      onPointerUp={(event) => input.set(`pointer:${event.pointerId}`, button, false)}
      onPointerCancel={(event) => input.set(`pointer:${event.pointerId}`, button, false)}
      onLostPointerCapture={(event) => input.set(`pointer:${event.pointerId}`, button, false)}
      onKeyDown={(event) => {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          input.set(`virtual:${button}`, button, true);
        }
      }}
      onKeyUp={(event) => {
        if (event.code === 'Space' || event.code === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          input.set(`virtual:${button}`, button, false);
        }
      }}
      onBlur={() => input.set(`virtual:${button}`, button, false)}
    >
      {children}
    </button>
  );
}

export function Console({
  edition,
  system,
  canvasRef,
  status,
  filter,
  input,
  pressed,
  hasCartridge,
  expanded,
  busy = false,
  onStart,
  onResume,
}: ConsoleProps) {
  const consoleRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const device = consoleRef.current;
    const viewport = device?.parentElement;
    if (!expanded || !device || !viewport) return;

    const fitConsole = () => {
      const padding = getComputedStyle(viewport);
      const width =
        viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
      const height =
        viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
      if (width <= 0 || height <= 0 || !device.offsetWidth || !device.offsetHeight) return;

      // Measure before transforms so resizing cannot feed back into the scale.
      const scale = Math.min(width / device.offsetWidth, height / device.offsetHeight);
      device.style.setProperty('--console-scale', String(scale));
    };
    const observer = new ResizeObserver(fitConsole);
    observer.observe(viewport);
    observer.observe(device);
    fitConsole();
    return () => {
      observer.disconnect();
      device.style.removeProperty('--console-scale');
    };
  }, [expanded]);

  const active = status === 'running';
  const controls = { input, pressed, active };
  const showBoot = status === 'idle' || status === 'error' || status === 'loading';
  return (
    <div
      ref={consoleRef}
      className={`console-wrap system-${system.toLowerCase()}`}
      style={{ '--edition-color': edition?.color ?? '#5b8858' } as CSSProperties}
    >
      <div className="console-shoulders">
        <ConsoleButton
          {...controls}
          button="L"
          className="shoulder"
          active={active && system === 'GBA'}
        >
          L
        </ConsoleButton>
        <ConsoleButton
          {...controls}
          button="R"
          className="shoulder"
          active={active && system === 'GBA'}
        >
          R
        </ConsoleButton>
      </div>
      <div className="console-shell">
        <div className="console-left">
          <div className="shell-brand">POCKET®</div>
          <fieldset className="dpad" aria-label="方向键">
            <ConsoleButton {...controls} button="Up" className="dpad-up" label="方向上">
              <ChevronUp />
            </ConsoleButton>
            <ConsoleButton {...controls} button="Left" className="dpad-left" label="方向左">
              <ChevronLeft />
            </ConsoleButton>
            <div className="dpad-center">
              <span />
            </div>
            <ConsoleButton {...controls} button="Right" className="dpad-right" label="方向右">
              <ChevronRight />
            </ConsoleButton>
            <ConsoleButton {...controls} button="Down" className="dpad-down" label="方向下">
              <ChevronDown />
            </ConsoleButton>
          </fieldset>
          <div className="small-buttons">
            <div>
              <ConsoleButton {...controls} button="Select" className="small-console-button">
                <span />
              </ConsoleButton>
              <span>SELECT</span>
            </div>
            <div>
              <ConsoleButton {...controls} button="Start" className="small-console-button">
                <span />
              </ConsoleButton>
              <span>START</span>
            </div>
          </div>
        </div>
        <div className="screen-frame">
          <div className="screen-frame-top">
            <span>DOT MATRIX WITH STEREO SOUND</span>
            <i />
          </div>
          <div className={`game-screen ${filter === 'lcd' ? 'lcd-filter' : ''}`}>
            <canvas
              ref={canvasRef}
              id="game-canvas"
              width="240"
              height="160"
              aria-label={`${system} 游戏画面`}
              data-system={system}
              tabIndex={0}
            />
            {showBoot && (
              <div className="boot-screen">
                <div className="boot-stars" aria-hidden="true">
                  ✦<span>·</span>
                  <span>+</span>
                  <span>·</span>
                  <span>✦</span>
                </div>
                <span className="boot-eyebrow">
                  {edition
                    ? `WELCOME TO THE ${edition.regionEn} REGION`
                    : 'WELCOME TO YOUR NEXT ADVENTURE'}
                </span>
                <div className="boot-title">POKéMON</div>
                <div className="boot-subtitle">
                  <i /> {edition?.english.toUpperCase() ?? 'POCKET'} VERSION <i />
                </div>
                <img
                  className="boot-rayquaza"
                  src={`/art/${edition?.mascot ?? 'pikachu'}.png`}
                  width="64"
                  height="64"
                  alt={`${edition?.mascotName ?? '皮卡丘'}像素图`}
                />
                <div className="pixel-cloud cloud-one" />
                <div className="pixel-cloud cloud-two" />
                <button
                  type="button"
                  className="boot-start"
                  onClick={onStart}
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? (
                    <>
                      <LoaderCircle className="spin" size={15} /> 正在唤醒掌机
                    </>
                  ) : (
                    <>
                      <Play size={13} fill="currentColor" />{' '}
                      {hasCartridge ? '开始冒险' : '载入游戏卡带'}
                    </>
                  )}
                </button>
                <span className="boot-footnote">A LITTLE POCKET. A BIG ADVENTURE.</span>
              </div>
            )}
            {status === 'paused' && (
              <button
                type="button"
                className="paused-screen"
                onClick={onResume}
                disabled={busy}
                aria-label="点击画面继续游戏"
              >
                <span className="pause-symbol">
                  <Play size={25} fill="currentColor" />
                </span>
                <strong>冒险，稍作休息。</strong>
                <span>点击继续游戏</span>
              </button>
            )}
            <div className="screen-glass" aria-hidden="true" />
          </div>
          <div className="console-wordmark">
            GAME BOY <b>{system === 'GBA' ? 'ADVANCE' : system === 'GBC' ? 'COLOR' : 'CLASSIC'}</b>
          </div>
        </div>
        <div className="console-right">
          <div className={`power-light ${active ? 'is-on' : ''}`}>
            <i />
            <span>POWER</span>
          </div>
          <div className="ab-buttons">
            <ConsoleButton {...controls} button="B" className="action-b">
              B
            </ConsoleButton>
            <ConsoleButton {...controls} button="A" className="action-a">
              A
            </ConsoleButton>
          </div>
          <div className="speaker" aria-hidden="true">
            {['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'].map((id) => (
              <i key={id} />
            ))}
          </div>
        </div>
        <span className="shell-screw screw-left" aria-hidden="true" />
        <span className="shell-screw screw-right" aria-hidden="true" />
      </div>
      <div className="console-caption">
        <span>POCKET COLLECTION</span>
        <i />
        <span>
          {edition?.english.toUpperCase() ?? 'YOUR'} EDITION · {system}
        </span>
      </div>
    </div>
  );
}

export function MobileControls({
  system,
  status,
  input,
  pressed,
}: Pick<ConsoleProps, 'status' | 'input' | 'pressed' | 'system'>) {
  const controls = { input, pressed, active: status === 'running' };
  return (
    <fieldset className="mobile-controls" data-system={system} aria-label="触屏游戏按键">
      <div className="mobile-dpad dpad">
        <ConsoleButton {...controls} button="Up" className="dpad-up" label="触屏方向上">
          <ChevronUp />
        </ConsoleButton>
        <ConsoleButton {...controls} button="Left" className="dpad-left" label="触屏方向左">
          <ChevronLeft />
        </ConsoleButton>
        <div className="dpad-center">
          <span />
        </div>
        <ConsoleButton {...controls} button="Right" className="dpad-right" label="触屏方向右">
          <ChevronRight />
        </ConsoleButton>
        <ConsoleButton {...controls} button="Down" className="dpad-down" label="触屏方向下">
          <ChevronDown />
        </ConsoleButton>
      </div>
      <div className="mobile-center-buttons">
        <ConsoleButton
          {...controls}
          button="L"
          className="mobile-shoulder"
          active={status === 'running' && system === 'GBA'}
        >
          L
        </ConsoleButton>
        <ConsoleButton
          {...controls}
          button="R"
          className="mobile-shoulder"
          active={status === 'running' && system === 'GBA'}
        >
          R
        </ConsoleButton>
        <ConsoleButton {...controls} button="Select" className="mobile-start">
          SELECT
        </ConsoleButton>
        <ConsoleButton {...controls} button="Start" className="mobile-start">
          START
        </ConsoleButton>
      </div>
      <div className="mobile-ab ab-buttons">
        <ConsoleButton {...controls} button="B" className="action-b">
          B
        </ConsoleButton>
        <ConsoleButton {...controls} button="A" className="action-a">
          A
        </ConsoleButton>
      </div>
    </fieldset>
  );
}
