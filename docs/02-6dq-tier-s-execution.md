# 6DQ Tier S execution

Status: in progress, Tier A verified. B1 through B7 and the B8 CI handoff are accepted, including all 30 required browser cases and the project-owned reusable quality workflow. All four aggregate coverage metrics exceed 90%; installed commit and pre-push hooks, browser lifecycle checks and strict CI result aggregation pass independent verification. B8 release gating and final acceptance remain pending; Tier S is not yet verified.

Started: 2026-09-06. Code baseline: `8a43e3c` (v1.1.0). Accepted assessment: `1979e8c`.
The [original assessment](01-6dq-adoption-plan.md) records the nmem requirements and baseline gaps.
This document is the current implementation contract, review ledger, and acceptance record.

The shared checkout was accidentally deleted during an unaccepted B7 isolation probe. The accepted
main history and working files are restored to `5e50221`; the [recovery record](03-workspace-recovery.md)
documents the evidence and required containment. The former recovery-era isolation draft remains
quarantined; the fresh independent continuation passes the ownership review recorded below.

## 1. Ownership and working agreement

The user requested staged implementation by the existing pi agent in Herdr, with Codex coordinating,
reviewing every batch, maintaining numbered documentation, and independently validating the result.

- **pi owns implementation:** work only on the assigned batch; implement behavior and its meaningful
  tests together; make atomic commits; report commit hashes, commands, results, and remaining issues.
- **Codex owns review and documentation:** inspect the complete changed modules, reproduce relevant
  checks, return concrete findings, and accept the batch only after every finding is resolved.
- After the B7 recovery, pi implements each handoff in a fresh independent clone outside the main
  development checkout. Shared objects, alternates, hardlinks, and linked worktrees are forbidden.
  Codex verifies the clone and baseline, reviews the exact offered commit, and imports accepted
  history without rewriting it. pi does not edit this document, the assessment, or documentation indexes.
- Each task may mutate only its assigned paths. Do not restore, checkout, or stash unrelated diffs
  to clean the working tree. Codex completes documentation writes and commits at stopped handoff boundaries.
- Each logical change gets a separate Conventional Commit with a lowercase subject of at most
  50 characters. Stage explicit paths. Do not reset, amend, rebase, or rewrite any created commit,
  including unaccepted handoffs. Review corrections are additional commits. Do not bypass active hooks.
- pi stops at the batch boundary and notifies the coordinating pane through `herdr agent prompt`,
  without waiting for the coordinator. It must not start the next batch without review acceptance.
- After the B4c3-S grouping deviation, each implementation handoff assigns one intended commit.
  Complete and review that logical change before dispatching the next one.
- Codex uses bounded lifecycle waits and a 45-second progress timer. On timeout, inspect the agent's
  current output and repository progress; on an error or blocked state, diagnose it before resuming.
  While implementation runs, prepare the next review and independent verification work.
- Preserve the daily development server on 7047, its Caddy domain, and the existing preview on 17047. Test runners own only their own
  temporary processes, ports, directories, and browser contexts.
- Browser verification starts only after the implementer has explicitly stopped. Use a separate
  output directory for independent review; B7 must reject concurrent runs before clearing artifacts.
- Any potentially destructive probe uses an additional disposable copy with verified canonical
  paths and independent Git objects. A sentinel or expected rejection does not authorize using a
  working checkout, its ancestors, another project, or a user profile as test output.

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

#### B4d handoff sequence

After B4c4 acceptance, close the known boundary gaps before activating hooks. Keep the full
executable-source inventory and all four 90% thresholds; each item is one implementation/review
handoff with its own atomic commit.

1. `test: verify cartridge hardware contracts`: save signatures and capacities, exact battery
   size/RTC suffix bounds, GB/GBC mapper/header variants, bounded reads, and rejection before
   oversized file reads or hashing.
2. `test: require download payload assertions`: replace nullable/conditional payload checks
   with required MIME/bytes and verify the actual 1000 ms revocation boundary and anchor cleanup.
3. `test: cover application startup boundaries`: exercise the actual main entry with an owned
   root, fail clearly when the root is absent, and close remaining public catalog behavior gaps.
4. If the regenerated report still falls short, assign a bounded commit for the identified
   emulator/maintenance-script failure or recovery contracts. Do not add hit-count-only tests,
   omit unimported files, or relax thresholds.
5. `chore: enforce unit and static commit gates`: pin Husky 9.1.7, add the shared parallel
   L1/G1 runner and tested commit-message policy, and install hooks only when their own maintained
   source is covered. The message policy accepts the six agreed types, a nonempty lowercase
   first line of at most 50 characters, and normal CRLF input; history remains unchanged.

Independent review uses actual installed hooks in an owned temporary repository: passing commit,
unit/static/message rejection, unchanged HEAD after rejection, owned-process cleanup, and a measured
passing pre-commit under 30 seconds. Unit tests for the gate must not recursively run the whole hook.
Documentation commits also pass the installed hooks; no bypass is authorized.

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
    - Follow with `fix: retain l2 listeners during cancellation`: retain owned signal listeners
      until cleanup settles, including repeated signals forwarded by the real npm command chain.
      Add a regression for repeated signals during deferred cleanup and preserve the initial exit
      status. Verify the default push-to-npm-to-L2-to-build chain, not only a direct child wrapper.
    - Then `fix: retain push cancellation listeners`: apply the same lifecycle guarantee to the
      outer `npm run quality:push` entry, retaining the first signal status across repeat or mixed
      signals. Verify the real foreground npm group and all captured detached descendants.
    - Finally `fix: retain commit and scanner signal listeners`: correct the same confirmed npm
      forwarding defect in `quality:commit` and standalone `quality:g2`. Keep child-process and
      scanner policies intact; test delayed cancellation with repeat/mixed signals in both wrappers.

Review: scanner versions and scope, outgoing Git ranges, argument quoting, installation guidance,
negative gate probes, isolation guards, and combined runtime under 3 minutes. **Milestone: Tier A.**

### B7 — required browser coverage

16. `test: add executable cartridge fixtures`
    - Add original runnable GB/GBC/GBA programs with observable rendering and save behavior.
    - Verify actual execution; a valid header alone does not satisfy this fixture contract.
    - Keep reviewable source/instructions in the repository and construct ROM bytes in tests.
      Do not commit ROM binaries or require a cross-compiler in CI. Use original cartridge
      identifiers so mGBA's commercial-game save overrides cannot change the fixture hardware.
    - Follow with one corrective handoff, `fix: restore active snapshot save memory`, before the
      broad journeys. The confirmed GB/GBC failure restores the displayed frame and saved file,
      but leaves active SRAM at the newer value. Use the pinned SDK's masked restore under an
      explicitly paused core for both manual and automatic snapshots; preserve pause ownership,
      failure/retry behavior, and queued persistence. Test the next emulated input as well as
      the restored frame. Battery files retain the last flushed game save until the next in-game
      write, matching the existing GBA boundary; do not invent synchronous file restoration.
17. `test: require core cartridge and save journeys`
    - Make import/start/pause/resume/reload and cross-platform switching mandatory for GB/GBC/GBA.
    - Assert snapshot CRUD/confirmation/cancellation/retry and meaningful `.sav` import/export results.
    - Keep local 12-ROM compatibility tests in an explicitly optional suite.
18. Browser authorization and isolation, split after the recovery into stopped handoffs:
    - First, `fix: guard browser artifact paths`: enforce early output/invocation checks in both
      browser configurations and prove raw CLI sentinel preservation in a disposable copy. Keep
      normal required and optional commands usable; this foundation alone does not accept isolation.
    - Then, `test: verify browser authorization and isolation`, completing the requirements below.
    - Test anonymous denial and authorized application load against the production harness.
    - Add `quality:l3`, restricted to owned loopback 27047. Validate target, invocation, output
      ownership and symlink ancestry, then acquire the cross-checkout port lock before any cleanup.
      Wrong targets, occupied ports and concurrent runs must leave existing output sentinels intact.
    - Guard raw Playwright invocations before its output-directory cleanup; `globalSetup` is too
      late in the installed runner. Keep the optional suite's target and output ownership explicit.
    - Reject empty, partial, skipped, expected-failure, failed and interrupted acceptance. Inspect
      each test's expected status and every result, not just aggregate JSON statistics.
    - Retain first-signal status and owned handlers through cleanup, including repeated npm signals.
      Verify captured browser process groups, runtime state, profiles and lock disposal; retain
      failure artifacts. Include every maintained root `*.config.ts` in strict typechecking.
19. `fix: improve navigation text contrast`
    - Correct the confirmed default enabled navigation labels below 4.5:1 without changing font size
      or weakening working hover/focus colors. Verify real alpha-composited colors across all 12
      themes and default, hover and keyboard-focus states in the required production suite.
20. `test: verify console layout and export behavior`
    - Cover fullscreen centering, proportional fonts/buttons, mobile/modals, and button contrast states.
    - Verify 1080-pixel-high PNG exports with the correct aspect ratio across all three platforms.
    - Before accepting this handoff, complete the independently identified prerequisite
      `test: wait for initial cartridge frames` in a fresh clone. The existing snapshot regression
      waits for battery byte 1 but reads the initial frame only once; wait for an observable valid
      frame and retain that successful sample before creating the snapshot. Preserve the layout
      draft, all live-state/persistence assertions, and the required no-skip inventory.

Review: every required browser test executes without commercial ROM availability, failure artifacts
are usable, assertions validate behavior rather than implementation details, and shared storage stays
isolated. Record the precise authentication/login boundary. No required core test may silently skip.

### B8 — CI, release gating, and final sign-off

21. `chore: align ci with local quality commands`
    - Use project-owned L1/G1/L2/G2/L3 entry points and the retained `test:http` regression in a
      reusable quality workflow; publish coverage and browser failure artifacts.
    - Preserve generated Worker type validation with `npm run cf:typegen -- --check`.
    - Read scanner pins from `scripts/quality-tools.json`, verify the actual installed versions,
      and scan complete Git history. Keep quality read-only without deployment secrets.
    - Each required job checks out the immutable input and obtains its actual tested SHA from
      `git rev-parse HEAD`. Strict aggregation requires every job success and every SHA equal;
      missing, skipped, cancelled, failed or mismatched results block acceptance.
    - Parse the actual YAML in maintained policy tests and validate it with actionlint.
22. `chore: require tested commits for every release`
    - Resolve one immutable full target SHA for main-CI, original tag-push objects, and validated
      manual tags. Read package version at that commit; every quality/deploy checkout uses it.
    - Require successful push CI from the expected workflow identity/path, same repository and
      main branch for automatic releases. Reuse the strict quality workflow for every target.
    - Reject stale automatic targets against the current main tip immediately before serialized
      deployment, so slow older CI cannot overwrite a newer deployment. Do not substitute a newer
      target silently; explicit manual/tag semantics remain unchanged.
    - Test real temporary Git histories: annotated/lightweight tags, moved/deleted refs, original
      event objects, invalid versions/provenance, stale CI ordering, and missing or wrong-SHA gates.
    - Preserve the production environment, deployment-only secrets, Access checks, version/tag
      checks, serialized deployment, and exact post-deploy version checks.

Review: actual reusable workflow inputs, checkout refs, job dependencies/conditions, token permissions,
and negative cases for failed, missing, skipped, or unrelated-SHA results. Validate delivery logic
without redeploying the already-released v1.1.0 merely as a test.

Codex then runs the complete final acceptance matrix from a clean committed tree, resolves any final
findings through additional atomic fixes, and commits the final implementation/evidence documentation.
**Milestone: Tier S only when every applicable check below has recorded passing evidence.**

## 4. Review ledger

