import { test, expect, type Page } from '../fixtures/browser-harness';
import type { BatterySave, Snapshot } from '../../src/lib/storage';
import { playableFixture } from '../fixtures/headers';

async function readSaves(page: Page) {
  return page.evaluate(async () => {
    const records = await new Promise<{ snapshots: Snapshot[]; batteries: BatterySave[] }>(
      (resolve, reject) => {
        const open = indexedDB.open('poke-pocket');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['snapshots', 'batteries'], 'readonly');
          const snapshots = tx.objectStore('snapshots').getAll();
          const batteries = tx.objectStore('batteries').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve({ snapshots: snapshots.result, batteries: batteries.result });
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      },
    );
    const hash = async (data: ArrayBuffer) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    return {
      snapshots: await Promise.all(
        records.snapshots.map(async ({ data, ...snapshot }) => ({
          ...snapshot,
          hash: await hash(data),
        })),
      ),
      batteries: await Promise.all(
        records.batteries.map(async ({ data, ...battery }) => ({
          ...battery,
          hash: await hash(data),
        })),
      ),
    };
  });
}

async function saveToEmptySlot(page: Page, slot: number) {
  await page.getByRole('button', { name: `保存到位置 ${slot}`, exact: true }).click();
  await expect(page.getByAltText(`即时存档 ${slot} 的游戏画面`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: `替换即时存档 ${slot}`, exact: true }),
  ).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/catalog', (route) =>
    route.fulfill({ json: { mode: 'private', editions: [], systems: ['GB', 'GBC', 'GBA'] } }),
  );
  await page.goto('/');
  await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
    name: 'save-management-test.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(playableFixture()),
  });
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect
    .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
    .toBeGreaterThan(20);
});

test('confirms every restore and preserves the previous pause state when cancelled', async ({
  page,
}) => {
  await saveToEmptySlot(page, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = (await readSaves(page)).snapshots.find((snapshot) => snapshot.slot === 1);
  if (!saved) throw new Error('Saved snapshot slot 1 not found');

  await page.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '读取即时存档 01？', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByAltText('即时存档 01的预览')).toHaveAttribute(
    'src',
    saved.thumbnail,
  );
  await expect(confirmation.locator('time')).toHaveAttribute(
    'datetime',
    new Date(saved.updatedAt).toISOString(),
  );
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  const pausedAt = await page.getByTestId('play-time').textContent();
  if (!pausedAt) throw new Error('Paused play time not found');
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('play-time')).toHaveText(pausedAt);
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();

  const manager = page.getByRole('dialog', { name: '把这一刻，好好收起来。', exact: true });
  await page.getByRole('button', { name: '我的存档', exact: true }).click();
  await manager.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '继续游戏', exact: true }).click();
  await page.getByRole('button', { name: '我的存档', exact: true }).click();
  await manager.getByRole('button', { name: '恢复进度', exact: true }).click();
  const automatic = page.getByRole('dialog', { name: '读取自动存档？', exact: true });
  await expect(automatic).toBeVisible();
  await automatic.getByRole('button', { name: '取消', exact: true }).click();
  await expect(manager).toBeVisible();
  await manager.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认读取', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('欢迎回来');
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  expect((await readSaves(page)).snapshots.find((snapshot) => snapshot.slot === 1)).toEqual(saved);
});

