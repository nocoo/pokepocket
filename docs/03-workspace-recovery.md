# Workspace recovery and browser-test containment

Date: 2026-09-06. Status: the accepted source and main history are restored; the early artifact guard is accepted at `cc48e66`, while full B7 isolation remains pending.

## 1. Incident

At `2026-09-06T08:44:00.914Z`, while implementing B7 isolation, pi launched a raw Playwright
negative probe from the shared project directory with `--output .`. The draft configuration
validated the target URL but did not reject this output override before Playwright's cleanup.
Playwright removed the project contents, including `.git`, tracked files, dependencies, and
ignored local cartridges. The development process subsequently crashed after losing its working
directory. The preview process on 17047 remained running.

The probe was intended to prove that a sentinel survived rejected output. Its containment was
wrong: the directory under test was the working repository. The coordinator had required an early
guard but had not required every destructive probe to run in a separate disposable repository.
Neither an expected rejection nor a sentinel makes a shared directory a suitable test target.

The last accepted implementation was `d563a3563acc8f645c3d55216a866d751f180a1c`, followed by
documentation commit `5e5022176be5cb2bb64a4ea1ae66632cc7a73f45`. The isolation draft was uncommitted
and unaccepted. pi was stopped, and its recovered draft was quarantined outside the project.

## 2. Verified recovery

| Item                            | Result                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Accepted working files          | All 164 tracked files match the original Git blob bytes and modes                                 |
| Local main history              | All 137 commits after remote `8a43e3c` restored with their original hashes                        |
| Restored main                   | `5e5022176be5cb2bb64a4ea1ae66632cc7a73f45`                                                        |
| Restored main tree              | `ae403dbcb115bb9bcb2d44ca838d64671d3ca4f9`                                                        |
| Remote tracking and tag         | `origin/main` remains `8a43e3c`; original `v1.1.0` tag retained                                   |
| Git ownership                   | Independent object store; no alternates or dependency on a review checkout                        |
| Independent backup verification | Complete bundle cloned into a separate bare repository; `git fsck --full` passed without findings |
| Hooks                           | Versioned Husky hooks reinstalled; `.husky/_` is the active hooks path                            |

Recovery combined the surviving remote history, old checkout indexes and files, and original
session records of writes, edits, diffs, staging, and commits. Historical shell commands were read
as evidence, not executed. Literal text transformations and formatting reconstructed candidate
blobs; original commit hashes verified the resulting trees, parent links, identities, messages,
and timestamps. The full final HEAD hash matches the pre-incident value.

The working object store also contains unused recovery candidates. Its `fsck` output lists dangling
objects but no missing or corrupt objects. The independent bundle contains the connected history
and has a clean `fsck` result. No replacement history, reset, amend, rebase, push, or deployment was
used. Original reflog entries and unrecorded local Git configuration were not reconstructed; the
new recovery ref and reflog entry describe the restoration itself.

## 3. Local cartridges and browser saves

The project's two Chrome IndexedDB origins survived outside the deleted directory. They were copied
before inspection. A separate Chrome profile opened only those copies, with page navigation
fulfilled by a blank document and other requests blocked. The real profile was never opened by the
recovery browser or modified.

| Copied origin                     | Cartridges | Battery saves | Snapshots |
| --------------------------------- | ---------- | ------------- | --------- |
| `https://pokepocket.dev.hexly.ai` | 1          | 1             | 3         |
| `https://pokepocket.hexly.ai`     | 3          | 3             | 6         |

Four cartridges—Yellow, Ruby, Sapphire, and Emerald—were recovered from the stored ArrayBuffers.
Each SHA-256 matches its recorded cartridge ID, and each passes the production header parser.
The eight remaining local editions were rebuilt from the repository's existing source pins using
the installed toolchains. All 12 restored files match the original checksums in
`scripts/rom-sources.json`; the development catalog reports all 12 available. ROM files remain
ignored and outside distribution assets.

