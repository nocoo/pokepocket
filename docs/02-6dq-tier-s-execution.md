# 6DQ Tier S execution

Status: in progress. B1, B2, B3, B4a, B4b, and B4c1 accepted; B4c2 assigned. Overall status remains Tier C until L1 reaches its gate.

Started: 2026-09-06. Code baseline: `8a43e3c` (v1.1.0). Accepted assessment: `1979e8c`.
The [original assessment](01-6dq-adoption-plan.md) records the nmem requirements and baseline gaps.
This document is the current implementation contract, review ledger, and acceptance record.

## 1. Ownership and working agreement

The user requested staged implementation by the existing pi agent in Herdr, with Codex coordinating,
reviewing every batch, maintaining numbered documentation, and independently validating the result.

- **pi owns implementation:** work only on the assigned batch; implement behavior and its meaningful
  tests together; make atomic commits; report commit hashes, commands, results, and remaining issues.
- **Codex owns review and documentation:** inspect the complete changed modules, reproduce relevant
  checks, return concrete findings, and accept the batch only after every finding is resolved.
- Both agents share the existing checkout and branch. Codex does not edit pi-owned code while pi is
  working. pi does not edit this document, the assessment, or documentation indexes.
- Each logical change gets a separate Conventional Commit with a lowercase subject of at most
  50 characters. Stage explicit paths. Do not amend/rewrite accepted commits or bypass active hooks.
- pi stops at the batch boundary and notifies the coordinating pane through `herdr agent prompt`,
  without waiting for the coordinator. It must not start the next batch without review acceptance.
- Codex uses bounded lifecycle waits and a 45-second progress timer. On timeout, inspect the agent's
  current output and repository progress; on an error or blocked state, diagnose it before resuming.
  While implementation runs, prepare the next review and independent verification work.
- Preserve the daily development server on 7047 and its Caddy domain. Test runners own only their own
  temporary processes, ports, directories, and browser contexts.
- Browser verification starts only after the implementer has explicitly stopped. Use a separate
  output directory for independent review; B7 must reject concurrent runs before clearing artifacts.

Documentation is committed before implementation begins. After each accepted batch, Codex updates
the ledger and any changed design decisions in a separate documentation commit. Final documentation
must describe the implemented files and measured evidence, not leave proposed work marked complete.

## 2. Acceptance contract

| Dimension | Required result                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1        | Reviewed first-party logic scope, including unimported files; statements, branches, functions, and lines each >=90%; pre-commit L1/G1 under 30 seconds |
| L2        | Real inbound TCP/HTTP to the production Worker build; all four API endpoints covered; pre-push L2/G2 under 3 minutes                                   |
| L3        | Required browser journeys run without local commercial ROMs and without conditional skips; real browser storage and executable GB/GBC/GBA fixtures     |
| G1        | Strict TypeScript and strict JavaScript/TypeScript lint; zero errors and warnings; formatting checked separately                                       |
| G2        | OSV scans the actual lockfile and Gitleaks scans relevant committed changes; both fail closed locally and in CI                                        |
| D1        | Cloud persistence rules remain N/A while no remote state exists; local tests use owned loopback services and isolated storage/context instances        |

The four coverage metrics are the project convention adopted from the assessment; nmem itself states
`>=90%` without naming metrics. Do not reduce thresholds, omit uncovered modules, or add broad ignores
to obtain a green result. A view exclusion requires extracted behavior and a recorded file-level
justification. Third-party WASM, generated declarations, fixtures, and build output are outside L1.

Application-owned authorization must be tested with real signature verification and through an
authorized browser load. Cloudflare's hosted identity provider is a separate boundary: verify the
Access redirect contract and record the exact scope of login evidence. A locally signed fixture token
does not demonstrate a live Cloudflare SSO login.

## 3. Batch and atomic commit plan

Commit subjects below describe intended boundaries. Small corrections to earlier work receive their
own fix commits and must pass the same review gate. If a batch needs a materially different design,
pi reports the reason before expanding scope; Codex updates the contract.

### B1 — coverage baseline and strict static checks

1. `test: record complete coverage baseline`
   - Add compatible coverage tooling and an explicit executable-source inventory in `vitest.config.ts`.
   - Include logic in `src/`, `worker/`, and maintained `scripts/`; record all four baseline metrics.
   - Keep the diagnostic command distinct from the eventual enforced L1 gate.
2. `chore: enforce strict static checks`
   - Add `biome.json`, exact development dependencies, and project-owned G1 commands.
   - Cover `.mjs` scripts, TypeScript, and React hook correctness; retain strict typecheck and Prettier.
   - Fix violations without broad suppressions or unrelated behavior changes.

