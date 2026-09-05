import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildRoms,
  checkoutProject,
  checksum,
  exists,
  installAgbcc,
  runCommand,
} from '../../scripts/build-rom.mjs';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function createTempRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pocket-build-rom-'));
  roots.push(dir);
  return dir;
}

describe('build-rom command execution and error settlement', () => {
  it('runs child process successfully with log file writing', async () => {
    const root = await createTempRoot();
    const logFile = path.join(root, 'output.log');

    await runCommand(
      process.execPath,
      ['-e', 'console.log("hello stdout"); console.error("hello stderr");'],
      root,
      logFile,
    );

    const logContent = await readFile(logFile, 'utf8');
    expect(logContent).toContain('hello stdout');
    expect(logContent).toContain('hello stderr');
  });

  it('rejects when child process exits with non-zero code', async () => {
    const root = await createTempRoot();
    const logFile = path.join(root, 'fail.log');

    await expect(
      runCommand(process.execPath, ['-e', 'process.exit(42);'], root, logFile),
    ).rejects.toThrow('exited with 42');
  });

  it('rejects when program executable is missing', async () => {
    const root = await createTempRoot();
    const logFile = path.join(root, 'missing.log');

    await expect(
      runCommand('/path/to/definitely/missing/program', [], root, logFile),
    ).rejects.toThrow();
  });

  it('handles write stream errors without unhandled exceptions and cleans up output', async () => {
    const root = await createTempRoot();
    const badLogPath = path.join(root, 'missing-parent-dir/sub/test.log');

    await expect(
      runCommand(process.execPath, ['-e', 'console.log("hi");'], root, badLogPath),
    ).rejects.toThrow();
  });

  it('terminates and escalates to SIGKILL if child process ignores SIGTERM during log error cleanup', async () => {
    const root = await createTempRoot();
    const log = path.join(root, 'build.log');
    const ready = path.join(root, 'ready.json');
    const late = path.join(root, 'late.txt');
    const original = fs.createWriteStream;
    let output;
    let childPid;

    try {
      fs.createWriteStream = (...args) => {
        const stream = original(...args);
        if (args[0] === log) output = stream;
        return stream;
      };
      syncBuiltinESMExports();

      const script = `
        process.on('SIGTERM', () => {});
        require('node:fs').writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid }));
        setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(late)}, 'late work'); }, 900);
        setTimeout(() => process.exit(0), 1400);
      `;

      const result = runCommand(process.execPath, ['-e', script], root, log).then(
        () => ({ success: true }),
        (error) => ({ success: false, error }),
      );

      const deadline = Date.now() + 2000;
      while (
        !(await access(ready).then(
          () => true,
          () => false,
        ))
      ) {
        if (Date.now() > deadline) throw new Error('No child readiness marker');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      childPid = JSON.parse(await readFile(ready, 'utf8')).pid;
      const started = Date.now();
      output.destroy(new Error('delayed log write failure'));

      const outcome = await result;
      const elapsed = Date.now() - started;

      let alive = true;
      try {
        process.kill(childPid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') alive = false;
        else throw error;
      }

      const wroteAfterError = await access(late).then(
        () => true,
        () => false,
      );
      expect(outcome.success).toBe(false);
      expect(outcome.error.message).toBe('delayed log write failure');
      expect(alive).toBe(false);
      expect(wroteAfterError).toBe(false);
      expect(output.closed).toBe(true);
      expect(elapsed).toBeLessThan(750);
    } finally {
      fs.createWriteStream = original;
      syncBuiltinESMExports();
      if (childPid) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          // Child already terminated
        }
      }
    }
  });
});

