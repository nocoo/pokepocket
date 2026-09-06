import { test, expect } from '../fixtures/browser-harness';
import { readFile } from 'node:fs/promises';
import {
  createExecutableGbCartridge,
  createExecutableGbcCartridge,
  createExecutableGbaCartridge,
} from '../fixtures/executable';

const systems = [
  {
    system: 'GB',
    ext: 'gb',
    builder: createExecutableGbCartridge,
    expectedWidth: 1200,
    expectedHeight: 1080,
    nativeWidth: 160,
    nativeHeight: 144,
    hasSolidFrame: false,
  },
  {
    system: 'GBC',
    ext: 'gbc',
    builder: createExecutableGbcCartridge,
    expectedWidth: 1200,
    expectedHeight: 1080,
    nativeWidth: 160,
    nativeHeight: 144,
    hasSolidFrame: false,
  },
  {
    system: 'GBA',
    ext: 'gba',
    builder: createExecutableGbaCartridge,
    expectedWidth: 1620,
    expectedHeight: 1080,
    nativeWidth: 240,
    nativeHeight: 160,
    hasSolidFrame: true,
  },
] as const;

for (const {
  system,
  ext,
  builder,
  expectedWidth,
  expectedHeight,
  nativeWidth,
  nativeHeight,
  hasSolidFrame,
} of systems) {
  test(`exports a sharp 1080p ${system} screenshot (${expectedWidth}x${expectedHeight}) with decoded content`, async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    const bytes = builder();
    await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
      name: `screenshot-${system.toLowerCase()}.${ext}`,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(bytes),
    });
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await expect
      .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
      .toBeGreaterThan(20);

    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
    const preview = page.getByAltText('即时存档 1 的游戏画面');
    await expect(preview).toBeVisible();
    const thumbnail = await preview.getAttribute('src');
    if (!thumbnail) throw new Error('Preview thumbnail src not found');

    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存游戏截图', exact: true }).click();
    const png = await downloaded;
    const pngPath = testInfo.outputPath(png.suggestedFilename());
    await png.saveAs(pngPath);
    const data = await readFile(pngPath);

    expect(png.suggestedFilename()).toMatch(/^pocket-.*\.png$/);
    // Standard PNG magic bytes: 0x89 'P' 'N' 'G' '\r' '\n' 0x1a '\n'
    expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // Read IHDR chunk width (offset 16) and height (offset 20)
    expect(data.readUInt32BE(16)).toBe(expectedWidth);
    expect(data.readUInt32BE(20)).toBe(expectedHeight);

    const [original, exported] = await page.evaluate(
      async (sources) => {
        return Promise.all(
          sources.map(async (source) => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('2D context not available');
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const colors = [...new Set(new Uint32Array(pixels.buffer))].sort();

            // Verify every single pixel alpha channel across the decoded image
            let allOpaque = true;
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] !== 255) {
                allOpaque = false;
                break;
              }
            }

            // Sample corner and center pixels as RGBA tuples
            const samplePixel = (x: number, y: number): [number, number, number, number] => {
              const idx = (y * canvas.width + x) * 4;
              return [
                pixels[idx] ?? 0,
                pixels[idx + 1] ?? 0,
                pixels[idx + 2] ?? 0,
                pixels[idx + 3] ?? 0,
              ];
            };

            const sampleValues = {
              topLeft: samplePixel(0, 0),
              center: samplePixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)),
              bottomRight: samplePixel(canvas.width - 1, canvas.height - 1),
            };

            return {
              width: canvas.width,
              height: canvas.height,
              colors,
              isOpaque: allOpaque,
              sampleValues,
            };
          }),
        );
      },
      [thumbnail, `data:image/png;base64,${data.toString('base64')}`],
    );

    if (!original || !exported) throw new Error('Evaluated images not found');
    expect([original.width, original.height]).toEqual([nativeWidth, nativeHeight]);
    expect([exported.width, exported.height]).toEqual([expectedWidth, expectedHeight]);
    expect(exported.isOpaque).toBe(true);

    if (hasSolidFrame) {
      // GBA fixture intentionally renders an initial solid red frame (Mode 3 BGR555: 0x001f).
      // Both the native preview and exported 1620x1080 screenshot must have exactly one color,
      // with dominant red channel (R >= 240, G <= 15, B <= 15, A = 255).
      expect(original.colors.length).toBe(1);
      expect(exported.colors).toEqual(original.colors);
      const [r, g, b, a] = exported.sampleValues.center;
      expect(r).toBeGreaterThanOrEqual(240);
      expect(g).toBeLessThanOrEqual(15);
      expect(b).toBeLessThanOrEqual(15);
      expect(a).toBe(255);
    } else {
      // GB / GBC fixtures render alternating pattern tiles (multiple colors)
      expect(original.colors.length).toBeGreaterThan(1);
      // Upscaling must preserve exact palette without interpolation blur
      expect(exported.colors).toEqual(original.colors);
    }

    await expect(preview).toHaveAttribute('src', thumbnail);

    // Attach decoded PNG measurement as JSON for independent reviewer inspection
    testInfo.attachments.push({
      name: `screenshot-${system.toLowerCase()}-measurements.json`,
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            system,
            filename: png.suggestedFilename(),
            expectedWidth,
            expectedHeight,
            original: {
              width: original.width,
              height: original.height,
              colorCount: original.colors.length,
              isOpaque: original.isOpaque,
              sampleValues: original.sampleValues,
            },
            exported: {
              width: exported.width,
              height: exported.height,
              colorCount: exported.colors.length,
              isOpaque: exported.isOpaque,
              paletteSample: exported.colors.map((c) => `0x${c.toString(16).padStart(8, '0')}`),
              sampleValues: exported.sampleValues,
            },
          },
          null,
          2,
        ),
        'utf8',
      ),
    });
  });
}
