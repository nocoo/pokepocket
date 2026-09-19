# Native filesystem and pause safety

The application stores cartridge bytes, battery saves and snapshots in its own IndexedDB database
through `storage.ts`. The emulator filesystem is the working copy used by the native core.

## Why native filesystem operations must be synchronous

The pinned mGBA 2.5.1 bundle uses Emscripten 6.0.5. Its `fd_sync` proxies from the emulator thread to
the browser main thread in promise mode and waits for an asynchronous IDBFS flush. A simultaneous
`pauseGame` or thread interrupt blocks the main thread until the emulator thread stops. The browser
cannot deliver the IndexedDB completion while that synchronous call is waiting, so both threads
wait indefinitely. Frame counters and save notifications alone do not prevent this cycle.

`scripts/mgba-memory-filesystem.mjs` adapts the same-origin runtime during `setup-emulator`. It
checks the exact version and SHA-256 of the installed JavaScript before changing the reviewed
filesystem initializer and `fd_sync` proxy. SDK drift fails the build and requires a new review.
The WebAssembly binary, worker loading through `import.meta.url`, and runtime version remain intact.

## Existing data and persistence

Before loading a cartridge or starting emulation, `FSInit` awaits a read of both legacy SDK IDBFS
mounts, `/data` and `/autosave`. It collects their complete file bytes and directory structure, then
recreates them under MEMFS mounts. It neither deletes nor writes back the legacy IndexedDB databases.
Read failures, unsupported entries and copy failures reject initialization instead of starting with
missing data. This also preserves legacy native saves when the application's battery record is absent.

During emulation, native `fd_sync` uses a synchronous proxy and returns a numeric result only for a
memory filesystem. An asynchronous backing store returns `ENOTSUP`; real filesystem errors propagate.
It never acknowledges an unfinished persistent-store flush. Application battery and snapshot writes
still await their existing IndexedDB transactions, and persistence failures remain visible. `FSSync`
continues to be awaited by the application, but the native working filesystem has no asynchronous
backing mount.

Startup also pauses the core while replacing callbacks and configuring direction policy, volume and
speed. These structures are read by the native thread during frames. Configuration's internal
interrupt/continue preserves the native pause request; the application resumes only after setup
succeeds. A setup error leaves the core paused. Snapshot restore retains mask `61` and its existing
active-SRAM and battery-file semantics.

## Verification

Unit tests execute the emitted proxy, reject SDK drift and asynchronous backends, preserve syscall
errors, and verify legacy cache import without persistent writes. Emulator tests enforce paused setup
and cartridge switching. The full browser suite verifies GB/GBC/GBA pause/resume, snapshot restoration,
exact battery bytes, reload persistence, and access isolation without altered assertions or timeouts.
A real-browser legacy-cache regression brings the mandatory exact count to 31 and verifies that
working-copy writes leave the original SDK IndexedDB bytes intact.
