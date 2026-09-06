import { GB_LOGO } from '../../src/lib/rom-header';

export const ORIGINAL_BATTERY_SIZE = 32_768;

/**
 * GB/GBC program bytes matching tests/fixtures/source/original-gb.asm.
 *
 * Entry vector at 0x0100 jumps to Boot at 0x0150.
 * Enables SRAM (MBC3/MBC1), initializes first byte at 0xa000 to 1,
 * sets palettes and tilemap, renders initial pattern, and handles button A
 * press/release to increment SRAM byte and redraw.
 */
export const ORIGINAL_GB_PROGRAM = new Uint8Array([
  // Boot ($0150):
  0xf3, // di
  0x31,
  0xfe,
  0xff, // ld sp, $fffe
  0xcd,
  0xab,
  0x01, // call StopLcd ($01ab)
  0x3e,
  0x0a, // ld a, $0a (SRAM enable)
  0xea,
  0x00,
  0x00, // ld [$0000], a
  0xaf, // xor a
  0xea,
  0x00,
  0x40, // ld [$4000], a (RAM bank 0)
  0xfa,
  0x00,
  0xa0, // ld a, [$a000]
  0xfe,
  0xff, // cp $ff
  0x20,
  0x05, // jr nz, .saveReady (+$05 -> $016b)
  0x3e,
  0x01, // ld a, 1
  0xea,
  0x00,
  0xa0, // ld [$a000], a
  // .saveReady ($016b):
  0x3e,
  0x80, // ld a, $80 (auto-increment CGB palette 0)
  0xe0,
  0x68, // ldh [$ff68], a
  0x21,
  0xd8,
  0x01, // ld hl, Palette ($01d8)
  0x06,
  0x08, // ld b, 8
  // .palette ($0173):
  0x2a, // ld a, [hli]
  0xe0,
  0x69, // ldh [$ff69], a
  0x05, // dec b
  0x20,
  0xfa, // jr nz, .palette (-$06 -> $0173)
  0x3e,
  0xe4, // ld a, $e4 (DMG palette)
  0xe0,
  0x47, // ldh [$ff47], a
  0x21,
  0x00,
  0x98, // ld hl, $9800
  0x01,
  0x00,
  0x04, // ld bc, $0400 (1024 bytes tilemap)
  // .tileMap ($0183):
  0xaf, // xor a
  0x22, // ld [hli], a
  0x0b, // dec bc
  0x78, // ld a, b
  0xb1, // or c
  0x20,
  0xf9, // jr nz, .tileMap (-$07 -> $0183)
  0xcd,
  0xbb,
  0x01, // call Paint ($01bb)
  0x3e,
  0x10, // ld a, $10 (P14 low -> select direction/action buttons)
  0xe0,
  0x00, // ldh [$ff00], a
  // .press ($0194):
  0xf0,
  0x00, // ldh a, [$ff00]
  0xcb,
  0x47, // bit 0, a (button A pressed = bit 0 low)
  0x20,
  0xfa, // jr nz, .press (-$06 -> $0194)
  0xfa,
  0x00,
  0xa0, // ld a, [$a000]
  0x3c, // inc a
  0xea,
  0x00,
  0xa0, // ld [$a000], a
  0xcd,
  0xbb,
  0x01, // call Paint ($01bb)
  // .release ($01a5):
  0xf0,
  0x00, // ldh a, [$ff00]
  0xcb,
  0x47, // bit 0, a
  0x28,
  0xfa, // jr z, .release (-$06 -> $01a5)
  0x18,
  0xe8, // jr .press (-$18 -> $0194)

  // StopLcd ($01ab):
  0xf0,
  0x40, // ldh a, [$ff40]
  0xcb,
  0x7f, // bit 7, a (LCD enable)
  0x28,
  0x06, // jr z, .stop (+$06 -> $01b7)
  // .vblank ($01b1):
  0xf0,
  0x44, // ldh a, [$ff44]
  0xfe,
  0x90, // cp 144
  0x38,
  0xfa, // jr c, .vblank (-$06 -> $01b1)
  // .stop ($01b7):
  0xaf, // xor a
  0xe0,
  0x40, // ldh [$ff40], a
  0xc9, // ret

  // Paint ($01bb):
  0xcd,
  0xab,
  0x01, // call StopLcd ($01ab)
  0xfa,
  0x00,
  0xa0, // ld a, [$a000]
  0xe6,
  0x01, // and 1
  0x16,
  0x00, // ld d, $00
  0x28,
  0x02, // jr z, .pattern (+$02 -> $01c7)
  0x16,
  0xaa, // ld d, $aa
  // .pattern ($01c7):
  0x21,
  0x00,
  0x80, // ld hl, $8000
  0x06,
  0x10, // ld b, 16
  // .pixel ($01cd):
  0x7a, // ld a, d
  0x22, // ld [hli], a
  0x05, // dec b
  0x20,
  0xfb, // jr nz, .pixel (-$05 -> $01cd)
  0x3e,
  0x91, // ld a, $91 (LCD on, BG on, tile data $8000)
  0xe0,
  0x40, // ldh [$ff40], a
  0xc9, // ret

  // Palette ($01d8):
  0xff,
  0x7f,
  0x00,
  0x00,
  0xff,
  0x7f,
  0x00,
  0x00,
]);

