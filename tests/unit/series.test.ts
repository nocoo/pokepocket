import { describe, expect, it } from 'vitest';
import { EDITIONS } from '../../src/lib/catalog';
import { parseHeader, readCartridge, romPath, validateBatterySave } from '../../src/lib/cartridge';
import { gbFixture, gbaFixture, updateGbChecksum } from '../fixtures/headers';

describe('Pokémon GB / GBC / GBA cartridge recognition', () => {
  it.each([
    ['red', 'POKEMON RED', false, 0x13, ''],
    ['green', 'POKEMON GREEN', false, 0x13, ''],
    ['blue', 'POKEMON BLUE', false, 0x13, ''],
    ['yellow', 'POKEMON YELLOW', true, 0x13, ''],
    ['gold', 'POKEMON_GLD', true, 0x10, 'AAUE'],
    ['silver', 'POKEMON_SLV', true, 0x10, 'AAXE'],
    ['crystal', 'PM_CRYSTAL', true, 0x10, 'BYTE'],
  ] as const)(
    'recognizes %s and its mapper / RTC independently of filenames',
    (id, title, color, type, code) => {
      const header = parseHeader(gbFixture(title, color, type, code).buffer);
      expect(header).toMatchObject({
        editionId: id,
        system: color ? 'GBC' : 'GB',
        mapper: 'MBC3',
        ramSize: 32768,
        rtc: type === 0x10,
      });
      expect(() => validateBatterySave(32768, header)).not.toThrow();
      expect(() => validateBatterySave(32816, header)).not.toThrow();
      expect(() => validateBatterySave(131072, header)).toThrow('32 KB');
    },
  );
  it.each([
    ['AXVJ', 'ruby'],
    ['AXPE', 'sapphire'],
    ['BPED', 'emerald'],
    ['BPRF', 'firered'],
    ['BPGS', 'leafgreen'],
  ])('recognizes regional GBA game code %s', (code, id) => {
    const header = parseHeader(gbaFixture(code).buffer);
    expect(header.editionId).toBe(id);
    expect(header.rtc).toBe(['ruby', 'sapphire', 'emerald'].includes(id!));
  });
  it('rejects malformed Game Boy headers and truncated bank data', () => {
    const bytes = gbFixture();
    bytes[0x14d]! ^= 1;
    expect(() => parseHeader(bytes.buffer)).toThrow('校验失败');
    updateGbChecksum(bytes);
    bytes[0x148] = 1;
    updateGbChecksum(bytes);
    expect(() => parseHeader(bytes.buffer)).toThrow('被截断');
    bytes[0x104] = 0;
    expect(() => parseHeader(bytes.buffer)).toThrow('不是有效');
  });
  it('uses built-in MBC2 RAM capacity even when the RAM-size header byte is zero', () => {
    const bytes = gbFixture('HOMEBREW', false, 0x06);
    bytes[0x149] = 0;
    updateGbChecksum(bytes);
    const header = parseHeader(bytes.buffer);
    expect(header.ramSize).toBe(512);
    expect(() => validateBatterySave(512, header)).not.toThrow();
    expect(() => validateBatterySave(32768, header)).toThrow();
  });
  it('isolates cross-platform cartridges and routes each to its native core path', async () => {
    const gb = await readCartridge(new File([gbFixture()], 'pokemon.gba'));
    const gba = await readCartridge(new File([gbaFixture()], 'pokemon.gba'));
    expect(gb.id).not.toBe(gba.id);
    expect(romPath(gb)).toBe(`/roms/${gb.id}.gb`);
    expect(romPath(gba)).toBe(`/roms/${gba.id}.gba`);
  });
  it('has twelve unique editions with a distinct, correctly typed bundle for each', () => {
    expect(EDITIONS).toHaveLength(12);
    expect(new Set(EDITIONS.map((edition) => edition.id)).size).toBe(12);
    expect(new Set(EDITIONS.map((edition) => edition.fileName)).size).toBe(12);
    for (const edition of EDITIONS)
      expect(edition.fileName.endsWith(`.${edition.system.toLowerCase()}`)).toBe(true);
  });
});
