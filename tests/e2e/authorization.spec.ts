import { test, expect, sampleCanvasPixels } from '../fixtures/browser-harness';
// @ts-expect-error production-runtime is a maintained mjs script without ambient declarations
import { EXPECTED_CERTS_URL } from '../../scripts/production-runtime.mjs';
import { createExecutableGbCartridge } from '../fixtures/executable';

/**
 * Asserts that the sampled 8x1 canvas pixels reflect original GB's alternating light/dark pattern.
 * The committed executable GB cartridge program paints alternating bit planes (%10101010) in initial state,
 * resulting in 8 alternating light and dark pixels across row 0.
 */
function isAlternatingLightDarkPattern(pixels: number[]): boolean {
  if (!Array.isArray(pixels) || pixels.length < 32) return false;
  // Verify opaque alpha for all 8 pixels
  for (let i = 0; i < 8; i++) {
    if (pixels[i * 4 + 3] !== 255) return false;
  }
  // Verify alternating light and dark RGB luminance across consecutive pixels
  for (let i = 0; i < 7; i++) {
    const curR = pixels[i * 4] ?? 0;
    const curG = pixels[i * 4 + 1] ?? 0;
    const curB = pixels[i * 4 + 2] ?? 0;
    const nextR = pixels[(i + 1) * 4] ?? 0;
    const nextG = pixels[(i + 1) * 4 + 1] ?? 0;
    const nextB = pixels[(i + 1) * 4 + 2] ?? 0;

    const curLum = (curR + curG + curB) / 3;
    const nextLum = (nextR + nextG + nextB) / 3;
    const curIsLight = curLum > 180;
    const curIsDark = curLum < 75;
    const nextIsLight = nextLum > 180;
    const nextIsDark = nextLum < 75;
    if (!((curIsLight && nextIsDark) || (curIsDark && nextIsLight))) {
      return false;
    }
  }
  return true;
}

