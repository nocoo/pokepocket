import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const BASE_CI_SHA = '9933a7461a312cfaac526ccc5907357a7e3f669a';

describe('quality and pipeline workflows policy', () => {
  const pipelinePath = path.resolve(process.cwd(), '.github/workflows/pipeline.yml');
  const slotsPath = path.resolve(process.cwd(), '.github/workflows/quality-slots.yml');
  const pipelineYaml = load(readFileSync(pipelinePath, 'utf8'));
  const slotsYaml = load(readFileSync(slotsPath, 'utf8'));
  const qualityJob = pipelineYaml.jobs.quality;

  it('does not keep retired ci.yml, release.yml, or local quality.yml', () => {
    expect(existsSync(path.resolve(process.cwd(), '.github/workflows/ci.yml'))).toBe(false);
    expect(existsSync(path.resolve(process.cwd(), '.github/workflows/release.yml'))).toBe(false);
    expect(existsSync(path.resolve(process.cwd(), '.github/workflows/quality.yml'))).toBe(false);
  });

  describe('pipeline.yml quality caller job', () => {
    it('has minimum read-only permissions and no deployment secrets on quality', () => {
      expect(pipelineYaml.permissions).toEqual({ contents: 'read', actions: 'read' });
      expect(qualityJob.secrets).toBeUndefined();
    });

    it('calls local quality-slots.yml (Native Mode)', () => {
      expect(qualityJob.uses).toBe('./.github/workflows/quality-slots.yml');
    });

    it('does not pass secrets into quality job or use secrets: inherit', () => {
      const qualityDump = JSON.stringify(qualityJob);
      expect(qualityDump).not.toContain('CLOUDFLARE_API_TOKEN');
      expect(qualityDump).not.toContain('CLOUDFLARE_ACCOUNT_ID');
      expect(JSON.stringify(pipelineYaml.jobs)).not.toContain('secrets: inherit');
    });

    it('triggers on main push, pull_request, and workflow_dispatch deploy input without tags', () => {
      expect(pipelineYaml.on.push?.branches).toContain('main');
      expect(pipelineYaml.on.push?.tags).toBeUndefined();
      expect(pipelineYaml.on.pull_request).toBeDefined();
      expect(pipelineYaml.on.workflow_dispatch?.inputs?.deploy?.type).toBe('boolean');
    });

    it('defines quality and deploy jobs only', () => {
      expect(Object.keys(pipelineYaml.jobs)).toEqual(['quality', 'deploy']);
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
      expect(slotsText).toContain('npm run quality:l2');
      expect(slotsText).toContain('npm run test:http');
      expect(slotsText).toContain('npm run build');
      expect(slotsText).toContain('bun run test:e2e');
      expect(slotsText).toContain('wrangler deploy --dry-run -c dist/pokepocket/wrangler.json');

      expect(slotsYaml.jobs['l2-runtime'].needs).toEqual(['b1-build']);
      expect(slotsYaml.jobs['l4-e2e'].needs).toEqual(['b1-build']);
      expect(slotsYaml.jobs['p1-package'].needs).toEqual(['b1-build']);

      for (const [id, job] of Object.entries(slotsYaml.jobs)) {
        expect(job.outputs?.['tested-sha'], `${id} must emit tested-sha`).toBeDefined();
      }

      const gateStep = slotsYaml.jobs['z1-gate'].steps[0];
      expect(gateStep.uses).toContain(`nocoo/base-ci/.github/actions/z1-gate@${BASE_CI_SHA}`);
      expect(gateStep.with['required-jobs']).toContain('l2-runtime');
      expect(gateStep.with['required-jobs']).toContain('l4-e2e');
      expect(gateStep.with['required-jobs']).toContain('p1-package');
      expect(gateStep.with['skipped-jobs']).toBe('');
    });
  });
});