| Batch | State    | Implementation commits                                                                                                                                                                                                                           | Review and evidence                                                                                                                                      |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | Accepted | `59bbfa2`, `d89ff9d`                                                                                                                                                                                                                             | 74 unit tests; strict G1 and build pass; 11 independently verified browser cases; coverage baseline below                                                |
| B2    | Accepted | `85cd089`, `1995b59`, `b47caa6`, `d4123eb`, `e816964`                                                                                                                                                                                            | 111 unit tests; independent G1, build, 12 browser cases, and deferred command probes pass                                                                |
| B3    | Accepted | `ebe6901`, `76a6148`, `a9f7339`, `c052d68`, `ba035c8`, `242bd91`, `48d2742`                                                                                                                                                                      | 139 unit tests; independent G1, build, 27 browser cases, recovery and transaction probes pass                                                            |
| B4a   | Accepted | `fff1da2`, `8f9f008`                                                                                                                                                                                                                             | 169 unit tests; independent G1, coverage, and build pass; boundary tests and mock isolation reviewed                                                     |
| B4b   | Accepted | `405f7a1`, `3d40fcc`, `8e44499`, `590f6da`, `bddd7e3`                                                                                                                                                                                            | 197 unit tests and one HTTP test; independent G1, coverage, build, and process-cleanup probe pass                                                        |
| B4c1  | Accepted | `8e1b53d`, `264675d`, `10d1e6e`                                                                                                                                                                                                                  | 225 unit tests; independent G1, coverage, and build pass; device/input/dialog behavior reviewed                                                          |
| B4c2  | Accepted | `b1933ca`, `d08a034`                                                                                                                                                                                                                             | 238 unit tests; independent G1, coverage, and build pass; library/save/confirmation behavior reviewed                                                    |
| B4c3  | Accepted | `dcd1071`, `dcd2b64`, `4c24720`, `58c320b`, `5b32f30`, `afeff79`, `6f93cc3`, `5fbd930`, `fc8bb52`, `f43069d`, `7d5383f`, `c3a1a36`, `bf8cc79`, `6d629ad`, `79d725c`, `76aea87`, `7ed6ad8`, `850c683`, `e984a6f`, `624322f`, `757a0ed`, `133afc8` | 286 unit tests; independent G1/coverage and modal checkpoint payload/recovery review pass; all B4c3 follow-ups accepted                                  |
| B4c4  | Accepted | `23f9198`, `7a534ed`, `d9295ec`, `38f5e03`, `6ef2389`, `dd4aca0`                                                                                                                                                                                 | 292 units; independent G1/coverage, input/lifecycle probes, negative guards, and descriptor cleanup pass                                                 |
| B4d   | Accepted | `a5ceafa`, `c74d9bd`, `fbde21d`, `16e83e4`, `fbd52cc`, `8c24c5c`, `9a3545c`, `49a79ab`                                                                                                                                                           | 363 units; G1/build; all four metrics >=90%; actual hooks and failure/process probes pass; Tier B verified                                               |
| B5    | Accepted | `8604276`, `0bfecb5`, `91685a6`, `cf2514d`, `759c65a`, `38cb1f5`, `d5ff4f9`                                                                                                                                                                      | 388 units; G1/L1, production build, 40 real HTTP contracts, independent bytes/authentication and inventory rejection pass                                |
| B6    | Accepted | `48894ea`, `ca704a2`, `24ee4a1`, `cc58d97`, `4195859`, `72b0dab`, `0d3a3be`                                                                                                                                                                      | 467 units; all coverage metrics >=90%; installed push hook, real npm cancellation, L2/G2 pass; Tier A verified                                           |
| B7    | Accepted | `a29eff5`, `0d60e83`, `19f0b0f`, `94cbe07`, `d563a35`, `cc48e66`, `f7e37bd`, `ac8f37f`, `9409642`, `823bc49`                                                                                                                                     | 612 units; G1/L1; all 30 required cases, browser ownership, navigation/button contrast, fullscreen scaling and PNG export pass                           |
| B8    | Partial  | `a7a3b42`                                                                                                                                                                                                                                        | CI accepted: 651 units, G1/L1, HTTP, L2/G2, type consistency, actionlint, 33 actual YAML executions and six scanner installation probes; release pending |

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

The B4 atomic boundaries in section 3 are separate implementation/review handoffs. B4a, B4b, B4c1, and
B4c2 and B4c3 are accepted. B4c is divided into the four bounded handoffs below; B4c4 is next, and pi
must stop for review after each intended commit. Keep coverage scope and thresholds unchanged until the reviewed
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
4. **B4c4 — App lifecycle.** First fix the reproduced stale gamepad name after polling-effect
   recreation, with focused disconnect/reconnect regressions. Then make separate atomic commits
   for keyboard/gamepad behavior and browser lifecycle/fullscreen behavior. Exercise event
   registration, polling, disconnection, focus changes, unmount cleanup, and native/fallback
   fullscreen transitions through the mounted application.

Each handoff includes G1, unit coverage, and a production build before its review. Actual regressions
receive their own fix commits. Neither DOM coverage nor the fast unit gate replaces B7's real browser
and WASM execution requirements.

The B4c3 foundation checkpoint below divided command follow-ups into saves/downloads, cartridge
commands, and settings/modals. All of those follow-ups are now accepted in the evidence sections
below. Each B4c4 handoff assigns one intended atomic commit and stops for review before the next.

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
browser geometry and actual WASM remain B7 requirements. Library and save components are recorded in
B4c2 below.

### B4c2 acceptance evidence

Reviewed implementation: `d08a034`, following `b1933ca`. Separate atomic commits cover the actual
CartridgeGallery/SeriesLibrary and SaveSlots/SnapshotConfirmation components. Confirmation tests use
the production Modal. No production source, dependencies, or coverage scope changed.

Independent checks on 2026-09-06:

- `bun run test:coverage`: 238 tests across 25 files pass in 0.94 seconds wall time. Coverage is
  70.17% statements (1327/1891), 61.87% branches (896/1448), 63.47% functions (278/438), and 72.42%
  lines (1200/1657). App and all maintained scripts remain in the denominator.
- `bun run quality:g1`: Biome checks 73 files with zero errors/warnings; strict TypeScript and
  formatting pass. `bun run build` passes for the production Worker/client and distribution checks.
- Library tests verify filtering/search/reset, cached launch while the catalog is pending, exact
  edition/local revision callbacks, selected states, unknown cartridges, and owned/catalog/unavailable
  presence. Ready counts use a distinct union, and catalog-only featured cards work before caching.
- Save tests map unsorted snapshots to manual slots, exclude automatic slots, route exact action
  payloads, and suppress load/create/replace/delete while inactive or busy. Confirmation preserves
  Cancel autofocus, accessible title/description references, preview/game/time data, action copy,
  error feedback, and retry. While busy, Escape/native cancellation prevent default, and backdrop,
  close, Cancel, and confirm cannot dismiss or mutate; returning idle restores the intended actions.

Review required actual disabled-action attempts and separate cached/catalog-only readiness cases.
The implementer also reports the unchanged developer HTTP test passing. Browser/WASM regressions
remain B7 work; these component callbacks do not replace B4c3's actual App/controller wiring tests.
All B4c2 findings are resolved, and both agents' runners are stopped before the next handoff.

### B4c3 foundation review checkpoint

This historical checkpoint precedes the accepted follow-ups recorded below. Its open findings and
coverage figures describe that revision, rather than the current implementation status.

Reviewed implementation: `58c320b`, following `dcd1071`, `dcd2b64`, and `4c24720`. The mounted App
uses the production cartridge, snapshot, modal-pause, and input controllers. The shared
[App harness](../tests/helpers/app-test-helper.ts) subclasses the actual PocketEmulator and injects
only its core, storage, clock, and isolation boundaries. Each test owns its IndexedDB factory,
core filesystem data, RAF queues, and emulator interval tracking. Production source, dependencies,
and coverage scope are unchanged.

Independent checks on 2026-09-06:

- `bun run test:coverage`: 255 tests across 28 files pass in 2.60 seconds. Coverage is 86.09%
  statements (1628/1891), 79.28% branches (1148/1448), 86.98% functions (381/438), and 88.35% lines
  (1464/1657). App remains in scope at 69.11% statements and 72.00% lines.
- `bun run quality:g1`: Biome checks 77 files with zero errors/warnings; strict TypeScript and
  formatting pass. `bun run build` passes for the production Worker/client and distribution checks.
- Reviewed paths include cartridge startup/drop/local selection and canvas identity, settings
  persistence and live volume, modal pause ownership, restart confirmation, manual snapshot creation
  and load, automatic-slot confirmation/cancellation, and a rejected delete followed by retry.
- Battery import checks extension/capacity, zero replacement before confirmation or after cancel,
  and exactly one confirmed replacement with all 131072 supplied bytes. Export asserts the actual
  current-core bytes. Screenshot wiring checks the exact source URL, 1620x1080 drawing, PNG MIME and
  supplied encoder bytes, manual toast dismissal, and rejection of a failed image decode.

The implementer also reports the unchanged developer HTTP test passing. These results verify the
foundation. The follow-up status is:

1. **Saves/downloads: accepted.** The evidence below covers actual replacement, cancellation and
   rejected writes, delete retry, deferred busy guards, exact core bytes, download cleanup, toast
   expiry, and failed export/capture. The initial foundation alone did not establish these results.
2. **Cartridge commands.** Verify independent pending catalog/storage initialization, actual ROM
   input change/value reset, picker cancellation from running and already-paused games, invalid
   imports and catalog-ROM failures followed by retry, and deferred load/return guards. Assert the
   originating cartridge bytes and paths. Await visible command completion after UI events.
3. **Settings/modals.** Verify restored settings/bindings on a fresh mount and in help, in-memory
   settings after persistence rejection, modal persistence errors with correct pause ownership, and
   deferred/failed restart followed by retry. Keep failures at the real core/storage boundary.

Review already corrected assertions that accepted null DOM elements, stale interval tracking, and
the assumption that awaiting a click waits for an asynchronous App command. Snapshot assertions must
account for the automatic checkpoint produced when opening a running game's modal. Seed snapshots
before emulator load, count mutations for the intended slot, and distinguish boot restoration from
the later user-confirmed load. The follow-ups retain these verified constraints.

### B4c3-S acceptance evidence

Reviewed implementation: `5b32f30` and the focused cancellation/count correction `afeff79`.
Only [the App save/download suite](../tests/unit/app-snapshots-and-saves.test.tsx) changed;
production source, the shared harness, dependencies, and coverage scope are unchanged.

Independent checks on 2026-09-06 used an isolated checkout pinned to `afeff79`, with separate
TypeScript/Vite caches and coverage output:

- `bun run test:coverage`: 256 tests across 28 files pass in 2.81 seconds. Coverage is 86.30%
  statements (1632/1891), 79.55% branches (1152/1448), 87.67% functions (384/438), and 88.53%
  lines (1467/1657).
- `bun run quality:g1`: Biome checks 77 files with zero errors/warnings; TypeScript and Prettier pass.
  `bun run build` passes for the production Worker/client and both distribution scans.
- Manual creation stores known bytes. Cancelling replacement performs no extra manual-slot writes.
  Deferred replacement blocks repeat confirmation, cancellation, Escape, backdrop dismissal, and
  returning to the gallery; a later event-loop turn confirms unchanged write/load counts and data.
  A rejected write preserves the original bytes, and retry executes the original storage mutation
  with different bytes. Manual load performs no pre-confirmation load/write and supplies the correct
  state path and bytes after confirmation. Failed delete retains data; retry removes it in storage
  and restores the empty-slot UI with exactly two attempts.
- Screenshot checks retain exact source, dimensions, MIME, and bytes, and verify filename/href and
  a connected-then-removed download anchor. Owned clocks verify revocation at 1000 ms, a success toast
  present at 3799 ms and absent at 3800 ms, and an error toast present at 7499 ms and absent at 7500 ms.
  Battery export drains its own revocation callback. Capture/decode/export failures do not download;
  manual error-toast dismissal remains covered.

The implementer also reports the unchanged developer HTTP test passing. Review corrected the
fake-timer interaction with Testing Library asynchronous queries; the probe-evidence correction is
recorded in [Retrospective.md](../Retrospective.md). No browser or hosted-login evidence is claimed
for this unit-test follow-up.

Commit grouping deviated from the requested two implementation commits: `5b32f30` combined the two
S groups before the coordinator's split reminder arrived. That history is preserved, and `afeff79`
adds the review correction without rewriting it. Subsequent handoffs each assign one intended
commit; documentation stays in separate commits.

At this checkpoint, B4c3 remained open for cartridge commands and settings/modals. The O1-O4 and
M1-M3 acceptance records below complete those follow-ups, each reviewed before the next handoff.

### B4c3-O1 acceptance evidence

