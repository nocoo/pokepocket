import { spawnSync } from 'node:child_process';

export function runGitRevParse(cwd = process.cwd()) {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    throw new Error(`git rev-parse HEAD failed with code ${res.status}: ${res.stderr?.trim()}`);
  }
  const sha = res.stdout?.trim();
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Invalid SHA returned from git rev-parse HEAD: "${sha}"`);
  }
  return sha;
}

export function validateGateShas(expectedSha, actualSha, jobName = 'job') {
  if (!expectedSha || !/^[0-9a-f]{40}$/i.test(expectedSha)) {
    throw new Error(`Expected SHA is missing or invalid: "${expectedSha}"`);
  }
  if (!actualSha || !/^[0-9a-f]{40}$/i.test(actualSha)) {
    throw new Error(`Actual SHA for ${jobName} is missing or invalid: "${actualSha}"`);
  }
  if (expectedSha.toLowerCase() !== actualSha.toLowerCase()) {
    throw new Error(
      `SHA mismatch for ${jobName}: expected "${expectedSha}", but got actual "${actualSha}"`,
    );
  }
  return true;
}

export function aggregateQualityResults(params) {
  const {
    expectedSha,
    results, // Record<jobName, { result: string, testedSha: string }>
  } = params;

  if (!expectedSha || !/^[0-9a-f]{40}$/i.test(expectedSha)) {
    throw new Error(`Aggregation failed: expectedSha "${expectedSha}" is missing or invalid.`);
  }

  const requiredJobs = [
    'code_quality',
    'integration_quality',
    'security_quality',
    'browser_quality',
  ];
  const missingJobs = requiredJobs.filter((job) => !results?.[job]);
  if (missingJobs.length > 0) {
    throw new Error(
      `Aggregation failed: missing results for required jobs: ${missingJobs.join(', ')}`,
    );
  }

  for (const job of requiredJobs) {
    const jobData = results[job];
    const { result, testedSha } = jobData;

    if (result !== 'success') {
      throw new Error(
        `Aggregation failed: job "${job}" concluded with "${result}" (expected "success").`,
      );
    }

    if (!testedSha || !/^[0-9a-f]{40}$/i.test(testedSha)) {
      throw new Error(
        `Aggregation failed: job "${job}" has missing or invalid testedSha: "${testedSha}".`,
      );
    }

    if (testedSha.toLowerCase() !== expectedSha.toLowerCase()) {
      throw new Error(
        `Aggregation failed: job "${job}" tested SHA "${testedSha}" does not match target SHA "${expectedSha}".`,
      );
    }
  }

  return {
    success: true,
    testedSha: expectedSha.toLowerCase(),
  };
}