Review: coverage denominator, dependency/lockfile integrity, lint rule scope, existing unit tests,
strict checks, and production build. Capture the baseline honestly; B1 alone does not imply Tier B.

### B2 — application state boundaries

Existing G1 already typechecks TypeScript/TSX tests through
[tsconfig.tests.json](../tsconfig.tests.json), referenced by the root build configuration. Test data
must implement the actual domain interfaces; no duplicate typechecking configuration is needed.

3. `refactor: extract snapshot action state`
   - Extract snapshot command/confirmation and modal pause ownership from `src/App.tsx`.
   - Add unit tests for request, confirm, cancel, busy state, failed mutation, and retry.
4. `refactor: isolate cartridge orchestration`
   - Extract load/switch/import/restore state behind a small observable controller or equivalent hook.
   - Keep view wiring thin and test cartridge changes, loading/error recovery, and persistence ordering.

Review: compare user-visible state transitions against the original App, including paused games,
closing nested modals, cancelled actions, failed imports, and switching while a save is pending.
Run relevant unit and existing fixture-based browser regressions. Do not introduce a general MVVM
framework or change storage schema.

### B3 — emulator and storage correctness

5. `refactor: inject emulator boundary dependencies`
   - Introduce only needed mGBA/browser/storage/clock seams in `src/lib/emulator.ts` and its adapter.
   - Test startup, reset, pause/resume, restore, cleanup, and core failures.
6. `fix: preserve serialized save recovery`
   - Assert concurrent autosave/manual operations and cartridge switches preserve write ordering.
   - Cover snapshot compatibility, create/load/replace/delete, failed writes, and queue recovery.
   - Retain elapsed play time when its storage transaction fails; retry must record it exactly once.
   - Keep failed battery imports coherent and retryable after core shutdown; never report a running
     game whose core has already quit.
7. `test: verify isolated storage transactions`
   - Test IndexedDB CRUD, isolation by ROM hash, open/transaction errors, and `replaceBattery` atomicity.
   - Verify rollback, automatic snapshot removal, and preservation of manual slots.
   - Abort and settle failed multi-store transactions when a request throws synchronously; a failed
     import must leave both the original battery and automatic snapshot intact, without unhandled
     transaction rejections.

Review: meaningful behavioral assertions, realistic core doubles, isolated fake IndexedDB instances,
and preservation of browser IDBFS/IndexedDB behavior. Real WASM and browser storage remain covered by L3.

### B4 — complete L1 and activate pre-commit

8. `test: cover browser and input boundaries`
   - Cover settings, screenshot success/failures, keyboard/gamepad input, and controller edge cases.
   - Exercise lifecycle cleanup and deferred failure/retry through production methods.
9. `refactor: expose maintenance script policies`
   - Make maintained CLI policies callable without executing a build/download at import time.
   - Use temporary files and explicit dependency boundaries for distribution, emulator setup, source
     pins, checksums, build selection, and release verification. Subprocess-only tests do not provide
     Vitest coverage for the code inside those subprocesses.
   - Move true HTTP developer-plugin tests out of the fast unit suite, retaining discovery units.
10. `test: cover rendered application interactions`
    - Mount actual components and App wiring to verify keyboard, gamepad, settings, modals, snapshot
      commands, import/export, fullscreen fallback, busy states, and error feedback.
    - Split distinct behavior groups into additional atomic commits when needed. Preserve canvas
      identity and meaningful assertions at the browser/core boundary.
    - Keep App and interactive components in coverage scope. A thin-view exclusion requires prior
      extraction and a recorded file-level justification; no coverage reduction is preapproved.
11. `chore: enforce unit and static commit gates`

- Enforce all four >=90% thresholds and install versioned hooks.
- Run L1 and G1 concurrently with correct failure propagation and child-process cleanup.
- Enforce the existing lowercase Conventional Commit subject rule, including a nonempty subject and
  the 50-character limit, through a small tested `commit-msg` policy. Do not rewrite existing history.

Review: independently regenerate the full coverage report; verify an injected unit/static failure
blocks the gate; measure the combined hook runtime. **Milestone: Tier B.**

### B5 — production Worker over HTTP

12. `test: add production worker http harness`
    - Use the production build, real workerd/Miniflare, built assets, and ephemeral test JWT/JWKS keys.
    - Prove valid and invalid authenticated `/api/runtime` calls through real loopback HTTP first.
    - Keep production authentication intact; supply only the expected JWKS outbound response.
