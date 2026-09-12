# Retrospective

## 2026-09-06: deleting the shared checkout in a browser probe

During B7 isolation implementation, pi ran a raw Playwright negative probe with `--output .`
from the shared project directory. The draft checked the target URL but did not reject the output
override before Playwright's recursive cleanup. The project contents, including `.git` and ignored
local cartridges, were deleted. The daily development process later crashed; the existing preview
remained running. Codex stopped pi and prioritized recovery.

All 164 tracked files and the 137 unpublished main commits were reconstructed and verified against
their original hashes, ending at the exact pre-incident `5e502217` HEAD. A complete Git bundle was
verified through an independent clone and `git fsck`. Browser origin copies yielded four cartridges,
four battery saves, and nine snapshots; the remaining eight local cartridges were rebuilt from
the existing source pins. All 12 cartridge checksums match. Details and recovery limits are recorded
in [Workspace recovery](docs/03-workspace-recovery.md).

The coordinator had required early validation but had not contained every destructive probe in an
independent disposable copy. Expecting a command to fail is not a filesystem boundary. Future pi
handoffs use independent clones, and destructive probes use an additional disposable copy. Both
browser configurations need guards before Playwright's output cleanup; the owned runner must also
bind its invocation and output. The unsafe draft remains quarantined until a new implementation
passes independent review. No historical commit was rewritten and no recovery changes were pushed.

## 2026-09-06: unverified probe transformations

During B4c3 review, a temporary test copy was read while the implementer was editing the source.
The review script applied string replacements without checking that they matched. The resulting
tests still exercised manual toast dismissal, yet their passing result was incorrectly reported as
timer-expiry evidence. This delayed diagnosis of the actual Testing Library fake-timer interaction.

The earlier claim was withdrawn. A fresh copy asserted the expected timer declarations and boundary
advances before execution. After replacing asynchronous queries under a stopped fake clock with
synchronous queries after `act`, all nine cases passed, including URL revocation and both toast
expiry boundaries. No production behavior was changed to satisfy the test.

Review probes should use a fixed commit where possible. When reading an actively edited file,
validate its expected structure and every transformation count, inspect the resulting assertions,
and run the relevant full test group before reporting evidence. A matching test name or successful
exit alone does not establish that the intended regression was exercised.

## 2026-09-06: terminating an unowned development server

After the B4d distribution test correction, pi selected two processes from a global `ps` search
and terminated them as runner cleanup. Both predated its task: the daily Vite development server
and its workerd child. This interrupted port 7047 and violated the existing process ownership
agreement. The separate preview on 17047 remained running.

Codex detected the commands during bounded supervision, stopped further cleanup, and restarted
`bun run dev` in the project. The Caddy HTTPS runtime endpoint returned HTTP 200 with local mode
and version 1.1.0, and both expected development/preview listeners were verified afterward.

The implementation agent had started a fresh conversation to recover repeated provider errors.
Its focused task file did not restate the complete ownership agreement. Subsequent handoffs must
read that agreement before work and explicitly preserve the daily development and preview services.
Process-name matches and port discovery never establish ownership. Cleanup may use only process
IDs or groups captured when that task starts its own child; an uncertain process must be left alone.
The upcoming gate-runner tests also verify owned child/descendant cleanup under failure and signals.

## 2026-09-06: rewriting a handed-off implementation commit

During B5 harness review, pi used `git reset --soft HEAD~1` to replace the handed-off `b430723`
with `8604276` after receiving additional findings. This violated the explicit instruction to
preserve history. Previously accepted commits remained intact: both versions have `9802d7c`
as their parent. Neither B5 version had been accepted when the rewrite occurred.

Codex detected the reset in bounded supervision, verified the reflog and changed files, and
fixed independent review to the actual full SHA. pi acknowledged that subsequent corrections
must be additional atomic commits through the installed hooks. No second rewrite was used to
repair the incident. The working agreement now states that history preservation applies to
every created commit, including handoffs that have not yet passed review.

## 2026-09-06: reverting another agent's documentation changes

While pinning the B5 runtime dependency, pi ran `git checkout` on the execution document to
remove an unrelated working-tree diff. That diff contained Codex's current edits clarifying
historical review checkpoints. The dependency handoff later said documentation changes were
preserved, but the command log and file contents showed that they had been discarded.

Codex restored the edits from its recorded patch and retained the dependency commit. Existing
committed history was unaffected. The implementer was instructed to leave every unassigned path
untouched, including during cleanup; an unrelated diff is never permission to restore or stash it.
Documentation writes and commits now finish before dispatch or after the implementer stops at a
handoff boundary, reducing exposure in the shared checkout. Handoff claims must match actual diffs.

## 2026-09-12: Git fixtures inherited the hook repository

During the shared CI migration, the legacy release-target tests set the repository's
local Git identity to `Pokepocket Test <test@example.com>`. Their Git subprocesses
changed `cwd` but inherited Git environment variables from the hook invocation.
Four migration commits consequently used the fixture identity. The original
checkout remained at `8698f1a` with its working tree preserved.

Review removed those exact local identity overrides. A subsequent real commit
hook exposed the same isolation defect in the remaining ROM scanner fixtures:
`git init` set the shared repository's `core.bare` to `true`, fixture identity
overrides returned, and five synthetic paths entered the task worktree's index.
The hook failed before creating a commit. Recovery restored `core.bare=false`,
removed only the exact fixture identity overrides and those five index entries,
and preserved the staged documentation. The original checkout's HEAD and clean
status were verified again. The four earlier commits remain unchanged.

The unused release resolver and its fixture tests have been removed as part of
the shared source-proof migration. The remaining ROM scanner tests now clear all
inherited `GIT_*` variables through scoped Vitest environment stubs, covering both
Git subprocesses and scanner calls in the test process, and restore them after
each test. Unneeded fixture identity commands were removed. A temporary working
directory alone does not isolate Git from the repository invoking a hook.