Reviewed implementation: `6f93cc3` and assertion/cleanup correction `5fbd930`.
[App](../src/App.tsx) now reads the general busy ref and both controllers synchronously before
user pause/resume actions. The paused canvas overlay and toolbar also expose the matching disabled
state. This closes the three return-to-gallery resume races recorded in `59680f9`.

Independent checks on 2026-09-06:

- At `6f93cc3`, four isolated real-App probes pass in 869 ms: canvas, toolbar, and Space during a
  deferred battery write, plus Return and Space in one synchronous event turn. The latter probe
  failed against `afeff79` because `resumeGame` ran once before the write completed. All four pass
  after the fix; the hidden game stays paused, and the original storage mutation still completes.
- At `5fbd930`, `bun run test:coverage` passes all 261 tests across 28 files in 2.75 seconds.
  Coverage is 87.00% statements (1653/1900), 80.89% branches (1177/1455), 87.92% functions
  (386/439), and 89.41% lines (1486/1662). Scope and exclusions are unchanged.
- `bun run quality:g1` passes at `5fbd930`: Biome checks 77 files with zero errors/warnings,
  TypeScript and Prettier pass. Production Worker/client build and both distribution scans pass
  at `6f93cc3`; the follow-up changes only tests, leaving those production inputs unchanged.
- The committed failure/retry regression checks the visible error, paused play view, restored
  controls, normal resume, exactly two battery-write attempts, the successful return, and exact
  persisted bytes. Every deferred return test releases its write and awaits completion in
  `finally`, including when an assertion fails.

The implementer also reports the unchanged developer HTTP regression passing (1/1). This acceptance
covers the resume guard; initialization, ROM picker/fetch recovery, and modal follow-ups remain open.

### B4c3-O2 acceptance evidence

Reviewed implementation: `fc8bb52` and assertion refinement `f43069d`. Only the mounted
[App initialization suite](../tests/unit/app-initialization.test.tsx) changes. Production App,
controllers, emulator, dependency versions, and coverage scope are unchanged.

Independent checks on 2026-09-06 used an isolated checkout fixed at `f43069d`:

- `bun run test:coverage`: 267 tests across 29 files pass in 2.72 seconds. Coverage is 87.05%
  statements (1654/1900), 80.96% branches (1178/1455), 87.92% functions (386/439), and 89.41%
  lines (1486/1662).
- `bun run quality:g1`: Biome checks 78 files with zero errors/warnings; TypeScript and Prettier
  pass. Production inputs match the independently built O1 implementation; the implementer also
  reports production build and the unchanged developer HTTP regression (1/1) passing.
- With catalog loading deferred, a cached cartridge starts using its exact stored ROM bytes and
  ROM/save paths. Releasing catalog loading visibly changes another edition from unavailable to
  ready. Catalog completion alone does not mark deferred local storage ready.
- Deferred storage restores nondefault Ruby using matching header/data/system and exact launch
  bytes/paths. A newer FireRed selection survives late initialization even when preference writes
  fail and stored preferences still select Emerald. Network, 500, and 404 catalog failures preserve
  cached launch behavior. Deferred boundaries are released and settled during cleanup.
- Two sequential negative checks temporarily altered only the isolated checkout, restoring the
  source in `finally`. Removing `userSelected` precedence fails the FireRed assertion (1 failure,
  5 passes, 1.01 seconds); ignoring saved preferences fails the Ruby assertion (1 failure, 5 passes,
  1.02 seconds). Both mutations passed all six tests before the refinement. The final tests now
  distinguish the intended behavior, and the isolated checkout is clean after both checks.

O2 is accepted. O3 and O4 acceptance follows below, including catalog-ROM failure recovery and
competing commands. The later settings/modal and B4c4 records complete the subsequent follow-ups.

### B4c3-O3 acceptance evidence

Reviewed implementation: `7d5383f` and assertion refinement `c3a1a36`. Only the mounted
[App ROM picker suite](../tests/unit/app-picker.test.tsx) changes. App, controllers, emulator,
the shared harness, dependencies, and coverage scope remain unchanged.

Independent checks on 2026-09-06 used an isolated checkout fixed at `c3a1a36`:

- `bun run test:coverage`: 272 tests across 30 files pass in 2.81 seconds. Coverage is 87.94%
  statements (1671/1900), 81.58% branches (1187/1455), 89.29% functions (392/439), and 90.31%
  lines (1501/1662). The four-metric L1 gate had not been enabled at this checkpoint; B4d records its acceptance.
- `bun run quality:g1`: Biome checks 79 files with zero errors/warnings; TypeScript and Prettier
  pass. Production inputs still match the independently built O1 source. The implementer reports
  the production build and unchanged developer HTTP regression (1/1) passing, with probes removed
  and runners stopped.
- Cancelling the actual picker resumes a previously running game exactly once and preserves an
  already-paused game. The tests observe the input click, a held Up press and release at the core,
  no additional ROM load or cartridge write, unchanged stored/core ROM bytes, and canvas identity.
- Real upload events expose a nonempty filename before the App handler clears the input. A corrupt
  header shows the specific error while retaining the old cartridge/core bytes; a same-name Ruby
  retry stores the exact new bytes and loads the hashed ROM/save paths. Preference changes and
  the final running state are checked after the retry.
- A rejected File read preserves stored bytes and leaves enabled controls and a successful import
  retry. An unsupported extension reaches application validation and then accepts a valid ROM;
  the test disables only the upload tool's extension filtering for the rejected-file case.
- A focused negative check removes only the production input-reset statement in the isolated
  checkout. The intended assertion fails on the retained fake path in 495 ms; the original
  `7d5383f` test had passed with that statement removed. Source restoration runs in `finally`,
  and the isolated checkout is clean afterward.

O3 is accepted. The O4 acceptance below completes cartridge-command follow-ups.

### B4c3-O4 acceptance evidence

Reviewed implementation: `bf8cc79`, `6d629ad`, and `79d725c`. Only the mounted
[App command suite](../tests/unit/app-commands.test.tsx) changes. Production source, shared
harness, dependencies, and coverage scope remain unchanged.

Independent checks on 2026-09-06 used an isolated checkout fixed at `79d725c`:

- `bun run test:coverage`: 277 tests across 31 files pass in 3.00 seconds. Coverage is 88.05%
  statements (1673/1900), 81.85% branches (1191/1455), 89.29% functions (392/439), and 90.43%
  lines (1503/1662). All four thresholds remain required for L1 acceptance.
- `bun run quality:g1`: Biome checks 80 files with zero errors/warnings; TypeScript and Prettier
  pass. Production inputs still match the independently built O1 source. The implementer reports
  the production build and unchanged developer HTTP regression (1/1) passing, with runners stopped.
- HTTP 500, HTML, and transport failures show an error, write no cartridge, and load no core ROM.
  Returning to the gallery and using its actual Start action retries successfully, preserving exact
  imported bytes, SHA-256 identity, ROM/save paths, and final running status.
- Deferred load/return tests use the original asynchronous storage implementations. They attempt
  competing edition/local-revision selection, unavailable-edition picker entry, drops, and return;
  pending return also receives a file-input event. The repeated-start attempt targets the mounted
  disabled console button. Stored preferences and visible selection remain unchanged during and
  after completion, with no extra cartridge writes or loads. The returned battery retains exactly
  `[1, 2, 3, 4]`, and load checks the original stored/core ROM bytes and both paths.
- Every deferred test releases and settles its actual operation in `finally`, including the two
  emulator RAFs and visible command completion. Canvas identity remains stable. Review corrected
  a detached gallery-button assertion: an isolated DOM-liveness probe at `6d629ad` demonstrated
  that the old reference was disconnected. The final test requires the current button to be
  connected and disabled; the temporary probe was restored and the isolated checkout is clean.

O4 is accepted. The M1-M3 acceptance records below complete the settings, pending-confirmation,
and modal checkpoint follow-ups. B4c4 and B4d-B8 were subsequent batches in the execution plan.

### B4c3-M1 acceptance evidence

Reviewed implementation: `76aea87` and `7ed6ad8`. Only the mounted
[App settings/modal suite](../tests/unit/app-settings-and-modals.test.tsx) changes. Production
source, the shared harness, dependencies, and coverage scope remain unchanged.

Independent checks on 2026-09-06 used an isolated checkout fixed at `7ed6ad8`:

- `bun run test:coverage`: 278 tests across 31 files pass in 3.11 seconds. Coverage is 88.57%
  statements (1683/1900), 82.54% branches (1201/1455), 89.97% functions (395/439), and 90.97%
  lines (1512/1662).
- `bun run quality:g1`: Biome checks 80 files with zero errors/warnings; TypeScript and Prettier
  pass. Production inputs still match the independently built O1 source. The implementer reports
  the production build and developer HTTP regression (1/1) passing, with runners stopped.
- Real UI changes persist volume 0.4, mute, LCD filtering, disabled automatic pause, and A = J.
  A new App mount and fresh emulator harness restore the rendered settings, game filter, actual
  help-dialog label, and keyboard press/release behavior; the started core receives muted volume.
  The first mount's owned resources are cleaned while its preference storage is retained.
- A spy on the actual localStorage instance rejects subsequent settings writes. Unmuting still
  updates the core to 0.4, crisp filtering takes effect, and rebinding A to U updates settings and
  the actual help dialog. The new key presses/releases A exactly once; the old J key has no effect.
  The persisted settings string remains unchanged throughout, and the spy is restored in `finally`.
- A focused negative check fixes only the actual help A-label to the default O. The original
  `76aea87` restoration test still passes in 681 ms; the final test fails on the expected O-versus-J
  assertion in 663 ms. Source restoration runs in `finally`; the isolated checkout is clean.

M1 is accepted. The M2 baseline review required protection for confirmed restart/import operations
until completion, while retaining failure/retry and pre-confirmation cancellation. In addition to the
four documented Cancel/Escape baseline failures, two independent same-event confirm/cancel cases at
`79d725c` failed in 775 ms:
both dialogs disappear while the original deferred write still completes. The owned probe suite
now contains six cases and awaits the complete command, including its success UI and final bytes.
M3 remains limited to modal checkpoint ownership/recovery cases not already covered by M1/M2.

### B4c3-M2 acceptance evidence

Reviewed implementation: `850c683`, `e984a6f`, and `624322f`. The production change in
[App.tsx](../src/App.tsx) protects restart/import dismissal synchronously and disables confirmation
controls while the operation is pending. Successful commands retain their internal close path;
failed commands leave an enabled confirmation dialog for retry.

Independent checks on 2026-09-06 used an isolated checkout fixed at `624322f`:

- `bun run test:coverage`: 280 tests across 31 files pass in 5.86 seconds. Coverage is 88.65%
  statements (1688/1904), 82.75% branches (1209/1461), 90.00% functions (396/440), and 90.99%
  lines (1515/1665). The complete first-party inventory remained included; L1 acceptance followed in B4d.
- `bun run quality:g1`: Biome checks 80 files with zero errors/warnings; TypeScript and Prettier
  pass. The production build and both no-ROM checks passed independently at `850c683`; the two
  later commits change tests only. The implementer also reports the developer HTTP regression
  passing (1/1), with all runners stopped.
- Running and already-paused games preserve their pause ownership through Cancel, Escape,
  backdrop, X, and native cancel events before confirmation. Tests assert exact resume counts,
  wait for each opening checkpoint, and retain actual core/storage mutations behind deferred writes.
- During confirmation, same-event repeated confirmation and cancellation start only one write.
  All dismissal controls remain blocked, with unchanged stored/live save bytes and no premature
  reset, quit, or load. Cleanup releases and settles the operation through its success UI and
  closed dialog. Restart failure preserves saved bytes; retry resets exactly once.
- Battery import verifies all 131072 replacement bytes in storage and the core save path. A failed
  replacement retains the old bytes and load count; retrying in the same dialog writes distinct
  replacement bytes and loads the cartridge exactly once more.
- Six independent pending-dialog probes pass at the production revision. Removing only the
  synchronous `dismissModal` guard, while retaining rendered busy and Modal protections, makes
  both same-event probes fail on the missing dialog in 778 ms. Source restoration runs in
  `finally`; the isolated checkout is clean afterward.

