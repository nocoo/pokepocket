import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { createProductionRuntime } from '../../scripts/production-runtime.mjs';
import { AUTHORITATIVE_ROUTE_PATHS } from '../../worker/index.ts';

const EXPECTED_SHARED_HEADERS = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'private, no-store',
};

const ROUTE_CONTRACTS = {
  '/api/live': {
    public: true,
    assertPayload: (body, pkg) => {
      expect(body).toEqual({ status: 'ok', version: pkg.version });
    },
  },
  '/api/catalog': {
    public: false,
    assertPayload: (body) => {
      expect(body.mode).toBe('private');
      expect(body.systems).toEqual(['GB', 'GBC', 'GBA']);
      expect(Array.isArray(body.editions)).toBe(true);
      expect(body.editions).toHaveLength(12);
      for (const ed of body.editions) {
        expect(ed.available).toBe(false);
        expect(ed.url).toBeNull();
        expect(typeof ed.id).toBe('string');
      }
    },
  },
  '/api/cartridge': {
    public: false,
    assertPayload: (body) => {
      expect(body).toEqual({ available: false, url: null });
    },
  },
  '/api/runtime': {
    public: false,
    assertPayload: (body, pkg) => {
      expect(body).toEqual({
        name: 'Poké Pocket',
        version: pkg.version,
        platform: 'cloudflare-workers',
        emulation: 'browser-wasm',
        mode: 'private',
        systems: ['GB', 'GBC', 'GBA'],
      });
    },
  },
};

function assertSharedSecurityHeaders(response) {
  for (const [key, value] of Object.entries(EXPECTED_SHARED_HEADERS)) {
    expect(response.headers.get(key), `header ${key}`).toBe(value);
  }
}