13. `test: cover every worker api over http`
    - Cover `/api/live`, `/api/catalog`, `/api/cartridge`, and `/api/runtime` with GET/HEAD contracts.
    - Add shared token, method precedence, 403/404/405, static assets, WASM, and response-header cases.
    - Test endpoint inventory completeness, occupied-port failure, readiness failure, and cleanup.

Review: inspect runtime configuration and every request path, proving no direct handler/`SELF.fetch`
substitution or development bypass. L2 owns loopback 17048; refuse any listener conflict rather than
reusing/killing it. Keep the existing preview on 17047. Isolate runtime state in temporary directories. Retain development
plugin HTTP regressions separately.

### B6 — security and pre-push enforcement

14. `chore: add local security quality gates`
    - Use version-pinned OSV/Gitleaks and scan the real `bun.lock` plus outgoing committed changes.
    - Handle new branches conservatively; missing tools and scanner errors fail, rather than skip.
15. `chore: enforce integration push gates`
    - Run L2 and G2 concurrently from the pre-push hook; propagate either failure.
    - Enable the same L2 entry point in CI and preserve both existing security scans.

Review: scanner versions and scope, outgoing Git ranges, argument quoting, installation guidance,
negative gate probes, isolation guards, and combined runtime under 3 minutes. **Milestone: Tier A.**

### B7 — required browser coverage

16. `test: add executable cartridge fixtures`
    - Add original runnable GB/GBC/GBA programs with observable rendering and save behavior.
    - Verify actual execution; a valid header alone does not satisfy this fixture contract.
    - Keep reviewable source/instructions in the repository and construct ROM bytes in tests.
      Do not commit ROM binaries or require a cross-compiler in CI. Use original cartridge
      identifiers so mGBA's commercial-game save overrides cannot change the fixture hardware.
17. `test: require core cartridge and save journeys`
    - Make import/start/pause/resume/reload and cross-platform switching mandatory for GB/GBC/GBA.
    - Assert snapshot CRUD/confirmation/cancellation/retry and meaningful `.sav` import/export results.
    - Keep local 12-ROM compatibility tests in an explicitly optional suite.
18. `test: verify browser authorization and isolation`
    - Test anonymous denial and authorized application load against the production harness.
    - Reject non-owned test targets, development/production origins, and server reuse; clean contexts.
19. `test: verify console layout and export behavior`
    - Cover fullscreen centering, proportional fonts/buttons, mobile/modals, and button contrast states.
    - Verify 1080-pixel-high PNG exports with the correct aspect ratio across all three platforms.

Review: every required browser test executes without commercial ROM availability, failure artifacts
are usable, assertions validate behavior rather than implementation details, and shared storage stays
isolated. Record the precise authentication/login boundary. No required core test may silently skip.

### B8 — CI, release gating, and final sign-off

20. `chore: align ci with local quality commands`
    - Use the same project-owned L1/G1/L2/G2/L3 entry points in CI; publish coverage and failure artifacts.
    - Ensure required browser failures or skips block acceptance.
21. `chore: require tested commits for every release`
    - Resolve an immutable target SHA for main-CI, tag, and manual release paths.
    - Require all quality results for that SHA before deployment, running missing checks when needed.
    - Preserve Access checks, version/tag checks, serialized deployment, and post-deploy version checks.

Review: actual reusable workflow inputs, checkout refs, job dependencies/conditions, token permissions,
and negative cases for failed, missing, skipped, or unrelated-SHA results. Validate delivery logic
without redeploying the already-released v1.1.0 merely as a test.

Codex then runs the complete final acceptance matrix from a clean committed tree, resolves any final
findings through additional atomic fixes, and commits the final implementation/evidence documentation.
**Milestone: Tier S only when every applicable check below has recorded passing evidence.**

## 4. Review ledger

