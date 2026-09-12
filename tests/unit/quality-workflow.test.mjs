import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const SHARED_PIN = /^nocoo\/base-ci\/\.github\/workflows\/quality\.yml@[a-f0-9]{40}$/;

describe('quality and ci workflows policy', () => {
  const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const ciYaml = yaml.load(readFileSync(ciPath, 'utf8'));
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
      expect(qualityJob.uses).toMatch(SHARED_PIN);
      expect(qualityJob.uses).not.toMatch(/@(main|master|latest|v\d)/);
    });

    it('does not pass Cloudflare secrets into CI', () => {
      const dump = JSON.stringify(qualityJob);
      expect(dump).not.toContain('CLOUDFLARE_API_TOKEN');
      expect(dump).not.toContain('CLOUDFLARE_ACCOUNT_ID');
      expect(dump).not.toContain('secrets: inherit');
    });

    it('triggers on push, pull_request, and workflow_dispatch', () => {
      expect(ciYaml.on.push?.branches).toContain('main');
      expect(ciYaml.on.pull_request?.branches).toContain('main');
      expect(ciYaml.on.workflow_dispatch).toBeDefined();
    });

    it('keeps required project quality commands and gates', () => {
      expect(qualityJob.with['prepare-command']).toContain('npm run cf:typegen -- --check');
      expect(qualityJob.with['typecheck-command']).toBe('npm run quality:g1');
      expect(qualityJob.with['test-command']).toBe('npm run quality:l1');
      expect(qualityJob.with.l2).toBe(true);
      expect(qualityJob.with['l2-command']).toContain('npm run test:http');
      expect(qualityJob.with['l2-command']).toContain('npm run quality:l2');
      expect(qualityJob.with.l3).toBe(true);
      expect(qualityJob.with['l3-command']).toBe('npm run quality:l3');
      expect(qualityJob.with['l3-browser']).toBe('chromium');
      expect(qualityJob.with['security-command']).toBe('npm run quality:g2');
      expect(qualityJob.with['coverage-path']).toBe('coverage');
    });

    it('disables duplicate lint only with an explicit reason, not a fake-green command', () => {
      expect(qualityJob.with.lint).toBe(false);
      const reasons = JSON.parse(qualityJob.with['disabled-check-reasons']);
      expect(reasons.lint).toMatch(/quality:g1/);
    });
  });
});
