# 6DQ adoption plan

Status: accepted baseline assessment. Implementation is tracked in the
[Tier S execution document](02-6dq-tier-s-execution.md).

Audit date: 2026-09-06. Baseline: v1.1.0, commit
[`8a43e3c`](https://github.com/nocoo/pokepocket/commit/8a43e3cc6b4035d26808e739d21883dc329b2642).
This document records the assessment and implementation acceptance criteria. It does not certify the
current project as compliant.

## 1. Governing requirements

The audit uses these nmem records:

| Record                                                          | ID                                     | Role                                     |
| --------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Development process: six-dimensional quality system, 2026-03-21 | `af0daa0f-0a10-4b0b-b328-f2dc32137bdc` | Primary requirements and tier rules      |
| Personal project development process, April 2026 update         | `crystal_0c9c31f7de97`                 | Architecture and workflow guidance       |
| Six-dimensional testing, gates, and isolation architecture      | `crystal_97f008d0a273`                 | Applicability and N/A interpretation     |
| Cloudflare resource isolation                                   | `20eebbc1-759f-45b9-be7f-666ccc03d2e0` | Requirements when remote storage exists  |
| Numbered documentation                                          | `400e2be9-d4a2-4dae-83bb-01ce038567be` | Documentation and atomic change planning |

6DQ consists of L1 unit/component tests, L2 integration/API tests, L3 system/E2E tests, G1 static
analysis, G2 security/performance gates, and D1 test isolation. D1 names a quality dimension; it does
not require a Cloudflare D1 database.

Tier B requires L1 and G1. Tier A adds L2 and D1, plus at least one of L3/G2. Tier S requires every
applicable dimension. An applicable N/A counts as satisfied. Failure of either foundational dimension
(L1/G1) results in Tier C.

## 2. Baseline assessment

**Baseline tier: C.** G1 lacks strict lint. L1 has passing tests but no measured coverage or enforced
90% threshold. Existing CI success does not establish 6DQ compliance.

| Dimension | nmem requirement                                                                | Current evidence                                                                                       | Gap                                                                                                               |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| L1        | Logic coverage >=90%; pre-commit, under 30 seconds                              | 74 passing tests across eight files; Node-based Vitest                                                 | No coverage provider, denominator, report, threshold, or hook; major state and persistence logic lacks unit tests |
| L2        | Real HTTP; 100% of API endpoints; pre-push, under 3 minutes                     | Development ROM plugin tests already open a real TCP server; Worker tests call `worker.fetch` directly | No HTTP suite for the production Worker; CI L2 disabled                                                           |
| L3        | Core user journeys through a real browser; CI/manual                            | Playwright with isolated browser contexts; audited CI: 11 passed, 16 skipped                           | Several core flows depend on local ROMs; current browser server uses development authentication behavior          |
| G1        | Strict TypeScript and strict ESLint/Biome; zero errors and warnings; pre-commit | TypeScript strict mode and Prettier                                                                    | Formatting is configured as the CI lint command; no semantic linter or hook                                       |
| G2        | OSV dependency scanning and Gitleaks secret scanning; pre-push                  | Both scans run and block failures in the pinned shared CI workflow                                     | No equivalent local pre-push gate; performance baselines are optional                                             |
| D1        | Separate test storage instances and guards where storage applies                | No remote database, R2, KV, or Durable Objects; browser data lives in isolated Playwright contexts     | Cloud resource rules are N/A; strengthen local server ownership and test-target checks                            |

Evidence:

- [Project scripts](../package.json), [Vitest configuration](../vitest.config.ts),
  [TypeScript configuration](../tsconfig.app.json), and [CI caller](../.github/workflows/ci.yml).
- The caller pins [base-ci at `b482fdee`](https://github.com/nocoo/base-ci/blob/b482fdee98ce1196c809ae158f116caabfc2475b/.github/workflows/bun-quality.yml).
  That revision runs OSV 2.3.5 against `bun.lock` and Gitleaks 8.30.1 against the checked-out tree.
  Neither scan is merely a named placeholder. Coverage upload and L2 are disabled in this project.
- [Audited successful CI run](https://github.com/nocoo/pokepocket/actions/runs/33954676380) and its
  [browser job](https://github.com/nocoo/pokepocket/actions/runs/33954676380/job/101275706625): 27 tests
  discovered, 11 passed, 16 skipped. The optional ROM compatibility skips are not themselves failures;
  required product journeys need independent, always-runnable coverage.
- [Worker unit tests](../tests/unit/worker.test.ts) exercise the handler directly.
  [Local ROM tests](../tests/unit/local-roms.test.ts) use HTTP but exercise the development plugin,
  which overrides production catalog/cartridge behavior.
- `core.hooksPath` is not configured; active `pre-commit` and `pre-push` hooks are absent.

### L1 scope and architecture

[App.tsx](../src/App.tsx) contains 1,389 lines, including loading, cartridge switching, modal pause
ownership, snapshot confirmation, persistence, and error handling. It cannot currently be excluded
as a thin UI shell. [emulator.ts](../src/lib/emulator.ts) contains 390 lines of core lifecycle and save
coordination; [storage.ts](../src/lib/storage.ts) contains 143 lines of IndexedDB behavior. Neither has
a dedicated unit suite.

The existing emulator `subscribe`/`getSnapshot` interface is a useful separation point. Extract a
small controller and explicit core/storage/clock dependencies incrementally. A new application-wide
MVVM framework is unnecessary. Keep the existing storage schema and user-visible behavior throughout
this work.

### L2 and authentication boundary

[The Worker](../worker/index.ts) exposes four APIs: `/api/live`, `/api/catalog`, `/api/cartridge`, and
`/api/runtime`. The first is public; the others validate a Cloudflare Access JWT. All support GET/HEAD.
[Vite development mode](../vite.config.ts) compiles an authentication bypass and installs
[local ROM routes](../scripts/local-roms.ts), so testing that server alone cannot verify production
authorization or API behavior.

Use the production build inside local workerd/Miniflare, with real inbound HTTP requests. Miniflare's
installed `outboundService` API can supply a runner-owned JWKS response while the Worker still verifies
real RSA signatures. This is an implementation candidate verified against the installed API surface,
not an already-proven harness. The first implementation checkpoint must demonstrate an authenticated
`/api/runtime` request over TCP. Do not add a production auth bypass to make tests pass.

### L3 fixtures and isolation

[Current fixtures](../tests/fixtures/headers.ts) include original executable GB/GBC programs. The GBA
fixture contains a header and save-type signature, but no executable rendering program. Add a small
original GBA program for required GBA journeys. Commercial/local ROM availability must not determine
whether a core CI test runs.

[Playwright](../playwright.config.ts) already creates independent contexts. Improve its arbitrary
`TEST_BASE_URL` override and local server reuse policy; do not imply that its current IndexedDB shares
the user's normal browser profile. [Wrangler configuration](../wrangler.jsonc) binds static assets and
Access configuration only. Empty cloud test databases, buckets, and marker tables would add no value.

## 3. Implementation stages

All new filenames and commands below are proposed. Each stage should preserve passing existing
tests and produce reviewable commits with the new behavior and its tests together.

### Stage 1: establish strict analysis and a truthful coverage baseline

Change `package.json`, `vitest.config.ts`, and `.github/workflows/ci.yml`; add `biome.json` and a
coverage-scope record in this document.

- Add a Vitest-compatible `@vitest/coverage-v8` and collect coverage for unimported as well as imported
  first-party executable files. Include logic in `src/`, `worker/`, and maintained `scripts/`.
- Exclude generated declarations, dependencies, vendor/WASM output, fixtures, and build artifacts.
  List individually justified bootstrap or thin-view exclusions. Logic-bearing components and hooks
  remain in scope until their behavior is extracted and tested.
- nmem specifies >=90% without selecting coverage metrics. The proposed project convention is
  **>=90% for statements, lines, functions, and branches**, aggregated over the declared scope. This
  four-metric convention is an explicit project choice, not a quotation from nmem.
- Configure Biome's recommended strict lint rules for JavaScript/TypeScript, including `.mjs`
  scripts and React hook correctness, with warnings treated as failures. Keep TypeScript strict and
  Prettier as separate checks. The original ESLint choice was revised during B1 because
  `typescript-eslint@8.69.0` explicitly rejects TypeScript 7.0; see the execution record. Do not use
  broad rule suppressions.
- Record actual uncovered modules before estimating the remaining L1 work more precisely. Baseline
  reporting is diagnostic; it does not count as a passing L1 gate.

Acceptance: a reproducible coverage report with a reviewed denominator, and strict lint/typecheck/
format checks passing with zero warnings. No tier upgrade yet unless L1 also meets its threshold.

### Stage 2: make state and persistence testable, then enforce L1/G1

Refactor `src/App.tsx` and `src/lib/emulator.ts` in small steps. Proposed seams are
`src/lib/pocket-controller.ts`, `src/hooks/use-pocket.ts`, and an emulator adapter exposing only the
core operations used by the application. Keep browser/WASM plumbing at the edge.

Add focused suites under `tests/unit/` for:

- Modal pause/resume ownership; confirm, cancel, and retry behavior; busy/error recovery; no mutation
  when a snapshot action is cancelled.
- Cartridge transitions and save queue ordering: pending persistence finishes before replacement,
  and concurrent autosave/manual actions cannot write to the wrong ROM.
- Snapshot create/replace/load/delete, ROM/core compatibility checks, and storage/core failures.
- Battery import/export and `replaceBattery` atomicity: replace the battery and remove the automatic
  snapshot together while retaining manual slots. Verify rollback on transaction failure.
- Initialization, restore, migration/open errors, and isolation by ROM hash. Use an isolated
  `fake-indexeddb` instance for storage units; retain real browser persistence tests in L3.
- Input, settings, screenshot error handling, and maintained script policies that remain uncovered.
  Test script decisions without downloading ROMs or invoking full compiler toolchains.

Move the HTTP portions of `tests/unit/local-roms.test.ts` into a separate integration suite, retaining
fast discovery/parser units in L1. Add minimal hook/component tests where behavior remains in React.

Install versioned Husky hooks and shared gate scripts once the full declared coverage scope reaches
the threshold. `pre-commit` must run L1 and G1 in parallel and propagate either failure.

Acceptance: the reviewed coverage thresholds pass, G1 has zero errors/warnings, and the combined
pre-commit path completes in under 30 seconds on the development machine. **Milestone: Tier B.**

### Stage 3: add production HTTP tests and the pre-push gate

Add `scripts/run-api-tests.ts`, `tests/integration/worker-http.test.ts`, a reusable test JWT fixture,
and an explicit Miniflare development dependency. Read the production build/configuration, preserve
its authentication and asset routing, and use local test-owned runtime state.

The runner must start the server, wait for readiness, issue network `fetch` calls, and always dispose
of its own resources on success, failure, or interruption. Direct handler calls and `SELF.fetch`
must not substitute for the required network path. Serve the built assets through the local runtime
so the suite also catches asset-binding and isolation-header regressions.

| API surface           | Required HTTP evidence                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/live`           | Public GET/HEAD, exact package version, metadata-only body, unsupported method rejected                                                              |
| `/api/catalog`        | Valid identity returns private mode and no hosted ROMs; GET/HEAD and rejection paths                                                                 |
| `/api/cartridge`      | Valid identity returns no hosted cartridge; GET/HEAD and rejection paths                                                                             |
| `/api/runtime`        | Valid identity returns production runtime/version metadata; GET/HEAD and rejection paths                                                             |
| Shared protection     | Missing, expired, wrong-issuer, wrong-audience, and invalid-signature tokens; unauthorized requests rejected before assets are read                  |
| Routing and responses | Authenticated unknown API/ROM paths return 404; method/auth precedence; static page/image/WASM access; COOP/COEP/CORP, no-store, HEAD body semantics |

Maintain an endpoint inventory and require 4/4 coverage. Test endpoint-specific contracts plus shared
authorization cases without multiplying every assertion into a redundant Cartesian product. Use an
ephemeral signing key, accept only the expected JWKS outbound URL, and reject unexpected egress.

Use loopback port 17047 for L2, following dev+10000. It is also the existing preview port: reject an
occupied port instead of killing or reusing someone else's process. Keep dev/Caddy on 7047 and L3 on 27047. Give runtime persistence and test files dedicated temporary directories and explicit cleanup.

Provide `quality:g2` with version-pinned OSV and Gitleaks matching the audited CI baseline. Scan
`bun.lock` and outgoing committed changes; use a conservative scan for a newly pushed branch. A
staged-only scan during pre-push is insufficient because those changes have already been committed.
Missing scanners must produce actionable failures, not successful skips. Install tools before the
gate rather than downloading them on each push.

Enable L2 in `.github/workflows/ci.yml`. Add `pre-push` running L2 and G2 in parallel, with both outcomes
required. Keep pure development-plugin HTTP tests as a separate integration group.

Acceptance: all four production APIs pass real HTTP tests with authentication enabled; a failing API
or scanner blocks push/CI; the combined gate runs in under 3 minutes including required preparation.
**Milestone: Tier A**, with G2 satisfied and cloud D1 rules N/A.

### Stage 4: make core browser journeys mandatory

Update `playwright.config.ts`, `tests/e2e/`, and `tests/fixtures/headers.ts` or dedicated fixture files.
Split required fixture-based journeys from optional local-ROM compatibility runs. CI must run the
required suite without conditional skips or fallback to an unrelated existing server.

Required acceptance matrix:

- Import, start, pause/resume, return to collection, and reload from real browser storage on GB/GBC/GBA.
- Switch between platforms and verify that cartridges and saves remain independent.
- Create, load with confirmation, replace, and clear manual slots; cancel and recover from failure.
- Export/import `.sav`, restore the intended battery state, discard stale automatic snapshots, and
  preserve manual slots. Fixtures must make meaningful state assertions possible.
- Export a 1080-pixel-high PNG with the correct aspect ratio for each platform.
- Verify fullscreen centering, proportional text/button scaling, modal usability, mobile layout,
  and readable button text in normal, hover, focus, and disabled states. Prefer measurable layout
  and contrast assertions; keep screenshots/traces for diagnosing failures.
- Add a browser project against the production harness to verify anonymous denial and an authorized
  application load. Reuse isolated JWT fixtures; do not call that a test of Cloudflare's real SSO.

Limit functional test targets to explicitly owned loopback services and use fresh browser contexts
and temporary runtime directories. Reject the daily development and production origins. Keep
production read-only deployment smoke checks separate from functional E2E.

Cloudflare's hosted login is outside the local harness. Keep the existing Access redirect checks and
record a manual login acceptance result where appropriate. Fully automated real SSO would require a
separate test Access application and test identity; that infrastructure is a distinct extension.
An S-tier assessment must state this boundary rather than treating a test JWT as proof of real login.

Acceptance: all required journeys execute and pass in CI without local commercial ROMs. The optional
12-ROM suite remains available locally. **Milestone: Tier S**, once login acceptance is recorded and
the previous gates and applicable isolation checks also pass.

### Stage 5: align CI and every release entry point

Use the same project-owned commands for local gates and CI; upload coverage and browser failure
artifacts. Proposed entry points:

| Entry point          | Work                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `quality:l1`         | Unit/component tests and enforced coverage                           |
| `quality:g1`         | Strict lint, strict typecheck, and formatting                        |
| `quality:l2`         | Production HTTP suite and development-plugin integration regressions |
| `quality:g2`         | Dependency and secret scans                                          |
| `quality:l3`         | Required isolated Playwright journeys                                |
| `quality:pre-commit` | L1 and G1 in parallel; either failure blocks                         |
| `quality:pre-push`   | L2 and G2 in parallel; either failure blocks                         |

At the audited revision, [release.yml](../.github/workflows/release.yml) deploys the successful CI SHA
for `workflow_run`. Tag/manual triggers independently run build and unit tests. As an additional
delivery improvement, require complete successful quality checks for the resolved, immutable target
SHA on all release paths, running missing checks when necessary. A successful run for another SHA is
not sufficient. Retain Access checks, package/tag version checks, serialized deployments, and the
post-deploy `/api/live` version assertion.

Acceptance: verify main-CI, tag, and manual trigger paths; a failed or missing required quality result
cannot reach deployment. Document actual hook timings and final coverage/endpoint/journey results.
Do not rerun the already-completed v1.1.0 release merely to implement this plan.

## 4. Atomic commit sequence

Suggested commit boundaries; split further when a change becomes difficult to review:

1. `test(l1): define coverage scope` — provider, denominator, baseline report configuration.
2. `chore(quality): add strict static checks` — strict lint, corrections, shared G1 entry point.
3. `refactor(state): extract pocket controller` — state seams and behavior tests together.
4. `test(emulator): cover save lifecycle` — minimal adapter seams, queue, persistence, and failure tests.
5. `test(l1): enforce coverage gates` — remaining logic tests, thresholds, and L1/G1 hooks.
6. `test(l2): exercise worker over http` — production harness, API matrix, target guards, and CI L2.
7. `chore(quality): enforce pre-push checks` — scanner entry points and L2/G2 hooks.
8. `test(e2e): cover core flows with fixtures` — runnable GBA fixture, mandatory browser matrix, auth boundary.
9. `chore: require full quality before release` — artifacts and consistent deployment gating.

Do not claim a dimension complete based on added configuration alone. At each milestone attach the
actual results, measure the hook runtime, and verify one representative failure blocks the relevant
gate. Preserve original test fixtures, ROM distribution guards, and isolation of the user's browser
saves throughout the refactoring.

If cloud saves are introduced later, reopen D1 applicability before tests use them: allocate separate
`-test` resources, validate build bindings and runtime identities, and require a database marker before
destructive reset operations. A flag or test namespace inside production storage is insufficient.
