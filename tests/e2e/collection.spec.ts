import { test, expect } from '../fixtures/browser-harness';
import { playableFixture } from '../fixtures/headers';

test('maps O/P, captures custom bindings, handles conflicts and restores preferences after reload', async ({
  page,
}) => {
  await page.goto('/');
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
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('pocket-settings');
        return raw ? JSON.parse(raw).bindings : null;
      }),
    )
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
      page.evaluate(() => {
        const raw = localStorage.getItem('pocket-settings');
        return raw ? JSON.parse(raw).bindings.A : null;
      }),
    )
    .toEqual(['KeyO']);
});

test('keeps every cartridge in the collection and opens import only when requested', async ({
  page,
}) => {
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

test('browses generations, searches versions and remembers a selection before loading', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.tray-slot')).toHaveCount(12);
  await page.getByRole('button', { name: '初代', exact: true }).click();
  await expect(page.locator('.tray-slot')).toHaveCount(4);
  await page.getByRole('button', { name: '二代', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索宝可梦版本' }).fill('Crystal');
  await expect(page.locator('.tray-slot')).toHaveCount(1);
  await page.getByRole('button', { name: '选择宝可梦 水晶', exact: true }).click();
  await page.reload();
  await expect(page.locator('.destination-title h2')).toHaveText('水晶');
  await expect(page.getByRole('button', { name: '选择宝可梦 水晶', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
