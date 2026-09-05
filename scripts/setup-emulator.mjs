import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'node_modules/@thenick775/mgba-wasm');
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
for (const dependency of [
  'react',
  'react-dom',
  'idb',
  'jose',
  'lucide-react',
  '@fontsource/dm-sans',
  '@fontsource/space-mono',
  '@fontsource/press-start-2p',
]) {
  await copyFile(
    path.join(root, 'node_modules', dependency, dependency === 'jose' ? 'LICENSE.md' : 'LICENSE'),
    path.join(licenses, `${dependency.replaceAll('/', '-').replace('@', '')}.txt`),
  );
}
console.log(`mGBA ${pkg.version}: same-origin JS and WebAssembly assets ready.`);
