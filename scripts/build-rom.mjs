import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, '.cache/rom-build');
const sources = JSON.parse(await readFile(new URL('./rom-sources.json', import.meta.url), 'utf8'));
const editions = JSON.parse(
  await readFile(new URL('../src/data/editions.json', import.meta.url), 'utf8'),
);
const execute = promisify(execFile);
const args = process.argv.slice(2);
const ids = args.filter((arg) => !arg.startsWith('--'));
const requested = ids.length && !ids.includes('all') ? ids : editions.map((edition) => edition.id);
const verifyOnly = args.includes('--verify');
const rebuild = args.includes('--rebuild');
const jobs = `-j${Math.min(8, availableParallelism())}`;

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function checksum(file) {
  try {
    return createHash('sha1')
      .update(await readFile(file))
      .digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function command(program, parameters, cwd, logFile) {
  return new Promise((resolve, reject) => {
    const output = logFile ? createWriteStream(logFile) : null;
    const child = spawn(program, parameters, {
      cwd,
      stdio: output ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (output) {
      child.stdout.pipe(output, { end: false });
      child.stderr.pipe(output, { end: false });
    }
    child.on('error', (error) => {
      output?.end();
      reject(error);
    });
    child.on('close', (code) => {
      const done = () =>
        code === 0
          ? resolve()
          : reject(new Error(`${program} exited with ${code}. See ${logFile ?? cwd}`));
      if (output) output.end(done);
      else done();
    });
  });
}
async function checkout(id, repository, commit) {
  const directory = path.join(cache, id);
  if (await exists(path.join(directory, '.git'))) {
    const result = await execute('git', ['rev-parse', 'HEAD'], { cwd: directory });
    if (result.stdout.trim() !== commit)
      throw new Error(
        `Source pin differs in ${directory}. Move that cache directory aside before building ${id}.`,
      );
    return directory;
  }
  await mkdir(directory, { recursive: true });
  await command('git', ['init', '--quiet'], directory);
  await command(
    'git',
    ['remote', 'add', 'origin', `https://github.com/${repository}.git`],
    directory,
  );
  await command('git', ['fetch', '--depth', '1', 'origin', commit], directory);
  await command('git', ['checkout', '--detach', 'FETCH_HEAD'], directory);
  return directory;
}
async function installAgbcc(target) {
  const directory = await checkout('agbcc', sources.agbcc.repository, sources.agbcc.commit);
  if (!(await exists(path.join(directory, 'agbcc_arm'))))
    await command('./build.sh', [], directory, path.join(cache, 'agbcc-build.log'));
  if (!(await exists(path.join(target, 'tools/agbcc/bin/agbcc'))))
    await command('./install.sh', [path.relative(directory, target)], directory);
}

try {
  const unknown = requested.filter((id) => !editions.some((edition) => edition.id === id));
  if (unknown.length) throw new Error(`Unknown edition: ${unknown.join(', ')}. Use --list.`);
  if (args.includes('--list')) {
    for (const edition of editions)
      console.log(
        `${edition.id.padEnd(10)} ${edition.system.padEnd(3)} Pokémon ${edition.english} · ${edition.source}`,
      );
  } else {
    await mkdir(cache, { recursive: true });
    await mkdir(path.join(root, 'roms'), { recursive: true });
    const results = [];
    for (const project of sources.projects) {
      const roms = project.roms.filter((rom) => requested.includes(rom.id));
      for (const rom of roms) {
        const edition = editions.find((edition) => edition.id === rom.id);
        const destination = path.join(root, 'roms', edition.fileName);
        const valid = (await checksum(destination)) === rom.sha1;
        if (!valid || rebuild) {
          if (verifyOnly)
            throw new Error(
              `Missing or incorrect ROM: ${edition.fileName}. Run npm run rom:build -- ${rom.id}`,
            );
          const directory = await checkout(project.id, project.repository, project.commit);
          if (project.toolchain === 'agbcc') await installAgbcc(directory);
          else {
            const version = await execute('rgbasm', ['--version']);
            if (!version.stdout.includes(sources.rgbds))
              console.log(
                `This source targets RGBDS ${sources.rgbds}; installed: ${version.stdout.trim()}`,
              );
          }
          const log = path.join(cache, `${rom.id}-build.log`);
          console.log(
            `Building ${edition.english} from ${project.repository}@${project.commit.slice(0, 8)}…`,
          );
          await command('make', [jobs, rom.target], directory, log);
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
        console.log(`VERIFIED ${edition.fileName} · ${size} bytes · ${rom.sha1}`);
      }
    }
    await writeFile(
      path.join(cache, 'build-info.json'),
      `${JSON.stringify({ rgbds: sources.rgbds, agbcc: sources.agbcc, roms: results }, null, 2)}\n`,
    );
    console.log(`${results.length} Pokémon editions ready in public/roms/.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
