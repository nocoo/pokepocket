import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { stat, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import {
  checkPortAvailable,
  createProductionRuntime,
  DEFAULT_L2_HOST,
  DEFAULT_L2_PORT,
  EXPECTED_CERTS_URL,
  RUNTIME_RESOURCE_ROOT_ENV,
} from '../../scripts/production-runtime.mjs';

describe('production-runtime policy and contracts', () => {
  const cleanups = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        await fn();
      } catch {}
    }
  });

  async function createMockBuildFixture(overrides = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), 'mock-build-fixture-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    const wranglerConfig = {
      compatibility_date: '2026-09-05',
      compatibility_flags: ['nodejs_compat'],
      vars: {
        ACCESS_TEAM: 'nocoo',
        ACCESS_AUD: 'mock-access-aud-12345',
        ...(overrides.vars || {}),
      },
      assets: {
        directory: '../assets',
        not_found_handling: 'single-page-application',
        runWorkerFirst: true,
        ...(overrides.assets || {}),
      },
    };

    if (overrides.omitAccessTeam) {
      delete wranglerConfig.vars.ACCESS_TEAM;
    }
    if (overrides.omitAccessAud) {
      delete wranglerConfig.vars.ACCESS_AUD;
    }
    if (overrides.omitAssetsDirectory) {
      delete wranglerConfig.assets.directory;
    }

    await writeFile(path.join(dir, 'wrangler.json'), JSON.stringify(wranglerConfig));
    await writeFile(path.join(dir, 'index.js'), overrides.workerScript || 'export default {};');
    await mkdir(path.join(dir, 'assets'), { recursive: true });

    return dir;
  }

  it('exposes expected host, port, and certs URL constants', () => {
    expect(DEFAULT_L2_PORT).toBe(17048);
    expect(DEFAULT_L2_HOST).toBe('127.0.0.1');
    expect(EXPECTED_CERTS_URL).toBe('https://nocoo.cloudflareaccess.com/cdn-cgi/access/certs');
  });

  it('detects available and occupied ports', async () => {
    const freeServer = net.createServer();
    const freePort = await new Promise((resolve) => {
      freeServer.listen(0, '127.0.0.1', () => {
        const port = freeServer.address().port;
        freeServer.close(() => resolve(port));
      });
    });
    const avail = await checkPortAvailable(freePort, '127.0.0.1');
    expect(avail.available).toBe(true);

    const occupiedServer = net.createServer();
    await new Promise((resolve) => occupiedServer.listen(0, '127.0.0.1', resolve));
    const occupiedPort = occupiedServer.address().port;
    try {
      const occupiedRes = await checkPortAvailable(occupiedPort, '127.0.0.1');
      expect(occupiedRes.available).toBe(false);
      expect(occupiedRes.error).toBeDefined();
    } finally {
      await new Promise((resolve) => occupiedServer.close(resolve));
    }
  });

  it('rejects occupied port preflight without killing or reusing listener', async () => {
    const occupiedServer = net.createServer();
    await new Promise((resolve) => occupiedServer.listen(0, '127.0.0.1', resolve));
    const occupiedPort = occupiedServer.address().port;
    try {
      await expect(
        createProductionRuntime({
          port: occupiedPort,
        }),
      ).rejects.toThrow(`Port ${occupiedPort} on 127.0.0.1 is already in use`);
    } finally {
      await new Promise((resolve) => occupiedServer.close(resolve));
    }
  });

  it('validates required configuration bindings and fails closed', async () => {
    const missingTeamDir = await createMockBuildFixture({ omitAccessTeam: true });
    await expect(createProductionRuntime({ buildDir: missingTeamDir, port: 0 })).rejects.toThrow(
      'missing required ACCESS_TEAM',
    );

    const missingAudDir = await createMockBuildFixture({ omitAccessAud: true });
    await expect(createProductionRuntime({ buildDir: missingAudDir, port: 0 })).rejects.toThrow(
      'missing required ACCESS_AUD',
    );

    const missingAssetsDir = await createMockBuildFixture({ omitAssetsDirectory: true });
    await expect(createProductionRuntime({ buildDir: missingAssetsDir, port: 0 })).rejects.toThrow(
      'missing required assets.directory',
    );
  });

  it('cleans up isolated directory when Miniflare constructor throws', async () => {
    const buildDir = await createMockBuildFixture();
    let capturedDir = null;
    const constructorErr = new Error('Injected miniflare constructor error');
    class FailingCtor {
      constructor(options) {
        capturedDir = options.isolatedResourcePersistencePath;
        throw constructorErr;
      }
    }

    await expect(
      createProductionRuntime({
        buildDir,
        port: 0,
        Miniflare: FailingCtor,
      }),
    ).rejects.toBe(constructorErr);

    expect(capturedDir).toBeDefined();
    const statResult = await stat(capturedDir).catch((e) => e);
    expect(statResult.code).toBe('ENOENT');
  });

  it('cleans up isolated directory and preserves initial ready error when ready rejects', async () => {
    const buildDir = await createMockBuildFixture();
    let capturedDir = null;
    const readyErr = new Error('Injected miniflare ready error');
    class FailingReady {
      constructor(options) {
        capturedDir = options.isolatedResourcePersistencePath;
      }
      get ready() {
        return Promise.reject(readyErr);
      }
      async dispose() {
        throw new Error('Dispose also failed');
      }
    }

    await expect(
      createProductionRuntime({
        buildDir,
        port: 0,
        Miniflare: FailingReady,
      }),
    ).rejects.toBe(readyErr);

    expect(capturedDir).toBeDefined();
    const statResult = await stat(capturedDir).catch((e) => e);
    expect(statResult.code).toBe('ENOENT');
  });

  it('allocates isolated directory under resourceRoot option or environment variable', async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), 'custom-resource-root-'));
    cleanups.push(() => rm(customRoot, { recursive: true, force: true }));
    const buildDir = await createMockBuildFixture();

    class FakeMiniflare {
      constructor(options) {
        this.isolated = options.isolatedResourcePersistencePath;
        this.ready = Promise.resolve(new URL('http://127.0.0.1:17048'));
      }
      async dispose() {}
    }

    // Pass via option
    const rt1 = await createProductionRuntime({
      buildDir,
      port: 0,
      resourceRoot: customRoot,
      Miniflare: FakeMiniflare,
    });
    expect(rt1.isolatedDir.startsWith(customRoot)).toBe(true);
    await rt1.dispose();

    // Pass via environment variable
    const origEnv = process.env[RUNTIME_RESOURCE_ROOT_ENV];
    process.env[RUNTIME_RESOURCE_ROOT_ENV] = customRoot;
    try {
      const rt2 = await createProductionRuntime({
        buildDir,
        port: 0,
        Miniflare: FakeMiniflare,
      });
      expect(rt2.isolatedDir.startsWith(customRoot)).toBe(true);
      await rt2.dispose();
    } finally {
      if (origEnv !== undefined) {
        process.env[RUNTIME_RESOURCE_ROOT_ENV] = origEnv;
      } else {
        delete process.env[RUNTIME_RESOURCE_ROOT_ENV];
      }
    }
  });

  it('shares single disposal promise across concurrent dispose calls with event loop turn', async () => {
    const buildDir = await createMockBuildFixture();
    let release;
    const deferred = new Promise((resolve) => {
      release = resolve;
    });
    let disposeCalls = 0;

    class DeferredMiniflare {
      constructor() {
        this.ready = Promise.resolve(new URL('http://127.0.0.1:17048'));
      }
      async dispose() {
        disposeCalls++;
        await deferred;
      }
    }

    const runtime = await createProductionRuntime({
      buildDir,
      port: 0,
      Miniflare: DeferredMiniflare,
    });

    let firstSettled = false;
    let secondSettled = false;
    const first = runtime.dispose().then(() => {
      firstSettled = true;
    });
    const second = runtime.dispose().then(() => {
      secondSettled = true;
    });

    try {
      // Advance an event-loop turn with disposal still deferred: both calls must remain pending
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(firstSettled).toBe(false);
      expect(secondSettled).toBe(false);
      expect(disposeCalls).toBe(1);
    } finally {
      release();
      await Promise.all([first, second]);
    }

    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
    expect(disposeCalls).toBe(1);
  });

  it('disposes runtime, settles cleanup, and removes signal listeners on process signal', async () => {
    const buildDir = await createMockBuildFixture();
    let release;
    const deferred = new Promise((resolve) => {
      release = resolve;
    });
    let disposedCalled = false;

    class SignalTrackingMiniflare {
      constructor() {
        this.ready = Promise.resolve(new URL('http://127.0.0.1:17048'));
      }
      async dispose() {
        disposedCalled = true;
        await deferred;
      }
    }

    const initialSigintListeners = process.listeners('SIGINT');
    const initialSigtermListeners = process.listeners('SIGTERM');

    const runtime = await createProductionRuntime({
      buildDir,
      port: 0,
      Miniflare: SignalTrackingMiniflare,
    });

    // Emitting SIGINT triggers runtime disposal
    process.emit('SIGINT');
    release();

    // Await settlement of runtime disposal
    await runtime.dispose();
    expect(disposedCalled).toBe(true);

    const statResult = await stat(runtime.isolatedDir).catch((e) => e);
    expect(statResult.code).toBe('ENOENT');

    // Verify owned signal listeners were cleaned up and unrelated ones survive
    expect(process.listeners('SIGINT')).toEqual(initialSigintListeners);
    expect(process.listeners('SIGTERM')).toEqual(initialSigtermListeners);
  });

  it('handles dispose failure and rm failure during runtime.dispose()', async () => {
    const buildDir = await createMockBuildFixture();
    class FakeMiniflareDisposeFail {
      constructor() {
        this.ready = Promise.resolve(new URL('http://127.0.0.1:17048'));
      }
      async dispose() {
        throw new Error('Injected dispose exception');
      }
    }

    const runtime = await createProductionRuntime({
      buildDir,
      port: 0,
      Miniflare: FakeMiniflareDisposeFail,
    });

    await expect(runtime.dispose()).rejects.toThrow('Injected dispose exception');
    await expect(runtime.dispose()).rejects.toThrow('Injected dispose exception');

    let leakedDir = null;
    class FakeMiniflareRmFail {
      constructor(options) {
        leakedDir = options.isolatedResourcePersistencePath;
        this.ready = Promise.resolve('http://127.0.0.1:17048');
      }
      async dispose() {
        return Promise.resolve();
      }
    }
    const runtimeRm = await createProductionRuntime({
      buildDir,
      port: 0,
      Miniflare: FakeMiniflareRmFail,
      rmFn: async () => {
        throw new Error('Injected rm error');
      },
    });
    cleanups.push(() => leakedDir && rm(leakedDir, { recursive: true, force: true }));
    await expect(runtimeRm.dispose()).rejects.toThrow('Injected rm error');
  });

  it('outbound service rejects unexpected egress and supports token generation', async () => {
    const buildDir = await createMockBuildFixture();
    let capturedHandler = null;
    class FakeMiniflareWithOutbound {
      constructor(options) {
        capturedHandler = options.workers[0].dev.outboundService.handler;
        this.ready = Promise.resolve(new URL('http://127.0.0.1:17048'));
      }
      async dispose() {
        return Promise.resolve();
      }
    }

    const runtime = await createProductionRuntime({
      buildDir,
      port: 0,
      Miniflare: FakeMiniflareWithOutbound,
    });

    try {
      expect(typeof capturedHandler).toBe('function');
      const res = capturedHandler({ url: EXPECTED_CERTS_URL });
      expect(res).toBeDefined();
      expect(runtime.getJwksRequestsCount()).toBe(1);

      expect(() => capturedHandler({ url: 'https://evil.com/leak' })).toThrow(
        'Unexpected egress rejected: https://evil.com/leak',
      );

      const defaultToken = await runtime.signToken();
      expect(typeof defaultToken).toBe('string');
      const defaultHeader = decodeProtectedHeader(defaultToken);
      const defaultPayload = decodeJwt(defaultToken);
      expect(defaultHeader.alg).toBe('RS256');
      expect(defaultHeader.kid).toBe(runtime.jwk.kid);
      expect(defaultPayload.sub).toBe('test-user');
      expect(defaultPayload.iss).toBe('https://nocoo.cloudflareaccess.com');
      expect(defaultPayload.aud).toBe(runtime.wranglerConfig.vars.ACCESS_AUD);
      expect(typeof defaultPayload.iat).toBe('number');
      expect(typeof defaultPayload.exp).toBe('number');
      expect(defaultPayload.exp).toBeGreaterThan(defaultPayload.iat);

      const explicitExp = Math.floor(Date.now() / 1000) + 3600;
      const customToken = await runtime.signToken({
        exp: explicitExp,
        aud: 'custom-aud',
        sub: 'custom-user',
      });
      expect(typeof customToken).toBe('string');
      const customPayload = decodeJwt(customToken);
      expect(customPayload.sub).toBe('custom-user');
      expect(customPayload.aud).toBe('custom-aud');
      expect(customPayload.iss).toBe('https://nocoo.cloudflareaccess.com');
      expect(customPayload.exp).toBe(explicitExp);

      const rawToken = await runtime.signToken(
        { sub: 'raw-sub', aud: 'raw-aud' },
        { rawPayload: true, kid: 'custom-kid', alg: 'RS256' },
      );
      expect(typeof rawToken).toBe('string');
      const rawHeader = decodeProtectedHeader(rawToken);
      const rawPayload = decodeJwt(rawToken);
      expect(rawHeader.alg).toBe('RS256');
      expect(rawHeader.kid).toBe('custom-kid');
      expect(rawPayload.sub).toBe('raw-sub');
      expect(rawPayload.aud).toBe('raw-aud');
      // Deliberately omitted claims in rawPayload must remain absent, not reinstated by defaults
      expect(rawPayload.iss).toBeUndefined();
      expect(rawPayload.exp).toBeUndefined();
      expect(rawPayload.iat).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  });
});