test('replaces and clears only the confirmed slot, persists both, and reuses the empty position', async ({
  page,
}) => {
  for (const slot of [1, 2, 3]) await saveToEmptySlot(page, slot);
  // Let the CPU advance so replacing a save must capture a new emulated state.
  const savedAt = await page.getByTestId('play-time').textContent();
  if (!savedAt) throw new Error('Saved play time not found');
  await expect(page.getByTestId('play-time')).not.toHaveText(savedAt);
  await page.getByRole('button', { name: '我的存档', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '把这一刻，好好收起来。', exact: true });
  await expect(manager.getByRole('button', { name: '恢复进度', exact: true })).toBeEnabled();
  const original = await readSaves(page);

  await manager.getByRole('button', { name: '替换即时存档 2', exact: true }).click();
  const replacement = page.getByRole('dialog', { name: '替换即时存档 02？', exact: true });
  await expect(replacement).toContainText('将用当前游戏进度覆盖');
  await replacement.getByRole('button', { name: '取消', exact: true }).click();
  await expect(manager).toBeVisible();
  expect(await readSaves(page)).toEqual(original);

  await manager.getByRole('button', { name: '替换即时存档 2', exact: true }).click();
  await replacement.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(manager).toBeVisible();
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  const replaced = await readSaves(page);
  const before = original.snapshots.find((snapshot) => snapshot.slot === 2);
  const after = replaced.snapshots.find((snapshot) => snapshot.slot === 2);
  if (!before || !after) throw new Error('Snapshots for slot 2 not found');
  expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  expect(after.hash).not.toBe(before.hash);
  expect(replaced.snapshots.filter((snapshot) => snapshot.slot !== 2)).toEqual(
    original.snapshots.filter((snapshot) => snapshot.slot !== 2),
  );
  expect(replaced.batteries).toEqual(original.batteries);
  await expect(manager.getByAltText('即时存档 2 的游戏画面')).toHaveAttribute(
    'src',
    after.thumbnail,
  );

  await manager.getByRole('button', { name: '清除即时存档 1', exact: true }).click();
  const removal = page.getByRole('dialog', { name: '清除即时存档 01？', exact: true });
  await expect(removal).toContainText('永久清除');
  await removal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(manager).toBeVisible();
  expect(await readSaves(page)).toEqual(replaced);

  await manager.getByRole('button', { name: '清除即时存档 1', exact: true }).click();
  await removal.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(manager).toBeVisible();
  await expect(manager.getByRole('button', { name: '保存到位置 1', exact: true })).toBeEnabled();
  const cleared = await readSaves(page);
  expect(cleared).toEqual({
    snapshots: replaced.snapshots.filter((snapshot) => snapshot.slot !== 1),
    batteries: replaced.batteries,
  });
  await manager.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '开始冒险', exact: true }).click();
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存到位置 1', exact: true })).toBeEnabled();
  expect((await readSaves(page)).snapshots.filter((snapshot) => snapshot.slot > 0)).toEqual(
    cleared.snapshots.filter((snapshot) => snapshot.slot > 0),
  );
  await saveToEmptySlot(page, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const reused = await readSaves(page);
  const reusedSlot = reused.snapshots.find((snapshot) => snapshot.slot === 1);
  const originalSlot = original.snapshots.find((snapshot) => snapshot.slot === 1);
  if (!reusedSlot || !originalSlot) throw new Error('Snapshots for slot 1 not found');
  expect(reusedSlot.updatedAt).toBeGreaterThan(originalSlot.updatedAt);
  expect(reused.snapshots.filter((snapshot) => snapshot.slot > 1)).toEqual(
    cleared.snapshots.filter((snapshot) => snapshot.slot > 1),
  );
});

test('keeps the save and shows a retryable error in the confirmation if clearing fails', async ({
  page,
}) => {
  await saveToEmptySlot(page, 1);
  await page.getByRole('button', { name: '我的存档', exact: true }).click();
  const manager = page.getByRole('dialog', { name: '把这一刻，好好收起来。', exact: true });
  await expect(manager.getByRole('button', { name: '恢复进度', exact: true })).toBeEnabled();
  const saved = await readSaves(page);
  await manager.getByRole('button', { name: '清除即时存档 1', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '清除即时存档 01？', exact: true });

  // Fail the browser storage operation once, without replacing the emulator or save data.
  await page.evaluate(() => {
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (query) {
      if (this.name === 'snapshots') {
        IDBObjectStore.prototype.delete = remove;
        throw new DOMException('本地存储暂时不可用，请重试。', 'UnknownError');
      }
      return remove.call(this, query);
    };
  });
  await confirmation.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('本地存储暂时不可用');
  await expect(confirmation.getByRole('button', { name: '确认清除', exact: true })).toBeEnabled();
  expect(await readSaves(page)).toEqual(saved);
  await confirmation.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(manager).toBeVisible();
  await expect(manager.getByRole('button', { name: '保存到位置 1', exact: true })).toBeEnabled();
  expect((await readSaves(page)).snapshots.some((snapshot) => snapshot.slot === 1)).toBe(false);
});
