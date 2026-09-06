// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../../src/components/Modal';

describe('Modal component', () => {
  beforeEach(() => {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
      };
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders modal with title, eyebrow, and accessibility attributes matching elements', () => {
    const handleClose = vi.fn();
    render(
      <Modal title="测试标题" eyebrow="FIELD GUIDE" descriptionId="desc-1" onClose={handleClose}>
        <p id="desc-1">测试内容描述</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();

    const titleEl = screen.getByRole('heading', { level: 2 });
    expect(titleEl.textContent).toBe('测试标题');
    expect(dialog.getAttribute('aria-labelledby')).toBe(titleEl.id);

    const descEl = screen.getByText('测试内容描述');
    expect(descEl.id).toBe('desc-1');
    expect(dialog.getAttribute('aria-describedby')).toBe(descEl.id);

    expect(screen.getByText('FIELD GUIDE')).toBeDefined();
  });

  it('calls showModal on mount and close on unmount', () => {
    const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const closeSpy = vi.spyOn(HTMLDialogElement.prototype, 'close');

    const { unmount } = render(
      <Modal title="弹窗生命周期" eyebrow="GUIDE" onClose={vi.fn()}>
        <div>内容</div>
      </Modal>,
    );

    expect(showModalSpy).toHaveBeenCalled();

    unmount();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('applies modal-wide class when wide prop is true', () => {
    const { container } = render(
      <Modal title="宽屏弹窗" eyebrow="WIDE" wide onClose={vi.fn()}>
        <div>宽屏内容</div>
      </Modal>,
    );

    const dialog = container.querySelector('dialog');
    expect(dialog?.classList.contains('modal-wide')).toBe(true);
  });

  it('dismisses via close button click when dismissible is true', async () => {
    const handleClose = vi.fn();
    render(
      <Modal title="关闭测试" eyebrow="CLOSE" onClose={handleClose}>
        <div>内容</div>
      </Modal>,
    );

    const closeButton = screen.getByRole('button', { name: '关闭窗口' });
    expect(closeButton.hasAttribute('disabled')).toBe(false);

    await userEvent.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses via Escape key when dismissible', () => {
    const handleClose = vi.fn();
    render(
      <Modal title="ESC测试" eyebrow="ESC" onClose={handleClose}>
        <div>内容</div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses via onCancel event when dismissible', () => {
    const handleClose = vi.fn();
    render(
      <Modal title="Cancel测试" eyebrow="CANCEL" onClose={handleClose}>
        <div>内容</div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses on backdrop click but does not dismiss on content click', () => {
    const handleClose = vi.fn();
    render(
      <Modal title="背景点击" eyebrow="BACKDROP" onClose={handleClose}>
        <div data-testid="inner-content">内部内容</div>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const content = screen.getByTestId('inner-content');

    // Click inside modal-content should not dismiss
    fireEvent.click(content);
    expect(handleClose).not.toHaveBeenCalled();

    // Click directly on dialog backdrop (event.target === dialog)
    fireEvent.click(dialog);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('disables close button and rejects Escape, cancel, and backdrop when dismissible is false, calling preventDefault', () => {
    const handleClose = vi.fn();
    render(
      <Modal title="锁定弹窗" eyebrow="LOCKED" dismissible={false} onClose={handleClose}>
        <div>不可取消的内容</div>
      </Modal>,
    );

    const closeButton = screen.getByRole('button', { name: '关闭窗口' });
    expect(closeButton.hasAttribute('disabled')).toBe(true);

    const dialog = screen.getByRole('dialog');

    // Escape key
    const escapePrevented = !fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(escapePrevented).toBe(true);
    expect(handleClose).not.toHaveBeenCalled();

    // cancel event
    const cancelPrevented = !fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(cancelPrevented).toBe(true);
    expect(handleClose).not.toHaveBeenCalled();

    // backdrop click
    fireEvent.click(dialog);
    expect(handleClose).not.toHaveBeenCalled();
  });
});
