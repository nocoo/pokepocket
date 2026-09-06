import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Check,
  ChevronLeft,
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
  const [scrollable, setScrollable] = useState({ previous: false, next: false });
  const trackRef = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const owned = (id: string) => library.some((item) => item.header.editionId === id);
  const bundled = (id: string) => available.some((item) => item.id === id && item.available);
  const filtered = useMemo(
    () =>
      EDITIONS.filter(
        (item) =>
          (!generation || item.generation === generation) &&
          `${item.name} ${item.english} ${item.region} ${item.system}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [generation, query],
  );
  const title = cartridge ? cartridgeTitle(cartridge) : `宝可梦 ${edition?.name ?? ''}`;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const selectedIndex = filtered.findIndex((item) => item.id === edition?.id);
    const updateScroll = () => {
      setScrollable({
        previous: track.scrollLeft > 1,
        next: track.scrollLeft + track.clientWidth < track.scrollWidth - 1,
      });
    };
    const revealSelection = () => {
      if (!track.clientWidth) return;
      const selectedCard = track.children.item(selectedIndex) as HTMLElement | null;
      let left = track.scrollLeft;
      if (!selectedCard) left = 0;
      else if (
        selectedCard.offsetLeft < left ||
        selectedCard.offsetLeft + selectedCard.offsetWidth > left + track.clientWidth
      )
        left = selectedCard.offsetLeft - (track.clientWidth - selectedCard.offsetWidth) / 2;
      // Keep selection in the horizontal strip without moving the page away from the game.
      track.scrollTo({ left, behavior: 'instant' });
      updateScroll();
    };
    const observer = new ResizeObserver(revealSelection);
    observer.observe(track);
    track.addEventListener('scroll', updateScroll, { passive: true });
    revealSelection();
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', updateScroll);
    };
  }, [edition?.id, filtered]);

  const scrollCartridges = (direction: number) => {
    const track = trackRef.current;
    if (track) track.scrollBy({ left: direction * track.clientWidth * 0.8 });
  };

  return (
    <section
      className="cartridge-carousel"
      aria-label="宝可梦系列游戏库"
      aria-roledescription="轮播"
    >
      <div className="carousel-heading">
        <div className="carousel-title">
          <h2>
            <Gamepad2 size={18} />
            切换卡带
          </h2>
          <p>
            当前卡带 <strong>{title}</strong>
          </p>
        </div>
        <div className="carousel-browse-controls">
          <fieldset className="generation-tabs" aria-label="按世代筛选">
            {['全部', '初代', '二代', '三代'].map((label, index) => (
              <button
                type="button"
                key={label}
                className={generation === index ? 'selected' : ''}
                aria-pressed={generation === index}
                onClick={() => setGeneration(index)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <label className="series-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="寻找一个熟悉的版本"
              aria-label="搜索宝可梦版本"
            />
          </label>
          <div className="carousel-navigation">
            <button
              type="button"
              aria-label="上一组卡带"
              aria-controls={trackId}
              disabled={!scrollable.previous}
              onClick={() => scrollCartridges(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              aria-label="下一组卡带"
              aria-controls={trackId}
              disabled={!scrollable.next}
              onClick={() => scrollCartridges(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
      <div className="cartridge-track" id={trackId} ref={trackRef}>
        {filtered.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`carousel-cartridge ${edition?.id === item.id ? 'is-selected' : ''}`}
            disabled={busy}
            aria-pressed={edition?.id === item.id}
            aria-label={`选择宝可梦 ${item.name}`}
            onClick={() => onEdition(item)}
            style={{ '--edition-color': item.color } as CSSProperties}
          >
            <span className="carousel-cartridge-art">
              <CartridgeArt edition={item} />
            </span>
            <span className="carousel-cartridge-caption">
              <strong>宝可梦 {item.name}</strong>
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
                  <Check size={13} />
                ) : bundled(item.id) ? (
                  <span />
                ) : (
                  <Plus size={13} />
                )}
              </span>
            </span>
            <small>
              {item.system} · {item.region} {item.language === '日语' ? '· 日版' : ''}
            </small>
          </button>
        ))}
        {!filtered.length && <p className="empty-series">没有找到这个版本，试试其他名字。</p>}
      </div>
      <div className="carousel-footer">
        <p>
          <ShieldCheck size={15} />
          进度独立保存，切换时自动记录。
        </p>
        <div className="series-summary">
          <span>3 个世代 · 12 段冒险</span>
          <span>
            {EDITIONS.filter((item) => owned(item.id) || bundled(item.id)).length} / 12 就绪
          </span>
        </div>
        <a
          href={`https://github.com/${edition?.source ?? 'pret'}`}
          target="_blank"
          rel="noreferrer"
        >
          源码与构建出处
          <ExternalLink size={12} />
        </a>
      </div>
      {library.length > 0 && (
        <details className="local-cartridges">
          <summary>
            本地收藏与其他修订版 <span>{library.length}</span>
          </summary>
          <div>
            {library.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={busy}
                onClick={() => onCartridge(item)}
                aria-label={`载入本地卡带 ${item.fileName}`}
                aria-pressed={cartridge?.id === item.id}
                className={cartridge?.id === item.id ? 'selected' : ''}
              >
                <span>
                  <strong>{item.fileName}</strong>
                  <small>
                    {item.header.system} · Rev {item.header.version} · {item.id.slice(0, 8)}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
