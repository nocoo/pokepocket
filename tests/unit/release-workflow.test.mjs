import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const BASE_CI_SHA = '3703a073693d598159e87f77f99587e586c14cfe';
const SHARED_PIN = /^nocoo\/base-ci\/\.github\/workflows\/deploy-worker\.yml@[a-f0-9]{40}$/;
const SHA40 = /[a-f0-9]{40}/;

describe('pipeline deploy workflow definition and contract', () => {
  const pipelinePath = path.resolve(process.cwd(), '.github/workflows/pipeline.yml');
  const pipelineYaml = load(readFileSync(pipelinePath, 'utf8'));
  const deployJob = pipelineYaml.jobs.deploy;

  it('grants contents read and actions read, nothing write', () => {
    expect(pipelineYaml.permissions).toEqual({ contents: 'read', actions: 'read' });
  });

  it('pins immutable shared deploy-worker.yml by full commit SHA', () => {
    expect(deployJob.uses).toMatch(SHARED_PIN);
    expect(deployJob.uses).toContain(BASE_CI_SHA);
    expect(deployJob.uses).not.toMatch(/@(main|master|latest|v\d)/);
  });

  it('gates deploy behind quality on main push or explicit dispatch', () => {
    expect(deployJob.needs).toEqual(['quality']);
    expect(deployJob.if).toContain("github.ref == 'refs/heads/main'");
    expect(deployJob.if).toContain('inputs.deploy == true');
  });

  it('reuses the same-run B1 artifact with zero rebuild', () => {
    expect(deployJob.with['artifact-name']).toBe('dist-$' + '{{ github.sha }}');
    expect(deployJob.with['artifact-path']).toBe('dist');
    expect(deployJob.with['wrangler-config']).toBe('dist/pokepocket/wrangler.json');
    expect(deployJob.with['build-command']).toBeUndefined();
  });

  it('serializes production deploys without cancelling in-progress runs', () => {
    expect(deployJob.with['concurrency-group']).toBe('deploy-pokepocket-production');
    expect(deployJob.with.environment).toBe('production');
  });

  it('passes production environment and wrangler secrets explicitly, never inherit', () => {
    expect(deployJob.secrets).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ ' + 'secrets.CLOUDFLARE_API_TOKEN }}',
    });
    expect(JSON.stringify(deployJob)).not.toContain('secrets: inherit');
  });

  it('verifies live release and access boundaries', () => {
    expect(deployJob.with['verify-command']).toBe('bun run verify:release');
  });

  it('does not embed provider composite pins or recreate local quality.yml', () => {
    const text = readFileSync(pipelinePath, 'utf8');
    expect(text).not.toContain('./.github/workflows/quality.yml');
    expect(text).not.toContain('scripts/resolve-release.mjs');
    expect(SHA40.test(deployJob.uses.split('@')[1])).toBe(true);
  });
});
