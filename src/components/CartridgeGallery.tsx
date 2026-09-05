import { useState, type CSSProperties } from 'react';
import { ArrowRight, Check, ChevronRight, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import { EDITIONS, type AvailableEdition, type PokemonEdition } from '../lib/catalog';
import type { Cartridge } from '../lib/cartridge';

export function CartridgeArt({ edition }: { edition: PokemonEdition }) {
  return (
    <div
      className={`physical-cartridge cartridge-${edition.system.toLowerCase()}`}
      aria-hidden="true"
      style={{ '--edition-color': edition.color } as CSSProperties}
    >
      <div className="cart-plastic-top">
        {edition.system === 'GBA' ? 'GAME BOY ADVANCE' : 'Nintendo GAME BOY'}
      </div>
      <div className="cart-label">
        <span className="cart-label-brand">POKéMON</span>
        <div className="cart-label-orbit" />
        <img src={`/art/${edition.mascot}.png`} width="64" height="64" alt="" draggable="false" />
        <strong>{edition.english.toUpperCase()}</strong>
        <small>VERSION</small>
        <span className="cart-label-seal">★</span>
      </div>
      <div className="cart-bottom">
        <i />
        <span>▼</span>
        <i />
      </div>
      <div className="cart-grip grip-left" />
      <div className="cart-grip grip-right" />
    </div>
  );
}

interface Props {
  edition: PokemonEdition;
  library: Cartridge[];
  available: AvailableEdition[];
  catalogReady: boolean;
  busy: boolean;
  onEdition: (edition: PokemonEdition) => void;
  onStart: () => void;
}

const regionNotes: Record<string, string> = {
  KANTO: '回到真新镇，赴一场最初的约定。',
  JOHTO: '循着风与铃声，走过城都的四季。',
  HOENN: '越过海与森林，再见一位老朋友。',
};

export function CartridgeGallery({
  edition,
  library,
  available,
  catalogReady,
  busy,
  onEdition,
  onStart,
}: Props) {
  const [generation, setGeneration] = useState(0);
  const [query, setQuery] = useState('');
  const ready = (id: string) =>
    library.some((item) => item.header.editionId === id) ||
    available.some((item) => item.id === id && item.available);
  const cached = library.find((item) => item.header.editionId === edition.id);
  const filtered = EDITIONS.filter(
    (item) =>
      (!generation || item.generation === generation) &&
      `${item.name} ${item.english} ${item.region} ${item.system}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const readyCount = EDITIONS.filter((item) => ready(item.id)).length;
  return (
    <main id="cartridge-gallery" className="cartridge-gallery" tabIndex={-1}>
      <div className="collection-heading">
        <div>
          <span className="eyebrow">
            <span className="tiny-spark">✦</span> THE POKÉMON CARTRIDGE COLLECTION
          </span>
          <h1>
            今天，想去哪里冒险<span>？</span>
          </h1>
          <p>打开卡带盒，把那个舍不得结束的夏天，再过一遍。</p>
        </div>
        <div className="collection-postmark" aria-label="关都、城都、丰缘，1996 至 2004 年">
          <span>
            KANTO <i>·</i> JOHTO <i>·</i> HOENN
          </span>
          <strong>12 CARTRIDGES</strong>
          <small>THREE GENERATIONS OF WONDER</small>
        </div>
      </div>

      <div className="collection-body">
        <section className="cartridge-case" aria-label="宝可梦卡带选择盘">
          <div className="case-hinge hinge-left" />
          <div className="case-hinge hinge-right" />
          <div className="case-toolbar">
            <div className="case-nameplate">
              <span className="case-emblem">✦</span>
              <div>
                <strong>THE POCKET ARCHIVE</strong>
                <span>
                  VOL. 01—03 <i>/</i> 1996—2004
                </span>
              </div>
            </div>
            <span className="case-capacity">
              <i />
              {catalogReady || readyCount ? `${readyCount} 枚卡带就绪` : '正在整理卡带'}
            </span>
          </div>
          <div className="case-filters">
            <div className="generation-tabs" role="group" aria-label="按世代筛选">
              {['全部', '初代', '二代', '三代'].map((label, index) => (
                <button
                  key={label}
                  aria-label={label}
                  aria-pressed={generation === index}
                  className={generation === index ? 'selected' : ''}
                  onClick={() => setGeneration(index)}
                >
                  {label}
                  <small>{[12, 4, 3, 5][index]}</small>
                </button>
              ))}
            </div>
            <label className="series-search">
              <Search size={14} />
              <input
                aria-label="搜索宝可梦版本"
                placeholder="找一枚熟悉的卡带…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="cartridge-tray">
            {filtered.map((item) => {
              const selected = item.id === edition.id;
              const index = EDITIONS.findIndex((entry) => entry.id === item.id) + 1;
              return (
                <button
                  key={item.id}
                  className={`tray-slot ${selected ? 'is-selected' : ''}`}
                  style={{ '--edition-color': item.color } as CSSProperties}
                  disabled={busy}
                  aria-pressed={selected}
                  aria-label={`选择宝可梦 ${item.name}`}
                  onClick={() => onEdition(item)}
                >
                  <span className="slot-serial">{String(index).padStart(2, '0')}</span>
                  <span className="slot-check">
                    {selected ? <Check size={11} strokeWidth={3} /> : <i />}
                  </span>
                  <div className="slot-recess">
                    <CartridgeArt edition={item} />
                  </div>
                  <div className="slot-caption">
                    <strong>{item.name}</strong>
                    <span>
                      {item.system}
                      <i />
                      {item.year}
                    </span>
                  </div>
                </button>
              );
            })}
            {!filtered.length && (
              <div className="tray-empty">
                <Search size={25} />
                <strong>没有找到这枚卡带</strong>
                <span>试试中文名、英文名或地区名称。</span>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery('');
                    setGeneration(0);
                  }}
                >
                  查看全部卡带
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>
          <div className="case-bottom">
            <span>GOOD TIMES, WELL KEPT.</span>
            <div className="case-latch">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <span>SELECT A LITTLE ADVENTURE ↗</span>
          </div>
          <span className="case-screw case-screw-left" />
          <span className="case-screw case-screw-right" />
        </section>

        <aside className="collection-dock" aria-label="所选卡带">
          <div className="destination-card">
            <div className="destination-top">
              <span className="eyebrow">YOUR NEXT ADVENTURE</span>
              <span className="destination-number">
                NO. {String(EDITIONS.indexOf(edition) + 1).padStart(2, '0')}
              </span>
            </div>
            <div className="destination-art">
              <span className="destination-orbit" />
              <span className="destination-orbit orbit-two" />
              <span className="destination-spark spark-one">✦</span>
              <span className="destination-spark spark-two">+</span>
              <CartridgeArt edition={edition} />
              <span className="destination-region">{edition.regionEn}</span>
            </div>
            <div className="destination-title">
              <span>宝可梦</span>
              <h2>{edition.name}</h2>
              <p>Pokémon {edition.english} Version</p>
            </div>
            <div className="destination-description">
              <span className="destination-route">
                <i />
                <span />
                <i />
              </span>
              <p>{regionNotes[edition.regionEn]}</p>
            </div>
            <dl className="destination-facts">
              <div>
                <dt>目的地</dt>
                <dd>{edition.region}地区</dd>
              </div>
              <div>
                <dt>掌机</dt>
                <dd>{edition.system}</dd>
              </div>
              <div>
                <dt>游戏语言</dt>
                <dd>{edition.language}</dd>
              </div>
            </dl>
          </div>
          <div className="dock-launch">
            <div className="launch-caption">
              <span className="launch-indicator" />
              <div>
                <strong>宝可梦 {edition.name}</strong>
                <span>
                  {busy
                    ? '正在插入卡带…'
                    : ready(edition.id)
                      ? cached
                        ? '上次的冒险，还在这里等你。'
                        : '本地卡带已就绪，随时可以出发。'
                      : catalogReady
                        ? '导入你的卡带，开启这段冒险。'
                        : '正在整理卡带…'}
                </span>
              </div>
            </div>
            <button
              className="gallery-start"
              aria-label={ready(edition.id) ? '开始冒险' : '导入卡带'}
              disabled={busy || (!catalogReady && !ready(edition.id))}
              onClick={onStart}
            >
              <span>{busy ? '正在载入' : ready(edition.id) ? '开始冒险' : '导入卡带'}</span>
              {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={19} />}
            </button>
          </div>
          <p className="dock-note">
            <ShieldCheck size={14} />
            卡带与进度留在你的浏览器，回来就能接着玩。
          </p>
          <a
            className="dock-source"
            href={`https://github.com/${edition.source}`}
            target="_blank"
            rel="noreferrer"
          >
            卡带的源码与出处
            <ChevronRight size={11} />
          </a>
        </aside>
      </div>
      <footer className="collection-footer">
        <span>小小口袋，大大冒险。</span>
        <span>
          POKÉ POCKET <i>✦</i> MADE FOR THE MEMORIES
        </span>
        <span>GB / GBC / GBA</span>
      </footer>
    </main>
  );
}