| Batch | State    | Implementation commits                                                      | Review and evidence                                                                                       |
| ----- | -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| B1    | Accepted | `59bbfa2`, `d89ff9d`                                                        | 74 unit tests; strict G1 and build pass; 11 independently verified browser cases; coverage baseline below |
| B2    | Accepted | `85cd089`, `1995b59`, `b47caa6`, `d4123eb`, `e816964`                       | 111 unit tests; independent G1, build, 12 browser cases, and deferred command probes pass                 |
| B3    | Accepted | `ebe6901`, `76a6148`, `a9f7339`, `c052d68`, `ba035c8`, `242bd91`, `48d2742` | 139 unit tests; independent G1, build, 27 browser cases, recovery and transaction probes pass             |
| B4a   | Accepted | `fff1da2`, `8f9f008`                                                        | 169 unit tests; independent G1, coverage, and build pass; boundary tests and mock isolation reviewed      |
| B4b   | Accepted | `405f7a1`, `3d40fcc`, `8e44499`, `590f6da`, `bddd7e3`                       | 197 unit tests and one HTTP test; independent G1, coverage, build, and process-cleanup probe pass         |
| B4c1  | Accepted | `8e1b53d`, `264675d`, `10d1e6e`                                             | 225 unit tests; independent G1, coverage, and build pass; device/input/dialog behavior reviewed           |
| B4c2  | Assigned | —                                                                           | CartridgeGallery, SeriesLibrary, SaveSlots, and SnapshotConfirmation interactions                         |
| B4c3  | Pending  | —                                                                           | Rendered App commands with production controllers                                                         |
| B4c4  | Pending  | —                                                                           | App keyboard/gamepad and browser lifecycle                                                                |
| B4d   | Pending  | —                                                                           | All four coverage metrics >=90%; L1/G1 pre-commit and commit-message gates                                |
| B5    | Pending  | —                                                                           | —                                                                                                         |
| B6    | Pending  | —                                                                           | —                                                                                                         |
| B7    | Pending  | —                                                                           | —                                                                                                         |
| B8    | Pending  | —                                                                           | —                                                                                                         |

### B1 review evidence

Reviewed implementation: `d89ff9d`. The explicit coverage inventory in
[vitest.config.ts](../vitest.config.ts) includes all 25 first-party executable files in `src/`,
`worker/`, and maintained `scripts/`, including unimported modules. Only declarations are excluded;
there are no logic or view exemptions. Coverage remains diagnostic until B4.

| Revision                            | Statements | Branches | Functions | Lines  |
| ----------------------------------- | ---------- | -------- | --------- | ------ |
| Initial inventory, `59bbfa2`        | 20.76%     | 19.70%   | 15.40%    | 20.81% |
| After strict-check fixes, `d89ff9d` | 20.87%     | 19.55%   | 15.36%    | 21.13% |

Independent checks on 2026-09-06:

- `bun run test:coverage`: 74 tests across eight files pass; 0.54 seconds wall time.
- `bun run quality:g1`: Biome 2.5.12 checks 51 files, with zero errors/warnings; strict TypeScript 7
  and Prettier pass. Combined wall time: 1.42 seconds. No hook is active yet.
- `bun run build`: production Worker/client build and both no-ROM distribution checks pass.
- Existing core browser review: 11 passed, zero failed/skipped, in 36.0 seconds. This covers key
  bindings/preferences, import/reload, invalid ROMs, mobile layout, snapshot confirmation/CRUD/retry,
  native save previews, GB/GBC 1080p export, and catalog navigation. The reviewed command was
  `bun run test:e2e --grep-invert 'selects bundled|runs the real Emerald|importing a battery save|runs real Pokémon|keeps each platform' --reporter=line --output=/tmp/pokepocket-b1-independent-20260906`.
  This is a B1 regression checkpoint; mandatory, fully fixture-owned L3 remains B7 work.

Review corrections retained Cancel autofocus, reset new fieldset geometry, removed the broad
`noFocusedTests` override by renaming the console resize callback, and restored browser-side
`page.evaluate` in keyboard preference assertions. The two explained local lint exceptions cover
whole-page file dropping and the confirmation dialog's deliberate Cancel autofocus.

An overlapping implementation/review browser run initially collided in `test-results` and produced
a trace cleanup error. Both runners stopped; the independent run above used a separate output
directory and passed. The working agreement now requires an explicit browser handoff, and B7 owns
the automated port/concurrency guards. This incident is not counted as passing evidence.

### B2 initial review

Review of `85cd089` and `1995b59` found that snapshot/modal state extraction is present, but the
cartridge module still delegates its actual asynchronous import/load/switch/return commands to App.
The cross-controller test guards a spy with its own `if` and cannot detect a missing production
guard. Passing unit and browser counts do not resolve these contract gaps.

An independent process-local probe on 2026-09-06 reproduced three issues without browser storage:

- Catalog fetching does not start while the initial IndexedDB read is pending; these requests were
  independent before the refactor.
- A delayed initial read resets a newer `ruby` selection to `emerald`.
- A production selection command changes edition while a deferred snapshot replacement is busy.

The initial review required real asynchronous commands behind the tested boundary, guards before
selection/preference/storage mutation, protection against stale initialization and unmount, and
library refresh without reinitializing preferences. Corrective commits resolve these findings as
recorded below; the initial commits remain intact.

### B2 acceptance evidence

