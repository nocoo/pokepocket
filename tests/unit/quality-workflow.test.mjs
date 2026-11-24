import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const BASE_CI_SHA = '6424d395d36a815d931f10e557762eb635d511c0';

describe('quality and ci workflows policy', () => {
  const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const slotsPath = path.resolve(process.cwd(), '.github/workflows/quality-slots.yml');
  const ciYaml = load(readFileSync(ciPath, 'utf8'));
  const slotsYaml = load(readFileSync(slotsPath, 'utf8'));
  const qualityJob = ciYaml.jobs.quality;

  it('does not restore the removed local quality.yml duplicate', () => {
    expect(existsSync(path.resolve(process.cwd(), '.github/workflows/quality.yml'))).toBe(false);
  });

  describe('ci.yml caller workflow', () => {
    it('has minimum read-only permissions and no deployment secrets', () => {
      expect(ciYaml.permissions).toEqual({ contents: 'read', actions: 'read' });
      expect(qualityJob.secrets).toBeUndefined();
    });

    it('calls local quality-slots.yml (Native Mode)', () => {
      expect(qualityJob.uses).toBe('./.github/workflows/quality-slots.yml');
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

    it('calls only quality-slots.yml (no standalone test-job or workflow-lint jobs)', () => {
      expect(Object.keys(ciYaml.jobs)).toEqual(['quality']);
    });

    it('defines all v1.3.0 quality slots with pinned base-ci actions', () => {
      const slotsText = readFileSync(slotsPath, 'utf8');
      expect(slotsText).toContain(BASE_CI_SHA);
      expect(Object.keys(slotsYaml.jobs)).toEqual([
        's1-types',
        's2-lint',
        's3-workflow',
        'g1-secrets',
        'g2-dependencies',
        'b1-build',
        'l1-unit',
        'l2-runtime',
        'l3-integration',
        'l4-e2e',
        'p1-package',
        'z1-gate',
      ]);
      expect(slotsText).toContain('npm run cf:typegen -- --check');
      expect(slotsText).toContain('npm run typecheck');
      expect(slotsText).toContain('npm run lint');
      expect(slotsText).toContain('npm run quality:l1');
      expect(slotsText).toContain('npm run test:http && npm run quality:l2');
      expect(slotsText).toContain('npm run build');
    });
  });
});