describe('Production Worker HTTP Harness (L2)', () => {
  let runtime;
  let pkg;
  let validToken;

  beforeAll(async () => {
    pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    runtime = await createProductionRuntime();
    validToken = await runtime.signToken();
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  it('matches test coverage keys exactly to authoritative production route inventory', () => {
    const tableKeys = Object.keys(ROUTE_CONTRACTS);
    expect([...tableKeys].sort()).toEqual([...AUTHORITATIVE_ROUTE_PATHS].sort());
    // Also assert that Object.prototype properties are not route keys
    expect(AUTHORITATIVE_ROUTE_PATHS).not.toContain('toString');
    expect(AUTHORITATIVE_ROUTE_PATHS).not.toContain('constructor');
    expect(AUTHORITATIVE_ROUTE_PATHS).not.toContain('valueOf');
  });

  describe.each(Object.entries(ROUTE_CONTRACTS))(
    'Authoritative Route Contract: %s',
    (routePath, contract) => {
      if (contract.public) {
        it(`serves HTTP 200 GET unauthenticated on public route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(200);
          assertSharedSecurityHeaders(res);
          const body = await res.json();
          contract.assertPayload(body, pkg);
        });

        it(`serves HTTP 200 HEAD with empty body and identical shared headers on public route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(200);
          assertSharedSecurityHeaders(res);
          const text = await res.text();
          expect(text).toBe('');
        });

        it(`rejects unauthenticated POST with HTTP 405 on public route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(405);
          expect(res.headers.get('Allow')).toBe('GET, HEAD');
          assertSharedSecurityHeaders(res);
          const body = await res.json();
          expect(body).toEqual({ error: 'Method not allowed' });
        });
      } else {
        it(`rejects unauthenticated GET with HTTP 403 on private route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(403);
          assertSharedSecurityHeaders(res);
          const body = await res.json();
          expect(body).toEqual({ error: 'Cloudflare Access authentication required' });
        });

        it(`serves HTTP 200 GET with valid authentication on private route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            headers: { 'Cf-Access-Jwt-Assertion': validToken },
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(200);
          assertSharedSecurityHeaders(res);
          const body = await res.json();
          contract.assertPayload(body, pkg);
        });

        it(`serves HTTP 200 HEAD with empty body under valid auth on private route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            method: 'HEAD',
            headers: { 'Cf-Access-Jwt-Assertion': validToken },
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(200);
          assertSharedSecurityHeaders(res);
          const text = await res.text();
          expect(text).toBe('');
        });

        it(`rejects unauthenticated HEAD with HTTP 403 and empty body on private route ${routePath}`, async () => {
          const res = await fetch(`${runtime.url}${routePath}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
          });
          expect(res.status).toBe(403);
          assertSharedSecurityHeaders(res);
          const text = await res.text();
          expect(text).toBe('');
        });
      }
    },
  );

  describe('Method precedence and HTTP status handling', () => {
    it('unauthenticated private POST -> 403 (auth check precedes method check on protected routes)', async () => {
      const res = await fetch(`${runtime.url}/api/runtime`, {
        method: 'POST',
        headers: {},
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
      const body = await res.json();
      expect(body).toEqual({ error: 'Cloudflare Access authentication required' });
    });

    it('authenticated private POST -> 405 with Allow: GET, HEAD', async () => {
      const res = await fetch(`${runtime.url}/api/runtime`, {
        method: 'POST',
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
      assertSharedSecurityHeaders(res);
      const body = await res.json();
      expect(body).toEqual({ error: 'Method not allowed' });
    });

    it('authenticated private DELETE -> 405 with Allow: GET, HEAD', async () => {
      const res = await fetch(`${runtime.url}/api/catalog`, {
        method: 'DELETE',
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
      assertSharedSecurityHeaders(res);
    });

    it('unauthenticated HEAD to protected route -> 403 with empty body', async () => {
      const res = await fetch(`${runtime.url}/api/runtime`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
      const text = await res.text();
      expect(text).toBe('');
    });
  });

  describe('JWT token validation cases (freshly signed without defaults)', () => {
    it('rejects token with wrong signature (signed with different RSA private key)', async () => {
      const alienKeyPair = await generateKeyPair('RS256', { extractable: true });
      const alienToken = await runtime.signToken({}, { key: alienKeyPair.privateKey });
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': alienToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects token with wrong issuer', async () => {
      const badIssuerToken = await runtime.signToken(
        {
          iss: 'https://impostor.cloudflareaccess.com',
          sub: 'test-user',
          aud: runtime.wranglerConfig.vars.ACCESS_AUD,
          exp: Math.floor(Date.now() / 1000) + 300,
          iat: Math.floor(Date.now() / 1000),
        },
        { rawPayload: true },
      );
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': badIssuerToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects token with wrong audience', async () => {
      const badAudToken = await runtime.signToken(
        {
          iss: 'https://nocoo.cloudflareaccess.com',
          sub: 'test-user',
          aud: 'alien-audience-uuid',
          exp: Math.floor(Date.now() / 1000) + 300,
          iat: Math.floor(Date.now() / 1000),
        },
        { rawPayload: true },
      );
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': badAudToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects expired token', async () => {
      const past = Math.floor(Date.now() / 1000) - 100;
      const expiredToken = await runtime.signToken(
        {
          iss: 'https://nocoo.cloudflareaccess.com',
          sub: 'test-user',
          aud: runtime.wranglerConfig.vars.ACCESS_AUD,
          iat: past - 300,
          exp: past,
        },
        { rawPayload: true },
      );
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': expiredToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects token missing sub claim', async () => {
      const missingSubToken = await runtime.signToken(
        {
          iss: 'https://nocoo.cloudflareaccess.com',
          aud: runtime.wranglerConfig.vars.ACCESS_AUD,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
        },
        { rawPayload: true },
      );
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': missingSubToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects token missing exp claim', async () => {
      const missingExpToken = await runtime.signToken(
        {
          iss: 'https://nocoo.cloudflareaccess.com',
          sub: 'test-user',
          aud: runtime.wranglerConfig.vars.ACCESS_AUD,
          iat: Math.floor(Date.now() / 1000),
        },
        { rawPayload: true },
      );
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': missingExpToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects token missing iat claim', async () => {
      const missingIatToken = await runtime.signToken(
        {
          iss: 'https://nocoo.cloudflareaccess.com',
          sub: 'test-user',
          aud: runtime.wranglerConfig.vars.ACCESS_AUD,
          exp: Math.floor(Date.now() / 1000) + 300,
        },
        { rawPayload: true },
      );
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': missingIatToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects symmetric/HMAC HS256 algorithm token', async () => {
      const hmacKey = new TextEncoder().encode('not-a-valid-shared-hmac-secret-key-32b');
      const hmacToken = await new SignJWT({
        iss: 'https://nocoo.cloudflareaccess.com',
        sub: 'test-user',
        aud: runtime.wranglerConfig.vars.ACCESS_AUD,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(hmacKey);

      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': hmacToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects unsigned alg:none token', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: 'https://nocoo.cloudflareaccess.com',
          sub: 'test-user',
          aud: runtime.wranglerConfig.vars.ACCESS_AUD,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
      ).toString('base64url');
      const noneToken = `${header}.${payload}.`;

      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': noneToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });

    it('rejects invalid garbage string token', async () => {
      const res = await fetch(`${runtime.url}/api/runtime`, {
        headers: { 'Cf-Access-Jwt-Assertion': 'this-is-not-a-jwt' },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(403);
      assertSharedSecurityHeaders(res);
    });
  });

  describe('Unknown API, prototype property, and ROM paths 404', () => {
    it('returns HTTP 404 on unknown /api path', async () => {
      const res = await fetch(`${runtime.url}/api/nonexistent-endpoint`, {
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(404);
      assertSharedSecurityHeaders(res);
      const body = await res.json();
      expect(body).toEqual({ error: 'Not found' });
    });

    it('rejects prototype properties as route paths with HTTP 404', async () => {
      const protoPaths = ['/api/constructor', '/api/toString', '/api/valueOf', '/api/__proto__'];
      for (const protoPath of protoPaths) {
        const res = await fetch(`${runtime.url}${protoPath}`, {
          headers: { 'Cf-Access-Jwt-Assertion': validToken },
          signal: AbortSignal.timeout(5000),
        });
        expect(res.status, `Path ${protoPath}`).toBe(404);
        assertSharedSecurityHeaders(res);
        const body = await res.json();
        expect(body).toEqual({ error: 'Not found' });
      }
    });

    it('returns HTTP 404 on forbidden ROM path and extensions', async () => {
      const romPaths = ['/roms/pokeemerald.gba', '/rom/game.gb', '/roms/crystal.gbc', '/game.GBC'];
      for (const romPath of romPaths) {
        const res = await fetch(`${runtime.url}${romPath}`, {
          headers: { 'Cf-Access-Jwt-Assertion': validToken },
          signal: AbortSignal.timeout(5000),
        });
        expect(res.status, `Path ${romPath}`).toBe(404);
        assertSharedSecurityHeaders(res);
        const body = await res.json();
        expect(body).toEqual({ error: 'Not found' });
      }
    });
  });

  describe('JWKS egress audit', () => {
    it('proves the runtime requested the expected JWKS certificates URL and no unrelated egress URLs', () => {
      expect(runtime.getJwksRequestsCount()).toBeGreaterThanOrEqual(1);
      expect(runtime.getOutboundUrls()).toEqual([
        'https://nocoo.cloudflareaccess.com/cdn-cgi/access/certs',
      ]);
    });
  });

  describe('Real HTML, client JavaScript, and WASM asset reads', () => {
    it('unauthenticated request to root or static assets (JS/WASM) returns 403', async () => {
      // Find client JS asset from dist/client/index.html
      const indexHtml = await readFile(path.join(process.cwd(), 'dist/client/index.html'), 'utf8');
      const match = indexHtml.match(/src="(\/assets\/index-[^"]+\.js)"/);
      expect(match).not.toBeNull();
      const jsAssetPath = match[1];
      const wasmPath = '/emulator/2.5.1/mgba.wasm';

      const unauthenticatedPaths = ['/', jsAssetPath, wasmPath];
      for (const assetPath of unauthenticatedPaths) {
        const res = await fetch(`${runtime.url}${assetPath}`, {
          signal: AbortSignal.timeout(5000),
        });
        expect(res.status, `Static asset path without auth: ${assetPath}`).toBe(403);
        assertSharedSecurityHeaders(res);
      }
    });

    it('authenticated GET / serves exact dist/client/index.html bytes', async () => {
      const expectedHtml = await readFile(
        path.join(process.cwd(), 'dist/client/index.html'),
        'utf8',
      );
      const res = await fetch(`${runtime.url}/`, {
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      assertSharedSecurityHeaders(res);
      const text = await res.text();
      expect(text).toBe(expectedHtml);
    });

    it('authenticated GET to client JS bundle serves exact file bytes', async () => {
      // Find client JS asset from dist/client/assets
      const indexHtml = await readFile(path.join(process.cwd(), 'dist/client/index.html'), 'utf8');
      const match = indexHtml.match(/src="(\/assets\/index-[^"]+\.js)"/);
      expect(match).not.toBeNull();
      const jsAssetPath = match[1];
      const localFilePath = path.join(process.cwd(), 'dist/client', jsAssetPath);
      const expectedBytes = await readFile(localFilePath);

      const res = await fetch(`${runtime.url}${jsAssetPath}`, {
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      assertSharedSecurityHeaders(res);
      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.equals(expectedBytes)).toBe(true);
    });

    it('authenticated GET to WASM asset serves exact mGBA WASM binary bytes', async () => {
      const wasmPath = '/emulator/2.5.1/mgba.wasm';
      const localWasmPath = path.join(process.cwd(), 'dist/client', wasmPath);
      const expectedWasmBytes = await readFile(localWasmPath);

      const res = await fetch(`${runtime.url}${wasmPath}`, {
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      assertSharedSecurityHeaders(res);
      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.equals(expectedWasmBytes)).toBe(true);
    });

    it('HEAD to static asset serves empty body with shared security headers', async () => {
      const res = await fetch(`${runtime.url}/emulator/2.5.1/mgba.wasm`, {
        method: 'HEAD',
        headers: { 'Cf-Access-Jwt-Assertion': validToken },
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      assertSharedSecurityHeaders(res);
      const text = await res.text();
      expect(text).toBe('');
    });
  });

  describe('Dev bypass prevention in production build', () => {
    it('rejects localhost host header / dev query attempts failing closed', async () => {
      const attempts = [
        { url: `${runtime.url}/?mode=development`, headers: {} },
        { url: `${runtime.url}/api/runtime?mode=local`, headers: {} },
        {
          url: `${runtime.url}/api/runtime`,
          headers: {
            'X-Forwarded-Host': 'localhost',
            'X-Development-Bypass': 'true',
            'Cf-Access-Authenticated-User-Email': 'developer@example.test',
          },
        },
      ];

      for (const attempt of attempts) {
        const res = await fetch(attempt.url, {
          headers: attempt.headers,
          signal: AbortSignal.timeout(5000),
        });
        expect(res.status, `Attempt ${attempt.url}`).toBe(403);
        assertSharedSecurityHeaders(res);
        const body = await res.json();
        expect(body).toEqual({ error: 'Cloudflare Access authentication required' });
      }
    });
  });
});
