import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

export const DEFAULT_ORIGIN = 'https://pokepocket.hexly.ai';
export const ACCESS_PATHS = [
  '/',
  '/api/catalog',
  '/art/rayquaza.png',
  '/emulator/2.5.1/mgba.wasm',
  '/roms/pokeemerald.gba',
];
export const DEFAULT_ATTEMPTS = 12;

export async function verifyAccessPath(path, options = {}) {
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? 5000;
  const fetchFn = options.fetchFn ?? fetch;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchFn(`${origin}${path}`, {
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
      if (!options.silent) {
        console.log(details.join(' · '));
      }
      if (protectedPath) return { success: true, path, attempt };
    } catch (error) {
      if (!options.silent) {
        console.error(`${path}: attempt ${attempt}/${attempts} · ${error.message}`);
      }
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Cloudflare Access sign-in is not ready for ${origin}${path}. Check the Access application's hostname and Allow policy using the HTTP status and CF-Ray above.`,
  );
}

export async function verifyReleaseVersion(version, options = {}) {
  const origin = options.origin ?? DEFAULT_ORIGIN;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? 5000;
  const fetchFn = options.fetchFn ?? fetch;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchFn(`${origin}/api/live`, {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      let data = null;
      if (response.headers.get('content-type')?.includes('application/json'))
        data = await response.json();
      else await response.body?.cancel();
      if (response.status === 200 && data?.status === 'ok' && data.version === version) {
        if (!options.silent) {
          console.log(`/api/live: 200 → v${version}`);
        }
        return { success: true, version, attempt };
      }
      if (!options.silent) {
        console.log(
          `/api/live: ${response.status} · attempt ${attempt}/${attempts} · waiting for v${version}`,
        );
      }
    } catch (error) {
      if (!options.silent) {
        console.error(`/api/live: attempt ${attempt}/${attempts} · ${error.message}`);
      }
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Production did not report v${version} from ${origin}/api/live`);
}

export async function runAccessVerification(options = {}) {
  const paths = options.paths ?? ACCESS_PATHS;
  const checks = paths.map((p) => verifyAccessPath(p, options));
  if (options.isRelease) {
    const version =
      options.version ??
      JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
    checks.push(verifyReleaseVersion(version, options));
  }
  const results = await Promise.allSettled(checks);
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length) {
    for (const fail of failures) {
      if (!options.silent) console.error(fail.reason.message);
    }
    return { success: false, failures: failures.map((f) => f.reason.message) };
  }
  return { success: true, count: results.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const isRelease = process.argv.includes('--release');
  const result = await runAccessVerification({ isRelease });
  if (!result.success) {
    process.exitCode = 1;
  }
}
