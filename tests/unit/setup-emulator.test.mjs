import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setupEmulator, REQUIRED_DEPENDENCIES } from '../../scripts/setup-emulator.mjs';

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function createTempRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pocket-setup-emulator-'));
  roots.push(dir);
  return dir;
}

describe('setup-emulator policy and asset preparation', () => {
  it('copies wasm runtime, records version.json, and copies licenses into public', async () => {
    const root = await createTempRoot();
    const source = path.join(root, 'node_modules/@thenick775/mgba-wasm');
    await mkdir(path.join(source, 'dist'), { recursive: true });
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: '2.5.1' }));
    await writeFile(path.join(source, 'dist/mgba.js'), '/* fake mgba.js */');
    await writeFile(path.join(source, 'dist/mgba.wasm'), '/* fake mgba.wasm */');

    // Create mock node_modules dependencies with licenses
    for (const dep of REQUIRED_DEPENDENCIES) {
      const depDir = path.join(root, 'node_modules', dep);
      await mkdir(depDir, { recursive: true });
      const licFile = dep === 'jose' ? 'LICENSE.md' : 'LICENSE';
      await writeFile(path.join(depDir, licFile), `License for ${dep}`);
    }

    const result = await setupEmulator({ root, source, silent: true });
    expect(result.version).toBe('2.5.1');
    expect(result.message).toContain('2.5.1');

    // Check version.json
    const versionContent = JSON.parse(
      await readFile(path.join(root, 'public/emulator/version.json'), 'utf8'),
    );
    expect(versionContent.version).toBe('2.5.1');

    // Check emulator assets
    const jsContent = await readFile(path.join(root, 'public/emulator/2.5.1/mgba.js'), 'utf8');
    expect(jsContent).toBe('/* fake mgba.js */');
    const wasmContent = await readFile(path.join(root, 'public/emulator/2.5.1/mgba.wasm'), 'utf8');
    expect(wasmContent).toBe('/* fake mgba.wasm */');

    // Check licenses
    for (const dep of REQUIRED_DEPENDENCIES) {
      const targetName = `${dep.replaceAll('/', '-').replace('@', '')}.txt`;
      const licText = await readFile(path.join(root, 'public/licenses', targetName), 'utf8');
      expect(licText).toBe(`License for ${dep}`);
    }
  });
});
