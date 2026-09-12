import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAccessPath, verifyReleaseVersion } from '../../scripts/verify-access.mjs';

const login = 'https://nocoo.cloudflareaccess.com/cdn-cgi/access/login/pokepocket.hexly.ai';
let request;
let log;

beforeEach(() => {
  vi.useFakeTimers();
  request = vi.fn();
  vi.stubGlobal('fetch', request);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deployment Access verification', () => {
  it.each([302, 303, 307])('accepts an HTTPS team login with status %s', async (status) => {
    request.mockResolvedValue(new Response(null, { status, headers: { Location: login } }));
    await verifyAccessPath('/');
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      'https://pokepocket.hexly.ai/',
      expect.objectContaining({ redirect: 'manual', headers: { Accept: 'text/html' } }),
    );
  });

  it.each([
    [200, null],
    [403, null],
    [302, 'https://another.cloudflareaccess.com/cdn-cgi/access/login/pokepocket.hexly.ai'],
    [302, 'https://nocoo.cloudflareaccess.com.example.test/cdn-cgi/access/login/'],
    [302, 'http://nocoo.cloudflareaccess.com/cdn-cgi/access/login/pokepocket.hexly.ai'],
    [302, 'https://nocoo.cloudflareaccess.com/unrelated'],
  ])('rejects status %s with redirect %s', async (status, location) => {
    request.mockImplementation(
      async () => new Response(null, { status, headers: location ? { Location: location } : {} }),
    );
    const verification = expect(verifyAccessPath('/api/catalog')).rejects.toThrow(
      'Cloudflare Access sign-in is not ready',
    );
    await vi.runAllTimersAsync();
    await verification;
    expect(request).toHaveBeenCalledTimes(12);
  });

  it('retries a temporary Worker rejection and reports diagnostics', async () => {
    request
      .mockResolvedValueOnce(
        Response.json(
          { error: 'Cloudflare Access authentication required' },
          { status: 403, headers: { 'CF-Ray': 'example-ray' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: login } }));
    const verification = verifyAccessPath('/');
    await vi.runAllTimersAsync();
    await verification;
    expect(request).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Worker received no valid Access JWT'),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cf-ray=example-ray'));
  });

  it('retries network failures without logging login query tokens', async () => {
    request.mockRejectedValueOnce(new Error('Synthetic connection reset')).mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: `${login}?token=synthetic-login-token` },
      }),
    );
    const verification = verifyAccessPath('/');
    await vi.runAllTimersAsync();
    await verification;
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-login-token');
  });
});

describe('deployed version verification', () => {
  it('cancels a non-json live body and retries until the version matches', async () => {
    const cancel = vi.fn();
    request
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => 'text/html' },
        body: { cancel },
        json: async () => ({}),
      })
      .mockResolvedValueOnce(Response.json({ status: 'ok', version: '1.1.0' }));
    const verification = verifyReleaseVersion('1.1.0', { attempts: 2, delayMs: 1 });
    await vi.runAllTimersAsync();
    await verification;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('retries live fetch failures then accepts the matching version', async () => {
    request
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(Response.json({ status: 'ok', version: '1.1.0' }));
    const verification = verifyReleaseVersion('1.1.0', { attempts: 2, delayMs: 1 });
    await vi.runAllTimersAsync();
    await verification;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('waits until the requested version is live', async () => {
    request
      .mockResolvedValueOnce(Response.json({ status: 'ok', version: '1.0.0' }))
      .mockResolvedValueOnce(Response.json({ status: 'ok', version: '1.1.0' }));
    const verification = verifyReleaseVersion('1.1.0');
    await vi.runAllTimersAsync();
    await verification;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    [302, null],
    [403, { error: 'Cloudflare Access authentication required' }],
    [200, { status: 'ok', version: '1.0.0' }],
    [200, { status: 'error', version: '1.1.0' }],
  ])('rejects a stale or unavailable liveness response (%s, %j)', async (status, body) => {
    request.mockImplementation(async () => Response.json(body, { status }));
    const verification = expect(verifyReleaseVersion('1.1.0')).rejects.toThrow(
      'Production did not report v1.1.0',
    );
    await vi.runAllTimersAsync();
    await verification;
  });

  it('orchestrates complete access verification and release checks with default paths and package version', async () => {
    const { readFile } = await import('node:fs/promises');
    const { version } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    const { runAccessVerification } = await import('../../scripts/verify-access.mjs');
    request.mockResolvedValue(new Response(null, { status: 302, headers: { Location: login } }));

    // Test with default 5 protected paths and live package version check reading actual package.json
    const res = await runAccessVerification({
      isRelease: true,
      fetchFn: async (url) => {
        if (url.includes('/api/live')) {
          return Response.json({ status: 'ok', version }, { status: 200 });
        }
        return new Response(null, { status: 302, headers: { Location: login } });
      },
      silent: true,
    });

    expect(res.success).toBe(true);
    expect(res.count).toBe(6); // 5 paths + 1 release version check
  });

  it('settles all checks and returns success:false when a check fails while waiting for remaining paths', async () => {
    const { runAccessVerification } = await import('../../scripts/verify-access.mjs');

    let deferredResolve;
    const deferredPromise = new Promise((resolve) => {
      deferredResolve = resolve;
    });

    let delayedPathSettled = false;
    let aggregateSettled = false;

    const resPromise = runAccessVerification({
      paths: ['/valid-1', '/invalid-path', '/delayed-path'],
      attempts: 1,
      delayMs: 1,
      fetchFn: async (url) => {
        if (url.includes('/invalid-path')) {
          return new Response('forbidden', { status: 403 });
        }
        if (url.includes('/delayed-path')) {
          await deferredPromise;
          delayedPathSettled = true;
          return new Response(null, { status: 302, headers: { Location: login } });
        }
        return new Response(null, { status: 302, headers: { Location: login } });
      },
      silent: true,
    });

    resPromise.then(() => {
      aggregateSettled = true;
    });

    // Advance fake timers by 10ms to let immediate rejections process without advancing deferredPromise
    await vi.advanceTimersByTimeAsync(10);
    expect(delayedPathSettled).toBe(false);
    expect(aggregateSettled).toBe(false);

    // Now release delayed path and advance fake timers
    deferredResolve();
    await vi.advanceTimersByTimeAsync(10);
    const res = await resPromise;

    expect(delayedPathSettled).toBe(true);
    expect(aggregateSettled).toBe(true);
    expect(res.success).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('/invalid-path');
  });
});
