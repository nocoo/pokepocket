# Poké Pocket

Browser GB/GBC/GBA cartridge tray and mGBA WASM player (React + Vite, TypeScript strict); Cloudflare Worker (`worker/index.ts`) only authenticates via Cloudflare Access and serves assets.
Docs: [README.md](README.md) · [Docs Index](docs/README.md) · [Native FS](docs/05-native-filesystem.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with Node `>=26.12.1` and Bun `1.4.0` (matching CI). No `.env` is used for ROMs; non-secret Access vars (`ACCESS_TEAM`, `ACCESS_AUD`) live in `wrangler.jsonc`.

```sh
bun install --frozen-lockfile
bun run dev                   # 127.0.0.1:7047 (COOP/COEP, pokepocket.dev.hexly.ai)
bun run preview               # 127.0.0.1:17047 (Access enabled)
bun run cf:typegen -- --check # S1: verify worker-configuration.d.ts matches wrangler
bun run typecheck             # S1: tsc -b
bun run lint                  # S2: biome check --error-on-warnings .
bun run format:check          # S2: biome format .
bun run quality:g1            # lint + typecheck
bun run test:coverage         # L1: vitest unit --coverage (alias: quality:l1)
bun run test:l1-gate          # L1 pre-commit snapshot isolation probes
bun run test:http             # L3: local cartridge HTTP suite
bun run quality:l2            # L3: build + Miniflare Worker HTTP suite (:17048)
bun run test:e2e              # L4: Playwright Chromium smoke against built Worker + assets
bun run quality:g2            # G1/G2: osv-scanner + gitleaks
bun run build                 # mGBA setup, ROM scan public, typecheck, vite, ROM scan dist
bun run check:distribution    # verify no ROMs or saves in public/ or dist/
bun run deploy:check          # build + wrangler deploy --dry-run
```

Layout: `src/{components,lib,data}`, `worker/`, `tests/{unit,http,l2,l1-gate,e2e}`, `scripts/`.

## Invariants

- Never commit or ship ROMs, saves, or snapshots; `bun run build` and `bun run check:distribution` must fail if any appear in `public/` or `dist/`.
- Production Worker serves no ROM routes, emulation, or save DBs (`GET /api/live` is the only public API); `workers.dev` and `preview_urls` stay `false`.
- Cloudflare Access issuer/team is hardcoded `nocoo` (env vars cannot move it); ROM bytes, battery saves, and snapshots stay in browser IndexedDB (SHA-256 keyed, no D1) and never upload.
- MVVM: viewmodels import no View/DOM modules and Worker routes stay thin; mGBA `fd_sync` stays synchronous on MEMFS ([Native FS](docs/05-native-filesystem.md)).
- `package.json` `"version"` (`X.Y.Z`, displayed `vX.Y.Z`) is authoritative; regenerate `worker-configuration.d.ts` (`bun run cf:typegen`) after every `wrangler` upgrade.
- Never kill unowned Vite/workerd processes; Git test fixtures must strip inherited `GIT_*` env vars; use local Miniflare for HTTP gates and never deploy remote `-test`.
- Do not amend or rewrite handed-off commits, and leave unassigned paths untouched.
- Production release (`bun run deploy` or `main` push / `workflow_dispatch` `deploy=true` via `.github/workflows/pipeline.yml`, owner Access/API token, `verify:release`, see [README.md](README.md)) requires authorization.

## Quality & Local Gates

Follows `system1-quality`; CI slots and pinned `base-ci` live in `.github/workflows/quality-slots.yml` (called alongside `D1`–`D5` Worker deploy reusing `B1` `dist-${{ github.sha }}` by `.github/workflows/pipeline.yml`; `quality / Z1: Gate` required on `main`). Raise enforcement to match this contract; status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime` (`N/A`, covered by `L3`); `L4 E2E` (`enforced`, 2 Playwright Chromium smoke tests reusing `B1` `dist` via isolated Miniflare + ephemeral Access JWT); `P1 Package` (`enforced`, `check:distribution` + `wrangler deploy --dry-run` reusing `B1` `dist`); `L1 Unit` enforces 80% thresholds on `src/lib/**` and `worker/**` (`vitest.config.ts` excludes View `.tsx` and `scripts/**`, with `allowOnly: false` / `passWithNoTests: false`).
- **Local hooks**: installed via `bun run prepare` (`.husky/`); check-only, `--no-verify` forbidden.
- **Commit gates**: `pre-commit` snapshots staged index (`git checkout-index`, matching worktree lockfiles) and runs `bun run quality:commit` (`quality:l1` || `quality:g1`, 28s).
- **Commit message**: `commit-msg` (`scripts/check-commit-message.mjs`) enforces all-lowercase `<type>: <desc>` headers (no scope, max 50 chars).
- **Push gate**: `pre-push` (`scripts/run-push.mjs --pre-push`) reads stdin refs and runs working-tree `quality:l2` || `scripts/run-g2.mjs` (`osv-scanner` + `gitleaks` on pushed refs, 180s).

## Resources & Isolation

| Lane    | Endpoint / State                             | Boundary                                               |
| ------- | -------------------------------------------- | ------------------------------------------------------ |
| Dev     | `127.0.0.1:7047` (`pokepocket.dev.hexly.ai`) | Daily play (COOP/COEP); never recycle for tests        |
| Preview | `127.0.0.1:17047`                            | Access enabled; never recycle for tests                |
| L3 / L2 | `127.0.0.1:17048`, per-run tmp root          | Isolated Miniflare Worker; never deploy remote `-test` |
| Prod    | `https://pokepocket.hexly.ai`                | Access-protected Worker; read-only unless authorized   |

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
