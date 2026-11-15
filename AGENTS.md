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
| Tests           | Vitest L1, HTTP L2                                  |
| Data            | browser IndexedDB; no D1                            |

```
src/{components,lib,data}  worker/
tests/{unit,http}  scripts/
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
bun run quality:g2          # scripts/run-g2.mjs
bun run deploy:check        # build + wrangler deploy --dry-run
```

## Verification

Quality follows System1 v1.3.0 Native Mode (`nocoo/base-ci v2026.15`) in `.github/workflows/quality-slots.yml` and `.github/workflows/ci.yml`. Status: `enforced` | `planned` | `manual` | `N/A`.

| Slot              | Status   | Evidence                                                               |
| ----------------- | -------- | ---------------------------------------------------------------------- |
| `S1` Types        | enforced | `npm run cf:typegen -- --check && npm run typecheck` (pre-commit + CI) |
| `S2` Lint         | enforced | `npm run lint && npm run format:check` (pre-commit + CI)               |
| `S3` Workflow     | enforced | SHA-pinned workflow action check in CI                                 |
| `G1` Secrets      | enforced | `gitleaks` (`.gitleaks.toml`) in CI + pre-push                         |
| `G2` Dependencies | enforced | `osv-scanner` (`bun.lock`) in CI + pre-push                            |
| `B1` Build        | enforced | `npm run build` in CI                                                  |
| `L1` Unit         | enforced | `npm run quality:l1` (Vitest thresholds 90%) + `npm run test:l1-gate`  |
| `L2` Runtime      | N/A      | Worker HTTP covered by `L3` Vitest integration suite                   |
| `L3` Integration  | enforced | `npm run test:http && npm run quality:l2` in CI + pre-push             |
| `L4` E2E          | N/A      | Playwright browser E2E removed                                         |
| `P1` Package      | N/A      | Private repo, not published to npm                                     |
| `Z1` Gate         | enforced | `quality / Z1: Gate` required status check on `main`                   |

| Hook       | Verifies                                                                           | Budget                    | Runs                                                                     |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| pre-commit | Husky → `git checkout-index` snapshot → `npm run quality:commit` (L1 ‖ G1, 28s)    | target <30s               | unified L1 lanes at **90%**; `npm run test:l1-gate` for isolation probes |
| pre-push   | `run-push.mjs --pre-push` reads stdin refs for G2; L2 is working-tree `quality:l2` | target <3min (unmeasured) | L2 ‖ G2                                                                  |

Check-only; `--no-verify` forbidden.

## Resources / Isolation

| Purpose | Port / resource  | Isolation                               |
| ------- | ---------------- | --------------------------------------- |
| Dev     | 7047 `127.0.0.1` | daily play; do not recycle as L2        |
| Preview | 17047            | Access on; not L2                       |
| L2      | 17048            | per-run tmp resource root; local Worker |

Use local Wrangler/Miniflare for HTTP gates; never deploy remote `-test`.

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

- Do not rewrite handed-off commits. Git fixtures must clear inherited `GIT_*`.
- Leave unassigned paths untouched.
