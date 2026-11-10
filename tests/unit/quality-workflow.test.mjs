import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const BASE_CI_SHA = '1ea10ecab22b72512399485391603fe03a161016';
const QUALITY_PIN = /^nocoo\/base-ci\/\.github\/workflows\/quality\.yml@[a-f0-9]{40}$/;

describe('quality and ci workflows policy', () => {
  const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const ciYaml = load(readFileSync(ciPath, 'utf8'));
  const qualityJob = ciYaml.jobs.quality;

  it('does not restore the removed local quality.yml duplicate', () => {
    expect(existsSync(path.resolve(process.cwd(), '.github/workflows/quality.yml'))).toBe(false);
  });

  describe('ci.yml caller workflow', () => {
    it('has minimum read-only permissions and no deployment secrets', () => {
      expect(ciYaml.permissions).toEqual({ contents: 'read' });
      expect(qualityJob.secrets).toBeUndefined();
    });

    it('pins immutable shared quality.yml by full commit SHA', () => {
      expect(qualityJob.uses).toMatch(QUALITY_PIN);
      expect(qualityJob.uses).toContain(BASE_CI_SHA);
      expect(qualityJob.uses).not.toMatch(/@(main|master|latest|v\d)/);
    });

    it('does not pass Cloudflare secrets into CI', () => {
      const dump = JSON.stringify(ciYaml.jobs);
      expect(dump).not.toContain('CLOUDFLARE_API_TOKEN');
      expect(dump).not.toContain('CLOUDFLARE_ACCOUNT_ID');
      expect(dump).not.toContain('secrets: inherit');
    });

    it('triggers on push, pull_request, and workflow_dispatch', () => {
      expect(ciYaml.on.push?.branches).toContain('main');
      expect(ciYaml.on.pull_request?.branches).toContain('main');
      expect(ciYaml.on.workflow_dispatch).toBeDefined();
    });

    it('calls only quality.yml (no standalone test-job or workflow-lint jobs)', () => {
      expect(Object.keys(ciYaml.jobs)).toEqual(['quality']);
    });

    it('keeps required project quality commands on quality.yml', () => {
      expect(qualityJob.with['prepare-command']).toContain('npm run cf:typegen -- --check');
      expect(qualityJob.with['typecheck-command']).toBe('npm run typecheck');
      expect(qualityJob.with['lint-command']).toBe('npm run lint && npm run format:check');
      expect(qualityJob.with['test-command']).toBe('npm run quality:l1');
      expect(qualityJob.with.l2).toBe(true);
      expect(qualityJob.with['l2-command']).toContain('npm run test:http');
      expect(qualityJob.with['l2-command']).toContain('npm run quality:l2');
      expect(qualityJob.with['security-command']).toBe('npm run quality:g2');
      expect(qualityJob.with['coverage-path']).toBe('coverage');
      expect(qualityJob.with.build).toBe(true);
      expect(qualityJob.with['build-command']).toBe('npm run build');
    });

    it('enables S3 workflow lint and folds L3 into quality.yml', () => {
      expect(qualityJob.with['workflow-lint']).toBe(true);
      expect(qualityJob.with['workflow-lint-required-workflow']).toBe(
        'nocoo/base-ci/.github/workflows/deploy-worker.yml',
      );
      expect(qualityJob.with.l3).toBe(true);
      expect(qualityJob.with['l3-command']).toBe('npm run quality:l3');
      expect(qualityJob.with['l3-artifact-name']).toBe('browser-failure-artifacts');
      expect(qualityJob.with['l3-artifact-path']).toBe('test-results/');
    });

    it('declares strict slot-status for all v1 slots', () => {
      const slots = JSON.parse(qualityJob.with['slot-status']);
      expect(Object.keys(slots).sort()).toEqual(
        ['B1', 'G1', 'G2', 'L1', 'L1.5', 'L2', 'L3', 'P1', 'S1', 'S2', 'S3', 'Z1'].sort(),
      );
      expect(slots.L2.status).toBe('impl');
      expect(slots['L1.5'].status).toBe('na');
      expect(slots.P1.status).toBe('na');
    });
  });
});
