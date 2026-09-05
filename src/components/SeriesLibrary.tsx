import { useState, type CSSProperties } from 'react';
import {
  Check,
  ChevronRight,
  ExternalLink,
  Gamepad2,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { EDITIONS, type AvailableEdition, type PokemonEdition } from '../lib/catalog';
import { cartridgeTitle, type Cartridge } from '../lib/cartridge';
import { CartridgeArt } from './CartridgeGallery';

interface Props {
  edition: PokemonEdition | undefined;
  cartridge: Cartridge | null;
  library: Cartridge[];
  available: AvailableEdition[];
  busy: boolean;
  onEdition: (edition: PokemonEdition) => void;
  onCartridge: (cartridge: Cartridge) => void;
}
export function SeriesLibrary({
  edition,
  cartridge,
  library,
  available,
  busy,
  onEdition,
  onCartridge,
}: Props) {
  const [generation, setGeneration] = useState(0);
  const [query, setQuery] = useState('');
  const owned = (id: string) => library.some((item) => item.header.editionId === id);
  const bundled = (id: string) => available.some((item) => item.id === id && item.available);
  const ready = Boolean(cartridge || (edition && bundled(edition.id)));
  const filtered = EDITIONS.filter(
    (item) =>
      (!generation || item.generation === generation) &&
      `${item.name} ${item.english} ${item.region} ${item.system}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const title = cartridge ? cartridgeTitle(cartridge) : `宝可梦 ${edition?.name ?? ''}`;
  return (
    <aside className="library-sidebar series-sidebar" aria-label="宝可梦系列游戏库">
      <div className="library-heading">
        <span>宝可梦系列</span>
        <span className="count-badge">{EDITIONS.length}</span>
      </div>
      <div
        className="cartridge-card is-selected featured-edition"
        style={{ '--edition-color': edition?.color ?? '#6d7d75' } as CSSProperties}
      >
        <div className="cartridge-art">
          <span className="art-dot dot-one" />
          <span className="art-dot dot-two" />
          <span className="art-spark">✦</span>
          {edition ? <CartridgeArt edition={edition} /> : <Gamepad2 size={50} />}
          <span className="cartridge-art-code">
            {edition?.system ?? cartridge?.header.system} · {edition?.regionEn ?? 'YOUR ADVENTURE'}
          </span>
        </div>
        <div className="cartridge-card-title">
          <strong>{title}</strong>
          <span className="selected-check">
            <Check size={11} strokeWidth={3} />
          </span>
        </div>
        <div className="cartridge-subtitle">
          {edition ? `Pokémon ${edition.english} Version` : cartridge?.fileName}
        </div>
        <div className="cartridge-card-footer">
          <span className="gba-tag">{cartridge?.header.system ?? edition?.system}</span>
          <span>{edition?.year}</span>
          <span className="cartridge-ready">
            <i />
            {ready ? '卡带就绪' : '待导入'}
          </span>
        </div>
      </div>
      <div className="series-browser">
        <div className="generation-tabs" role="group" aria-label="按世代筛选">
          {['全部', '初代', '二代', '三代'].map((label, index) => (
            <button
              key={label}
              className={generation === index ? 'selected' : ''}
              aria-pressed={generation === index}
              onClick={() => setGeneration(index)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="series-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="寻找一个熟悉的版本"
            aria-label="搜索宝可梦版本"
          />
        </label>
        <div className="edition-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              className={`edition-row ${edition?.id === item.id ? 'is-selected' : ''}`}
              disabled={busy}
              aria-pressed={edition?.id === item.id}
              aria-label={`选择宝可梦 ${item.name}`}
              onClick={() => onEdition(item)}
              style={{ '--edition-color': item.color } as CSSProperties}
            >
              <span className="edition-sprite">
                <img src={`/art/${item.mascot}.png`} width="40" height="40" alt="" />
              </span>
              <span className="edition-name">
                <strong>宝可梦 {item.name}</strong>
                <small>
                  {item.system} · {item.region} {item.language === '日语' ? '· 日版' : ''}
                </small>
              </span>
              <span
                className={`edition-presence ${owned(item.id) || bundled(item.id) ? 'ready' : ''}`}
                title={
                  owned(item.id)
                    ? '已收藏在此设备'
                    : bundled(item.id)
                      ? '可以开始冒险'
                      : '导入你的卡带'
                }
              >
                {owned(item.id) ? (
                  <Check size={12} />
                ) : bundled(item.id) ? (
                  <span />
                ) : (
                  <Plus size={12} />
                )}
              </span>
            </button>
          ))}
          {!filtered.length && <p className="empty-series">没有找到这个版本，试试其他名字。</p>}
        </div>
        <div className="series-summary">
          <span>3 个世代 · 12 段冒险</span>
          <span>
            {EDITIONS.filter((item) => owned(item.id) || bundled(item.id)).length} / 12 就绪
          </span>
        </div>
      </div>
      {library.length > 0 && (
        <details className="local-cartridges">
          <summary>
            本地收藏与其他修订版 <span>{library.length}</span>
          </summary>
          <div>
            {library.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                onClick={() => onCartridge(item)}
                aria-label={`载入本地卡带 ${item.fileName}`}
                className={cartridge?.id === item.id ? 'selected' : ''}
              >
                <span>
                  <strong>{item.fileName}</strong>
                  <small>
                    {item.header.system} · Rev {item.header.version} · {item.id.slice(0, 8)}
                  </small>
                </span>
                <ChevronRight size={12} />
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="privacy-note">
        <ShieldCheck size={16} />
        <p>
          每枚卡带，各自的冒险。
          <br />
          <span>进度独立保存，切换时自动记录。</span>
        </p>
      </div>
      <a
        className="source-link"
        href={`https://github.com/${edition?.source ?? 'pret'}`}
        target="_blank"
        rel="noreferrer"
      >
        这一版本的源码与构建出处
        <ExternalLink size={12} />
      </a>
    </aside>
  );
}
