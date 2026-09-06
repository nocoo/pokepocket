import { test, expect } from '../fixtures/browser-harness';
import { readFile } from 'node:fs/promises';
import { playableFixture } from '../fixtures/headers';

for (const system of ['GB', 'GBC'] as const) {
  test(`exports a sharp 1080p ${system} screenshot while keeping save previews at native resolution`, async ({
    page,
  }) => {
    await page.goto('/');
    const bytes = playableFixture(system === 'GBC');
    await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
      name: `screenshot-pattern.${system.toLowerCase()}`,
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
    const pngPath = await png.path();
    if (!pngPath) throw new Error('Downloaded PNG path not found');
    const data = await readFile(pngPath);
    expect(png.suggestedFilename()).toMatch(/^pocket-.*\.png$/);
    expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(data.readUInt32BE(16)).toBe(1200);
    expect(data.readUInt32BE(20)).toBe(1080);

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
            return {
              width: canvas.width,
              height: canvas.height,
              colors: [...new Set(new Uint32Array(pixels.buffer))].sort(),
            };
          }),
        );
      },
      [thumbnail, `data:image/png;base64,${data.toString('base64')}`],
    );
    if (!original || !exported) throw new Error('Evaluated images not found');
    expect([original.width, original.height]).toEqual([160, 144]);
    expect(original.colors.length).toBeGreaterThan(1);
    // Interpolation would introduce colors absent from the native pixel art.
    expect(exported.colors).toEqual(original.colors);
    await expect(preview).toHaveAttribute('src', thumbnail);
  });
}
