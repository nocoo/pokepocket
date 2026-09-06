import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

describe('quality and ci workflows policy', () => {
  const ciPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
  const qualityPath = path.resolve(process.cwd(), '.github/workflows/quality.yml');

  const ciYaml = yaml.load(readFileSync(ciPath, 'utf8'));
  const qualityYaml = yaml.load(readFileSync(qualityPath, 'utf8'));

  describe('ci.yml caller workflow', () => {
    it('has minimum read-only permissions and no deployment secrets', () => {
      expect(ciYaml.permissions).toEqual({ contents: 'read' });
      expect(ciYaml.jobs.quality.secrets).toBeUndefined();
    });

    it('invokes reusable quality.yml with target-sha set to github.sha', () => {
      expect(ciYaml.jobs.quality.uses).toBe('./.github/workflows/quality.yml');
      expect(ciYaml.jobs.quality.with['target-sha']).toBe('${{ ' + 'github.sha }}');
    });

    it('triggers on push, pull_request, and workflow_dispatch', () => {
      expect(ciYaml.on.push?.branches).toContain('main');
      expect(ciYaml.on.pull_request?.branches).toContain('main');
      expect(ciYaml.on.workflow_dispatch).toBeDefined();
    });
  });

  describe('quality.yml reusable workflow', () => {
    it('defines workflow_call contract with target-sha input and tested-sha output', () => {
      const call = qualityYaml.on.workflow_call;
      expect(call).toBeDefined();
      expect(call?.inputs['target-sha']).toBeDefined();
      expect(call?.inputs['target-sha'].required).toBe(true);

      expect(call?.outputs).toBeDefined();
      expect(call?.outputs?.['tested-sha']).toBeDefined();
      expect(call?.outputs?.['tested-sha'].value).toBe(
        '${{ ' + 'jobs.aggregate.outputs.tested-sha }}',
      );
    });

    it('has minimum read-only permissions and no secrets', () => {
      expect(qualityYaml.permissions).toEqual({ contents: 'read' });
      for (const [, job] of Object.entries(qualityYaml.jobs)) {
        expect(job.secrets).toBeUndefined();
        expect(job.environment).toBeUndefined();
      }
    });

    it('has all four required quality jobs plus aggregate job', () => {
      const jobKeys = Object.keys(qualityYaml.jobs);
      expect(jobKeys).toContain('code_quality');
      expect(jobKeys).toContain('integration_quality');
      expect(jobKeys).toContain('security_quality');
      expect(jobKeys).toContain('browser_quality');
      expect(jobKeys).toContain('aggregate');
    });

    it('checks out target-sha in every job and obtains actual tested SHA', () => {
      for (const [jobName, job] of Object.entries(qualityYaml.jobs)) {
        const checkoutStep = job.steps?.find((s) => s.uses?.startsWith('actions/checkout'));
        expect(checkoutStep).toBeDefined();
        expect(checkoutStep?.with?.ref).toBe('${{ ' + 'inputs.target-sha }}');
        expect(checkoutStep?.with?.['persist-credentials']).toBe(false);

        if (jobName !== 'aggregate') {
          expect(job.outputs?.tested_sha).toBe('${{ ' + 'steps.sha-check.outputs.tested_sha }}');
          const shaStep = job.steps?.find((s) => s.id === 'sha-check');
          expect(shaStep).toBeDefined();
          expect(shaStep?.run).toContain('git rev-parse HEAD');
          expect(shaStep?.run).toContain('aggregate-quality.mjs');
        }
      }
    });

    it('security_quality fetches full history (fetch-depth: 0)', () => {
      const secJob = qualityYaml.jobs.security_quality;
      const checkout = secJob.steps?.find((s) => s.uses?.startsWith('actions/checkout'));
      expect(checkout?.with?.['fetch-depth']).toBe(0);
    });

    it('executes exact project-owned quality commands and checks', () => {
      const codeJob = qualityYaml.jobs.code_quality;
      const codeRuns = codeJob.steps?.map((s) => s.run).filter(Boolean) || [];
      expect(codeRuns.some((r) => r.includes('npm run cf:typegen -- --check'))).toBe(true);
      expect(codeRuns.some((r) => r.includes('npm run quality:g1'))).toBe(true);
      expect(codeRuns.some((r) => r.includes('npm run quality:l1'))).toBe(true);

      const intJob = qualityYaml.jobs.integration_quality;
      const intRuns = intJob.steps?.map((s) => s.run).filter(Boolean) || [];
      expect(intRuns.some((r) => r.includes('npm run test:http'))).toBe(true);
      expect(intRuns.some((r) => r.includes('npm run quality:l2'))).toBe(true);

      const secJob = qualityYaml.jobs.security_quality;
      const secRuns = secJob.steps?.map((s) => s.run).filter(Boolean) || [];
      expect(secRuns.some((r) => r.includes('node scripts/install-scanners.mjs'))).toBe(true);
      expect(secRuns.some((r) => r.includes('npm run quality:g2'))).toBe(true);

      const browJob = qualityYaml.jobs.browser_quality;
      const browRuns = browJob.steps?.map((s) => s.run).filter(Boolean) || [];
      expect(browRuns.some((r) => r.includes('npx playwright install --with-deps chromium'))).toBe(
        true,
      );
      expect(browRuns.some((r) => r.includes('npm run quality:l3'))).toBe(true);
    });

    it('uploads coverage report and browser failure artifacts with appropriate conditions', () => {
      const codeJob = qualityYaml.jobs.code_quality;
      const covArtifact = codeJob.steps?.find(
        (s) =>
          s.uses?.startsWith('actions/upload-artifact') && s.with?.name === 'code-coverage-report',
      );
      expect(covArtifact).toBeDefined();
      expect(covArtifact?.if).toBe('always()');
      expect(covArtifact?.with?.path).toBe('coverage/');

      const browJob = qualityYaml.jobs.browser_quality;
      const browArtifact = browJob.steps?.find(
        (s) =>
          s.uses?.startsWith('actions/upload-artifact') &&
          s.with?.name === 'browser-failure-artifacts',
      );
      expect(browArtifact).toBeDefined();
      expect(browArtifact?.if).toBe('failure()');
      expect(browArtifact?.with?.path).toBe('test-results/');
    });

    it('aggregate job runs with always(), depends on all four quality jobs, and validates outputs fail-closed', () => {
      const aggJob = qualityYaml.jobs.aggregate;
      expect(aggJob.if).toBe('always()');
      expect(aggJob.needs).toEqual([
        'code_quality',
        'integration_quality',
        'security_quality',
        'browser_quality',
      ]);
      expect(aggJob.outputs?.['tested-sha']).toBe(
        '${{ ' + 'steps.verify-aggregate.outputs.tested_sha }}',
      );

      const aggStep = aggJob.steps?.find((s) => s.id === 'verify-aggregate');
      expect(aggStep).toBeDefined();
      expect(aggStep?.run).toContain('aggregateQualityResults');
      expect(aggStep?.env?.EXPECTED_SHA).toBe('${{ ' + 'inputs.target-sha }}');
      expect(aggStep?.env?.CODE_QUALITY_RESULT).toBe('${{ ' + 'needs.code_quality.result }}');
      expect(aggStep?.env?.CODE_QUALITY_SHA).toBe(
        '${{ ' + 'needs.code_quality.outputs.tested_sha }}',
      );
      expect(aggStep?.env?.INTEGRATION_QUALITY_RESULT).toBe(
        '${{ ' + 'needs.integration_quality.result }}',
      );
      expect(aggStep?.env?.INTEGRATION_QUALITY_SHA).toBe(
        '${{ ' + 'needs.integration_quality.outputs.tested_sha }}',
      );
      expect(aggStep?.env?.SECURITY_QUALITY_RESULT).toBe(
        '${{ ' + 'needs.security_quality.result }}',
      );
      expect(aggStep?.env?.SECURITY_QUALITY_SHA).toBe(
        '${{ ' + 'needs.security_quality.outputs.tested_sha }}',
      );
      expect(aggStep?.env?.BROWSER_QUALITY_RESULT).toBe('${{ ' + 'needs.browser_quality.result }}');
      expect(aggStep?.env?.BROWSER_QUALITY_SHA).toBe(
        '${{ ' + 'needs.browser_quality.outputs.tested_sha }}',
      );
    });
  });
});