Reviewed implementation: `e816964`. Actual import/start/switch/return commands now live in
[cartridge-orchestrator.ts](../src/lib/cartridge-orchestrator.ts). Independent catalog/storage
initialization uses separate generations; delayed reads cannot overwrite a newer selection or import,
and invalid imports leave legitimate initialization active. Snapshot and cartridge commands reject
conflicting operations through their production dependencies. ROM fetching is inside the busy/error
boundary, while App file/drop handlers avoid acquiring the same operation lock twice.

[snapshot-action.ts](../src/lib/snapshot-action.ts) separates a successful mutation from notification
errors, so a notification failure cannot offer a second destructive mutation as a retry. Confirmation
also rejects cartridge operations already in progress. Return-to-library waits for persistence before
refreshing the library, and cancelled pickers retain the prior pause/resume intent.

Independent checks on 2026-09-06 at the final implementation:

- `bun run test:coverage`: 111 tests across 12 files pass in 0.58 seconds. Coverage is 31.94%
  statements (554/1734), 27.71% branches (357/1288), 25.12% functions (102/406), and 32.91% lines
  (495/1504). No coverage exclusions or enforced thresholds have been added.
- `bun run quality:g1`: Biome checks 58 files with zero errors/warnings; strict TypeScript and
  Prettier pass in 1.45 seconds.
- `bun run build`: production Worker/client and both no-ROM distribution checks pass.
- `bun run test:e2e --grep-invert 'runs the real Emerald|importing a battery save|runs real Pokémon|keeps each platform' --reporter=line --output=/tmp/pokepocket-b2-independent-20260906`:
  12 passed, zero failed/skipped, in 46.7 seconds. This includes the previously broken bundled
  catalog path plus snapshot confirmation/CRUD/retry and GB/GBC 1080p regression cases.
- Independent deferred-operation probes verify parallel initialization, stale-result rejection,
  cross-controller exclusion, successful catalog import, fetch failure recovery, and initial-library
  preservation after an invalid import. Unit regressions call the production commands rather than
  duplicating their guards in test code.

Both agents stopped browser runners before handoff. B2 is accepted; B3 now owns the three confirmed
emulator/storage failures documented in section 6 and the atomic boundaries in section 3.

### B3 emulator review checkpoint

The public dependency boundary and serialized command queue are present at `76a6148`. An independent
process-local probe confirms that failed play-time writes retain accumulated time, including ticks
that arrive during a later successful write. This resolves the original accounting retry failure.

The same probe reproduces four remaining failures through public methods:

- A rejected battery replacement leaves the old core running but never restarts the stopped timer,
  so FPS, play-time accounting, and autosave stop indefinitely.
- A crash callback queued by the old cartridge can fire after a new load and mark the new game as
  failed. Deferred callbacks must belong to the lifecycle generation that created them.
- A newly created core whose `FSInit` rejects is never released through `quitMgba`; retries can leak
  owned runtimes. Initialization failure and explicit cleanup need tested ownership boundaries.
- Importing a battery save discards seven accumulated seconds when the subsequent load resets the
  session counter. Preserve that accounting without allowing an old save to overwrite the import.

B3 remained open at that checkpoint. The final review below supersedes those unresolved findings.

### B3 final acceptance

Reviewed implementation: `48d2742`, including `ebe6901`, `76a6148`, `a9f7339`, `c052d68`,
`ba035c8`, and `242bd91`. The production emulator now injects core, clock, and storage boundaries;
load/reset/restore/import/export and save mutations share one recoverable command queue.

Independent checks on 2026-09-06:

- `bun run test:coverage`: 139 tests across 14 files pass in 0.52 seconds. Coverage is 47.75%
  statements (851/1782), 34.32% branches (450/1311), 38.44% functions (163/424), and 50.03% lines
  (776/1551). The full inventory remains included; coverage is still diagnostic until B4.
- `bun run quality:g1`: Biome checks 60 files with zero errors/warnings; strict TypeScript and
  Prettier pass. `bun run build` passes for the production Worker/client and distribution checks.
- `bun run test:e2e --reporter=line --output=/tmp/pokepocket-b3-independent-20260906`: 27 passed,
  zero failed/skipped, in 2.2 minutes. This includes all existing local-ROM compatibility cases,
  actual battery imports, snapshot confirmation/CRUD/retry, and GB/GBC screenshot exports.
  These are regression results, not the commercial-ROM-independent L3 gate still required in B7.
- Eight independent process-local probes pass: failed/concurrent play-time writes, running and
  paused import recovery, delayed old-core crash callbacks, failed initialization cleanup,
  retry after imported-save boot failure, and both accumulated and checkpointed play-time retention.
- Isolated real storage operations against `fake-indexeddb@6.2.5` verify synchronous and asynchronous
  transaction failures, rollback, clean retry, and no unhandled `tx.done` rejection. Each test owns
  its IDB factory and restores globals; production continues using browser IndexedDB.

