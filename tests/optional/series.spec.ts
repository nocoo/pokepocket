import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { EDITIONS } from '../../src/lib/catalog';

for (const edition of EDITIONS) {
  test(`runs real Pokémon ${edition.english} with the correct native video and a save state`, async ({
    page,
    request,
  }, testInfo) => {
    const catalog = await (await request.get('/api/catalog')).json();
    test.skip(
      !catalog.editions.some(
        (item: { id: string; available: boolean }) => item.id === edition.id && item.available,
      ),
      `Build ${edition.id} with npm run rom:build.`,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: `选择宝可梦 ${edition.name}`, exact: true }).click();
    await expect(page.locator('.destination-title h2')).toHaveText(edition.name);
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', edition.system);
    await expect
      .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
      .toBeGreaterThan(20);
    await page.waitForTimeout(2400);
    const preview = page.getByAltText('即时存档 1 的游戏画面');
    let pixels = { width: 0, height: 0, colors: 0 };
    // Original intro animations include all-white/all-black transition frames.
    // Keep capturing until there is a rendered scene; a stalled renderer still fails.
    await expect
      .poll(
        async () => {
          const save = page.getByRole('button', { name: /^(保存到位置|替换即时存档) 1$/ });
          const replacing = (await save.getAttribute('aria-label')) === '替换即时存档 1';
          await save.click();
          if (replacing)
            await page
              .getByRole('dialog')
              .getByRole('button', { name: '确认替换', exact: true })
              .click();
          await expect(save).toBeEnabled();
          await expect(preview).toBeVisible();
          pixels = await preview.evaluate(async (img: HTMLImageElement) => {
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('2D context not available');
            context.drawImage(img, 0, 0);
            const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
            return {
              width: canvas.width,
              height: canvas.height,
              colors: new Set(new Uint32Array(bytes.buffer)).size,
            };
          });
          return pixels.colors;
        },
        { timeout: 12000, intervals: [500, 1000] },
      )
      .toBeGreaterThan(1);
    if (edition.system === 'GBA') expect([pixels.width, pixels.height]).toEqual([240, 160]);
    else
      expect([
        [160, 144],
        [256, 224],
      ]).toContainEqual([pixels.width, pixels.height]);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存游戏截图', exact: true }).click();
    const screenshot = await download;
    const screenshotPath = testInfo.outputPath(`series-${edition.id}.png`);
    await screenshot.saveAs(screenshotPath);
    const data = await readFile(screenshotPath);
    expect(data.readUInt32BE(16)).toBe(Math.round((pixels.width / pixels.height) * 1080));
    expect(data.readUInt32BE(20)).toBe(1080);
    expect(errors).toEqual([]);
  });
}

test('keeps each platform’s saves separate during hot switching and restores legacy Emerald collections', async ({
  page,
  request,
}) => {
  const catalog = await (await request.get('/api/catalog')).json();
  const required = ['emerald', 'red', 'crystal'];
  test.skip(
    !required.every((id) =>
      catalog.editions.some(
        (item: { id: string; available: boolean }) => item.id === id && item.available,
      ),
    ),
    'Build the series first.',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const thumbnails = new Map<string, string>();
  for (const id of required) {
    const edition = EDITIONS.find((item) => item.id === id);
    if (!edition) throw new Error(`Edition ${id} not found`);
    await page.getByRole('button', { name: `选择宝可梦 ${edition.name}`, exact: true }).click();
    if (id === 'emerald') await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.locator('.stage-heading h2')).toHaveText(`宝可梦 ${edition.name}`);
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await expect
      .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
      .toBeGreaterThan(20);
    await expect(page.getByAltText('即时存档 1 的游戏画面')).toHaveCount(0);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
    const preview = page.getByAltText('即时存档 1 的游戏画面');
    await expect(preview).toBeVisible();
    const thumb = await preview.getAttribute('src');
    if (!thumb) throw new Error(`Thumbnail src for ${id} not found`);
    thumbnails.set(id, thumb);
  }
  expect(new Set(thumbnails.values()).size).toBe(3);
  for (const id of ['red', 'emerald']) {
    const edition = EDITIONS.find((item) => item.id === id);
    if (!edition) throw new Error(`Edition ${id} not found`);
    await page.getByRole('button', { name: `选择宝可梦 ${edition.name}`, exact: true }).click();
    await expect(page.locator('.stage-heading h2')).toHaveText(`宝可梦 ${edition.name}`);
    const thumb = thumbnails.get(id);
    if (!thumb) throw new Error(`Thumbnail for ${id} not found`);
    await expect(page.getByAltText('即时存档 1 的游戏画面')).toHaveAttribute('src', thumb);
  }
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  // Simulate the cartridge metadata saved by the previous Emerald-only release.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('poke-pocket');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('cartridges', 'readwrite');
          const cursor = tx.objectStore('cartridges').openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            if (entry.value.header.editionId === 'emerald') {
              delete entry.value.header.system;
              delete entry.value.header.editionId;
              entry.update(entry.value);
            }
            entry.continue();
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page.route('**/roms/*', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.locator('.stage-heading h2')).toHaveText('宝可梦 绿宝石');
  const emeraldThumb = thumbnails.get('emerald');
  if (!emeraldThumb) throw new Error('Emerald thumbnail not found');
  await expect(page.getByAltText('即时存档 1 的游戏画面')).toHaveAttribute('src', emeraldThumb);
  await expect(page.getByRole('status')).toContainText('已继续上次的冒险');
  expect(errors).toEqual([]);
});
