import { describe, expect, it } from 'vitest';
import {
  checkGitObjectExists,
  determineDirectScanRange,
  determinePushScanRanges,
  loadQualityToolsConfig,
  parseCliPrePushInput,
  parsePrePushInput,
  parseScannerVersion,
  redactSecrets,
  runG2Gate,
  runGitleaksScan,
  runOsvScanner,
  runProcessCapture,
  verifyScannerVersion,
} from '../../scripts/run-g2.mjs';

describe('run-g2 policy and unit logic', () => {
  describe('loadQualityToolsConfig', () => {
    it('loads and pins exact versions of osv-scanner and gitleaks', () => {
      const config = loadQualityToolsConfig();
      expect(config.scanners).toBeDefined();
      expect(config.scanners.osv).toEqual({
        name: 'osv-scanner',
        version: '2.5.1',
      });
      expect(config.scanners.gitleaks).toEqual({
        name: 'gitleaks',
        version: '8.30.1',
      });
    });
  });

  describe('parseScannerVersion', () => {
    it('parses osv-scanner output anchored to the version line', () => {
      const output = 'osv-scanner version: 2.5.1\nosv-scalibr version: 0.5.2\ncommit: n/a\n';
      expect(parseScannerVersion('osv', output)).toBe('2.5.1');
      expect(parseScannerVersion('osv-scanner', output)).toBe('2.5.1');
    });

    it('rejects malformed or unanchored osv output', () => {
      expect(parseScannerVersion('osv', 'other-tool osv-scanner version: 2.5.1')).toBeNull();
      expect(parseScannerVersion('osv', 'no version here')).toBeNull();
      expect(parseScannerVersion('osv', null)).toBeNull();
    });

    it('parses gitleaks version strictly on isolated line and strips leading v', () => {
      expect(parseScannerVersion('gitleaks', '8.30.1\n')).toBe('8.30.1');
      expect(parseScannerVersion('gitleaks', 'v8.30.1')).toBe('8.30.1');
      expect(parseScannerVersion('gitleaks', '  8.30.1  \n')).toBe('8.30.1');
    });

    it('anchors gitleaks parsing and preserves extra suffixes so mismatched tags fail comparison', () => {
      expect(parseScannerVersion('gitleaks', '8.30.1-extra\n')).toBe('8.30.1-extra');
      expect(parseScannerVersion('gitleaks', 'prefix 8.30.1')).toBeNull();
      expect(parseScannerVersion('gitleaks', '8.30.1 suffix')).toBeNull();
    });

    it('returns null for unknown scanner key', () => {
      expect(parseScannerVersion('unknown', '1.0.0')).toBeNull();
    });
  });

  describe('redactSecrets', () => {
    it('redacts runtime-synthesized token formats and Secret labels without hardcoded literals', () => {
      // Synthesize token formats dynamically so no secret literals exist in source
      const ghPrefix = ['gh', 'p_'].join('');
      const glPrefix = ['gl', 'pat-'].join('');
      const jwtPrefix = ['ey', 'JhbGci'].join('');

      const synthGhToken = `${ghPrefix}${'0'.repeat(36)}`;
      const synthGlToken = `${glPrefix}${'a'.repeat(20)}`;
      const synthJwt = `${jwtPrefix}OiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummyPayload.signature`;

      const raw = [
        'Finding: secret found',
        `Secret: ${synthGhToken}`,
        `authorization: ${synthGhToken}`,
        `gitlab: ${synthGlToken}`,
        `jwt: ${synthJwt}`,
      ].join('\n');

      const redacted = redactSecrets(raw);
      expect(redacted).not.toContain(synthGhToken);
      expect(redacted).not.toContain(synthGlToken);
      expect(redacted).not.toContain(synthJwt);
      expect(redacted).toContain('Secret: [REDACTED]');
    });

    it('returns empty string for non-string input', () => {
      expect(redactSecrets(null)).toBe('');
      expect(redactSecrets(undefined)).toBe('');
    });
  });

  describe('verifyScannerVersion', () => {
    it('succeeds when version matches exact pin', async () => {
      const mockRunner = async (cmd) => {
        if (cmd === 'osv-scanner') {
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        }
        return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
      };

      const resOsv = await verifyScannerVersion('osv', { runner: mockRunner });
      expect(resOsv.actualVersion).toBe('2.5.1');

      const resGitleaks = await verifyScannerVersion('gitleaks', { runner: mockRunner });
      expect(resGitleaks.actualVersion).toBe('8.30.1');
    });

    it('throws error when scanner is undefined in configuration', async () => {
      await expect(
        verifyScannerVersion('nonexistent', { runner: async () => ({}) }),
      ).rejects.toThrow(/not defined in quality-tools/);
    });

    it('throws error when binary execution fails or is missing', async () => {
      const mockRunner = async () => {
        throw new Error('ENOENT: spawn failed');
      };
      await expect(verifyScannerVersion('osv', { runner: mockRunner })).rejects.toThrow(
        /Failed to execute osv-scanner/i,
      );
    });

    it('throws error when scanner terminates by signal', async () => {
      const mockRunner = async () => ({ code: null, signal: 'SIGKILL', stdout: '', stderr: '' });
      await expect(verifyScannerVersion('osv', { runner: mockRunner })).rejects.toThrow(
        /terminated by signal SIGKILL/i,
      );
    });

    it('throws error when scanner returns non-zero code', async () => {
      const mockRunner = async () => ({ code: 1, signal: null, stdout: '', stderr: 'error 123' });
      await expect(verifyScannerVersion('osv', { runner: mockRunner })).rejects.toThrow(
        /failed with exit code 1/i,
      );
    });

    it('throws error on version mismatch', async () => {
      const mockRunner = async () => ({
        code: 0,
        signal: null,
        stdout: 'osv-scanner version: 2.5.0\n',
        stderr: '',
      });
      await expect(verifyScannerVersion('osv', { runner: mockRunner })).rejects.toThrow(
        /expected exact version "2.5.1", but found "2.5.0"/,
      );
    });

    it('throws error on version mismatch for anchored gitleaks tags', async () => {
      const mockRunner = async () => ({
        code: 0,
        signal: null,
        stdout: '8.30.1-custom\n',
        stderr: '',
      });
      await expect(verifyScannerVersion('gitleaks', { runner: mockRunner })).rejects.toThrow(
        /expected exact version "8.30.1", but found "8.30.1-custom"/,
      );
    });
  });

  describe('parsePrePushInput', () => {
    const validLocalSha = '1111111111111111111111111111111111111111';
    const validRemoteSha = '2222222222222222222222222222222222222222';
    const zeroSha = '0000000000000000000000000000000000000000';

    it('parses empty input safely to an empty array', () => {
      expect(parsePrePushInput('')).toEqual([]);
      expect(parsePrePushInput('   \n  ')).toEqual([]);
    });

    it('throws when input is not a string', () => {
      expect(() => parsePrePushInput(null)).toThrow(/must be a string/);
    });

    it('parses multi-ref rows correctly', () => {
      const input = [
        `refs/heads/main ${validLocalSha} refs/heads/main ${validRemoteSha}`,
        `refs/heads/feature ${validLocalSha} refs/heads/feature ${zeroSha}`,
        `refs/heads/old ${zeroSha} refs/heads/old ${validRemoteSha}`,
      ].join('\n');

      const rows = parsePrePushInput(input);
      expect(rows).toHaveLength(3);

      expect(rows[0]).toEqual({
        localRef: 'refs/heads/main',
        localSha: validLocalSha,
        remoteRef: 'refs/heads/main',
        remoteSha: validRemoteSha,
        isDelete: false,
        isNewBranch: false,
      });

      expect(rows[1].isNewBranch).toBe(true);
      expect(rows[1].isDelete).toBe(false);

      expect(rows[2].isDelete).toBe(true);
      expect(rows[2].isNewBranch).toBe(false);
    });

    it('throws on malformed line with incorrect field count', () => {
      expect(() => parsePrePushInput('refs/heads/main abc')).toThrow(
        /Malformed pre-push input line 1/,
      );
    });

    it('throws on invalid local SHA', () => {
      expect(() =>
        parsePrePushInput(`refs/heads/main invalid-sha refs/heads/main ${validRemoteSha}`),
      ).toThrow(/Invalid local SHA on line 1/);
    });

    it('throws on invalid remote SHA', () => {
      expect(() =>
        parsePrePushInput(`refs/heads/main ${validLocalSha} refs/heads/main bad-remote`),
      ).toThrow(/Invalid remote SHA on line 1/);
    });
  });

  describe('determinePushScanRanges and checkGitObjectExists', () => {
    const localSha = '1111111111111111111111111111111111111111';
    const remoteSha = '2222222222222222222222222222222222222222';
    const zeroSha = '0000000000000000000000000000000000000000';

    it('omits deleted branches from history scan', async () => {
      const rows = [
        {
          localRef: 'refs/heads/branch-to-delete',
          localSha: zeroSha,
          remoteRef: 'refs/heads/branch-to-delete',
          remoteSha,
          isDelete: true,
          isNewBranch: false,
        },
      ];

      const ranges = await determinePushScanRanges(rows);
      expect(ranges).toEqual([]);
    });

    it('uses full local ancestry with -m for new branches', async () => {
      const rows = [
        {
          localRef: 'refs/heads/new-branch',
          localSha,
          remoteRef: 'refs/heads/new-branch',
          remoteSha: zeroSha,
          isDelete: false,
          isNewBranch: true,
        },
      ];

      const ranges = await determinePushScanRanges(rows);
      expect(ranges).toEqual([
        {
          ref: 'refs/heads/new-branch',
          logOpts: `-m ${localSha}`,
        },
      ]);
    });

    it('uses remoteSha..localSha with -m when remote object exists locally', async () => {
      const rows = [
        {
          localRef: 'refs/heads/feature',
          localSha,
          remoteRef: 'refs/heads/feature',
          remoteSha,
          isDelete: false,
          isNewBranch: false,
        },
      ];

      const objectChecker = async (sha) => sha === remoteSha;
      const ranges = await determinePushScanRanges(rows, { objectChecker });

      expect(ranges).toEqual([
        {
          ref: 'refs/heads/feature',
          logOpts: `-m ${remoteSha}..${localSha}`,
        },
      ]);
    });

    it('conservatively scans full local ancestry with -m when remote object is missing locally', async () => {
      const rows = [
        {
          localRef: 'refs/heads/feature',
          localSha,
          remoteRef: 'refs/heads/feature',
          remoteSha,
          isDelete: false,
          isNewBranch: false,
        },
      ];

      const objectChecker = async () => false;
      const ranges = await determinePushScanRanges(rows, { objectChecker });

      expect(ranges).toEqual([
        {
          ref: 'refs/heads/feature',
          logOpts: `-m ${localSha}`,
        },
      ]);
    });

    it('checkGitObjectExists returns true on exit code 0 and false on error/failure', async () => {
      const mockSuccessRunner = async () => ({ code: 0, signal: null, stdout: '', stderr: '' });
      expect(await checkGitObjectExists('abc', { runner: mockSuccessRunner })).toBe(true);

      const mockFailureRunner = async () => ({ code: 1, signal: null, stdout: '', stderr: '' });
      expect(await checkGitObjectExists('abc', { runner: mockFailureRunner })).toBe(false);

      const mockThrowRunner = async () => {
        throw new Error('git failed');
      };
      expect(await checkGitObjectExists('abc', { runner: mockThrowRunner })).toBe(false);
    });
  });

  describe('determineDirectScanRange', () => {
    it('always scans full committed HEAD ancestry with -m', () => {
      expect(determineDirectScanRange()).toBe('-m HEAD');
    });
  });

  describe('runOsvScanner and runGitleaksScan', () => {
    it('passes bun.lock without allow-no-lockfiles or skip flags', async () => {
      let executedCommand = null;
      let executedArgs = null;

      const mockRunner = async (cmd, args) => {
        executedCommand = cmd;
        executedArgs = args;
        return { code: 0, signal: null, stdout: 'No issues found', stderr: '' };
      };

      await runOsvScanner({ runner: mockRunner, cwd: '/app' });
      expect(executedCommand).toBe('osv-scanner');
      expect(executedArgs).toEqual(['scan', '--lockfile=/app/bun.lock']);
    });

    it('fails closed when osv-scanner encounters findings', async () => {
      const mockRunner = async () => ({
        code: 1,
        signal: null,
        stdout: 'Vulnerability found: CVE-2026-9999',
        stderr: '',
      });

      await expect(runOsvScanner({ runner: mockRunner })).rejects.toThrow(
        /osv-scanner found vulnerabilities or failed/,
      );
    });

    it('invokes gitleaks with required security flags and log-opts', async () => {
      let executedArgs = null;
      const mockRunner = async (_cmd, args) => {
        executedArgs = args;
        return { code: 0, signal: null, stdout: 'no leaks found', stderr: '' };
      };

      await runGitleaksScan('-m HEAD', { runner: mockRunner, cwd: '/app' });
      expect(executedArgs).toEqual([
        'git',
        '--log-opts=-m HEAD',
        '--gitleaks-ignore-path=/app/.gitleaksignore',
        '--redact=100',
        '--no-banner',
        '--no-color',
      ]);
    });

    it('fails closed and redacts findings when gitleaks detects secrets', async () => {
      const synthPrefix = ['gh', 'p_'].join('');
      const synthSecret = `${synthPrefix}${'9'.repeat(36)}`;
      const mockRunner = async () => ({
        code: 1,
        signal: null,
        stdout: `Finding: Secret: ${synthSecret}`,
        stderr: '',
      });

      await expect(runGitleaksScan('-m HEAD', { runner: mockRunner })).rejects.toThrow(
        /gitleaks detected secrets/,
      );
      try {
        await runGitleaksScan('-m HEAD', { runner: mockRunner });
      } catch (err) {
        expect(err.message).not.toContain(synthSecret);
        expect(err.message).toContain('[REDACTED]');
      }
    });
  });

  describe('runProcessCapture lifecycle and escalation', () => {
    it('times out, escalates to SIGKILL if parent closes on TERM, and awaits group cleanup completion', async () => {
      const killCalls = [];
      const listeners = {};
      const pendingTimers = [];

      const fakeChild = {
        pid: 88888,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, cb) => {
          listeners[event] = cb;
        },
      };

      const origKill = process.kill;
      let escalationFinishedResolve;
      const escalationFinished = new Promise((resolve) => {
        escalationFinishedResolve = resolve;
      });

      process.kill = (targetPid, signal) => {
        killCalls.push({ targetPid, signal });
        if (signal === 'SIGTERM') {
          // Asynchronously queue the close event as a real child process does
          const timer = setTimeout(() => {
            listeners.close?.(0, null);
          }, 0);
          pendingTimers.push(timer);
        } else if (signal === 'SIGKILL') {
          escalationFinishedResolve();
        }
      };

      try {
        const mockSpawn = () => fakeChild;
        const promise = runProcessCapture('stub-cmd', ['arg1'], {
          spawnFn: mockSpawn,
          timeoutMs: 15,
          escalationGraceMs: 25,
        });

        await expect(promise).rejects.toThrow(/timed out after 15ms/);
        await escalationFinished;
        expect(killCalls.map((c) => ({ targetPid: c.targetPid, signal: c.signal }))).toEqual([
          { targetPid: -88888, signal: 'SIGTERM' },
          { targetPid: -88888, signal: 'SIGKILL' },
        ]);
      } finally {
        for (const timer of pendingTimers) clearTimeout(timer);
        process.kill = origKill;
      }
    });

    it('cleans up process group immediately and rejects when external signal aborts', async () => {
      const killCalls = [];
      const listeners = {};
      const pendingTimers = [];

      const fakeChild = {
        pid: 77777,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, cb) => {
          listeners[event] = cb;
        },
      };

      const origKill = process.kill;
      let escalationFinishedResolve;
      const escalationFinished = new Promise((resolve) => {
        escalationFinishedResolve = resolve;
      });

      process.kill = (targetPid, signal) => {
        killCalls.push({ targetPid, signal });
        if (signal === 'SIGTERM') {
          const timer = setTimeout(() => {
            listeners.close?.(0, null);
          }, 0);
          pendingTimers.push(timer);
        } else if (signal === 'SIGKILL') {
          escalationFinishedResolve();
        }
      };

      const controller = new AbortController();
      try {
        const mockSpawn = () => fakeChild;
        const promise = runProcessCapture('stub-cmd', ['arg1'], {
          spawnFn: mockSpawn,
          signal: controller.signal,
          escalationGraceMs: 20,
        });

        controller.abort();
        await expect(promise).rejects.toThrow(/aborted by signal/);
        await escalationFinished;
        expect(killCalls.map((c) => ({ targetPid: c.targetPid, signal: c.signal }))).toEqual([
          { targetPid: -77777, signal: 'SIGTERM' },
          { targetPid: -77777, signal: 'SIGKILL' },
        ]);
      } finally {
        for (const timer of pendingTimers) clearTimeout(timer);
        process.kill = origKill;
      }
    });
  });

  describe('runG2Gate orchestration', () => {
    it('runs version checks, lockfile scan, and history scan in direct mode', async () => {
      const commandsRun = [];
      const mockRunner = async (cmd, args) => {
        commandsRun.push({ cmd, args });
        if (cmd === 'osv-scanner') {
          if (args[0] === '--version')
            return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
          return { code: 0, signal: null, stdout: 'No issues found', stderr: '' };
        }
        if (cmd === 'gitleaks') {
          if (args[0] === 'version')
            return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
          return { code: 0, signal: null, stdout: 'no leaks found', stderr: '' };
        }
        return { code: 0, signal: null, stdout: '', stderr: '' };
      };

      const ok = await runG2Gate({ runner: mockRunner, silent: true, listenToProcess: false });
      expect(ok).toBe(true);

      const commandNames = commandsRun.map((c) => c.cmd);
      expect(commandNames).toContain('osv-scanner');
      expect(commandNames).toContain('gitleaks');

      const gitleaksCall = commandsRun.find((c) => c.cmd === 'gitleaks' && c.args[0] === 'git');
      expect(gitleaksCall.args).toContain('--log-opts=-m HEAD');
    });

    it('aborts and fails closed when external AbortSignal is aborted', async () => {
      const savedExitCode = process.exitCode;
      const controller = new AbortController();
      const mockRunner = async (_cmd, _args, opts) => {
        if (opts.signal?.aborted) {
          throw new Error('Aborted by signal');
        }
        return new Promise((_, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('Aborted by signal')), {
            once: true,
          });
        });
      };

      try {
        const promise = runG2Gate({
          runner: mockRunner,
          silent: true,
          listenToProcess: false,
          signal: controller.signal,
        });
        controller.abort();
        const ok = await promise;
        expect(ok).toBe(false);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = savedExitCode;
      }
    });

    it('returns false and sets exitCode 1 on error in silent mode', async () => {
      const savedExitCode = process.exitCode;
      const mockRunner = async () => {
        throw new Error('Command failed');
      };

      try {
        const ok = await runG2Gate({ runner: mockRunner, silent: true, listenToProcess: false });
        expect(ok).toBe(false);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = savedExitCode;
      }
    });
  });
});

