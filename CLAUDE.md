# Poké Pocket

Browser GB/GBC/GBA cartridge tray and mGBA WASM player; Worker only authenticates and serves assets.
Profile: ts-worker-web
Direction: [docs/01-6dq-adoption-plan.md](docs/01-6dq-adoption-plan.md). Frameworks must not rewrite this file.

## Sources of Truth

This file is the **contract**. Hooks, CI, and config are **enforcement**. If they disagree, that is a failure — raise enforcement to match this file; never lower the contract to a weaker hook.

| Fact           | Where                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| Agent handbook | this file                                                                  |
| Human docs     | README.md, `docs/NN-*.md`                                                  |
| Version        | `package.json` `"version"` as `1.2.3`, display `v1.2.3`                    |
| Enforcement    | `.husky/*`, `scripts/run-*.mjs`, `vitest.config.ts` (90% today), CI        |
| Machine rules  | global `AGENTS.md`, `rules/git-commit.md`                                  |
| Accidents      | [Retrospective.md](Retrospective.md)                                       |
| Env files      | none for ROMs; Access audience is in `wrangler.jsonc` (not a secret token) |

## Project Invariants

- Never commit or ship ROMs, saves, or snapshots. `bun run build` / `check:distribution` must fail if they appear in `public` or `dist`.
- Production Worker does not serve ROM routes, emulation, or save DBs. `GET /api/live` is the only public API.
- Access issuer/team is hardcoded `nocoo`; env vars alone cannot move the team. `workers.dev` and preview URLs stay off.
- ROM bytes, battery, and snapshots stay in IndexedDB (SHA-256 keyed). They never upload.
- Dev :7047 is daily play (COOP/COEP). Preview :17047 keeps Access. Do not kill unowned Vite/workerd. Git tests must strip `GIT_*`.

## Stack / Layout

| Component       | Choice                                              |
| --------------- | --------------------------------------------------- |
| Language        | TypeScript strict (`tsc -b`)                        |
| Package manager | Bun 1.4.0 recommended; npm scripts                  |
| Runtime         | Vite + React; Cloudflare Worker (`worker/index.ts`) |
| Lint            | Biome `--error-on-warnings` + Prettier `--check`    |
| Tests           | Vitest L1, HTTP L2, Playwright L3                   |
| Data            | browser IndexedDB; no D1                            |

```
src/{components,lib,data}  worker/
tests/{unit,e2e}  scripts/
```

MVVM: viewmodels have no View/DOM imports; routes stay thin.

## Commands

```bash
bun install --frozen-lockfile
bun run dev                 # 127.0.0.1:7047
bun run typecheck           # tsc -b
bun run lint                # biome lint --error-on-warnings
bun run format:check
bun run quality:g1          # lint + typecheck + format:check
bun run build               # emulator setup, ROM scan, typecheck, vite, ROM scan dist
bun run test:coverage       # vitest unit --coverage
bun run quality:l1          # same
bun run test:http           # vitest.http.config.ts
bun run quality:l2          # scripts/run-l2.mjs (tmp root, port 17048)
bun run test:e2e            # scripts/run-l3.mjs (port 27047)
bun run quality:g2          # scripts/run-g2.mjs
bun run deploy:check        # build + wrangler deploy --dry-run
```

## Verification

Status: `enforced` | `planned` | `manual` | `N/A`.
6DQ = L1/L2/L3 + G1/G2 + D1. Required L1 bar is four metrics each ≥ 95%. Current vitest thresholds are **90%** — do not label that as 95% enforced.

| Change         | Proof                                                         | Status   | Evidence                                                                                                                  |
| -------------- | ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Logic          | L1 Vitest ≥ 95% four metrics; no `.skip`/`.only`              | planned  | `vitest.config.ts` 90; `quality:commit` / CI `quality:l1` enforce 90 only                                                 |
| API / schema   | L2 real HTTP (`test:http` + `quality:l2`) 100% Worker surface | enforced | CI `l2: true`; pre-push `run-push.mjs`                                                                                    |
| UI path        | L3 Playwright required journeys                               | enforced | CI `quality:l3`; optional ROM pack is extra                                                                               |
| Types / lint   | G1 0 error, 0 warning                                         | enforced | `quality:g1` in CI typecheck-command; pre-commit `quality:commit`                                                         |
| Deps / secrets | G2 osv-scanner + gitleaks; missing binary fails               | enforced | `quality:g2` CI `security-command` + pre-push                                                                             |
| Test isolation | D1 tmp dirs, guarded Playwright, no daily :7047               | enforced | `run-l2.mjs` mkdtemp `pokepocket-l2-gate-`; L3 guards in `playwright.config.ts`. No `_test_marker` SQLite (no D1 product) |
| Bundler output | `bun run build`                                               | enforced | pre-push/CI via L2/build path                                                                                             |
| Docs           | numbered docs if behavior changed                             | manual   | human review                                                                                                              |
| Release        | version + Access live-check                                   | enforced | `release.yml` `verify:access` / `verify:release`                                                                          |

| Hook       | Verifies                                   | Budget      | Runs           |
| ---------- | ------------------------------------------ | ----------- | -------------- |
| pre-commit | `npm run quality:commit` (index via husky) | <30s target | G1 + L1 at 90% |
| pre-push   | stdin refs via `run-push.mjs --pre-push`   | <3min       | L2 ‖ G2        |

Hooks check-only. `--no-verify` forbidden.

## Resources / Isolation

| Purpose | Port / resource  | Isolation                                   |
| ------- | ---------------- | ------------------------------------------- |
| Dev     | 7047 `127.0.0.1` | daily play; do not recycle as L2/L3         |
| Preview | 17047            | Access on; not L2                           |
| L2      | 17048            | per-run tmp resource root; local Worker     |
| L3      | 27047            | guarded output dir; original test ROMs only |

E2E never touches prod data stores. Use local Wrangler/Miniflare; never deploy remote `-test`.

## Operations / Release

- Entry: `bun run deploy` / tag `v*.*.*`
- Auth: Cloudflare Access + API token (owner)
- Before ship: `verify:access`; no ROMs in dist
- Runbook: README hosting section + `release.yml`

## Retrospective

| Kind                                  | Where                                |
| ------------------------------------- | ------------------------------------ |
| Accident narrative                    | [Retrospective.md](Retrospective.md) |
| Project-specific rule that will recur | one line here (cap ~10)              |
| Cross-project lesson                  | nmem / global `AGENTS.md` / `rules/` |
| Deterministically checkable rule      | hook or test, not prose              |

- Playwright must not use `--output .` on the shared checkout; kill only PIDs this task spawned.
- Do not rewrite handed-off commits. Git fixtures must clear inherited `GIT_*`.
- Leave unassigned paths untouched.