describe('build-rom policy, source selection and checksums', () => {
  it('detects existing files and computes sha1 checksums correctly', async () => {
    const root = await createTempRoot();
    const testFile = path.join(root, 'data.bin');
    expect(await exists(testFile)).toBe(false);
    expect(await checksum(testFile)).toBeNull();

    await writeFile(testFile, 'hello poke');
    expect(await exists(testFile)).toBe(true);
    expect(await checksum(testFile)).toBe('44f031fa93bc2fb95662d7ec4e3edded5433a7bb');
  });

  it('lists available editions with --list', async () => {
    const root = await createTempRoot();
    const result = await buildRoms({
      root,
      args: ['--list'],
      silent: true,
    });
    expect(result.mode).toBe('list');
    expect(result.editions.length).toBeGreaterThanOrEqual(12);
    expect(result.editions[0]).toContain('red');
  });

  it('rejects unknown edition IDs with helpful error', async () => {
    const root = await createTempRoot();
    await expect(
      buildRoms({
        root,
        args: ['unknown-pokemon-edition'],
        silent: true,
      }),
    ).rejects.toThrow('Unknown edition: unknown-pokemon-edition');
  });

  it('re-uses existing valid git checkout when commit matches', async () => {
    const root = await createTempRoot();
    const cacheDir = path.join(root, 'cache');
    const projectDir = path.join(cacheDir, 'proj-1');
    await mkdir(path.join(projectDir, '.git'), { recursive: true });

    const execFn = vi.fn().mockResolvedValue({ stdout: 'commit-abc-123\n' });
    const runner = vi.fn();

    const dir = await checkoutProject(
      'proj-1',
      'owner/repo',
      'commit-abc-123',
      cacheDir,
      runner,
      execFn,
    );
    expect(dir).toBe(projectDir);
    expect(execFn).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
    expect(runner).not.toHaveBeenCalled();
  });

  it('throws when existing git checkout has differing commit pin', async () => {
    const root = await createTempRoot();
    const cacheDir = path.join(root, 'cache');
    const projectDir = path.join(cacheDir, 'proj-1');
    await mkdir(path.join(projectDir, '.git'), { recursive: true });

    const execFn = vi.fn().mockResolvedValue({ stdout: 'stale-commit-456\n' });
    const runner = vi.fn();

    await expect(
      checkoutProject('proj-1', 'owner/repo', 'commit-abc-123', cacheDir, runner, execFn),
    ).rejects.toThrow('Source pin differs');
  });

  it('executes clone sequence when repository is not yet in cache', async () => {
    const root = await createTempRoot();
    const cacheDir = path.join(root, 'cache');
    const runner = vi.fn().mockResolvedValue(undefined);

    const dir = await checkoutProject('proj-2', 'owner/repo-2', 'commit-789', cacheDir, runner);
    expect(dir).toBe(path.join(cacheDir, 'proj-2'));
    expect(runner).toHaveBeenCalledWith('git', ['init', '--quiet'], dir);
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/owner/repo-2.git'],
      dir,
    );
    expect(runner).toHaveBeenCalledWith(
      'git',
      ['fetch', '--depth', '1', 'origin', 'commit-789'],
      dir,
    );
    expect(runner).toHaveBeenCalledWith('git', ['checkout', '--detach', 'FETCH_HEAD'], dir);
  });

  it('installs agbcc toolchain if not already present in target', async () => {
    const root = await createTempRoot();
    const cacheDir = path.join(root, 'cache');
    const target = path.join(root, 'target-project');
    await mkdir(target, { recursive: true });

    const runner = vi.fn().mockResolvedValue(undefined);
    const execFn = vi.fn().mockResolvedValue({ stdout: 'agbcc-commit-1\n' });

    const sources = {
      agbcc: {
        repository: 'pret/agbcc',
        commit: 'agbcc-commit-1',
      },
    };

    const agbccDir = path.join(cacheDir, 'agbcc');
    await mkdir(path.join(agbccDir, '.git'), { recursive: true });
    await writeFile(path.join(agbccDir, 'agbcc_arm'), 'binary');

    const expectedRelativeInstall = path.relative(agbccDir, target);
    await installAgbcc(target, sources, cacheDir, runner, execFn);
    expect(runner).toHaveBeenCalledWith('./install.sh', [expectedRelativeInstall], agbccDir);
  });

  it('executes full build path with toolchain choice, make invocation, checksum validation, and manifest output', async () => {
    const root = await createTempRoot();
    const cache = path.join(root, '.cache/rom-build');
    const romsDir = path.join(root, 'roms');
    await mkdir(romsDir, { recursive: true });

    const editions = [
      { id: 'red', english: 'Red', fileName: 'pokered.gbc' },
      { id: 'emerald', english: 'Emerald', fileName: 'pokeemerald.gba' },
      { id: 'gold', english: 'Gold', fileName: 'pokegold.gbc' },
    ];

    const sources = {
      rgbds: '0.9.0',
      agbcc: { repository: 'pret/agbcc', commit: 'agbcc-123' },
      projects: [
        {
          id: 'pokered',
          repository: 'pret/pokered',
          commit: 'red-commit-111',
          toolchain: 'rgbds',
          roms: [
            {
              id: 'red',
              output: 'pokered.gbc',
              sha1: '1111111111111111111111111111111111111111',
              target: 'pokered.gbc',
            },
          ],
        },
        {
          id: 'pokeemerald',
          repository: 'pret/pokeemerald',
          commit: 'emerald-commit-222',
          toolchain: 'agbcc',
          roms: [
            {
              id: 'emerald',
              output: 'pokeemerald.gba',
              sha1: '2222222222222222222222222222222222222222',
              target: 'pokeemerald.gba',
            },
          ],
        },
        {
          id: 'pokegold',
          repository: 'pret/pokegold',
          commit: 'gold-commit-333',
          toolchain: 'rgbds',
          roms: [
            {
              id: 'gold',
              output: 'pokegold.gbc',
              sha1: '3333333333333333333333333333333333333333',
              target: 'pokegold.gbc',
            },
          ],
        },
      ],
    };

    const runner = vi.fn().mockImplementation(async (prog, params, cwd) => {
      // When make is called, write the expected output artifact in the project directory
      if (prog === 'make') {
        const targetFile = params[1];
        await writeFile(
          path.join(cwd, targetFile),
          targetFile.includes('red') ? 'red-compiled-bytes' : 'emerald-compiled-bytes',
        );
      }
    });

    const execFn = vi.fn().mockImplementation(async (cmd, _args) => {
      if (cmd === 'rgbasm') return { stdout: 'rgbasm 0.9.0\n' };
      if (cmd === 'git') return { stdout: 'commit\n' };
      return { stdout: '' };
    });

    // Compute actual sha1 of what runner produces
    const redSha1 = await (async () => {
      const t = path.join(root, 'temp-red');
      await writeFile(t, 'red-compiled-bytes');
      return await checksum(t);
    })();
    const emeraldSha1 = await (async () => {
      const t = path.join(root, 'temp-emerald');
      await writeFile(t, 'emerald-compiled-bytes');
      return await checksum(t);
    })();
    sources.projects[0].roms[0].sha1 = redSha1;
    sources.projects[1].roms[0].sha1 = emeraldSha1;

    // Simulate pre-cached git directories so network git clone is bypassed
    await mkdir(path.join(cache, 'pokered/.git'), { recursive: true });
    await mkdir(path.join(cache, 'pokeemerald/.git'), { recursive: true });
    await mkdir(path.join(cache, 'pokegold/.git'), { recursive: true });
    await mkdir(path.join(cache, 'agbcc/.git'), { recursive: true });
    await writeFile(path.join(cache, 'agbcc/agbcc_arm'), 'binary');

    execFn.mockImplementation(async (cmd, args, opts) => {
      if (cmd === 'rgbasm') return { stdout: 'rgbasm 0.9.0\n' };
      if (cmd === 'git' && args[0] === 'rev-parse') {
        if (opts.cwd.includes('pokered')) return { stdout: 'red-commit-111\n' };
        if (opts.cwd.includes('pokeemerald')) return { stdout: 'emerald-commit-222\n' };
        if (opts.cwd.includes('pokegold')) return { stdout: 'gold-commit-333\n' };
        if (opts.cwd.includes('agbcc')) return { stdout: 'agbcc-123\n' };
      }
      return { stdout: '' };
    });

    // Request subset 'red' and 'emerald', deliberately excluding unrequested 'gold'
    const buildResult = await buildRoms({
      root,
      cache,
      sources,
      editions,
      args: ['red', 'emerald'],
      runner,
      execFn,
      silent: true,
    });

    expect(buildResult.mode).toBe('build');
    expect(buildResult.results).toHaveLength(2);
    expect(buildResult.message).toBe('2 Pokémon editions ready in roms/.');

    // Assert exact make targets, jobs, and toolchain invocations
    expect(runner).toHaveBeenCalledWith(
      'make',
      [expect.stringMatching(/^-j\d+$/), 'pokered.gbc'],
      path.join(cache, 'pokered'),
      path.join(cache, 'red-build.log'),
    );
    expect(runner).toHaveBeenCalledWith(
      'make',
      [expect.stringMatching(/^-j\d+$/), 'pokeemerald.gba'],
      path.join(cache, 'pokeemerald'),
      path.join(cache, 'emerald-build.log'),
    );

    // Assert exact relative install target for agbcc
    const expectedAgbccTargetRel = path.relative(
      path.join(cache, 'agbcc'),
      path.join(cache, 'pokeemerald'),
    );
    expect(runner).toHaveBeenCalledWith(
      './install.sh',
      [expectedAgbccTargetRel],
      path.join(cache, 'agbcc'),
    );
    expect(execFn).toHaveBeenCalledWith('rgbasm', ['--version']);

    // Assert unrequested 'gold' project was never compiled, built or copied
    expect(runner).not.toHaveBeenCalledWith(
      'make',
      expect.arrayContaining(['pokegold.gbc']),
      expect.anything(),
      expect.anything(),
    );
    expect(await exists(path.join(romsDir, 'pokegold.gbc'))).toBe(false);

    // Check files copied to root/roms with exact content
    expect(await readFile(path.join(romsDir, 'pokered.gbc'), 'utf8')).toBe('red-compiled-bytes');
    expect(await readFile(path.join(romsDir, 'pokeemerald.gba'), 'utf8')).toBe(
      'emerald-compiled-bytes',
    );

    // Check manifest written to cache with sha1, source, file, and size
    const manifest = JSON.parse(await readFile(path.join(cache, 'build-info.json'), 'utf8'));
    expect(manifest.roms).toHaveLength(2);
    expect(manifest.roms[0]).toEqual({
      id: 'red',
      file: 'pokered.gbc',
      size: 'red-compiled-bytes'.length,
      sha1: redSha1,
      source: 'https://github.com/pret/pokered/tree/red-commit-111',
    });
    expect(manifest.roms[1]).toEqual({
      id: 'emerald',
      file: 'pokeemerald.gba',
      size: 'emerald-compiled-bytes'.length,
      sha1: emeraldSha1,
      source: 'https://github.com/pret/pokeemerald/tree/emerald-commit-222',
    });
  });

  it('verifies existing ROMs with --verify without triggering runner or exec calls', async () => {
    const root = await createTempRoot();
    const romsDir = path.join(root, 'roms');
    await mkdir(romsDir, { recursive: true });

    const editions = [{ id: 'crystal', english: 'Crystal', fileName: 'pokecrystal.gbc' }];
    await writeFile(path.join(romsDir, 'pokecrystal.gbc'), 'crystal-bytes');
    const crystalSha1 = await checksum(path.join(romsDir, 'pokecrystal.gbc'));

    const sources = {
      rgbds: '0.9.0',
      projects: [
        {
          id: 'pokecrystal',
          repository: 'pret/pokecrystal',
          commit: 'crystal-commit',
          roms: [{ id: 'crystal', sha1: crystalSha1, output: 'pokecrystal.gbc' }],
        },
      ],
    };

    const runner = vi.fn();
    const execFn = vi.fn();

    const result = await buildRoms({
      root,
      sources,
      editions,
      args: ['crystal', '--verify'],
      runner,
      execFn,
      silent: true,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('crystal');
    expect(runner).not.toHaveBeenCalled();
    expect(execFn).not.toHaveBeenCalled();
  });

  it('throws on --verify if ROM is missing or incorrect without running build commands', async () => {
    const root = await createTempRoot();
    const editions = [{ id: 'ruby', english: 'Ruby', fileName: 'pokeruby.gba' }];
    const sources = {
      rgbds: '0.9.0',
      projects: [{ id: 'pokeruby', roms: [{ id: 'ruby', sha1: 'abc' }] }],
    };

    const runner = vi.fn();
    const execFn = vi.fn();

    await expect(
      buildRoms({
        root,
        sources,
        editions,
        args: ['ruby', '--verify'],
        runner,
        execFn,
        silent: true,
      }),
    ).rejects.toThrow('Missing or incorrect ROM');

    expect(runner).not.toHaveBeenCalled();
    expect(execFn).not.toHaveBeenCalled();
  });

  it('aborts without copying to destination when built ROM fails checksum validation', async () => {
    const root = await createTempRoot();
    const cache = path.join(root, '.cache/rom-build');
    const romsDir = path.join(root, 'roms');
    await mkdir(romsDir, { recursive: true });

    const editions = [{ id: 'red', english: 'Red', fileName: 'pokered.gbc' }];
    const sources = {
      rgbds: '0.9.0',
      projects: [
        {
          id: 'pokered',
          repository: 'pret/pokered',
          commit: 'red-commit',
          toolchain: 'rgbds',
          roms: [
            {
              id: 'red',
              output: 'pokered.gbc',
              sha1: 'expected-sha1-mismatch',
              target: 'pokered.gbc',
            },
          ],
        },
      ],
    };

    const runner = vi.fn().mockImplementation(async (prog, _params, cwd) => {
      if (prog === 'make') {
        await writeFile(path.join(cwd, 'pokered.gbc'), 'corrupt-bytes');
      }
    });

    await mkdir(path.join(cache, 'pokered/.git'), { recursive: true });
    const execFn = vi.fn().mockImplementation(async (cmd) => {
      if (cmd === 'rgbasm') return { stdout: 'rgbasm 0.9.0\n' };
      if (cmd === 'git') return { stdout: 'red-commit\n' };
      return { stdout: '' };
    });

    await expect(
      buildRoms({
        root,
        cache,
        sources,
        editions,
        args: ['red'],
        runner,
        execFn,
        silent: true,
      }),
    ).rejects.toThrow('checksum mismatch');

    // Destination file must NOT have been copied
    expect(await exists(path.join(romsDir, 'pokered.gbc'))).toBe(false);
  });
});
