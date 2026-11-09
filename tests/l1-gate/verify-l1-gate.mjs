#!/usr/bin/env node
/**
 * Isolated negative/positive probes for `.husky/pre-commit` (index-snapshot L1).
 * Uses temporary git repos under TMPDIR; does not mutate the real index.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultRepo = join(import.meta.dirname, '../..');

export const fixtureSource = `export function gateReady(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
`;

export const passingTest = `import { expect, it } from "vitest";
import { gateReady } from "../src/gate-fixture";

it("accepts trimmed text", () => {
  expect(gateReady("a")).toBe(true);
  expect(gateReady("  ")).toBe(false);
});
`;

export const failingTest = passingTest.replace('toBe(true)', 'toBe(false)');

export const gateTsconfig = {
  compilerOptions: {
    strict: true,
    module: 'ESNext',
    moduleResolution: 'bundler',
    target: 'ES2022',
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
  },
  include: ['src/**/*.ts', 'tests/**/*.ts', 'tests/**/*.mjs'],
};

export const gateVitest = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/gate-fixture.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      enabled: false,
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/gate-fixture.ts"],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
`;

export const gateBiome = {
  $schema: 'https://biomejs.dev/schemas/2.6.4/schema.json',
  files: { includes: ['src/**/*.ts', 'tests/**/*.ts'] },
  formatter: { enabled: false },
  linter: { enabled: true, rules: { preset: 'recommended' } },
};

export function recordProbeCheck(state, name, ok, detail = '') {
  const text = ok
    ? detail.replace(/\s+/g, ' ').slice(0, 320)
    : detail.trim().replace(/\s+/g, ' ').slice(0, 480);
  if (!state.silent) {
    console.log(`${ok ? 'ok' : 'FAIL'} ${name}${text ? `: ${text}` : ''}`);
  }
  if (!ok) state.failed = 1;
}

export function snapshotGone(leftovers) {
  return leftovers.every((name) => !name.startsWith('pokepocket-index-'));
}

export function buildFixturePackageJson(repoRoot) {
  const base = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  return {
    ...base,
    scripts: {
      ...base.scripts,
      typecheck: 'tsc -p tsconfig.gate.json',
      lint: 'biome lint --error-on-warnings src tests',
      'format:check': 'prettier --check src tests',
      'quality:g1': 'npm run lint && npm run typecheck && npm run format:check',
      'quality:l1': 'vitest run --config vitest.gate.config.ts --coverage',
      'quality:commit': 'node scripts/run-parallel.mjs',
    },
  };
}

function scratchOf(dir) {
  const scratch = join(dir, '.tmp');
  mkdirSync(scratch, { recursive: true });
  return scratch;
}

function resultOf(scratch, result) {
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    leftovers: existsSync(scratch) ? readdirSync(scratch) : ['missing'],
  };
}

function createFixture(repoRoot, owned, name, extra = {}) {
  const dir = join(owned, name);
  for (const part of ['src', 'tests', '.husky', 'scripts']) {
    mkdirSync(join(dir, part), { recursive: true });
  }

  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'l1-gate@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'l1-gate'], { cwd: dir });

  writeFileSync(join(dir, '.gitignore'), 'node_modules\ncoverage\n.tmp\n.cache\n');
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(buildFixturePackageJson(repoRoot), null, 2)}\n`,
  );
  writeFileSync(join(dir, 'bun.lock'), readFileSync(join(repoRoot, 'bun.lock'), 'utf8'));
  writeFileSync(
    join(dir, 'package-lock.json'),
    readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'),
  );
  writeFileSync(join(dir, 'vitest.gate.config.ts'), extra.vitest ?? gateVitest);
  writeFileSync(
    join(dir, 'tsconfig.gate.json'),
    JSON.stringify(extra.tsconfig ?? gateTsconfig, null, 2),
  );
  writeFileSync(join(dir, 'biome.json'), JSON.stringify(extra.biome ?? gateBiome, null, 2));
  writeFileSync(
    join(dir, '.husky/pre-commit'),
    readFileSync(join(repoRoot, '.husky/pre-commit'), 'utf8'),
  );
  chmodSync(join(dir, '.husky/pre-commit'), 0o755);
  writeFileSync(
    join(dir, 'scripts/run-parallel.mjs'),
    readFileSync(join(repoRoot, 'scripts/run-parallel.mjs'), 'utf8'),
  );

  writeFileSync(join(dir, 'src/gate-fixture.ts'), fixtureSource);
  writeFileSync(join(dir, 'tests/gate-fixture.test.ts'), extra.test ?? passingTest);
  if (extra.badLint) {
    writeFileSync(join(dir, 'src/gate-lint.ts'), extra.badLint);
  }
  if (extra.badTypes) {
    writeFileSync(join(dir, 'src/gate-types.ts'), extra.badTypes);
  }

  symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'));

  const paths = [
    '.gitignore',
    'package.json',
    'bun.lock',
    'package-lock.json',
    'vitest.gate.config.ts',
    'tsconfig.gate.json',
    'biome.json',
    'tests/gate-fixture.test.ts',
    'src/gate-fixture.ts',
    '.husky/pre-commit',
    'scripts/run-parallel.mjs',
  ].filter((p) => existsSync(join(dir, p)));

  if (extra.badLint) paths.push('src/gate-lint.ts');
  if (extra.badTypes) paths.push('src/gate-types.ts');

  execFileSync('git', ['add', '--', ...paths], { cwd: dir });

  if (extra.worktreeTest) {
    writeFileSync(join(dir, 'tests/gate-fixture.test.ts'), extra.worktreeTest);
  }

  return dir;
}

