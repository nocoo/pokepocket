import { describe, expect, it, vi } from 'vitest';
import { createCartridgeOrchestrator } from '../../src/lib/cartridge-orchestrator';
import { parseHeader, type Cartridge } from '../../src/lib/cartridge';

function fixtureGbaBytes(editionCode = 'BPEE') {
  const data = new Uint8Array(1024);
  data.set(new TextEncoder().encode('POKEMON EMER'), 0xa0);
  data.set(new TextEncoder().encode(`${editionCode}01`), 0xac);
  data[0xb2] = 0x96;
  let checksum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= data[i] ?? 0;
  data[0xbd] = (checksum - 0x19) & 0xff;
  data.set(new TextEncoder().encode('FLASH1M_V103\0SIIRTC_V001'), 0x100);
  return data;
}

function createMockCartridge(overrides: Partial<Cartridge> = {}): Cartridge {
  const bytes = fixtureGbaBytes();
  const header = parseHeader(bytes.buffer);
  return {
    id: 'cart-emerald-1',
    fileName: 'pokeemerald.gba',
    data: bytes.buffer,
    header,
    addedAt: 1000,
    lastPlayed: 2000,
    playTime: 120,
    ...overrides,
  };
}

describe('cartridge orchestrator', () => {
  it('initializes with default edition when no cartridges or preferences exist', async () => {
    const orchestrator = createCartridgeOrchestrator();
    await orchestrator.initialize({
      storage: {
        listCartridges: async () => [],
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => [{ id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }],
      loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: null }),
    });

    const state = orchestrator.getState();
    expect(state.storageReady).toBe(true);
    expect(state.catalogReady).toBe(true);
    expect(state.selectedEditionId).toBe('emerald');
    expect(state.selectedId).toBeNull();
    expect(state.available).toHaveLength(1);
    expect(state.view).toBe('library');
  });

  it('restores preferred cartridge and edition on initialize', async () => {
    const orchestrator = createCartridgeOrchestrator();
    const cartridge = createMockCartridge({
      id: 'saved-cart-id',
      header: { ...createMockCartridge().header, editionId: 'ruby' },
    });

    await orchestrator.initialize({
      storage: {
        listCartridges: async () => [cartridge],
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => [],
      loadPreferences: () => ({ lastCartridgeId: 'saved-cart-id', lastEditionId: 'ruby' }),
    });

    const state = orchestrator.getState();
    expect(state.selectedId).toBe('saved-cart-id');
    expect(state.selectedEditionId).toBe('ruby');
    expect(state.library).toHaveLength(1);
  });

  it('preserves usable local library when catalog fetch fails', async () => {
    const orchestrator = createCartridgeOrchestrator();
    const cartridge = createMockCartridge();

    await orchestrator.initialize({
      storage: {
        listCartridges: async () => [cartridge],
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => {
        throw new Error('Network offline');
      },
      loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: null }),
    });

    const state = orchestrator.getState();
    expect(state.storageReady).toBe(true);
    expect(state.catalogReady).toBe(true);
    expect(state.library).toEqual([cartridge]);
    expect(state.available).toEqual([]);
  });

  it('invokes storage error callback on storage failure without throwing', async () => {
    const orchestrator = createCartridgeOrchestrator();
    const errorSpy = vi.fn();

    await orchestrator.initialize({
      storage: {
        listCartridges: async () => {
          throw new Error('IndexedDB blocked');
        },
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => [],
      loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: null }),
      onStorageError: errorSpy,
    });

    expect(errorSpy).toHaveBeenCalled();
    expect(orchestrator.getState().storageReady).toBe(false);
  });

  it('selects an edition, resolves owned cartridge, and persists preferences', async () => {
    const orchestrator = createCartridgeOrchestrator();
    const cartridge = createMockCartridge({
      id: 'cart-crystal',
      header: { ...createMockCartridge().header, editionId: 'crystal' },
    });

    await orchestrator.initialize({
      storage: {
        listCartridges: async () => [cartridge],
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => [],
      loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: null }),
    });

    const savePreferences = vi.fn();
    const result = orchestrator.selectEdition('crystal', savePreferences);

    expect(result.selectedCartridge).toEqual(cartridge);
    expect(result.edition.id).toBe('crystal');
    expect(orchestrator.getState().selectedEditionId).toBe('crystal');
    expect(orchestrator.getState().selectedId).toBe('cart-crystal');
    expect(savePreferences).toHaveBeenCalledWith({
      lastEditionId: 'crystal',
      lastCartridgeId: 'cart-crystal',
    });
  });

  it('inserts and switches to new cartridge, updating library and view', async () => {
    const orchestrator = createCartridgeOrchestrator();
    const newCart = createMockCartridge({
      id: 'new-rom-99',
      header: { ...createMockCartridge().header, editionId: 'firered' },
    });
    const putStorage = vi.fn().mockResolvedValue(undefined);
    const savePrefs = vi.fn();

    await orchestrator.insertCartridge(newCart, putStorage, savePrefs);

    expect(putStorage).toHaveBeenCalledWith(newCart);
    const state = orchestrator.getState();
    expect(state.library).toContainEqual(newCart);
    expect(state.selectedId).toBe('new-rom-99');
    expect(state.selectedEditionId).toBe('firered');
    expect(state.view).toBe('play');
    expect(savePrefs).toHaveBeenCalledWith({
      lastCartridgeId: 'new-rom-99',
      lastEditionId: 'firered',
    });
  });

  it('preserves existing cartridge reference when selecting the same cartridge without reinserting', () => {
    const orchestrator = createCartridgeOrchestrator();
    const cartridge = createMockCartridge({ id: 'cart-same' });
    const savePrefs = vi.fn();

    orchestrator.selectCartridge(cartridge, savePrefs);
    expect(orchestrator.getState().selectedId).toBe('cart-same');

    // Selecting again should update selection cleanly without error
    orchestrator.selectCartridge(cartridge, savePrefs);
    expect(orchestrator.getState().selectedId).toBe('cart-same');
    expect(savePrefs).toHaveBeenCalledTimes(2);
  });
});
