// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { Root, createRoot } from 'react-dom/client';
import { EDITIONS, DEFAULT_EDITION, getEdition, identifyEdition } from '../../src/lib/catalog';

type CreateRootArgs = Parameters<typeof createRoot>;

describe('Application bootstrap and catalog public contracts', () => {
  describe('src/main.tsx startup boundaries', () => {
    let capturedRoots: Root[] = [];
    let createRootCallCount = 0;
    let lastContainer: CreateRootArgs[0] | null = null;
    let ownedContainers: HTMLElement[] = [];

    beforeEach(async () => {
      capturedRoots = [];
      createRootCallCount = 0;
      lastContainer = null;
      ownedContainers = [];

      const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client');
      vi.doMock('react-dom/client', () => ({
        ...actual,
        createRoot: (...args: CreateRootArgs) => {
          createRootCallCount++;
          lastContainer = args[0];
          const root = actual.createRoot(...args);
          capturedRoots.push(root);
          return root;
        },
      }));
    });

    afterEach(() => {
      // Single, reliable cleanup path: unmount all captured roots first (without swallowing errors)
      try {
        while (capturedRoots.length > 0) {
          const root = capturedRoots.pop();
          if (root) {
            act(() => {
              root.unmount();
            });
          }
        }
      } finally {
        // Remove only the owned DOM nodes tracked by this test
        while (ownedContainers.length > 0) {
          const container = ownedContainers.pop();
          container?.remove();
        }

        // Fully unmock and reset modules so react-dom/client wrapper does not persist
        vi.doUnmock('react-dom/client');
        vi.doUnmock('../../src/App');
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.resetModules();
      }
    });

    it('fails with actionable error when #root element is missing before creating a root', async () => {
      // Assert the test DOM has no root element, never deleting foreign roots
      expect(document.getElementById('root')).toBeNull();

      await expect(async () => {
        await import('../../src/main');
      }).rejects.toThrow('Root element not found');

      // Missing root must fail before creating a root
      expect(createRootCallCount).toBe(0);
      expect(capturedRoots.length).toBe(0);
    });

    it('mounts real application entrypoint into present #root element and cleans up resources reliably', async () => {
      // Create fresh owned #root element tracked for cleanup
      const rootDiv = document.createElement('div');
      rootDiv.id = 'root';
      document.body.appendChild(rootDiv);
      ownedContainers.push(rootDiv);

      // Minimal App module fixture to avoid duplicating App integration and background storage/RAF work
      vi.doMock('../../src/App', () => ({
        default: () => <div className="mock-pocket-app-entry">POKEPOCKET_MOUNTED</div>,
      }));

      // Dynamically import main.tsx which executes createRoot(rootElement).render(<App />)
      await act(async () => {
        await import('../../src/main');
      });

      // Assert expected owned root argument and rendered fixture
      expect(createRootCallCount).toBe(1);
      expect(lastContainer).toBe(rootDiv);
      expect(capturedRoots.length).toBe(1);

      expect(rootDiv.childNodes.length).toBeGreaterThan(0);
      expect(rootDiv.querySelector('.mock-pocket-app-entry')).not.toBeNull();
      expect(rootDiv.textContent).toContain('POKEPOCKET_MOUNTED');
    });
  });

  describe('catalog public contracts and edition identification', () => {
    it('throws actionable error when default emerald edition is missing from catalog configuration', async () => {
      vi.resetModules();
      vi.doMock('../../src/data/editions.json', () => ({
        default: [
          {
            id: 'red',
            name: '红',
            english: 'Red',
            system: 'GB',
            generation: 1,
            year: 1996,
            region: '关都',
            regionEn: 'Kanto',
            mascot: 'charizard',
            mascotName: '喷火龙',
            color: '#ad5349',
            fileName: 'pokered.gb',
            language: 'zh-Hans',
            source: 'https://github.com/pret/pokered',
          },
        ],
      }));

      try {
        await expect(async () => {
          await import('../../src/lib/catalog');
        }).rejects.toThrow('默认版本 emerald 未配置');
      } finally {
        vi.doUnmock('../../src/data/editions.json');
        vi.resetModules();
      }
    });

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
