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

export const ARTIFACTS_ROOT_NAME = 'test-results';
export const OWNERSHIP_MARKER_MAGIC = 'pokepocket-owned-artifacts-v1';

export const FORBIDDEN_CLI_FLAGS = new Set([
  '--output',
  '-o',
  '--reporter',
  '--add-reporter',
  '--last-failed-file',
]);

export const FORBIDDEN_OUTPUT_ENVS = [
  'PW_TEST_REPORTER',
  'PLAYWRIGHT_BLOB_OUTPUT_DIR',
  'PLAYWRIGHT_BLOB_OUTPUT_FILE',
  'PLAYWRIGHT_BLOB_OUTPUT_NAME',
  'PLAYWRIGHT_HTML_OUTPUT_DIR',
  'PLAYWRIGHT_HTML_REPORT',
  'PLAYWRIGHT_JSON_OUTPUT_DIR',
  'PLAYWRIGHT_JSON_OUTPUT_FILE',
  'PLAYWRIGHT_JSON_OUTPUT_NAME',
  'PLAYWRIGHT_JUNIT_OUTPUT_DIR',
  'PLAYWRIGHT_JUNIT_OUTPUT_FILE',
  'PLAYWRIGHT_JUNIT_OUTPUT_NAME',
  'PLAYWRIGHT_LAST_RUN_OUTPUT_FILE',
  'PLAYWRIGHT_PERFETTO_OUTPUT_DIR',
  'PLAYWRIGHT_PERFETTO_OUTPUT_FILE',
  'PLAYWRIGHT_PERFETTO_OUTPUT_NAME',
] as const;

export function assertNoForbiddenInvocation(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== 'string') continue;
    if (FORBIDDEN_CLI_FLAGS.has(arg)) {
      throw new Error(
        `Raw Playwright CLI flag "${arg}" is forbidden; use guarded configuration defaults.`,
      );
    }
    for (const flag of FORBIDDEN_CLI_FLAGS) {
      if (arg.startsWith(`${flag}=`)) {
        throw new Error(
          `Raw Playwright CLI flag "${arg}" is forbidden; use guarded configuration defaults.`,
        );
      }
    }
  }

  for (const envKey of FORBIDDEN_OUTPUT_ENVS) {
    if (env[envKey]) {
      throw new Error(`Overriding ${envKey} is forbidden.`);
    }
  }
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
