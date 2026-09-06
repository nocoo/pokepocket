import { test, expect } from '../fixtures/browser-harness';
import {
  createExecutableGbCartridge,
  createExecutableGbcCartridge,
  createExecutableGbaCartridge,
} from '../fixtures/executable';
import { measurePixelTextContrast, type PixelContrastMeasurement } from '../fixtures/contrast';

interface GeometrySnapshot {
  viewport: { x: number; y: number; width: number; height: number };
  consoleWrap: { x: number; y: number; width: number; height: number };
  consoleShell: { x: number; y: number; width: number; height: number };
  actionA: { x: number; y: number; width: number; height: number };
  pauseTextRange: { x: number; y: number; width: number; height: number };
  centerOffset: { dx: number; dy: number };
  transform: string;
  isWindowFull: boolean;
  hasHorizontalOverflow: boolean;
}

const platforms = [
  { system: 'GB', ext: 'gb', builder: createExecutableGbCartridge },
  { system: 'GBC', ext: 'gbc', builder: createExecutableGbcCartridge },
  { system: 'GBA', ext: 'gba', builder: createExecutableGbaCartridge },
] as const;

for (const { system, ext, builder } of platforms) {
  test(`${system}: layout geometry scales proportionally and centers across window sizes, native fullscreen, and fallback focus mode`, async ({
    page,
  }, testInfo) => {
    // 1. Initial desktop viewport (1440x1000) within standard desktop breakpoint
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');

    const bytes = builder();
    await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
      name: `layout-test.${ext}`,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(bytes),
    });

    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await expect(page.locator('.paused-screen')).toBeVisible();

    const measureGeometry = async (): Promise<GeometrySnapshot> => {
      return page.evaluate(() => {
        const getBox = (selector: string) => {
          const el = document.querySelector(selector);
          if (!el) throw new Error(`Element not found: ${selector}`);
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };

        const rangeBox = () => {
          const strong = document.querySelector('.paused-screen strong');
          if (!strong) throw new Error('.paused-screen strong not found');
          const range = document.createRange();
          range.selectNodeContents(strong);
          const b = range.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };

        const viewportBox = getBox('.console-viewport');
        const shellBox = getBox('.console-wrap .console-shell');
        const wrapBox = getBox('.console-wrap');
        const actionABox = getBox('.console-wrap .action-a');
        const pausedRangeBox = rangeBox();

        const dx = wrapBox.x + wrapBox.width / 2 - (viewportBox.x + viewportBox.width / 2);
        const dy = wrapBox.y + wrapBox.height / 2 - (viewportBox.y + viewportBox.height / 2);

        const stage = document.querySelector('#game-stage');
        if (!stage) throw new Error('#game-stage element not found');
        const stageBounds = stage.getBoundingClientRect();
        const isWindowFull =
          Math.abs(stageBounds.width - window.innerWidth) <= 1 &&
          Math.abs(stageBounds.height - window.innerHeight) <= 1;

        return {
          viewport: viewportBox,
          consoleWrap: wrapBox,
          consoleShell: shellBox,
          actionA: actionABox,
          pauseTextRange: pausedRangeBox,
          centerOffset: { dx, dy },
          transform: getComputedStyle(document.querySelector('.console-wrap') as Element).transform,
          isWindowFull,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
    };

    // Helper for relative tolerance check: |actual / baseline - 1| <= 0.02 (2% relative tolerance)
    const checkRelativeTolerance = (actual: number, expected: number, label: string) => {
      const relDiff = Math.abs(actual / expected - 1);
      expect(
        relDiff,
        `Expected ${label} relative diff to be within 2%, got ${(relDiff * 100).toFixed(3)}% (actual: ${actual}, expected: ${expected})`,
      ).toBeLessThanOrEqual(0.02);
    };

    // Baseline geometry at 1440x1000
    const baseline = await measureGeometry();
    expect(baseline.hasHorizontalOverflow).toBe(false);
    expect(baseline.consoleWrap.width).toBeLessThanOrEqual(baseline.viewport.width);
    expect(baseline.consoleWrap.height).toBeLessThanOrEqual(baseline.viewport.height);
    // Centered horizontally within 1px
    expect(Math.abs(baseline.centerOffset.dx)).toBeLessThanOrEqual(1);

    const buttonToShellBaseline = baseline.actionA.width / baseline.consoleShell.width;
    const textToShellBaseline = baseline.pauseTextRange.width / baseline.consoleShell.width;

    // 2. Resized window within the same responsive breakpoint (1360x900) - verify proportional scaling
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect
      .poll(async () => (await measureGeometry()).viewport.width)
      .not.toBe(baseline.viewport.width);
    const resized = await measureGeometry();
    expect(resized.hasHorizontalOverflow).toBe(false);
    expect(resized.consoleWrap.width).toBeLessThanOrEqual(resized.viewport.width);
    expect(resized.consoleWrap.height).toBeLessThanOrEqual(resized.viewport.height);
    expect(Math.abs(resized.centerOffset.dx)).toBeLessThanOrEqual(1);

    const buttonToShellResized = resized.actionA.width / resized.consoleShell.width;
    const textToShellResized = resized.pauseTextRange.width / resized.consoleShell.width;
    checkRelativeTolerance(
      buttonToShellResized,
      buttonToShellBaseline,
      'button/shell ratio on resize',
    );
    checkRelativeTolerance(textToShellResized, textToShellBaseline, 'text/shell ratio on resize');

    // Reset viewport size to 1440x1000 before fullscreen tests
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect
      .poll(async () => (await measureGeometry()).viewport.width)
      .toBe(baseline.viewport.width);

    // 3. Genuine native fullscreen via 'F' keypress
    await page.keyboard.press('KeyF');
    await page.waitForFunction(
      () =>
        document.fullscreenElement === document.querySelector('#game-stage') &&
        !document.querySelector('.focus-mode'),
    );

    // Poll until ResizeObserver settles shell dimensions larger than baseline and within viewport
    await expect
      .poll(async () => {
        const g = await measureGeometry();
        return (
          g.consoleShell.width > baseline.consoleShell.width &&
          g.consoleShell.height > baseline.consoleShell.height &&
          g.consoleWrap.width <= g.viewport.width + 1 &&
          g.consoleWrap.height <= g.viewport.height + 1
        );
      })
      .toBe(true);

    // In native fullscreen: stage fills window, caption intentionally hidden
    const nativeFs = await measureGeometry();
    expect(nativeFs.isWindowFull).toBe(true);
    expect(nativeFs.hasHorizontalOverflow).toBe(false);
    expect(await page.locator('.console-caption').isVisible()).toBe(false);
    // Device is centered inside the fullscreen console-viewport
    expect(Math.abs(nativeFs.centerOffset.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(nativeFs.centerOffset.dy)).toBeLessThanOrEqual(2);
    // Device fits within viewport without clipping
    expect(nativeFs.consoleWrap.width).toBeLessThanOrEqual(nativeFs.viewport.width + 1);
    expect(nativeFs.consoleWrap.height).toBeLessThanOrEqual(nativeFs.viewport.height + 1);

    // Assert shell dimensions actually increase from the 1440x1000 baseline
    expect(nativeFs.consoleShell.width).toBeGreaterThan(baseline.consoleShell.width);
    expect(nativeFs.consoleShell.height).toBeGreaterThan(baseline.consoleShell.height);

    // Growth factor of shell vs text and button must match within 2% relative tolerance
    const shellGrowthNative = nativeFs.consoleShell.width / baseline.consoleShell.width;
    const buttonGrowthNative = nativeFs.actionA.width / baseline.actionA.width;
    const textGrowthNative = nativeFs.pauseTextRange.width / baseline.pauseTextRange.width;
    checkRelativeTolerance(
      buttonGrowthNative,
      shellGrowthNative,
      'button growth in native fullscreen',
    );
    checkRelativeTolerance(textGrowthNative, shellGrowthNative, 'text growth in native fullscreen');

    const buttonToShellNative = nativeFs.actionA.width / nativeFs.consoleShell.width;
    const textToShellNative = nativeFs.pauseTextRange.width / nativeFs.consoleShell.width;
    checkRelativeTolerance(
      buttonToShellNative,
      buttonToShellBaseline,
      'button/shell ratio in native fullscreen',
    );
    checkRelativeTolerance(
      textToShellNative,
      textToShellBaseline,
      'text/shell ratio in native fullscreen',
    );

    // Linux Chromium refuses Browser.setWindowBounds while the OS window is fullscreen.
    // Resize the rendered viewport directly, preserving genuine native fullscreen and
    // allowing ResizeObserver to react to actual viewport geometry changes.
    const nativeResizeSession = await page.context().newCDPSession(page);
    const deviceScaleFactor = await page.evaluate(() => window.devicePixelRatio);
    const resizeNativeViewport = async (width: number, height: number) => {
      await nativeResizeSession.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        screenWidth: width,
        screenHeight: height,
        deviceScaleFactor,
        mobile: false,
      });
      await expect
        .poll(() => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
        .toEqual({ width, height });
    };

    let nativeFsResized: GeometrySnapshot;
    let buttonToShellNativeResized: number;
    let textToShellNativeResized: number;
    try {
      await resizeNativeViewport(1280, 800);

      // Poll until ResizeObserver settles reduced shell dimensions and proper fit within the resized viewport
      await expect
        .poll(async () => {
          const g = await measureGeometry();
          return (
            g.viewport.width !== nativeFs.viewport.width &&
            g.consoleShell.width < nativeFs.consoleShell.width &&
            g.consoleShell.height < nativeFs.consoleShell.height &&
            g.consoleWrap.width <= g.viewport.width + 1 &&
            g.consoleWrap.height <= g.viewport.height + 1
          );
        })
        .toBe(true);

      // Assert document.fullscreenElement remains #game-stage after resize
      expect(
        await page.evaluate(
          () => document.fullscreenElement === document.querySelector('#game-stage'),
        ),
      ).toBe(true);

      nativeFsResized = await measureGeometry();
      expect(nativeFsResized.isWindowFull).toBe(true);
      expect(nativeFsResized.hasHorizontalOverflow).toBe(false);
      expect(Math.abs(nativeFsResized.centerOffset.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(nativeFsResized.centerOffset.dy)).toBeLessThanOrEqual(2);
      expect(nativeFsResized.consoleWrap.width).toBeLessThanOrEqual(
        nativeFsResized.viewport.width + 1,
      );
      expect(nativeFsResized.consoleWrap.height).toBeLessThanOrEqual(
        nativeFsResized.viewport.height + 1,
      );

      // Shell dimensions must reduce and scale must change
      expect(nativeFsResized.consoleShell.width).toBeLessThan(nativeFs.consoleShell.width);
      expect(nativeFsResized.consoleShell.height).toBeLessThan(nativeFs.consoleShell.height);
      expect(nativeFsResized.transform).not.toBe(nativeFs.transform);

      buttonToShellNativeResized =
        nativeFsResized.actionA.width / nativeFsResized.consoleShell.width;
      textToShellNativeResized =
        nativeFsResized.pauseTextRange.width / nativeFsResized.consoleShell.width;
      checkRelativeTolerance(
        buttonToShellNativeResized,
        buttonToShellBaseline,
        'button/shell ratio in native fullscreen after resize',
      );
      checkRelativeTolerance(
        textToShellNativeResized,
        textToShellBaseline,
        'text/shell ratio in native fullscreen after resize',
      );

      // Restore viewport size before exiting native fullscreen
      await resizeNativeViewport(1440, 1000);
      await expect
        .poll(async () => (await measureGeometry()).viewport.width)
        .toBe(nativeFs.viewport.width);

      // Exit native fullscreen via 'F'
      await page.keyboard.press('KeyF');
      await page.waitForFunction(
        () => !document.fullscreenElement && !document.querySelector('.focus-mode'),
      );
    } finally {
      await nativeResizeSession.detach();
    }

    // 4. Fallback fullscreen (focus mode) via deliberately rejected requestFullscreen
    await page.evaluate(() => {
      const stage = document.querySelector('#game-stage');
      if (!stage) throw new Error('#game-stage not found');
      Object.defineProperty(stage, 'requestFullscreen', {
        configurable: true,
        value: () => Promise.reject(new Error('Deliberate fallback probe rejection')),
      });
    });

    await page.keyboard.press('KeyF');
    // Must activate focus-mode fallback without native fullscreenElement
    await page.waitForFunction(
      () => !document.fullscreenElement && Boolean(document.querySelector('.focus-mode')),
    );

    // Poll until ResizeObserver settles shell dimensions larger than baseline and within viewport
    await expect
      .poll(async () => {
        const g = await measureGeometry();
        return (
          g.consoleShell.width > baseline.consoleShell.width &&
          g.consoleShell.height > baseline.consoleShell.height &&
          g.consoleWrap.width <= g.viewport.width + 1 &&
          g.consoleWrap.height <= g.viewport.height + 1
        );
      })
      .toBe(true);

    const fallbackFs = await measureGeometry();
    expect(fallbackFs.isWindowFull).toBe(true);
    expect(fallbackFs.hasHorizontalOverflow).toBe(false);
    expect(await page.locator('.console-caption').isVisible()).toBe(false);
    expect(Math.abs(fallbackFs.centerOffset.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(fallbackFs.centerOffset.dy)).toBeLessThanOrEqual(2);
    expect(fallbackFs.consoleWrap.width).toBeLessThanOrEqual(fallbackFs.viewport.width + 1);
    expect(fallbackFs.consoleWrap.height).toBeLessThanOrEqual(fallbackFs.viewport.height + 1);

    // Assert shell dimensions actually increase from the 1440x1000 baseline
    expect(fallbackFs.consoleShell.width).toBeGreaterThan(baseline.consoleShell.width);
    expect(fallbackFs.consoleShell.height).toBeGreaterThan(baseline.consoleShell.height);

    // Growth factor of shell vs text and button must match within 2% relative tolerance
    const shellGrowthFallback = fallbackFs.consoleShell.width / baseline.consoleShell.width;
    const buttonGrowthFallback = fallbackFs.actionA.width / baseline.actionA.width;
    const textGrowthFallback = fallbackFs.pauseTextRange.width / baseline.pauseTextRange.width;
    checkRelativeTolerance(
      buttonGrowthFallback,
      shellGrowthFallback,
      'button growth in fallback focus mode',
    );
    checkRelativeTolerance(
      textGrowthFallback,
      shellGrowthFallback,
      'text growth in fallback focus mode',
    );

    const buttonToShellFallback = fallbackFs.actionA.width / fallbackFs.consoleShell.width;
    const textToShellFallback = fallbackFs.pauseTextRange.width / fallbackFs.consoleShell.width;
    checkRelativeTolerance(
      buttonToShellFallback,
      buttonToShellBaseline,
      'button/shell ratio in fallback focus mode',
    );
    checkRelativeTolerance(
      textToShellFallback,
      textToShellBaseline,
      'text/shell ratio in fallback focus mode',
    );

    // Actually resize viewport while fallback focus mode is active
    await page.setViewportSize({ width: 1280, height: 800 });

    // Poll until ResizeObserver settles reduced shell dimensions and proper fit within the resized viewport
    await expect
      .poll(async () => {
        const g = await measureGeometry();
        return (
          g.viewport.width !== fallbackFs.viewport.width &&
          g.consoleShell.width < fallbackFs.consoleShell.width &&
          g.consoleShell.height < fallbackFs.consoleShell.height &&
          g.consoleWrap.width <= g.viewport.width + 1 &&
          g.consoleWrap.height <= g.viewport.height + 1
        );
      })
      .toBe(true);

    const fallbackFsResized = await measureGeometry();
    expect(fallbackFsResized.isWindowFull).toBe(true);
    expect(fallbackFsResized.hasHorizontalOverflow).toBe(false);
    expect(Math.abs(fallbackFsResized.centerOffset.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(fallbackFsResized.centerOffset.dy)).toBeLessThanOrEqual(2);
    expect(fallbackFsResized.consoleWrap.width).toBeLessThanOrEqual(
      fallbackFsResized.viewport.width + 1,
    );
    expect(fallbackFsResized.consoleWrap.height).toBeLessThanOrEqual(
      fallbackFsResized.viewport.height + 1,
    );

    // Shell dimensions must reduce and scale must change
    expect(fallbackFsResized.consoleShell.width).toBeLessThan(fallbackFs.consoleShell.width);
    expect(fallbackFsResized.consoleShell.height).toBeLessThan(fallbackFs.consoleShell.height);
    expect(fallbackFsResized.transform).not.toBe(fallbackFs.transform);

    const buttonToShellFallbackResized =
      fallbackFsResized.actionA.width / fallbackFsResized.consoleShell.width;
    const textToShellFallbackResized =
      fallbackFsResized.pauseTextRange.width / fallbackFsResized.consoleShell.width;
    checkRelativeTolerance(
      buttonToShellFallbackResized,
      buttonToShellBaseline,
      'button/shell ratio in fallback focus mode after resize',
    );
    checkRelativeTolerance(
      textToShellFallbackResized,
      textToShellBaseline,
      'text/shell ratio in fallback focus mode after resize',
    );

    // Restore viewport size
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect
      .poll(async () => (await measureGeometry()).viewport.width)
      .toBe(fallbackFs.viewport.width);

    // Exit fallback focus mode via 'F'
    await page.keyboard.press('KeyF');
    await page.waitForFunction(
      () => !document.fullscreenElement && !document.querySelector('.focus-mode'),
    );

    // Attach measured geometry record as JSON for independent inspection
    testInfo.attachments.push({
      name: `layout-${system.toLowerCase()}-geometry.json`,
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            system,
            baseline,
            resized,
            nativeFs,
            nativeFsResized,
            fallbackFs,
            fallbackFsResized,
            ratios: {
              buttonToShell: {
                baseline: buttonToShellBaseline,
                resized: buttonToShellResized,
                native: buttonToShellNative,
                nativeResized: buttonToShellNativeResized,
                fallback: buttonToShellFallback,
                fallbackResized: buttonToShellFallbackResized,
              },
              textToShell: {
                baseline: textToShellBaseline,
                resized: textToShellResized,
                native: textToShellNative,
                nativeResized: textToShellNativeResized,
                fallback: textToShellFallback,
                fallbackResized: textToShellFallbackResized,
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      ),
    });
  });
}

test('button text contrast meets WCAG for enabled states and maintains legibility for disabled controls', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  // 1. Load executable GB cartridge and start adventure so stage is active and visible
  await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
    name: 'contrast-gb.gb',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(createExecutableGbCartridge()),
  });
  await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

  // Helper to wait for animation/transition completion on an element
  const waitForTransitions = async (locator: ReturnType<typeof page.locator>) => {
    await locator.evaluate(async (el) => {
      getComputedStyle(el).color;
      getComputedStyle(el).backgroundColor;
      await Promise.all(el.getAnimations().map((animation) => animation.finished));
    });
  };

  const playToggle = page.locator('.play-toggle');
  await expect(playToggle).toBeVisible();
  await expect(playToggle).toBeEnabled();
  const playToggleLabel = playToggle.locator('span', { hasText: '暂停' });
  await expect(playToggleLabel).toBeVisible();

  const measurements: Array<{ item: string; state: string } & PixelContrastMeasurement> = [];

  // A. Enabled Pause button in default, hover, focus-visible states
  // Note: .game-stage has a radial gradient ancestor, so toolbar labels use measurePixelTextContrast
  for (const state of ['default', 'hover', 'focus'] as const) {
    await playToggle.scrollIntoViewIfNeeded();
    await playToggle.evaluate((el) => (el as HTMLElement).blur());
    await page.mouse.move(0, 0);

    if (state === 'hover') {
      await playToggle.hover();
      expect(await playToggle.evaluate((el) => el.matches(':hover'))).toBe(true);
    }
    if (state === 'focus') {
      await playToggle.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const isFocusVisible = await playToggle.evaluate((el) => el.matches(':focus-visible'));
      expect(isFocusVisible).toBe(true);
    }

    await waitForTransitions(playToggle);

    expect(await playToggle.isEnabled()).toBe(true);
    expect(await playToggleLabel.isVisible()).toBe(true);

    const measured = await measurePixelTextContrast(page, playToggleLabel);
    expect(
      measured.contrast,
      `Expected .play-toggle in ${state} state to satisfy contrast threshold ${measured.threshold}, got ${measured.contrast.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(measured.threshold);

    measurements.push({
      item: 'play-toggle-pause',
      state,
      ...measured,
    });
  }

  // B. Pause the game: test "Continue" toolbar button and paused-screen overlay button
  await playToggle.click();
  await expect(page.locator('.paused-screen')).toBeVisible();

  const continueToolbarLabel = playToggle.locator('span', { hasText: '继续' });
  await expect(playToggle).toBeVisible();
  await expect(playToggle).toBeEnabled();
  await expect(continueToolbarLabel).toBeVisible();

  for (const state of ['default', 'hover', 'focus'] as const) {
    await playToggle.scrollIntoViewIfNeeded();
    await playToggle.evaluate((el) => (el as HTMLElement).blur());
    await page.mouse.move(0, 0);

    if (state === 'hover') {
      await playToggle.hover();
      expect(await playToggle.evaluate((el) => el.matches(':hover'))).toBe(true);
    }
    if (state === 'focus') {
      await playToggle.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const isFocusVisible = await playToggle.evaluate((el) => el.matches(':focus-visible'));
      expect(isFocusVisible).toBe(true);
    }

    await waitForTransitions(playToggle);

    expect(await playToggle.isEnabled()).toBe(true);
    expect(await continueToolbarLabel.isVisible()).toBe(true);

    const measured = await measurePixelTextContrast(page, continueToolbarLabel);
    expect(
      measured.contrast,
      `Expected .play-toggle (continue) in ${state} state to satisfy contrast threshold ${measured.threshold}, got ${measured.contrast.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(measured.threshold);

    measurements.push({
      item: 'play-toggle-continue',
      state,
      ...measured,
    });
  }

  // C. Paused screen overlay button: the overlay itself is the Continue button users click.
  // Test its title ("冒险，稍作休息。") and subtitle ("点击继续游戏") in default, hover, and verified :focus-visible.
  const pausedButton = page.locator('.paused-screen');
  await expect(pausedButton).toBeVisible();
  await expect(pausedButton).toBeEnabled();

  const pausedTitle = pausedButton.locator('strong');
  const pausedSubtitle = pausedButton.locator('> span:last-child');
  await expect(pausedTitle).toBeVisible();
  await expect(pausedSubtitle).toBeVisible();

  for (const state of ['default', 'hover', 'focus'] as const) {
    await pausedButton.scrollIntoViewIfNeeded();
    await pausedButton.evaluate((el) => (el as HTMLElement).blur());
    await page.mouse.move(0, 0);

    if (state === 'hover') {
      await pausedButton.hover();
      expect(await pausedButton.evaluate((el) => el.matches(':hover'))).toBe(true);
    }
    if (state === 'focus') {
      await pausedButton.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const isFocusVisible = await pausedButton.evaluate((el) => el.matches(':focus-visible'));
      expect(isFocusVisible).toBe(true);
    }

    // Wait for the parent paused button transitions to complete
    await waitForTransitions(pausedButton);

    expect(await pausedButton.isEnabled()).toBe(true);
    expect(await pausedTitle.isVisible()).toBe(true);
    expect(await pausedSubtitle.isVisible()).toBe(true);

    const measuredTitle = await measurePixelTextContrast(page, pausedTitle);
    expect(measuredTitle.contrast).toBeGreaterThanOrEqual(measuredTitle.threshold);
    measurements.push({
      item: 'paused-screen-title',
      state,
      ...measuredTitle,
    });

    const measuredSubtitle = await measurePixelTextContrast(page, pausedSubtitle);
    expect(measuredSubtitle.contrast).toBeGreaterThanOrEqual(measuredSubtitle.threshold);
    measurements.push({
      item: 'paused-screen-subtitle',
      state,
      ...measuredSubtitle,
    });
  }

  // D. Genuinely visible disabled physical control after pause:
  // In the paused state, the physical action buttons (e.g. action-a) are disabled because status !== 'running'.
  // Verify action A button is visible, disabled, has default cursor, and nonzero opacity.
  const actionA = page.locator('.console-wrap .action-a');
  await actionA.scrollIntoViewIfNeeded();
  await expect(actionA).toBeVisible();
  await expect(actionA).toBeDisabled();

  const disabledLegibility = await actionA.evaluate((el) => {
    const s = getComputedStyle(el);
    const parentOpacity = Number(getComputedStyle(el.parentElement as Element).opacity);
    return {
      text: el.textContent?.trim(),
      color: s.color,
      backgroundColor: s.backgroundColor,
      opacity: Number(s.opacity),
      parentOpacity,
      cursor: s.cursor,
      display: s.display,
      visibility: s.visibility,
    };
  });

  expect(disabledLegibility.text).toBe('A');
  expect(disabledLegibility.cursor).toBe('default');
  expect(disabledLegibility.visibility).toBe('visible');
  expect(disabledLegibility.display).not.toBe('none');
  expect(disabledLegibility.opacity).toBeGreaterThan(0);
  expect(disabledLegibility.parentOpacity).toBeGreaterThan(0);

  // Measure effective pixel contrast across disabled button as legibility evidence (not subject to enabled WCAG)
  const disabledContrast = await measurePixelTextContrast(page, actionA);
  expect(Number.isFinite(disabledContrast.contrast)).toBe(true);
  expect(disabledContrast.contrast).toBeGreaterThan(1);

  // Attach all contrast measurements and disabled legibility data as JSON
  testInfo.attachments.push({
    name: 'button-contrast-measurements.json',
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify(
        {
          measurements,
          disabledControlLegibility: {
            selector: '.console-wrap .action-a',
            ...disabledLegibility,
            measuredPixelContrast: disabledContrast.contrast,
            foreground: disabledContrast.foreground,
            background: disabledContrast.background,
          },
        },
        null,
        2,
      ),
      'utf8',
    ),
  });
});

test('mobile screen layouts and modal dialogs remain fully usable without clipping or horizontal overflow', async ({
  browser,
  baseURL,
  extraHTTPHeaders,
}, testInfo) => {
  // Mobile device context (iPhone 14 / modern standard 390x844 viewport)
  const mobileWidth = 390;
  const mobileHeight = 844;
  const context = await browser.newContext({
    baseURL,
    viewport: { width: mobileWidth, height: mobileHeight },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders,
  });

  const dialogMeasurements: Array<{
    name: string;
    x: number;
    y: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    windowWidth: number;
    windowHeight: number;
  }> = [];

  try {
    const page = await context.newPage();
    await page.goto('/');

    // 1. Initial mobile page has no horizontal overflow
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // 2. Open Settings modal on mobile and verify complete 4-boundary coordinates
    await page.getByRole('button', { name: '打开设置' }).click();
    const settingsDialog = page.getByRole('dialog');
    await expect(settingsDialog).toBeVisible();

    const checkModalBounds = async (
      dialogLocator: ReturnType<typeof page.locator>,
      name: string,
    ) => {
      const bounds = await dialogLocator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
        };
      });

      expect(bounds.x, `${name} dialog left bound`).toBeGreaterThanOrEqual(-1);
      expect(bounds.y, `${name} dialog top bound`).toBeGreaterThanOrEqual(-1);
      expect(bounds.right, `${name} dialog right bound`).toBeLessThanOrEqual(
        bounds.windowWidth + 1,
      );
      expect(bounds.bottom, `${name} dialog bottom bound`).toBeLessThanOrEqual(
        bounds.windowHeight + 1,
      );
      expect(bounds.width, `${name} dialog width`).toBeLessThanOrEqual(bounds.windowWidth);
      expect(bounds.height, `${name} dialog height`).toBeLessThanOrEqual(bounds.windowHeight);

      dialogMeasurements.push({ name, ...bounds });
    };

    await checkModalBounds(settingsDialog, 'Settings');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await expect(settingsDialog).toHaveCount(0);

    // 3. Load GB cartridge and verify mobile controls and play stage
    await page.getByLabel('载入 GB / GBC / GBA 卡带', { exact: true }).setInputFiles({
      name: 'mobile-layout.gb',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(createExecutableGbCartridge()),
    });
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();

    // In mobile layout, mobile-controls are visible and within screen bounds
    const mobileControls = page.locator('.mobile-controls');
    await expect(mobileControls).toBeVisible();
    const mobileBox = await mobileControls.boundingBox();
    if (!mobileBox) throw new Error('Mobile controls box not found');
    expect(mobileBox.x).toBeGreaterThanOrEqual(-1);
    expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(mobileWidth + 1);

    // Check no horizontal overflow during gameplay
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // 4. Open Restart modal while game is paused
    await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
    await page.getByRole('button', { name: '重新启动游戏' }).click();
    const restartDialog = page.getByRole('dialog');
    await expect(restartDialog).toBeVisible();
    await checkModalBounds(restartDialog, 'Restart');
    await restartDialog.getByRole('button', { name: '再玩一会儿' }).click();
    await expect(restartDialog).toHaveCount(0);

    // Attach measured mobile and modal dialog bounds as JSON
    testInfo.attachments.push({
      name: 'mobile-modal-bounds.json',
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify(
          {
            viewport: { width: mobileWidth, height: mobileHeight },
            mobileControlsBox: mobileBox,
            dialogMeasurements,
          },
          null,
          2,
        ),
        'utf8',
      ),
    });
  } finally {
    await context.close();
  }
});