function runHook(dir, { env = {}, timeout } = {}) {
  const scratch = scratchOf(dir);
  return resultOf(
    scratch,
    spawnSync('sh', ['.husky/pre-commit'], {
      cwd: dir,
      env: { ...process.env, TMPDIR: scratch, ...env },
      encoding: 'utf8',
      timeout,
    }),
  );
}

export async function runL1GateProbes(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepo;
  const state = { failed: 0, silent: options.silent ?? false };
  const owned = mkdtempSync(join(tmpdir(), 'pokepocket-l1-gate-'));
  const indexBefore = execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  try {
    const healthyDir = createFixture(repoRoot, owned, 'healthy');
    const healthy = runHook(healthyDir);
    recordProbeCheck(state, 'healthy index snapshot exits 0', healthy.status === 0, healthy.output);
    recordProbeCheck(
      state,
      'healthy removes snapshot temp dir',
      snapshotGone(healthy.leftovers),
      healthy.leftovers.join(','),
    );

    const utDir = createFixture(repoRoot, owned, 'ut-fail', {
      test: failingTest,
      worktreeTest: passingTest,
    });
    const ut = runHook(utDir);
    recordProbeCheck(
      state,
      'staged unit test failure rejects',
      ut.status !== 0 && /AssertionError|expected false|FAIL/i.test(ut.output),
      ut.output,
    );
    recordProbeCheck(
      state,
      'UT probe leaves unstaged worktree fix',
      readFileSync(join(utDir, 'tests/gate-fixture.test.ts'), 'utf8') === passingTest,
    );
    recordProbeCheck(
      state,
      'UT probe keeps failing staged index',
      execFileSync('git', ['show', ':tests/gate-fixture.test.ts'], {
        cwd: utDir,
        encoding: 'utf8',
      }).includes('toBe(false)'),
    );

    const lintDir = createFixture(repoRoot, owned, 'lint-error', {
      badLint: `export function gateLint() {
  debugger;
}
`,
    });
    const lint = runHook(lintDir);
    recordProbeCheck(
      state,
      'biome lint error rejects',
      lint.status !== 0 && /noDebugger|lint/i.test(lint.output),
      lint.output,
    );

    const typesDir = createFixture(repoRoot, owned, 'type-error', {
      badTypes: `export const gateTypes: number = "not-a-number";
`,
    });
    const types = runHook(typesDir);
    recordProbeCheck(
      state,
      'staged type error rejects',
      types.status !== 0 && /error TS/i.test(types.output),
      types.output,
    );

    const gapBody = `export function gateGap() {
  if (Math.random() > 2) return 1;
  return 0;
}
`;
    const coverageVitest = gateVitest.replace(
      'include: ["src/gate-fixture.ts"]',
      'include: ["src/gate-fixture.ts", "src/gate-gap.ts"]',
    );
    const coverageDir = createFixture(repoRoot, owned, 'coverage-low', {
      vitest: coverageVitest,
    });
    writeFileSync(join(coverageDir, 'src/gate-gap.ts'), gapBody);
    execFileSync('git', ['add', '--', 'src/gate-gap.ts'], { cwd: coverageDir });
    const coverage = runHook(coverageDir);
    recordProbeCheck(
      state,
      'coverage below floor rejects',
      coverage.status !== 0 && /threshold|Coverage/i.test(coverage.output),
      coverage.output,
    );

    const rootIndex = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    recordProbeCheck(state, 'repository index untouched', rootIndex === indexBefore);
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }

  return state.failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failed = await runL1GateProbes();
  if (failed) process.exit(failed);
  console.log('L1 gate probes passed');
}
