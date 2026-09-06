import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOWED_TYPES = new Set(['fix', 'feat', 'docs', 'test', 'refactor', 'chore']);
export const COMMIT_MESSAGE_PATTERN = /^([a-z]+): (.+)$/;

export function validateCommitMessage(message) {
  if (typeof message !== 'string') {
    return { valid: false, error: 'Commit message must be a string' };
  }

  // Normalize line endings and get first line
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const firstLine = lines[0] ?? '';

  if (!firstLine.trim()) {
    return { valid: false, error: 'Commit message must not be empty' };
  }

  if (firstLine.length > 50) {
    return {
      valid: false,
      error: `Commit message header exceeds 50 characters (${firstLine.length}/50): "${firstLine}"`,
    };
  }

  // First line must be entirely lowercase
  if (firstLine.toLowerCase() !== firstLine) {
    return {
      valid: false,
      error: 'Commit message first line must be all lowercase',
    };
  }

  const match = COMMIT_MESSAGE_PATTERN.exec(firstLine);
  if (!match) {
    return {
      valid: false,
      error:
        'Commit message must match Conventional Commit format "<type>: <description>" with no scope',
    };
  }

  const [, type, description] = match;
  if (!ALLOWED_TYPES.has(type)) {
    return {
      valid: false,
      error: `Commit type "${type}" is not allowed. Allowed types: ${[...ALLOWED_TYPES].join(', ')}`,
    };
  }

  if (!description.trim()) {
    return { valid: false, error: 'Commit description must not be empty' };
  }

  return { valid: true };
}

export function checkCommitMessageFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return validateCommitMessage(content);
}

export function runCommitMsgHook(argv = process.argv.slice(2)) {
  const file = argv[0];
  if (!file) {
    console.error('Usage: node scripts/check-commit-message.mjs <commit-msg-file>');
    process.exitCode = 1;
    return false;
  }
  const result = checkCommitMessageFile(file);
  if (!result.valid) {
    console.error(`Invalid commit message: ${result.error}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommitMsgHook();
}
