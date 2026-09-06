# Retrospective

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
