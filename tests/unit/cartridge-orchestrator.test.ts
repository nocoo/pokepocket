import { describe, expect, it, vi } from 'vitest';
import { type Cartridge, parseHeader } from '../../src/lib/cartridge';
import { createCartridgeOrchestrator } from '../../src/lib/cartridge-orchestrator';

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
    const cartridge = createMockCartridge({
      id: 'cart-crystal',
      header: { ...createMockCartridge().header, editionId: 'crystal' },
    });
    const savePreferences = vi.fn();

    const orchestrator = createCartridgeOrchestrator({
      savePreferences,
    });

    await orchestrator.initialize({
      storage: {
        listCartridges: async () => [cartridge],
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => [],
      loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: null }),
    });

    const success = await orchestrator.selectEdition('crystal');
    expect(success).toBe(true);
    expect(orchestrator.getState().selectedEditionId).toBe('crystal');
    expect(orchestrator.getState().selectedId).toBe('cart-crystal');
    expect(savePreferences).toHaveBeenCalledWith({
      lastEditionId: 'crystal',
      lastCartridgeId: 'cart-crystal',
    });
  });

  it('inserts and switches to new cartridge file, updating library and view', async () => {
    const bytes = fixtureGbaBytes('BPEE');
    const file = new File([bytes.buffer], 'pokeemerald.gba');
    const putStorage = vi.fn().mockResolvedValue(undefined);
    const savePrefs = vi.fn();
    const mockCanvas = {
      focus: vi.fn(),
    } as unknown as HTMLCanvasElement;

    let storedCartridge: Cartridge | null = null;
    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: async () => (storedCartridge ? [storedCartridge] : []),
        putCartridge: async (cart) => {
          storedCartridge = cart;
          await putStorage(cart);
        },
      },
      savePreferences: savePrefs,
      getCanvas: () => mockCanvas,
      emulator: {
        getSnapshot: () => ({ status: 'stopped', cartridge: null }),
        load: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
      },
    });

    const success = await orchestrator.insertCartridgeFile(file);

    expect(success).toBe(true);
    expect(putStorage).toHaveBeenCalled();
    const state = orchestrator.getState();
    expect(state.library).toHaveLength(1);
    expect(state.selectedEditionId).toBe('emerald');
    expect(state.view).toBe('play');
    expect(savePrefs).toHaveBeenCalled();
  });

  it('preserves existing cartridge reference when selecting the same cartridge without reinserting', async () => {
    const cartridge = createMockCartridge({ id: 'cart-same' });
    const savePrefs = vi.fn();

    const orchestrator = createCartridgeOrchestrator({
      savePreferences: savePrefs,
    });

    await orchestrator.selectCartridge(cartridge);
    expect(orchestrator.getState().selectedId).toBe('cart-same');

    // Selecting again should update selection cleanly without error
    await orchestrator.selectCartridge(cartridge);
    expect(orchestrator.getState().selectedId).toBe('cart-same');
    expect(savePrefs).toHaveBeenCalledTimes(2);
  });

  it('runs storage and catalog in parallel during initialize', async () => {
    let resolveStorage: () => void = () => {};
    let catalogStarted = false;

    const storagePromise = new Promise<Cartridge[]>((resolve) => {
      resolveStorage = () => resolve([]);
    });

    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: () => storagePromise,
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => {
        catalogStarted = true;
        return [];
      },
    });

    const initPromise = orchestrator.initialize();
    await Promise.resolve();

    // Catalog fetch starts even while storage listing is pending
    expect(catalogStarted).toBe(true);
    resolveStorage();
    await initPromise;
  });

  it('protects against stale delayed initialize overwriting newer user selection', async () => {
    let resolveStorage: () => void = () => {};
    const storagePromise = new Promise<Cartridge[]>((resolve) => {
      resolveStorage = () => resolve([]);
    });

    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: () => storagePromise,
        putCartridge: vi.fn(),
      },
      fetchCatalog: async () => [],
      loadPreferences: () => ({ lastCartridgeId: null, lastEditionId: 'emerald' }),
    });

    const initPromise = orchestrator.initialize();
    // User selects ruby before delayed initialize resolves
    await orchestrator.selectEdition('ruby');
    expect(orchestrator.getState().selectedEditionId).toBe('ruby');

    resolveStorage();
    await initPromise;

    // Must NOT revert to emerald
    expect(orchestrator.getState().selectedEditionId).toBe('ruby');
  });

  it('pauses and records running state on openCartridgePicker, resumes on finishCartridgePicker', () => {
    const pauseSpy = vi.fn();
    const resumeSpy = vi.fn();
    let currentStatus = 'running';

    const orchestrator = createCartridgeOrchestrator({
      emulator: {
        getSnapshot: () => ({ status: currentStatus, cartridge: createMockCartridge() }),
        load: vi.fn(),
        resume: () => {
          resumeSpy();
          currentStatus = 'running';
        },
        pause: () => {
          pauseSpy();
          currentStatus = 'paused';
        },
        persist: vi.fn(),
      },
      releaseInput: vi.fn(),
      openPicker: vi.fn(),
    });

    orchestrator.openCartridgePicker();
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    orchestrator.finishCartridgePicker();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects openCartridgePicker when orchestrator or external is busy', () => {
    const pauseSpy = vi.fn();
    const openPickerSpy = vi.fn();

    const orchestrator = createCartridgeOrchestrator({
      isExternalBusy: () => true,
      emulator: {
        getSnapshot: () => ({ status: 'running', cartridge: createMockCartridge() }),
        load: vi.fn(),
        resume: vi.fn(),
        pause: pauseSpy,
        persist: vi.fn(),
      },
      openPicker: openPickerSpy,
    });

    const opened = orchestrator.openCartridgePicker();
    expect(opened).toBe(false);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(openPickerSpy).not.toHaveBeenCalled();
  });

  it('handles load failure in startAdventure gracefully and remains retryable', async () => {
    const cartridge = createMockCartridge({ id: 'cart-fail' });
    const notifySpy = vi.fn();
    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;

    const loadMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Wasm memory exhausted'))
      .mockResolvedValueOnce(undefined);

    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: async () => [cartridge],
        putCartridge: vi.fn(),
      },
      emulator: {
        getSnapshot: () => ({ status: 'idle', cartridge: null }),
        load: loadMock,
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
      },
      getCanvas: () => mockCanvas,
      notify: notifySpy,
    });

    await orchestrator.initialize({
      loadPreferences: () => ({ lastCartridgeId: 'cart-fail', lastEditionId: 'emerald' }),
    });

    // First attempt fails
    const firstResult = await orchestrator.startAdventure();
    expect(firstResult).toBe(false);
    expect(notifySpy).toHaveBeenCalledWith('Wasm memory exhausted', true);
    expect(orchestrator.getState().busy).toBe(false);

    // Second attempt succeeds (retryable)
    const secondResult = await orchestrator.startAdventure();
    expect(secondResult).toBe(true);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it('orders persistence and library refresh correctly on returnToGallery', async () => {
    const cartridge = createMockCartridge({ id: 'cart-playing' });
    const callOrder: string[] = [];

    const persistPromise = vi.fn().mockImplementation(async () => {
      callOrder.push('persist');
    });

    const listPromise = vi.fn().mockImplementation(async () => {
      callOrder.push('listCartridges');
      return [cartridge];
    });

    const beforeReturnSpy = vi.fn().mockImplementation(() => {
      callOrder.push('beforeReturn');
    });

    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: listPromise,
        putCartridge: vi.fn(),
      },
      emulator: {
        getSnapshot: () => ({ status: 'running', cartridge }),
        load: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
        persist: persistPromise,
      },
      onBeforeReturnToGallery: beforeReturnSpy,
    });

    orchestrator.setView('play');

    const result = await orchestrator.returnToGallery();
    expect(result).toBe(true);
    expect(callOrder).toEqual(['beforeReturn', 'persist', 'listCartridges']);
    expect(orchestrator.getState().view).toBe('library');
  });

  it('handles persist failure in returnToGallery, notifies error, and resets busy state', async () => {
    const cartridge = createMockCartridge({ id: 'cart-playing' });
    const notifySpy = vi.fn();

    const orchestrator = createCartridgeOrchestrator({
      emulator: {
        getSnapshot: () => ({ status: 'running', cartridge }),
        load: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn().mockRejectedValue(new Error('QuotaExceededError')),
      },
      notify: notifySpy,
    });

    orchestrator.setView('play');

    const result = await orchestrator.returnToGallery();
    expect(result).toBe(false);
    expect(notifySpy).toHaveBeenCalledWith('QuotaExceededError', true);
    expect(orchestrator.getState().busy).toBe(false);
  });

  it('preserves pending catalog loading even if cartridge is inserted during initialization', async () => {
    let resolveCatalog: (val: { id: string; available: boolean; url: string }[]) => void = () => {};
    const catalogPromise = new Promise<{ id: string; available: boolean; url: string }[]>(
      (resolve) => {
        resolveCatalog = resolve;
      },
    );

    const file = new File([fixtureGbaBytes('BPEE').buffer], 'pokeemerald.gba');
    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;

    const orchestrator = createCartridgeOrchestrator({
      fetchCatalog: () => catalogPromise,
      getCanvas: () => mockCanvas,
      emulator: {
        getSnapshot: () => ({ status: 'idle', cartridge: null }),
        load: vi.fn(),
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
      },
    });

    const initPromise = orchestrator.initialize();
    await orchestrator.insertCartridgeFile(file);

    resolveCatalog([{ id: 'emerald', available: true, url: '/roms/pokeemerald.gba' }]);
    await initPromise;

    expect(orchestrator.getState().catalogReady).toBe(true);
    expect(orchestrator.getState().available).toHaveLength(1);
  });

  it('keeps orchestrator busy during remote ROM fetch in startAdventure and rejects conflicting edition selection', async () => {
    let resolveResponse: (res: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });

    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;
    const bytes = fixtureGbaBytes('BPEE');

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = () => fetchPromise;

      const orchestrator = createCartridgeOrchestrator({
        fetchCatalog: async () => [
          { id: 'emerald', available: true, url: '/roms/pokeemerald.gba' },
        ],
        getCanvas: () => mockCanvas,
        emulator: {
          getSnapshot: () => ({ status: 'idle', cartridge: null }),
          load: vi.fn(),
          resume: vi.fn(),
          pause: vi.fn(),
          persist: vi.fn(),
        },
      });

      await orchestrator.initialize();

      const startPromise = orchestrator.startAdventure();
      expect(orchestrator.getState().busy).toBe(true);

      const conflictingSelect = await orchestrator.selectEdition('ruby');
      expect(conflictingSelect).toBe(false);
      expect(orchestrator.getState().selectedEditionId).toBe('emerald');

      resolveResponse(
        new Response(bytes.buffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
      );
      const startResult = await startPromise;
      expect(startResult).toBe(true);
      expect(orchestrator.getState().busy).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('catches and notifies network failure during ROM fetch in startAdventure without uncaught rejection', async () => {
    const notifySpy = vi.fn();
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => {
        throw new Error('Connection refused');
      };

      const orchestrator = createCartridgeOrchestrator({
        fetchCatalog: async () => [
          { id: 'emerald', available: true, url: '/roms/pokeemerald.gba' },
        ],
        emulator: {
          getSnapshot: () => ({ status: 'idle', cartridge: null }),
          load: vi.fn(),
          resume: vi.fn(),
          pause: vi.fn(),
          persist: vi.fn(),
        },
        notify: notifySpy,
      });

      await orchestrator.initialize();

      const startResult = await orchestrator.startAdventure();
      expect(startResult).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith('Connection refused', true);
      expect(orchestrator.getState().busy).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves valid pending initial library read if an invalid cartridge import fails before storage write', async () => {
    let resolveStorage: (rows: Cartridge[]) => void = () => {};
    const storagePromise = new Promise<Cartridge[]>((resolve) => {
      resolveStorage = resolve;
    });

    const savedCartridge = createMockCartridge({ id: 'existing-cart' });
    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: () => storagePromise,
        putCartridge: vi.fn(),
      },
      loadPreferences: () => ({ lastCartridgeId: 'existing-cart', lastEditionId: 'emerald' }),
    });

    const initPromise = orchestrator.initialize();

    // Import invalid file (< 192 bytes)
    const invalidFile = new File([new Uint8Array(8)], 'bad.gba');
    const importResult = await orchestrator.insertCartridgeFile(invalidFile);
    expect(importResult).toBe(false);

    // Initial storage read now resolves with previously saved cartridge
    resolveStorage([savedCartridge]);
    await initPromise;

    // Should NOT discard valid storage result
    const state = orchestrator.getState();
    expect(state.storageReady).toBe(true);
    expect(state.library).toEqual([savedCartridge]);
    expect(state.selectedId).toBe('existing-cart');
  });

  it('cancel() ignores pending responses on unmount and protects newer initialization generation', async () => {
    let resolveFirstStorage: (rows: Cartridge[]) => void = () => {};
    const firstPromise = new Promise<Cartridge[]>((resolve) => {
      resolveFirstStorage = resolve;
    });

    const oldCart = createMockCartridge({ id: 'old-cart' });
    const newCart = createMockCartridge({ id: 'new-cart' });

    let currentPromise: Promise<Cartridge[]> = firstPromise;
    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: () => currentPromise,
        putCartridge: vi.fn(),
      },
    });

    const firstInit = orchestrator.initialize();
    // Simulate unmount / cancel
    orchestrator.cancel();

    // Simulate newer initialization
    currentPromise = Promise.resolve([newCart]);
    const secondInit = orchestrator.initialize();

    // Old async storage finishes late
    resolveFirstStorage([oldCart]);
    await firstInit;
    await secondInit;

    // Must reflect newer initialization, not cancelled older one
    expect(orchestrator.getState().library).toEqual([newCart]);
  });

  it('supports subscribe and unsubscribe listener lifecycle', async () => {
    const orchestrator = createCartridgeOrchestrator();
    let updates = 0;
    const unsubscribe = orchestrator.subscribe(() => {
      updates++;
    });

    orchestrator.setView('play');
    expect(updates).toBe(1);

    unsubscribe();
    orchestrator.setView('library');
    expect(updates).toBe(1); // No new update after unsubscribe
  });

  it('notifies error and resets busy state if selectEdition load fails', async () => {
    const cartridge = createMockCartridge({
      id: 'cart-ruby',
      header: { ...createMockCartridge().header, editionId: 'ruby' },
    });
    const notifySpy = vi.fn();
    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;

    const emulator = {
      getSnapshot: () => ({
        status: 'running',
        cartridge: createMockCartridge({ id: 'cart-current' }),
      }),
      load: vi.fn().mockRejectedValue(new Error('Core failed to load')),
      resume: vi.fn(),
      pause: vi.fn(),
      persist: vi.fn(),
    };

    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: async () => [cartridge],
        putCartridge: vi.fn(),
      },
      emulator,
      getCanvas: () => mockCanvas,
      notify: notifySpy,
    });

    await orchestrator.initialize();
    orchestrator.setView('play');

    const result = await orchestrator.selectEdition('ruby');
    expect(result).toBe(false);
    expect(notifySpy).toHaveBeenCalledWith('Core failed to load', true);
    expect(orchestrator.getState().busy).toBe(false);
  });

  it('notifies error and resets busy state if selectCartridge load fails', async () => {
    const cartridge = createMockCartridge({ id: 'cart-diff' });
    const notifySpy = vi.fn();
    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;

    const emulator = {
      getSnapshot: () => ({
        status: 'running',
        cartridge: createMockCartridge({ id: 'cart-current' }),
      }),
      load: vi.fn().mockRejectedValue(new Error('Load cartridge crashed')),
      resume: vi.fn(),
      pause: vi.fn(),
      persist: vi.fn(),
    };

    const orchestrator = createCartridgeOrchestrator({
      emulator,
      getCanvas: () => mockCanvas,
      notify: notifySpy,
    });

    orchestrator.setView('play');
    const result = await orchestrator.selectCartridge(cartridge);
    expect(result).toBe(false);
    expect(notifySpy).toHaveBeenCalledWith('Load cartridge crashed', true);
    expect(orchestrator.getState().busy).toBe(false);
  });

  it('setDependencies updates handlers dynamically', async () => {
    const initialNotify = vi.fn();
    const updatedNotify = vi.fn();
    const updatedOpenPicker = vi.fn();
    const orchestrator = createCartridgeOrchestrator({ notify: initialNotify });

    orchestrator.setDependencies({
      notify: updatedNotify,
      openPicker: updatedOpenPicker,
    });

    expect(orchestrator.openCartridgePicker()).toBe(true);
    expect(updatedOpenPicker).toHaveBeenCalledTimes(1);

    const invalidFile = new File([new Uint8Array(8)], 'bad.gba');
    expect(await orchestrator.insertCartridgeFile(invalidFile)).toBe(false);
    expect(initialNotify).not.toHaveBeenCalled();
    expect(updatedNotify).toHaveBeenCalled();
  });

  it('refreshLibrary reports storage errors when active and stays silent after cancel', async () => {
    const errorSpy = vi.fn();
    const shouldThrow = { current: true };
    const orchestrator = createCartridgeOrchestrator({
      storage: {
        listCartridges: async () => {
          if (shouldThrow.current) throw new Error('Read failed');
          return [createMockCartridge()];
        },
        putCartridge: vi.fn(),
      },
      onStorageError: errorSpy,
    });

    await orchestrator.refreshLibrary();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    orchestrator.cancel();
    await orchestrator.refreshLibrary();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    shouldThrow.current = false;
    await orchestrator.refreshLibrary();
    expect(orchestrator.getState().library).toEqual([]);
  });

  it('handles selectEdition in play view for unknown editions, paused switching, catalog starts, and picker fallback', async () => {
    const emerald = createMockCartridge({
      id: 'cart-emerald',
      header: { ...createMockCartridge().header, editionId: 'emerald' },
    });
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    const releaseInputSpy = vi.fn();
    const openPickerSpy = vi.fn();
    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () =>
        new Response(fixtureGbaBytes('AXVE').buffer, {
          headers: { 'Content-Type': 'application/octet-stream' },
        });

      const orchestrator = createCartridgeOrchestrator({
        storage: {
          listCartridges: async () => [emerald],
          putCartridge: vi.fn(),
        },
        fetchCatalog: async () => [{ id: 'ruby', available: true, url: '/roms/ruby.gba' }],
        emulator: {
          getSnapshot: () => ({
            status: 'paused',
            cartridge: createMockCartridge({ id: 'cart-other' }),
          }),
          load: loadSpy,
          resume: vi.fn(),
          pause: vi.fn(),
          persist: vi.fn(),
        },
        getCanvas: () => mockCanvas,
        releaseInput: releaseInputSpy,
        openPicker: openPickerSpy,
      });

      await orchestrator.initialize();
      orchestrator.setView('play');

      // Unknown edition falls back to default (emerald) and loads owned cartridge while paused
      expect(await orchestrator.selectEdition('unknown-edition')).toBe(true);
      expect(orchestrator.getState().selectedEditionId).toBe('emerald');
      expect(releaseInputSpy).toHaveBeenCalledTimes(1);
      expect(loadSpy).toHaveBeenCalledWith(emerald, mockCanvas);

      // Unowned edition available in catalog delegates to startAdventure
      expect(await orchestrator.selectEdition('ruby')).toBe(true);
      expect(loadSpy).toHaveBeenCalledTimes(2);

      // Unowned edition unavailable in catalog opens cartridge picker
      expect(await orchestrator.selectEdition('sapphire')).toBe(true);
      expect(openPickerSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles selectCartridge busy guard, missing editionId fallback, and missing canvas in play view', async () => {
    const externalBusy = { current: true };
    const loadSpy = vi.fn();
    const savePrefsSpy = vi.fn();
    const orchestrator = createCartridgeOrchestrator({
      isExternalBusy: () => externalBusy.current,
      savePreferences: savePrefsSpy,
      emulator: {
        getSnapshot: () => ({
          status: 'paused',
          cartridge: createMockCartridge({ id: 'cart-other' }),
        }),
        load: loadSpy,
        resume: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
      },
      getCanvas: () => null,
    });

    const base = createMockCartridge({ id: 'cart-no-edition' });
    const noEditionCart: Cartridge = {
      ...base,
      header: { ...base.header, editionId: null },
    };

    expect(await orchestrator.selectCartridge(noEditionCart)).toBe(false);

    externalBusy.current = false;
    orchestrator.setView('play');
    expect(await orchestrator.selectCartridge(noEditionCart)).toBe(true);
    expect(orchestrator.getState().selectedEditionId).toBe('emerald');
    expect(savePrefsSpy).toHaveBeenCalledWith({
      lastCartridgeId: 'cart-no-edition',
      lastEditionId: 'emerald',
    });
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('covers startAdventure guards, resume branch, missing canvas, and catalog errors', async () => {
    const emerald = createMockCartridge({
      id: 'cart-em',
      header: { ...createMockCartridge().header, editionId: 'emerald' },
    });
    const resumeSpy = vi.fn();
    const openPickerSpy = vi.fn();
    const notifySpy = vi.fn();
    const scrollToSpy = vi.fn();
    const mockCanvas = { focus: vi.fn() } as unknown as HTMLCanvasElement;
    const externalBusy = { current: true };
    let snapshot: { status: string; cartridge: Cartridge | null } = {
      status: 'loading',
      cartridge: null,
    };
    let canvasRef: HTMLCanvasElement | null = mockCanvas;
    let catalog: { id: string; available: boolean; url: string | null }[] = [];
    let library: Cartridge[] = [];

    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;

    try {
      vi.stubGlobal('window', { scrollTo: scrollToSpy });

      const orchestrator = createCartridgeOrchestrator({
        isExternalBusy: () => externalBusy.current,
        storage: {
          listCartridges: async () => library,
          putCartridge: vi.fn(),
        },
        fetchCatalog: async () => catalog,
        emulator: {
          getSnapshot: () => snapshot,
          load: vi.fn(),
          resume: resumeSpy,
          pause: vi.fn(),
          persist: vi.fn(),
        },
        getCanvas: () => canvasRef,
        openPicker: openPickerSpy,
        notify: notifySpy,
      });

      // Busy guard
      expect(await orchestrator.startAdventure()).toBe(false);
      externalBusy.current = false;

      // Loading guard
      expect(await orchestrator.startAdventure()).toBe(false);

      // Neither selected nor available -> open picker
      snapshot = { status: 'idle', cartridge: null };
      expect(await orchestrator.startAdventure()).toBe(true);
      expect(openPickerSpy).toHaveBeenCalledTimes(1);

      // Selected resolves via selectedEditionId fallback + paused -> resume + scrollTo
      library = [emerald];
      await orchestrator.initialize();
      snapshot = { status: 'paused', cartridge: emerald };
      expect(await orchestrator.startAdventure()).toBe(true);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(mockCanvas.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

      // Selected present but getCanvas returns null
      snapshot = { status: 'idle', cartridge: null };
      canvasRef = null;
      expect(await orchestrator.startAdventure()).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith('游戏画面尚未就绪，请重试。', true);

      // Local available with null URL
      library = [];
      catalog = [{ id: 'emerald', available: true, url: null }];
      await orchestrator.initialize();
      expect(await orchestrator.startAdventure()).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith('本地目录中未找到这枚卡带，请导入你的 ROM。', true);

      // Local available with text/html response
      catalog = [{ id: 'emerald', available: true, url: '/roms/emerald.gba' }];
      await orchestrator.initialize();
      globalThis.fetch = async () =>
        new Response('<html>404</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      expect(await orchestrator.startAdventure()).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith('无法读取本地卡带，请检查文件后刷新页面。', true);
    } finally {
      globalThis.window = originalWindow;
      globalThis.fetch = originalFetch;
    }
  });

  it('covers insertCartridgeFile busy guard, duplicate id reuse, missing canvas, non-Error throw, and storage.persist', async () => {
    const bytes = fixtureGbaBytes('BPEE');
    const file = new File([bytes.buffer], 'pokeemerald.gba');
    const existingCart = createMockCartridge({
      id: (await (await import('../../src/lib/cartridge')).readCartridge(file)).id,
    });
    const notifySpy = vi.fn();
    const putSpy = vi.fn().mockResolvedValue(undefined);
    const persistSpy = vi.fn().mockRejectedValue(new Error('denied'));
    const externalBusy = { current: true };
    let canvasRef: HTMLCanvasElement | null = null;
    const originalNavigator = globalThis.navigator;

    try {
      vi.stubGlobal('navigator', { storage: { persist: persistSpy } });
      const orchestrator = createCartridgeOrchestrator({
        isExternalBusy: () => externalBusy.current,
        storage: {
          listCartridges: async () => [existingCart],
          putCartridge: putSpy,
        },
        getCanvas: () => canvasRef,
        notify: notifySpy,
      });

      expect(await orchestrator.insertCartridgeFile(file)).toBe(false);
      externalBusy.current = false;

      // Existing cartridge reused + missing canvas error
      expect(await orchestrator.insertCartridgeFile(file)).toBe(false);
      expect(putSpy).toHaveBeenCalledWith(existingCart);
      expect(notifySpy).toHaveBeenCalledWith('游戏画面尚未就绪，请重试。', true);

      // Success triggers navigator.storage.persist() and swallows rejection
      canvasRef = { focus: vi.fn() } as unknown as HTMLCanvasElement;
      expect(await orchestrator.insertCartridgeFile(file)).toBe(true);
      expect(persistSpy).toHaveBeenCalledTimes(1);

      // Non-Error failure falls back to default notification string
      putSpy.mockRejectedValueOnce('non-error-string');
      expect(await orchestrator.insertCartridgeFile(file)).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith('操作失败，请检查文件或稍后重试。', true);
    } finally {
      vi.stubGlobal('navigator', originalNavigator);
    }
  });

  it('covers returnToGallery guards, fullscreen exit, null cartridge, and finishCartridgePicker paused no-op', async () => {
    const resumeSpy = vi.fn();
    const persistSpy = vi.fn();
    const exitFullscreenSpy = vi.fn().mockRejectedValue(new Error('exit blocked'));
    const scrollToSpy = vi.fn();
    const externalBusy = { current: true };
    let status = 'loading';
    const cartridge: Cartridge | null = null;

    try {
      vi.stubGlobal('window', { scrollTo: scrollToSpy });
      vi.stubGlobal('document', {
        fullscreenElement: {},
        exitFullscreen: exitFullscreenSpy,
      });

      const orchestrator = createCartridgeOrchestrator({
        isExternalBusy: () => externalBusy.current,
        emulator: {
          getSnapshot: () => ({ status, cartridge }),
          load: vi.fn(),
          resume: resumeSpy,
          pause: vi.fn(),
          persist: persistSpy,
        },
      });

      expect(await orchestrator.returnToGallery()).toBe(false);
      externalBusy.current = false;

      // Loading / already in library view
      expect(await orchestrator.returnToGallery()).toBe(false);
      orchestrator.setView('play');
      expect(await orchestrator.returnToGallery()).toBe(false);

      // Paused with null cartridge exits fullscreen, skips persist, scrolls top
      status = 'paused';
      expect(await orchestrator.returnToGallery()).toBe(true);
      expect(exitFullscreenSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy).not.toHaveBeenCalled();
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

      // Picker opened while already paused does not resume on finish
      expect(orchestrator.openCartridgePicker()).toBe(true);
      orchestrator.finishCartridgePicker();
      expect(resumeSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
