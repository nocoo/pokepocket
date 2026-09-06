import {
  test,
  expect,
  sampleCanvasPixels,
  readIndexedDBBatteries,
  readIndexedDBSnapshots,
  type StoredSnapshotRecord,
} from '../fixtures/browser-harness';
import {
  createExecutableGbCartridge,
  createExecutableGbcCartridge,
  createExecutableGbaCartridge,
  createInitialBattery,
  ORIGINAL_BATTERY_SIZE,
} from '../fixtures/executable';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PLATFORMS = [
  { system: 'GB', ext: 'gb', builder: createExecutableGbCartridge },
  { system: 'GBC', ext: 'gbc', builder: createExecutableGbcCartridge },
  { system: 'GBA', ext: 'gba', builder: createExecutableGbaCartridge },
] as const;

function computeRomId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test.describe('Core Cartridge Journeys', () => {
  for (const { system, ext, builder } of PLATFORMS) {
    test(`${system}: import, start, pause, resume, and reload from IndexedDB without network`, async ({
      page,
    }) => {
      await page.goto('/');
      const romBytes = builder();
      const expectedRomId = computeRomId(romBytes);
      const fileName = `executable-probe.${ext}`;

      await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
        name: fileName,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(romBytes),
      });

      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
      await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', system);
      await expect
        .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
        .toBeGreaterThan(20);

      // Verify canvas rendered initial frame
      const initialPixels = await sampleCanvasPixels(page);
      expect(initialPixels.some((val, idx) => idx % 4 !== 3 && val > 0)).toBe(true);

      // Pause game
      await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
      await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
      const pausedTime = await page.getByTestId('play-time').textContent();
      if (!pausedTime) throw new Error('Missing paused time');
      await page.waitForTimeout(1100);
      await expect(page.getByTestId('play-time')).toHaveText(pausedTime);

      // Resume game
      await page.getByRole('button', { name: '继续游戏', exact: true }).click();
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Take a snapshot so IndexedDB has a snapshot and metadata
      await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
      await expect(page.getByAltText('即时存档 1 的游戏画面')).toBeVisible();

      // Return to case and verify cartridge persisted in IndexedDB
      await page.getByRole('button', { name: '返回卡带盘', exact: true }).click();
      await expect(page.locator('#cartridge-gallery')).toBeVisible();

      // Verify cartridge persistence in IndexedDB
      const persistedCartridge = await page.evaluate(async (id: string) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('poke-pocket');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          return await new Promise<{
            id: string;
            fileName: string;
            header: { system: string };
            data: number[];
          } | null>((resolve, reject) => {
            const tx = db.transaction('cartridges', 'readonly');
            const req = tx.objectStore('cartridges').get(id);
            req.onsuccess = () => {
              const res = req.result;
              if (!res) {
                resolve(null);
                return;
              }
              resolve({
                id: res.id,
                fileName: res.fileName,
                header: { system: res.header?.system },
                data: [...new Uint8Array(res.data)],
              });
            };
            req.onerror = () => reject(req.error);
          });
        } finally {
          db.close();
        }
      }, expectedRomId);
      expect(persistedCartridge).not.toBeNull();
      expect(persistedCartridge?.id).toBe(expectedRomId);
      expect(persistedCartridge?.fileName).toBe(fileName);
      expect(persistedCartridge?.header.system).toBe(system);
      expect(persistedCartridge?.data).toEqual([...romBytes]);

      // Reload page and abort any network ROM requests
      await page.route('**/roms/**', (route) => route.abort());
      await page.reload();

      await page.locator('.gallery-start').click();
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
      await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', system);
      await expect
        .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
        .toBeGreaterThan(20);
      const reloadedPixels = await sampleCanvasPixels(page);
      expect(reloadedPixels.some((val, idx) => idx % 4 !== 3 && val > 0)).toBe(true);
      await expect(page.getByRole('status')).toContainText('已继续上次的冒险');
      await expect(page.getByAltText('即时存档 1 的游戏画面')).toBeVisible();
    });
  }

  test('hot switching between GB, GBC, and GBA preserves distinct saves and systems', async ({
    page,
  }) => {
    await page.goto('/');

    const cartridges = [
      { name: 'probe-gb', ext: 'gb', builder: createExecutableGbCartridge, system: 'GB' },
      { name: 'probe-gbc', ext: 'gbc', builder: createExecutableGbcCartridge, system: 'GBC' },
      { name: 'probe-gba', ext: 'gba', builder: createExecutableGbaCartridge, system: 'GBA' },
    ] as const;

    const expectedRomIds = new Map<string, string>();
    const expectedInitialBatteries = new Map<string, number[]>();
    const initialSnapshots = new Map<string, StoredSnapshotRecord>();

    const getRomBatteryByte0 = async (romId: string) => {
      const bats = await readIndexedDBBatteries(page);
      const match = bats.find((b) => b.romId === romId);
      return match && match.data.length > 0 ? match.data[0] : null;
    };

    // Import GB -> GBC -> GBA sequentially while game remains active
    for (const [idx, cart] of cartridges.entries()) {
      const { name, ext, builder, system } = cart;
      const romBytes = builder();
      const romId = computeRomId(romBytes);
      expectedRomIds.set(system, romId);

      await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
        name: `${name}.${ext}`,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(romBytes),
      });
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
      await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', system);
      await expect
        .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
        .toBeGreaterThan(20);

      // Wait for this specific cartridge battery to initialize to 1
      await expect.poll(() => getRomBatteryByte0(romId), { timeout: 15000 }).toBe(1);

      // Press A 'idx' times so each platform has a distinct battery byte0 (GB: 1, GBC: 2, GBA: 3)
      for (let press = 0; press < idx; press++) {
        const targetByte = 2 + press;
        await page.locator('#game-canvas').focus();
        try {
          await page.keyboard.down('KeyO');
          await expect.poll(() => getRomBatteryByte0(romId), { timeout: 15000 }).toBe(targetByte);
        } finally {
          await page.keyboard.up('KeyO');
        }
        await page.waitForTimeout(100);
      }

      // Save to slot 1
      await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
      const preview = page.getByAltText('即时存档 1 的游戏画面');
      await expect(preview).toBeVisible();

      // Record full battery payload and complete manual snapshot record
      const bats = await readIndexedDBBatteries(page);
      const currentBat = bats.find((b) => b.romId === romId);
      if (!currentBat) throw new Error(`Missing battery for ${system}`);
      expectedInitialBatteries.set(system, [...currentBat.data]);

      const snaps = await readIndexedDBSnapshots(page);
      const currentSnap = snaps.find((s) => s.romId === romId && s.slot === 1);
      if (!currentSnap) throw new Error(`Missing slot 1 snapshot for ${system}`);
      initialSnapshots.set(system, { ...currentSnap });
    }

    // Verify all 3 cartridges have distinct snapshots and batteries
    const snapshots = await readIndexedDBSnapshots(page);
    const slot1Snapshots = snapshots.filter((s) => s.slot === 1);
    expect(slot1Snapshots.length).toBe(3);
    expect(new Set(slot1Snapshots.map((s) => s.romId)).size).toBe(3);

    const allBatteries = await readIndexedDBBatteries(page);
    expect(allBatteries.length).toBe(3);

    // Switch back to GB and GBC while game remains active via visible details.local-cartridges
    for (const sys of ['GB', 'GBC'] as const) {
      const romId = expectedRomIds.get(sys);
      if (!romId) throw new Error(`Missing expected romId for ${sys}`);
      const cartConfig = cartridges.find((c) => c.system === sys);
      if (!cartConfig) throw new Error(`Missing cartConfig for ${sys}`);
      const expectedFileName = `${cartConfig.name}.${cartConfig.ext}`;
      const expectedBattery = expectedInitialBatteries.get(sys);
      const expectedSnapshot = initialSnapshots.get(sys);
      if (!expectedBattery || !expectedSnapshot)
        throw new Error(`Missing expected state for ${sys}`);

      // Ensure details.local-cartridges is open
      const details = page.locator('details.local-cartridges');
      await expect(details).toBeVisible();
      const isOpen = await details.evaluate((node: HTMLDetailsElement) => node.open);
      if (!isOpen) {
        await details.locator('summary').click();
      }

      // Click the exact local-file button
      await page
        .getByRole('button', { name: `载入本地卡带 ${expectedFileName}`, exact: true })
        .click();

      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
      await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', sys);
      await expect
        .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
        .toBeGreaterThan(20);

      // Verify manual snapshot identity and thumbnail
      await expect(page.getByAltText('即时存档 1 的游戏画面')).toHaveAttribute(
        'src',
        expectedSnapshot.thumbnail,
      );

      // Compare complete per-ROM battery payloads across switches
      const bats = await readIndexedDBBatteries(page);
      const matchingBat = bats.find((b) => b.romId === romId);
      expect(matchingBat).toBeDefined();
      expect(matchingBat?.data).toEqual(expectedBattery);

      // Compare complete manual snapshot records (key, romId, slot, thumbnail, coreVersion, full data bytes)
      const currentSnaps = await readIndexedDBSnapshots(page);
      const matchingSnap = currentSnaps.find((s) => s.romId === romId && s.slot === 1);
      expect(matchingSnap).toBeDefined();
      expect(matchingSnap?.key).toBe(expectedSnapshot.key);
      expect(matchingSnap?.romId).toBe(expectedSnapshot.romId);
      expect(matchingSnap?.slot).toBe(expectedSnapshot.slot);
      expect(matchingSnap?.thumbnail).toBe(expectedSnapshot.thumbnail);
      expect(matchingSnap?.coreVersion).toBe(expectedSnapshot.coreVersion);
      expect(matchingSnap?.data).toEqual(expectedSnapshot.data);
    }

    // After switching back to GB and GBC, compare the final full battery payload and
    // full manual Snapshot record for ALL THREE expected ROM IDs against their initially captured records.
    // This catches corruption of an inactive GBA cartridge as well. Snapshot updatedAt should remain unchanged.
    const finalBatteries = await readIndexedDBBatteries(page);
    const finalSnapshots = await readIndexedDBSnapshots(page);

    for (const sys of ['GB', 'GBC', 'GBA'] as const) {
      const romId = expectedRomIds.get(sys);
      if (!romId) throw new Error(`Missing expected romId for final check ${sys}`);
      const expectedBattery = expectedInitialBatteries.get(sys);
      const expectedSnapshot = initialSnapshots.get(sys);
      if (!expectedBattery || !expectedSnapshot)
        throw new Error(`Missing initial record for final check ${sys}`);

      const finalBat = finalBatteries.find((b) => b.romId === romId);
      expect(finalBat).toBeDefined();
      expect(finalBat?.data).toEqual(expectedBattery);

      const finalSnap = finalSnapshots.find((s) => s.romId === romId && s.slot === 1);
      expect(finalSnap).toBeDefined();
      expect(finalSnap).toEqual(expectedSnapshot);
    }
  });

  for (const { system, ext, builder } of PLATFORMS) {
    test(`${system}: snapshot regression - cancel retains live state2; confirm restores live frame1; next A gives frame2 and eventual save2`, async ({
      page,
    }) => {
      await page.goto('/');
      const romBytes = builder();
      const romId = computeRomId(romBytes);

      await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
        name: `snapshot-regress.${ext}`,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(romBytes),
      });
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Helper to poll battery byte 0 for this rom
      const getBatteryByte0 = async () => {
        const bats = await readIndexedDBBatteries(page);
        const match = bats.find((b) => b.romId === romId);
        if (!match || match.data.length === 0) return null;
        return match.data[0];
      };

      // Poll until initial real battery is 1
      await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(1);

      // Sample live frame 1
      const initialPixels = await sampleCanvasPixels(page);
      expect(initialPixels.some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);

      // Save real snapshot at state 1
      await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
      await expect(page.getByAltText('即时存档 1 的游戏画面')).toBeVisible();

      // Press A ('KeyO') to increment SRAM byte 0 to 2 and change screen
      // Hold A until live canvas pixel frame changes to expected next frame, then release in finally
      await page.locator('#game-canvas').focus();
      try {
        await page.keyboard.down('KeyO');
        await expect
          .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
          .not.toBe(JSON.stringify(initialPixels));
        await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(2);
      } finally {
        await page.keyboard.up('KeyO');
      }

      const state2Pixels = await sampleCanvasPixels(page);
      expect(state2Pixels).not.toEqual(initialPixels);

      // Record manual snapshot records and full battery data before attempting restore
      const preCancelSnapshots = (await readIndexedDBSnapshots(page)).filter((s) => s.slot > 0);
      const preCancelBatteries = await readIndexedDBBatteries(page);
      const savedSecondBatteries = preCancelBatteries.find((b) => b.romId === romId);
      if (!savedSecondBatteries) throw new Error('Missing saved second battery');
      const savedSecondBatteryData = savedSecondBatteries.data;

      // Cancel restore retains live state 2 and unchanged records
      await page.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: '读取即时存档 01？', exact: true });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: '取消', exact: true }).click();
      await expect(confirmation).toBeHidden();
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Verify canvas is still in state 2
      const postCancelPixels = await sampleCanvasPixels(page);
      expect(postCancelPixels).toEqual(state2Pixels);
      expect(await getBatteryByte0()).toBe(2);

      // Verify full recorded manual snapshot records and battery bytes around cancellation are unchanged
      const postCancelSnapshots = (await readIndexedDBSnapshots(page)).filter((s) => s.slot > 0);
      const postCancelBatteries = await readIndexedDBBatteries(page);
      expect(postCancelSnapshots).toEqual(preCancelSnapshots);
      expect(postCancelBatteries.map((b) => ({ romId: b.romId, data: b.data }))).toEqual(
        preCancelBatteries.map((b) => ({ romId: b.romId, data: b.data })),
      );

      // Now confirm restore -> restores live frame 1
      await page.getByRole('button', { name: '读取即时存档 1', exact: true }).click();
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: '确认读取', exact: true }).click();
      await expect(confirmation).toBeHidden();
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Poll live canvas until it restores initial frame 1
      await expect
        .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
        .toBe(JSON.stringify(initialPixels));

      // Note: masked restore semantics: files/IDB battery may remain 2 until a later in-game save.
      // Next A press must advance live state from 1 -> 2 (and eventual save byte 2, NOT 3)
      await page.locator('#game-canvas').focus();
      try {
        await page.keyboard.down('KeyO');
        await expect
          .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
          .toBe(JSON.stringify(state2Pixels));
        await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(2);
      } finally {
        await page.keyboard.up('KeyO');
      }

      // Automatic restore verification:
      // Pause, set snapshot slot 0 with state 1 snapshot, put saved battery 2 in IndexedDB
      await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
      await page.goto('/api/live');
      await page.evaluate(async (batteryBytes) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('poke-pocket');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['snapshots', 'batteries'], 'readwrite');
            const snapStore = tx.objectStore('snapshots');
            const req = snapStore.getAll();
            req.onsuccess = () => {
              const first = req.result.find((item: { slot: number }) => item.slot === 1);
              if (!first) {
                tx.abort();
                return;
              }
              snapStore.put({ ...first, slot: 0, key: `${first.romId}:0` });
              tx.objectStore('batteries').put({
                romId: first.romId,
                data: new Uint8Array(batteryBytes).buffer,
                updatedAt: Date.now(),
              });
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error || new Error('Failed to set auto snapshot'));
          });
        } finally {
          db.close();
        }
      }, savedSecondBatteryData);

      // Return to app and launch gallery start (resumes automatic snapshot)
      await page.goto('/');
      await page.locator('.gallery-start').click();
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Poll live canvas until it restores state 1 from automatic snapshot
      await expect
        .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
        .toBe(JSON.stringify(initialPixels));

      // Press A: must increment live state from 1 -> 2 (live frame changes to state 2, SRAM byte 0 becomes 2, not 3)
      await page.locator('#game-canvas').focus();
      try {
        await page.keyboard.down('KeyO');
        await expect
          .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
          .toBe(JSON.stringify(state2Pixels));
        await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(2);
      } finally {
        await page.keyboard.up('KeyO');
      }

      expect(await sampleCanvasPixels(page)).toEqual(state2Pixels);
    });
  }

  for (const { system, ext, builder } of PLATFORMS) {
    test(`${system}: battery roundtrip - export and import 32768-byte payload, remove slot0, preserve manual snapshots`, async ({
      page,
    }, testInfo) => {
      await page.goto('/');
      const romBytes = builder();
      const romId = computeRomId(romBytes);

      await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
        name: `battery-roundtrip.${ext}`,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(romBytes),
      });
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Wait for battery to initialize to 1
      const getBatteryByte0 = async () => {
        const bats = await readIndexedDBBatteries(page);
        const match = bats.find((b) => b.romId === romId);
        if (!match || match.data.length === 0) return null;
        return match.data[0];
      };
      await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(1);

      // Save a manual snapshot at slot 1
      await page.getByRole('button', { name: '保存到位置 1', exact: true }).click();
      const preview = page.getByAltText('即时存档 1 的游戏画面');
      await expect(preview).toBeVisible();
      const thumb = await preview.getAttribute('src');
      if (!thumb) throw new Error('Missing snapshot thumbnail');

      // Create an automatic snapshot slot 0 in IndexedDB to verify its removal on import
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('poke-pocket');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('snapshots', 'readwrite');
            const store = tx.objectStore('snapshots');
            const req = store.getAll();
            req.onsuccess = () => {
              const first = req.result.find((item: { slot: number }) => item.slot === 1);
              if (first) {
                store.put({ ...first, slot: 0, key: `${first.romId}:0` });
              }
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      });

      // Sample state 1 frame
      const frame1Pixels = await sampleCanvasPixels(page);

      // Advance battery to byte 0 = 2 via A press
      await page.locator('#game-canvas').focus();
      try {
        await page.keyboard.down('KeyO');
        await expect
          .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
          .not.toBe(JSON.stringify(frame1Pixels));
        await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(2);
      } finally {
        await page.keyboard.up('KeyO');
      }

      const frame2Pixels = await sampleCanvasPixels(page);

      // Export .sav
      await page.getByRole('button', { name: '我的存档', exact: true }).click();
      const manager = page.getByRole('dialog', { name: '把这一刻，好好收起来。', exact: true });
      await expect(manager).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await manager.getByRole('button', { name: '导出存档', exact: true }).click();
      const download = await downloadPromise;
      const downloadPath = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(downloadPath);
      const exportedBytes = await readFile(downloadPath);

      // Compare exported payload against actual stored battery in IndexedDB
      const batsBeforeExport = await readIndexedDBBatteries(page);
      const storedBattery = batsBeforeExport.find((b) => b.romId === romId)?.data;
      if (!storedBattery) throw new Error('Missing stored battery in IndexedDB');
      expect(exportedBytes.length).toBe(ORIGINAL_BATTERY_SIZE);
      expect(Array.from(exportedBytes)).toEqual(storedBattery);
      expect(exportedBytes[0]).toBe(2);

      await manager.getByRole('button', { name: '关闭窗口', exact: true }).click();

      // Prepare deterministic import payload (byte 0 = 1, rest = 0)
      const importPayload = createInitialBattery();

      // Record manual snapshot identities before import
      const snapshotsBefore = await readIndexedDBSnapshots(page);
      const manualBefore = snapshotsBefore.filter((s) => s.slot > 0);
      const autoBefore = snapshotsBefore.filter((s) => s.slot === 0);
      expect(manualBefore.length).toBe(1);
      expect(autoBefore.length).toBe(1);

      // Import battery save via modal
      await page.getByLabel('导入游戏存档', { exact: true }).setInputFiles({
        name: `deterministic-test.${ext}.sav`,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(importPayload),
      });

      // Verify modal dialog and copy
      const importDialog = page.getByRole('dialog', { name: '从这份存档继续？', exact: true });
      await expect(importDialog).toBeVisible();
      await expect(importDialog).toContainText('已有的手动即时存档仍会保留');

      await importDialog.getByRole('button', { name: '导入并启动', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('存档已导入');
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Check battery in IndexedDB: every byte must match importPayload
      const batsAfter = await readIndexedDBBatteries(page);
      const matchBat = batsAfter.find((b) => b.romId === romId);
      if (!matchBat) throw new Error('Missing battery after import');
      expect(matchBat.data.length).toBe(ORIGINAL_BATTERY_SIZE);
      expect(new Uint8Array(matchBat.data)).toEqual(importPayload);

      // Check snapshots in IndexedDB: slot 0 deleted, manual snapshots preserved exactly
      const snapshotsAfter = await readIndexedDBSnapshots(page);
      expect(snapshotsAfter.filter((s) => s.slot === 0)).toHaveLength(0);
      const manualAfter = snapshotsAfter.filter((s) => s.slot > 0);
      expect(manualAfter).toEqual(manualBefore);

      // Prove rebooted LIVE frame reflects imported SRAM (returns to frame 1)
      await expect
        .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
        .toBe(JSON.stringify(frame1Pixels));

      // Re-export imported bytes BEFORE next A mutation and compare all 32768 bytes
      await page.getByRole('button', { name: '我的存档', exact: true }).click();
      await expect(manager).toBeVisible();
      const secondDownloadPromise = page.waitForEvent('download');
      await manager.getByRole('button', { name: '导出存档', exact: true }).click();
      const secondDownload = await secondDownloadPromise;
      const secondDownloadPath = testInfo.outputPath(
        `second-${secondDownload.suggestedFilename()}`,
      );
      await secondDownload.saveAs(secondDownloadPath);
      const secondExportedBytes = await readFile(secondDownloadPath);
      expect(secondExportedBytes.length).toBe(ORIGINAL_BATTERY_SIZE);
      expect(new Uint8Array(secondExportedBytes)).toEqual(importPayload);
      await manager.getByRole('button', { name: '关闭窗口', exact: true }).click();

      // Next A increments live frame to frame 2 and battery byte 0 to 2
      await page.locator('#game-canvas').focus();
      try {
        await page.keyboard.down('KeyO');
        await expect
          .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
          .toBe(JSON.stringify(frame2Pixels));
        await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(2);
      } finally {
        await page.keyboard.up('KeyO');
      }

      // Return to gallery and await visible gallery / settled command so production records automatic state2
      await page.getByRole('button', { name: '返回卡带盘', exact: true }).click();
      await expect(page.locator('#cartridge-gallery')).toBeVisible();

      // Reload/start using .gallery-start; assert actual LIVE frame2 and battery2; next A must give frame1 and battery3
      await page.reload();
      await page.locator('.gallery-start').click();
      await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

      // Assert LIVE frame reflects automatic state (frame 2) and battery byte 0 is 2
      await expect
        .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
        .toBe(JSON.stringify(frame2Pixels));
      await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(2);

      // Next A increments live frame to frame 1 and advances battery byte to 3
      await page.locator('#game-canvas').focus();
      try {
        await page.keyboard.down('KeyO');
        await expect
          .poll(async () => JSON.stringify(await sampleCanvasPixels(page)), { timeout: 15000 })
          .toBe(JSON.stringify(frame1Pixels));
        await expect.poll(getBatteryByte0, { timeout: 15000 }).toBe(3);
      } finally {
        await page.keyboard.up('KeyO');
      }

      // Manual snapshot 1 is still present and valid
      await expect(page.getByAltText('即时存档 1 的游戏画面')).toHaveAttribute('src', thumb);
    });
  }
});
