import { readFileSync } from 'node:fs';
import { runGit, verifyDeployTarget } from './release-target.mjs';

export function runVerifyDeployCli(options = {}) {
  const exitFn = options.exitFn || ((code) => process.exit(code));
  try {
    const eventName = options.eventName ?? process.env.EVENT_NAME;
    const expectedSha = options.expectedSha ?? process.env.EXPECTED_SHA;
    const resolvedSha = options.resolvedSha ?? process.env.RESOLVED_SHA;
    const expectedVersion = options.expectedVersion ?? process.env.EXPECTED_VERSION;
    const cwd = options.cwd ?? process.cwd();
    const remote = options.remote ?? 'origin';

    const currentSha = runGit(['rev-parse', 'HEAD'], cwd);
    const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8'));
    const currentVersion = pkg.version;

    const res = verifyDeployTarget({
      eventName,
      expectedSha,
      resolvedSha,
      currentSha,
      expectedVersion,
      currentVersion,
      cwd,
      remote,
    });

    console.log(
      `Verified deploy target: commit ${currentSha} matches target ${expectedSha} at version ${currentVersion}`,
    );
    return res;
  } catch (err) {
    console.error(`Deploy verification error: ${err.message}`);
    exitFn(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runVerifyDeployCli();
}