Review refinements replaced an insufficient combined queue test with six deferred production
regressions. The event loop advances while storage is blocked, and assertions prove that a later
load/reset/restore cannot start early, an export retains its originating cartridge bytes, an import
blocks premature autosave writes, and a rejected command does not poison the next command.

The final source also retains pending play time until a write succeeds, restarts timers after failed
imports, binds callbacks to the originating load generation, and releases a core whose initialization
fails. Multi-store failures abort and settle their transaction before returning the original error.
All B3 review findings are resolved. Browser runners are stopped before the next handoff.

### B4 handoff sequence

The B4 atomic boundaries in section 3 are separate implementation/review handoffs. B4a, B4b, and B4c1
are accepted. B4c is divided into the four bounded handoffs below; only B4c2 is currently assigned, and pi
must stop for review after each. Keep coverage scope and thresholds unchanged until the reviewed
behavior tests meet all four metrics. DOM dependencies must be pinned exactly, and TSX tests must be
discovered and strictly typechecked. The existing TypeScript test configuration includes `tests/`;
extend Vitest discovery rather than introducing a duplicate typechecking configuration.

1. **B4c1 — device and input components.** Separate atomic commits for Console/MobileControls, Modal,
   and KeyBindings. Mount the production components with the real InputController. Verify pointer
   release/cancel/lost capture, keyboard activation/blur, inactive controls, shoulder availability,
   device states, canvas identity, proportional resize geometry, and observer cleanup. Verify dialog
   open/close and dismissal boundaries, accessible references, binding capture/conflicts, ignored
   keys, cancellation/reset/secondary removal, and listener cleanup.
2. **B4c2 — library and save components.** Separate atomic commits for cartridge/series selection
   and for snapshot list/confirmation actions. Exercise real rendered controls, busy/disabled states,
   available and missing cartridges, sorting/display states, confirmation/cancellation, and retry
   affordances through observable callbacks and content.
3. **B4c3 — App commands.** Separate atomic commits for cartridge/import/export commands and modal/
   settings/snapshot wiring. Retain the actual production controllers; replace only browser, storage,
   and emulator boundaries where necessary. Verify user-visible success/failure and pause ownership.
4. **B4c4 — App lifecycle.** Separate atomic commits for keyboard/gamepad behavior and browser
   lifecycle/fullscreen behavior. Exercise event registration, polling, disconnection, focus changes,
   unmount cleanup, and native/fallback fullscreen transitions through the mounted application.

Each handoff includes G1, unit coverage, and a production build before its review. Actual regressions
receive their own fix commits. Neither DOM coverage nor the fast unit gate replaces B7's real browser
and WASM execution requirements.

### B4a acceptance evidence

Reviewed implementation: `8f9f008`, following `fff1da2`. The exact-pinned `happy-dom@20.12.0`
supports process-local browser boundary tests. No production source or coverage scope changed.

Independent checks on 2026-09-06:

- `bun run test:coverage` at `fff1da2`: 169 tests across 16 files pass in 0.60 seconds. Coverage is
  52.35% statements (933/1782), 38.21% branches (501/1311), 42.68% functions (181/424), and 54.09%
  lines (839/1551). `bun run build` also passes for the production Worker/client and distribution.
- `bun run quality:g1` and `bun run test` at `8f9f008`: Biome checks 62 files with zero
  errors/warnings; strict TypeScript, formatting, and all 169 tests pass without Node storage warnings.
- Reviewed regressions cover keyboard source isolation and editable targets, gamepad mapping and
  thresholds, settings corruption/clamping/non-finite values, GB/GBA exact PNG dimensions, deferred
  image decoding and failures, disabled smoothing, PNG MIME, unavailable canvas contexts, and failed
  blob encoding. Downloads verify actual bytes plus anchor removal and object-URL revocation.
- Controller subscription/unsubscription, post-failure busy/error state, emulator control/capture/
  export errors, and the existing library-view modal pause rule retain observable assertions.

Review restored an overwritten B2 modal regression, completed decode/download assertions, and
ensured URL mocks restore their original functions. The final correction removes eager reads of
Node's host `localStorage` getter; Vitest's stub lifecycle restores the descriptor. Actual App
keyboard/gamepad polling, disconnect handling, and DOM lifecycle remain B4c work. Production code
did not change in this batch, so B3's browser regression evidence remains the relevant checkpoint.

### B4b acceptance evidence

Reviewed implementation: `bddd7e3`, following `405f7a1`, `3d40fcc`, `8e44499`, and `590f6da`.
The maintained setup, distribution, ROM build, and Access/release scripts expose callable policies
behind CLI entry guards. Tests use real temporary files and injected command/network boundaries,
without downloading source, compiling commercial ROMs, or contacting the deployment during L1.

