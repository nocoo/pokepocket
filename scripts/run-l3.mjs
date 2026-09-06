import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { acquireBrowserLock, isProcessAlive } from './browser-lock.mjs';
import {
  assertNoForbiddenInvocation,
  BROWSER_PORT,
  ENV_BROWSER_NONCE,
  ENV_BROWSER_PID,
  ENV_BROWSER_PORT,
  ENV_BROWSER_RESOURCE_ROOT,
  ENV_BROWSER_WS,
  OPTIONAL_TEST_COUNT,
  REQUIRED_TEST_COUNT,
  validateBrowserTarget,
  validateBrowserWsEndpoint,
} from './browser-shared.mjs';
import { validatePlaywrightJsonReport } from './browser-report.mjs';
import { runParallelCommands } from './run-parallel.mjs';
import { checkPortAvailable } from './production-runtime.mjs';

export function parseL3Cli(argv = process.argv, defaultSuite = 'required') {
  if (argv.length > 2) {
    throw new Error(
      `Unknown or unsupported CLI option "${argv[2]}" in ${defaultSuite} L3 gate. Selectors, flags, and mode overrides are forbidden.`,
    );
  }
  return { isOptional: defaultSuite === 'optional' };
}

export async function createLocalRomDevRuntime(options = {}) {
  const root = options.root ?? process.cwd();
  const port = options.port ?? BROWSER_PORT;
  const resourceRoot = options.resourceRoot;
  const signal = options.signal;
  const createViteServerFn = options.createViteServerFn ?? createViteServer;

  if (signal?.aborted) {
    throw new Error('Signal already aborted before starting local-ROM dev runtime');
  }

  const viteServer = await createViteServerFn({
    root,
    configFile: path.resolve(root, 'vite.optional.config.ts'),
    cacheDir: resourceRoot ? path.join(resourceRoot, '.vite-cache') : undefined,
    server: {
      port,
      strictPort: true,
      host: '127.0.0.1',
    },
  });

  let underlyingListenPromise = null;

  const start = async () => {
    if (signal?.aborted) {
      throw new Error(signal.reason?.message || 'Signal aborted before runtime listen');
    }

    underlyingListenPromise = Promise.resolve(viteServer.listen());

    if (!signal) {
      await underlyingListenPromise;
      return;
    }

    let onAbort;
    const abortPromise = new Promise((_, reject) => {
      onAbort = () =>
        reject(new Error(signal.reason?.message || 'Signal aborted during runtime listen'));
      signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      await Promise.race([underlyingListenPromise, abortPromise]);
    } finally {
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  };

  const dispose = async () => {
    if (underlyingListenPromise) {
      try {
        await underlyingListenPromise;
      } catch (_listenErr) {
        // Startup rejection is consumed here so close can proceed
      }
    }
    if (typeof viteServer.close === 'function') {
      await viteServer.close();
    }
  };

  return {
    port,
    server: viteServer,
    start,
    dispose,
  };
}

export async function runL3Gate(options = {}) {
  const silent = options.silent ?? false;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const commandRunner = options.commandRunner ?? runParallelCommands;
  const mkdtempFn = options.mkdtempFn ?? mkdtemp;
  const rmFn = options.rmFn ?? rm;
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const checkPortAvailableFn = options.checkPortAvailableFn ?? checkPortAvailable;

  let isOptional = false;
  try {
    const defaultSuite = options.suite === 'optional' ? 'optional' : 'required';
    const parsed = parseL3Cli(argv, defaultSuite);
    isOptional = parsed.isOptional;
  } catch (err) {
    if (!silent) console.error(err.message);
    process.exitCode = 1;
    return false;
  }

  const suite = isOptional ? 'optional' : 'required';
  const expectedTestCount =
    options.expectedTestCount ?? (suite === 'required' ? REQUIRED_TEST_COUNT : OPTIONAL_TEST_COUNT);

  // 1. Validate invocation / target URL before any filesystem, build, or network actions
  try {
    assertNoForbiddenInvocation(argv, env);
    if (env.TEST_BASE_URL) {
      validateBrowserTarget(env.TEST_BASE_URL);
    }
  } catch (validationErr) {
    if (!silent) console.error(`L3 pre-invocation validation failed: ${validationErr.message}`);
    process.exitCode = 1;
    return false;
  }

  const controller = new AbortController();
  let firstAbortReason = null;

  const timer = setTimeout(() => {
    if (firstAbortReason === null) {
      firstAbortReason = 'TIMEOUT';
    }
    controller.abort(new Error(`L3 gate timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const handleSigint = () => {
    if (firstAbortReason === null) {
      firstAbortReason = 'SIGINT';
    }
    controller.abort(new Error('Interrupted by SIGINT'));
  };
  const handleSigterm = () => {
    if (firstAbortReason === null) {
      firstAbortReason = 'SIGTERM';
    }
    controller.abort(new Error('Interrupted by SIGTERM'));
  };

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  let ownedResourceRoot = null;
  let ownedLock = null;
  let browserServer = null;
  let ownedRuntime = null;
  let executionError = null;
  let cleanupError = null;

  try {
    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted before port check');
    }

    // 2. Reject occupied port
    const portCheck = await checkPortAvailableFn(BROWSER_PORT, '127.0.0.1');
    if (!portCheck.available) {
      const code = portCheck.error?.code || 'EADDRINUSE';
      throw new Error(
        `Port ${BROWSER_PORT} on 127.0.0.1 is already in use (${code}). Refusing to reuse or kill existing listener.`,
      );
    }

    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted before resource allocation');
    }

    // 3. Allocate owned temporary resource root
    ownedResourceRoot = await mkdtempFn(path.join(tmpdir(), 'pokepocket-l3-gate-'));

    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted before lock acquisition');
    }

    // 4. Acquire fixed-port lock (preventing concurrent builds of the same checkout)
    ownedLock = acquireBrowserLock({
      port: BROWSER_PORT,
      suite,
      checkoutDir: cwd,
      runResourceRoot: ownedResourceRoot,
      lockFilePath: options.lockFilePath,
      isProcessAliveFn: options.isProcessAliveFn,
    });

    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted before build');
    }

    // 5. Await build
    await commandRunner([{ command: 'npm', args: ['run', 'build'], cwd }], {
      signal: controller.signal,
    });

    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted after build');
    }

    // 6. Launch owned browser and runtime
    const launchBrowserServerFn =
      options.launchBrowserServerFn ?? chromium.launchServer.bind(chromium);
    browserServer = await launchBrowserServerFn({
      host: '127.0.0.1',
      handleSIGINT: false,
      handleSIGTERM: false,
      channel: process.env.CI ? undefined : 'chrome',
    });

    const browserProcess = browserServer.process();
    const browserPid = browserProcess?.pid;
    if (!browserPid || !Number.isSafeInteger(browserPid) || browserPid <= 0) {
      throw new Error('Failed to capture child PID from BrowserServer');
    }
    const spawnArgs = browserProcess?.spawnargs ?? [];
    const userDataDirArg = spawnArgs.find(
      (arg) => typeof arg === 'string' && arg.startsWith('--user-data-dir='),
    );
    const browserProfilePath = userDataDirArg
      ? userDataDirArg.slice('--user-data-dir='.length)
      : null;

    if (!browserProfilePath || typeof browserProfilePath !== 'string') {
      throw new Error(
        'Failed to capture non-empty --user-data-dir browser profile from BrowserServer',
      );
    }

    const wsEndpoint = validateBrowserWsEndpoint(browserServer.wsEndpoint());

    // Record verified browser ownership metadata exclusively into resource root for provenance
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      path.join(ownedResourceRoot, 'browser-metadata.json'),
      JSON.stringify(
        {
          browserPid,
          browserProfilePath,
          wsEndpoint,
          port: BROWSER_PORT,
          lockNonce: ownedLock.nonce,
          acquiredAt: Date.now(),
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );

    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted before runtime launch');
    }

    if (suite === 'optional') {
      const createRuntimeFn = options.createLocalRomDevRuntimeFn ?? createLocalRomDevRuntime;
      const runtimeInstance = await createRuntimeFn({
        root: cwd,
        port: BROWSER_PORT,
        resourceRoot: ownedResourceRoot,
        signal: controller.signal,
        createViteServerFn: options.createViteServerFn,
      });
      ownedRuntime = runtimeInstance;
      if (typeof runtimeInstance?.start === 'function') {
        await runtimeInstance.start();
      }
    }

    if (controller.signal.aborted) {
      throw new Error(controller.signal.reason?.message || 'Aborted before test execution');
    }

    // 7. Run suite
    const runOptions = {
      commandRunner,
      signal: controller.signal,
      cwd,
      resourceRoot: ownedResourceRoot,
      lock: ownedLock,
      suite,
      expectedTestCount,
      wsEndpoint,
    };

    await runL3TestsAndReport(runOptions);
  } catch (err) {
    executionError = err;
    if (!silent) {
      console.error('L3 Gate execution failed:', err);
    }
  } finally {
    clearTimeout(timer);

    const cleanupGraceMs = options.cleanupGraceMs ?? 3000;
    const checkAlive = options.isProcessAliveFn ?? isProcessAlive;

    // Helper: run a promise with a timeout
    const withTimeout = (promise, ms, desc) => {
      let t;
      const timeoutPromise = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`${desc} timed out after ${ms}ms`)), ms);
      });
      return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(t));
    };

    // 8. Settle browser FIRST to disconnect clients and release held ports/handles
    let capturedProfile = null;
    let browserTerminated = true;
    let browserCloseErr = null;
    let browserKillErr = null;

    if (browserServer) {
      const proc = browserServer.process();
      const browserPid = proc?.pid;
      const sArgs = proc?.spawnargs ?? [];
      const uArg = sArgs.find((a) => typeof a === 'string' && a.startsWith('--user-data-dir='));
      if (uArg) capturedProfile = uArg.slice('--user-data-dir='.length);

      // Attempt clean close within grace period
      try {
        await withTimeout(browserServer.close(), cleanupGraceMs, 'BrowserServer.close()');
      } catch (bErr) {
        browserCloseErr = bErr;
        if (!silent)
          console.error('BrowserServer close failed or hung; escalating to kill:', bErr.message);
      }

      // If close failed or process is still reported alive, escalate to kill
      if (browserCloseErr || (browserPid && checkAlive(browserPid))) {
        try {
          if (typeof browserServer.kill === 'function') {
            await withTimeout(
              Promise.resolve(browserServer.kill()),
              cleanupGraceMs,
              'BrowserServer.kill()',
            );
          } else if (proc && typeof proc.kill === 'function') {
            proc.kill('SIGKILL');
          }
        } catch (kErr) {
          browserKillErr = kErr;
          if (!silent) console.error('BrowserServer kill escalation failed:', kErr.message);
        }
      }

      // Verify actual process termination
      if (browserPid && checkAlive(browserPid)) {
        browserTerminated = false;
        const msg = `Browser process ${browserPid} termination could not be verified; process remains alive`;
        const dualErr = new Error(
          `${msg}. Close error: ${browserCloseErr?.message ?? 'none'}. Kill error: ${browserKillErr?.message ?? 'none'}`,
        );
        if (!cleanupError) cleanupError = dualErr;
        if (!silent) console.error(dualErr.message);
      } else if (browserCloseErr || browserKillErr) {
        if (!cleanupError) cleanupError = browserKillErr || browserCloseErr;
      }
    }

    // Settle owned runtime
    let runtimeTerminated = true;
    if (ownedRuntime) {
      try {
        await withTimeout(ownedRuntime.dispose(), cleanupGraceMs, 'ownedRuntime.dispose()');
      } catch (runtimeErr) {
        runtimeTerminated = false;
        if (!cleanupError) cleanupError = runtimeErr;
        if (!silent) console.error('Owned runtime cleanup failed:', runtimeErr);

        // Attempt connection disposal via underlying server handle if present
        const srv = ownedRuntime.server?.httpServer ?? ownedRuntime.server;
        if (srv && typeof srv.closeAllConnections === 'function') {
          try {
            srv.closeAllConnections();
          } catch (_cErr) {}
        }
      }
    }

    const allResourcesTerminated = browserTerminated && runtimeTerminated;

    // Clean up captured browser profile directory if termination was verified
    if (capturedProfile && allResourcesTerminated) {
      try {
        await rmFn(capturedProfile, { recursive: true, force: true });
      } catch (profErr) {
        if (!cleanupError) cleanupError = profErr;
        if (!silent) console.error('Browser profile cleanup failed:', profErr);
      }
    }

    // 9. Remove owned temporary resource root ONLY if browser and runtime are verified terminated.
    // If browser or runtime remains active, preserve resourceRoot and diagnostic metadata!
    if (ownedResourceRoot && allResourcesTerminated) {
      try {
        await rmFn(ownedResourceRoot, { recursive: true, force: true });
      } catch (rmErr) {
        if (!cleanupError) cleanupError = rmErr;
        if (!silent) console.error('L3 Gate resource cleanup failed:', rmErr);
      }
    }

    // 10. Release fixed-port lock ONLY if browser and runtime are verified terminated.
    // If browser or runtime remains active, hold the lock so the occupied port is not reused!
    if (ownedLock && allResourcesTerminated) {
      try {
        ownedLock.release();
      } catch (lockErr) {
        if (!cleanupError) cleanupError = lockErr;
        if (!silent) console.error('L3 Lock release failed:', lockErr);
      }
    }

    // Restore original listeners only after settlement is completely finished
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  }

  if (firstAbortReason === 'SIGINT') {
    process.exitCode = 130;
    return false;
  }
  if (firstAbortReason === 'SIGTERM') {
    process.exitCode = 143;
    return false;
  }
  if (controller.signal.aborted) {
    process.exitCode = 1;
    return false;
  }

  if (executionError || cleanupError) {
    process.exitCode = 1;
    return false;
  }

  return true;
}

export async function runL3TestsAndReport(options = {}) {
  const commandRunner = options.commandRunner ?? runParallelCommands;
  const commandOptions = { signal: options.signal };
  const suite = options.suite ?? 'required';
  const lock = options.lock;
  const cwd = options.cwd ?? process.cwd();
  const resourceRoot = options.resourceRoot;
  const expectedTestCount = options.expectedTestCount;
  const wsEndpoint = options.wsEndpoint;

  const childEnv = {
    ...process.env,
    [ENV_BROWSER_NONCE]: lock.nonce,
    [ENV_BROWSER_PID]: String(lock.pid),
    [ENV_BROWSER_RESOURCE_ROOT]: resourceRoot,
    [ENV_BROWSER_PORT]: String(lock.port),
    [ENV_BROWSER_WS]: wsEndpoint,
  };

  const configFile =
    suite === 'optional' ? 'playwright.optional.config.ts' : 'playwright.config.ts';

  await commandRunner(
    [
      {
        command: 'npx',
        args: ['playwright', 'test', '--config', configFile],
        cwd,
        env: childEnv,
      },
    ],
    commandOptions,
  );

  const reportPath = path.resolve(cwd, `test-results/${suite}/report.json`);

  validatePlaywrightJsonReport(reportPath, { expectedTestCount });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runL3Gate();
}