M2 is accepted. The M3 evidence below completes the remaining ordinary-modal checkpoint recovery
and pause-ownership cases.

### B4c3-M3 acceptance evidence

Reviewed implementation: `757a0ed` and `133afc8`. The new
[modal recovery suite](../tests/unit/app-modal-recovery.test.tsx) exercises the mounted App with
production controllers and emulator, owned core/storage/clock boundaries, and fresh IndexedDB.
Both commits change tests only.

Independent checks on 2026-09-06 used an isolated checkout fixed at `133afc8`:

- `bun run test:coverage`: 286 tests across 32 files pass in 6.72 seconds. Coverage is 88.70%
  statements (1689/1904), 82.75% branches (1209/1461), 90.22% functions (397/440), and 90.99%
  lines (1515/1665). The full inventory remained included; all four L1 thresholds were not yet met at this checkpoint.
- `bun run quality:g1`: Biome checks 81 files with zero errors/warnings; TypeScript and Prettier
  pass. Production source is unchanged from the independently built M2 revision. The implementer
  also reports the production build and developer HTTP regression (1/1) passing, with runners stopped.
- Help and saves dialogs each cover initially running and already-paused games. Every opening
  awaits its own real asynchronous checkpoint, including overwrite of slot 0. Assertions verify
  exact snapshot key, ROM, slot, `[1, 2, 3, 4]` data and battery bytes, plus pause/resume ownership.
- A rejected checkpoint reports its error without storing an automatic snapshot or closing the
  dialog. Closing resumes exactly once. Opening settings then performs exactly one successful
  checkpoint with the original cartridge bytes; load/quit counts stay unchanged and the final
  close preserves exact cumulative pause/resume totals.
- Library help closes without any cartridge load, core pause/resume, or save writes. Review replaced
  a vacuous typed-array assertion with exact nonempty payload comparisons and strengthened failure
  and retry counts; no production change was needed.

M3 and B4c3 are accepted. The B4c4 records below cover the confirmed gamepad status regression,
input wiring, and browser lifecycle tests; B4d records the subsequent Tier B gate acceptance.

### B4c4 gamepad status acceptance

Reviewed implementation: `23f9198`. [App.tsx](../src/App.tsx) now synchronizes the reported gamepad
name on every poll, relying on React's equal-state bailout. Removing the effect-local name cache
prevents stale connection text after modal or view changes; input ownership and polling cleanup
remain unchanged.

Independent checks on 2026-09-06 used an isolated checkout fixed at `23f9198`:

- The original mounted-App disconnect probe passes (1/1, 904 ms), after failing on the stale name
  at `624322f`. Its navigator, RAF, storage, and DOM resources are owned by the probe.
- `bun run test:coverage`: 287 tests across 32 files pass in 5.97 seconds. Coverage is 89.63%
  statements (1704/1901), 83.34% branches (1216/1459), 90.90% functions (400/440), and 91.87%
  lines (1527/1662). The small denominator reduction is the removed cache, with unchanged scope.
- G1 passes with 81 Biome files and zero errors/warnings. The production build and both no-ROM
  distribution checks pass. The implementer reports the developer HTTP regression passing (1/1).
- The committed regression verifies first-poll disconnect after effect recreation, reconnection
  under a new name, one pending poll across modal transitions, and zero pending callbacks after
  explicit unmount, before harness cleanup. Navigator restoration uses a single descriptor-based
  `finally` that also covers render/readiness failures.

The focused fix is accepted. B4c4 remains open for the separate input and browser lifecycle commits.

### B4c4 input acceptance

Reviewed implementation: `7a534ed` and `d9295ec`. The new
[App input suite](../tests/unit/app-input.test.tsx) dispatches DOM events and owned gamepad polls
through the production controllers and emulator. Both commits change tests only.

Independent checks on 2026-09-06 used an isolated checkout fixed at `d9295ec`:

- `bun run test:coverage`: 289 tests across 33 files pass in 6.05 seconds. Coverage is 90.84%
  statements (1727/1901), 85.19% branches (1243/1459), 91.59% functions (403/440), and 93.02%
  lines (1546/1662). Scope is unchanged; branch coverage still falls short of L1.
- G1 passes with 82 Biome files and zero errors/warnings. Production source is unchanged from
  the independently built `23f9198`; the implementer reports build and developer HTTP (1/1) passing.
- Keyboard checks verify mapping/repeats, keyup under changed editing focus without a window blur,
  editable/modifier guards, button/link/nested activation, real pause checkpoints, mute, rebinding,
  and restoring a nondefault 2x speed on keyup, blur, and focus-mode cleanup. Nested events execute
  unconditionally; guards assert core call counts rather than only the running label.
- Two pads and a keyboard can hold A together. Disconnecting pads preserves remaining holders;
  the last holder releases A once. Modal, pause/resume, and real return-to-gallery transitions
  assert new press/release calls, save identity/bytes, and disabled input in the library. Tests
  inspect RAF cancellation before harness cleanup and restore the navigator descriptor in `finally`.
- Two independent input probes pass at the unchanged production revision (654 ms). At `7a534ed`,
  removing the editing guard, repeated-shortcut guard, or paused-gamepad condition separately makes
  the committed suite fail on unexpected presses, incorrect restored speed, or resume input calls
  (0.88, 0.90, and 0.92 seconds). Source restoration runs in `finally`; the checkout is clean.

Input wiring is accepted; lifecycle acceptance is recorded below.

### B4c4 browser lifecycle acceptance

Reviewed implementation: `38f5e03`, `6ef2389`, and `dd4aca0`. The new
[App lifecycle suite](../tests/unit/app-lifecycle.test.tsx) exercises visibility, pagehide, native
fullscreen, and focus-mode fallback through actual DOM events and production application wiring.

Independent checks on 2026-09-06 used an isolated checkout fixed at `dd4aca0`:

- `bun run test:coverage`: 292 tests across 34 files pass in 5.97 seconds. Coverage is 91.84%
  statements (1746/1901), 85.94% branches (1254/1459), 93.18% functions (410/440), and 93.74%
  lines (1558/1662). The full source inventory is unchanged; branch coverage still prevents L1.
- G1 passes with 83 Biome files and zero errors/warnings. Production source is unchanged from
  the independently built `23f9198`; the implementer reports build and developer HTTP (1/1) passing.
- Visibility checks release held input and temporary speed, distinguish both auto-pause settings,
  await the settings-opening checkpoint before measuring new writes, and verify automatic snapshot
  and battery identities/bytes. Visible events do not write; persistence failures remain visible.
- Pagehide checks await the newly rejected checkpoint, read the retained snapshot/battery bytes,
  and verify a subsequent event writes successfully. No-cartridge and post-unmount checks advance
  the event loop before asserting no writes. Listener spies match the actual removed handlers;
  RAF cancellation is checked before harness cleanup.
- Native fullscreen exit failure retains the exit control and succeeds on a real button retry.
  Rejected/unavailable fullscreen uses focus mode; Escape and return-to-gallery clear that mode.
  Each replaced document or stage property restores its original own descriptor on the same object.
- An independent descriptor probe at `38f5e03` detected a leaked `document.exitFullscreen`
  after all three original tests passed (1.04 seconds). At `dd4aca0`, that same probe verifies
  restoration of `hidden`, `fullscreenElement`, and `exitFullscreen` and passes in 1.09 seconds.
  Temporary probe edits are restored in `finally`; the review checkout is clean.

B4c4 is accepted. B4d owns the remaining boundary tests, enforced coverage, and commit gates.

### B4d cartridge hardware acceptance

Reviewed implementation: `a5ceafa`, a test-only commit adding
[cartridge hardware contracts](../tests/unit/cartridge-hardware-contracts.test.ts).

Independent checks on 2026-09-06 at that fixed commit pass: 317 tests across 35 files in 6.22 seconds,
G1 with 84 Biome files and zero errors/warnings, and unchanged full-source coverage scope. Coverage is
92.00% statements (1749/1901), 88.00% branches (1284/1459), 93.18% functions (410/440), and 93.74%
lines (1558/1662). `cartridge.ts` and `rom-header.ts` reach 100% in all four metrics.

The tests cover GBA save signatures/capacities and independent RTC detection; accepted battery
capacity, interior RTC suffixes and exact upper/lower rejection bounds; mapper and irregular-size
headers; no-RAM/unknown-RAM behavior; title/code/maker parsing; and nonzero-offset 192-byte GBA and
336-byte GBC header reads. Oversized files fail before reading or hashing, and spies are restored.

Three independent mutations each make the committed tests fail: reducing the RTC allowance to
63 bytes, ignoring the input slice offset, and reading an oversized file before validation
(0.26, 0.26, and 0.27 seconds). Source restoration runs in `finally`; the checkout is clean.
Production source remains at the previously built revision; the implementer reports build and
developer HTTP passing. Hardware coverage is accepted; B4d's remaining handoffs and hooks stay open.

### B4d download assertion acceptance

Reviewed implementation: `c74d9bd`. [Screenshot/download tests](../tests/unit/screenshot.test.ts)
now require an actual Blob and unconditionally verify its MIME type and all payload bytes. They
assert one click/removal, exactly 1000 ms scheduling, no early URL revocation, and one revocation
of the created URL. Deferred image decoding settles in `finally`, including assertion failures.

Independent G1 passes with 84 Biome files and zero errors/warnings; all 317 tests across 35 files
pass in 5.98 seconds. Full-source coverage remains 92.00% statements, 88.00% branches, 93.18%
functions, and 93.74% lines. Production source is unchanged. Download assertions are accepted;
startup/runtime boundary work and commit gates remain open.

### B4d startup boundary acceptance

Reviewed implementation: `fbde21d` and `16e83e4` in
[application bootstrap tests](../tests/unit/app-bootstrap.test.tsx). The actual entrypoint uses
real React rendering with a minimal App import fixture, checks the owned root argument, and rejects
a missing root before calling `createRoot`. Teardown unmounts every captured React root inside
`act`, removes owned DOM nodes, restores module/global mocks, and does not swallow cleanup errors.
Catalog contracts include default-edition configuration failure, ID lookups, GBA code prefixes,
GB/GBC title variants, and platform separation.

The initial test removed its DOM node without unmounting the React root and left a global fetch
stub installed. An independent after-suite probe failed on the leaked fetch at `fbde21d` in
0.50 seconds. At `16e83e4`, the probe passes in 0.51 seconds and additionally verifies that the real
`createRoot` module is restored and the owned root is absent. Probe edits are restored in `finally`.

Independent validation at the fixed final SHA passes: 324 tests across 36 files in 6.22 seconds;
G1 checks 85 Biome files with zero errors/warnings, strict TypeScript and formatting all passing.
Full-source coverage is 92.26% statements (1754/1901), 88.21% branches (1287/1459), 93.18%
functions (410/440), and 93.92% lines (1561/1662). Production source is unchanged, and the
implementer reports the separate developer HTTP test passing. Startup boundaries are accepted;
runtime contracts and commit hooks remain open.

### B4d emulator runtime acceptance

Reviewed implementation: `fbd52cc`, a test-only change to
[emulator contracts](../tests/unit/emulator.test.ts). Registered video/save/crash callbacks prove
that an old cartridge cannot change the new cartridge's frames, battery, or error state. The
current callbacks verify exact frame/FPS counts, save identities and bytes, and timer cleanup.
Automatic snapshots occur at 30,000 ms, remain inactive while paused, and preserve unrecorded
playtime after a rejected write. Two timer ticks record two seconds exactly once after recovery.

Initial and subsequent core-load failures verify owned timer cleanup and successful retry. A failed
post-import reboot retains the imported battery bytes in the same storage and virtual filesystem;
the next load consumes those bytes and a subsequent checkpoint preserves them. Idle/foreign commands
reject before mutation. Default isolation and clock behavior use owned globals and fake timers.

Independent validation at the fixed full SHA passes on 2026-09-06: 331 tests across 36 files in
6.02 seconds, plus G1 with 85 Biome files and zero errors/warnings. Full-source coverage is 93.58%
statements (1779/1901), 89.71% branches (1309/1459), 95.00% functions (418/440), and 95.06%
lines (1580/1662). Production source is unchanged from the previously built revision.