/**
 * GBA program bytes matching tests/fixtures/source/original-gba.s.
 *
 * Boot routine at 0x00c0 sets Mode 3 video, initializes SRAM at 0x0e000000
 * to 1 if uninitialized (0xff), renders initial frame, polls KEYINPUT at
 * 0x04000130 for button A, increments SRAM byte on press, and toggles
 * red/green screen fill.
 */
export const ORIGINAL_GBA_PROGRAM = new Uint8Array([
  // boot ($00c0):
  0x01,
  0x03,
  0xa0,
  0xe3, // mov r0, #0x04000000 (REG_DISPCNT)
  0x01,
  0x1b,
  0xa0,
  0xe3, // mov r1, #0x400 (BG2 enable)
  0x03,
  0x10,
  0x81,
  0xe3, // orr r1, r1, #3 (Mode 3 bitmap)
  0xb0,
  0x10,
  0xc0,
  0xe1, // strh r1, [r0]
  0x0e,
  0x54,
  0xa0,
  0xe3, // mov r5, #0x0e000000 (SRAM base)
  0x00,
  0x40,
  0xd5,
  0xe5, // ldrb r4, [r5]
  0xff,
  0x00,
  0x54,
  0xe3, // cmp r4, #0xff
  0x01,
  0x40,
  0xa0,
  0x03, // moveq r4, #1
  0x00,
  0x40,
  0xc5,
  0x05, // strbeq r4, [r5]
  0x50,
  0x60,
  0x9f,
  0xe5, // ldr r6, =0x04000130 (REG_KEYINPUT, pc + 8 + 0x50 = 0x13c)
  0x0a,
  0x00,
  0x00,
  0xeb, // bl paint ($0118)
  // wait_press ($00ec):
  0xb0,
  0x70,
  0xd6,
  0xe1, // ldrh r7, [r6]
  0x01,
  0x00,
  0x17,
  0xe3, // tst r7, #1 (button A pressed = bit 0 low)
  0xfc,
  0xff,
  0xff,
  0x1a, // bne wait_press
  0x01,
  0x40,
  0x84,
  0xe2, // add r4, r4, #1
  0x1f,
  0x40,
  0x04,
  0xe2, // and r4, r4, #31
  0x00,
  0x40,
  0xc5,
  0xe5, // strb r4, [r5]
  0x03,
  0x00,
  0x00,
  0xeb, // bl paint ($0118)
  // wait_release ($0108):
  0xb0,
  0x70,
  0xd6,
  0xe1, // ldrh r7, [r6]
  0x01,
  0x00,
  0x17,
  0xe3, // tst r7, #1
  0xfc,
  0xff,
  0xff,
  0x0a, // beq wait_release
  0xf4,
  0xff,
  0xff,
  0xea, // b wait_press
  // paint ($0118):
  0x01,
  0x00,
  0x14,
  0xe3, // tst r4, #1
  0x1f,
  0x00,
  0xa0,
  0x13, // movne r0, #0x1f (red BGR555: 0x001f)
  0x3e,
  0x0e,
  0xa0,
  0x03, // moveq r0, #0x3e0 (green BGR555: 0x03e0)
  0x06,
  0x14,
  0xa0,
  0xe3, // mov r1, #0x06000000 (VRAM Mode 3 frame buffer)
  0x96,
  0x2c,
  0xa0,
  0xe3, // mov r2, #0x9600 (240 * 160 = 38,400 halfwords)
  // fill ($012c):
  0xb2,
  0x00,
  0xc1,
  0xe0, // strh r0, [r1], #2
  0x01,
  0x20,
  0x52,
  0xe2, // subs r2, r2, #1
  0xfc,
  0xff,
  0xff,
  0x1a, // bne fill
  0x1e,
  0xff,
  0x2f,
  0xe1, // bx lr
  // .ltorg literal pool ($013c):
  0x30,
  0x01,
  0x00,
  0x04, // .word 0x04000130
]);

