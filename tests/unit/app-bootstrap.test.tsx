// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { EDITIONS, DEFAULT_EDITION, getEdition, identifyEdition } from '../../src/lib/catalog';

describe('Application bootstrap and catalog public contracts', () => {
  describe('src/main.tsx startup boundaries', () => {
    let originalBodyHtml: string;

    beforeEach(() => {
      originalBodyHtml = document.body.innerHTML;
      vi.resetModules();
    });

    afterEach(() => {
      document.body.innerHTML = originalBodyHtml;
      cleanup();
      vi.restoreAllMocks();
      vi.resetModules();
    });

    it('fails with actionable error when #root element is missing before creating a root', async () => {
      // Ensure #root does not exist in DOM
      const existingRoot = document.getElementById('root');
      if (existingRoot) existingRoot.remove();

      await expect(async () => {
        await import('../../src/main');
      }).rejects.toThrow('Root element not found');
    });

    it('mounts real application into present #root element and cleans up resources', async () => {
      // Create fresh owned #root element
      const rootDiv = document.createElement('div');
      rootDiv.id = 'root';
      document.body.appendChild(rootDiv);

      // Mock fetch for catalog API during bootstrap
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ editions: [] }),
        }),
      );

      // Dynamically import main.tsx which executes createRoot(rootElement).render(<App />)
      await act(async () => {
        await import('../../src/main');
      });

      // Verify that React rendered inside #root
      expect(rootDiv.childNodes.length).toBeGreaterThan(0);
      expect(rootDiv.querySelector('.pocket-app')).not.toBeNull();

      // Clean up owned root element
      rootDiv.remove();
      expect(document.getElementById('root')).toBeNull();
    });
  });

  describe('catalog public contracts and edition identification', () => {
    it('provides valid default edition and catalog entries', () => {
      expect(DEFAULT_EDITION.id).toBe('emerald');
      expect(DEFAULT_EDITION.name).toBe('绿宝石');
      expect(DEFAULT_EDITION.system).toBe('GBA');
      expect(EDITIONS.length).toBeGreaterThan(0);
      expect(EDITIONS).toContain(DEFAULT_EDITION);
    });

    it('resolves editions by ID and handles null / undefined / unknown IDs gracefully', () => {
      expect(getEdition('emerald')).toBeDefined();
      expect(getEdition('emerald')?.name).toBe('绿宝石');
      expect(getEdition('red')?.name).toBe('红');
      expect(getEdition('crystal')?.name).toBe('水晶');

      // Null, undefined, and non-existent IDs return undefined
      expect(getEdition(null)).toBeUndefined();
      expect(getEdition(undefined)).toBeUndefined();
      expect(getEdition('non-existent-edition')).toBeUndefined();
      expect(getEdition('')).toBeUndefined();
    });

    it('identifies GBA editions across all supported prefixes and handles unknown prefixes / case sensitivity', () => {
      // Known GBA prefixes: AXV (ruby), AXP (sapphire), BPE (emerald), BPR (firered), BPG (leafgreen)
      expect(identifyEdition('GBA', 'RUBY', 'AXVE')).toBe('ruby');
      expect(identifyEdition('GBA', 'SAPPHIRE', 'AXPE')).toBe('sapphire');
      expect(identifyEdition('GBA', 'EMERALD', 'BPEE')).toBe('emerald');
      expect(identifyEdition('GBA', 'FIRERED', 'BPRE')).toBe('firered');
      expect(identifyEdition('GBA', 'LEAFGREEN', 'BPGE')).toBe('leafgreen');

      // Different language suffix on the 4th character preserves edition identification
      expect(identifyEdition('GBA', 'RUBY JPN', 'AXVJ')).toBe('ruby');
      expect(identifyEdition('GBA', 'SAPPHIRE GER', 'AXPD')).toBe('sapphire');
      expect(identifyEdition('GBA', 'EMERALD FRA', 'BPEF')).toBe('emerald');

      // Unknown game code prefix returns null
      expect(identifyEdition('GBA', 'CUSTOM GBA', 'CUST')).toBeNull();
      expect(identifyEdition('GBA', 'OTHER GAME', 'XXXX')).toBeNull();
      expect(identifyEdition('GBA', 'SHORT', 'BP')).toBeNull();
      expect(identifyEdition('GBA', 'EMPTY', '')).toBeNull();

      // Case sensitivity: lowercase game code prefixes return null
      expect(identifyEdition('GBA', 'EMERALD', 'bpee')).toBeNull();
    });

    it('identifies GB / GBC editions by title pattern across international / revision variants and unknown titles', () => {
      // Gen 1: Red, Green, Blue, Yellow
      expect(identifyEdition('GB', 'POKEMON RED', '')).toBe('red');
      expect(identifyEdition('GB', 'POKEMON RED VERSION', '')).toBe('red');
      expect(identifyEdition('GB', 'POKEMON GREEN', '')).toBe('green');
      expect(identifyEdition('GB', 'POKEMON BLUE', '')).toBe('blue');
      expect(identifyEdition('GB', 'POKEMON YELLOW', '')).toBe('yellow');
      expect(identifyEdition('GB', 'POKEMON YELL', '')).toBe('yellow');

      // Word boundary guards: 'POKEMON REDESIGN' should NOT match 'red'
      expect(identifyEdition('GB', 'POKEMON REDESIGN', '')).toBeNull();
      expect(identifyEdition('GB', 'POKEMON BLUEPRINT', '')).toBeNull();

      // Gen 2: Gold, Silver, Crystal
      expect(identifyEdition('GBC', 'POKEMON GOLD', '')).toBe('gold');
      expect(identifyEdition('GBC', 'POKEMON_GLD', '')).toBe('gold');
      expect(identifyEdition('GBC', 'POKEMON SILVER', '')).toBe('silver');
      expect(identifyEdition('GBC', 'POKEMON_SLV', '')).toBe('silver');
      expect(identifyEdition('GBC', 'POKEMON CRY', '')).toBe('crystal');
      expect(identifyEdition('GBC', 'PM_CRYSTAL', '')).toBe('crystal');

      // Unknown or non-Pokemon titles return null
      expect(identifyEdition('GB', 'SUPER MARIO', '')).toBeNull();
      expect(identifyEdition('GBC', 'ZELDA DX', '')).toBeNull();
      expect(identifyEdition('GB', '', '')).toBeNull();

      // Platform mismatch: GBA game with GB title does NOT use GB title patterns
      expect(identifyEdition('GBA', 'POKEMON RED', 'CUSTOM')).toBeNull();
    });
  });
});
