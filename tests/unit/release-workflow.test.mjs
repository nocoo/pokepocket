import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const SHARED_PIN = /^nocoo\/base-ci\/\.github\/workflows\/deploy-worker\.yml@[a-f0-9]{40}$/;
const SHA40 = /[a-f0-9]{40}/;

describe('release workflow definition and contract', () => {
  const releasePath = path.resolve(process.cwd(), '.github/workflows/release.yml');
  const releaseYaml = yaml.load(readFileSync(releasePath, 'utf8'));
  const deployJob = releaseYaml.jobs.deploy;

  it('triggers on tag push, CI workflow_run completed on main, and workflow_dispatch with tag input', () => {
    expect(releaseYaml.on.push?.tags).toContain('v*.*.*');
    expect(releaseYaml.on.workflow_run?.workflows).toContain('CI');
    expect(releaseYaml.on.workflow_run?.types).toContain('completed');
    expect(releaseYaml.on.workflow_run?.branches).toContain('main');
    expect(releaseYaml.on.workflow_dispatch?.inputs?.tag).toBeDefined();
    expect(releaseYaml.on.workflow_dispatch?.inputs?.tag?.required).toBe(true);
  });

  it('grants contents read and actions read for source-proof, nothing write', () => {
    expect(releaseYaml.permissions).toEqual({ contents: 'read', actions: 'read' });
  });

  it('does not keep the retired resolve -> quality -> deploy caller jobs', () => {
    expect(Object.keys(releaseYaml.jobs)).toEqual(['deploy']);
    expect(releaseYaml.jobs.resolve).toBeUndefined();
    expect(releaseYaml.jobs.quality).toBeUndefined();
  });

  it('pins immutable shared deploy-worker.yml by full commit SHA', () => {
    expect(deployJob.uses).toMatch(SHARED_PIN);
    expect(deployJob.uses).not.toMatch(/@(main|master|latest|v\d)/);
  });

  it('proves a successful CI run by path, name, and string run id', () => {
    expect(deployJob.with['expected-workflow-path']).toBe('.github/workflows/ci.yml');
    expect(deployJob.with['expected-workflow-name']).toBe('CI');
    expect(String(deployJob.with['source-run-id'])).toContain('github.event.workflow_run.id');
    expect(String(deployJob.with['source-run-id'])).toContain("format('{0}'");
  });

  it('keeps require-fresh-main fail-closed for continuous deploys', () => {
    expect(deployJob.with['require-fresh-main']).toBe(true);
  });

  it('serializes production deploys without cancelling in-progress runs', () => {
    expect(deployJob.with['concurrency-group']).toBe('deploy-pokepocket-production');
    expect(deployJob.with.environment).toBe('production');
  });

  it('passes production environment and wrangler secrets explicitly, never inherit', () => {
    expect(deployJob.secrets).toEqual({
      CLOUDFLARE_API_TOKEN: '${{ ' + 'secrets.CLOUDFLARE_API_TOKEN }}',
      CLOUDFLARE_ACCOUNT_ID: '${{ ' + 'secrets.CLOUDFLARE_ACCOUNT_ID }}',
    });
    expect(JSON.stringify(deployJob)).not.toContain('secrets: inherit');
  });

  it('skips failed CI workflow_run conclusions', () => {
    expect(deployJob.if).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('builds and verifies access before deploy, then verifies live release', () => {
    expect(deployJob.with['build-command']).toContain('bun run build');
    expect(deployJob.with['build-command']).toContain('bun run verify:access');
    expect(deployJob.with['verify-command']).toBe('bun run verify:release');
  });

  it('matches package version on tag deploys', () => {
    expect(String(deployJob.with['package-version-match'])).toContain(
      "github.event_name != 'workflow_run'",
    );
  });

  it('does not embed provider composite pins or recreate local quality.yml', () => {
    const text = readFileSync(releasePath, 'utf8');
    expect(text).not.toContain('./.github/workflows/quality.yml');
    expect(text).not.toContain('scripts/resolve-release.mjs');
    expect(SHA40.test(deployJob.uses.split('@')[1])).toBe(true);
  });
});
