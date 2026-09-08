<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Poké Pocket logo" width="180" height="180" />
</p>

<h1 align="center">Poké Pocket</h1>

<p align="center">Play GB / GBC / GBA Pokémon from a browser cartridge collection, with separate progress for each ROM.</p>

<p align="center">
  <a href="https://pokepocket.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

<p align="center">
  <img src="pokepocket.png" alt="Poké Pocket cartridge collection" width="960" />
</p>

## What it does

Poké Pocket combines a skeuomorphic cartridge collection with a browser handheld emulator. React provides the cartridges, handheld, and controls; mGBA WebAssembly runs user-supplied ROMs in the browser. A Cloudflare Worker handles access verification and static asset delivery.

The collection covers Red / Green / Blue / Yellow, Gold / Silver / Crystal, Ruby / Sapphire / Emerald, and FireRed / LeafGreen. It supports single-player GB, GBC, and GBA games, without NDS, 3DS, Switch, link trades, or multiplayer battles. The repository and deployment package contain no ROMs.

## Features

- Switch cartridge colors, screens, and handheld frames by edition; import cartridges through file selection or drag and drop.
- Use configurable keyboard bindings, touch controls, and standard Gamepad API controllers, with conflict detection and saved preferences.
- Pause, temporarily fast-forward, adjust volume, and enter fullscreen, with crisp-pixel and retro-LCD display filters.
- Keep a battery save, an automatic resume point, and three manual save states for each ROM; import and export `.sav` files.
- Export the game screen as a PNG; confirm before loading, replacing, or deleting manual save states.

ROMs, battery saves, and save states are separated by the ROM's SHA-256 and stored in the current browser's IndexedDB. Key bindings and display preferences use localStorage. Importing, emulation, and screenshots happen in the browser without uploading ROMs or progress. Before changing devices or clearing browser data, save from the game's own menu and export a `.sav` file.

## Usage

