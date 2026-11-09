import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
import {
  buildFixturePackageJson,
  failingTest,
  passingTest,
  recordProbeCheck,
  snapshotGone,
} from '../l1-gate/verify-l1-gate.mjs';

describe('verify-l1-gate helpers', () => {
  it('snapshotGone ignores unrelated temp dirs', () => {
    expect(snapshotGone([])).toBe(true);
    expect(snapshotGone(['foo', 'bar'])).toBe(true);
    expect(snapshotGone(['pokepocket-index-abc123'])).toBe(false);
    expect(snapshotGone(['foo', 'pokepocket-index-x'])).toBe(false);
  });

  it('recordProbeCheck tracks failures and can log probe lines', () => {
    const silent = { failed: 0, silent: true };
    recordProbeCheck(silent, 'passes', true, 'detail');
    expect(silent.failed).toBe(0);
    recordProbeCheck(silent, 'fails', false, 'detail');
    expect(silent.failed).toBe(1);

    const loud = { failed: 0, silent: false };
    recordProbeCheck(loud, 'logged pass', true, '');
    recordProbeCheck(loud, 'logged pass with detail', true, 'short detail');
    recordProbeCheck(loud, 'logged fail', false, 'short detail');
    recordProbeCheck(loud, 'fail without detail suffix', false, '');
    recordProbeCheck(loud, 'fail whitespace detail', false, '   ');
    expect(loud.failed).toBe(1);
  });

  it('buildFixturePackageJson wires gate-specific scripts', () => {
    const pkg = buildFixturePackageJson(repoRoot);
    expect(pkg.scripts.typecheck).toBe('tsc -p tsconfig.gate.json');
    expect(pkg.scripts['quality:l1']).toContain('--coverage');
    expect(pkg.scripts['quality:commit']).toContain('run-parallel.mjs');
  });

  it('failingTest diverges from passingTest on the assertion', () => {
    expect(failingTest).toContain('toBe(false)');
    expect(passingTest).toContain('toBe(true)');
  });
});
