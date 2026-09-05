# Changelog

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
