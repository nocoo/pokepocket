import { test, expect } from '../fixtures/browser-harness';
import { type ContrastMeasurement, measureTextContrast } from '../fixtures/contrast';

test('navigation items satisfy WCAG contrast in default, hover, focus and across all 12 editions', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.local-status.ready').waitFor();
  expect(await page.locator('.nav-item').count()).toBe(3);

  const navLabels = ['卡带收藏', '我的存档', '游玩指南'] as const;
  const states = ['default', 'hover', 'focus'] as const;

  const editionButtons = page.getByRole('button', { name: /^选择宝可梦 / });
  const editionLabels = await editionButtons.evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('aria-label'))
      .filter((label): label is string => typeof label === 'string' && label.length > 0),
  );
  expect(editionLabels).toHaveLength(12);
  expect(new Set(editionLabels).size).toBe(12);

  const measurements: Array<
    {
      editionLabel: string;
      label: string;
      state: string;
    } & ContrastMeasurement
  > = [];

  for (const editionLabel of editionLabels) {
    const editionButton = page.getByRole('button', { name: editionLabel, exact: true });
    await expect(editionButton).toBeVisible();
    await expect(editionButton).toBeEnabled();
    await editionButton.click();

    // Verify actual selected state on the tray slot button
    await expect(editionButton).toHaveClass(/is-selected/);
    await expect(
      page.locator('.cartridge-carousel .carousel-cartridge.is-selected'),
    ).toHaveAttribute('aria-label', editionLabel);

    await page.locator('.pocket-app').evaluate(async (el) => {
      getComputedStyle(el).backgroundColor;
      await Promise.all(el.getAnimations().map((animation) => animation.finished));
    });

    for (const label of navLabels) {
      const button = page.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();

      const labelSpan = button.locator('span', { hasText: label });
      await expect(labelSpan).toBeVisible();

      for (const state of states) {
        await button.evaluate((el) => (el as HTMLElement).blur());
        await page.mouse.move(0, 0);

        if (state === 'hover') {
          await button.hover();
        }
        if (state === 'focus') {
          await button.focus();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Shift+Tab');
          const isFocusVisible = await button.evaluate((el) => el.matches(':focus-visible'));
          expect(isFocusVisible).toBe(true);
        }

        await button.evaluate(async (el) => {
          getComputedStyle(el).color;
          await Promise.all(el.getAnimations().map((animation) => animation.finished));
        });

        const measured = await measureTextContrast(labelSpan);
        expect(
          measured.contrast,
          `Expected navigation item "${label}" under edition "${editionLabel}" in state "${state}" to meet contrast threshold ${measured.threshold}, got ${measured.contrast.toFixed(4)}:1`,
        ).toBeGreaterThanOrEqual(measured.threshold);

        measurements.push({
          editionLabel,
          label,
          state,
          ...measured,
        });
      }
    }
  }

  expect(measurements).toHaveLength(108);
  // Attach full measurements as formatted JSON for independent reviewer inspection
  test.info().attachments.push({
    name: 'navigation-contrast-measurements.json',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(measurements, null, 2), 'utf8'),
  });
});
