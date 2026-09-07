# Poké Pocket logo usage

The identity is red-capped trainer turning with a poké ball. It follows the reviewed Hexly character study `2026-09-07-03`, finishing `01`.

## Asset roles

- `logo.png`: exact 960 × 960 transparent foreground, free of the backdrop and cast shadow.
- `assets/brand/icon.png`: square presentation for large cards and platforms that apply their own mask.
- `assets/brand/icon-rounded.png`: large README and gallery presentation.
- `assets/brand/background.png`: independent pocket orbits field.

Small header/sidebar marks and favicons use the transparent foreground without an extra tile or circular CSS mask. Touch/PWA icons use the opaque square presentation. Source hashes and provenance live in `assets/brand/source.json`. Regenerate application sizes with `uv run --with pillow python assets/brand/generate.py`; roles are recorded in `usage.json` and checksums in `derivatives.json`.

## Consumers

- index.html
- src/App.tsx: collection header and game header

## Study

[Individual comparison](https://hexly.ai/logos/pokepocket) · [Complete generation archive](https://github.com/nocoo/hexly.ai/tree/main/artwork/logo-family/pokepocket/2026-09-07-03) · [Shared usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)
