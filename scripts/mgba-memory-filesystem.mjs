import { createHash } from 'node:crypto';

const SDK_SHA256 = '98e6f460fa2f95846bf79c3b1c42ecf3acca0ce11937ba0d4aa693438402a473';

export function initializeMemoryFilesystem(FS) {
  return new Promise((resolve, reject) => {
    const mounts = ['/data', '/autosave'];
    for (const mount of mounts) {
      FS.mkdir(mount);
      FS.mount(FS.filesystems.IDBFS, {}, mount);
    }
    // Read legacy SDK caches before emulation; never delete or write back their databases.
    FS.syncfs(true, (error) => {
      if (error) {
        reject(new Error(`Cannot read legacy emulator cache: ${error}`));
        return;
      }
      try {
        const entries = [];
        const collect = (directory) => {
          for (const name of FS.readdir(directory)) {
            if (name === '.' || name === '..') continue;
            const file = `${directory}/${name}`;
            const mode = FS.lstat(file).mode;
            if (FS.isDir(mode)) {
              entries.push({ file });
              collect(file);
            } else if (FS.isFile(mode)) {
              entries.push({ file, data: FS.readFile(file) });
            } else {
              throw new Error(`Unsupported legacy emulator cache entry: ${file}`);
            }
          }
        };
        for (const mount of mounts) collect(mount);
        for (const mount of mounts) {
          FS.unmount(mount);
          FS.mount(FS.filesystems.MEMFS, {}, mount);
        }
        for (const { file, data } of entries) {
          if (data) FS.writeFile(file, data);
          else FS.mkdir(file);
        }
        for (const name of ['saves', 'states', 'games', 'cheats', 'screenshots', 'patches']) {
          const directory = `/data/${name}`;
          if (!FS.analyzePath(directory).exists) FS.mkdir(directory);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function syncMemoryFile(fd, FS, SYSCALLS) {
  try {
    const stream = SYSCALLS.getStreamFromFD(fd);
    // A synchronous native caller must never acknowledge an asynchronous backing store.
    if (stream.node.mount.type !== FS.filesystems.MEMFS) return 58; // WASI ENOTSUP
    const result = stream.stream_ops?.fsync?.(stream);
    if (result === undefined) return 0;
    return typeof result === 'number' ? result : 29; // WASI EIO for a non-synchronous operation
  } catch (error) {
    if (error.name !== 'ErrnoError') throw error;
    return error.errno;
  }
}

export function patchMgbaFilesystem(source, version) {
  if (version !== '2.5.1' || createHash('sha256').update(source).digest('hex') !== SDK_SHA256) {
    throw new Error(
      'Unreviewed mGBA runtime: review the filesystem adapter before updating the SDK',
    );
  }
  const initStart = source.indexOf('Module.FSInit=');
  const initEnd = source.indexOf('Module.FSSync=', initStart);
  const syncStart = source.indexOf('var _fd_sync=');
  const syncEnd = source.indexOf('var doWritev=', syncStart);
  // The digest binds these boundaries and proxy index to the reviewed SDK artifact.
  return (
    source.slice(0, initStart) +
    `Module.FSInit=()=>(${initializeMemoryFilesystem.toString()})(FS);` +
    source.slice(initEnd, syncStart) +
    `var _fd_sync=function(fd){if(ENVIRONMENT_IS_PTHREAD)return proxyToMainThread(80,0,1,fd);return (${syncMemoryFile.toString()})(fd,FS,SYSCALLS);};` +
    source.slice(syncEnd)
  );
}