An independent after-suite probe confirms real timers and restoration of all owned global
descriptors (0.33 seconds). Four separate mutations remove the stale-video guard, stale-save guard,
paused-timer guard, or move the automatic-snapshot boundary by one millisecond; each makes the
committed tests fail on an assertion (0.30-0.34 seconds). Probe edits restore in `finally`, and the
review checkout is clean. Runtime contracts are accepted. Distribution guard contracts are the
next bounded coverage handoff; all four thresholds and commit-hook activation remain required.

### B4d distribution contract acceptance

Reviewed implementation: `8c24c5c` and `9a3545c` in the
[distribution policy suite](../tests/unit/check-no-roms.test.mjs). The actual default orchestration
scans distinct untracked violations in both `public` and `dist`, plus a tracked violation outside
those directories in an owned temporary Git repository. Exact violation identities and diagnostics
require all three paths. Deep scans cover all four forbidden extensions with mixed case, benign
short/corrupt headers, symlink rejection without traversal, and an unsafe symlink root. Console
spies and temporary directories are restored after each test.

The first commit reached the numerical coverage threshold, but its single staged distribution file
could be found through either scan path. Independently removing the default public scan, dist scan,
or tracked-file scan still passed the test file at `8c24c5c` (0.29-0.34 seconds). After correction,
each same mutation fails on an assertion at `9a3545c` (0.31-0.32 seconds). Probe mutations restore in
`finally`, and the isolated checkout is clean.

Independent validation at the fixed final SHA passes: 333 tests across 36 files in 6.04 seconds,
and G1 with 85 Biome files, zero errors/warnings, strict TypeScript and formatting. Full-source
coverage is 94.00% statements (1787/1901), 90.13% branches (1315/1459), 95.00% functions
(418/440), and 95.48% lines (1587/1662). These are aggregate metrics over the unchanged inventory;
individual files need not each exceed 90%. Production source is unchanged from the previously built
revision. Coverage contracts are accepted; B4d now proceeds to enforced thresholds and actual hooks.

During handoff cleanup, pi incorrectly stopped the existing daily development server. Codex restored
it and verified the Caddy HTTPS runtime endpoint and existing preview listener. The
[retrospective](../Retrospective.md) records the cause and correction. New task handoffs explicitly
restate process ownership, including after a conversation reset for provider errors.

### B4d commit gate acceptance

Reviewed implementation: `49a79ab`. [Husky 9.1.7](../package.json) installs the versioned
[pre-commit](../.husky/pre-commit) and [commit-message](../.husky/commit-msg) hooks.
`quality:commit` runs `quality:l1` and `quality:g1` concurrently with a 28-second deadline.
The runner cancels its captured process groups, waits for TERM-to-KILL escalation, preserves the
initiating failure, and removes its abort/signal listeners. The message policy enforces the six
agreed types, no scope, a nonempty lowercase first line of at most 50 characters, and CRLF input.
All four aggregate coverage thresholds are enforced without changing the executable-source inventory.

Independent validation at the fixed full SHA passes on 2026-09-06: 363 tests across 38 files in
8.40 seconds, G1 with 89 Biome files and zero errors/warnings, and the production build with both
distribution checks. Full-source coverage is 94.10% statements (1916/2036), 90.15% branches
(1401/1554), 95.20% functions (437/459), and 95.59% lines (1715/1794).

An owned temporary clone installs the actual hooks and accepts a commit in 9.09 seconds. Separate
unimported-source coverage, unit, static, and commit-message failures are each rejected without
changing HEAD (8.13, 7.85, 2.51, and 7.11 seconds). A process-tree probe requires zero surviving
descendants after peer failure and after SIGTERM to the real gate CLI; both pass, including a
descendant that ignores TERM. The CLI exits 143 after signal cleanup. Probe resources are removed,
and the independent checkout remains clean. Existing development and preview services are preserved.

B4d is accepted and Tier B is verified. Documentation commits now pass the same installed hooks.
B5 owns production HTTP coverage; B6 must additionally prove cancellation of nested push/L2/build
process trees before enabling pre-push. Final Tier S acceptance still requires B5 through B8.

### B5 production HTTP harness acceptance

Reviewed implementation: `8604276`, followed by additive lifecycle corrections `0bfecb5`,
`91685a6`, `cf2514d`, test refinement `759c65a`, and dependency pin `38cb1f5`.
[production-runtime.mjs](../scripts/production-runtime.mjs) starts the actual production Worker
and built assets in Miniflare/workerd on owned loopback `127.0.0.1:17048`. Production authorization
remains active: temporary RS256 keys sign fixture tokens, and only the expected Access JWKS URL is
served through the outbound test boundary. Miniflare is directly pinned to `5.20260903.0-alpha` in
the manifest and lockfile; the pin changes no other package resolutions or registry URLs.

[run-l2.mjs](../scripts/run-l2.mjs) builds before starting the HTTP suite, reuses the accepted
process runner, and owns a parent temporary root for child runtime state. Allocation, execution,
and cleanup errors fail the gate. A failed constructor/readiness path preserves its initiating
error, concurrent disposal shares settlement, and signal listeners remain until parent cleanup
finishes. Both the runtime and gate remove only resources they allocated.

Independent validation at `38cb1f56db8d9bcae41e421abbaa595f88ef92c0` on 2026-09-06:

- G1 passes with 95 Biome files, zero errors/warnings, strict TypeScript, and formatting.
- L1 passes without a `dist` directory: 386 tests across 40 files in 7.15 seconds. Full-source
  coverage is 94.38% statements (2051/2173), 90.05% branches (1476/1639), 94.97% functions
  (454/478), and 95.79% lines (1847/1928), with all four 90% thresholds enforced.
- `quality:l2` passes the production build/distribution checks and both real HTTP tests;
  the Vitest portion takes 3.44 seconds. These two runtime/authentication cases establish the
  harness; they do not yet satisfy the required four-endpoint L2 inventory.
- A temporary mutation removing signal listeners before deferred directory cleanup fails the
  committed listener assertion. The probe restores the isolated checkout in `finally`.

At `cf2514ddfb03317e82521491850d1d0c6bedd852`, independent real CLI interruption probes also
pass: SIGTERM exits 143 in 1.302 seconds, SIGINT exits 130 in 1.296 seconds, and each captures
seven owned children with zero survivors. Both parent/runtime directories are removed and 17048
is released. Independent allocation, cleanup-only failure, combined failure, delayed-cleanup
signal, and unrelated-directory-preservation probes pass. Later commits change tests and the
dependency declaration only; the reviewed lifecycle implementation is unchanged.

The history rewrite and discarded shared documentation diff are recorded in
[Retrospective.md](../Retrospective.md). Corrections remain additive, and documentation is now
completed only at stopped handoff boundaries. The daily dev/preview services remain outside test
ownership. Next: authoritative route inventory and complete production HTTP API/asset contracts.

### B5 API contract acceptance

Reviewed implementation: `d5ff4f9e9d6f7185e4c7814786f668665a20a2c6`.
The [production route map](../worker/index.ts) dispatches all four API endpoints and supplies the
authoritative route inventory. The [HTTP contract table](../tests/l2/runtime.test.mjs) drives both
the GET/HEAD cases and the completeness assertion, so adding a route without its contract fails.

The suite covers anonymous liveness, authorized catalog/cartridge/runtime responses, rejected
signatures and claims, method precedence, unknown/prototype/ROM paths, shared security and no-store
headers, and actual built HTML/JavaScript/WASM. Anonymous POST to `/api/live` remains 405; private
API requests reject missing authorization before method checks. Development flags cannot bypass
production authorization. Token-helper units verify decoded payloads, numeric custom expiration,
and deliberately omitted claims without silently restoring them.

Independent validation at the fixed full SHA on 2026-09-06:

- G1 passes with 95 Biome files, zero errors/warnings, strict TypeScript, and formatting.
- L1 passes: 388 tests across 40 files in 6.13 seconds. Coverage is 94.45% statements (2063/2184),
  90.04% branches (1484/1648), 95.02% functions (458/482), and 95.82% lines (1858/1939).
  All four 90% thresholds remain enforced over the complete maintained-source inventory.
- `quality:l2` passes the production build/distribution checks and all 40 HTTP cases; the Vitest
  portion takes 504 ms. Tests use real inbound TCP on owned loopback 17048 and real signature
  verification against an ephemeral JWKS, without changing production authentication.
- A separate Miniflare probe constructs its own keys and runtime, makes 42 HTTP requests, checks
  missing issuer/audience and HMAC rejection, compares HTML/JS/WASM byte-for-byte with built assets,
  verifies exact headers, and observes only the expected JWKS request. Its runtime state is removed.
- A temporary production-map mutation adds an uncovered API route. The committed inventory test
  rejects it on the expected assertion. The probe restores the isolated checkout in `finally` and
  verifies a clean tree.

B5 is accepted. Runtime lifecycle code is unchanged from the independently verified cleanup/signal
implementation above. Daily dev/preview services remain outside test ownership. B6 next implements
pinned committed-history security scanning, then the installed L2/G2 pre-push gate. Neither Tier A
nor Tier S is claimed at this checkpoint.

### B6 security scanner acceptance

Reviewed implementation: `48894ea4a1712c755d1bb60a9766a5f67bf15221`, followed by the
additive test-isolation correction `ca704a2e643730be084f910b9c84676118a19910`.
[quality-tools.json](../scripts/quality-tools.json) is the authoritative pin source for OSV Scanner
2.5.1 and Gitleaks 8.30.1. [run-g2.mjs](../scripts/run-g2.mjs) rejects absent tools, nonexact
versions, scanner failures, signals, malformed input, and unreadable stdin. OSV scans the actual
`bun.lock`; Gitleaks redacts findings and applies only the reviewed exact historical prose
fingerprint in [.gitleaksignore](../.gitleaksignore).

`npm run quality:g2` scans full committed ancestry with `-m HEAD` without reading stdin.
`node scripts/run-g2.mjs --pre-push` reads Git's four-field update rows once; `--input <rows>`
provides explicit rows. Existing remote objects use `-m <remote-sha>..<local-sha>`; new branches
and missing remote objects use full local ancestry. Deletions omit only their history scan;
empty/deletion-only input still runs the lockfile scan. Every history range includes merge diffs.

Independent checks on 2026-09-06:

- At the final correction SHA, `quality:commit` passes in 6.66 seconds: G1 checks 97 Biome files
  with zero errors/warnings, strict TypeScript, and formatting; L1 passes 440 tests across 41 files.
  Coverage is 94.47% statements (2309/2444), 90.09% branches (1656/1838), 94.72% functions
  (485/512), and 95.71% lines (2098/2192). All four 90% thresholds remain enforced.
- Actual pinned `quality:g2` passes in 3.21 seconds at that same SHA. At the initial security
  SHA, `quality:l2` passes its production build/distribution checks and 40 real HTTP cases
  (1.97 seconds total; 500 ms for Vitest). The correction changes one unit-test file only.
- Seventeen independent entry/history cases use real scanner binaries and an identical project
  lockfile. They reject added-then-deleted credentials, new-branch and second-ref findings,
  missing-remote histories, and merge-only credentials. Clean direct mode terminates with open
  stdin; deletion/empty modes still scan dependencies; invalid lockfile, malformed/read-failed
  input, missing tools, wrong/suffixed versions, and signal-only tool exits fail. Logs expose
  none of the runtime-generated test values.
- Six real process cases cover timeout with a normally terminating or TERM-ignoring parent,
  external abort, nonzero parent exit with a surviving descendant, and G2 CLI SIGTERM/SIGINT.
  Every captured subtree reaches zero survivors; the CLI preserves exit 143/130. Probe-owned
  process state is removed, and history fixtures remain isolated for the pre-push review.
- Review found one unit sending real signals for a fake PID. An independent outer OS-boundary
  guard fails at `48894ea` and passes at `ca704a2`, requiring every mock to restore its boundary
  and no unowned signals. The correction retains the original child error and exact TERM/KILL
  assertions. Temporary test edits restore in `finally`; the review checkout is clean.

The security handoff is accepted. B6 remains in progress until the installed pre-push hook runs
L2 and G2 together and passes nested build cancellation, stdin propagation, and failure probes.
Tier A and Tier S are not yet claimed. Daily development and preview services remain preserved.

### B6 pre-push review checkpoint

