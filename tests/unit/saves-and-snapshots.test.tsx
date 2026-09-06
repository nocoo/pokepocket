// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveSlots } from '../../src/components/SaveSlots';
import { SnapshotConfirmation } from '../../src/components/SnapshotConfirmation';
import type { Snapshot } from '../../src/lib/storage';

function createMockSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    key: 'emerald:1',
    romId: 'emerald-rom',
    slot: 1,
    data: new ArrayBuffer(16),
    thumbnail: 'data:image/png;base64,mock-thumbnail',
    updatedAt: 1700000000000,
    coreVersion: '2.5.1',
    ...overrides,
  };
}

describe('SaveSlots and SnapshotConfirmation components', () => {
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

  describe('SaveSlots', () => {
    it('maps unsorted snapshots to slots 1..3 and excludes slot 0 from manual slots', async () => {
      const handleSave = vi.fn();
      const handleLoad = vi.fn();
      const handleDelete = vi.fn();

      const snap0 = createMockSnapshot({ slot: 0, key: 'emerald:0' });
      const snap3 = createMockSnapshot({ slot: 3, key: 'emerald:3', updatedAt: 1700000030000 });
      const snap1 = createMockSnapshot({ slot: 1, key: 'emerald:1', updatedAt: 1700000010000 });

      // Pass in unsorted order [snap3, snap0, snap1]
      render(
        <SaveSlots
          snapshots={[snap3, snap0, snap1]}
          active={true}
          busy={false}
          onSave={handleSave}
          onLoad={handleLoad}
          onDelete={handleDelete}
        />,
      );

      // Slot 0 is auto-save and must not have a manual slot button
      expect(screen.queryByRole('button', { name: /即时存档 0/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /保存到位置 0/ })).toBeNull();

      // Slot 1 has save -> preview button loads slot 1
      const slot1Preview = screen.getByRole('button', { name: '读取即时存档 1' });
      await userEvent.click(slot1Preview);
      expect(handleLoad).toHaveBeenCalledWith(snap1);

      // Slot 2 is blank -> preview button saves to slot 2
      const slot2Preview = screen.getByRole('button', { name: '保存到位置 2' });
      await userEvent.click(slot2Preview);
      expect(handleSave).toHaveBeenCalledWith(2);

      // Slot 3 has save -> replace button triggers onSave(3)
      const slot3Replace = screen.getByRole('button', { name: '替换即时存档 3' });
      await userEvent.click(slot3Replace);
      expect(handleSave).toHaveBeenCalledWith(3);

      // Slot 3 delete button triggers onDelete(snap3)
      const slot3Delete = screen.getByRole('button', { name: '清除即时存档 3' });
      await userEvent.click(slot3Delete);
      expect(handleDelete).toHaveBeenCalledWith(snap3);

      // Preview image and timestamp presence
      const img1 = screen.getByAltText('即时存档 1 的游戏画面') as HTMLImageElement;
      expect(img1.src).toBe(snap1.thumbnail);
      expect(screen.getByText('空白存档')).toBeDefined();
    });

    it('suppresses load, create, replace, and delete callbacks when inactive or busy', async () => {
      const handleSave = vi.fn();
      const handleLoad = vi.fn();
      const handleDelete = vi.fn();

      const snap1 = createMockSnapshot({ slot: 1 });
      const snap3 = createMockSnapshot({ slot: 3 });

      // 1. Inactive state (active=false, busy=false)
      const { rerender } = render(
        <SaveSlots
          snapshots={[snap1, snap3]}
          active={false}
          busy={false}
          onSave={handleSave}
          onLoad={handleLoad}
          onDelete={handleDelete}
        />,
      );

      const loadSlot1Btn = screen.getByRole('button', { name: '读取即时存档 1' });
      const blankSlot2Btn = screen.getByRole('button', { name: '保存到位置 2' });
      const replaceSlot3Btn = screen.getByRole('button', { name: '替换即时存档 3' });
      const deleteSlot3Btn = screen.getByRole('button', { name: '清除即时存档 3' });

      expect(loadSlot1Btn.hasAttribute('disabled')).toBe(true);
      expect(blankSlot2Btn.hasAttribute('disabled')).toBe(true);
      expect(replaceSlot3Btn.hasAttribute('disabled')).toBe(true);
      expect(deleteSlot3Btn.hasAttribute('disabled')).toBe(true);

      fireEvent.click(loadSlot1Btn);
      fireEvent.click(blankSlot2Btn);
      fireEvent.click(replaceSlot3Btn);
      fireEvent.click(deleteSlot3Btn);

      expect(handleLoad).not.toHaveBeenCalled();
      expect(handleSave).not.toHaveBeenCalled();
      expect(handleDelete).not.toHaveBeenCalled();

      // 2. Busy state (active=true, busy=true)
      rerender(
        <SaveSlots
          snapshots={[snap1, snap3]}
          active={true}
          busy={true}
          onSave={handleSave}
          onLoad={handleLoad}
          onDelete={handleDelete}
        />,
      );

      expect(loadSlot1Btn.hasAttribute('disabled')).toBe(true);
      expect(blankSlot2Btn.hasAttribute('disabled')).toBe(true);
      expect(replaceSlot3Btn.hasAttribute('disabled')).toBe(true);
      expect(deleteSlot3Btn.hasAttribute('disabled')).toBe(true);

      fireEvent.click(loadSlot1Btn);
      fireEvent.click(blankSlot2Btn);
      fireEvent.click(replaceSlot3Btn);
      fireEvent.click(deleteSlot3Btn);

      expect(handleLoad).not.toHaveBeenCalled();
      expect(handleSave).not.toHaveBeenCalled();
      expect(handleDelete).not.toHaveBeenCalled();
    });
  });

  describe('SnapshotConfirmation', () => {
    it('renders accessible title and description with correct action copy for load, replace, delete, and auto slot', async () => {
      const handleClose = vi.fn();
      const handleConfirm = vi.fn();

      // 1. Load action on manual slot 1
      const snap1 = createMockSnapshot({ slot: 1 });
      const { rerender } = render(
        <SnapshotConfirmation
          action="load"
          snapshot={snap1}
          gameTitle="宝可梦 绿宝石"
          busy={false}
          error={null}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />,
      );

      const dialog = screen.getByRole('dialog');
      const heading = screen.getByRole('heading', { level: 2 });
      const desc = screen.getByText('游戏将回到这份存档记录的时刻，当前游戏进度会被替换。');

      // Verify aria-labelledby and aria-describedby resolve to actual heading and description
      expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(dialog.getAttribute('aria-describedby')).toBe(desc.id);

      expect(screen.getByText('LOAD SAVED PROGRESS')).toBeDefined();
      expect(heading.textContent).toBe('读取即时存档 01？');

      // Verify image thumbnail, game title, and date/time payloads
      const img = screen.getByAltText('即时存档 01的预览') as HTMLImageElement;
      expect(img.src).toBe(snap1.thumbnail);
      expect(screen.getByText('宝可梦 绿宝石')).toBeDefined();

      const timeEl = screen.getByText(
        new Date(snap1.updatedAt).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
      expect(timeEl.getAttribute('dateTime')).toBe(new Date(snap1.updatedAt).toISOString());

      // Cancel button initial focus (autoFocus in React focuses element on mount)
      const cancelBtn = screen.getByRole('button', { name: '取消' });
      expect(document.activeElement).toBe(cancelBtn);

      const confirmBtn = screen.getByRole('button', { name: '确认读取' });
      await userEvent.click(confirmBtn);
      expect(handleConfirm).toHaveBeenCalledTimes(1);

      await userEvent.click(cancelBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);

      // 2. Replace action on auto slot 0
      const snap0 = createMockSnapshot({ slot: 0 });
      rerender(
        <SnapshotConfirmation
          action="replace"
          snapshot={snap0}
          gameTitle="宝可梦 绿宝石"
          busy={false}
          error={null}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />,
      );

      expect(screen.getByText('UPDATE THIS MOMENT')).toBeDefined();
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('替换自动存档？');
      expect(
        screen.getByText('将用当前游戏进度覆盖这份即时存档，原存档内容将无法恢复。'),
      ).toBeDefined();
      expect(screen.getByRole('button', { name: '确认替换' })).toBeDefined();

      // 3. Delete action (destructive styling)
      rerender(
        <SnapshotConfirmation
          action="delete"
          snapshot={snap1}
          gameTitle="宝可梦 绿宝石"
          busy={false}
          error={null}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />,
      );

      expect(screen.getByText('CLEAR THIS SAVE')).toBeDefined();
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('清除即时存档 01？');
      expect(screen.getByText('这份即时存档将被永久清除，存档位置可重新使用。')).toBeDefined();
      const deleteConfirmBtn = screen.getByRole('button', { name: '确认清除' });
      expect(deleteConfirmBtn.classList.contains('danger-button')).toBe(true);
    });

    it('propagates busy to real Modal, prevents dismissal/actions, displays error, and recovers retry and close after idle', async () => {
      const handleConfirm = vi.fn();
      const handleClose = vi.fn();
      const snap = createMockSnapshot({ slot: 2 });

      // 1. Initial busy state: Modal becomes nondismissible and action buttons disabled
      const { rerender } = render(
        <SnapshotConfirmation
          action="load"
          snapshot={snap}
          gameTitle="宝可梦 绿宝石"
          busy={true}
          error={null}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />,
      );

      const dialog = screen.getByRole('dialog');
      const closeXBtn = screen.getByRole('button', { name: '关闭窗口' });
      const cancelBtn = screen.getByRole('button', { name: '取消' });
      const processingBtn = screen.getByRole('button', { name: '处理中…' });

      expect(closeXBtn.hasAttribute('disabled')).toBe(true);
      expect(cancelBtn.hasAttribute('disabled')).toBe(true);
      expect(processingBtn.hasAttribute('disabled')).toBe(true);

      // Attempt clicks while busy
      fireEvent.click(closeXBtn);
      fireEvent.click(cancelBtn);
      fireEvent.click(processingBtn);
      fireEvent.click(dialog); // backdrop click
      expect(handleClose).not.toHaveBeenCalled();
      expect(handleConfirm).not.toHaveBeenCalled();

      // Escape keydown while busy calls preventDefault and does not close
      const escapePrevented = !fireEvent.keyDown(dialog, { key: 'Escape', cancelable: true });
      expect(escapePrevented).toBe(true);
      expect(handleClose).not.toHaveBeenCalled();

      // Native cancel event while busy calls preventDefault and does not close
      const cancelPrevented = !fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(cancelPrevented).toBe(true);
      expect(handleClose).not.toHaveBeenCalled();

      // 2. Return to idle state with error displayed -> retry is enabled
      rerender(
        <SnapshotConfirmation
          action="load"
          snapshot={snap}
          gameTitle="宝可梦 绿宝石"
          busy={false}
          error="当前卡带已切换，请重新选择即时存档。"
          onClose={handleClose}
          onConfirm={handleConfirm}
        />,
      );

      const alertEl = screen.getByRole('alert');
      expect(alertEl.textContent).toBe('当前卡带已切换，请重新选择即时存档。');

      // Confirm button is now active and executes retry
      const confirmRetryBtn = screen.getByRole('button', { name: '确认读取' });
      expect(confirmRetryBtn.hasAttribute('disabled')).toBe(false);
      await userEvent.click(confirmRetryBtn);
      expect(handleConfirm).toHaveBeenCalledTimes(1);

      // Cancel button is now active and executes close
      expect(cancelBtn.hasAttribute('disabled')).toBe(false);
      await userEvent.click(cancelBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});