Independent checks on 2026-09-06:

- `bun run test:coverage`: 197 tests across 20 files pass in 0.69 seconds wall time. Coverage is
  61.02% statements (1154/1891), 45.71% branches (662/1448), 48.40% functions (212/438), and 63.06%
  lines (1045/1657). App, interactive components, and maintained scripts remain in scope.
- `bun run quality:g1`: Biome checks 68 files with zero errors/warnings; strict TypeScript and
  formatting pass. `bun run build` passes for the production Worker/client and distribution checks.
- `bun run test:http`: the isolated developer-plugin TCP regression passes. Its configuration is
  included in strict typechecking. Discovery and middleware policy units remain in L1; this test
  does not yet provide B5's production Worker HTTP gate.
- A separate Node process probe installs a child's SIGTERM handler before injecting a real log
  stream failure. The runner rejects after approximately 203 ms, the child is no longer alive, no
  delayed marker was written, and the log stream is closed. No owned runner remains on completion.

Review fixed a log-stream error that previously escaped the subprocess runner, then strengthened
settlement to stop the child, escalate to SIGKILL when necessary, await stream/process closure, and
preserve the original failure. Tests assert selected-build exclusion, verify-only behavior, source/
checksum/output bytes and manifest metadata, release version checks, and completion of all deferred
Access checks. Middleware tests await observable response completion instead of fixed sleeps.

The ROM build output now correctly resolves to the repository's `roms/` directory. The developer
plugin exports its existing inspection implementation directly rather than adding a forwarding
wrapper. B4b introduces no dependencies or coverage exclusions. B4c owns the remaining rendered
application behavior; threshold enforcement and hooks remain B4d work.

### B4c1 acceptance evidence

Reviewed implementation: `10d1e6e`, following `8e1b53d` and `264675d`. Tests mount the actual Console,
MobileControls, Modal, and KeyBindings components with the production InputController. The first
atomic commit includes TSX discovery and exact development pins for Testing Library React 16.3.3,
DOM 10.4.1, and user-event 14.6.6. Existing strict test typechecking covers the new files.

Independent checks on 2026-09-06:

- `bun run test:coverage`: 225 tests across 23 files pass in 0.72 seconds wall time. Coverage is
  66.94% statements (1266/1891), 53.31% branches (772/1448), 55.02% functions (241/438), and 69.28%
  lines (1148/1657). The denominator and exclusions are unchanged.
- `bun run quality:g1`: Biome checks 71 files with zero errors/warnings; TypeScript and formatting
  pass. `bun run build` passes for the production Worker/client and both distribution checks.
- Device tests verify ordered pointer down/up/cancel/lost-capture and virtual-key/blur transitions,
  platform/inactive shoulder controls, boot/loading/error/paused states, and canvas object identity.
  Resize tests exercise nonzero padding, both limiting dimensions, invalid geometry, collapse,
  re-expansion, observer ownership, and unmount cleanup.
- Dialog tests verify title/description references, native opening/closing, content versus backdrop
  clicks, and prevention of native cancellation while nondismissible. Key capture tests verify
  modifiers, conflicts and retry, cancellation, repeat handling, reset, secondary removal, and actual
  listener removal with no response to a DOM event after unmount.

Review replaced manually assigned DOM globals with per-file browser environments, explicit root
cleanup, and restored mocks. It also replaced assertions that could reuse earlier input events with
complete transition sequences and required a collapse test while the canvas remains mounted.
No production source changed. The implementer also reports the unchanged developer HTTP case passing;
browser geometry and actual WASM remain B7 requirements. B4c2 now owns library and save components.

## 5. Final acceptance record

| Check                   | State   | Evidence to record                                                            |
| ----------------------- | ------- | ----------------------------------------------------------------------------- |
| Full L1 coverage        | Pending | Commit, command, included/excluded files, statements/branches/functions/lines |
| G1 strict checks        | Pending | Lint/typecheck/format results with zero warnings                              |
| Pre-commit gate         | Pending | Installed hook, measured runtime, unit/static failure probes                  |
| L2 production HTTP      | Pending | Endpoint inventory, passing contracts, authentication and asset checks        |
| G2 security             | Pending | Scanner versions, dependency/secrets results, committed-change scope          |
| Pre-push gate           | Pending | Measured runtime, API/scanner failure probes, new-branch behavior             |
| Required L3             | Pending | Executed/passed/failed/skipped counts, platform and journey matrix            |
| D1 local isolation      | Pending | Target/port guards, temporary runtime/browser state, cleanup proof            |
| Authentication boundary | Pending | Local authorization evidence and exact hosted Access/login evidence           |
| Build/distribution      | Pending | Production build, type generation, no-ROM distribution checks                 |
| CI/release paths        | Pending | Static/workflow checks and target-SHA gate regression results                 |
| Documentation           | Pending | Current file/command links, no stale completion claims, clean committed tree  |