The pre-push implementation at `24ee4a1e804d8882c7588cf09d85ee9572d00701` adds
[run-push.mjs](../scripts/run-push.mjs), `quality:push`, and the installed
[pre-push hook](../.husky/pre-push). It reads and validates Git input once, runs L2 and G2
concurrently, and applies a 180-second deadline with a 3000 ms outer cancellation grace.
The additive test-only handoff `cc58d9731efd33671498f1d5eb0a26afd83b1bfa` requires valid
descendant/build/leaf PID evidence and removes exact captured L2 roots in fallback cleanup.

Independent review reproduces a blocking cleanup defect twice in the default production chain:
`run-push -> npm run quality:l2 -> run-l2 -> npm run build`. On cancellation, npm can forward
a second SIGTERM after the first group signal. L2's `process.once` handler has already been removed,
so the second signal terminates L2 before its deferred root cleanup starts, leaving descendants and
temporary state. A direct-child unit wrapper does not exercise this npm forwarding behavior.

A temporary change retaining L2 listeners with `process.on` passes all three independent real-chain
probes: SIGTERM exits 143, SIGINT exits 130, and peer scanner failure exits 1. Each captures nine child
processes, leaves zero running survivors, and removes its L2 root, with cleanup taking 3.03, 3.03,
and 4.41 seconds respectively. These are design experiments on an isolated checkout, restored in
`finally`; they are not acceptance evidence for the committed implementation. The next atomic
handoff fixes this lifecycle boundary and adds discriminating repeated-signal assertions. B6 remains
open until the final committed code passes the real chain and installed-hook probes.

The additive L2 correction `4195859929582bd7c677fd6cc594fbc2265ca369` is accepted. Its 14 focused
units pass independently, including repeated and mixed signals during deferred real directory
removal and runner settlement. At that fixed committed SHA, the default real-chain probes pass:
SIGTERM exits 143, SIGINT exits 130, and scanner peer failure exits 1; each captures nine descendants,
leaves zero running survivors, and removes its L2 root. Cleanup takes 3.02, 3.07, and 4.39 seconds.

Review also reproduced the equivalent outer-wrapper failure when starting `npm run quality:push`
and signalling its owned foreground group. With only L2 corrected, repeated npm forwarding can
terminate `run-push` before its detached children settle. A temporary experiment retaining both
wrappers' listeners passes SIGTERM and SIGINT, with ten captured descendants, zero survivors, and
the L2 root removed in about three seconds. This additional design experiment is restored afterward.
The next separate atomic correction retains the outer listeners and the initial signal status;
B6 acceptance still requires the final committed outer-entry and installed-hook checks.

The outer push correction `72b0dabd1aa5c6a1508dad3a54e37126587f28cd` retains both listeners through
runner settlement and preserves the first process signal. Independent probes at that committed SHA
pass through the real outer npm foreground group for SIGTERM and SIGINT: ten captured descendants
per case, zero running survivors, correct 143/130 status, and the L2 root removed.

The same audit covers the other two public npm commands. At `4195859`, both `quality:commit` and
standalone `quality:g2` leave captured descendants alive after SIGTERM and SIGINT. The pre-commit
hook also invokes its npm command, so this is a real entry-point defect. In an isolated temporary
experiment, retaining listeners in those two wrappers makes all four scenarios pass with zero
survivors and the original 143/130 status, settling in 1.03 seconds. The experiment changes no scanner
or child-process algorithm and restores the checkout afterward. One final atomic lifecycle correction
was required before the complete B6 installed-hook acceptance below; these observations do not change
the accepted scanner pins, scan scope, or previous coverage evidence.

### B6 final acceptance

Reviewed implementation: `0d3a3be1e8646a399e7c10d82a614b3b3d26473a`. The final additive correction
retains the owned SIGINT/SIGTERM listeners in [run-parallel.mjs](../scripts/run-parallel.mjs) and
[run-g2.mjs](../scripts/run-g2.mjs) until awaited settlement, matching the accepted L2 and push
corrections. Repeated or mixed signals preserve the first signal's exit status and abort reason.
Deferred-runner tests require exact listener restoration after cleanup. Scanner policies, pins,
child-process algorithms, and fake-PID OS-signal isolation remain intact.

Independent checks on 2026-09-06 use the fixed committed implementation in an owned checkout:

- `quality:commit` passes in 7.08 seconds. G1 checks 99 Biome files with zero errors/warnings,
  strict TypeScript, and Prettier. L1 passes 467 tests across 42 files. Coverage is 94.40% statements
  (2377/2518), 90.17% branches (1707/1893), 94.60% functions (491/519), and 95.58% lines
  (2166/2266), with every 90% threshold enforced.
- `quality:push` passes in 2.97 seconds, including the production build/distribution checks,
  all 40 real HTTP contracts, OSV Scanner 2.5.1 on `bun.lock`, and Gitleaks 8.30.1 on `-m HEAD`.
  The installed commit and push gates remain below their 30-second and 180-second limits.
- A temporary repository with actually installed Husky hooks passes ten pre-push entry cases.
  A clean new branch passes in 2.801 seconds, and direct mode with open stdin passes in 2.859
  seconds. Added-then-deleted history, new-branch secrets, a secret on the second updated ref,
  an L2 assertion failure, an invalid lockfile, and malformed Git rows all block acceptance.
  Deletion-only and empty update sets pass while still executing L2 and the lockfile scan.
  Test history is created through the real commit hooks; no remote push is performed.
- Real foreground npm cancellation of `quality:commit` and standalone `quality:g2` passes
  SIGTERM and SIGINT independently at this final SHA. Each commit-gate case captures six
  descendants and each scanner case five; all settle with zero running survivors and status
  143/130 in 1.03-1.05 seconds. The earlier committed push/L2 probes additionally require their
  captured build descendants to exit and their exact L2 roots to disappear.
- The installed-hook probe asserts captured descendants and L2 roots are gone before fallback
  cleanup. Its owned clone is removed after the checks; result summaries and redacted logs are
  retained outside the repository. No daily server or user browser profile is a cleanup target.

B6 is accepted and Tier A is verified. B7 required browser journeys and B8 CI/release wiring still
block Tier S. During service verification, preview port 17047 was found without a listener and was
restored successfully; its stopping cause was not established. The daily Caddy development endpoint
and the restored preview respond with version 1.1.0. Both services remain outside test ownership.

### B7 executable fixture acceptance and recovery finding

Reviewed implementation: `a29eff553d20115daa85d9077b982c8ba65ed84c` and additive correction
`0d60e83d7f2aac61e39dfe34451e3be1fb39837a`. [executable.ts](../tests/fixtures/executable.ts)
generates original 32768-byte GB/GBC/GBA cartridges from reviewable SM83 and ARM source in
[the fixture source directory](../tests/fixtures/source/README.md). The GB/GBC program is 144
bytes and the GBA program is 128 bytes. GBA uses original code `ZPPE` and `SRAM_V110`; GB/GBC use
MBC3+RAM+BATTERY. No ROM binary or cross-compiler dependency is added to the repository.

The correction removes all optional `/tmp` comparisons and empty catches from
[the fixture contracts](../tests/unit/executable-fixtures.test.ts). Full-ROM hashes and header
assertions always execute. Its assembly comments and input-line descriptions are corrected while
every generated byte and all three expected hashes remain unchanged. `createInitialBattery()`
is a deterministic import payload with byte 0 equal to 1 and all remaining bytes zero; it is not
the core's first generated battery, whose remaining bytes are `0xff`.

Independent evidence on 2026-09-06:

- At `0d60e83`, `quality:commit` passes in 7.63 seconds: 472 unit tests across 43 files,
  101 Biome files with zero warnings/errors, strict TypeScript and formatting. Coverage remains
  94.40% statements, 90.17% branches, 94.60% functions and 95.58% lines. The production build
  and distribution checks also pass.
- Independent RGBDS and ARM assembly/linking agrees with the generated program bytes for all
  three platforms. The complete ROM hashes remain those required by the committed unit tests.
- Fresh Chrome contexts execute the real pinned mGBA 2.5.1 WASM. Each platform renders a
  nonempty frame, changes its live frame and battery byte from 1 to 2 after A, and reboots into
  state 2. The entire 32768-byte battery before and after reboot is equal.
- A further production-App probe at `0d60e83`, using owned loopback 27047 and real RS256
  verification, exposes an existing restoration defect: save at 1, advance to 2, confirm restore,
  then press A. GB/GBC display the old frame and expose saved file byte 1, but execute from active
  SRAM 2 and write 3. GBA correctly executes from 1 and writes 2. This is a production failure,
  not a fixture failure or a successful snapshot acceptance.
- A local, uncommitted design trial in the review checkout pauses the core around
  `loadStateSlot(slot, 61)`, the pinned SDK's default mask, and restores the caller's running
  state in `finally`. The actual App then restores live state 1 and processes the next A as 2
  on all three platforms. Files retain byte 2 until an in-game save, as previously observed on
  GBA. The numeric mask excludes forced savedata writeback; this deprecated raw API requires
  an explicit pause wrapper and a version-specific explanation. The production implementation
  and automatic/manual failure regressions remain the next atomic handoff.

The fixed-version source explains the observed GB defect: `_GBCoreSavedataRestore` with
writeback enabled writes the VFile without refreshing mapped SRAM. Its masked branch refreshes
active SRAM and defers file writeback to a game save. Calling both restoration variants does not
provide a synchronous-file guarantee and is not the selected design. Required L3 must check the
live restored frame and the next input, then test independent full-byte battery import/export and
reload. Snapshot thumbnails, toasts, or an immediate `.sav` byte alone are insufficient.

At this checkpoint the fixture handoff was accepted, while snapshot correction, mandatory browser
journeys, isolation/layout coverage, and B8 remained outstanding. All review browser contexts and owned runtimes have closed;
the daily dev7047 and preview17047 remain outside their ownership.

### B7 snapshot correction review checkpoint

Reviewed implementation: `19f0b0f`. The shared restore helper pauses the core around the pinned
`loadStateSlot(slot, 61)` operation. Automatic slot 0 restores running ownership; manual restores
preserve an existing pause until persistence settles. Battery files remain the last flushed
in-game save, while CPU, video and active SRAM immediately reflect the snapshot.

Independent checks on the fixed commit:

- `quality:commit` passes in 6.62 seconds: 474 tests across 43 files, 101 Biome files with zero
  warnings/errors, strict TypeScript and formatting. Coverage is 94.41% statements, 90.18%
  branches, 94.61% functions and 95.59% lines. Production build and distribution checks pass.
- The actual production App, loaded through an owned Worker on loopback 27047 with real RS256
  verification, passes all six manual/automatic recovery cases across GB, GBC and GBA. A snapshot
  at 1 restores its live frame after advancing to 2; the next A produces 2, not 3. Automatic
  recovery also starts from snapshot 1 when the separately stored battery contains 2.
- Two isolated negative experiments expose remaining unit-test gaps: moving resume before
  persistence settles, and persisting after a false restore result, both pass the current
  emulator test suite. Neither defect is present in the reviewed production implementation.

Before accepting this correction, the next atomic test-only handoff must assert deferred
persistence, unchanged storage after false/thrown restores, successful retry, actual core pause
state during raw restore, and final core pause after an automatic thrown failure. The same two
negative experiments must then fail. Browser execution evidence above remains valid; a test-only
refinement does not require repeating those six cases.

### B7 snapshot correction acceptance

Accepted implementation: `19f0b0f` with test-only refinement `94cbe07`. The latter tracks actual
core pause state, holds a manual restore at an entered asynchronous battery write, and verifies
that the core/public state stay paused and the command stays pending until release. False and
thrown manual restores leave battery, filesystem sync and play-time write counts unchanged;
a successful retry persists once. Automatic thrown restoration leaves an initialized core paused
with public error status.

Independent `quality:commit` at `94cbe07` passes with 476 unit tests across 43 files, strict G1
and all thresholds: 94.45% statements (2383/2523), 90.23% branches (1710/1895), 94.61% functions
(492/520), and 95.59% lines (2170/2270). Both negative experiments now fail at the intended
assertion: premature resume observes running instead of paused; failed restoration observes an
unexpected battery write. The review checkout is restored to its clean fixed commit afterward.

