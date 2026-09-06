import { runL3Gate } from './run-l3.mjs';
import { pathToFileURL } from 'node:url';

export async function runL3Optional(options = {}) {
  return runL3Gate({ ...options, suite: 'optional' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runL3Optional();
}
