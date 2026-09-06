// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CartridgeGallery, CartridgeArt } from '../../src/components/CartridgeGallery';
import { SeriesLibrary } from '../../src/components/SeriesLibrary';
import { DEFAULT_EDITION, getEdition } from '../../src/lib/catalog';
import type { Cartridge } from '../../src/lib/cartridge';

function createMockCartridge(overrides: Partial<Cartridge> = {}): Cartridge {
  return {
    id: 'test-emerald-cartridge-id',
    fileName: 'pokeemerald.gba',
    data: new ArrayBuffer(512),
    header: {
      system: 'GBA',
      title: 'POKEMON EMER',
      gameCode: 'BPEE',
      makerCode: '01',
      version: 0,
      size: 512,
      mapper: 'GBA',
      ramSize: 131072,
      declaredSize: null,
      saveType: 'FLASH1M',
      rtc: true,
      editionId: 'emerald',
      isEmerald: true,
    },
    addedAt: 1000,
    lastPlayed: 2000,
    playTime: 120,
    ...overrides,
  };
}

describe('CartridgeGallery and SeriesLibrary components', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('CartridgeArt', () => {
    it('renders GBA plastic top for GBA and Nintendo GAME BOY for GB/GBC', () => {
      const emerald = getEdition('emerald');
      const red = getEdition('red');
      if (!emerald || !red) throw new Error('Missing test editions');

      const { rerender } = render(<CartridgeArt edition={emerald} />);
      expect(screen.getByText('GAME BOY ADVANCE')).toBeDefined();
      expect(screen.getByText('EMERALD')).toBeDefined();

      rerender(<CartridgeArt edition={red} />);
      expect(screen.getByText('Nintendo GAME BOY')).toBeDefined();
      expect(screen.getByText('RED')).toBeDefined();
    });
  });

  describe('CartridgeGallery', () => {
    it('calculates ready count as distinct union of library and available catalog', async () => {
      const emerald = getEdition('emerald');
      const ruby = getEdition('ruby');
      if (!emerald || !ruby) throw new Error('Missing test editions');

      const emeraldCart = createMockCartridge({
        id: 'cart-emerald',
        header: { ...createMockCartridge().header, editionId: 'emerald' },
      });
      const rubyCart = createMockCartridge({
        id: 'cart-ruby',
        header: { ...createMockCartridge().header, editionId: 'ruby' },
      });

      render(
        <CartridgeGallery
          edition={DEFAULT_EDITION}
          library={[emeraldCart, rubyCart]}
          available={[
            { id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }, // overlap with library
            { id: 'sapphire', available: true, url: '/roms/pokesapphire.gba' }, // catalog only
            { id: 'firered', available: false, url: null }, // unavailable catalog record
          ]}
          catalogReady={true}
          busy={false}
          onEdition={vi.fn()}
          onStart={vi.fn()}
        />,
      );

      // Distinct union: emerald (both), ruby (library only), sapphire (catalog only) = 3 ready
      expect(screen.getByText('3 枚卡带就绪')).toBeDefined();
    });

    it('allows cached cartridge to launch even when catalogReady is false', async () => {
      const handleStart = vi.fn();
      const emerald = getEdition('emerald');
      if (!emerald) throw new Error('Missing emerald');

      const emeraldCart = createMockCartridge({
        id: 'cart-cached',
        header: { ...createMockCartridge().header, editionId: 'emerald' },
      });

      render(
        <CartridgeGallery
          edition={emerald}
          library={[emeraldCart]}
          available={[]}
          catalogReady={false} // offline / loading
          busy={false}
          onEdition={vi.fn()}
          onStart={handleStart}
        />,
      );

      expect(screen.getByText('上次的冒险，还在这里等你。')).toBeDefined();
      const startBtn = screen.getByRole('button', { name: '开始冒险' });
      expect(startBtn.hasAttribute('disabled')).toBe(false);
      await userEvent.click(startBtn);
      expect(handleStart).toHaveBeenCalledTimes(1);
    });

    it('renders gallery, displays ready count, and handles generation/search filtering', async () => {
      const handleEdition = vi.fn();
      const handleStart = vi.fn();
      const emeraldCart = createMockCartridge({
        id: 'cart-1',
        header: { ...createMockCartridge().header, editionId: 'emerald' },
      });

      const { rerender } = render(
        <CartridgeGallery
          edition={DEFAULT_EDITION}
          library={[emeraldCart]}
          available={[{ id: 'ruby', available: true, url: '/roms/ruby.gba' }]}
          catalogReady={true}
          busy={false}
          onEdition={handleEdition}
          onStart={handleStart}
        />,
      );

      expect(screen.getByText('2 枚卡带就绪')).toBeDefined();

      // Generation filter: click '初代'
      const gen1Tab = screen.getByRole('button', { name: '初代' });
      await userEvent.click(gen1Tab);
      expect(gen1Tab.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: '选择宝可梦 红' })).toBeDefined();
      expect(screen.queryByRole('button', { name: '选择宝可梦 绿宝石' })).toBeNull();

      // Search filter with case and whitespace trimming
      const searchInput = screen.getByRole('textbox', { name: '搜索宝可梦版本' });
      fireEvent.change(searchInput, { target: { value: '   yElLow   ' } });
      expect(screen.getByRole('button', { name: '选择宝可梦 黄' })).toBeDefined();
      expect(screen.queryByRole('button', { name: '选择宝可梦 红' })).toBeNull();

      // Empty search state and reset button
      fireEvent.change(searchInput, { target: { value: 'nonexistent-edition' } });
      expect(screen.getByText('没有找到这枚卡带')).toBeDefined();
      const resetBtn = screen.getByRole('button', { name: /查看全部卡带/ });
      await userEvent.click(resetBtn);
      expect(screen.getByRole('button', { name: '选择宝可梦 绿宝石' })).toBeDefined();

      // Initial loading state when catalogReady is false and readyCount is 0
      rerender(
        <CartridgeGallery
          edition={DEFAULT_EDITION}
          library={[]}
          available={[]}
          catalogReady={false}
          busy={false}
          onEdition={handleEdition}
          onStart={handleStart}
        />,
      );
      expect(screen.getByText('正在整理卡带')).toBeDefined();
    });

    it('triggers onEdition when tray slot is clicked and disables tray when busy', async () => {
      const handleEdition = vi.fn();
      const { rerender } = render(
        <CartridgeGallery
          edition={DEFAULT_EDITION}
          library={[]}
          available={[]}
          catalogReady={true}
          busy={false}
          onEdition={handleEdition}
          onStart={vi.fn()}
        />,
      );

      const rubyBtn = screen.getByRole('button', { name: '选择宝可梦 红宝石' });
      await userEvent.click(rubyBtn);
      const rubyEdition = getEdition('ruby');
      expect(handleEdition).toHaveBeenCalledWith(rubyEdition);

      // When busy, tray buttons are disabled
      rerender(
        <CartridgeGallery
          edition={DEFAULT_EDITION}
          library={[]}
          available={[]}
          catalogReady={true}
          busy={true}
          onEdition={handleEdition}
          onStart={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: '选择宝可梦 红宝石' }).hasAttribute('disabled'),
      ).toBe(true);
    });

    it('shows launch button with correct action text, caption, and disabled state depending on ready/busy/loading', async () => {
      const handleStart = vi.fn();
      const emerald = getEdition('emerald');
      if (!emerald) throw new Error('Missing emerald');

      const emeraldCart = createMockCartridge({
        header: { ...createMockCartridge().header, editionId: 'emerald' },
      });
      const { rerender } = render(
        <CartridgeGallery
          edition={emerald}
          library={[emeraldCart]}
          available={[]}
          catalogReady={true}
          busy={false}
          onEdition={vi.fn()}
          onStart={handleStart}
        />,
      );

      expect(screen.getByText('上次的冒险，还在这里等你。')).toBeDefined();
      const startBtn = screen.getByRole('button', { name: '开始冒险' });
      await userEvent.click(startBtn);
      expect(handleStart).toHaveBeenCalledTimes(1);

      // Available in catalog -> '本地卡带已就绪，随时可以出发。'
      rerender(
        <CartridgeGallery
          edition={emerald}
          library={[]}
          available={[{ id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }]}
          catalogReady={true}
          busy={false}
          onEdition={vi.fn()}
          onStart={handleStart}
        />,
      );
      expect(screen.getByText('本地卡带已就绪，随时可以出发。')).toBeDefined();
      expect(screen.getByRole('button', { name: '开始冒险' })).toBeDefined();

      // Not ready, catalog ready -> '导入你的卡带，开启这段冒险。'
      rerender(
        <CartridgeGallery
          edition={emerald}
          library={[]}
          available={[]}
          catalogReady={true}
          busy={false}
          onEdition={vi.fn()}
          onStart={handleStart}
        />,
      );
      expect(screen.getByText('导入你的卡带，开启这段冒险。')).toBeDefined();
      expect(screen.getByRole('button', { name: '导入卡带' })).toBeDefined();

      // Busy state
      rerender(
        <CartridgeGallery
          edition={emerald}
          library={[]}
          available={[]}
          catalogReady={true}
          busy={true}
          onEdition={vi.fn()}
          onStart={handleStart}
        />,
      );
      expect(screen.getByText('正在插入卡带…')).toBeDefined();
      expect(screen.getByRole('button', { name: '导入卡带' }).hasAttribute('disabled')).toBe(true);

      // Initial loading
      rerender(
        <CartridgeGallery
          edition={emerald}
          library={[]}
          available={[]}
          catalogReady={false}
          busy={false}
          onEdition={vi.fn()}
          onStart={handleStart}
        />,
      );
      expect(screen.getByText('正在整理卡带')).toBeDefined();
      expect(screen.getByRole('button', { name: '导入卡带' }).hasAttribute('disabled')).toBe(true);
    });
  });

  describe('SeriesLibrary', () => {
    it('handles edition row clicks, aria-pressed, owned/bundled/unavailable states and count summary', async () => {
      const handleEdition = vi.fn();
      const emerald = getEdition('emerald');
      const ruby = getEdition('ruby');
      if (!emerald || !ruby) throw new Error('Missing test editions');

      const emeraldCart = createMockCartridge({
        header: { ...createMockCartridge().header, editionId: 'emerald' },
      });

      const { rerender } = render(
        <SeriesLibrary
          edition={emerald}
          cartridge={null} // cartridge null initially
          library={[emeraldCart]}
          available={[
            { id: 'ruby', available: true, url: '/roms/ruby.gba' },
            { id: 'sapphire', available: false, url: null },
          ]}
          busy={false}
          onEdition={handleEdition}
          onCartridge={vi.fn()}
        />,
      );

      // Ready count in series summary: emerald (owned) + ruby (bundled) = 2 / 12
      expect(screen.getByText('2 / 12 就绪')).toBeDefined();

      // Featured card with cartridge=null and bundled=false (no ruby cartridge, emerald not bundled) -> '待导入'
      expect(screen.getByText('待导入')).toBeDefined();

      // Check aria-pressed on rows
      const emeraldRow = screen.getByRole('button', { name: '选择宝可梦 绿宝石' });
      const rubyRow = screen.getByRole('button', { name: '选择宝可梦 红宝石' });
      const sapphireRow = screen.getByRole('button', { name: '选择宝可梦 蓝宝石' });

      expect(emeraldRow.getAttribute('aria-pressed')).toBe('true');
      expect(rubyRow.getAttribute('aria-pressed')).toBe('false');

      // Click row triggers onEdition
      await userEvent.click(rubyRow);
      expect(handleEdition).toHaveBeenCalledWith(ruby);

      // Presence tooltip title checks:
      // emerald: owned -> '已收藏在此设备'
      expect(emeraldRow.querySelector('.edition-presence')?.getAttribute('title')).toBe(
        '已收藏在此设备',
      );
      // ruby: bundled -> '可以开始冒险'
      expect(rubyRow.querySelector('.edition-presence')?.getAttribute('title')).toBe(
        '可以开始冒险',
      );
      // sapphire: unavailable -> '导入你的卡带'
      expect(sapphireRow.querySelector('.edition-presence')?.getAttribute('title')).toBe(
        '导入你的卡带',
      );

      // Now set cartridge=null but edition is available in catalog -> featured card shows '卡带就绪'
      rerender(
        <SeriesLibrary
          edition={ruby}
          cartridge={null}
          library={[emeraldCart]}
          available={[
            { id: 'ruby', available: true, url: '/roms/ruby.gba' },
            { id: 'emerald', available: true, url: '/roms/emerald.gba' }, // overlapping owned + available
          ]}
          busy={false}
          onEdition={handleEdition}
          onCartridge={vi.fn()}
        />,
      );
      // Catalog-only featured edition with cartridge=null displays '卡带就绪'
      expect(screen.getByText('卡带就绪')).toBeDefined();
      // Overlapping emerald (owned & bundled) + ruby (bundled) = 2 distinct ready editions
      expect(screen.getByText('2 / 12 就绪')).toBeDefined();

      // Now set cartridge to emeraldCart -> featured card shows '卡带就绪'
      rerender(
        <SeriesLibrary
          edition={emerald}
          cartridge={emeraldCart}
          library={[emeraldCart]}
          available={[]}
          busy={false}
          onEdition={handleEdition}
          onCartridge={vi.fn()}
        />,
      );
      expect(screen.getByText('卡带就绪')).toBeDefined();
    });

    it('renders featured edition card, handles unknown cartridge fallback, and filters editions', async () => {
      const handleEdition = vi.fn();
      const handleCartridge = vi.fn();
      const emerald = getEdition('emerald');
      const cart = createMockCartridge();

      const { rerender } = render(
        <SeriesLibrary
          edition={emerald}
          cartridge={cart}
          library={[cart]}
          available={[]}
          busy={false}
          onEdition={handleEdition}
          onCartridge={handleCartridge}
        />,
      );

      // Featured card title and ready indicator
      expect(screen.getAllByText('宝可梦 绿宝石').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('卡带就绪')).toBeDefined();

      // Unknown edition fallback: edition undefined, custom cartridge
      const unknownCart = createMockCartridge({
        id: 'homebrew-rom',
        fileName: 'custom-homebrew.gba',
        header: { ...createMockCartridge().header, editionId: null, title: 'HOMEBREW' },
      });
      rerender(
        <SeriesLibrary
          edition={undefined}
          cartridge={unknownCart}
          library={[unknownCart]}
          available={[]}
          busy={false}
          onEdition={handleEdition}
          onCartridge={handleCartridge}
        />,
      );
      expect(screen.getByText('HOMEBREW')).toBeDefined();
      expect(screen.getAllByText('custom-homebrew.gba').length).toBeGreaterThanOrEqual(1);

      // Generation tabs: click '二代' (Gold, Silver, Crystal)
      const gen2Tab = screen.getByRole('button', { name: '二代' });
      await userEvent.click(gen2Tab);
      expect(screen.getByRole('button', { name: '选择宝可梦 水晶' })).toBeDefined();
      expect(screen.queryByRole('button', { name: '选择宝可梦 红' })).toBeNull();

      // Search filtering
      const searchInput = screen.getByRole('textbox', { name: '搜索宝可梦版本' });
      fireEvent.change(searchInput, { target: { value: 'Silver' } });
      expect(screen.getByRole('button', { name: '选择宝可梦 银' })).toBeDefined();

      // Empty search message
      fireEvent.change(searchInput, { target: { value: 'missing-version' } });
      expect(screen.getByText('没有找到这个版本，试试其他名字。')).toBeDefined();
    });

    it('expands local cartridges details and triggers onCartridge callback', async () => {
      const handleCartridge = vi.fn();
      const cart1 = createMockCartridge({
        id: 'cart-1',
        fileName: 'emerald-rev0.gba',
        header: { ...createMockCartridge().header, version: 0 },
      });
      const cart2 = createMockCartridge({
        id: 'cart-2',
        fileName: 'emerald-rev1.gba',
        header: { ...createMockCartridge().header, version: 1 },
      });

      const { container, rerender } = render(
        <SeriesLibrary
          edition={DEFAULT_EDITION}
          cartridge={cart1}
          library={[cart1, cart2]}
          available={[]}
          busy={false}
          onEdition={vi.fn()}
          onCartridge={handleCartridge}
        />,
      );

      const detailsEl = container.querySelector('details.local-cartridges') as HTMLDetailsElement;
      expect(detailsEl).toBeDefined();

      // Expand details element
      const summaryEl = screen.getByText(/本地收藏与其他修订版/);
      await userEvent.click(summaryEl);
      if (detailsEl) {
        detailsEl.open = true;
      }

      const cart2Button = screen.getByRole('button', { name: '载入本地卡带 emerald-rev1.gba' });
      await userEvent.click(cart2Button);
      expect(handleCartridge).toHaveBeenCalledWith(cart2);

      // Disabled when busy
      rerender(
        <SeriesLibrary
          edition={DEFAULT_EDITION}
          cartridge={cart1}
          library={[cart1, cart2]}
          available={[]}
          busy={true}
          onEdition={vi.fn()}
          onCartridge={handleCartridge}
        />,
      );
      expect(
        screen
          .getByRole('button', { name: '载入本地卡带 emerald-rev1.gba' })
          .hasAttribute('disabled'),
      ).toBe(true);
    });
  });
});