describe('runG2Gate CLI entry and signal handling', () => {
  it('handles SIGINT and maps exitCode to 130', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');
    try {
      const mockHangingRunner = async (_cmd, args, opts) => {
        if (args[0] === '--version')
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        if (args[0] === 'version') return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };

        return new Promise((_, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new Error('Process execution aborted by signal'));
          });
        });
      };

      setTimeout(() => {
        process.emit('SIGINT');
      }, 20);

      const ok = await runG2Gate({
        runner: mockHangingRunner,
        silent: true,
        listenToProcess: true,
      });
      expect(ok).toBe(false);
      expect(process.exitCode).toBe(130);
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('handles SIGTERM and maps exitCode to 143', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');
    try {
      const mockHangingRunner = async (_cmd, args, opts) => {
        if (args[0] === '--version')
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        if (args[0] === 'version') return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };

        return new Promise((_, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new Error('Process execution aborted by signal'));
          });
        });
      };

      setTimeout(() => {
        process.emit('SIGTERM');
      }, 20);

      const ok = await runG2Gate({
        runner: mockHangingRunner,
        silent: true,
        listenToProcess: true,
      });
      expect(ok).toBe(false);
      expect(process.exitCode).toBe(143);
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      process.exitCode = savedExitCode;
    }
  });

  it('retains owned listeners during deferred runner settlement with repeated and mixed signals (SIGTERM first), preserves first abort status, and keeps gate pending until settlement', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveScanEntered;
    const scanEntered = new Promise((resolve) => {
      resolveScanEntered = resolve;
    });

    let releaseScan;
    const scanDeferred = new Promise((resolve) => {
      releaseScan = resolve;
    });

    let capturedScanSignal = null;
    let gateSettled = false;

    const mockDeferredRunner = async (_cmd, args, opts) => {
      if (args[0] === '--version') {
        return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
      }
      if (args[0] === 'version') {
        return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
      }

      // Finish valid version responses before holding the actual scan
      capturedScanSignal = opts.signal;
      resolveScanEntered();
      await scanDeferred;
      if (opts.signal?.aborted) {
        throw new Error(opts.signal.reason?.message || 'Scan aborted');
      }
      return { code: 0, signal: null, stdout: 'Scan ok', stderr: '' };
    };

    let gatePromise;
    try {
      gatePromise = runG2Gate({
        runner: mockDeferredRunner,
        silent: true,
        listenToProcess: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      await scanEntered;

      // Identify exact owned listeners
      const currentSigtermListeners = process.listeners('SIGTERM');
      const currentSigintListeners = process.listeners('SIGINT');
      expect(currentSigtermListeners.length).toBe(initialSigterm.length + 1);
      expect(currentSigintListeners.length).toBe(initialSigint.length + 1);
      const ownedSigtermListener = currentSigtermListeners.find(
        (fn) => !initialSigterm.includes(fn),
      );
      const ownedSigintListener = currentSigintListeners.find((fn) => !initialSigint.includes(fn));
      expect(ownedSigtermListener).toBeDefined();
      expect(ownedSigintListener).toBeDefined();

      // Emit first signal: SIGTERM
      process.emit('SIGTERM');

      // Assert owned listeners remain attached (not dropped by process.once)
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(capturedScanSignal.aborted).toBe(true);
      expect(capturedScanSignal.reason?.message).toBe('G2 gate interrupted by SIGTERM');

      // Emit repeat signal, then other signal
      process.emit('SIGTERM');
      process.emit('SIGINT');

      // Assert owned listeners still remain attached and reason preserved
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(capturedScanSignal.reason?.message).toBe('G2 gate interrupted by SIGTERM');

      // Verify gate remains pending while runner settlement is delayed
      expect(gateSettled).toBe(false);

      // Release runner to settle and reject
      releaseScan();

      const ok = await gatePromise;
      expect(ok).toBe(false);
      // First signal status (SIGTERM -> 143) survives despite subsequent SIGINT
      expect(process.exitCode).toBe(143);

      // Listener arrays are fully restored
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseScan) {
        releaseScan();
      }
      if (gatePromise) {
        await gatePromise.catch(() => {});
      }
      process.exitCode = savedExitCode;
    }
  });

  it('retains owned listeners during deferred runner settlement with repeated and mixed signals (SIGINT first), preserves first abort status, and keeps gate pending until settlement', async () => {
    const savedExitCode = process.exitCode;
    const initialSigint = process.listeners('SIGINT');
    const initialSigterm = process.listeners('SIGTERM');

    let resolveScanEntered;
    const scanEntered = new Promise((resolve) => {
      resolveScanEntered = resolve;
    });

    let releaseScan;
    const scanDeferred = new Promise((resolve) => {
      releaseScan = resolve;
    });

    let capturedScanSignal = null;
    let gateSettled = false;

    const mockDeferredRunner = async (_cmd, args, opts) => {
      if (args[0] === '--version') {
        return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
      }
      if (args[0] === 'version') {
        return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
      }

      // Finish valid version responses before holding the actual scan
      capturedScanSignal = opts.signal;
      resolveScanEntered();
      await scanDeferred;
      if (opts.signal?.aborted) {
        throw new Error(opts.signal.reason?.message || 'Scan aborted');
      }
      return { code: 0, signal: null, stdout: 'Scan ok', stderr: '' };
    };

    let gatePromise;
    try {
      gatePromise = runG2Gate({
        runner: mockDeferredRunner,
        silent: true,
        listenToProcess: true,
      });
      gatePromise.finally(() => {
        gateSettled = true;
      });

      await scanEntered;

      // Identify exact owned listeners
      const currentSigtermListeners = process.listeners('SIGTERM');
      const currentSigintListeners = process.listeners('SIGINT');
      expect(currentSigtermListeners.length).toBe(initialSigterm.length + 1);
      expect(currentSigintListeners.length).toBe(initialSigint.length + 1);
      const ownedSigtermListener = currentSigtermListeners.find(
        (fn) => !initialSigterm.includes(fn),
      );
      const ownedSigintListener = currentSigintListeners.find((fn) => !initialSigint.includes(fn));
      expect(ownedSigtermListener).toBeDefined();
      expect(ownedSigintListener).toBeDefined();

      // Emit first signal: SIGINT
      process.emit('SIGINT');

      // Assert owned listeners remain attached (not dropped by process.once)
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(capturedScanSignal.aborted).toBe(true);
      expect(capturedScanSignal.reason?.message).toBe('G2 gate interrupted by SIGINT');

      // Emit repeat signal, then other signal
      process.emit('SIGINT');
      process.emit('SIGTERM');

      // Assert owned listeners still remain attached and reason preserved
      expect(process.listeners('SIGTERM')).toContain(ownedSigtermListener);
      expect(process.listeners('SIGINT')).toContain(ownedSigintListener);
      expect(capturedScanSignal.reason?.message).toBe('G2 gate interrupted by SIGINT');

      // Verify gate remains pending while runner settlement is delayed
      expect(gateSettled).toBe(false);

      // Release runner to settle and reject
      releaseScan();

      const ok = await gatePromise;
      expect(ok).toBe(false);
      // First signal status (SIGINT -> 130) survives despite subsequent SIGTERM
      expect(process.exitCode).toBe(130);

      // Listener arrays are fully restored
      expect(process.listeners('SIGINT')).toEqual(initialSigint);
      expect(process.listeners('SIGTERM')).toEqual(initialSigterm);
    } finally {
      if (releaseScan) {
        releaseScan();
      }
      if (gatePromise) {
        await gatePromise.catch(() => {});
      }
      process.exitCode = savedExitCode;
    }
  });

  it('handles push mode with multi-ref input in runG2Gate', async () => {
    const rangesScanned = [];
    const validLocalSha = '1111111111111111111111111111111111111111';
    const validRemoteSha = '2222222222222222222222222222222222222222';
    const zeroSha = '0000000000000000000000000000000000000000';

    const mockRunner = async (cmd, args) => {
      if (cmd === 'osv-scanner') {
        if (args[0] === '--version')
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        return { code: 0, signal: null, stdout: 'No issues found', stderr: '' };
      }
      if (cmd === 'gitleaks') {
        if (args[0] === 'version') return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
        const logOpts = args.find((a) => a.startsWith('--log-opts=')).replace('--log-opts=', '');
        rangesScanned.push(logOpts);
        return { code: 0, signal: null, stdout: 'no leaks found', stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'cat-file') {
        return { code: 0, signal: null, stdout: '', stderr: '' };
      }
      return { code: 0, signal: null, stdout: '', stderr: '' };
    };

    const pushInput = [
      `refs/heads/main ${validLocalSha} refs/heads/main ${validRemoteSha}`,
      `refs/heads/new ${validLocalSha} refs/heads/new ${zeroSha}`,
      `refs/heads/del ${zeroSha} refs/heads/del ${validRemoteSha}`,
    ].join('\n');

    const ok = await runG2Gate({
      runner: mockRunner,
      prePushInput: pushInput,
      silent: true,
      listenToProcess: false,
    });

    expect(ok).toBe(true);
    expect(rangesScanned).toEqual([
      `-m ${validRemoteSha}..${validLocalSha}`,
      `-m ${validLocalSha}`,
    ]);
  });
});