The six real-App manual/automatic cases and production build at `19f0b0f` remain applicable:
`94cbe07` changes only tests. Snapshot correction is accepted. Next is the mandatory cartridge,
snapshot and battery browser journey handoff, followed by isolation/layout and B8 CI/release gates.

### B7 required journey acceptance

Accepted implementation: `d563a3563acc8f645c3d55216a866d751f180a1c`. The required suite now uses
the production Worker on owned loopback 27047, native fresh browser contexts and per-test RS256
tokens. It retains the original 11 noncommercial cases and adds 10 core cases: three platform
import/pause/resume/reload journeys, one cross-platform hot-switch journey, three manual/automatic
snapshot journeys and three complete battery roundtrips. The 16 commercial compatibility cases
remain separately discoverable under `tests/optional/`.

Independent review verifies complete cartridge bytes and identity in IndexedDB, per-ROM battery
payloads and complete manual snapshot records across GB/GBC/GBA switching, real restored frames
and the next emulated input, and full 32768-byte export/import/re-export equality. Import removes
slot 0 and preserves manual records. The reload case deliberately checkpoints state 2 before
reloading; it proves live state 2 and the next save at 3. Snapshot restoration retains the documented
deferred file-write boundary. The mobile touch press/release regression remains mandatory.

Independent checks on the fixed commit:

- `quality:commit`: 476 tests in 43 files; 105 Biome files, strict TypeScript and formatting pass
  without warnings. Elapsed time is 7.48 seconds. Coverage remains 94.45% statements (2383/2523),
  90.23% branches (1710/1895), 94.61% functions (492/520), and 95.59% lines (2170/2270).
- Production build and no-ROM distribution checks pass in 1.01 seconds.
- All 21 required browser tests pass in 104.04 seconds, with zero skipped, unexpected or flaky
  results. Every expected status and individual result is `passed`; all original required titles
  are retained. Optional discovery reports 16 cases and is not included in required acceptance.
- The review records the actual native Chrome PID and process group before execution. Both are
  gone afterward, and the owned runtime root is removed. Evidence is retained in the independent
  `pokepocket-b7-journeys-review-d563a35-r2` report directory.

This accepts the journey content, not the still-pending L3 ownership gate. The current optional
configuration retains legacy target/reuse behavior, and required config still exposes an obsolete
target override. The next handoff removes those paths, protects artifacts before Playwright cleanup,
and makes complete, zero-skip execution an enforced gate. Browser authorization proves the
application's real signature verification; it does not demonstrate a hosted Cloudflare SSO login.

### B7 artifact foundation acceptance

Accepted implementation: `cc48e669ffd8edf6f0c26db75d1be047181839d8`.
The five committed files exactly match the independently reviewed byte manifest. The implementation
was made in an independent clone and imported into main by fast-forward without rewriting history.

[browser-artifacts.ts](../scripts/browser-artifacts.ts) runs while both Playwright configurations
load, before the runner can remove output. It allows only `test-results/required` and
`test-results/optional` beneath the canonical project directory. Their durable `.owner` marker
lives in the parent, survives suite cleanup, and must be a regular file with the expected contents.
Existing unowned directories, symlinks (including dangling links), and file/directory conflicts
fail closed. New directories and the marker use exclusive creation. Commands must originate inside
the project tree. Raw output, reporter, extra-reporter, last-run-file flags and the installed
runner's output-related environment overrides are rejected before filesystem writes.

The unit contracts independently list required flags and environment variables rather than deriving
their cases from the implementation's deny list. They cover fresh/owned/unowned paths, marker
contents/types, symlink boundaries, sentinel preservation and repeated cleanup. Filesystem errors
other than `ENOENT` propagate; the uncovered error branch is not disguised by a missing-path test.
[tsconfig.node.json](../tsconfig.node.json) now includes all root `*.config.ts`, including L2 and
optional browser configuration, in strict typechecking.

Independent verification on the committed file bytes:

- `quality:commit` passes in 6.64 seconds: 525 tests in 44 files, 107 linted files, strict TypeScript
  and formatting with zero warnings. Coverage is 94.56% statements (2455/2596), 90.44% branches
  (1760/1946), 94.65% functions (496/524), and 95.68% lines (2240/2341).
- A second disposable clone with an exact five-file overlay passes 42 real CLI checks: unchanged
  required/optional discovery (21/16), 36 rejection and sentinel cases across both actual configs,
  and two normal cleanup cycles for each configuration. Checkout, Git and outside-fixture sentinels
  remain intact; prior suite artifacts are removed only on the normal runs, and the marker survives.
- Those probes use a tiny fixture with no browser or HTTP allocation. Every possible output and
  symlink target is inside the owned disposable parent, including the negative checkout/ancestor
  targets. Evidence is in `pokepocket-b7-artifact-probe-0y24ho00/summary.json` and its logs; the
  independent gate log is `/tmp/pokepocket-b7-artifact-independent-quality.log`.
- The installed pre-commit and commit-message hooks pass on the implementation commit.

This accepts early artifact containment. It does not accept the legacy target overrides, optional
server reuse, concurrent execution, report validation, or process/signal ownership. The next handoff
must finish those boundaries while retaining this guard. An existing unmarked `test-results`
directory is intentionally rejected; the guard does not adopt or erase it automatically.

### B7 authorization and browser ownership acceptance

Reviewed implementation: `f7e37bd408bdb9bd76951deb5d19a370a42dd203`, imported unchanged from a complete independent clone.
`quality:l3` and `test:e2e` use the same required entry. The runner builds production assets and owns
the browser server, captured browser PID/profile, resource root and fixed machine lock for loopback 27047. Both configurations validate the live lock and browser metadata before resolving artifacts;
the optional entry uses a local-ROM Vite configuration without the Cloudflare plugin.

Required runs reject selectors, mode/output/reporter overrides, unexpected targets and concurrent
owners. The JSON policy requires the exact inventory, every expected/result status to pass on the
first attempt, and zero failed, skipped, flaky or interrupted tests. Download files use each test's
owned output paths. Failure screenshots, traces and reports remain after resource cleanup.

Cleanup retains the first timeout/signal result and owned listeners through settlement. Browser
close has a bounded kill fallback. Optional runtime ownership begins before listen; disposal waits
for underlying startup before closing, so a late listen cannot recreate a service after cleanup.
Unconfirmed disposal retains the resource root, metadata and lock. Deferred startup tests exercise
the production runtime factory with a fake Vite server, and await the actual close continuation.

Independent checks:

- G1/L1 pass in 6.47 seconds: 612 unit tests across 46 files, 116 Biome files with zero warnings,
  strict TypeScript and formatting clean. Coverage is statements 94.72% (2964/3129), branches
  90.22% (2224/2465), functions 94.95% (527/555), lines 95.68% (2730/2853), with unchanged scope
  and four enforced 90% thresholds. Evidence: `b7-isolation-final-unit-40j0jy9x/result.json`.
- The required suite passes 23/23 in 116.551 seconds with both local ROM directories absent.
  The final refinement changes only two pure unit tests; production/browser bytes remain identical.
  The later intentional-failure run also passes all 23 unchanged required cases.
- Optional compatibility passes 16/16 in 101.951 seconds using 12 hash-verified copied cartridges
  under the disposable checkout. It covers 13 series cases and three commercial cases.
- All 29 real CLI rejection/concurrency cases pass: guarded aliases, selectors and output/reporter
  options, external/development/preview targets, raw Playwright entry, occupied port, and a lock
  held by a live owner from a second independent checkout with a different temporary directory.
  Owned file sentinels survive; natural process cleanup is checked before any fallback termination.
  The lock-holder helper reports a clean exit and no surviving PID/group.
- A uniquely marked intentional browser failure returns 1, while its own JSON result retains a
  valid trace ZIP and a decoded 1280x720 screenshot. These are copied with hashes before later runs
  clear suite output. Both worker runtime roots, the browser profile and lock are removed.
- A real 15000 ms gate timeout returns 1 with the exact abort reason. Real npm-chain SIGINT and
  SIGTERM return 130 and 143. Each receives another same-kind signal and a mixed signal inside a
  recorded 650 ms resource-cleanup window; the first result survives. Every completed run has
  zero captured child/group survivors and no remaining browser profiles, runtime roots or lock.
- All seven maintained root configs reject an injected wrong-typed value with TS2322 in an
  additional independent committed clone, including `vite.optional.config.ts` and
  `vitest.l2.config.ts`. Evidence: `pokepocket-app-review-b7-config-24g82djw/config-scope.log`.

Browser evidence is under `~/.local/share/pokepocket-review/`: required success in
`b7-isolation-preflight-pb2i35fc/run-positive-1788694563873139000`, and the frozen final review in
`b7-isolation-preflight-v273lbcx`. The latter contains
`negative-1788695204451513000/results.json`, each `run-*/result.json`, timeout/signal proofs, and the
failed test's report, screenshot, trace and hashes. Probe npm and compiler caches are confined to
the owned review case. Preliminary driver-only cache/pipe/TIME_WAIT issues are corrected before
the final rejection matrix; they are not accepted as gate failures or passing cleanup evidence.

Two required authorization cases use a fresh anonymous browser to prove private HTML, emitted client
JavaScript and WASM denial, and a locally signed token to load and execute the original GB fixture.
The authorized run verifies its alternating pixels and next input while Worker egress remains
JWKS-only. These are application authorization checks; hosted Cloudflare SSO is not exercised.

B7 ownership is accepted. Navigation contrast, layout/export coverage, B8 CI/release alignment and
final acceptance remain separate handoffs.

### B7 navigation contrast finding

An independent production-browser probe at `d563a35` measures all 108 navigation combinations:
12 themes, three buttons and default/hover/keyboard-focus states. The enabled default labels
"My saves" and "Play guide" (`我的存档`, `游玩指南`) fail in every theme: 13px/400 text in
`#7e8b80` has approximately 3.419–3.423:1 contrast against the actual composited header. The
required ratio is 4.5:1. All active, hover and focus combinations pass; the active-theme minimum
is 5.095:1. The probe decodes modern CSS colors, composes transparent ancestor backgrounds and
waits for transitions and actual `:focus-visible` state. Its captured browser group and runtime
directory are cleaned.

The gallery launch button separately passes all 36 theme/default/hover/focus combinations.
That probe decodes a screenshot of the actual gradient beneath the text, with only text and icons
temporarily masked, and applies the same 4.5:1 threshold. No launch-button correction is indicated.

This existing product defect, exposed during B7 review, is resolved by the separately accepted
navigation fix below. Broad layout/export acceptance remains the next handoff.

### B7 navigation contrast acceptance

Reviewed implementation: `ac8f37f0a86ce5e2a6589c68e502c861e7f6465c`, imported unchanged from the
independent implementation clone after browser acceptance. The default `.nav-item` text changes
from `#7e8b80` to `#556457`; existing hover, keyboard-focus, selected-theme colors and font sizes
are retained. The required inventory increases from 23 to 24, and the unit validator's complete
positive fixture uses that inventory constant while its negative cases remain unchanged.

[The required regression](../tests/e2e/navigation-contrast.spec.ts) selects all 12 unique editions
and confirms their rendered selection. For each edition it measures three visible, enabled labels
in default, hover and actual `:focus-visible` states. The helper measures the supplied label itself,
decodes modern CSS colors, and composites its real ancestor backgrounds. Unsupported image/gradient
or opacity layers fail explicitly. All 108 complete measurements, including foreground, background
and composition layers, are attached as JSON.

Independent verification:

- G1/L1 pass in 6.47 seconds: 612 tests in 46 files, 118 Biome files, strict TypeScript and formatting
  clean with zero warnings. Coverage remains 94.72% statements, 90.22% branches, 94.95% functions
  and 95.68% lines. Evidence: `b7-navigation-final-unit-iq1uv2fp/result.json`.
- The complete required browser entry passes 24/24 in 128.202 seconds, with no local ROM directories,
  failed or skipped cases. The two corrected default labels measure 6.019-6.027:1; the minimum of
  all 108 combinations is 5.095:1. Every measured label is still 13px and requires 4.5:1.
- An independent calculation from the recorded RGB values reproduces every reported ratio. Using
  the old foreground with those same recorded backgrounds yields 24 failing default combinations
  at 3.419-3.423:1, consistent with the original production-browser finding.
