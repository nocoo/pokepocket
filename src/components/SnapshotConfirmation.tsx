import { useId } from 'react';
import { CornerDownLeft, Save, Trash2 } from 'lucide-react';
import type { SnapshotAction } from '../lib/snapshot-action';
import type { Snapshot } from '../lib/storage';
import { Modal } from './Modal';

const actions = {
  load: {
    verb: '读取',
    eyebrow: 'LOAD SAVED PROGRESS',
    description: '游戏将回到这份存档记录的时刻，当前游戏进度会被替换。',
    icon: CornerDownLeft,
  },
  replace: {
    verb: '替换',
    eyebrow: 'UPDATE THIS MOMENT',
    description: '将用当前游戏进度覆盖这份即时存档，原存档内容将无法恢复。',
    icon: Save,
  },
  delete: {
    verb: '清除',
    eyebrow: 'CLEAR THIS SAVE',
    description: '这份即时存档将被永久清除，存档位置可重新使用。',
    icon: Trash2,
  },
};

export function SnapshotConfirmation({
  action,
  snapshot,
  gameTitle,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  action: SnapshotAction;
  snapshot: Snapshot;
  gameTitle: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const descriptionId = useId();
  const { verb, eyebrow, description, icon: Icon } = actions[action];
  const name =
    snapshot.slot === 0 ? '自动存档' : `即时存档 ${String(snapshot.slot).padStart(2, '0')}`;
  const date = new Date(snapshot.updatedAt);

  return (
    <Modal
      title={`${verb}${name}？`}
      eyebrow={eyebrow}
      onClose={onClose}
      dismissible={!busy}
      descriptionId={descriptionId}
    >
      <div className="snapshot-summary">
        <img src={snapshot.thumbnail} alt={`${name}的预览`} />
        <div>
          <strong>{name}</strong>
          <span>{gameTitle}</span>
          <time dateTime={date.toISOString()}>
            {date.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            })}
          </time>
        </div>
      </div>
      <p className="snapshot-description" id={descriptionId}>
        {description}
      </p>
      {error && (
        <p className="snapshot-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onClose}
          // biome-ignore lint/a11y/noAutofocus: confirmation dialog autofocuses cancel to prevent accidental destructive actions
          autoFocus
        >
          取消
        </button>
        <button
          type="button"
          className={`primary-button ${action === 'delete' ? 'danger-button' : ''}`}
          disabled={busy}
          onClick={onConfirm}
        >
          <Icon size={15} />
          {busy ? '处理中…' : `确认${verb}`}
        </button>
      </div>
    </Modal>
  );
}
