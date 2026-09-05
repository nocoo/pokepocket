import { createRemoteJWKSet, jwtVerify } from 'jose';
import { EDITIONS } from '../src/lib/catalog';
import { APP_VERSION } from '../src/lib/version';

declare const __LOCAL_DEVELOPMENT__: boolean;

// Only public signing keys are cached; requests, tokens and identities are never retained.
const issuer = 'https://nocoo.cloudflareaccess.com';
const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

function json(data: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

async function authorized(request: Request, env: Env) {
  if (env.ACCESS_TEAM !== 'nocoo' || !env.ACCESS_AUD) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    await jwtVerify(token, keys, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    return true;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Vite replaces this at build time. Hosts, request headers and query strings cannot enable it.
    // An undefined build constant also fails closed if the source is run without Vite.
    const localDevelopment = typeof __LOCAL_DEVELOPMENT__ !== 'undefined' && __LOCAL_DEVELOPMENT__;
    const url = new URL(request.url);
    const live = url.pathname === '/api/live';
    let response: Response;
    // The public liveness endpoint exposes only build metadata, never application data.
    if (!live && !localDevelopment && !(await authorized(request, env))) {
      response = json({ error: 'Cloudflare Access authentication required' }, 403);
    } else {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response = json({ error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
      } else if (live) {
        response = json({ status: 'ok', version: APP_VERSION });
      } else if (url.pathname === '/api/catalog') {
        response = json({
          mode: localDevelopment ? 'local' : 'private',
          editions: EDITIONS.map(({ id }) => ({ id, available: false, url: null })),
          systems: ['GB', 'GBC', 'GBA'],
        });
      } else if (url.pathname === '/api/cartridge') {
        response = json({ available: false, url: null });
      } else if (url.pathname === '/api/runtime') {
        response = json({
          name: 'Poké Pocket',
          version: APP_VERSION,
          platform: 'cloudflare-workers',
          emulation: 'browser-wasm',
          mode: localDevelopment ? 'local' : 'private',
          systems: ['GB', 'GBC', 'GBA'],
        });
      } else if (
        /^\/(api|roms?)(?:\/|$)/i.test(url.pathname) ||
        /\.(gb|gbc|gba)$/i.test(url.pathname)
      ) {
        response = json({ error: 'Not found' }, 404);
      } else {
        response = await env.ASSETS.fetch(request);
      }
    }
    // Cover Worker responses and every static asset, including WASM and image requests.
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    headers.set('Cache-Control', 'private, no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
