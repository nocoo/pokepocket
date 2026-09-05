import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import worker from '../../worker/index';
import { APP_VERSION } from '../../src/lib/version';

const issuer = 'https://nocoo.cloudflareaccess.com';
const audience = '7dcaf6fb44b1245dfec144db9df69cc1335a526cd9a29829f33e35f78aa306dd';
let privateKey: CryptoKey;
const jwksFetch = vi.fn<typeof fetch>();

beforeAll(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  privateKey = keys.privateKey;
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'test-access-key',
    alg: 'RS256',
    use: 'sig',
  };
  jwksFetch.mockImplementation(async (input) => {
    expect(String(input)).toBe(`${issuer}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  });
  vi.stubGlobal('fetch', jwksFetch);
});
afterAll(() => vi.unstubAllGlobals());

function environment() {
  const assetFetch = vi
    .fn<Fetcher['fetch']>()
    .mockImplementation(async () => new Response('private asset'));
  const env: Env = {
    ACCESS_TEAM: 'nocoo',
    ACCESS_AUD: audience,
    ASSETS: {
      fetch: assetFetch,
      connect() {
        throw new Error('Unexpected connection');
      },
    },
  };
  return { env, assetFetch };
}

async function token(claims: JWTPayload = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'test-owner',
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-access-key' })
    .sign(key);
}

function request(path: string, jwt?: string, method = 'GET') {
  return new Request(`https://pokepocket.hexly.ai${path}`, {
    method,
    headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {},
  });
}

describe('Cloudflare Access protects the whole Worker', () => {
  it.each([
    '/',
    '/api/catalog',
    '/api/runtime',
    '/api/live/',
    '/api/live/catalog',
    '/art/rayquaza.png',
    '/emulator/2.5.1/mgba.wasm',
    '/roms/pokeemerald.gba',
  ])('denies unauthenticated %s before reading assets', async (path) => {
    const { env, assetFetch } = environment();
    const response = await worker.fetch(request(path), env);
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong audience', { aud: 'another-application' }],
    ['wrong issuer', { iss: 'https://other.cloudflareaccess.com' }],
    ['expired', { exp: 1 }],
    ['not yet valid', { nbf: Math.floor(Date.now() / 1000) + 600 }],
    ['no expiration', { exp: undefined }],
    ['no issued-at', { iat: undefined }],
    ['no subject', { sub: undefined }],
  ] satisfies [string, JWTPayload][])('rejects %s tokens', async (_name, claims) => {
    const { env, assetFetch } = environment();
    expect((await worker.fetch(request('/', await token(claims)), env)).status).toBe(403);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('rejects a forged signature, unsigned claims, and an HMAC token', async () => {
    const { env, assetFetch } = environment();
    const forgedKey = (await generateKeyPair('RS256')).privateKey;
    const forged = await token({}, forgedKey);
    const unsigned = `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify({ aud: audience }))}.`;
    const hmac = await new SignJWT({ aud: audience })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('this-is-only-a-synthetic-test-key'));
    for (const jwt of [forged, unsigned, hmac, 'malformed'])
      expect((await worker.fetch(request('/', jwt), env)).status).toBe(403);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('cannot enable development with a local hostname, query parameter or forged identity header', async () => {
    const { env, assetFetch } = environment();
    for (const host of ['localhost:7047', 'pokepocket.dev.hexly.ai', 'pokepocket.hexly.ai']) {
      const response = await worker.fetch(
        new Request(`https://${host}/?mode=development`, {
          headers: {
            'Cf-Access-Authenticated-User-Email': 'owner@example.test',
            'X-Forwarded-Host': 'localhost',
          },
        }),
        env,
      );
      expect(response.status).toBe(403);
    }
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('fails closed when the key service is unavailable', async () => {
    vi.resetModules();
    const isolated = (await import('../../worker/index')).default;
    jwksFetch.mockRejectedValueOnce(new Error('Synthetic network outage'));
    const { env, assetFetch } = environment();
    expect((await isolated.fetch(request('/', await token()), env)).status).toBe(403);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it.each(['/', '/art/rayquaza.png', '/emulator/2.5.1/mgba.wasm'])(
    'serves %s only with a verified token and isolation headers',
    async (path) => {
      const { env, assetFetch } = environment();
      const response = await worker.fetch(request(path, await token()), env);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('private asset');
      expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
      expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(assetFetch).toHaveBeenCalledOnce();
    },
  );
});

describe('release metadata', () => {
  it('exposes only status and the package version from the public liveness endpoint', async () => {
    const { env, assetFetch } = environment();
    const response = await worker.fetch(request('/api/live'), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', version: APP_VERSION });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(assetFetch).not.toHaveBeenCalled();
    const head = await worker.fetch(request('/api/live', undefined, 'HEAD'), env);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await worker.fetch(request('/api/live', undefined, 'POST'), env)).status).toBe(405);
  });

  it('reports the same version in the authenticated runtime API', async () => {
    const { env } = environment();
    const response = await worker.fetch(request('/api/runtime', await token()), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: APP_VERSION, mode: 'private' });
  });
});

describe('production never supplies cartridge ROMs', () => {
  it('offers all twelve editions for browser import without probing assets', async () => {
    const { env, assetFetch } = environment();
    const jwt = await token();
    const response = await worker.fetch(request('/api/catalog', jwt), env);
    const data = (await response.json()) as {
      mode: string;
      editions: { available: boolean; url: string | null }[];
    };
    expect(data.mode).toBe('private');
    expect(data.editions).toHaveLength(12);
    expect(data.editions.every((edition) => !edition.available && edition.url === null)).toBe(true);
    expect(await (await worker.fetch(request('/api/cartridge', jwt), env)).json()).toEqual({
      available: false,
      url: null,
    });
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('returns explicit errors for ROMs, unknown APIs and unsupported methods', async () => {
    const { env, assetFetch } = environment();
    const jwt = await token();
    for (const path of ['/roms/pokeemerald.gba', '/rom/private.bin', '/game.GBC', '/api/missing'])
      expect((await worker.fetch(request(path, jwt), env)).status).toBe(404);
    const denied = await worker.fetch(request('/api/catalog', jwt, 'POST'), env);
    expect(denied.status).toBe(405);
    expect(denied.headers.get('Allow')).toBe('GET, HEAD');
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('keeps HEAD responses empty and authenticated', async () => {
    const { env } = environment();
    const response = await worker.fetch(request('/api/catalog', await token(), 'HEAD'), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    const denied = await worker.fetch(request('/', undefined, 'HEAD'), env);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe('');
  });
});