The [hosted site](https://pokepocket.hexly.ai) requires Cloudflare Access authorization. Import your own `.gb`, `.gbc`, or `.gba` file, then select its cartridge to start. Subsequent sessions can use the same browser's cached copy.

| Startup mode                                 | Cartridge source                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bun run dev` with `roms/` or `rom/` present | Discover cartridges in private local directories, with browser import also available |
| `bun run dev` without local cartridges       | Browser import and cache                                                             |
| Production site / `bun run preview`          | Browser import and cache after Access verification                                   |

The development server scans only the first level of `roms/` and `rom/`, identifies editions from actual ROM headers, and ignores invalid files and symlinks. It reads the selected cartridge only when starting or switching editions. Production and preview do not read these directories.

| Action                 | Default keys         |
| ---------------------- | -------------------- |
| Direction              | Arrow keys / W A S D |
| A / B                  | O / P                |
| L / R                  | Q / E                |
| START / SELECT         | Enter / Shift        |
| Pause                  | Space                |
| Temporary fast-forward | Hold backquote       |
| Mute / fullscreen      | M / F                |

Returning to the collection pauses and saves; switching cartridges retains the previous game's progress. Importing a `.sav` replaces that ROM's battery save and clears its old automatic resume point while preserving the three manual states. Use `.sav` for transfers between emulators; save states depend on the emulator core version.

## Development

Use Node.js 22.12 or newer, preferably with Bun 1.4.0 to match CI. Installation prepares the unmodified mGBA JavaScript / WASM files and runtime dependency licenses.

```bash
git clone https://github.com/nocoo/pokepocket.git
cd pokepocket
bun install --frozen-lockfile
bun run dev
```

The development server listens on `127.0.0.1:7047`; open `http://localhost:7047`. The configured local hostname is `pokepocket.dev.hexly.ai`, which requires your own local DNS and trusted HTTPS proxy. Emulator threads need `SharedArrayBuffer`; both the development server and Worker provide COOP / COEP isolation headers.

```bash
bun run typecheck
bun run lint
bun run build
bun run preview
```

Preview uses port 17047 and retains production Access verification, returning 403 without a valid token. Use the development server for normal local play. Builds inspect static assets and Git-tracked paths to keep ROMs and saves out of the distribution.

### Hosting and access

The current deployment is defined in [wrangler.jsonc](../wrangler.jsonc) and the [Worker entry point](../worker/index.ts). Pages, images, WASM, and game APIs pass through Worker verification. `GET /api/live` is the only public API and returns only status and version. The production Worker does not serve ROM routes or provide server-side emulation, a save database, or ROM storage.

The Access issuer and team check are fixed to `nocoo` in code; environment variables alone cannot move the app to another team. Self-hosting requires updating these settings, the domain, and the Access audience, with an access policy covering the whole site. The current configuration disables `workers.dev` and preview hostnames.

| Directory                       | Contents                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| `src/components`, `src/App.tsx` | Collection, handheld, save, and settings interfaces               |
| `src/lib`                       | Emulator, input mapping, cartridge detection, and browser storage |
| `src/data`                      | Supported edition catalog                                         |
| `worker`                        | Access verification, APIs, and asset responses                    |
| `scripts`, `tests`              | Development tools and tests                                       |

## Tests

| Layer                                                       | Command                     |
| ----------------------------------------------------------- | --------------------------- |
| Component, emulator wrapper, storage, and Worker unit tests | `bun run test`              |
| Local cartridge service HTTP tests                          | `bun run test:http`         |
| Production Worker HTTP contracts                            | `bun run quality:l2`        |
| Required browser journeys                                   | `bun run test:e2e`          |
| Optional browser journeys with locally supplied cartridges  | `bun run test:e2e:optional` |

Run `bun run test:coverage` for a coverage report. The HTTP contract command builds the app and uses port 17048. Browser commands build it and use a separate server on 27047; keep the relevant port free before running.

Local browser journeys use an installed Google Chrome. CI uses Playwright Chromium, which can be prepared with `bunx playwright install --with-deps chromium`. Required journeys use original GB / GBC / GBA test programs and temporary signed tokens, without commercial ROMs. Optional journeys require the complete supported cartridge set on your machine. These tests do not replace real Cloudflare SSO verification or complete game playthroughs.

## Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-149ECA?logo=react&logoColor=white)
![mGBA WebAssembly](https://img.shields.io/badge/mGBA-WebAssembly-654FF0?logo=webassembly&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)

| Area                       | Implementation                                   |
| -------------------------- | ------------------------------------------------ |
| Interface                  | React, TypeScript, CSS, Lucide                   |
| Emulator                   | mGBA WebAssembly, Canvas, Web Audio, Gamepad API |
| Local data                 | IndexedDB / idb, localStorage                    |
| Hosting and authentication | Cloudflare Workers, Cloudflare Access, jose      |
| Development and tests      | Vite, Bun, Vitest, Testing Library, Playwright   |

## Documentation

- [Documentation index](README.md)
- [Logo usage](04-logo-usage.md) and [identity study](https://hexly.ai/logos/pokepocket)
- [Third-party sources and licenses](../THIRD_PARTY_NOTICES.md), including cartridge source references and build tools

Architecture and interaction draw on [Swift-plays-Pokemon](https://github.com/LiarPrincess/Swift-plays-Pokemon) and [PokeSwift](https://github.com/Dimillian/PokeSwift). This project uses mGBA and does not port their Swift emulator implementations.

## License

Original application code and documentation use [MIT](../LICENSE) © 2026 Zheng Li. The unmodified mGBA WebAssembly package uses MPL-2.0 and ships with its license and corresponding source address. Other dependencies retain their own licenses.

ROMs, Pokémon names, trademarks, character artwork, and original game content in screenshots are outside the MIT license. Their rights belong to Nintendo, Game Freak, Creatures, and other respective owners. This is an independent fan project without official affiliation or endorsement; the project license and access controls grant no rights to game content. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for the full scope.
