import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const EXPECTED_WORKFLOW_NAME = 'CI';
export const EXPECTED_WORKFLOW_PATH = '.github/workflows/ci.yml';

export function runGit(args, cwd = process.cwd()) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${res.status}): ${res.stderr?.trim() || res.stdout?.trim()}`,
    );
  }
  return res.stdout.trim();
}

export function isValidSha(sha) {
  return (
    typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha.trim()) && !/^0{40}$/.test(sha.trim())
  );
}

export function isValidVersionTag(tag) {
  return typeof tag === 'string' && /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag.trim());
}

export function isValidVersion(version) {
  return typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(version.trim());
}

export function readPackageJsonAtCommit(commitSha, cwd = process.cwd()) {
  if (!isValidSha(commitSha)) {
    throw new Error(`Invalid commit SHA: "${commitSha}"`);
  }
  const content = runGit(['show', `${commitSha}:package.json`], cwd);
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse package.json at commit ${commitSha}: ${err.message}`);
  }
}

export function peelCommitSha(shaOrRef, cwd = process.cwd()) {
  if (!shaOrRef || typeof shaOrRef !== 'string') {
    throw new Error(`Invalid reference or object: "${shaOrRef}"`);
  }
  const peeled = runGit(['rev-parse', '--verify', `${shaOrRef}^{commit}`], cwd);
  if (!isValidSha(peeled)) {
    throw new Error(`Resolved object for "${shaOrRef}" is not a valid commit SHA: "${peeled}"`);
  }
  return peeled.toLowerCase();
}

export function resolveWorkflowRunRelease(payload, expectedRepo, cwd = process.cwd()) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Missing workflow_run payload');
  }

  if (!expectedRepo || typeof expectedRepo !== 'string') {
    throw new Error('Expected repository is required for workflow_run provenance validation');
  }

  const { workflow, workflow_run: run } = payload;
  if (!workflow || typeof workflow !== 'object') {
    throw new Error('Top-level workflow object is missing from payload');
  }
  if (!run || typeof run !== 'object') {
    throw new Error('workflow_run object is missing from payload');
  }

  // Required top-level workflow fields
  if (workflow.id === undefined || workflow.id === null) {
    throw new Error('Top-level workflow.id is missing from payload');
  }
  if (!workflow.name || typeof workflow.name !== 'string') {
    throw new Error('Top-level workflow.name is missing from payload');
  }
  if (!workflow.path || typeof workflow.path !== 'string') {
    throw new Error('Top-level workflow.path is missing from payload');
  }

  // Required workflow_run fields
  if (run.workflow_id === undefined || run.workflow_id === null) {
    throw new Error('workflow_run.workflow_id is missing from payload');
  }
  if (!run.name || typeof run.name !== 'string') {
    throw new Error('workflow_run.name is missing from payload');
  }
  if (!run.path || typeof run.path !== 'string') {
    throw new Error('workflow_run.path is missing from payload');
  }

  // Strict identity matching
  if (workflow.id !== run.workflow_id) {
    throw new Error(
      `workflow_id mismatch: payload workflow.id (${workflow.id}) != run.workflow_id (${run.workflow_id})`,
    );
  }
  if (workflow.name !== EXPECTED_WORKFLOW_NAME) {
    throw new Error(
      `Top-level workflow.name "${workflow.name}" does not match expected "${EXPECTED_WORKFLOW_NAME}"`,
    );
  }
  if (run.name !== EXPECTED_WORKFLOW_NAME) {
    throw new Error(
      `workflow_run.name "${run.name}" does not match expected "${EXPECTED_WORKFLOW_NAME}"`,
    );
  }
  if (workflow.path !== EXPECTED_WORKFLOW_PATH) {
    throw new Error(
      `Top-level workflow.path "${workflow.path}" does not match expected "${EXPECTED_WORKFLOW_PATH}"`,
    );
  }
  if (run.path !== EXPECTED_WORKFLOW_PATH) {
    throw new Error(
      `workflow_run.path "${run.path}" does not match expected "${EXPECTED_WORKFLOW_PATH}"`,
    );
  }

  // Provenance checks: event == 'push', branch == 'main', same repo, conclusion == 'success'
  if (run.event !== 'push') {
    throw new Error(
      `Rejected workflow_run event "${run.event}": only "push" events trigger release`,
    );
  }
  if (run.head_branch !== 'main') {
    throw new Error(
      `Rejected workflow_run branch "${run.head_branch}": only "main" branch triggers release`,
    );
  }

  const repoFullName = run.head_repository?.full_name;
  if (!repoFullName || repoFullName.toLowerCase() !== expectedRepo.toLowerCase()) {
    throw new Error(
      `Rejected workflow_run repository "${repoFullName}": does not match expected "${expectedRepo}"`,
    );
  }

  if (run.conclusion !== 'success') {
    throw new Error(
      `Rejected workflow_run conclusion "${run.conclusion}": only "success" triggers release`,
    );
  }

  const headSha = run.head_sha;
  if (!isValidSha(headSha)) {
    throw new Error(`Invalid or missing workflow_run.head_sha: "${headSha}"`);
  }

  // Peel and verify commit exists
  const peeledSha = peelCommitSha(headSha, cwd);
  if (peeledSha !== headSha.toLowerCase()) {
    throw new Error(`workflow_run head_sha "${headSha}" peeled to different commit "${peeledSha}"`);
  }

  // Read package.json at that commit
  const pkg = readPackageJsonAtCommit(peeledSha, cwd);
  const version = pkg.version;
  if (!isValidVersion(version)) {
    throw new Error(
      `package.json at commit ${peeledSha} is missing a valid semver version: "${version}"`,
    );
  }

  return {
    eventType: 'workflow_run',
    targetSha: peeledSha,
    version,
  };
}

