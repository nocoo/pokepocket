import net from 'node:net';
import { expect, test } from '@playwright/test';
import {
  createProductionRuntime,
  type ProductionRuntime,
} from '../../scripts/production-runtime.mjs';

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate ephemeral port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

let runtime: ProductionRuntime | undefined;
let accessToken = '';

test.beforeAll(async () => {
  const port = await allocatePort();
  runtime = await createProductionRuntime({ port });
  accessToken = await runtime.signToken();
});

test.afterAll(async () => {
  await runtime?.dispose();
});

test('renders cartridge gallery and switches generation filter and edition dock', async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': accessToken },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const badResponses: string[] = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(runtime?.url ?? '', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: /今天，想去哪里冒险/ })).toBeVisible();
    await expect(page.getByText('12 CARTRIDGES')).toBeVisible();
    await expect(page.getByText('0 枚卡带就绪')).toBeVisible();
    await expect(page.getByText('本地存储已就绪')).toBeVisible();

    await page.getByRole('button', { name: '三代' }).click();
    await page.getByRole('button', { name: '选择宝可梦 绿宝石' }).click();
    await expect(page.getByText('Pokémon Emerald Version', { exact: true })).toBeVisible();

    expect(errors).toEqual([]);
    expect(badResponses).toEqual([]);
  } finally {
    await context.close();
  }
});

test('opens help and settings modals from navigation without console errors', async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': accessToken },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const badResponses: string[] = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto(runtime?.url ?? '', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: '游玩指南' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: '打开设置' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    expect(errors).toEqual([]);
    expect(badResponses).toEqual([]);
  } finally {
    await context.close();
  }
});