The backup also contains semantic exports of all four battery saves and nine snapshots, with byte
lengths and SHA-256 digests. This verifies the copied records are readable; it does not claim that
every old save was replayed inside mGBA. Regenerable dependency/build caches were recreated as needed.
The recovery inventory does not establish that every formerly untracked file was recoverable.

## 4. Backup and validation evidence

The persistent local backup is outside the project:

```text
/Users/nocoo/.local/share/pokepocket-recovery/20260906-hugyapke
```

Its principal artifacts are:

- `recovered-history-5e50221.bundle`: complete connected Git history.
- `recovered-source-5e50221.tar.gz` and `source-manifest.json`: accepted working files.
- `git-restoration-manifest.json`, bundle verification, and both `fsck` logs.
- `recovery-evidence/`: reconstruction scripts, original commit payloads, mappings, and evidence.
- `browser-origin-backup/` and `browser-semantic-export/`: origin copies and verified save exports.
- `recovered-roms/`, `rebuilt-roms/`, and `restored-local-roms-manifest.json`: cartridge provenance.
- `quarantined-b7-isolation-draft.tar.gz`: the unaccepted implementation draft.

The bundle SHA-256 is
`f190c0b449876e021a929276b7ddd2d70c0c18dcc55943e84024452549132a7d`.
This is an independent local backup on the same machine, not an off-machine backup.

Post-restoration validation at the original HEAD:

- `quality:commit`: G1 and all 476 unit tests passed in 6.74 seconds; 105 files linted without
  warnings. Coverage: statements 94.45%, branches 90.23%, functions 94.61%, lines 95.59%.
- `quality:push`: G2 and L2 passed in 3.01 seconds, including production build/distribution checks
  and all 40 HTTP cases. Scanner versions remain OSV 2.5.1 and Gitleaks 8.30.1.
- Caddy development URL and catalog returned HTTP 200; all 12 local cartridges were available.
  The existing preview retained its anonymous HTTP 403 authorization boundary.

The accepted 21 required browser journeys were independently verified before the incident at the
same source commit. They were not rerun in the shared directory during recovery. These results do
not accept the quarantined isolation draft or establish Tier S.

## 5. Containment required before resuming B7

1. Each implementation handoff uses a fresh independent clone outside the development checkout.
   Use a complete clone without shared objects, alternates, hardlinks, or a linked worktree. Verify
   its actual repository and object-store paths before dispatch. Keep a complete backup outside it.
2. The implementer owns that clone and its captured processes only. The coordinator reviews the
   exact offered commit, then imports it without rewriting history. Documentation remains a
   separate atomic commit in the main checkout. Daily development and preview services remain
   outside implementation and test ownership.
3. Any probe that might recursively delete files runs in an additional disposable copy. Validate
   that copy's canonical path and ownership before launching the probe. Never make the main or
   implementation checkout, their ancestors, another project, or a user browser profile its output.
4. First commit an early artifact guard for both browser configurations. A valid target together
   with `--output .`, `--output=...`, outside paths, or symlink escapes must fail before Playwright
   can remove output. Verify real CLI rejection and sentinel preservation in the disposable copy.
5. Then finish the owned L3 runner, cross-checkout port lock, authorization coverage, exact suite
   acceptance, and process/signal cleanup. The runner must bind the permitted invocation and
   output; a wrapper-only guard cannot protect raw Playwright invocations. Do not forward options
   that can silently select a partial required suite.

The remaining order is artifact containment, full B7 isolation, navigation contrast, layout/PNG
coverage, B8 CI, B8 release gates, and final independent acceptance. Each implementation and
documentation change remains an atomic commit through the installed hooks.

The artifact-containment step is now complete at `cc48e66`. Both configurations reject unsafe
outputs during loading, before Playwright cleanup. An independent disposable clone passed 42 real
CLI checks, including sentinel preservation and consecutive successful cleanup cycles. The exact
implementation and evidence are recorded in the [execution ledger](02-6dq-tier-s-execution.md).
The quarantined isolation draft remains unaccepted; the owned L3 runner is the next handoff.