export function resolveTagPushRelease(payload, cwd = process.cwd()) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Missing push payload');
  }

  const ref = payload.ref;
  if (typeof ref !== 'string' || !ref.startsWith('refs/tags/')) {
    throw new Error(`Invalid ref for tag push: "${ref}"`);
  }

  const tagName = ref.slice('refs/tags/'.length);
  if (!isValidVersionTag(tagName)) {
    throw new Error(`Invalid release tag format "${tagName}": must match vMAJOR.MINOR.PATCH`);
  }

  if (payload.deleted === true) {
    throw new Error(`Rejected tag deletion event for "${ref}"`);
  }

  // The pushed event target object SHA must be present in `after`
  const eventSha = payload.after;
  if (!isValidSha(eventSha)) {
    throw new Error(
      `Tag push event object SHA is missing or invalid in payload.after: "${eventSha}"`,
    );
  }

  // Peel the pushed event target object to a commit (distinguishes annotated tag object vs commit)
  const peeledSha = peelCommitSha(eventSha, cwd);

  // Validate package.json version matches tag
  const pkg = readPackageJsonAtCommit(peeledSha, cwd);
  const expectedVersion = tagName.slice(1); // strip leading 'v'
  if (!isValidVersion(pkg.version)) {
    throw new Error(
      `package.json at commit ${peeledSha} is missing a valid semver version: "${pkg.version}"`,
    );
  }
  if (pkg.version !== expectedVersion) {
    throw new Error(
      `Tag ${tagName} does not match package.json version ${pkg.version} at commit ${peeledSha}`,
    );
  }

  return {
    eventType: 'push',
    targetSha: peeledSha,
    version: pkg.version,
    tag: tagName,
  };
}

export function resolveDispatchRelease(inputTag, cwd = process.cwd()) {
  if (!inputTag || typeof inputTag !== 'string') {
    throw new Error('Missing or empty tag input for workflow_dispatch');
  }

  const trimmedTag = inputTag.trim();
  if (!isValidVersionTag(trimmedTag)) {
    throw new Error(`Invalid release tag format "${trimmedTag}": must match vMAJOR.MINOR.PATCH`);
  }

  // Resolve explicitly against fully-qualified refs/tags/... so branch of same name cannot substitute
  const fullRef = `refs/tags/${trimmedTag}`;
  const peeledSha = peelCommitSha(fullRef, cwd);

  // Validate package.json version matches tag
  const pkg = readPackageJsonAtCommit(peeledSha, cwd);
  const expectedVersion = trimmedTag.slice(1);
  if (!isValidVersion(pkg.version)) {
    throw new Error(
      `package.json at commit ${peeledSha} is missing a valid semver version: "${pkg.version}"`,
    );
  }
  if (pkg.version !== expectedVersion) {
    throw new Error(
      `Tag ${trimmedTag} does not match package.json version ${pkg.version} at commit ${peeledSha}`,
    );
  }

  return {
    eventType: 'workflow_dispatch',
    targetSha: peeledSha,
    version: pkg.version,
    tag: trimmedTag,
  };
}