- All 15 captured processes, their owned groups, browser profile, runtime roots and machine lock
  are gone after settlement. The installed hooks also pass on the exact five-file commit.

Browser/report/color evidence is under
`b7-navigation-preflight-s9as6ilf/run-positive-1788696761026063000` in the review directory;
`navigation-review.json` and `navigation-measurements.json` retain the independent checks.
Fullscreen geometry, proportional scaling, mobile/modal usability and complete PNG export coverage
remain pending in the next atomic handoff.

### B7 layout review and frame-readiness prerequisite

The stopped, uncommitted layout/export draft passes independent G1/L1 (612 tests, all four metrics
above 90%). After correcting test measurement timing, viewport clipping and the actual mobile
cancel label, all new layout/contrast/mobile/PNG cases pass in an independent production-browser
run. The full required gate remains rejected: 29/30 pass, and the existing GBA snapshot regression
at `core-journeys.spec.ts:321` reads an empty initial frame after battery byte 1 is available.
Waiting for stored battery bytes is not a guarantee that the next canvas sample contains a frame.

The focused prerequisite above must wait for actual frame readiness before capturing the state-1
baseline; it must not retry the whole test, skip a platform, relax assertions or add fixed sleeps.
It receives its own implementation/review/documentation boundary in an independent clone. The
four-file layout draft is retained unchanged and will resume against the accepted prerequisite.
No product defect or product-code change is inferred from this sampling failure.

The rejected run is retained under
`b7-layout-preflight-64sdg5yw/run-positive-1788699182281387000`: report, trace, failure screenshot
and all successful geometry/color/PNG measurements are available. Its 17 captured processes,
owned groups, browser profile, runtime roots and lock are all gone. This is diagnostic evidence,
not a passing B7 acceptance result.

### B7 initial-frame readiness acceptance

Accepted implementation: `9409642ede305232088d3c8a0052473b2b7210ea`, containing only
[core-journeys.spec.ts](../tests/e2e/core-journeys.spec.ts). The snapshot regression retains its
battery-byte readiness check, then polls the real canvas for an opaque alternating light/dark
GB/GBC frame or a red GBA frame. It keeps the successful sample as the state-1 baseline before
creating the snapshot. The shared animation-frame sampler, cancellation checks, live restoration,
next-input behavior and complete persistence comparisons remain unchanged.

Independent `quality:commit` passes in 7.74 seconds: 612 tests across 46 files, strict checks over
118 Biome files, and zero G1 errors or warnings. Coverage remains 94.72% statements (2964/3129),
90.22% branches (2224/2465), 94.95% functions (527/555), and 95.68% lines (2730/2853).
The frozen one-file draft passes all 24 required production-browser cases in 130.419 seconds,
without local commercial ROM directories, failures, skips or flaky results. All 15 captured
processes, owned groups, browser profile, runtime roots and port lock are gone after completion.

Evidence is retained under `b7-final-final-unit-jvg0o4go/result.json` and
`b7-final-preflight-fzdxgyw_/run-positive-1788699985701424000` in the review directory. The offered
commit matches the reviewed file hash and was imported by fast-forward after normal hooks passed.
The four-file layout/export draft now resumes from this accepted baseline in a fresh independent
clone; its earlier 29/30 result remains a rejected checkpoint, not layout acceptance.

### B7 layout and export acceptance

Accepted implementation: `823bc49af271e25a071f7994a18fef53e499dcb7`. The preserved four-file
draft was restored byte-for-byte into a fresh clone containing the accepted initial-frame fix.
Only [layout.spec.ts](../tests/e2e/layout.spec.ts), [screenshot.spec.ts](../tests/e2e/screenshot.spec.ts),
[contrast.ts](../tests/fixtures/contrast.ts) and the required inventory in
[browser-shared.mjs](../scripts/browser-shared.mjs) changed. The inventory is now 30, retaining
every previously required journey and adding three platform geometry cases, button contrast,
mobile/dialog bounds and GBA export.

Independent `quality:commit` passes in 7.99 seconds: 612 tests across 46 files, 119 Biome files,
strict TypeScript and formatting with zero G1 errors or warnings. Coverage remains 94.72%
statements, 90.22% branches, 94.95% functions and 95.68% lines. The complete production-browser
gate passes 30/30 in 135.663 seconds, with zero failures, skips or flaky results and no local
commercial ROM directories. Root also independently recalculated the attached measurements:

- Native fullscreen and rejected-request fallback both center GB/GBC/GBA within 2 pixels, fit
  the viewport and resize correctly. Initial shell scale factors are approximately 1.55, 1.527
  and 1.753; real text ranges and action-button bounds follow the shell scale within 2%.
- Twelve enabled pause/continue/overlay measurements cover default, hover and actual keyboard
  focus. The minimum pixel-background contrast is 5.2355:1. The disabled A control remains
  visibly legible at 5.9424:1; its requirement rejects invisible text without assigning a WCAG
  minimum to disabled controls. Full text ranges must be inside the viewport before sampling.
- At 390x844, Settings and Restart dialogs fit all four viewport edges and mobile controls fit
  horizontally. The restart cancellation uses the actual dialog label.
- Real downloaded PNGs decode to 1200x1080 for GB/GBC and 1620x1080 for GBA. Every pixel is opaque;
  exported palettes match the native alternating black/white or red fixture frames. Native
  snapshot thumbnail dimensions remain unchanged. These checks establish dimensions, opacity
  and palette preservation, not a complete per-pixel resampling comparison.

Evidence is retained under `b7-layout-final-unit-v3yqttf5/result.json` and
`b7-layout-preflight-hfjzmwo6/run-positive-1788700410012084000` in the review directory. The latter
contains the full report, `layout-measurements.json`, independent `layout-review.json`, and process
capture. All 15 captured processes, owned groups, browser profile, runtime roots and port lock
are gone. The committed bytes match the frozen manifest and were imported by fast-forward after
normal hooks passed. B7 is accepted; B8 CI and release remain separate implementation handoffs.

### B8 CI acceptance

Accepted implementation: `a7a3b42bec46333ef3f68101d86fa1fc723fb92f`. The nine-file handoff was
reviewed in a complete independent clone and imported by fast-forward. The caller
[ci.yml](../.github/workflows/ci.yml) now uses the project-owned
[quality.yml](../.github/workflows/quality.yml), retaining L1/G1/L2/G2/L3, `test:http`, and
`cf:typegen -- --check`. Quality jobs have read-only contents permission, no deployment secrets
or production environment, and preserve coverage and browser failure artifacts.

Each required job checks out the immutable input, reads actual `git rev-parse HEAD`, and rejects
a mismatch. The aggregation job runs with `always()` and publishes `tested-sha` only when every
required result succeeds and every tested SHA matches. Independent review executed the actual
YAML shell steps in 33 cases: all four actual-head checks, all four wrong-target rejections,
successful aggregation, and each gate's failed, cancelled, skipped, missing, wrong-SHA or
missing-SHA result. An unrelated simulated `github.sha` never substituted for the checkout SHA.
The YAML policy suite and actionlint also pass.

[install-scanners.mjs](../scripts/install-scanners.mjs) reads the existing authoritative
[quality-tools.json](../scripts/quality-tools.json), verifies installed binaries by absolute path
and through the new PATH, and persists that directory through `GITHUB_PATH`. The security checkout
requires `fetch-depth: 0`, and the existing G2 command scans full committed ancestry with `-m HEAD`.
In addition to the maintained mock-based tests, six independent probes use real subprocesses and
owned executable download fixtures: new binaries override old PATH entries in this and the next
step; old installed OSV/Gitleaks versions, either download failure and a corrupt archive reject
installation. Failed installs publish no PATH entry and their temporary archives are removed.
These probes verify installation mechanics locally; Linux release binaries were not executed on
macOS. The actual installed macOS OSV 2.5.1 and Gitleaks 8.30.1 pass the real security gate.

Independent `quality:commit` passes in 9.573 seconds: 651 tests across 49 files, 124 Biome files,
strict TypeScript and formatting with zero G1 errors or warnings. Coverage is 94.71% statements,
90.12% branches, 95.04% functions and 95.64% lines. `quality:push` passes in 3.671 seconds,
including the production build, all 40 L2 HTTP contracts, lockfile and committed-history scans.
The separate HTTP regression and generated Worker type check pass. The first type check reported
consistency and exited normally after 142.229 seconds; a diagnostic repeat with optional Wrangler
metrics disabled exited in 15.535 seconds. All captured processes, groups and L2 roots are gone.

Evidence is retained under `pokepocket-app-review-b8-ci-85r5_vv7` in the review directory,
including `acceptance.json`, command results, `ci-yaml-execution-1788701934247` and
`scanner-execution-yZn4eO`. The dependency change pins `js-yaml` 4.3.2 directly and adds only it
and `argparse` 2.0.1 to the lockfile. Frozen installation passes. No remote workflow or deployment
has been run for this acceptance. Immutable release resolution and final sign-off remain next.

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
- 2026-09-06, B7 snapshot preparation, corrected during fixture review: the original probe
  demonstrated restored frames on all platforms and correct post-restore input on GBA. It did
  not establish the latter on GB/GBC. The production-App reproduction above disproves that
  earlier execution-state claim for GB/GBC. The next corrective handoff is authorized to use
  the pinned masked restore with pause ownership, while preserving the documented deferred
  battery-file boundary. All three platforms must prove both restored rendering and subsequent
  input execution; battery roundtrips separately compare every byte and reload imported data.
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
- 2026-09-06, B4c3 review: an isolated mounted-App probe at `b4a01e9` reproduced a return/pause
  race through all three resume controls: the paused canvas, toolbar, and Space key. While the
  original `putBattery` waits behind an owned deferred promise, a resume action restarts the core;
  releasing the real write returns to the library while the hidden game still reports `running`.
  B4c3-O must prevent resume throughout the pending cartridge operation, verify all three entry
  points and failure recovery, and preserve ordinary pause/resume after the operation settles.
  The probe uses injected in-memory boundaries and a temporary Vitest root, without user storage.
- 2026-09-06, B4c3 review: a second isolated App probe at `59680f9` confirms that pending restart
  can be dismissed through either the cancel button or Escape. The original battery write is still
  pending when the dialog disappears, and releasing it executes `quickReload` exactly once. B4c3-M
  must keep an acknowledged restart nondismissible until it settles, retain an actionable error and
  retry path, and preserve cancellation before confirmation. Review the equivalent pending battery
  import boundary with a concrete regression before applying the same treatment.
- 2026-09-06, B4c3 review: the equivalent battery-import probe at `1883663` also fails for both
  Cancel and Escape while the real `replaceBattery` is deferred. After dismissal, releasing the
  write replaces all 131072 supplied bytes and boots the core. B4c3-M includes this confirmed
  mutation boundary alongside restart: block dismissal only after acknowledgement, expose failure
  and retry, and keep normal pre-confirmation cancellation. Both probes settle their owned work.
- 2026-09-06, B4c4 preparation: an isolated mounted-App probe at `624322f` reproduced stale
  gamepad status. Connect a pad and poll, open help to recreate the effect, then disconnect before
  its first new poll: the old connected name remains visible because the effect-local name resets
  while React state retains the previous value. The probe fails on that stale element in 440 ms.
  B4c4 first fixes state synchronization and adds focused reconnect/disconnect coverage in one
  atomic commit, preserving input-source semantics. Broad input and lifecycle coverage follow in
  separate reviewed commits; the probe owns and restores navigator, RAF, and storage boundaries.

- 2026-09-06, B6 review: direct security scans use full committed HEAD ancestry even when the
  checkout is already at its upstream. Every outgoing/full-history range includes `-m`: an owned
  merge-only credential followed by deletion escapes ordinary Git log diffs but is detected with
  merge diffs. Preserve this policy in the pre-push and CI entry points.
- 2026-09-06, G1 scope follow-up, resolved: the initial audit found an explicit older config
  list that omitted `vitest.l2.config.ts`. The accepted artifact foundation uses `*.config.ts`
  in `tsconfig.node.json`; the isolation review at `f7e37bd` independently verifies TS2322
  rejection for all seven maintained configs, including the new optional Vite configuration.
