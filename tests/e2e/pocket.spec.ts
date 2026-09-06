import { test, expect } from '../fixtures/browser-harness';
import { createExecutableGbCartridge } from '../fixtures/executable';

test('validates invalid cartridges and preserves display preferences', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，想去哪里冒险？' })).toBeVisible();
  await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
    name: 'broken.gba',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(1024),
  });
  await expect(page.getByRole('alert')).toContainText('不是有效的 GB / GBC / GBA');
  await expect(page.locator('.play-toggle')).toBeDisabled();
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '复古液晶' }).click();
  await page.getByRole('switch', { name: '离开时自动暂停' }).click();
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.reload();
  await expect(page.locator('.game-screen')).toHaveClass(/lcd-filter/);
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByRole('switch', { name: '离开时自动暂停' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('mobile layout provides accessible controls without horizontal scrolling', async ({
  browser,
  extraHTTPHeaders,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders,
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.gallery-start')).toBeVisible();
    await page.getByRole('button', { name: '游玩指南', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: '你好，训练家。' })).toBeVisible();
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Launch with executable original cartridge to verify mobile controls and touch interactions without commercial branch
    await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
      name: 'mobile-probe.gb',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(createExecutableGbCartridge()),
    });
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '触屏方向上', exact: true })).toBeVisible();
    const button = page.locator('.mobile-controls .action-a');
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!box) throw new Error('Button bounding box not found');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await expect(button).toHaveClass(/is-pressed/);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(button).not.toHaveClass(/is-pressed/);
    await cdp.detach();
  } finally {
    await context.close();
  }
});
