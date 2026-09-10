# Third-party notices

## Scope of the project license

The MIT license in `LICENSE` applies only to the original application code and original documentation contributed to Poké Pocket. It does not license Pokémon ROMs, characters, names, trademarks, pixel artwork in `public/art/`, or third-party game imagery visible in `docs/pokepocket.png`. Those rights remain with their respective owners. Third-party software and fonts retain their own licenses listed below. The project license and disclaimer grant no additional rights to game content.

## mGBA and the WebAssembly port

The emulator uses the unmodified `@thenick775/mgba-wasm` package, version 2.5.1.

- mGBA upstream: https://github.com/mgba-emu/mgba
- WebAssembly port and corresponding package source: https://github.com/thenick775/mgba/tree/e974b288bd7e5cfc7c7b96f8b4d32b673ddfb68c
- Package source and build instructions: https://github.com/thenick775/mgba/tree/e974b288bd7e5cfc7c7b96f8b4d32b673ddfb68c/src/platform/wasm
- License: Mozilla Public License 2.0, included in `public/licenses/mgba-MPL-2.0.txt`.

The postinstall script copies the upstream JavaScript and WebAssembly binaries without modification. These remain separate from the application bundle. The source and build instructions are available at the URLs above.

## Pokémon game content and pixel artwork

The Charizard, Venusaur, Blastoise, Pikachu, Ho-Oh, Lugia, Suicune, Groudon, Kyogre, Treecko, Torchic, Mudkip, and Rayquaza sprites in `public/art/` come from the first frame of the corresponding `graphics/pokemon/*/front.png` files in `pret/pokeemerald`, commit `5eff78649e7170a877b961ef0b3da13b81a16038`. They were cropped to 64 × 64 with palette index 0 made transparent. The surrounding handheld illustration, cartridge layout, typography treatment and site layout are implemented by this project in CSS and SVG.

Pokémon and associated characters, names, graphics and game content belong to Nintendo, Game Freak and Creatures. This is an independent fan project and is not affiliated with or endorsed by them. ROMs are excluded from Git and production assets. Local development can discover the user's private `roms/` or `rom/` directory; the deployed site reads user-selected files into browser storage without uploading them. Optional local builds use the following source projects. Source commits, build targets and original-ROM SHA-1 checksums are pinned in `scripts/rom-sources.json`.

- Red / Blue: https://github.com/pret/pokered
- Green (Japanese): https://github.com/Narishma-gb/pokegreen
- Yellow: https://github.com/pret/pokeyellow
- Gold / Silver: https://github.com/pret/pokegold
- Crystal: https://github.com/pret/pokecrystal
- Ruby / Sapphire: https://github.com/pret/pokeruby
- Emerald: https://github.com/pret/pokeemerald
- FireRed / LeafGreen: https://github.com/pret/pokefirered
- Build tools: https://github.com/pret/agbcc and https://github.com/gbdev/rgbds

## Other dependencies

- React: MIT, https://github.com/facebook/react
- Vite: MIT, https://github.com/vitejs/vite
- TypeScript: Apache-2.0, https://github.com/microsoft/TypeScript
- idb: ISC, https://github.com/jakearchibald/idb
- jose: MIT, https://github.com/panva/jose
- Lucide icons: ISC, https://lucide.dev/license
- DM Sans, Space Mono, Press Start 2P: SIL Open Font License 1.1, distributed via Fontsource; license files are included in their installed packages.
- Cloudflare Vite plugin and Wrangler: Apache-2.0 or MIT as specified by the respective packages, https://github.com/cloudflare/workers-sdk

Dependency versions and transitive dependencies are recorded in `bun.lock`.
