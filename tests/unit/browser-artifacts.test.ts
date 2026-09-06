import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACTS_ROOT_NAME,
  OWNERSHIP_MARKER_MAGIC,
  assertNoForbiddenInvocation,
  resolveGuardedOutputDir,
} from '../../scripts/browser-artifacts.ts';

const LITERAL_FORBIDDEN_FLAGS = [
  '--output',
  '-o',
  '--reporter',
  '--add-reporter',
  '--last-failed-file',
] as const;

const LITERAL_FORBIDDEN_ENVS = [
  'PW_TEST_REPORTER',
  'PLAYWRIGHT_BLOB_OUTPUT_DIR',
  'PLAYWRIGHT_BLOB_OUTPUT_FILE',
  'PLAYWRIGHT_BLOB_OUTPUT_NAME',
  'PLAYWRIGHT_HTML_OUTPUT_DIR',
  'PLAYWRIGHT_HTML_REPORT',
  'PLAYWRIGHT_JSON_OUTPUT_DIR',
  'PLAYWRIGHT_JSON_OUTPUT_FILE',
  'PLAYWRIGHT_JSON_OUTPUT_NAME',
  'PLAYWRIGHT_JUNIT_OUTPUT_DIR',
  'PLAYWRIGHT_JUNIT_OUTPUT_FILE',
  'PLAYWRIGHT_JUNIT_OUTPUT_NAME',
  'PLAYWRIGHT_LAST_RUN_OUTPUT_FILE',
  'PLAYWRIGHT_PERFETTO_OUTPUT_DIR',
  'PLAYWRIGHT_PERFETTO_OUTPUT_FILE',
  'PLAYWRIGHT_PERFETTO_OUTPUT_NAME',
] as const;

