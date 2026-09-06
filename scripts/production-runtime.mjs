import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const require = createRequire(import.meta.url);
const { Miniflare, Response: WorkerResponse } = require('miniflare');

export const DEFAULT_L2_PORT = 17048;
export const DEFAULT_L2_HOST = '127.0.0.1';
export const EXPECTED_CERTS_URL = 'https://nocoo.cloudflareaccess.com/cdn-cgi/access/certs';
export const RUNTIME_RESOURCE_ROOT_ENV = 'POKEPOCKET_RUNTIME_RESOURCE_ROOT';

export async function checkPortAvailable(port, host = DEFAULT_L2_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      resolve({ available: false, error: err });
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({ available: true });
      });
    });
    server.listen(port, host);
  });
}

export async function createProductionRuntime(options = {}) {
  const root = options.root ?? process.cwd();
  const buildDir = options.buildDir ?? path.join(root, 'dist/pokepocket');
  const host = options.host ?? DEFAULT_L2_HOST;
  const port = options.port ?? DEFAULT_L2_PORT;
  const miniflareCtor = options.Miniflare ?? Miniflare;
  const workerResponseCtor = options.WorkerResponse ?? WorkerResponse;
  const rmFn = options.rmFn ?? rm;

  const portCheck = await checkPortAvailable(port, host);
  if (!portCheck.available) {
    const code = portCheck.error?.code || 'EADDRINUSE';
    throw new Error(
      `Port ${port} on ${host} is already in use (${code}). Refusing to reuse or kill existing listener.`,
    );
  }

  const wranglerConfig = JSON.parse(await readFile(path.join(buildDir, 'wrangler.json'), 'utf8'));
  const workerScript = await readFile(path.join(buildDir, 'index.js'), 'utf8');

  if (!wranglerConfig.vars?.ACCESS_TEAM) {
    throw new Error('Production config missing required ACCESS_TEAM');
  }
  if (!wranglerConfig.vars?.ACCESS_AUD) {
    throw new Error('Production config missing required ACCESS_AUD');
  }
  if (!wranglerConfig.assets?.directory) {
    throw new Error('Production config missing required assets.directory');
  }

  const keyPair = await generateKeyPair('RS256', { extractable: true });
  const keyId = 'l2-fixture-key';
  const jwk = {
    ...(await exportJWK(keyPair.publicKey)),
    kid: keyId,
    alg: 'RS256',
    use: 'sig',
  };

  const resourceRoot =
    options.resourceRoot ??
    (process.env[RUNTIME_RESOURCE_ROOT_ENV]
      ? path.resolve(process.env[RUNTIME_RESOURCE_ROOT_ENV])
      : tmpdir());

  const isolatedPersistenceDir = await mkdtemp(path.join(resourceRoot, 'pokepocket-l2-runtime-'));

  let mf;
  let disposalPromise = null;

  const performCleanup = async () => {
    let disposeError = null;
    if (mf) {
      try {
        await mf.dispose();
      } catch (err) {
        disposeError = err;
      }
    }
    try {
      await rmFn(isolatedPersistenceDir, { recursive: true, force: true });
    } catch (rmErr) {
      if (!disposeError) disposeError = rmErr;
    }
    if (disposeError) {
      throw disposeError;
    }
  };

  const dispose = () => {
    if (!disposalPromise) {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
      disposalPromise = performCleanup();
    }
    return disposalPromise;
  };

  const handleSignal = () => {
    dispose().catch(() => {});
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  let jwksRequestsCount = 0;
  const outboundUrls = [];

  try {
    mf = new miniflareCtor({
      host,
      port,
      cf: false,
      logRequests: false,
      telemetry: { enabled: false },
      isolatedResourcePersistencePath: isolatedPersistenceDir,
      resourceTmpPath: path.join(isolatedPersistenceDir, 'tmp'),
      workers: [
        {
          config: {
            type: 'worker',
            name: 'pokepocket-production-l2',
            compatibilityDate: wranglerConfig.compatibility_date,
            compatibilityFlags: wranglerConfig.compatibility_flags,
            manifest: {
              mainModule: 'index.js',
              modulesRoot: buildDir,
              modules: {
                'index.js': { type: 'esm', contents: workerScript },
              },
            },
            env: {
              ACCESS_TEAM: { type: 'text', value: wranglerConfig.vars.ACCESS_TEAM },
              ACCESS_AUD: { type: 'text', value: wranglerConfig.vars.ACCESS_AUD },
              ASSETS: { type: 'assets' },
            },
            assets: {
              directory: path.resolve(buildDir, wranglerConfig.assets.directory),
              notFoundHandling: wranglerConfig.assets.not_found_handling,
              runWorkerFirst: wranglerConfig.assets.run_worker_first,
              hasUserWorker: true,
            },
          },
          dev: {
            rootPath: isolatedPersistenceDir,
            unsafeRegisterWorker: false,
            outboundService: {
              type: 'fetcher',
              handler(request) {
                outboundUrls.push(request.url);
                if (request.url !== EXPECTED_CERTS_URL) {
                  throw new Error(`Unexpected egress rejected: ${request.url}`);
                }
                jwksRequestsCount++;
                return workerResponseCtor.json({ keys: [jwk] });
              },
            },
          },
        },
      ],
    });

    const readyUrl = await mf.ready;
    const baseUrl = readyUrl instanceof URL ? readyUrl.origin : String(readyUrl);

    const signToken = async (claims = {}, options = {}) => {
      const jwt = new SignJWT(options.rawPayload ? claims : { sub: 'test-user', ...claims });
      jwt.setProtectedHeader({
        alg: options.alg ?? 'RS256',
        kid: options.kid ?? keyId,
      });
      if (!options.rawPayload) {
        if (!('iat' in claims)) {
          jwt.setIssuedAt();
        }
        if (!('exp' in claims)) {
          jwt.setExpirationTime('5m');
        }
        if (!('iss' in claims)) {
          jwt.setIssuer('https://nocoo.cloudflareaccess.com');
        }
        if (!('aud' in claims)) {
          jwt.setAudience(wranglerConfig.vars.ACCESS_AUD);
        }
      }
      return jwt.sign(options.key ?? keyPair.privateKey);
    };

    return {
      url: baseUrl,
      rawUrl: readyUrl,
      port,
      host,
      dispose,
      signToken,
      getJwksRequestsCount: () => jwksRequestsCount,
      getOutboundUrls: () => [...outboundUrls],
      isolatedDir: isolatedPersistenceDir,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      jwk,
      wranglerConfig,
    };
  } catch (initialError) {
    try {
      await dispose();
    } catch {}
    throw initialError;
  }
}