export function resolveReleaseTarget(options = {}) {
  const eventName = options.eventName || process.env.EVENT_NAME;
  const eventPath = options.eventPath || process.env.EVENT_PATH;
  const repo = options.repo || process.env.GITHUB_REPOSITORY;
  const inputTag = options.inputTag ?? process.env.INPUT_TAG;
  const cwd = options.cwd || process.cwd();

  let payload = options.payload;
  if (!payload && eventPath) {
    try {
      payload = JSON.parse(readFileSync(eventPath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to read event payload from "${eventPath}": ${err.message}`);
    }
  }

  if (eventName === 'workflow_run') {
    return resolveWorkflowRunRelease(payload, repo, cwd);
  }

  if (eventName === 'push') {
    return resolveTagPushRelease(payload, cwd);
  }

  if (eventName === 'workflow_dispatch') {
    return resolveDispatchRelease(inputTag, cwd);
  }

  throw new Error(`Unsupported release event name: "${eventName}"`);
}

export function checkFreshnessAgainstMain(targetSha, cwd = process.cwd(), remote = 'origin') {
  if (!isValidSha(targetSha)) {
    throw new Error(`Invalid target SHA for freshness check: "${targetSha}"`);
  }

  const normTarget = targetSha.toLowerCase();

  // Freshly resolve remote main tip; remote main MUST exist and be accessible
  let remoteMainTip;
  try {
    remoteMainTip = runGit(['rev-parse', '--verify', `${remote}/main`], cwd);
  } catch (err) {
    throw new Error(
      `Freshness check failed: remote ref "${remote}/main" is unavailable: ${err.message}`,
    );
  }

  if (!isValidSha(remoteMainTip)) {
    throw new Error(
      `Freshness check failed: resolved "${remote}/main" is not a valid commit SHA: "${remoteMainTip}"`,
    );
  }

  const normRemoteMain = remoteMainTip.toLowerCase();
  if (normTarget !== normRemoteMain) {
    return {
      fresh: false,
      reason: `Stale or mismatched target: target SHA ${normTarget} does not match current remote main tip ${normRemoteMain} on ${remote}`,
    };
  }

  return { fresh: true, reason: 'Target matches current remote main tip exactly' };
}

export function verifyDeployTarget(params) {
  const {
    eventName,
    expectedSha,
    resolvedSha,
    currentSha,
    expectedVersion,
    currentVersion,
    cwd = process.cwd(),
    remote = 'origin',
  } = params;

  if (!isValidSha(expectedSha)) {
    throw new Error(`Invalid expectedSha: "${expectedSha}"`);
  }
  if (!isValidSha(resolvedSha)) {
    throw new Error(`Invalid resolvedSha: "${resolvedSha}"`);
  }
  if (!isValidSha(currentSha)) {
    throw new Error(`Invalid currentSha: "${currentSha}"`);
  }

  if (expectedSha.toLowerCase() !== resolvedSha.toLowerCase()) {
    throw new Error(
      `Deploy verification failed: expected tested SHA "${expectedSha}" != resolved SHA "${resolvedSha}"`,
    );
  }
  if (expectedSha.toLowerCase() !== currentSha.toLowerCase()) {
    throw new Error(
      `Deploy verification failed: checked out HEAD SHA "${currentSha}" != tested SHA "${expectedSha}"`,
    );
  }

  // Version verification must be non-empty and strictly valid semver
  if (!isValidVersion(expectedVersion)) {
    throw new Error(`Invalid or missing expectedVersion: "${expectedVersion}"`);
  }
  if (!isValidVersion(currentVersion)) {
    throw new Error(`Invalid or missing currentVersion: "${currentVersion}"`);
  }
  if (expectedVersion !== currentVersion) {
    throw new Error(
      `Deploy verification failed: expected version "${expectedVersion}" != current version "${currentVersion}"`,
    );
  }

  // For automatic workflow_run releases, verify freshness against freshly fetched remote main tip
  if (eventName === 'workflow_run') {
    const freshness = checkFreshnessAgainstMain(expectedSha, cwd, remote);
    if (!freshness.fresh) {
      throw new Error(`Deploy rejected: ${freshness.reason}`);
    }
  }

  return { verified: true };
}
