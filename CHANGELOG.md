# Changelog

## v1.2.0 — 2026-09-07

### Added

- Expand the responsive content area to 1680 pixels, with a larger Play area and an aligned sidebar for controls and saves.
- Place the cartridge switcher below the game and sidebar as a full-width physical cartridge carousel, with touch scrolling, navigation buttons, generation filters, and search.
- Arrange all three manual snapshots in vertical rows with previews, timestamps, and accessible replace and clear actions.

### Fixed

- Keep the footer at the bottom of short pages, set interface text to at least 11 pixels, and balance the padding around the handheld with the sidebar height.
- Restore emulator save memory and persisted data together when save imports or snapshot restores fail, and serialize save recovery across cartridge changes.
- Guard overlapping cartridge and snapshot commands, preserve pause state when restart or import dialogs are canceled, and refresh gamepad status after modal changes.

### Quality and release

- Add enforced unit coverage and static checks before commits, plus production HTTP contracts and pinned vulnerability and secret scanners before pushes.
- Require isolated GB, GBC, and GBA browser journeys covering ROM import and reload, battery save round trips, snapshot actions, layout, screenshots, fullscreen, and access boundaries.
- Run the same quality gates in CI and for every release, bind deployment to the verified commit, reject stale automatic releases, and check the deployed version and Cloudflare Access protection.
- Preserve existing ROM identities, the IndexedDB schema, and save formats; compatibility checks cover previously imported cartridges and saves.

## v1.1.0 — 2026-09-05

### Added

- Confirm before loading manual or automatic snapshots, with a preview and save time.
- Replace or clear individual manual snapshots, with confirmation, busy states, and retryable errors.
- Export PNG screenshots at 1080 pixels high while preserving the original aspect ratio and crisp pixels.
- Display the package version in the library sidebar and settings, and expose status and version at `/api/live`.

### Fixed

- Center the handheld in fullscreen and scale its text, controls, and decorations together.
- Keep button labels readable on hover, focus, and press, including the continue button.
- Preserve the save manager and pause state when snapshot actions are canceled or completed.
- Check Access readiness before deployment, retry temporary failures, and report HTTP and Cloudflare diagnostics.
- Verify both the deployed version and Access protection after deployment.
