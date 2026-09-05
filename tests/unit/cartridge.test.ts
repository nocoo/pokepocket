import { describe, expect, it } from 'vitest';
import {
  MAX_ROM_SIZE,
  parseHeader,
  readCartridge,
  validateBatterySave,
} from '../../src/lib/cartridge';

function fixture() {
  const data = new Uint8Array(1024);
  data.set(new TextEncoder().encode('POKEMON EMER'), 0xa0);
  data.set(new TextEncoder().encode('BPEE01'), 0xac);
  data[0xb2] = 0x96;
  let checksum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= data[i]!;
  data[0xbd] = (checksum - 0x19) & 0xff;
  data.set(new TextEncoder().encode('FLASH1M_V103\0SIIRTC_V001'), 0x100);
  return data;
}

describe('GBA cartridge boundary validation', () => {
  it('identifies Emerald, 128 KiB flash and RTC from cartridge bytes', () => {
    expect(parseHeader(fixture().buffer)).toMatchObject({
      title: 'POKEMON EMER',
      gameCode: 'BPEE',
      makerCode: '01',
      isEmerald: true,
      saveType: 'FLASH1M',
      rtc: true,
      version: 0,
    });
  });

  it('rejects truncated, oversized and non-GBA input before emulation', () => {
    expect(() => parseHeader(new ArrayBuffer(191))).toThrow('不完整');
    expect(() => parseHeader(new ArrayBuffer(MAX_ROM_SIZE + 1))).toThrow('32 MB');
    const data = fixture();
    data[0xb2] = 0;
    expect(() => parseHeader(data.buffer)).toThrow('不是有效');
  });

  it('rejects a modified game header with an invalid complement check', () => {
    const data = fixture();
    data[0xac] = 0x43;
    expect(() => parseHeader(data.buffer)).toThrow('校验失败');
  });

  it('isolates different ROMs with identical names and recognizes renamed copies', async () => {
    const data = fixture();
    const original = await readCartridge(new File([data], 'game.gba'));
    const renamed = await readCartridge(new File([data], 'emerald.gba'));
    data[0x200] = 42;
    const changed = await readCartridge(new File([data], 'game.gba'));
    expect(original.id).toEqual(renamed.id);
    expect(original.id).not.toEqual(changed.id);
    expect(original.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('identifies renamed cartridges by bytes and validates Emerald save sizes', async () => {
    expect((await readCartridge(new File([fixture()], 'pokemon.gbc'))).header.system).toBe('GBA');
    await expect(readCartridge(new File([fixture()], 'pokemon.nds'))).rejects.toThrow('.gb');
    const header = parseHeader(fixture().buffer);
    expect(() => validateBatterySave(131072, header)).not.toThrow();
    expect(() => validateBatterySave(131088, header)).not.toThrow();
    expect(() => validateBatterySave(65536, header)).toThrow('128 KB');
    expect(() => validateBatterySave(2_000_000, header)).toThrow('128 KB');
  });
});
