import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function checksum(file) {
  try {
    return createHash('sha1')
      .update(await readFile(file))
      .digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function runCommand(program, parameters, cwd, logFile) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = null;
    let child = null;
    let childClosed = false;
    let streamClosed = !logFile;
    let killTimer = null;

    const maybeFinishRejection = (err) => {
      if (childClosed && streamClosed) {
        reject(err);
      }
    };

    const cleanupAndReject = (err) => {
      if (settled) return;
      settled = true;

      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }

      if (output) {
        output.on('close', () => {
          streamClosed = true;
          maybeFinishRejection(err);
        });
        output.destroy();
      } else {
        streamClosed = true;
      }

      if (child && !childClosed && child.exitCode === null && child.signalCode === null) {
        child.once('close', () => {
          childClosed = true;
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = null;
          }
          maybeFinishRejection(err);
        });

        child.kill('SIGTERM');

        // Escalate to SIGKILL if child ignores SIGTERM
        killTimer = setTimeout(() => {
          if (!childClosed && child.exitCode === null && child.signalCode === null) {
            try {
              child.kill('SIGKILL');
            } catch {
              // Ignore process lookup errors
            }
          }
        }, 200);
        killTimer.unref?.();
      } else {
        childClosed = true;
        maybeFinishRejection(err);
      }
    };

    if (logFile) {
      output = createWriteStream(logFile);
      output.on('error', cleanupAndReject);
    }

    try {
      child = spawn(program, parameters, {
        cwd,
        stdio: output ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      });
    } catch (err) {
      cleanupAndReject(err);
      return;
    }

    if (output) {
      child.stdout?.pipe(output, { end: false });
      child.stderr?.pipe(output, { end: false });
    }

    child.on('error', (error) => {
      cleanupAndReject(error);
    });

    child.on('close', (code) => {
      childClosed = true;
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (settled) {
        return;
      }
      const done = () => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${program} exited with ${code}. See ${logFile ?? cwd}`));
        }
      };

      if (output) {
        output.end(done);
      } else {
        done();
      }
    });
  });
}

export async function checkoutProject(
  id,
  repository,
  commit,
  cacheDir,
  runner = runCommand,
  execFn = execute,
) {
  const directory = path.join(cacheDir, id);
  if (await exists(path.join(directory, '.git'))) {
    const result = await execFn('git', ['rev-parse', 'HEAD'], { cwd: directory });
    if (result.stdout.trim() !== commit)
      throw new Error(
        `Source pin differs in ${directory}. Move that cache directory aside before building ${id}.`,
      );
    return directory;
  }
  await mkdir(directory, { recursive: true });
  await runner('git', ['init', '--quiet'], directory);
  await runner(
    'git',
    ['remote', 'add', 'origin', `https://github.com/${repository}.git`],
    directory,
  );
  await runner('git', ['fetch', '--depth', '1', 'origin', commit], directory);
  await runner('git', ['checkout', '--detach', 'FETCH_HEAD'], directory);
  return directory;
}

export async function installAgbcc(
  target,
  sources,
  cacheDir,
  runner = runCommand,
  execFn = execute,
) {
  const directory = await checkoutProject(
    'agbcc',
    sources.agbcc.repository,
    sources.agbcc.commit,
    cacheDir,
    runner,
    execFn,
  );
  if (!(await exists(path.join(directory, 'agbcc_arm'))))
    await runner('./build.sh', [], directory, path.join(cacheDir, 'agbcc-build.log'));
  if (!(await exists(path.join(target, 'tools/agbcc/bin/agbcc'))))
    await runner('./install.sh', [path.relative(directory, target)], directory);
}

export async function buildRoms(options = {}) {
  const root = options.root ?? fileURLToPath(new URL('../', import.meta.url));
  const cache = options.cache ?? path.join(root, '.cache/rom-build');
  const sources =
    options.sources ??
    JSON.parse(await readFile(new URL('./rom-sources.json', import.meta.url), 'utf8'));
  const editions =
    options.editions ??
    JSON.parse(await readFile(new URL('../src/data/editions.json', import.meta.url), 'utf8'));
  const args = options.args ?? [];
  const ids = args.filter((arg) => !arg.startsWith('--'));
  const requested =
    ids.length && !ids.includes('all') ? ids : editions.map((edition) => edition.id);
  const verifyOnly = options.verifyOnly ?? args.includes('--verify');
  const rebuild = options.rebuild ?? args.includes('--rebuild');
  const jobs = options.jobs ?? `-j${Math.min(8, availableParallelism())}`;
  const runner = options.runner ?? runCommand;
  const execFn = options.execFn ?? execute;

  const unknown = requested.filter((id) => !editions.some((edition) => edition.id === id));
  if (unknown.length) throw new Error(`Unknown edition: ${unknown.join(', ')}. Use --list.`);

  if (args.includes('--list')) {
    const listLines = editions.map(
      (edition) =>
        `${edition.id.padEnd(10)} ${edition.system.padEnd(3)} Pokémon ${edition.english} · ${edition.source}`,
    );
    if (!options.silent) {
      for (const line of listLines) console.log(line);
    }
    return { mode: 'list', editions: listLines };
  }

  await mkdir(cache, { recursive: true });
  await mkdir(path.join(root, 'roms'), { recursive: true });
  const results = [];
  for (const project of sources.projects) {
    const roms = project.roms.filter((rom) => requested.includes(rom.id));
    for (const rom of roms) {
      const edition = editions.find((item) => item.id === rom.id);
      const destination = path.join(root, 'roms', edition.fileName);
      const valid = (await checksum(destination)) === rom.sha1;
      if (!valid || rebuild) {
        if (verifyOnly)
          throw new Error(
            `Missing or incorrect ROM: ${edition.fileName}. Run npm run rom:build -- ${rom.id}`,
          );
        const directory = await checkoutProject(
          project.id,
          project.repository,
          project.commit,
          cache,
          runner,
          execFn,
        );
        if (project.toolchain === 'agbcc')
          await installAgbcc(directory, sources, cache, runner, execFn);
        else {
          const version = await execFn('rgbasm', ['--version']);
          if (!version.stdout.includes(sources.rgbds) && !options.silent)
            console.log(
              `This source targets RGBDS ${sources.rgbds}; installed: ${version.stdout.trim()}`,
            );
        }
        const log = path.join(cache, `${rom.id}-build.log`);
        if (!options.silent) {
          console.log(
            `Building ${edition.english} from ${project.repository}@${project.commit.slice(0, 8)}…`,
          );
        }
        await runner('make', [jobs, rom.target], directory, log);
        const source = path.join(directory, rom.output);
        const actual = await checksum(source);
        if (actual !== rom.sha1)
          throw new Error(`${rom.id} checksum mismatch: ${actual}; expected ${rom.sha1}`);
        await copyFile(source, destination);
      }
      const size = (await readFile(destination)).length;
      results.push({
        id: rom.id,
        file: edition.fileName,
        size,
        sha1: rom.sha1,
        source: `https://github.com/${project.repository}/tree/${project.commit}`,
      });
      if (!options.silent) {
        console.log(`VERIFIED ${edition.fileName} · ${size} bytes · ${rom.sha1}`);
      }
    }
  }
  await writeFile(
    path.join(cache, 'build-info.json'),
    `${JSON.stringify({ rgbds: sources.rgbds, agbcc: sources.agbcc, roms: results }, null, 2)}\n`,
  );
  const readyMessage = `${results.length} Pokémon editions ready in roms/.`;
  if (!options.silent) {
    console.log(readyMessage);
  }
  return { mode: 'build', results, message: readyMessage };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await buildRoms({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
