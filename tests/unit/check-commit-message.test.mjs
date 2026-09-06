import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ALLOWED_TYPES,
  checkCommitMessageFile,
  runCommitMsgHook,
  validateCommitMessage,
} from '../../scripts/check-commit-message.mjs';

describe('check-commit-message policy', () => {
  it('validates allowed Conventional Commit types in lowercase without scope', () => {
    for (const type of ALLOWED_TYPES) {
      const res = validateCommitMessage(`${type}: valid short description`);
      expect(res.valid).toBe(true);
    }
  });

  it('rejects commit messages with scopes', () => {
    const res = validateCommitMessage('feat(ui): some description');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('with no scope');
  });

  it('rejects disallowed types', () => {
    const res = validateCommitMessage('foo: some description');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Commit type "foo" is not allowed');
  });

  it('rejects messages longer than 50 characters on the first line', () => {
    const longDesc = 'a'.repeat(45);
    const msg = `feat: ${longDesc}`;
    expect(msg.length).toBeGreaterThan(50);
    const res = validateCommitMessage(msg);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('exceeds 50 characters');
  });

  it('accepts messages exactly 50 characters', () => {
    const msg = `feat: ${'a'.repeat(44)}`;
    expect(msg.length).toBe(50);
    const res = validateCommitMessage(msg);
    expect(res.valid).toBe(true);
  });

  it('rejects uppercase letters anywhere in the first line', () => {
    const res1 = validateCommitMessage('Feat: uppercase type');
    expect(res1.valid).toBe(false);

    const res2 = validateCommitMessage('feat: Uppercase description');
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('must be all lowercase');
  });

  it('rejects empty or whitespace-only messages and empty descriptions', () => {
    expect(validateCommitMessage('').valid).toBe(false);
    expect(validateCommitMessage('   \n\n').valid).toBe(false);
    expect(validateCommitMessage(null).valid).toBe(false);
    expect(validateCommitMessage('feat:   ').valid).toBe(false);
  });

  it('handles CRLF line endings and ignores subsequent lines for length check', () => {
    const msg =
      'fix: short header\r\n\r\nThis is a longer body that would exceed 50 characters.\r\n';
    const res = validateCommitMessage(msg);
    expect(res.valid).toBe(true);
  });

  it('reads message file via checkCommitMessageFile and runCommitMsgHook', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'commit-msg-test-'));
    const savedExitCode = process.exitCode;
    try {
      const validPath = path.join(tempDir, 'valid.txt');
      await writeFile(validPath, 'chore: valid commit\n');
      expect(checkCommitMessageFile(validPath).valid).toBe(true);
      expect(runCommitMsgHook([validPath])).toBe(true);

      const invalidPath = path.join(tempDir, 'invalid.txt');
      await writeFile(invalidPath, 'Bad: Invalid commit\n');
      expect(checkCommitMessageFile(invalidPath).valid).toBe(false);
      expect(runCommitMsgHook([invalidPath])).toBe(false);

      // No file provided to runCommitMsgHook
      expect(runCommitMsgHook([])).toBe(false);
    } finally {
      process.exitCode = savedExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  it('handles non-string message input in validateCommitMessage', () => {
    const res = validateCommitMessage(12345);
    expect(res.valid).toBe(false);
    expect(res.error).toBe('Commit message must be a string');
  });

  it('handles default argv in runCommitMsgHook', () => {
    const savedExitCode = process.exitCode;
    const origArgv = process.argv;
    const origError = console.error;
    console.error = () => {};
    try {
      process.argv = [process.argv[0], process.argv[1]];
      expect(runCommitMsgHook()).toBe(false);
    } finally {
      process.argv = origArgv;
      console.error = origError;
      process.exitCode = savedExitCode;
    }
  });
});
