import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ORIGINAL_BATTERY_SIZE,
  ORIGINAL_GB_PROGRAM,
  ORIGINAL_GBA_PROGRAM,
  createExecutableGbCartridge,
  createExecutableGbcCartridge,
  createExecutableGbaCartridge,
  createInitialBattery,
} from '../fixtures/executable';

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('executable cartridge fixtures generator contracts', () => {
  it('generates exact verified GB cartridge binary matching reference', () => {
    const gb = createExecutableGbCartridge();
    expect(gb.length).toBe(32_768);
    expect(sha256(gb)).toBe('3a805823b9b750e5a87e658bcb3950ce9871e1b0c79c811398393199fb2c510c');

    // Header contracts
    expect(gb[0x100]).toBe(0xc3); // jp
    expect(gb[0x101]).toBe(0x50);
    expect(gb[0x102]).toBe(0x01); // $0150
    expect(new TextDecoder().decode(gb.subarray(0x134, 0x140))).toBe('POCKET PROBE');
    expect(gb[0x143]).toBe(0x00); // DMG
    expect(gb[0x147]).toBe(0x13); // MBC3+RAM+BATTERY
    expect(gb[0x148]).toBe(0x00); // 32KB ROM
    expect(gb[0x149]).toBe(0x03); // 32KB RAM
    expect(gb[0x14d]).toBe(0x73); // Header checksum
  });

  it('generates exact verified GBC cartridge binary matching reference', () => {
    const gbc = createExecutableGbcCartridge();
    expect(gbc.length).toBe(32_768);
    expect(sha256(gbc)).toBe('da4ebf2bc83dcc193c2a0ce117c697a9a0c74c1939b189bf6cf8d948bc28c36a');

    // Header contracts
    expect(gbc[0x100]).toBe(0xc3); // jp
    expect(gbc[0x101]).toBe(0x50);
    expect(gbc[0x102]).toBe(0x01); // $0150
    expect(new TextDecoder().decode(gbc.subarray(0x134, 0x140))).toBe('POCKET PROBE');
    expect(gbc[0x143]).toBe(0x80); // CGB enabled
    expect(gbc[0x147]).toBe(0x13); // MBC3+RAM+BATTERY
    expect(gbc[0x148]).toBe(0x00); // 32KB ROM
    expect(gbc[0x149]).toBe(0x03); // 32KB RAM
    expect(gbc[0x14d]).toBe(0xf3); // Header checksum
  });

  it('generates exact verified GBA cartridge binary matching reference with ZPPE and SRAM_V110', () => {
    const gba = createExecutableGbaCartridge();
    expect(gba.length).toBe(32_768);
    expect(sha256(gba)).toBe('369d40a2b77d3c55f1b966dc8dbfbd2100195a3fcf31625891e7ea6bc8055ab8');

    // Header contracts
    expect(gba[0x00]).toBe(0x2e); // b 0xc0
    expect(gba[0x01]).toBe(0x00);
    expect(gba[0x02]).toBe(0x00);
    expect(gba[0x03]).toBe(0xea);
    expect(new TextDecoder().decode(gba.subarray(0xa0, 0xac))).toBe('POCKET PROBE');
    expect(new TextDecoder().decode(gba.subarray(0xac, 0xb0))).toBe('ZPPE');
    expect(new TextDecoder().decode(gba.subarray(0xb0, 0xb2))).toBe('01');
    expect(gba[0xb2]).toBe(0x96);
    expect(gba[0xbd]).toBe(0x53); // Header checksum

    // SRAM detector string at 0x400
    expect(new TextDecoder().decode(gba.subarray(0x400, 0x409))).toBe('SRAM_V110');
  });

  it('provides verified program byte constants matching assembly sources', () => {
    expect(ORIGINAL_GB_PROGRAM.length).toBe(144);
    expect(ORIGINAL_GBA_PROGRAM.length).toBe(128);

    // GB first instruction: DI (0xf3), LD SP, $fffe (0x31, 0xfe, 0xff)
    expect(ORIGINAL_GB_PROGRAM[0]).toBe(0xf3);
    expect(ORIGINAL_GB_PROGRAM[1]).toBe(0x31);
    expect(ORIGINAL_GB_PROGRAM[2]).toBe(0xfe);
    expect(ORIGINAL_GB_PROGRAM[3]).toBe(0xff);

    // GBA first instruction at 0xc0: mov r0, #0x04000000 (0x01, 0x03, 0xa0, 0xe3)
    expect(ORIGINAL_GBA_PROGRAM[0]).toBe(0x01);
    expect(ORIGINAL_GBA_PROGRAM[1]).toBe(0x03);
    expect(ORIGINAL_GBA_PROGRAM[2]).toBe(0xa0);
    expect(ORIGINAL_GBA_PROGRAM[3]).toBe(0xe3);
  });

  it('creates clean 32768-byte initial battery save matching protocol', () => {
    const battery = createInitialBattery();
    expect(battery.length).toBe(ORIGINAL_BATTERY_SIZE);
    expect(battery.length).toBe(32_768);
    expect(battery[0]).toBe(1);
    for (let i = 1; i < battery.length; i++) {
      expect(battery[i]).toBe(0);
    }
  });
});
