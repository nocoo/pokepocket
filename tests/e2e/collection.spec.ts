import { test, expect } from '@playwright/test';
import { playableFixture } from '../fixtures/headers';

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
      .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0'))
      .toBeGreaterThan(20);
    expect(await canvas!.evaluate((node) => node === document.querySelector('#game-canvas'))).toBe(
      true,
    );
    const frame = await page.locator('.console-shell').boundingBox();
    expect(system === 'gba' ? frame!.width > frame!.height : frame!.height > frame!.width).toBe(
      true,
    );
    colors.push(
      await page
        .locator('.console-shell')
        .evaluate((node) => getComputedStyle(node).backgroundImage),
    );
    await page.getByRole('button', { name: '返回卡带盘', exact: true }).click();
    await expect(page.locator('#cartridge-gallery')).toBeVisible();
    await expect(page.locator('.stage-status')).toContainText('已暂停');
    const before = await page.getByTestId('play-time').textContent();
    await page.keyboard.press('Space');
    await page.waitForTimeout(1100);
    await expect(page.getByTestId('play-time')).toHaveText(before!);
  }
  expect(new Set(colors).size).toBe(3);
  const elapsed = await page.getByTestId('play-time').textContent();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(page.getByTestId('play-time')).toHaveText(elapsed!);
  expect(fileDialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test('maps O/P, captures custom bindings, handles conflicts and restores preferences after reload', async ({
  page,
  request,
}) => {
  const availability = await (await request.get('/api/cartridge')).json();
  await page.goto('/');
  if (availability.available)
    await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  else
    await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
      name: 'original-test-program.gb',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(playableFixture()),
    });
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  const a = page.locator('.console-right .action-a');
  const b = page.locator('.console-right .action-b');
  await page.locator('#game-canvas').focus();
  await page.keyboard.down('o');
  await expect(a).toHaveClass(/is-pressed/);
  await page.keyboard.up('o');
  await page.keyboard.down('p');
  await expect(b).toHaveClass(/is-pressed/);
  await page.keyboard.up('p');
  await page.keyboard.down('x');
  await expect(a).not.toHaveClass(/is-pressed/);
  await page.keyboard.up('x');
  await page.keyboard.down('o');
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(a).not.toHaveClass(/is-pressed/);
  await page.keyboard.up('o');
  await page.getByRole('button', { name: '修改 A 主要键位', exact: true }).click();
  await page.keyboard.press('w');
  await expect(page.locator('.binding-feedback')).toContainText('已分配给');
  await page.keyboard.press('m');
  await expect(page.locator('.binding-feedback')).toContainText('已用于静音');
  await page.keyboard.press('k');
  await expect(page.getByRole('button', { name: '修改 A 主要键位', exact: true })).toHaveText('K');
  await page.getByRole('button', { name: '修改 B 主要键位', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '修改 B 主要键位', exact: true })).toHaveText('P');
  await page.getByRole('button', { name: '修改 B 备用键位', exact: true }).click();
  await page.keyboard.press('j');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pocket-settings')!).bindings))
    .toMatchObject({ A: ['KeyK'], B: ['KeyP', 'KeyJ'] });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.locator('#game-canvas').focus();
  await page.keyboard.down('k');
  await expect(a).toHaveClass(/is-pressed/);
  await page.keyboard.up('k');
  await page.keyboard.down('o');
  await expect(a).not.toHaveClass(/is-pressed/);
  await page.keyboard.up('o');
  await page.keyboard.down('j');
  await expect(b).toHaveClass(/is-pressed/);
  await page.keyboard.up('j');
  await page.getByRole('button', { name: '返回卡带盘', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await page.locator('#game-canvas').focus();
  await page.keyboard.down('k');
  await expect(a).toHaveClass(/is-pressed/);
  await page.keyboard.up('k');
  await page.getByRole('button', { name: '游玩指南', exact: true }).click();
  await expect(page.locator('.full-keyboard')).toContainText('P / J');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '恢复默认键位', exact: true }).click();
  await expect(page.getByRole('button', { name: '修改 A 主要键位', exact: true })).toHaveText('O');
  await expect(page.getByRole('button', { name: '修改 B 备用键位', exact: true })).toHaveText('+');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('pocket-settings')!).bindings.A),
    )
    .toEqual(['KeyO']);
});

test('keeps every cartridge in the collection and opens import only when requested', async ({
  page,
}) => {
  await page.route('**/api/catalog', (route) =>
    route.fulfill({ json: { editions: [], systems: ['GB', 'GBC', 'GBA'] } }),
  );
  let opened = false;
  page.on('filechooser', () => {
    opened = true;
  });
  await page.goto('/');
  await page.getByRole('button', { name: '选择宝可梦 绿', exact: true }).click();
  await expect(page.getByRole('button', { name: '导入卡带', exact: true })).toBeEnabled();
  await expect(page.locator('.launch-caption')).toContainText('导入你的卡带');
  expect(opened).toBe(false);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入卡带', exact: true }).click();
  await picker;
  expect(opened).toBe(true);
  await expect(page.getByRole('region', { name: '宝可梦卡带选择盘' })).toBeVisible();
});
