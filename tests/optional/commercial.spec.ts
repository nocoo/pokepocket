import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('selects bundled cartridges without a file dialog and preserves the canvas across all three frames', async ({
  page,
  request,
}) => {
  const catalog = await (await request.get('/api/catalog')).json();
  test.skip(
    !['red', 'crystal', 'sapphire'].every((id) =>
      catalog.editions.some(
        (item: { id: string; available: boolean }) => item.id === id && item.available,
      ),
    ),
    'Local cartridge integration test; supply these editions in roms/.',
  );
  const fileDialogs: string[] = [];
  const errors: string[] = [];
  page.on('filechooser', () => fileDialogs.push('opened'));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('region', { name: '宝可梦卡带选择盘' })).toBeVisible();
  await expect(page.locator('#game-stage')).not.toBeVisible();
  const canvas = await page.locator('#game-canvas').elementHandle();
  const colors: string[] = [];
  for (const [name, system] of [
    ['红', 'gb'],
    ['水晶', 'gbc'],
    ['蓝宝石', 'gba'],
  ] as const) {
    await page.getByRole('button', { name: `选择宝可梦 ${name}`, exact: true }).click();
    await expect(page.locator('.destination-title h2')).toHaveText(name);
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await expect(page.locator('.console-wrap')).toHaveClass(new RegExp(`system-${system}`));
    await expect
      .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
      .toBeGreaterThan(20);
    expect(
      canvas
        ? await canvas.evaluate((node) => node === document.querySelector('#game-canvas'))
        : false,
    ).toBe(true);
    const frame = await page.locator('.console-shell').boundingBox();
    expect(
      frame && (system === 'gba' ? frame.width > frame.height : frame.height > frame.width),
    ).toBe(true);
    colors.push(
      await page
        .locator('.console-shell')
        .evaluate((node) => getComputedStyle(node).backgroundImage),
    );
    await page.getByRole('button', { name: '返回卡带盘', exact: true }).click();
    await expect(page.locator('#cartridge-gallery')).toBeVisible();
    await expect(page.locator('.stage-status')).toContainText('已暂停');
    const before = await page.getByTestId('play-time').textContent();
    if (!before) throw new Error('Play time before pause not found');
    await page.keyboard.press('Space');
    await page.waitForTimeout(1100);
    await expect(page.getByTestId('play-time')).toHaveText(before);
  }
  expect(new Set(colors).size).toBe(3);
  const elapsed = await page.getByTestId('play-time').textContent();
  if (!elapsed) throw new Error('Elapsed play time not found');
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(page.getByTestId('play-time')).toHaveText(elapsed);
  expect(fileDialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test('runs the real Emerald ROM and restores an actual state after reloading', async ({
  page,
  request,
}, testInfo) => {
  const availability = await (await request.get('/api/cartridge')).json();
  test.skip(
    !availability.available,
    'Run npm run rom:build to enable the real-ROM integration test.',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect
    .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
    .toBeGreaterThan(20);
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
  const savedImage = page.getByAltText('即时存档 1 的游戏画面');
  await expect(savedImage).toBeVisible();
  const colors = await savedImage.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.drawImage(img, 0, 0, 240, 160);
    const bytes = context.getImageData(0, 0, 240, 160).data;
    return new Set(new Uint32Array(bytes.buffer)).size;
  });
  expect(colors).toBeGreaterThan(4);
  const thumbnail = await savedImage.getAttribute('src');
  if (!thumbnail) throw new Error('Saved image thumbnail src not found');

  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  const time = await page.getByTestId('play-time').textContent();
  if (!time) throw new Error('Play time not found');
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('play-time')).toHaveText(time);
  await expect(page.getByRole('button', { name: '读取即时存档 1', exact: true })).toBeEnabled();

  await page.route('**/roms/pokeemerald.gba', (route) => route.abort());
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('已继续上次的冒险');
  await expect(page.getByAltText('即时存档 1 的游戏画面')).toHaveAttribute('src', thumbnail);
  await page.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认读取', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('欢迎回来');
  await expect
    .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
    .toBeGreaterThan(20);
  await page.locator('#game-canvas').focus();
  await page.keyboard.down('ArrowUp');
  await expect(page.getByRole('button', { name: '方向上', exact: true })).toHaveClass(/is-pressed/);
  await page.keyboard.up('ArrowUp');
  await expect(page.getByRole('button', { name: '方向上', exact: true })).not.toHaveClass(
    /is-pressed/,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          index: 0,
          id: 'Pocket test controller',
          connected: true,
          mapping: 'standard',
          axes: [0, 0],
          buttons: [{ pressed: true, touched: true, value: 1 }],
        },
      ],
    });
  });
  await expect(page.locator('.console-right .action-a')).toHaveClass(/is-pressed/);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] }),
  );
  await expect(page.locator('.console-right .action-a')).not.toHaveClass(/is-pressed/);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存游戏截图', exact: true }).click();
  const png = await downloaded;
  const pngPath = testInfo.outputPath(png.suggestedFilename());
  await png.saveAs(pngPath);
  const data = await readFile(pngPath);
  expect(data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(data.readUInt32BE(16)).toBe(1620);
  expect(data.readUInt32BE(20)).toBe(1080);
  expect(errors).toEqual([]);
});
test('importing a battery save discards the stale automatic resume point and keeps manual saves', async ({
  page,
  request,
}) => {
  const availability = await (await request.get('/api/cartridge')).json();
  test.skip(!availability.available, 'Run npm run rom:build to enable the real-ROM test.');
  await page.goto('/');
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
  const preview = page.getByAltText('即时存档 1 的游戏画面');
  await expect(preview).toBeVisible();
  const thumbnail = await preview.getAttribute('src');
  if (!thumbnail) throw new Error('Preview thumbnail src not found');
  await page.getByRole('button', { name: '我的存档', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复进度', exact: true })).toBeEnabled();

  // An erased flash chip deliberately starts a different adventure. Importing it
  // must survive a tab crash before the next 30-second automatic checkpoint.
  await page.getByLabel('导入游戏存档', { exact: true }).setInputFiles({
    name: 'fresh-adventure.sav',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(131072, 0xff),
  });
  await page.getByRole('button', { name: '导入并启动', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('存档已导入');
  await expect(preview).toHaveAttribute('src', thumbnail);

  // Inspect committed data before pagehide can create a new checkpoint: an old
  // automatic state contains SRAM and would silently overwrite the imported save.
  const committed = await page.evaluate(
    () =>
      new Promise<{ slots: number[]; imported: boolean }>((resolve, reject) => {
        const open = indexedDB.open('poke-pocket');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['batteries', 'snapshots'], 'readonly');
          const batteries = tx.objectStore('batteries').getAll();
          const snapshots = tx.objectStore('snapshots').getAll();
          tx.oncomplete = () => {
            resolve({
              slots: snapshots.result.map((snapshot: { slot: number }) => snapshot.slot),
              imported: new Uint8Array(batteries.result[0].data as ArrayBuffer).every(
                (byte) => byte === 0xff,
              ),
            });
            db.close();
          };
          tx.onabort = () => {
            reject(tx.error);
            db.close();
          };
        };
      }),
  );
  expect(committed).toEqual({ slots: [1], imported: true });
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(preview).toHaveAttribute('src', thumbnail);
});