describe('runG2Gate CLI entry options and branches', () => {
  it('covers runProcessCapture abort before start and stdin write branch', async () => {
    const abortedCtrl = new AbortController();
    abortedCtrl.abort();
    await expect(runProcessCapture('stub', [], { signal: abortedCtrl.signal })).rejects.toThrow(
      /Process execution aborted before start/,
    );

    let writtenStdin = '';
    const fakeChild = {
      pid: 65432,
      stdin: {
        end: (data) => {
          writtenStdin = data;
        },
      },
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'close') setTimeout(() => cb(0, null), 5);
      },
    };

    const res = await runProcessCapture('stub', [], {
      spawnFn: () => fakeChild,
      stdinData: 'sample-stdin',
    });
    expect(res.code).toBe(0);
    expect(writtenStdin).toBe('sample-stdin');
  });

  it('covers non-silent reporting branches for OSV and Gitleaks', async () => {
    const origLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(' '));

    const mockRunner = async (cmd, args) => {
      if (cmd === 'osv-scanner') {
        if (args[0] === '--version')
          return { code: 0, signal: null, stdout: 'osv-scanner version: 2.5.1\n', stderr: '' };
        return { code: 0, signal: null, stdout: 'No issues found', stderr: '' };
      }
      if (cmd === 'gitleaks') {
        if (args[0] === 'version') return { code: 0, signal: null, stdout: '8.30.1\n', stderr: '' };
        return { code: 0, signal: null, stdout: 'no leaks found', stderr: '' };
      }
      return { code: 0, signal: null, stdout: '', stderr: '' };
    };

    try {
      const ok = await runG2Gate({ runner: mockRunner, silent: false, listenToProcess: false });
      expect(ok).toBe(true);
      expect(logs.some((l) => l.includes('OSV Scanner verified: 2.5.1'))).toBe(true);
      expect(logs.some((l) => l.includes('G2 security quality gates passed.'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it('covers non-silent error logging on gate failure', async () => {
    const savedExitCode = process.exitCode;
    const origErr = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));

    const failingRunner = async () => {
      throw new Error('Injected failure');
    };

    try {
      const ok = await runG2Gate({ runner: failingRunner, silent: false, listenToProcess: false });
      expect(ok).toBe(false);
      expect(errors.some((e) => e.includes('G2 Gate failed:'))).toBe(true);
    } finally {
      console.error = origErr;
      process.exitCode = savedExitCode;
    }
  });
});

describe('runProcessCapture nonzero/signal exit cleanup regression', () => {
  it('cleans up process group and awaits escalation when parent exits nonzero (e.g. code 17)', async () => {
    const killCalls = [];
    const listeners = {};
    const pendingTimers = [];

    const fakeChild = {
      pid: 66666,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        listeners[event] = cb;
      },
    };

    const origKill = process.kill;
    let escalationFinishedResolve;
    const escalationFinished = new Promise((resolve) => {
      escalationFinishedResolve = resolve;
    });

    process.kill = (targetPid, signal) => {
      killCalls.push({ targetPid, signal });
      if (signal === 'SIGTERM') {
        // Child group is being cleaned up
      } else if (signal === 'SIGKILL') {
        escalationFinishedResolve();
      }
    };

    try {
      const mockSpawn = () => fakeChild;
      const promise = runProcessCapture('stub-cmd', ['arg1'], {
        spawnFn: mockSpawn,
        escalationGraceMs: 20,
      });

      // Simulate parent process exiting code 17 while descendant is still alive
      setTimeout(() => {
        listeners.close?.(17, null);
      }, 0);

      const res = await promise;
      await escalationFinished;

      expect(res.code).toBe(17);
      expect(killCalls.map((c) => ({ targetPid: c.targetPid, signal: c.signal }))).toEqual([
        { targetPid: -66666, signal: 'SIGTERM' },
        { targetPid: -66666, signal: 'SIGKILL' },
      ]);
    } finally {
      for (const timer of pendingTimers) clearTimeout(timer);
      process.kill = origKill;
    }
  });
});

