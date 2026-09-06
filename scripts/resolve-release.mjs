import { appendFileSync } from 'node:fs';
import { resolveReleaseTarget } from './release-target.mjs';

function setGitHubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  } else {
    console.log(`[OUTPUT] ${name}=${value}`);
  }
}

export function runResolveReleaseCli(options = {}) {
  const exitFn = options.exitFn || ((code) => process.exit(code));
  try {
    const resolved = resolveReleaseTarget(options);
    console.log(
      `Resolved release target: ${resolved.targetSha} (version ${resolved.version}, event: ${resolved.eventType})`,
    );

    setGitHubOutput('target_sha', resolved.targetSha);
    setGitHubOutput('version', resolved.version);
    setGitHubOutput('event_type', resolved.eventType);
    return resolved;
  } catch (err) {
    console.error(`Release resolution error: ${err.message}`);
    exitFn(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runResolveReleaseCli();
}
