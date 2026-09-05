import { Bookmark, CornerDownLeft, Plus, Save } from 'lucide-react';
import type { Snapshot } from '../lib/storage';

export function SaveSlots({
  snapshots,
  active,
  busy,
  onSave,
  onLoad,
  onDelete,
}: {
  snapshots: Snapshot[];
  active: boolean;
  busy: boolean;
  onSave: (slot: number) => void;
  onLoad: (snapshot: Snapshot) => void;
  onDelete: (snapshot: Snapshot) => void;
}) {
  return (
    <div className="save-slots">
      {[1, 2, 3].map((slot) => {
        const snapshot = snapshots.find((item) => item.slot === slot);
        return (
          <div className={`save-slot ${snapshot ? 'has-save' : ''}`} key={slot}>
            <button
              className="save-slot-preview"
              disabled={!active || busy}
              onClick={() => (snapshot ? onLoad(snapshot) : onSave(slot))}
              aria-label={snapshot ? `读取即时存档 ${slot}` : `保存到位置 ${slot}`}
            >
              {snapshot ? (
                <>
                  <img src={snapshot.thumbnail} alt={`即时存档 ${slot} 的游戏画面`} />
                  <span className="load-overlay">
                    <CornerDownLeft size={17} />
                    读取存档
                  </span>
                </>
              ) : (
                <>
                  <Plus size={21} />
                  <span>留住这一刻</span>
                </>
              )}
              <span className="slot-number">0{slot}</span>
            </button>
            <div className="save-slot-label">
              <span>
                {snapshot
                  ? new Date(snapshot.updatedAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '空白存档'}
              </span>
              {snapshot ? <Save size={12} /> : <Bookmark size={12} />}
            </div>
            {snapshot && (
              <div className="save-slot-actions">
                <button
                  className="save-slot-action"
                  disabled={!active || busy}
                  onClick={() => onSave(slot)}
                  aria-label={`替换即时存档 ${slot}`}
                  title="用当前游戏进度替换这份即时存档"
                >
                  替换
                </button>
                <button
                  className="save-slot-action save-slot-delete"
                  disabled={!active || busy}
                  onClick={() => onDelete(snapshot)}
                  aria-label={`清除即时存档 ${slot}`}
                  title="清除这份即时存档"
                >
                  清除
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