describe('parseCliPrePushInput policy', () => {
  it('returns non-pre-push when flag is not present', () => {
    const res = parseCliPrePushInput(['node', 'scripts/run-g2.mjs']);
    expect(res).toEqual({ isPrePush: false, pushInput: undefined });
  });

  it('parses explicit --input argument', () => {
    const res = parseCliPrePushInput([
      'node',
      'scripts/run-g2.mjs',
      '--pre-push',
      '--input',
      'refs/heads/m 1111111111111111111111111111111111111111 refs/heads/m 2222222222222222222222222222222222222222',
    ]);
    expect(res.isPrePush).toBe(true);
    expect(res.pushInput).toContain('refs/heads/m');
  });

  it('throws error when --input is missing its value argument', () => {
    expect(() =>
      parseCliPrePushInput(['node', 'scripts/run-g2.mjs', '--pre-push', '--input']),
    ).toThrow(/Flag --input specified without an input value/);

    expect(() =>
      parseCliPrePushInput(['node', 'scripts/run-g2.mjs', '--pre-push', '--input', '--other']),
    ).toThrow(/Flag --input specified without an input value/);
  });

  it('reads from stdin function in pre-push mode when --input is not provided', () => {
    const mockStdin = () => 'sample-stdin-data';
    const res = parseCliPrePushInput(['node', 'scripts/run-g2.mjs', '--pre-push'], mockStdin);
    expect(res).toEqual({ isPrePush: true, pushInput: 'sample-stdin-data' });
  });

  it('throws error when stdin read fails', () => {
    const failingStdin = () => {
      throw new Error('EPIPE on stdin');
    };
    expect(() =>
      parseCliPrePushInput(['node', 'scripts/run-g2.mjs', '--pre-push'], failingStdin),
    ).toThrow(/Failed to read pre-push input from stdin: EPIPE on stdin/);
  });
});

