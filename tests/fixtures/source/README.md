# Original Executable Cartridge Fixtures

This directory contains the reviewable human-readable assembly source files for the original executable test cartridges used in pokepocket.

## Purpose

These fixtures provide clean, first-party executable ROMs for Game Boy (GB), Game Boy Color (GBC), and Game Boy Advance (GBA) without relying on commercial ROMs or requiring third-party toolchains (such as RGBDS or arm-none-eabi-gcc) during continuous integration.

The executable byte arrays are generated directly in TypeScript via `tests/fixtures/executable.ts`. The generators encode the exact instructions listed in these source files, accompanied by address assertions, label offsets, and structural contracts.

## Source Files

- `original-gb.asm`: RGBDS-compatible Z80 assembly for the GB and GBC fixtures.
  - Entry vector at `0x0100` (`jp Boot`).
  - Code starts at `0x0150`.
  - Enables external SRAM at `0x0000` via MBC3/MBC1 (`ld a, $0a; ld [$0000], a`).
  - Initializes SRAM byte `0xa000` to `1` if uninitialized (`0xff`).
  - Configures BG palette (`0xff68`/`0xff69` for CGB, `0xff47` for DMG).
  - Clears tile map at `0x9800..0x9c00`.
  - Renders a screen pattern using 8x8 tiles at `0x8000` based on SRAM byte parity.
  - Polls joypad input at `0xff00` for button A press/release.
  - On button A press: increments SRAM byte `0xa000` and redraws the screen with an alternating tile pattern.

- `original-gba.s`: GNU Assembler (arm-none-eabi-as) compatible ARMv4T assembly for the GBA fixture.
  - Entry vector at `0x0000` (`b boot`).
  - Boot routine at `0x00c0`.
  - Configures DISPCNT at `0x04000000` to Mode 3 with BG2 enabled (`0x0403`).
  - Reads external SRAM byte at `0x0e000000`.
  - Initializes SRAM byte to `1` if uninitialized (`0xff`).
  - Polls KEYINPUT at `0x04000130` for button A press/release.
  - On button A press: increments SRAM byte, masks to 5 bits, and updates Mode 3 frame buffer (`0x06000000`).
  - Renders red (`0x001f`) or green (`0x03e0`) frame based on SRAM byte parity.
  - Contains the SRAM marker string `SRAM_V110` at offset `0x0400`.
  - Cartridge game code is `ZPPE` to avoid hardware overrides in mGBA.

## Reproduction & Verification

The compiled bytecode in `tests/fixtures/executable.ts` exactly reproduces the verified binary images:

- GB: 32,768 bytes, SHA256 `3a805823b9b750e5a87e658bcb3950ce9871e1b0c79c811398393199fb2c510c`
- GBC: 32,768 bytes, SHA256 `da4ebf2bc83dcc193c2a0ce117c697a9a0c74c1939b189bf6cf8d948bc28c36a`
- GBA: 32,768 bytes, SHA256 `369d40a2b77d3c55f1b966dc8dbfbd2100195a3fcf31625891e7ea6bc8055ab8`

Every fixture provides a 32,768-byte battery save (`.sav`) and verifies:

1. Initial battery byte starts at `1`.
2. Button A press changes the rendering and increments the first battery byte from `1` to `2`.
3. Rebooting with the saved battery preserves the updated byte `2`.
