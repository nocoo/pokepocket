import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const REQUIRED_DEPENDENCIES = [
  'react',
  'react-dom',
  'idb',
  'jose',
  'lucide-react',
  '@fontsource/dm-sans',
  '@fontsource/space-mono',
  '@fontsource/press-start-2p',
];

export async function setupEmulator(options = {}) {
  const root = options.root ?? fileURLToPath(new URL('../', import.meta.url));
  const source = options.source ?? path.join(root, 'node_modules/@thenick775/mgba-wasm');
  const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  const target = path.join(root, 'public/emulator', pkg.version);
  await mkdir(target, { recursive: true });

  // Preserve import.meta.url: the threaded Emscripten runtime loads itself as a worker.
  for (const file of ['mgba.js', 'mgba.wasm']) {
    await copyFile(path.join(source, 'dist', file), path.join(target, file));
  }
  await writeFile(
    path.join(root, 'public/emulator/version.json'),
    JSON.stringify({ version: pkg.version }),
  );

  const licenses = path.join(root, 'public/licenses');
  await mkdir(licenses, { recursive: true });
  for (const dependency of REQUIRED_DEPENDENCIES) {
    const licenseFileName = dependency === 'jose' ? 'LICENSE.md' : 'LICENSE';
    await copyFile(
      path.join(root, 'node_modules', dependency, licenseFileName),
      path.join(licenses, `${dependency.replaceAll('/', '-').replace('@', '')}.txt`),
    );
  }

  const message = `mGBA ${pkg.version}: same-origin JS and WebAssembly assets ready.`;
  if (!options.silent) {
    console.log(message);
  }
  return { version: pkg.version, message };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await setupEmulator();
}