describe('browser-artifacts policy', () => {
  let fixtureParent: string;
  let testRoot: string;
  let canonicalTestRoot: string;

  beforeEach(() => {
    fixtureParent = mkdtempSync(join(tmpdir(), 'pokepocket-artifacts-test-'));
    testRoot = join(fixtureParent, 'project-root');
    mkdirSync(testRoot, { recursive: true });
    canonicalTestRoot = realpathSync(testRoot);
  });

  afterEach(() => {
    if (existsSync(fixtureParent)) {
      rmSync(fixtureParent, { recursive: true, force: true });
    }
  });

  describe('assertNoForbiddenInvocation', () => {
    it('passes when no forbidden flags or environment variables are present', () => {
      expect(() => assertNoForbiddenInvocation(['node', 'playwright', 'test'], {})).not.toThrow();
    });

    it('handles non-string items in argv gracefully', () => {
      // @ts-expect-error non-string in argv array
      expect(() => assertNoForbiddenInvocation([null, undefined, 123], {})).not.toThrow();
    });

    for (const flag of LITERAL_FORBIDDEN_FLAGS) {
      it(`rejects separated flag "${flag}"`, () => {
        expect(() =>
          assertNoForbiddenInvocation(['node', 'playwright', 'test', flag, 'target'], {}),
        ).toThrow(new RegExp(`Raw Playwright CLI flag "${flag}" is forbidden`));
      });

      it(`rejects equals form "${flag}=target"`, () => {
        expect(() =>
          assertNoForbiddenInvocation(['node', 'playwright', 'test', `${flag}=target`], {}),
        ).toThrow(new RegExp(`Raw Playwright CLI flag "${flag}=target" is forbidden`));
      });
    }

    for (const envKey of LITERAL_FORBIDDEN_ENVS) {
      it(`rejects forbidden environment variable "${envKey}"`, () => {
        const env = { [envKey]: join(fixtureParent, 'some-output') };
        expect(() => assertNoForbiddenInvocation(['node', 'playwright', 'test'], env)).toThrow(
          new RegExp(`Overriding ${envKey} is forbidden`),
        );
      });
    }
  });

  describe('resolveGuardedOutputDir', () => {
    it('rejects forbidden invocation via options.argv and writes nothing to disk', () => {
      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          argv: ['node', 'playwright', 'test', '--output', '.'],
        }),
      ).toThrow(/Raw Playwright CLI flag "--output" is forbidden/);

      expect(existsSync(join(testRoot, ARTIFACTS_ROOT_NAME))).toBe(false);
    });

    it('rejects forbidden env and writes nothing to disk', () => {
      const ownedOutside = join(fixtureParent, 'outside-target');
      mkdirSync(ownedOutside, { recursive: true });
      writeFileSync(join(ownedOutside, 'sentinel.txt'), 'intact');

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: { PW_TEST_REPORTER: 'html' },
        }),
      ).toThrow(/Overriding PW_TEST_REPORTER is forbidden/);

      expect(existsSync(join(testRoot, ARTIFACTS_ROOT_NAME))).toBe(false);
      expect(readFileSync(join(ownedOutside, 'sentinel.txt'), 'utf8')).toBe('intact');
    });

    it('rejects invalid suiteSubdir', () => {
      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          // @ts-expect-error invalid suiteSubdir value
          suiteSubdir: 'unsupported-suite',
          cwd: testRoot,
        }),
      ).toThrow(/suiteSubdir must be either "required" or "optional"/);
    });

    it('rejects missing or empty configDir', () => {
      expect(() =>
        resolveGuardedOutputDir({
          configDir: '',
          suiteSubdir: 'required',
          cwd: testRoot,
        }),
      ).toThrow(/configDir must be a non-empty string/);
    });

    it('rejects nonexistent configDir', () => {
      const nonExistent = join(testRoot, 'does-not-exist');
      expect(() =>
        resolveGuardedOutputDir({
          configDir: nonExistent,
          suiteSubdir: 'required',
          cwd: testRoot,
        }),
      ).toThrow(/configDir does not exist/);
    });

    it('rejects execution when cwd is completely outside configDir tree', () => {
      const outsideDir = join(fixtureParent, 'outside-cwd');
      mkdirSync(outsideDir, { recursive: true });

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: outsideDir,
        }),
      ).toThrow(/is outside project root/);
    });

    it('rejects when cwd does not exist on disk', () => {
      const nonexistentCwd = join(testRoot, 'subdir', 'nonexistent');
      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: nonexistentCwd,
        }),
      ).toThrow(/Working directory does not exist/);
    });

    it('creates fresh default directory with durable marker in parent artifacts dir', () => {
      const target = resolveGuardedOutputDir({
        configDir: testRoot,
        suiteSubdir: 'required',
        cwd: testRoot,
        argv: ['node', 'playwright', 'test'],
        env: {},
      });

      expect(target).toBe(join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, 'required'));
      expect(existsSync(target)).toBe(true);

      const markerPath = join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, '.owner');
      expect(existsSync(markerPath)).toBe(true);
      const content = readFileSync(markerPath, 'utf8');
      expect(content.trim()).toBe(OWNERSHIP_MARKER_MAGIC);
    });

    it('survives consecutive run/cleanup cycles where suite outputDir is recursively deleted', () => {
      const target1 = resolveGuardedOutputDir({
        configDir: testRoot,
        suiteSubdir: 'required',
        cwd: testRoot,
        argv: ['node', 'playwright', 'test'],
        env: {},
      });

      expect(target1).toBe(join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, 'required'));

      // Simulate Playwright's recursive output cleanup of project.outputDir ('required')
      rmSync(target1, { recursive: true, force: true });
      expect(existsSync(target1)).toBe(false);

      // Parent artifacts root and marker survive outside cleared directory
      expect(existsSync(join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, '.owner'))).toBe(true);

      // Second cycle: config load successfully recreates suite outputDir
      const target2 = resolveGuardedOutputDir({
        configDir: testRoot,
        suiteSubdir: 'required',
        cwd: testRoot,
        argv: ['node', 'playwright', 'test'],
        env: {},
      });

      expect(target2).toBe(join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, 'required'));
      expect(existsSync(target2)).toBe(true);

      // Subsequent call when target already exists returns existing canonical target
      const targetExisting = resolveGuardedOutputDir({
        configDir: testRoot,
        suiteSubdir: 'required',
        cwd: testRoot,
        argv: ['node', 'playwright', 'test'],
        env: {},
      });
      expect(targetExisting).toBe(target2);
    });

    it('can initialize optional suite in parallel child directory under same artifacts parent', () => {
      const reqTarget = resolveGuardedOutputDir({
        configDir: testRoot,
        suiteSubdir: 'required',
        cwd: testRoot,
        env: {},
      });
      const optTarget = resolveGuardedOutputDir({
        configDir: testRoot,
        suiteSubdir: 'optional',
        cwd: testRoot,
        env: {},
      });

      expect(reqTarget).toBe(join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, 'required'));
      expect(optTarget).toBe(join(canonicalTestRoot, ARTIFACTS_ROOT_NAME, 'optional'));
    });

    it('rejects existing unowned parent directory missing .owner marker', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(join(parentDir, 'unrelated.txt'), 'hello');

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/already exists but is not marked as project-owned/);
    });

    it('rejects existing parent when marker has invalid magic content', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(join(parentDir, '.owner'), 'invalid-magic\n');

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/contains invalid or mismatched metadata/);
    });

    it('rejects if external marker is a directory instead of regular file', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });

      const markerPath = join(parentDir, '.owner');
      mkdirSync(markerPath, { recursive: true });

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/must be a regular file/);
    });

    it('rejects if external marker is a symbolic link', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });

      const realMarker = join(testRoot, 'real-marker.txt');
      writeFileSync(realMarker, `${OWNERSHIP_MARKER_MAGIC}\n`);

      const markerPath = join(parentDir, '.owner');
      symlinkSync(realMarker, markerPath);

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/must not be a symbolic link/);
    });

    it('rejects if external marker is a dangling symbolic link', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });

      const nonexistentTarget = join(fixtureParent, 'nonexistent-marker.txt');
      const markerPath = join(parentDir, '.owner');
      symlinkSync(nonexistentTarget, markerPath);

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/must not be a symbolic link/);
    });

    it('rejects if artifacts parent is a symlink, leaving outside target untouched', () => {
      const outsideTarget = join(fixtureParent, 'outside-ancestor-target');
      mkdirSync(outsideTarget, { recursive: true });
      writeFileSync(join(outsideTarget, 'sentinel.txt'), 'preserve-me');

      const linkParent = join(testRoot, ARTIFACTS_ROOT_NAME);
      symlinkSync(outsideTarget, linkParent);

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/Artifacts parent .* must not be a symbolic link/);

      expect(existsSync(join(outsideTarget, 'required'))).toBe(false);
      expect(readFileSync(join(outsideTarget, 'sentinel.txt'), 'utf8')).toBe('preserve-me');
    });

    it('rejects if artifacts parent is a dangling symlink, leaving outside untouched', () => {
      const nonexistentOutside = join(fixtureParent, 'dangling-parent-outside');
      const linkParent = join(testRoot, ARTIFACTS_ROOT_NAME);
      symlinkSync(nonexistentOutside, linkParent);

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/Artifacts parent .* must not be a symbolic link/);

      expect(existsSync(nonexistentOutside)).toBe(false);
    });

    it('rejects if artifacts parent is a regular file', () => {
      const parentFile = join(testRoot, ARTIFACTS_ROOT_NAME);
      writeFileSync(parentFile, 'not a dir');

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/Artifacts parent .* is an existing non-directory file/);
    });

    it('rejects if suite destination is a symlink', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(join(parentDir, '.owner'), `${OWNERSHIP_MARKER_MAGIC}\n`);

      const realTarget = join(testRoot, 'real-target');
      mkdirSync(realTarget, { recursive: true });

      const symlinkTarget = join(parentDir, 'required');
      symlinkSync(realTarget, symlinkTarget);

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/Output directory .* must not be a symbolic link/);
    });

    it('rejects if suite destination is a dangling symlink', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(join(parentDir, '.owner'), `${OWNERSHIP_MARKER_MAGIC}\n`);

      const nonexistentTarget = join(fixtureParent, 'nonexistent-suite-target');
      const symlinkTarget = join(parentDir, 'required');
      symlinkSync(nonexistentTarget, symlinkTarget);

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/Output directory .* must not be a symbolic link/);
    });

    it('rejects if suite destination is an existing regular file instead of directory', () => {
      const parentDir = join(testRoot, ARTIFACTS_ROOT_NAME);
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(join(parentDir, '.owner'), `${OWNERSHIP_MARKER_MAGIC}\n`);

      const fileTarget = join(parentDir, 'required');
      writeFileSync(fileTarget, 'not a dir');

      expect(() =>
        resolveGuardedOutputDir({
          configDir: testRoot,
          suiteSubdir: 'required',
          cwd: testRoot,
          env: {},
        }),
      ).toThrow(/Output directory .* is an existing non-directory file/);
    });
  });
});