/**
 * Creates an executable GB cartridge (32,768 bytes) with MBC3+RAM+BATTERY (0x13),
 * 32KB external RAM (size code 3), and verified entry code.
 */
export function createExecutableGbCartridge(): Uint8Array {
  const bytes = new Uint8Array(32_768);
  // Entry point at 0x100: jp $0150
  bytes.set([0xc3, 0x50, 0x01, 0x00], 0x100);
  // Nintendo logo at 0x104..0x133
  bytes.set(GB_LOGO, 0x104);
  // Title at 0x134..0x143: "POCKET PROBE\0\0\0\0"
  bytes.set(new TextEncoder().encode('POCKET PROBE'), 0x134);
  // Cartridge type at 0x147: 0x13 (MBC3+RAM+BATTERY)
  bytes[0x147] = 0x13;
  // ROM size at 0x148: 0 (32KB, 2 banks)
  bytes[0x148] = 0x00;
  // RAM size at 0x149: 3 (32KB, 4 banks)
  bytes[0x149] = 0x03;

  // Header checksum at 0x14d
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) {
    checksum = (checksum - (bytes[i] ?? 0) - 1) & 0xff;
  }
  bytes[0x14d] = checksum;

  // Program code at 0x150..0x1de
  bytes.set(ORIGINAL_GB_PROGRAM, 0x150);
  return bytes;
}

/**
 * Creates an executable GBC cartridge (32,768 bytes) with CGB support enabled (0x80),
 * MBC3+RAM+BATTERY (0x13), 32KB external RAM, and verified entry code.
 */
export function createExecutableGbcCartridge(): Uint8Array {
  const bytes = createExecutableGbCartridge();
  // CGB flag at 0x143: 0x80 (supports CGB enhancements)
  bytes[0x143] = 0x80;
  // Recompute header checksum
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) {
    checksum = (checksum - (bytes[i] ?? 0) - 1) & 0xff;
  }
  bytes[0x14d] = checksum;
  return bytes;
}

/**
 * Creates an executable GBA cartridge (32,768 bytes) with Mode 3 bitmap rendering,
 * external SRAM support (SRAM_V110 marker at 0x400), and cartridge code ZPPE
 * to avoid mGBA hardware overrides.
 */
export function createExecutableGbaCartridge(): Uint8Array {
  const bytes = new Uint8Array(32_768);
  // Entry instruction at 0x00: b 0xc0 (offset = (0xc0 - 8) / 4 = 0x2e -> 0xea00002e)
  bytes.set([0x2e, 0x00, 0x00, 0xea], 0x00);
  // Game title at 0xa0..0xab: "POCKET PROBE"
  bytes.set(new TextEncoder().encode('POCKET PROBE'), 0xa0);
  // Game code at 0xac..0xaf: "ZPPE"
  bytes.set(new TextEncoder().encode('ZPPE'), 0xac);
  // Maker code at 0xb0..0xb1: "01"
  bytes.set(new TextEncoder().encode('01'), 0xb0);
  // Fixed value at 0xb2: 0x96
  bytes[0xb2] = 0x96;

  // GBA header checksum at 0xbd: sum from 0xa0 through 0xbc
  let checksum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) {
    checksum = (checksum - (bytes[i] ?? 0)) & 0xff;
  }
  checksum = (checksum - 0x19) & 0xff;
  bytes[0xbd] = checksum;

  // Program code at 0xc0..0x13f
  bytes.set(ORIGINAL_GBA_PROGRAM, 0xc0);

  // SRAM marker string at 0x400 for mGBA backup detector
  bytes.set(new TextEncoder().encode('SRAM_V110'), 0x400);

  return bytes;
}

/**
 * Creates an empty, initialized original 32,768-byte battery save
 * matching the initial external SRAM state with byte 0 set to 1.
 */
export function createInitialBattery(): Uint8Array {
  const battery = new Uint8Array(ORIGINAL_BATTERY_SIZE);
  battery[0] = 1;
  return battery;
}