describe('runProcessCapture child error and empty pid edge branches', () => {
  it('handles child error event and preserves initiatingError', async () => {
    const killCalls = [];
    const listeners = {};
    const pendingTimers = [];

    const fakeChild = {
      pid: 55555,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        listeners[event] = cb;
        if (event === 'error') {
          const timer = setTimeout(() => cb(new Error('child emitted error')), 5);
          pendingTimers.push(timer);
        }
        if (event === 'close') {
          const timer = setTimeout(() => cb(1, null), 10);
          pendingTimers.push(timer);
        }
      },
    };

    const origKill = process.kill;
    let escalationFinishedResolve;
    const escalationFinished = new Promise((resolve) => {
      escalationFinishedResolve = resolve;
    });

    process.kill = (targetPid, signal) => {
      killCalls.push({ targetPid, signal });
      if (signal === 'SIGKILL') {
        escalationFinishedResolve();
      }
    };

    try {
      const mockSpawn = () => fakeChild;
      const promise = runProcessCapture('stub', [], {
        spawnFn: mockSpawn,
        escalationGraceMs: 15,
      });

      await expect(promise).rejects.toThrow(/child emitted error/);
      await escalationFinished;

      expect(killCalls.map((c) => ({ targetPid: c.targetPid, signal: c.signal }))).toEqual([
        { targetPid: -55555, signal: 'SIGTERM' },
        { targetPid: -55555, signal: 'SIGKILL' },
      ]);
    } finally {
      for (const timer of pendingTimers) clearTimeout(timer);
      process.kill = origKill;
    }
  });

  it('handles child without pid safely during cleanup', async () => {
    const fakeChild = {
      pid: undefined,
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event, cb) => {
        if (event === 'close') setTimeout(() => cb(1, null), 5);
      },
    };

    const res = await runProcessCapture('stub', [], { spawnFn: () => fakeChild });
    expect(res.code).toBe(1);
  });
});

describe('scanner signal-only termination branches', () => {
  it('runOsvScanner throws when terminated by signal', async () => {
    const mockRunner = async () => ({ code: null, signal: 'SIGKILL', stdout: '', stderr: '' });
    await expect(runOsvScanner({ runner: mockRunner })).rejects.toThrow(
      /osv-scanner terminated by signal SIGKILL/,
    );
  });

  it('runGitleaksScan throws when terminated by signal', async () => {
    const mockRunner = async () => ({ code: null, signal: 'SIGTERM', stdout: '', stderr: '' });
    await expect(runGitleaksScan('-m HEAD', { runner: mockRunner })).rejects.toThrow(
      /gitleaks terminated by signal SIGTERM/,
    );
  });
});
