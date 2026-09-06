import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createProductionRuntime } from '../../scripts/production-runtime.mjs';

describe('Production Worker HTTP Harness (L2)', () => {
  let runtime;
  let pkg;

  beforeAll(async () => {
    pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    runtime = await createProductionRuntime();
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  it('proves missing authentication token returns HTTP 403 on /api/runtime', async () => {
    const res = await fetch(`${runtime.url}/api/runtime`, {
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Cloudflare Access authentication required' });
  });

  it('proves cryptographically valid RS256 token returns HTTP 200, private mode, and exact package version on /api/runtime with exact JWKS fetch', async () => {
    const jwksBefore = runtime.getJwksRequestsCount();
    expect(jwksBefore).toBe(0);

    const token = await runtime.signToken();

    const res = await fetch(`${runtime.url}/api/runtime`, {
      headers: {
        'Cf-Access-Jwt-Assertion': token,
      },
      signal: AbortSignal.timeout(5000),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('private');
    expect(body.version).toBe(pkg.version);
    expect(body.platform).toBe('cloudflare-workers');
    expect(body.emulation).toBe('browser-wasm');

    const jwksAfter = runtime.getJwksRequestsCount();
    expect(jwksAfter).toBe(1);
    expect(runtime.getOutboundUrls()).toEqual([
      'https://nocoo.cloudflareaccess.com/cdn-cgi/access/certs',
    ]);
  });
});
