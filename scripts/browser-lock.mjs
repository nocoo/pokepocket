import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import {
  BROWSER_PORT,
  getBrowserLockPath,
  getMachineLockParent,
  LOCK_METADATA_HEADER,
  validateBrowserTarget,
} from './browser-shared.mjs';

export { BROWSER_PORT, getBrowserLockPath, getMachineLockParent, validateBrowserTarget };

export function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
}

export function acquireBrowserLock(options = {}) {
  const port = options.port ?? BROWSER_PORT;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port for browser lock: ${port}`);
  }

  const checkoutDir = options.checkoutDir
    ? realpathSync(options.checkoutDir)
    : realpathSync(process.cwd());

  if (!options.runResourceRoot) {
    throw new Error('acquireBrowserLock requires an explicit runResourceRoot');
  }
  const runResourceRoot = realpathSync(options.runResourceRoot);

  const suite = options.suite ?? 'required';
  if (suite !== 'required' && suite !== 'optional') {
    throw new Error(`Invalid suite for browser lock: ${suite}`);
  }

  const pid = options.pid ?? process.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid owner PID for browser lock: ${pid}`);
  }

  const nonce = options.nonce ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  const lockFilePath = options.lockFilePath ?? getBrowserLockPath(port);

  let preStat;
  try {
    preStat = lstatSync(lockFilePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (preStat) {
    throw new Error(
      `Browser lock file "${lockFilePath}" already exists. Another run may be holding port ${port} or a stale lock remains. Unowned or leftover locks fail closed.`,
    );
  }

  const payload = JSON.stringify(
    {
      header: LOCK_METADATA_HEADER,
      port,
      pid,
      checkoutDir,
      suite,
      runResourceRoot,
      nonce,
      acquiredAt: Date.now(),
    },
    null,
    2,
  );

  let fd;
  let createdIno = null;
  let createdDev = null;
  const writeSyncFn = options.writeSyncFn ?? writeSync;
  try {
    fd = openSync(lockFilePath, 'wx');
    const st = fstatSync(fd);
    createdIno = st.ino;
    createdDev = st.dev;

    // Write full buffer payload cleanly
    const buf = Buffer.from(payload, 'utf8');
    let written = 0;
    while (written < buf.length) {
      const bytesWritten = writeSyncFn(fd, buf, written, buf.length - written);
      if (bytesWritten <= 0) {
        throw new Error('Short write while recording browser lock payload');
      }
      written += bytesWritten;
    }
  } catch (err) {
    // If creation or writing failed after opening, clean up ONLY the inode this call created
    if (createdIno !== null && createdDev !== null) {
      try {
        const curStat = lstatSync(lockFilePath);
        if (!curStat.isSymbolicLink() && curStat.ino === createdIno && curStat.dev === createdDev) {
          unlinkSync(lockFilePath);
        }
      } catch (_cleanErr) {}
    }
    throw new Error(`Failed to exclusively acquire browser lock "${lockFilePath}": ${err.message}`);
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch (_e) {}
    }
  }

  let released = false;
  return {
    lockFilePath,
    port,
    pid,
    checkoutDir,
    suite,
    runResourceRoot,
    nonce,
    release: () => {
      if (released) return;
      released = true;
      try {
        const currentStat = lstatSync(lockFilePath);
        if (currentStat.isSymbolicLink()) {
          throw new Error(`Refusing to release lock: "${lockFilePath}" became a symbolic link`);
        }
        const content = readFileSync(lockFilePath, 'utf8');
        const parsed = JSON.parse(content);
        if (
          parsed.header !== LOCK_METADATA_HEADER ||
          parsed.nonce !== nonce ||
          parsed.pid !== pid
        ) {
          throw new Error('Refusing to release lock: lock metadata mismatched; not the creator.');
        }
        unlinkSync(lockFilePath);
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
    },
  };
}

export function readAndVerifyHeldLock(options = {}) {
  const port = options.port ?? BROWSER_PORT;
  const lockFilePath = options.lockFilePath ?? getBrowserLockPath(port);
  const expectedPid = options.pid;
  const expectedNonce = options.nonce;
  const expectedCheckout = options.checkoutDir
    ? realpathSync(options.checkoutDir)
    : realpathSync(process.cwd());
  const expectedSuite = options.suite;
  const expectedResourceRoot = options.runResourceRoot
    ? realpathSync(options.runResourceRoot)
    : undefined;

  let st;
  try {
    st = lstatSync(lockFilePath);
  } catch (err) {
    throw new Error(
      `Browser lock file does not exist or cannot be accessed at "${lockFilePath}": ${err.message}`,
    );
  }

  if (st.isSymbolicLink()) {
    throw new Error(`Browser lock file "${lockFilePath}" is a symbolic link. Rejection required.`);
  }
  if (!st.isFile()) {
    throw new Error(`Browser lock file "${lockFilePath}" is not a regular file.`);
  }

  let content;
  try {
    content = readFileSync(lockFilePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read browser lock file "${lockFilePath}": ${err.message}`);
  }

  let meta;
  try {
    meta = JSON.parse(content);
  } catch (_e) {
    throw new Error(`Browser lock file "${lockFilePath}" contains invalid JSON.`);
  }

  if (meta.header !== LOCK_METADATA_HEADER) {
    throw new Error(`Browser lock header mismatch in "${lockFilePath}".`);
  }
  if (meta.port !== port) {
    throw new Error(
      `Browser lock port mismatch in "${lockFilePath}": expected ${port}, found ${meta.port}`,
    );
  }

  // Validate live owner PID
  if (!Number.isInteger(meta.pid) || meta.pid <= 0) {
    throw new Error(`Browser lock PID "${meta.pid}" is not a valid integer process ID.`);
  }
  const checkAlive = options.isProcessAliveFn ?? isProcessAlive;
  if (!checkAlive(meta.pid)) {
    throw new Error(`Browser lock owner PID ${meta.pid} is dead. Stale lock fails closed.`);
  }

  if (expectedPid !== undefined && meta.pid !== expectedPid) {
    throw new Error(`Browser lock PID mismatch: expected ${expectedPid}, found ${meta.pid}`);
  }
  if (typeof meta.nonce !== 'string' || !meta.nonce) {
    throw new Error('Browser lock contains empty or invalid nonce');
  }
  if (expectedNonce !== undefined && meta.nonce !== expectedNonce) {
    throw new Error(`Browser lock nonce mismatch: expected ${expectedNonce}, found ${meta.nonce}`);
  }
  if (meta.checkoutDir !== expectedCheckout) {
    throw new Error(
      `Browser lock checkoutDir mismatch: expected "${expectedCheckout}", found "${meta.checkoutDir}"`,
    );
  }
  if (expectedSuite !== undefined && meta.suite !== expectedSuite) {
    throw new Error(
      `Browser lock suite mismatch: expected "${expectedSuite}", found "${meta.suite}"`,
    );
  }
  if (expectedResourceRoot !== undefined && meta.runResourceRoot !== expectedResourceRoot) {
    throw new Error(
      `Browser lock resourceRoot mismatch: expected "${expectedResourceRoot}", found "${meta.runResourceRoot}"`,
    );
  }

  return meta;
}
