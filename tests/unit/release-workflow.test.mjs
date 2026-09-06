import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

describe('release workflow definition and contract', () => {
  const releasePath = path.resolve(process.cwd(), '.github/workflows/release.yml');
  const releaseYaml = yaml.load(readFileSync(releasePath, 'utf8'));

  it('triggers on tag push, CI workflow_run completed on main, and workflow_dispatch with tag input', () => {
    expect(releaseYaml.on.push?.tags).toContain('v*.*.*');
    expect(releaseYaml.on.workflow_run?.workflows).toContain('CI');
    expect(releaseYaml.on.workflow_run?.types).toContain('completed');
    expect(releaseYaml.on.workflow_run?.branches).toContain('main');

    expect(releaseYaml.on.workflow_dispatch?.inputs?.tag).toBeDefined();
    expect(releaseYaml.on.workflow_dispatch?.inputs?.tag?.required).toBe(true);
  });

  it('has minimal top-level permissions: contents: read', () => {
    expect(releaseYaml.permissions).toEqual({ contents: 'read' });
  });

  it('enforces serial production deployment concurrency with no cancellation', () => {
    expect(releaseYaml.concurrency?.group).toBe('deploy-pokepocket-production');
    expect(releaseYaml.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('structures jobs into resolve -> quality -> deploy stages', () => {
    const jobKeys = Object.keys(releaseYaml.jobs);
    expect(jobKeys).toEqual(['resolve', 'quality', 'deploy']);
  });

  describe('resolve job', () => {
    const resolveJob = releaseYaml.jobs.resolve;

    it('has no deployment environment and no Cloudflare secrets', () => {
      expect(resolveJob.environment).toBeUndefined();
      expect(resolveJob.secrets).toBeUndefined();
    });

    it('outputs target-sha, version, and event-type', () => {
      expect(resolveJob.outputs['target-sha']).toBe('${{ ' + 'steps.resolve.outputs.target_sha }}');
      expect(resolveJob.outputs.version).toBe('${{ ' + 'steps.resolve.outputs.version }}');
      expect(resolveJob.outputs['event-type']).toBe('${{ ' + 'steps.resolve.outputs.event_type }}');
    });

    it('passes required context to resolver via env, never shell interpolation', () => {
      const step = resolveJob.steps.find((s) => s.id === 'resolve');
      expect(step).toBeDefined();
      expect(step.run).toBe('node scripts/resolve-release.mjs');
      expect(step.env.EVENT_PATH).toBe('${{ ' + 'github.event_path }}');
      expect(step.env.EVENT_NAME).toBe('${{ ' + 'github.event_name }}');
      expect(step.env.GITHUB_REPOSITORY).toBe('${{ ' + 'github.repository }}');
      expect(step.env.INPUT_TAG).toBe('${{ ' + 'inputs.tag }}');
    });
  });

  describe('quality job', () => {
    const qualityJob = releaseYaml.jobs.quality;

    it('depends on resolve job and invokes reusable quality workflow with resolved target-sha', () => {
      expect(qualityJob.needs).toContain('resolve');
      expect(qualityJob.uses).toBe('./.github/workflows/quality.yml');
      expect(qualityJob.with['target-sha']).toBe('${{ ' + 'needs.resolve.outputs.target-sha }}');
    });

    it('has no deployment environment and no Cloudflare secrets', () => {
      expect(qualityJob.environment).toBeUndefined();
      expect(qualityJob.secrets).toBeUndefined();
    });
  });

  describe('deploy job', () => {
    const deployJob = releaseYaml.jobs.deploy;

    it('depends on both resolve and quality jobs', () => {
      expect(deployJob.needs).toEqual(['resolve', 'quality']);
    });

    it('is strictly scoped to production environment', () => {
      expect(deployJob.environment).toBe('production');
    });

    it('checks out tested-sha output from quality workflow with full history', () => {
      const checkoutStep = deployJob.steps.find((s) => s.uses?.startsWith('actions/checkout'));
      expect(checkoutStep).toBeDefined();
      expect(checkoutStep.with.ref).toBe('${{ ' + 'needs.quality.outputs.tested-sha }}');
      expect(checkoutStep.with['fetch-depth']).toBe(0);
      expect(checkoutStep.with['persist-credentials']).toBe(false);
    });

    it('fetches remote main before deploy freshness check for workflow_run releases', () => {
      const fetchStep = deployJob.steps.find((s) => s.run?.includes('git fetch origin main'));
      expect(fetchStep).toBeDefined();
      expect(fetchStep.if).toBe("github.event_name == 'workflow_run'");
    });

    it('verifies deploy target freshness and SHA consistency fail-closed before build/deploy', () => {
      const verifyStep = deployJob.steps.find((s) => s.run?.includes('scripts/verify-deploy.mjs'));
      expect(verifyStep).toBeDefined();
      expect(verifyStep.env.EVENT_NAME).toBe('${{ ' + 'github.event_name }}');
      expect(verifyStep.env.EXPECTED_SHA).toBe('${{ ' + 'needs.quality.outputs.tested-sha }}');
      expect(verifyStep.env.RESOLVED_SHA).toBe('${{ ' + 'needs.resolve.outputs.target-sha }}');
      expect(verifyStep.env.EXPECTED_VERSION).toBe('${{ ' + 'needs.resolve.outputs.version }}');
    });

    it('runs build and pre/post Access verification steps around deploy', () => {
      const runs = deployJob.steps.map((s) => s.run).filter(Boolean);
      expect(runs.some((r) => r.includes('bun run build'))).toBe(true);
      expect(runs.some((r) => r.includes('bun run verify:access'))).toBe(true);
      expect(runs.some((r) => r.includes('bun run verify:release'))).toBe(true);

      const deployStep = deployJob.steps.find((s) =>
        s.uses?.startsWith('cloudflare/wrangler-action'),
      );
      expect(deployStep).toBeDefined();
      expect(deployStep.with.apiToken).toBe('${{ ' + 'secrets.CLOUDFLARE_API_TOKEN }}');
      expect(deployStep.with.accountId).toBe('${{ ' + 'secrets.CLOUDFLARE_ACCOUNT_ID }}');
    });
  });
});