test.describe('Production Worker authorization and browser application loading', () => {
  test('rejects unauthenticated requests to private HTML, assets and API endpoints while allowing public /api/live', async ({
    playwright,
    browser,
    baseURL,
    page,
  }) => {
    // 1. Obtain authentic emitted client JS path from authorized production HTML
    const authorizedRootRes = await page.goto('/');
    expect(authorizedRootRes?.status()).toBe(200);
    const htmlContent = await page.content();
    const clientScriptMatch = htmlContent.match(/src="(\/assets\/[^"]+\.js)"/);
    if (!clientScriptMatch?.[1]) {
      throw new Error('Could not discover authentic emitted client script from authorized HTML');
    }
    const authenticClientJsPath = clientScriptMatch[1];

    // 2. Create an explicit fresh request context with NO extraHTTPHeaders (clean anonymous context)
    const anonymousRequest = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {},
    });

    try {
      // Intentional public liveness endpoint: GET and HEAD 200, unsupported method 405
      const liveGet = await anonymousRequest.get('/api/live');
      expect(liveGet.status()).toBe(200);
      const liveJson = await liveGet.json();
      expect(liveJson.status).toBe('ok');
      expect(typeof liveJson.version).toBe('string');

      const liveHead = await anonymousRequest.head('/api/live');
      expect(liveHead.status()).toBe(200);

      const livePost = await anonymousRequest.post('/api/live', { data: {} });
      expect(livePost.status()).toBe(405);
      expect(livePost.headers().allow).toBe('GET, HEAD');

      // Private endpoints without Cf-Access token return 403 Forbidden
      const rootRes = await anonymousRequest.get('/');
      expect(rootRes.status()).toBe(403);
      const rootText = await rootRes.text();
      expect(rootText).toContain('Cloudflare Access authentication required');

      const catalogRes = await anonymousRequest.get('/api/catalog');
      expect(catalogRes.status()).toBe(403);

      const cartridgeRes = await anonymousRequest.get('/api/cartridge');
      expect(cartridgeRes.status()).toBe(403);

      const runtimeRes = await anonymousRequest.get('/api/runtime');
      expect(runtimeRes.status()).toBe(403);

      const wasmRes = await anonymousRequest.get('/emulator/2.5.1/mgba.wasm');
      expect(wasmRes.status()).toBe(403);

      const artRes = await anonymousRequest.get('/art/rayquaza.png');
      expect(artRes.status()).toBe(403);
    } finally {
      await anonymousRequest.dispose();
    }

    // 3. Anonymous real browser page: verify actual browser navigation denial and denied real client JS/WASM paths
    const anonymousContext = await browser.newContext({
      baseURL,
      extraHTTPHeaders: {},
    });
    try {
      const anonPage = await anonymousContext.newPage();
      const anonNav = await anonPage.goto('/');
      expect(anonNav?.status()).toBe(403);
      await expect(anonPage.locator('body')).toContainText(
        'Cloudflare Access authentication required',
      );
      await expect(anonPage.locator('.page-heading h1')).toHaveCount(0);

      // Verify direct anonymous navigation to actual built client script asset is denied 403
      const clientAssetRes = await anonPage.goto(authenticClientJsPath);
      expect(clientAssetRes?.status()).toBe(403);

      // Verify direct anonymous navigation to WASM binary is denied 403
      const wasmAssetRes = await anonPage.goto('/emulator/2.5.1/mgba.wasm');
      expect(wasmAssetRes?.status()).toBe(403);
    } finally {
      await anonymousContext.close();
    }
  });

  test('valid locally signed token loads protected app, client, WASM emulator, and restricts egress to JWKS certs', async ({
    page,
    productionWorker,
  }) => {
    // Explicitly await observed client JS and WASM responses during authorized page load and execution
    const clientJsPromise = page.waitForResponse(
      (response) =>
        response.status() === 200 &&
        response.request().resourceType() === 'script' &&
        response.url().includes('/assets/'),
    );
    const wasmResponsePromise = page.waitForResponse(
      (response) =>
        response.status() === 200 && response.url().includes('/emulator/2.5.1/mgba.wasm'),
    );

    // Navigate to protected root with authorizedContext (headers injected via browser-harness)
    const rootNav = await page.goto('/');
    expect(rootNav?.status()).toBe(200);

    const clientJsResponse = await clientJsPromise;
    expect(clientJsResponse.status()).toBe(200);

    // Verify application heading in src/App.tsx
    await expect(page.locator('.page-heading h1')).toContainText('把冒险，装进口袋');

    // Verify runtime info endpoint under authorization returns authentic schema
    const runtimeRes = await page.request.get('/api/runtime');
    expect(runtimeRes.status()).toBe(200);
    const runtimeJson = await runtimeRes.json();
    expect(runtimeJson.name).toBe('Poké Pocket');
    expect(runtimeJson.mode).toBe('private');
    expect(runtimeJson.platform).toBe('cloudflare-workers');
    expect(runtimeJson.emulation).toBe('browser-wasm');
    expect(runtimeJson.systems).toEqual(['GB', 'GBC', 'GBA']);

    // Verify catalog endpoint under authorization returns private mode
    const catalogRes = await page.request.get('/api/catalog');
    expect(catalogRes.status()).toBe(200);
    const catalogJson = await catalogRes.json();
    expect(catalogJson.mode).toBe('private');
    expect(catalogJson.systems).toEqual(['GB', 'GBC', 'GBA']);

    // Load an executable original cartridge to trigger emulator execution and assert live rendering
    await page.getByRole('button', { name: '选择宝可梦 红', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入卡带', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'auth-test-cartridge.gb',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(createExecutableGbCartridge()),
    });

    const wasmResponse = await wasmResponsePromise;
    expect(wasmResponse.status()).toBe(200);
    const wasmHeaders = wasmResponse.headers();
    expect(wasmHeaders['cross-origin-embedder-policy']).toBe('require-corp');
    expect(wasmHeaders['cross-origin-opener-policy']).toBe('same-origin');

    // Assert actual emulator execution and live rendering
    await expect(page.getByText('正在冒险', { exact: true })).toBeVisible();
    await expect(page.locator('#game-canvas')).toHaveAttribute('data-system', 'GB');
    await expect
      .poll(async () => parseInt((await page.getByTestId('fps').textContent()) ?? '0', 10))
      .toBeGreaterThan(20);

    // Sample pixels and poll until original GB alternating light/dark pattern appears across 8 pixels
    await expect
      .poll(async () => isAlternatingLightDarkPattern(await sampleCanvasPixels(page, 8, 1)), {
        timeout: 15000,
      })
      .toBe(true);

    const initialPatternPixels = await sampleCanvasPixels(page, 8, 1);
    expect(initialPatternPixels.length).toBe(32);
    expect(isAlternatingLightDarkPattern(initialPatternPixels)).toBe(true);

    // Assert live original executable program behavior:
    // Press A ('KeyO') to trigger the compiled assembly program to change its tile pattern / screen
    await page.locator('#game-canvas').focus();
    try {
      await page.keyboard.down('KeyO');
      await expect
        .poll(async () => JSON.stringify(await sampleCanvasPixels(page, 8, 1)), { timeout: 15000 })
        .not.toBe(JSON.stringify(initialPatternPixels));
    } finally {
      await page.keyboard.up('KeyO');
    }

    const mutatedPixels = await sampleCanvasPixels(page, 8, 1);
    expect(mutatedPixels).not.toEqual(initialPatternPixels);
    // After pressing A, SRAM increments to 2 (even), paint renders pattern with d = 0x00 (uniform screen, not alternating)
    expect(isAlternatingLightDarkPattern(mutatedPixels)).toBe(false);

    // Unconditional egress assertions: verify only expected JWKS certs URL was accessed
    const outboundUrls = productionWorker.runtime.getOutboundUrls();
    expect(outboundUrls.length).toBeGreaterThan(0);
    for (const url of outboundUrls) {
      expect(url).toBe(EXPECTED_CERTS_URL);
    }
    expect(productionWorker.runtime.getJwksRequestsCount()).toBeGreaterThan(0);
  });
});
