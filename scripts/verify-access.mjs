import { pathToFileURL } from 'node:url';

const origin = 'https://pokepocket.hexly.ai';
const paths = [
  '/',
  '/api/live',
  '/api/catalog',
  '/art/rayquaza.png',
  '/emulator/2.5.1/mgba.wasm',
  '/roms/pokeemerald.gba',
];
const attempts = 12;

export async function verifyAccessPath(path) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${origin}${path}`, {
        headers: { Accept: 'text/html' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      const location = response.headers.get('Location');
      const login = location ? new URL(location, origin) : null;
      const protectedPath =
        [302, 303, 307].includes(response.status) &&
        login?.origin === 'https://nocoo.cloudflareaccess.com' &&
        login.pathname.startsWith('/cdn-cgi/access/login/');
      const details = [`${path}: ${response.status}`, `attempt ${attempt}/${attempts}`];
      if (protectedPath) details.push('→ Access sign-in');
      else {
        if (login) details.push(`redirect=${login.origin}${login.pathname}`);
        for (const header of ['content-type', 'server', 'cf-ray', 'cf-mitigated']) {
          const value = response.headers.get(header);
          if (value) details.push(`${header}=${value}`);
        }
      }
      if (
        !protectedPath &&
        response.status === 403 &&
        response.headers.get('content-type')?.includes('application/json')
      ) {
        const body = await response.json().catch(() => null);
        if (body?.error === 'Cloudflare Access authentication required')
          details.push('Worker received no valid Access JWT; check hostname coverage');
      } else await response.body?.cancel();
      console.log(details.join(' · '));
      if (protectedPath) return;
    } catch (error) {
      console.error(`${path}: attempt ${attempt}/${attempts} · ${error.message}`);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(
    `Cloudflare Access sign-in is not ready for ${origin}${path}. Check the Access application's hostname and Allow policy using the HTTP status and CF-Ray above.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await Promise.allSettled(paths.map(verifyAccessPath));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(result.reason.message);
      process.exitCode = 1;
    }
  }
}
