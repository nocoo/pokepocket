import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  initializeMemoryFilesystem,
  patchMgbaFilesystem,
  syncMemoryFile,
} from '../../scripts/mgba-memory-filesystem.mjs';

const sdk = await readFile(
  new URL('../../node_modules/@thenick775/mgba-wasm/dist/mgba.js', import.meta.url),
  'utf8',
);

function legacyFilesystem(error) {
  const nodes = new Map();
  const backing = new Map();
  const MEMFS = {};
  const IDBFS = {};
  const legacy = new Map([
    ['/data/saves', null],
    ['/data/saves/game.sav', new Uint8Array([0, 128, 255])],
    ['/data/states', null],
    ['/data/states/game.ss0', new Uint8Array([9, 8, 7])],
    ['/autosave/empty', null],
    ['/data/empty.dat', new Uint8Array()],
  ]);
  const FS = {
    filesystems: { MEMFS, IDBFS },
    mkdir: vi.fn((name) => {
      if (nodes.has(name)) throw new Error('Directory already exists');
      nodes.set(name, null);
    }),
    mount: vi.fn((type, _options, name) => backing.set(name, type)),
    unmount: vi.fn((name) => {
      for (const key of nodes.keys()) if (key.startsWith(`${name}/`)) nodes.delete(key);
      backing.delete(name);
    }),
    syncfs: vi.fn((populate, callback) => {
      expect(populate).toBe(true);
      for (const [name, data] of legacy) nodes.set(name, data);
      queueMicrotask(() => callback(error));
    }),
    readdir: (directory) => [
      '.',
      '..',
      ...[...nodes.keys()]
        .filter((name) => name.startsWith(`${directory}/`))
        .map((name) => name.slice(directory.length + 1))
        .filter((name) => !name.includes('/')),
    ],
    lstat: (name) => ({ mode: nodes.get(name) === null ? 'directory' : 'file' }),
    isDir: (mode) => mode === 'directory',
    isFile: (mode) => mode === 'file',
    readFile: (name) => nodes.get(name).slice(),
    writeFile: vi.fn((name, data) => nodes.set(name, data.slice())),
    analyzePath: (name) => ({ exists: nodes.has(name) }),
  };
  return { FS, nodes, backing, legacy };
}

describe('native memory filesystem and durable application storage boundary', () => {
  it('reads old caches before replacing mounts and preserves every byte and empty directory', async () => {
    const { FS, nodes, backing, legacy } = legacyFilesystem();
    const initialized = initializeMemoryFilesystem(FS);
    expect(FS.unmount).not.toHaveBeenCalled();
    await initialized;
    for (const [name, bytes] of legacy) expect(nodes.get(name)).toEqual(bytes);
    expect([...backing.values()]).toEqual([FS.filesystems.MEMFS, FS.filesystems.MEMFS]);
    expect(FS.syncfs).toHaveBeenCalledTimes(1);
    for (const [, options] of FS.mount.mock.calls) expect(options).toEqual({});
    for (const name of ['games', 'cheats', 'screenshots', 'patches']) {
      expect(nodes.get(`/data/${name}`)).toBe(null);
    }
  });

  it('fails before replacing mounts if legacy data cannot be read', async () => {
    const { FS } = legacyFilesystem(new Error('IndexedDB read failed'));
    await expect(initializeMemoryFilesystem(FS)).rejects.toThrow('IndexedDB read failed');
    expect(FS.unmount).not.toHaveBeenCalled();
    expect(FS.writeFile).not.toHaveBeenCalled();
  });

  it('rejects unsupported legacy entries without discarding either backing database', async () => {
    const { FS } = legacyFilesystem();
    FS.lstat = () => ({ mode: 'link' });
    await expect(initializeMemoryFilesystem(FS)).rejects.toThrow('Unsupported legacy');
    expect(FS.unmount).not.toHaveBeenCalled();
  });

  it('propagates memory-copy errors rather than allowing a partially initialized core', async () => {
    const { FS } = legacyFilesystem();
    FS.writeFile = () => {
      throw new Error('Memory copy failed');
    };
    await expect(initializeMemoryFilesystem(FS)).rejects.toThrow('Memory copy failed');
  });

  it('rejects SDK version or content drift before applying the runtime adapter', () => {
    expect(() => patchMgbaFilesystem(sdk, '2.5.0')).toThrow('Unreviewed mGBA');
    expect(() => patchMgbaFilesystem(`${sdk}\n`, '2.5.1')).toThrow('Unreviewed mGBA');
  });

  it('emits an actual synchronous pthread proxy and returns without a Promise turn', () => {
    const patched = patchMgbaFilesystem(sdk, '2.5.1');
    const body = patched.slice(patched.indexOf('var _fd_sync='), patched.indexOf('var doWritev='));
    const invoke = new Function(
      'FS',
      'SYSCALLS',
      'ENVIRONMENT_IS_PTHREAD',
      'proxyToMainThread',
      `${body}return _fd_sync(7);`,
    );
    const FS = { filesystems: { MEMFS: {} } };
    const SYSCALLS = {
      getStreamFromFD: () => ({ node: { mount: { type: FS.filesystems.MEMFS } } }),
    };
    const proxy = vi.fn(() => invoke(FS, SYSCALLS, false, null));
    expect(invoke(FS, SYSCALLS, true, proxy)).toBe(0);
    expect(proxy).toHaveBeenCalledWith(80, 0, 1, 7);
    expect(patched).toContain('import.meta.url');
  });

  it('rejects asynchronous backing stores and preserves real syscall errors', () => {
    const MEMFS = {};
    const FS = { filesystems: { MEMFS } };
    const fsync = vi.fn();
    const stream = { node: { mount: { type: {} } }, stream_ops: { fsync } };
    const SYSCALLS = { getStreamFromFD: () => stream };
    expect(syncMemoryFile(7, FS, SYSCALLS)).toBe(58);
    expect(fsync).not.toHaveBeenCalled();
    stream.node.mount.type = MEMFS;
    fsync.mockReturnValue(29);
    expect(syncMemoryFile(7, FS, SYSCALLS)).toBe(29);
    fsync.mockReturnValue(Promise.resolve(0));
    expect(syncMemoryFile(7, FS, SYSCALLS)).toBe(29);
    SYSCALLS.getStreamFromFD = () => {
      throw Object.assign(new Error('Bad fd'), { name: 'ErrnoError', errno: 8 });
    };
    expect(syncMemoryFile(7, FS, SYSCALLS)).toBe(8);
    SYSCALLS.getStreamFromFD = () => {
      throw new Error('Unexpected failure');
    };
    expect(() => syncMemoryFile(7, FS, SYSCALLS)).toThrow('Unexpected failure');
  });
});
