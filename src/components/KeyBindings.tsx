import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import type { GameButton } from '../lib/input';
import {
  BINDING_LABELS,
  bindKey,
  defaultBindings,
  keyLabel,
  type KeyBindings as Bindings,
} from '../lib/key-bindings';

export function KeyBindings({
  bindings,
  onChange,
}: {
  bindings: Bindings;
  onChange: (bindings: Bindings) => void;
}) {
  const [capture, setCapture] = useState<{ button: GameButton; index: number } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!capture) return;
    const record = (event: KeyboardEvent) => {
      if (event.code === 'Tab') {
        setCapture(null);
        setFeedback('已取消修改。');
        setError(false);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        setCapture(null);
        setFeedback('已取消修改。');
        setError(false);
        return;
      }
      try {
        if (event.metaKey || event.ctrlKey || event.altKey)
          throw new Error('请按单个按键，不要同时按下 Ctrl、Alt 或 Command。');
        onChange(bindKey(bindings, capture.button, capture.index, event.code));
        setFeedback(`${capture.button} 已设为 ${keyLabel(event.code)}，已自动保存。`);
        setError(false);
        setCapture(null);
      } catch (reason) {
        setFeedback(reason instanceof Error ? reason.message : String(reason));
        setError(true);
      }
    };
    window.addEventListener('keydown', record, true);
    return () => window.removeEventListener('keydown', record, true);
  }, [bindings, capture, onChange]);

  return (
    <section className="keyboard-settings" aria-label="自定义键位">
      <div className="keyboard-settings-heading">
        <h3>
          <Keyboard size={17} />
          按键映射
        </h3>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            onChange(defaultBindings());
            setCapture(null);
            setError(false);
            setFeedback('已恢复默认键位：A = O，B = P。');
          }}
        >
          <RotateCcw size={12} />
          恢复默认键位
        </button>
      </div>
      <p>点选键位，再按下你喜欢的按键。每个按钮可设置两个键位。</p>
      <div className="binding-grid">
        {BINDING_LABELS.map(({ button, label }) => (
          <div className="binding-row" key={button}>
            <span>{label}</span>
            <div className="binding-keys">
              {[0, 1].map((index) => {
                const listening = capture?.button === button && capture.index === index;
                const code = bindings[button][index];
                return (
                  <span className="binding-key-wrap" key={index}>
                    <button
                      type="button"
                      className={`binding-key ${listening ? 'is-listening' : ''} ${code ? '' : 'empty-key'}`}
                      aria-label={`修改 ${button} ${index ? '备用' : '主要'}键位`}
                      aria-pressed={listening}
                      onClick={() => {
                        setCapture(listening ? null : { button, index });
                        setError(false);
                        setFeedback(
                          listening ? '已取消修改。' : `请按下 ${button} 的新键位，Esc 取消。`,
                        );
                      }}
                    >
                      {listening ? '按键…' : code ? keyLabel(code) : '+'}
                    </button>
                    {index === 1 && code && (
                      <button
                        type="button"
                        className="remove-binding"
                        aria-label={`移除 ${button} 备用键位`}
                        onClick={() => {
                          const primary = bindings[button][0];
                          if (!primary) return;
                          onChange({ ...bindings, [button]: [primary] });
                          setCapture(null);
                          setError(false);
                          setFeedback(`${button} 的备用键位已移除。`);
                        }}
                      >
                        <X size={9} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className={`binding-feedback ${error ? 'is-error' : ''}`} role="status" aria-live="polite">
        {feedback || '键位自动保存在此浏览器，下次打开依然有效。'}
      </p>
      <div className="binding-shortcuts">
        <span>固定快捷键</span>
        <span>Space 暂停 · M 静音 · F 全屏 · ` 加速</span>
      </div>
    </section>
  );
}