## 6. Decisions and follow-ups

- 2026-09-06, B1: use Biome strict lint alongside TypeScript 7 strict typechecking. The attempted
  `typescript-eslint@8.69.0` integration fails at module load with an explicit unsupported-TS-7 error;
  its supported peer range is `>=4.8.4 <6.1.0`. Biome is an allowed nmem G1 implementation and avoids
  changing the project's compiler or suppressing incompatibility warnings. The uncommitted ESLint
  dependency attempt is removed before the G1 implementation commit.
- 2026-09-06, B1: retain Vitest and its coverage provider at 5.0.0. The preferred Microsoft mirror did
  not have the matching coverage package; the approved Tencent mirror did. Install-time mirror
  selection is temporary, and committed lockfile entries retain registry-independent resolution.
- Cloud databases and buckets remain unnecessary while the application has no remote persistence.
  Future cloud saves must reopen D1 applicability before automated tests access those resources.
- Application behavior and save compatibility are regression requirements throughout the work.
- 2026-09-06, B3 preparation: an isolated in-memory probe against `d89ff9d` confirmed two existing
  failures in [emulator.ts](../src/lib/emulator.ts). A rejected `recordPlayTime` loses the accumulated
  seven seconds before retry; a rejected `replaceBattery` leaves status `running` after `quitGame`.
  B3 must add failing-before/passing-after regressions and fix both alongside queue ordering. The
  probe replaces only process-local dependencies and never opens browser or production storage.
- 2026-09-06, B2 review: the existing `tsconfig.tests.json` extends application strict settings and
  already includes test sources. Root `tsconfig.json` references it, including at the original
  baseline. The earlier proposed additional test-typecheck commit was based on an incomplete config
  audit and is withdrawn. Correct fixture domain fields and run the existing G1 command.
- 2026-09-06, B3 preparation: real [storage.ts](../src/lib/storage.ts) in a fresh Chrome context on an
  owned ephemeral HTTP origin reproduced partial `replaceBattery` commit. Injecting a synchronous
  snapshot-delete failure after the battery put left the new battery committed and old automatic
  snapshot intact. B3 must abort this transaction and verify a clean retry. The probe closed its
  browser context and listener and never used the daily development origin or user browser profile.
- No work estimates are stored in this numbered implementation document.
- 2026-09-06, B5 preparation: the original L2 port 17047 is occupied by an existing Vite preview.
  Reserve 17048 for L2, preserving the preview, dev/Caddy on 7047, and L3 on 27047. This supersedes
  the port choice in the historical assessment; it does not relax ownership or occupied-port guards.
- 2026-09-06, B6 preparation: use OSV Scanner 2.5.1 and Gitleaks 8.30.1 for the project-owned local
  and CI security gates. Both versions are available locally. The historical shared workflow pins
  OSV 2.3.5, so CI must explicitly adopt the project pin; silently retaining different versions does
  not meet final acceptance.
- 2026-09-06, B7 preparation: temporary original GB/GBC/GBA programs executed in real mGBA WASM,
  changed their frame after an A press, changed the first battery byte from 1 to 2, and restored 2
  after a core reload. Every battery was 32768 bytes. Wait for observable save bytes: mGBA's filesystem
  does not reflect a new SRAM write immediately. The original GBA code is `ZPPE`; reusing `BPEE`
  incorrectly selects Emerald's FLASH1M override. These isolated prototypes are design evidence;
  committed fixtures and mandatory browser regressions remain B7 deliverables.
- The same preparation loaded the production Worker over an owned ephemeral HTTP listener with
  a locally signed RS256 token. Fresh browser contexts observed native fullscreen and fallback mode
  centered for all three platforms at 1440x1000; text and buttons shared the device scale. This
  confirms the expected geometry for B7 assertions and does not replace its required test gate or
  demonstrate a hosted SSO login.
- 2026-09-06, B4b review: earlier commit subjects include length and capitalization violations.
  Preserve that history and enforce the existing rule prospectively in B4d with a lightweight
  `commit-msg` hook and policy tests. Verify real hook failures in an owned temporary repository;
  never stage deliberately failing code in the shared checkout or bypass hooks for a documentation
  commit. New gate scripts remain in the first-party coverage inventory.
