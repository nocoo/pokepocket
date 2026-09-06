import {
  type Stats,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
// @ts-expect-error browser-lock is a maintained mjs script without ambient declarations
import { readAndVerifyHeldLock, isProcessAlive } from './browser-lock.mjs';
import {
  ARTIFACTS_ROOT_NAME,
  BROWSER_PORT,
  BROWSER_TARGET_URL,
  ENV_BROWSER_NONCE,
  ENV_BROWSER_PID,
  ENV_BROWSER_PORT,
  ENV_BROWSER_RESOURCE_ROOT,
  ENV_BROWSER_WS,
  FORBIDDEN_CLI_FLAGS,
  FORBIDDEN_OUTPUT_ENVS,
  OWNERSHIP_MARKER_MAGIC,
  getBrowserLockPath,
  assertNoForbiddenInvocation as rawAssertNoForbiddenInvocation,
  validateBrowserTarget,
  validateBrowserWsEndpoint,
  // @ts-expect-error browser-shared is a maintained mjs script without ambient declarations
} from './browser-shared.mjs';

export {
  ARTIFACTS_ROOT_NAME,
  BROWSER_PORT,
  BROWSER_TARGET_URL,
  ENV_BROWSER_NONCE,
  ENV_BROWSER_PID,
  ENV_BROWSER_PORT,
  ENV_BROWSER_RESOURCE_ROOT,
  ENV_BROWSER_WS,
  FORBIDDEN_CLI_FLAGS,
  FORBIDDEN_OUTPUT_ENVS,
  OWNERSHIP_MARKER_MAGIC,
  getBrowserLockPath,
  assertNoForbiddenInvocation as rawAssertNoForbiddenInvocation,
  validateBrowserTarget,
  validateBrowserWsEndpoint,
};

export interface AssertGuardedInvocationLockOptions {
  lockFilePath?: string;
  isProcessAliveFn?: (pid: number) => boolean;
}

export function assertGuardedInvocationLock(
  canonicalConfigDir: string,
  suiteSubdir: AllowedSuiteLeaf,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: AssertGuardedInvocationLockOptions = {},
): string {
  const nonce = env[ENV_BROWSER_NONCE];
  if (!nonce) {
    throw new Error(
      `Missing required runner authorization nonce (${ENV_BROWSER_NONCE}). Direct raw execution without runner lock is forbidden.`,
    );
  }

  const pidStr = env[ENV_BROWSER_PID];
  if (!pidStr) {
    throw new Error(
      `Missing required runner owner PID (${ENV_BROWSER_PID}). Direct raw execution without runner lock is forbidden.`,
    );
  }
  if (!/^\d+$/.test(pidStr.trim())) {
    throw new Error(`Invalid runner owner PID: "${pidStr}"`);
  }
  const pid = Number(pidStr.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid runner owner PID: "${pidStr}"`);
  }

  const resourceRoot = env[ENV_BROWSER_RESOURCE_ROOT];
  if (!resourceRoot) {
    throw new Error(
      `Missing required runner resource root (${ENV_BROWSER_RESOURCE_ROOT}). Direct raw execution without runner lock is forbidden.`,
    );
  }

  const portStr = env[ENV_BROWSER_PORT];
  if (portStr !== undefined && portStr !== String(BROWSER_PORT)) {
    throw new Error(`Authorized port mismatch: expected "${BROWSER_PORT}", received "${portStr}"`);
  }
  const port = portStr ? parseInt(portStr, 10) : BROWSER_PORT;

  // Pure tests can pass an explicit lockFilePath via in-memory options, NEVER from env
  const lockFilePath = options.lockFilePath ?? getBrowserLockPath(port);
  readAndVerifyHeldLock({
    port,
    pid,
    nonce,
    checkoutDir: canonicalConfigDir,
    suite: suiteSubdir,
    runResourceRoot: resourceRoot,
    lockFilePath,
    isProcessAliveFn: options.isProcessAliveFn,
  });

  // Verify and read owned browser metadata recorded in resourceRoot
  const metaPath = resolve(resourceRoot, 'browser-metadata.json');
  let metaStat: Stats;
  try {
    metaStat = lstatSync(metaPath);
  } catch (err: unknown) {
    throw new Error(
      `Missing or unreadable runner browser metadata at "${metaPath}": ${(err as Error).message}`,
    );
  }
  if (metaStat.isSymbolicLink()) {
    throw new Error(`Runner browser metadata "${metaPath}" must not be a symbolic link`);
  }
  if (!metaStat.isFile()) {
    throw new Error(`Runner browser metadata "${metaPath}" must be a regular file`);
  }

  let browserMeta: {
    browserPid?: number;
    wsEndpoint?: string;
    port?: number;
    lockNonce?: string;
    browserProfilePath?: string | null;
  };
  try {
    browserMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (err: unknown) {
    throw new Error(
      `Runner browser metadata at "${metaPath}" contains invalid JSON: ${(err as Error).message}`,
    );
  }

  if (
    !browserMeta.browserPid ||
    !Number.isSafeInteger(browserMeta.browserPid) ||
    browserMeta.browserPid <= 0
  ) {
    throw new Error(
      `Runner browser metadata contains invalid browserPid: ${browserMeta.browserPid}`,
    );
  }

  const checkAlive = options.isProcessAliveFn ?? isProcessAlive;
  if (!checkAlive(browserMeta.browserPid)) {
    throw new Error(
      `Runner browser process ${browserMeta.browserPid} is dead or unresponsive; execution aborted before resolving output directory`,
    );
  }
  if (browserMeta.port !== port) {
    throw new Error(
      `Runner browser metadata port mismatch: expected ${port}, found ${browserMeta.port}`,
    );
  }
  if (browserMeta.lockNonce !== nonce) {
    throw new Error(
      `Runner browser metadata lockNonce mismatch: expected ${nonce}, found ${browserMeta.lockNonce}`,
    );
  }
  if (!browserMeta.wsEndpoint) {
    throw new Error('Runner browser metadata missing wsEndpoint');
  }
  const validatedWs = validateBrowserWsEndpoint(browserMeta.wsEndpoint);

  // If environment provides ENV_BROWSER_WS, it must match browser metadata exactly
  const envWs = env[ENV_BROWSER_WS];
  if (!envWs) {
    throw new Error(
      `Missing required runner browser endpoint (${ENV_BROWSER_WS}). Execution must connect to parent BrowserServer.`,
    );
  }
  if (envWs !== validatedWs) {
    throw new Error(
      `Runner browser endpoint mismatch: environment (${envWs}) does not match recorded metadata (${validatedWs})`,
    );
  }

  return validatedWs;
}

function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

function validateMarkerContent(markerPath: string): void {
  const lstat = lstatSync(markerPath);
  if (lstat.isSymbolicLink()) {
    throw new Error(`Artifact ownership marker "${markerPath}" must not be a symbolic link.`);
  }
  if (!lstat.isFile()) {
    throw new Error(`Artifact ownership marker "${markerPath}" must be a regular file.`);
  }

  const content = readFileSync(markerPath, 'utf8').trim();
  if (content !== OWNERSHIP_MARKER_MAGIC) {
    throw new Error(
      `Artifact ownership marker "${markerPath}" contains invalid or mismatched metadata. Refusing cleanup risk.`,
    );
  }
}

export type AllowedSuiteLeaf = 'required' | 'optional';

export interface ResolveGuardedOutputDirOptions {
  configDir: string;
  suiteSubdir: AllowedSuiteLeaf;
  cwd?: string;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export function resolveGuardedOutputDir(options: ResolveGuardedOutputDirOptions): string {
  const {
    configDir,
    suiteSubdir,
    cwd = process.cwd(),
    argv = process.argv,
    env = process.env,
  } = options;

  assertNoForbiddenInvocation(argv, env);

  if (suiteSubdir !== 'required' && suiteSubdir !== 'optional') {
    throw new Error(
      `suiteSubdir must be either "required" or "optional", received: ${String(suiteSubdir)}`,
    );
  }

  if (typeof configDir !== 'string' || !configDir) {
    throw new Error('configDir must be a non-empty string');
  }

  const resolvedConfigDir = resolve(configDir);
  const resolvedCwd = resolve(cwd);

  if (!existsSync(resolvedConfigDir)) {
    throw new Error(`configDir does not exist: ${resolvedConfigDir}`);
  }

  const canonicalConfigDir = realpathSync(resolvedConfigDir);
  if (!existsSync(resolvedCwd)) {
    throw new Error(`Working directory does not exist: ${resolvedCwd}`);
  }
  const canonicalCwd = realpathSync(resolvedCwd);

  const relFromConfigToCwd = relative(canonicalConfigDir, canonicalCwd);
  const isCwdInsideConfigDir =
    !relFromConfigToCwd.startsWith('..') && !isAbsolute(relFromConfigToCwd);

  if (!isCwdInsideConfigDir) {
    throw new Error(
      `Working directory "${canonicalCwd}" is outside project root "${canonicalConfigDir}". Config execution must originate from within project tree.`,
    );
  }

  const artifactsParent = resolve(canonicalConfigDir, ARTIFACTS_ROOT_NAME);
  const resolvedTarget = resolve(artifactsParent, suiteSubdir);
  const markerPath = resolve(artifactsParent, '.owner');

  const parentStat = lstatIfPresent(artifactsParent);
  if (parentStat) {
    if (parentStat.isSymbolicLink()) {
      throw new Error(`Artifacts parent "${artifactsParent}" must not be a symbolic link.`);
    }
    if (!parentStat.isDirectory()) {
      throw new Error(`Artifacts parent "${artifactsParent}" is an existing non-directory file.`);
    }

    const markerStat = lstatIfPresent(markerPath);
    if (!markerStat) {
      throw new Error(
        `Artifacts directory "${artifactsParent}" already exists but is not marked as project-owned (missing ${markerPath}). Refusing cleanup risk.`,
      );
    }
    validateMarkerContent(markerPath);
  } else {
    mkdirSync(artifactsParent);
    writeFileSync(markerPath, `${OWNERSHIP_MARKER_MAGIC}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  }

  const targetStat = lstatIfPresent(resolvedTarget);
  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      throw new Error(`Output directory "${resolvedTarget}" must not be a symbolic link.`);
    }
    if (!targetStat.isDirectory()) {
      throw new Error(`Output directory "${resolvedTarget}" is an existing non-directory file.`);
    }
    return resolvedTarget;
  }

  mkdirSync(resolvedTarget);
  return resolvedTarget;
}

export function assertNoForbiddenInvocation(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  rawAssertNoForbiddenInvocation(argv, env);
}
