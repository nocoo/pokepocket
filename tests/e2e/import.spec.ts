import { test, expect } from '../fixtures/browser-harness';
import { playableFixture } from '../fixtures/headers';

test('imports a cartridge into the browser and resumes with no ROM service after reload', async ({
  page,
}) => {
  const romRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/\/roms?\//.test(request.url()) || ['POST', 'PUT'].includes(request.method()))
      romRequests.push(`${request.method()} ${request.url()}`);
  });
  await page.route('**/roms/**', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: '选择宝可梦 红', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入卡带', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'original-test-program.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(playableFixture()),
  });
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', 'GB');
  await expect
    .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
    .toBeGreaterThan(20);
  await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
  const preview = page.getByAltText('即时存档 1 的游戏画面');
  await expect(preview).toBeVisible();
  const thumbnail = await preview.getAttribute('src');
  if (!thumbnail) throw new Error('Preview thumbnail src not found');
  await page.getByRole('button', { name: '返回卡带盘', exact: true }).click();
  await expect(page.locator('.case-capacity')).toContainText('1 枚卡带就绪');
  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('已继续上次的冒险');
  await expect(preview).toHaveAttribute('src', thumbnail);
  expect(romRequests).toEqual([]);
  expect(errors).toEqual([]);
});
