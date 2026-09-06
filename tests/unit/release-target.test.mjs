import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkFreshnessAgainstMain,
  isValidSha,
  isValidVersion,
  isValidVersionTag,
  peelCommitSha,
  readPackageJsonAtCommit,
  resolveDispatchRelease,
  resolveReleaseTarget,
  resolveTagPushRelease,
  resolveWorkflowRunRelease,
  runGit,
  verifyDeployTarget,
} from '../../scripts/release-target.mjs';
import { runResolveReleaseCli } from '../../scripts/resolve-release.mjs';
import { runVerifyDeployCli } from '../../scripts/verify-deploy.mjs';

function execGit(repoDir, args) {
  const res = spawnSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr?.trim()}`);
  }
  return res.stdout.trim();
}

describe('release-target policy and git mechanics', () => {
  let tempRepo;

  beforeEach(() => {
    tempRepo = mkdtempSync(path.join(tmpdir(), 'pokepocket-release-test-'));
    execGit(tempRepo, ['init', '-b', 'main']);
    execGit(tempRepo, ['config', 'user.name', 'Pokepocket Test']);
    execGit(tempRepo, ['config', 'user.email', 'test@example.com']);
  });

  afterEach(() => {
    if (tempRepo) {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  function createCommit(repoDir, version, commitMsg = 'test commit') {
    writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'pokepocket', version }, null, 2),
    );
    execGit(repoDir, ['add', 'package.json']);
    execGit(repoDir, ['commit', '-m', commitMsg]);
    return execGit(repoDir, ['rev-parse', 'HEAD']);
  }

  describe('runGit and git mechanics', () => {
    it('executes git command and trims output', () => {
      const out = runGit(['status'], tempRepo);
      expect(out).toContain('On branch main');
    });

    it('throws error when git command fails', () => {
      expect(() => runGit(['log'], tempRepo)).toThrow(/git log failed/);
    });
  });

  describe('peelCommitSha and git helpers', () => {
    it('peels lightweight tag, annotated tag, and direct commit SHA', () => {
      const commitSha = createCommit(tempRepo, '1.2.0', 'initial commit');

      // Direct commit
      expect(peelCommitSha(commitSha, tempRepo)).toBe(commitSha.toLowerCase());

      // Lightweight tag
      execGit(tempRepo, ['tag', 'v1.2.0-light']);
      expect(peelCommitSha('v1.2.0-light', tempRepo)).toBe(commitSha.toLowerCase());

      // Annotated tag
      execGit(tempRepo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
      const tagObjSha = execGit(tempRepo, ['rev-parse', 'v1.2.0']);
      expect(tagObjSha).not.toBe(commitSha);
      expect(peelCommitSha('v1.2.0', tempRepo)).toBe(commitSha.toLowerCase());
      expect(peelCommitSha(tagObjSha, tempRepo)).toBe(commitSha.toLowerCase());
    });

    it('rejects unavailable tag object when peeled commit cannot be resolved', () => {
      expect(() => peelCommitSha('nonexistent-ref', tempRepo)).toThrow(/git rev-parse --verify/);
    });

    it('rejects invalid or all-zero SHAs', () => {
      expect(isValidSha('')).toBe(false);
      expect(isValidSha('not-a-sha')).toBe(false);
      expect(isValidSha('0000000000000000000000000000000000000000')).toBe(false);
      expect(isValidSha('1234567890abcdef1234567890abcdef12345678')).toBe(true);
    });

    it('validates semver tags format vMAJOR.MINOR.PATCH', () => {
      expect(isValidVersionTag('v1.2.0')).toBe(true);
      expect(isValidVersionTag('v0.0.1')).toBe(true);
      expect(isValidVersionTag('1.2.0')).toBe(false);
      expect(isValidVersionTag('v1.2')).toBe(false);
      expect(isValidVersionTag('v1.2.0-beta')).toBe(false);
      expect(isValidVersionTag('refs/tags/v1.2.0')).toBe(false);
    });

    it('validates semver version format MAJOR.MINOR.PATCH', () => {
      expect(isValidVersion('1.2.0')).toBe(true);
      expect(isValidVersion('0.0.1')).toBe(true);
      expect(isValidVersion('v1.2.0')).toBe(false);
      expect(isValidVersion('1.2')).toBe(false);
      expect(isValidVersion('')).toBe(false);
      expect(isValidVersion(null)).toBe(false);
    });

    it('reads package.json at historical commit even if working directory differs', () => {
      const commit1 = createCommit(tempRepo, '1.0.0', 'version 1');
      createCommit(tempRepo, '2.0.0', 'version 2');

      const pkg1 = readPackageJsonAtCommit(commit1, tempRepo);
      expect(pkg1.version).toBe('1.0.0');
    });

    it('rejects invalid commit SHA in readPackageJsonAtCommit', () => {
      expect(() => readPackageJsonAtCommit('bad-sha', tempRepo)).toThrow(/Invalid commit SHA/);
    });

    it('rejects malformed package.json at commit', () => {
      writeFileSync(path.join(tempRepo, 'package.json'), 'not-json');
      execGit(tempRepo, ['add', 'package.json']);
      execGit(tempRepo, ['commit', '-m', 'bad json']);
      const sha = execGit(tempRepo, ['rev-parse', 'HEAD']);
      expect(() => readPackageJsonAtCommit(sha, tempRepo)).toThrow(/Failed to parse package\.json/);
    });

    it('rejects non-string or invalid refs in peelCommitSha', () => {
      expect(() => peelCommitSha(null, tempRepo)).toThrow(/Invalid reference or object/);
      expect(() => peelCommitSha('', tempRepo)).toThrow(/Invalid reference or object/);
    });
  });

  describe('resolveTagPushRelease', () => {
    it('resolves annotated tag push even after tag ref moves', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      execGit(tempRepo, ['tag', '-a', 'v1.2.0', '-m', 'annotated tag']);
      const tagObjSha = execGit(tempRepo, ['rev-parse', 'v1.2.0']);

      // Move the tag ref in git to commit B
      createCommit(tempRepo, '1.3.0', 'commit B');
      execGit(tempRepo, ['tag', '-f', '-a', 'v1.2.0', '-m', 'moved tag']);

      // The push payload captures the original event SHA (tagObjSha)
      const payload = {
        ref: 'refs/tags/v1.2.0',
        after: tagObjSha,
        deleted: false,
      };

      const resolved = resolveTagPushRelease(payload, tempRepo);
      expect(resolved.eventType).toBe('push');
      expect(resolved.targetSha).toBe(commitA.toLowerCase());
      expect(resolved.version).toBe('1.2.0');
      expect(resolved.tag).toBe('v1.2.0');
    });

    it('resolves lightweight tag push using after SHA', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = {
        ref: 'refs/tags/v1.2.0',
        after: commitA,
        deleted: false,
      };

      const resolved = resolveTagPushRelease(payload, tempRepo);
      expect(resolved.targetSha).toBe(commitA.toLowerCase());
      expect(resolved.version).toBe('1.2.0');
    });

    it('strictly requires payload.after and rejects head_commit fallback', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = {
        ref: 'refs/tags/v1.2.0',
        head_commit: { id: commitA },
        deleted: false,
      };

      expect(() => resolveTagPushRelease(payload, tempRepo)).toThrow(
        /Tag push event object SHA is missing or invalid in payload\.after/,
      );
    });

    it('rejects missing payload or invalid ref', () => {
      expect(() => resolveTagPushRelease(null, tempRepo)).toThrow(/Missing push payload/);
      expect(() => resolveTagPushRelease({}, tempRepo)).toThrow(/Invalid ref for tag push/);
      expect(() => resolveTagPushRelease({ ref: 'refs/heads/main' }, tempRepo)).toThrow(
        /Invalid ref for tag push/,
      );
    });

    it('rejects tag deletion events', () => {
      const payload = {
        ref: 'refs/tags/v1.2.0',
        after: '0000000000000000000000000000000000000000',
        deleted: true,
      };
      expect(() => resolveTagPushRelease(payload, tempRepo)).toThrow(/Rejected tag deletion event/);
    });

    it('rejects all-zero after SHA', () => {
      const payload = {
        ref: 'refs/tags/v1.2.0',
        after: '0000000000000000000000000000000000000000',
        deleted: false,
      };
      expect(() => resolveTagPushRelease(payload, tempRepo)).toThrow(
        /Tag push event object SHA is missing or invalid in payload\.after/,
      );
    });

    it('rejects invalid tag name format', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = {
        ref: 'refs/tags/not-semver',
        after: commitA,
        deleted: false,
      };
      expect(() => resolveTagPushRelease(payload, tempRepo)).toThrow(
        /must match vMAJOR.MINOR.PATCH/,
      );
    });

    it('rejects tag push when package.json version is invalid semver', () => {
      const commitA = createCommit(tempRepo, '1.2.0-beta', 'commit A');
      const payload = {
        ref: 'refs/tags/v1.2.0',
        after: commitA,
        deleted: false,
      };
      expect(() => resolveTagPushRelease(payload, tempRepo)).toThrow(
        /missing a valid semver version/,
      );
    });

    it('rejects tag push when package.json version does not match tag', () => {
      const commitA = createCommit(tempRepo, '1.1.0', 'commit A');
      const payload = {
        ref: 'refs/tags/v1.2.0',
        after: commitA,
        deleted: false,
      };
      expect(() => resolveTagPushRelease(payload, tempRepo)).toThrow(
        /Tag v1.2.0 does not match package\.json version 1\.1\.0/,
      );
    });
  });

  describe('resolveDispatchRelease', () => {
    it('resolves valid tag reference and validates package version', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      execGit(tempRepo, ['tag', '-a', 'v1.2.0', '-m', 'v1.2.0']);

      const resolved = resolveDispatchRelease('v1.2.0', tempRepo);
      expect(resolved.eventType).toBe('workflow_dispatch');
      expect(resolved.targetSha).toBe(commitA.toLowerCase());
      expect(resolved.version).toBe('1.2.0');
    });

    it('rejects branch of same name attempting to substitute for tag', () => {
      const commitBranch = createCommit(tempRepo, '1.2.0', 'branch commit');
      // Create a branch named v1.2.0 without a tag
      execGit(tempRepo, ['branch', 'v1.2.0', commitBranch]);

      // Should fail because refs/tags/v1.2.0 does not exist
      expect(() => resolveDispatchRelease('v1.2.0', tempRepo)).toThrow(/git rev-parse/);
    });

    it('rejects invalid tag input', () => {
      expect(() => resolveDispatchRelease('', tempRepo)).toThrow(/Missing or empty tag input/);
      expect(() => resolveDispatchRelease(null, tempRepo)).toThrow(/Missing or empty tag input/);
      expect(() => resolveDispatchRelease('1.2.0', tempRepo)).toThrow(
        /must match vMAJOR.MINOR.PATCH/,
      );
      expect(() => resolveDispatchRelease('v1.2.0-beta', tempRepo)).toThrow(
        /must match vMAJOR.MINOR.PATCH/,
      );
    });

    it('rejects dispatch tag when package version is invalid semver', () => {
      createCommit(tempRepo, 'invalid-semver', 'commit A');
      execGit(tempRepo, ['tag', 'v1.2.0']);

      expect(() => resolveDispatchRelease('v1.2.0', tempRepo)).toThrow(
        /missing a valid semver version/,
      );
    });

    it('rejects dispatch tag when package version does not match', () => {
      createCommit(tempRepo, '1.1.0', 'commit A');
      execGit(tempRepo, ['tag', 'v1.2.0']);

      expect(() => resolveDispatchRelease('v1.2.0', tempRepo)).toThrow(
        /Tag v1.2.0 does not match package\.json version 1\.1\.0/,
      );
    });
  });

  describe('resolveWorkflowRunRelease', () => {
    const validRepo = 'nocoo/pokepocket';

    function createValidPayload(headSha, overrides = {}) {
      return {
        workflow: {
          id: 42,
          name: 'CI',
          path: '.github/workflows/ci.yml',
        },
        workflow_run: {
          id: 100,
          workflow_id: 42,
          name: 'CI',
          path: '.github/workflows/ci.yml',
          event: 'push',
          head_branch: 'main',
          head_repository: {
            full_name: validRepo,
          },
          conclusion: 'success',
          head_sha: headSha,
          ...overrides,
        },
      };
    }

    it('resolves successful main push CI workflow_run', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload(commitA);

      const resolved = resolveWorkflowRunRelease(payload, validRepo, tempRepo);
      expect(resolved.eventType).toBe('workflow_run');
      expect(resolved.targetSha).toBe(commitA.toLowerCase());
      expect(resolved.version).toBe('1.2.0');
    });

    it('rejects missing expectedRepo parameter', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload(commitA);
      expect(() => resolveWorkflowRunRelease(payload, '', tempRepo)).toThrow(
        /Expected repository is required/,
      );
      expect(() => resolveWorkflowRunRelease(payload, null, tempRepo)).toThrow(
        /Expected repository is required/,
      );
    });

    it('rejects missing payload or missing workflow_run or top-level workflow', () => {
      expect(() => resolveWorkflowRunRelease(null, validRepo, tempRepo)).toThrow(
        /Missing workflow_run payload/,
      );
      expect(() => resolveWorkflowRunRelease({}, validRepo, tempRepo)).toThrow(
        /Top-level workflow object is missing/,
      );
      expect(() => resolveWorkflowRunRelease({ workflow: {} }, validRepo, tempRepo)).toThrow(
        /workflow_run object is missing/,
      );
    });

    it('rejects missing top-level workflow fields', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const p1 = createValidPayload(commitA);
      delete p1.workflow.id;
      expect(() => resolveWorkflowRunRelease(p1, validRepo, tempRepo)).toThrow(
        /Top-level workflow\.id is missing/,
      );

      const p2 = createValidPayload(commitA);
      delete p2.workflow.name;
      expect(() => resolveWorkflowRunRelease(p2, validRepo, tempRepo)).toThrow(
        /Top-level workflow\.name is missing/,
      );

      const p3 = createValidPayload(commitA);
      delete p3.workflow.path;
      expect(() => resolveWorkflowRunRelease(p3, validRepo, tempRepo)).toThrow(
        /Top-level workflow\.path is missing/,
      );
    });

    it('rejects missing workflow_run identity fields', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const p1 = createValidPayload(commitA);
      delete p1.workflow_run.workflow_id;
      expect(() => resolveWorkflowRunRelease(p1, validRepo, tempRepo)).toThrow(
        /workflow_run\.workflow_id is missing/,
      );

      const p2 = createValidPayload(commitA);
      delete p2.workflow_run.name;
      expect(() => resolveWorkflowRunRelease(p2, validRepo, tempRepo)).toThrow(
        /workflow_run\.name is missing/,
      );

      const p3 = createValidPayload(commitA);
      delete p3.workflow_run.path;
      expect(() => resolveWorkflowRunRelease(p3, validRepo, tempRepo)).toThrow(
        /workflow_run\.path is missing/,
      );
    });

    it('rejects prefixed or different workflow paths', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');

      // Top-level path prefixed (e.g. other/.github/workflows/ci.yml)
      const p1 = createValidPayload(commitA);
      p1.workflow.path = 'other/.github/workflows/ci.yml';
      expect(() => resolveWorkflowRunRelease(p1, validRepo, tempRepo)).toThrow(
        /Top-level workflow\.path "other\/\.github\/workflows\/ci\.yml" does not match expected "\.github\/workflows\/ci\.yml"/,
      );

      // workflow_run path prefixed
      const p2 = createValidPayload(commitA);
      p2.workflow_run.path = 'subfolder/.github/workflows/ci.yml';
      expect(() => resolveWorkflowRunRelease(p2, validRepo, tempRepo)).toThrow(
        /workflow_run\.path "subfolder\/\.github\/workflows\/ci\.yml" does not match expected "\.github\/workflows\/ci\.yml"/,
      );
    });

    it('rejects foreign repository workflow_run', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload(commitA, {
        head_repository: { full_name: 'attacker/pokepocket' },
      });
      expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
        /Rejected workflow_run repository/,
      );
    });

    it('rejects non-main branch workflow_run', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload(commitA, { head_branch: 'feature-x' });
      expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
        /only "main" branch triggers release/,
      );
    });

    it('rejects non-push event (e.g. pull_request or workflow_dispatch CI run)', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload(commitA, { event: 'pull_request' });
      expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
        /only "push" events trigger release/,
      );
    });

    it('rejects non-success conclusions (failure, cancelled, skipped)', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      for (const conc of ['failure', 'cancelled', 'skipped']) {
        const payload = createValidPayload(commitA, { conclusion: conc });
        expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
          new RegExp(`Rejected workflow_run conclusion "${conc}"`),
        );
      }
    });

    it('rejects invalid or missing head_sha', () => {
      createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload('bad-sha');
      expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
        /Invalid or missing workflow_run\.head_sha/,
      );
    });

    it('rejects package.json missing semver version at commit', () => {
      writeFileSync(path.join(tempRepo, 'package.json'), JSON.stringify({ name: 'pokepocket' }));
      execGit(tempRepo, ['add', 'package.json']);
      execGit(tempRepo, ['commit', '-m', 'no version']);
      const sha = execGit(tempRepo, ['rev-parse', 'HEAD']);
      const payload = createValidPayload(sha);
      expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
        /missing a valid semver version/,
      );
    });

    it('rejects different workflow name', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const badTopName = createValidPayload(commitA);
      badTopName.workflow.name = 'Other CI';
      expect(() => resolveWorkflowRunRelease(badTopName, validRepo, tempRepo)).toThrow(
        /Top-level workflow\.name "Other CI" does not match/,
      );

      const badName = createValidPayload(commitA, { name: 'Other Workflow' });
      expect(() => resolveWorkflowRunRelease(badName, validRepo, tempRepo)).toThrow(
        /workflow_run\.name "Other Workflow" does not match expected "CI"/,
      );
    });

    it('rejects mismatched top-level workflow and workflow_run IDs', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payload = createValidPayload(commitA);
      payload.workflow.id = 999;
      payload.workflow_run.workflow_id = 111;
      expect(() => resolveWorkflowRunRelease(payload, validRepo, tempRepo)).toThrow(
        /workflow_id mismatch/,
      );
    });
  });

  describe('resolveReleaseTarget general helper', () => {
    it('dispatches to correct event resolver', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      execGit(tempRepo, ['tag', 'v1.2.0']);

      const res = resolveReleaseTarget({
        eventName: 'workflow_dispatch',
        inputTag: 'v1.2.0',
        cwd: tempRepo,
      });
      expect(res.targetSha).toBe(commitA.toLowerCase());
    });

    it('reads payload from eventPath file', () => {
      const commitA = createCommit(tempRepo, '1.2.0', 'commit A');
      const payloadPath = path.join(tempRepo, 'event.json');
      writeFileSync(
        payloadPath,
        JSON.stringify({
          ref: 'refs/tags/v1.2.0',
          after: commitA,
          deleted: false,
        }),
      );

      const res = resolveReleaseTarget({
        eventName: 'push',
        eventPath: payloadPath,
        cwd: tempRepo,
      });
      expect(res.targetSha).toBe(commitA.toLowerCase());
    });

    it('rejects unreadable or invalid eventPath file', () => {
      expect(() =>
        resolveReleaseTarget({
          eventName: 'push',
          eventPath: path.join(tempRepo, 'nonexistent.json'),
          cwd: tempRepo,
        }),
      ).toThrow(/Failed to read event payload/);
    });

    it('rejects unsupported event', () => {
      expect(() =>
        resolveReleaseTarget({
          eventName: 'schedule',
          cwd: tempRepo,
        }),
      ).toThrow(/Unsupported release event name/);
    });
  });

  describe('automatic release ordering & freshness check against remote main', () => {
    let remoteRepo;

    beforeEach(() => {
      remoteRepo = mkdtempSync(path.join(tmpdir(), 'pokepocket-remote-test-'));
      execGit(remoteRepo, ['init', '-b', 'main']);
      execGit(remoteRepo, ['config', 'user.name', 'Pokepocket Remote']);
      execGit(remoteRepo, ['config', 'user.email', 'remote@example.com']);
      const initialCommit = createCommit(remoteRepo, '1.2.0', 'initial remote commit');

      // Set up tempRepo to track remoteRepo as origin
      execGit(tempRepo, ['remote', 'add', 'origin', remoteRepo]);
      execGit(tempRepo, ['fetch', 'origin', 'main']);
      execGit(tempRepo, ['reset', '--hard', initialCommit]);
    });

    afterEach(() => {
      if (remoteRepo) {
        rmSync(remoteRepo, { recursive: true, force: true });
      }
    });

    it('accepts target that matches current remote main tip exactly', () => {
      const currentTip = execGit(remoteRepo, ['rev-parse', 'main']);
      const res = checkFreshnessAgainstMain(currentTip, tempRepo, 'origin');
      expect(res.fresh).toBe(true);
      expect(res.reason).toContain('Target matches current remote main tip exactly');
    });

    it('rejects target when newer commit exists on remote main (stale target)', () => {
      const commitA = execGit(remoteRepo, ['rev-parse', 'main']);
      // Remote advances to B
      createCommit(remoteRepo, '1.2.1', 'commit B on remote');
      execGit(tempRepo, ['fetch', 'origin', 'main']);

      const res = checkFreshnessAgainstMain(commitA, tempRepo, 'origin');
      expect(res.fresh).toBe(false);
      expect(res.reason).toContain('Stale or mismatched target');
    });

    it('rejects target when target is ahead of remote main', () => {
      // Local makes new commit C not yet on remote
      const commitC = createCommit(tempRepo, '1.2.1', 'commit C ahead');

      const res = checkFreshnessAgainstMain(commitC, tempRepo, 'origin');
      expect(res.fresh).toBe(false);
      expect(res.reason).toContain('Stale or mismatched target');
    });

    it('rejects target when remote main diverged or was reset', () => {
      const oldTip = execGit(remoteRepo, ['rev-parse', 'main']);

      // Reset remote main to an orphan root or different tree
      execGit(remoteRepo, ['checkout', '--orphan', 'new-main']);
      createCommit(remoteRepo, '1.2.0', 'diverged tree');
      execGit(remoteRepo, ['branch', '-M', 'main']);
      execGit(tempRepo, ['fetch', 'origin', 'main']);

      const res = checkFreshnessAgainstMain(oldTip, tempRepo, 'origin');
      expect(res.fresh).toBe(false);
      expect(res.reason).toContain('Stale or mismatched target');
    });

    it('rejects freshness check when remote main is missing or unavailable', () => {
      execGit(tempRepo, ['remote', 'remove', 'origin']);
      expect(() =>
        checkFreshnessAgainstMain('1234567890abcdef1234567890abcdef12345678', tempRepo, 'origin'),
      ).toThrow(/remote ref "origin\/main" is unavailable/);
    });

    it('rejects invalid target SHA in checkFreshnessAgainstMain', () => {
      expect(() => checkFreshnessAgainstMain('bad-sha', tempRepo)).toThrow(
        /Invalid target SHA for freshness check/,
      );
    });
  });

  describe('verifyDeployTarget fail-closed gating', () => {
    let remoteRepo;

    beforeEach(() => {
      remoteRepo = mkdtempSync(path.join(tmpdir(), 'pokepocket-remote-verify-'));
      execGit(remoteRepo, ['init', '-b', 'main']);
      execGit(remoteRepo, ['config', 'user.name', 'Pokepocket Remote']);
      execGit(remoteRepo, ['config', 'user.email', 'remote@example.com']);
      const initialCommit = createCommit(remoteRepo, '1.2.0', 'initial remote commit');

      execGit(tempRepo, ['remote', 'add', 'origin', remoteRepo]);
      execGit(tempRepo, ['fetch', 'origin', 'main']);
      execGit(tempRepo, ['reset', '--hard', initialCommit]);
    });

    afterEach(() => {
      if (remoteRepo) {
        rmSync(remoteRepo, { recursive: true, force: true });
      }
    });

    it('succeeds when all target SHAs match and versions match', () => {
      const sha = execGit(remoteRepo, ['rev-parse', 'main']);
      const res = verifyDeployTarget({
        eventName: 'workflow_run',
        expectedSha: sha,
        resolvedSha: sha,
        currentSha: sha,
        expectedVersion: '1.2.0',
        currentVersion: '1.2.0',
        cwd: tempRepo,
        remote: 'origin',
      });
      expect(res.verified).toBe(true);
    });

    it('rejects invalid or missing expectedVersion or currentVersion', () => {
      const sha = '1234567890abcdef1234567890abcdef12345678';
      expect(() =>
        verifyDeployTarget({
          eventName: 'push',
          expectedSha: sha,
          resolvedSha: sha,
          currentSha: sha,
          expectedVersion: '',
          currentVersion: '1.2.0',
          cwd: tempRepo,
        }),
      ).toThrow(/Invalid or missing expectedVersion/);

      expect(() =>
        verifyDeployTarget({
          eventName: 'push',
          expectedSha: sha,
          resolvedSha: sha,
          currentSha: sha,
          expectedVersion: '1.2.0',
          currentVersion: 'bad-semver',
          cwd: tempRepo,
        }),
      ).toThrow(/Invalid or missing currentVersion/);
    });

    it('rejects invalid inputs to verifyDeployTarget', () => {
      const valid = '1234567890abcdef1234567890abcdef12345678';
      expect(() =>
        verifyDeployTarget({ expectedSha: 'bad', resolvedSha: valid, currentSha: valid }),
      ).toThrow(/Invalid expectedSha/);
      expect(() =>
        verifyDeployTarget({ expectedSha: valid, resolvedSha: 'bad', currentSha: valid }),
      ).toThrow(/Invalid resolvedSha/);
      expect(() =>
        verifyDeployTarget({ expectedSha: valid, resolvedSha: valid, currentSha: 'bad' }),
      ).toThrow(/Invalid currentSha/);
    });

    it('fails when tested SHA does not match resolved SHA', () => {
      const sha1 = '1111111111111111111111111111111111111111';
      const sha2 = '2222222222222222222222222222222222222222';
      expect(() =>
        verifyDeployTarget({
          eventName: 'push',
          expectedSha: sha1,
          resolvedSha: sha2,
          currentSha: sha1,
          expectedVersion: '1.2.0',
          currentVersion: '1.2.0',
          cwd: tempRepo,
        }),
      ).toThrow(/expected tested SHA .* != resolved SHA/);
    });

    it('fails when checked out HEAD SHA does not match tested SHA', () => {
      const sha1 = '1111111111111111111111111111111111111111';
      const sha2 = '2222222222222222222222222222222222222222';
      expect(() =>
        verifyDeployTarget({
          eventName: 'push',
          expectedSha: sha1,
          resolvedSha: sha1,
          currentSha: sha2,
          expectedVersion: '1.2.0',
          currentVersion: '1.2.0',
          cwd: tempRepo,
        }),
      ).toThrow(/checked out HEAD SHA .* != tested SHA/);
    });

    it('fails when version mismatch', () => {
      const sha = '1111111111111111111111111111111111111111';
      expect(() =>
        verifyDeployTarget({
          eventName: 'push',
          expectedSha: sha,
          resolvedSha: sha,
          currentSha: sha,
          expectedVersion: '1.2.0',
          currentVersion: '1.2.1',
          cwd: tempRepo,
        }),
      ).toThrow(/expected version "1.2.0" != current version "1.2.1"/);
    });

    it('fails workflow_run deploy when target is stale relative to freshly fetched remote main', () => {
      const commitA = execGit(remoteRepo, ['rev-parse', 'main']);
      createCommit(remoteRepo, '1.2.1', 'commit B on remote');
      execGit(tempRepo, ['fetch', 'origin', 'main']);

      expect(() =>
        verifyDeployTarget({
          eventName: 'workflow_run',
          expectedSha: commitA,
          resolvedSha: commitA,
          currentSha: commitA,
          expectedVersion: '1.2.0',
          currentVersion: '1.2.0',
          cwd: tempRepo,
          remote: 'origin',
        }),
      ).toThrow(/Deploy rejected: Stale or mismatched target/);
    });
  });

  describe('CLI runners (resolve-release and verify-deploy)', () => {
    it('runResolveReleaseCli runs and handles exit cleanly on error', () => {
      // Missing environment produces error and exits with 1
      expect(() =>
        runResolveReleaseCli({
          exitFn: (code) => {
            throw new Error(`exit ${code}`);
          },
        }),
      ).toThrow(/exit 1/);
    });

    it('runVerifyDeployCli runs and handles exit cleanly on error', () => {
      expect(() =>
        runVerifyDeployCli({
          exitFn: (code) => {
            throw new Error(`exit ${code}`);
          },
        }),
      ).toThrow(/exit 1/);
    });
  });
});
