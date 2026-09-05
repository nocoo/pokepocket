import { afterEach, describe, expect, it, vi } from 'vitest';
import { upscaleScreenshot } from '../../src/lib/screenshot';
import { download } from '../../src/lib/storage';

describe('screenshot upscale and download behavior', () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('upscales a Game Boy (160x144) image to height 1080 with exact aspect ratio and crisp smoothing', async () => {
    // Aspect ratio 160:144 = 10:9 -> height 1080, width = round((160/144)*1080) = 1200
    const mockBlob = new Blob(['png-bytes-gb'], { type: 'image/png' });
    const drawImageSpy = vi.fn();
    const contextMock = {
      imageSmoothingEnabled: true,
      drawImage: drawImageSpy,
    };

    class FakeImage {
      naturalWidth = 160;
      naturalHeight = 144;
      src = '';
      async decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;

    let requestedMimeType = '';
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(contextMock),
      toBlob: vi.fn().mockImplementation((cb: (blob: Blob | null) => void, type?: string) => {
        requestedMimeType = type ?? '';
        cb(mockBlob);
      }),
    };

    globalThis.document = {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    } as unknown as Document;

    const resultBlob = await upscaleScreenshot('data:image/png;base64,mock');
    expect(resultBlob).toBe(mockBlob);
    expect(mockCanvas.height).toBe(1080);
    expect(mockCanvas.width).toBe(1200);
    expect(contextMock.imageSmoothingEnabled).toBe(false);
    expect(requestedMimeType).toBe('image/png');
    expect(drawImageSpy).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 1200, 1080);
  });

  it('upscales a Game Boy Advance (240x160) image to height 1080 with exact aspect ratio', async () => {
    // Aspect ratio 240:160 = 3:2 -> height 1080, width = round((240/160)*1080) = 1620
    const mockBlob = new Blob(['png-bytes-gba'], { type: 'image/png' });

    class FakeImage {
      naturalWidth = 240;
      naturalHeight = 160;
      src = '';
      async decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        imageSmoothingEnabled: true,
        drawImage: vi.fn(),
      }),
      toBlob: vi.fn().mockImplementation((cb: (blob: Blob | null) => void) => {
        cb(mockBlob);
      }),
    };

    globalThis.document = {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    } as unknown as Document;

    const resultBlob = await upscaleScreenshot('data:image/png;base64,mock-gba');
    expect(resultBlob).toBe(mockBlob);
    expect(mockCanvas.height).toBe(1080);
    expect(mockCanvas.width).toBe(1620);
  });

  it('rejects when image.decode fails', async () => {
    class FakeFailingImage {
      naturalWidth = 160;
      naturalHeight = 144;
      src = '';
      async decode() {
        throw new Error('Image decoding failed');
      }
    }
    globalThis.Image = FakeFailingImage as unknown as typeof Image;

    const createElementSpy = vi.fn();
    globalThis.document = {
      createElement: createElementSpy,
    } as unknown as Document;

    await expect(upscaleScreenshot('corrupt-source')).rejects.toThrow('Image decoding failed');
    expect(createElementSpy).not.toHaveBeenCalled();
  });

  it('waits for decode to settle before creating canvas or drawing', async () => {
    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((r) => {
      resolveDecode = r;
    });

    class FakeDeferredImage {
      naturalWidth = 160;
      naturalHeight = 144;
      src = '';
      async decode() {
        return decodePromise;
      }
    }
    globalThis.Image = FakeDeferredImage as unknown as typeof Image;

    const createElementSpy = vi.fn().mockReturnValue({
      getContext: vi.fn().mockReturnValue({ imageSmoothingEnabled: true, drawImage: vi.fn() }),
      toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void) => cb(new Blob())),
    });

    globalThis.document = {
      createElement: createElementSpy,
    } as unknown as Document;

    const upscalePromise = upscaleScreenshot('deferred-source');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Decode not yet resolved: canvas should not have been created yet
    expect(createElementSpy).not.toHaveBeenCalled();

    resolveDecode();
    await upscalePromise;
    expect(createElementSpy).toHaveBeenCalledWith('canvas');
  });

  it('rejects when canvas 2D context is unavailable', async () => {
    class FakeImage {
      naturalWidth = 160;
      naturalHeight = 144;
      src = '';
      async decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(null),
    };

    globalThis.document = {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    } as unknown as Document;

    await expect(upscaleScreenshot('data:image/png;base64,mock')).rejects.toThrow('无法生成截图');
  });

  it('rejects when canvas.toBlob returns null', async () => {
    class FakeImage {
      naturalWidth = 160;
      naturalHeight = 144;
      src = '';
      async decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        imageSmoothingEnabled: true,
        drawImage: vi.fn(),
      }),
      toBlob: vi.fn().mockImplementation((cb: (blob: Blob | null) => void) => {
        cb(null);
      }),
    };

    globalThis.document = {
      createElement: vi.fn().mockReturnValue(mockCanvas),
    } as unknown as Document;

    await expect(upscaleScreenshot('data:image/png;base64,mock')).rejects.toThrow('截图导出失败');
  });

  it('triggers download and performs cleanup including object URL revocation and anchor removal', async () => {
    let capturedBlob: Blob | null = null;
    const createObjectURLSpy = vi.fn().mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:http://localhost/test-uuid';
    });
    const revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy;
    URL.revokeObjectURL = revokeObjectURLSpy;

    const mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };

    const appendChildSpy = vi.fn();
    globalThis.document = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: appendChildSpy,
      },
    } as unknown as Document;

    let timerCallback: (() => void) | undefined;
    globalThis.window = {
      setTimeout: vi.fn().mockImplementation((cb: () => void) => {
        timerCallback = cb;
        return 999;
      }),
    } as unknown as Window & typeof globalThis;

    const payload = new Uint8Array([1, 2, 3, 4]);
    download(payload, 'save.sav', 'application/octet-stream');

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('save.sav');
    expect(mockAnchor.href).toBe('blob:http://localhost/test-uuid');
    expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(mockAnchor.remove).toHaveBeenCalled();

    // Verify blob bytes and type
    expect(capturedBlob).toBeDefined();
    if (capturedBlob) {
      expect((capturedBlob as Blob).type).toBe('application/octet-stream');
      const buffer = await (capturedBlob as Blob).arrayBuffer();
      expect(new Uint8Array(buffer)).toEqual(payload);
    }

    // Verify cleanup revocation
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();
    timerCallback?.();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
  });
});
