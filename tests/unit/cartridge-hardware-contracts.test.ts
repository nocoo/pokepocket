import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ROM_SIZE,
  cartridgeTitle,
  parseHeader,
  readCartridge,
  romPath,
  validateBatterySave,
  type Cartridge,
  type SaveType,
} from '../../src/lib/cartridge';
import { GB_LOGO, readHardwareHeader } from '../../src/lib/rom-header';
import { gbFixture, gbaFixture, updateGbChecksum } from '../fixtures/headers';

afterEach(() => {
  vi.restoreAllMocks();
});

function createCustomGba(options: {
  title?: string;
  gameCode?: string;
  makerCode?: string;
  version?: number;
  payload?: string;
  size?: number;
}) {
  const size = options.size ?? 1024;
  const bytes = new Uint8Array(size);
  const title = (options.title ?? 'POKEMON EMER').padEnd(12, '\0').slice(0, 12);
  const gameCode = (options.gameCode ?? 'BPEE').padEnd(4, '\0').slice(0, 4);
  const makerCode = (options.makerCode ?? '01').padEnd(2, '\0').slice(0, 2);
  bytes.set(new TextEncoder().encode(title), 0xa0);
  bytes.set(new TextEncoder().encode(`${gameCode}${makerCode}`), 0xac);
  bytes[0xb2] = 0x96;
  bytes[0xbc] = options.version ?? 0;

  let checksum = -0x19;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i] ?? 0;
  bytes[0xbd] = checksum & 0xff;

  if (options.payload) {
    bytes.set(new TextEncoder().encode(options.payload), 0x180);
  }
  return bytes;
}

function createCustomGb(options: {
  title?: string;
  color?: boolean;
  type?: number;
  code?: string;
  makerByte?: number;
  makerAscii?: string;
  sizeCode?: number;
  ramCode?: number;
  version?: number;
  bufferSize?: number;
  corruptChecksum?: boolean;
}) {
  const sizeCode = options.sizeCode ?? 0;
  const irregularBanks: Record<number, number> = { 82: 72, 83: 80, 84: 96 };
  const banks = sizeCode <= 8 ? 2 ** (sizeCode + 1) : (irregularBanks[sizeCode] ?? 2);
  const declaredSize = banks * 16384;
  const bufferSize = options.bufferSize ?? Math.max(32768, declaredSize);
  const bytes = new Uint8Array(bufferSize);

  bytes.set(GB_LOGO, 0x104);

  const color = options.color ?? false;
  bytes[0x143] = color ? 0x80 : 0;

  const title = options.title ?? 'TEST GAME';
  const code = options.code ?? '';
  bytes.set(new TextEncoder().encode(title), 0x134);
  if (color && code) {
    bytes.set(new TextEncoder().encode(code), 0x13f);
  }

  bytes[0x147] = options.type ?? 0x00;
  bytes[0x148] = sizeCode;
  bytes[0x149] = options.ramCode ?? 0;

  const makerByte = options.makerByte ?? 0x01;
  bytes[0x14b] = makerByte;
  if (makerByte === 0x33 && options.makerAscii) {
    bytes.set(new TextEncoder().encode(options.makerAscii), 0x144);
  }

  bytes[0x14c] = options.version ?? 0;

  if (!options.corruptChecksum) {
    updateGbChecksum(bytes);
  } else {
    bytes[0x14d] = 0x00;
  }

  return bytes;
}

describe('Cartridge and hardware header contracts', () => {
  describe('GBA save type table, capacities, and RTC signatures', () => {
    const tableCases: {
      payload: string;
      expectedSaveType: SaveType;
      expectedRamSize: number;
    }[] = [
      { payload: 'FLASH1M_V103', expectedSaveType: 'FLASH1M', expectedRamSize: 131072 },
      { payload: 'FLASH512_V130', expectedSaveType: 'FLASH512', expectedRamSize: 65536 },
      { payload: 'FLASH_V120', expectedSaveType: 'FLASH512', expectedRamSize: 65536 },
      { payload: 'EEPROM_V124', expectedSaveType: 'EEPROM', expectedRamSize: 0 },
      { payload: 'SRAM_V110', expectedSaveType: 'SRAM', expectedRamSize: 32768 },
      { payload: 'SRAM_F_V100', expectedSaveType: 'SRAM', expectedRamSize: 32768 },
      { payload: 'NO_SPECIAL_TAG', expectedSaveType: 'AUTO', expectedRamSize: 0 },
    ];

    for (const { payload, expectedSaveType, expectedRamSize } of tableCases) {
      it(`parses saveType ${expectedSaveType} with capacity ${expectedRamSize} from payload tag ${payload}`, () => {
        const rom = createCustomGba({ payload });
        const header = parseHeader(rom.buffer);
        expect(header.saveType).toBe(expectedSaveType);
        expect(header.ramSize).toBe(expectedRamSize);
      });
    }

    it('identifies RTC from catalog edition IDs and SIIRTC_V signature independently', () => {
      // Reuses gbaFixture for Emerald baseline
      const emeraldBase = gbaFixture('BPEE');
      const emeraldHeader = parseHeader(emeraldBase.buffer);
      expect(emeraldHeader.editionId).toBe('emerald');
      expect(emeraldHeader.rtc).toBe(true);
      expect(emeraldHeader.isEmerald).toBe(true);

      // Ruby edition code AXVE has RTC enabled by catalog edition match even without SIIRTC_V
      const rubyRom = createCustomGba({
        title: 'POKEMON RUBY',
        gameCode: 'AXVE',
        payload: 'FLASH1M_V102',
      });
      const rubyHeader = parseHeader(rubyRom.buffer);
      expect(rubyHeader.editionId).toBe('ruby');
      expect(rubyHeader.rtc).toBe(true);
      expect(rubyHeader.isEmerald).toBe(false);

      // Sapphire edition code AXPE has RTC enabled by catalog edition match
      const sapphireRom = createCustomGba({
        title: 'POKEMON SAPP',
        gameCode: 'AXPE',
        payload: 'FLASH1M_V102',
      });
      const sapphireHeader = parseHeader(sapphireRom.buffer);
      expect(sapphireHeader.editionId).toBe('sapphire');
      expect(sapphireHeader.rtc).toBe(true);
      expect(sapphireHeader.isEmerald).toBe(false);

      // FireRed edition code BPRE does NOT have RTC
      const fireRedRom = createCustomGba({
        title: 'POKEMON FIRE',
        gameCode: 'BPRE',
        payload: 'FLASH1M_V103',
      });
      const fireRedHeader = parseHeader(fireRedRom.buffer);
      expect(fireRedHeader.editionId).toBe('firered');
      expect(fireRedHeader.rtc).toBe(false);

      // Custom non-catalog ROM with SIIRTC_V signature has RTC enabled
      const customRtcRom = createCustomGba({
        title: 'CUSTOM GAME',
        gameCode: 'CUST',
        payload: 'EEPROM_V111\0SIIRTC_V001',
      });
      const customRtcHeader = parseHeader(customRtcRom.buffer);
      expect(customRtcHeader.editionId).toBeNull();
      expect(customRtcHeader.rtc).toBe(true);

      // Custom non-catalog ROM without SIIRTC_V signature has RTC disabled
      const customNoRtcRom = createCustomGba({
        title: 'CUSTOM GAME',
        gameCode: 'CUST',
        payload: 'EEPROM_V111',
      });
      const customNoRtcHeader = parseHeader(customNoRtcRom.buffer);
      expect(customNoRtcHeader.editionId).toBeNull();
      expect(customNoRtcHeader.rtc).toBe(false);
    });
  });

  describe('validateBatterySave strict boundary contracts', () => {
    // Tests base, base+32 interior, base+64 valid boundary, and base-1, base+65 invalid boundary
    const boundaryMatrix: {
      saveType: SaveType;
      ramSize: number;
      baseSizes: number[];
      invalidProbe: number;
    }[] = [
      {
        saveType: 'FLASH1M',
        ramSize: 131072,
        baseSizes: [131072],
        invalidProbe: 65536,
      },
      {
        saveType: 'FLASH512',
        ramSize: 65536,
        baseSizes: [65536],
        invalidProbe: 131072,
      },
      {
        saveType: 'EEPROM',
        ramSize: 0,
        baseSizes: [512, 8192],
        invalidProbe: 32768,
      },
      {
        saveType: 'SRAM',
        ramSize: 32768,
        baseSizes: [32768],
        invalidProbe: 65536,
      },
      {
        saveType: 'GB_RAM',
        ramSize: 8192,
        baseSizes: [8192],
        invalidProbe: 32768,
      },
      {
        saveType: 'AUTO',
        ramSize: 0,
        baseSizes: [512, 8192, 32768, 65536, 131072],
        invalidProbe: 16384,
      },
    ];

    for (const { saveType, ramSize, baseSizes, invalidProbe } of boundaryMatrix) {
      it(`validates base, base+32, base+64 and rejects base-1 and base+65 for saveType ${saveType}`, () => {
        const dummyHeader = {
          system: 'GBA' as const,
          title: 'TEST',
          gameCode: 'TEST',
          makerCode: '01',
          version: 0,
          mapper: 'GBA',
          ramSize,
          declaredSize: null,
          rtc: false,
          size: 1024,
          saveType,
          editionId: null,
          isEmerald: false,
        };

        for (const base of baseSizes) {
          // Exactly base: valid
          expect(() => validateBatterySave(base, dummyHeader)).not.toThrow();
          // Interior accepted RTC suffix (base + 32): valid
          expect(() => validateBatterySave(base + 32, dummyHeader)).not.toThrow();
          // Upper boundary with 64-byte RTC suffix (base + 64): valid
          expect(() => validateBatterySave(base + 64, dummyHeader)).not.toThrow();
          // Below base (base - 1): invalid
          expect(() => validateBatterySave(base - 1, dummyHeader)).toThrow();
          // Above base + 64 (base + 65): invalid
          expect(() => validateBatterySave(base + 65, dummyHeader)).toThrow();
        }

        // Distinct probe outside any base window: invalid
        expect(() => validateBatterySave(invalidProbe, dummyHeader)).toThrow();
      });
    }

    it('rejects any save when GB_RAM has 0 ramSize (no RAM on cartridge)', () => {
      const noRamHeader = {
        system: 'GB' as const,
        title: 'NO RAM GAME',
        gameCode: '',
        makerCode: '01',
        version: 0,
        mapper: 'ROM',
        ramSize: 0,
        declaredSize: 32768,
        rtc: false,
        size: 32768,
        saveType: 'GB_RAM' as const,
        editionId: null,
        isEmerald: false,
      };

      expect(() => validateBatterySave(0, noRamHeader)).toThrow('匹配卡带容量');
      expect(() => validateBatterySave(512, noRamHeader)).toThrow('匹配卡带容量');
      expect(() => validateBatterySave(8192, noRamHeader)).toThrow('匹配卡带容量');
      expect(() => validateBatterySave(32768, noRamHeader)).toThrow('匹配卡带容量');
    });
  });

  describe('GB / GBC hardware header contracts', () => {
    it('identifies mappers: ROM, MBC1, MBC2 (512-byte RAM), MBC3, MBC5, unknown mapper types, and unknown ram codes', () => {
      // Reuses gbFixture for baseline
      const baseGb = gbFixture('POKEMON RED', false, 0x13);
      expect(readHardwareHeader(baseGb).mapper).toBe('MBC3');

      // 0x00: ROM
      const rom0 = createCustomGb({ type: 0x00, ramCode: 0 });
      expect(readHardwareHeader(rom0).mapper).toBe('ROM');

      // 0x08: ROM+RAM
      const rom8 = createCustomGb({ type: 0x08, ramCode: 2 });
      expect(readHardwareHeader(rom8).mapper).toBe('ROM');

      // 0x09: ROM+RAM+BATTERY
      const rom9 = createCustomGb({ type: 0x09, ramCode: 2 });
      expect(readHardwareHeader(rom9).mapper).toBe('ROM');

      // 0x01, 0x02, 0x03: MBC1
      for (const t of [1, 2, 3]) {
        const mbc1 = createCustomGb({ type: t, ramCode: 3 });
        const h = readHardwareHeader(mbc1);
        expect(h.mapper).toBe('MBC1');
        expect(h.ramSize).toBe(32768);
      }

      // 0x05, 0x06: MBC2 has exactly 512 bytes of RAM regardless of ramCode byte
      for (const t of [5, 6]) {
        const mbc2 = createCustomGb({ type: t, ramCode: 0 });
        const h = readHardwareHeader(mbc2);
        expect(h.mapper).toBe('MBC2');
        expect(h.ramSize).toBe(512);
      }

      // 0x0f..0x13: MBC3
      // 0x0f and 0x10 have RTC enabled
      const mbc3Rtc1 = createCustomGb({ type: 0x0f });
      expect(readHardwareHeader(mbc3Rtc1).mapper).toBe('MBC3');
      expect(readHardwareHeader(mbc3Rtc1).rtc).toBe(true);

      const mbc3Rtc2 = createCustomGb({ type: 0x10 });
      expect(readHardwareHeader(mbc3Rtc2).mapper).toBe('MBC3');
      expect(readHardwareHeader(mbc3Rtc2).rtc).toBe(true);

      const mbc3Normal = createCustomGb({ type: 0x13 });
      expect(readHardwareHeader(mbc3Normal).mapper).toBe('MBC3');
      expect(readHardwareHeader(mbc3Normal).rtc).toBe(false);

      // 0x19..0x1e: MBC5
      for (const t of [0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e]) {
        const mbc5 = createCustomGb({ type: t });
        expect(readHardwareHeader(mbc5).mapper).toBe('MBC5');
      }

      // Unknown mapper type e.g. 0xFD
      const unknownType = createCustomGb({ type: 0xfd });
      expect(readHardwareHeader(unknownType).mapper).toBe('TYPE FD');

      // Unknown RAM size code (e.g. 0x07 or 0xff) falls back to 0 bytes
      const unknownRamCodeGb = createCustomGb({ ramCode: 0x07 });
      expect(readHardwareHeader(unknownRamCodeGb).ramSize).toBe(0);
    });

    it('parses irregular ROM sizes (82 -> 72 banks, 83 -> 80 banks, 84 -> 96 banks) and rejects unknown size codes', () => {
      // 82: 72 banks * 16384 = 1179648 bytes (1.1 MB)
      const rom82 = createCustomGb({ sizeCode: 82 });
      expect(readHardwareHeader(rom82).declaredSize).toBe(72 * 16384);

      // 83: 80 banks * 16384 = 1310720 bytes (1.25 MB)
      const rom83 = createCustomGb({ sizeCode: 83 });
      expect(readHardwareHeader(rom83).declaredSize).toBe(80 * 16384);

      // 84: 96 banks * 16384 = 1572864 bytes (1.5 MB)
      const rom84 = createCustomGb({ sizeCode: 84 });
      expect(readHardwareHeader(rom84).declaredSize).toBe(96 * 16384);

      // Standard power-of-two bank codes: 0 -> 2 banks, 1 -> 4 banks, ..., 8 -> 512 banks
      const rom0 = createCustomGb({ sizeCode: 0 });
      expect(readHardwareHeader(rom0).declaredSize).toBe(2 * 16384);

      const rom5 = createCustomGb({ sizeCode: 5 });
      expect(readHardwareHeader(rom5).declaredSize).toBe(64 * 16384);

      // Unknown size code e.g. 9 or 99 throws
      const romInvalid = createCustomGb({ sizeCode: 99 });
      expect(() => readHardwareHeader(romInvalid)).toThrow('无法识别 GB / GBC 卡带容量');
    });

    it('handles color code split (hasCode vs noCode) and title parsing boundary', () => {
      // Monochromatic GB: title reads up to $0144 (16 bytes)
      const gb = createCustomGb({ color: false, title: 'MONO GAME TITLE' });
      const gbHeader = readHardwareHeader(gb);
      expect(gbHeader.system).toBe('GB');
      expect(gbHeader.gameCode).toBe('');
      expect(gbHeader.title).toBe('MONO GAME TITLE');

      // GBC with valid 4-character uppercase/digit code: title up to $013f (11 bytes)
      const gbcWithCode = createCustomGb({
        color: true,
        title: 'CRYSTAL',
        code: 'BYTE',
      });
      const gbcWithCodeHeader = readHardwareHeader(gbcWithCode);
      expect(gbcWithCodeHeader.system).toBe('GBC');
      expect(gbcWithCodeHeader.gameCode).toBe('BYTE');
      expect(gbcWithCodeHeader.title).toBe('CRYSTAL');

      // GBC without valid 4-character code (title with spaces at end of 0x13f..0x143): title extends to $0143 (15 bytes)
      const gbcNoCode = createCustomGb({
        color: true,
        title: 'POKEMON GOLD ',
      });
      const gbcNoCodeHeader = readHardwareHeader(gbcNoCode);
      expect(gbcNoCodeHeader.system).toBe('GBC');
      expect(gbcNoCodeHeader.gameCode).toBe('');
      expect(gbcNoCodeHeader.title).toBe('POKEMON GOLD');
    });

    it('parses maker formats: 0x33 ascii maker code vs numeric hex byte', () => {
      // makerCodeByte === 0x33: reads 2 ascii bytes at $0144..$0146
      const asciiMaker = createCustomGb({ makerByte: 0x33, makerAscii: '01' });
      expect(readHardwareHeader(asciiMaker).makerCode).toBe('01');

      // Other makerCodeByte: hex string
      const hexMaker = createCustomGb({ makerByte: 0x42 });
      expect(readHardwareHeader(hexMaker).makerCode).toBe('42');
    });

    it('rejects truncated buffer, corrupted GB logo, and corrupted GB checksum', () => {
      // Length < 0xc0
      expect(() => readHardwareHeader(new Uint8Array(100))).toThrow(
        '卡带文件不完整，无法读取文件头',
      );

      // GB logo mismatch (and not GBA either)
      const badLogo = createCustomGb({});
      badLogo[0x104] = 0x00;
      expect(() => readHardwareHeader(badLogo)).toThrow('这不是有效的 GB / GBC / GBA 卡带');

      // Corrupted GB checksum
      const badChecksum = createCustomGb({ corruptChecksum: true });
      expect(() => readHardwareHeader(badChecksum)).toThrow('GB / GBC 文件头校验失败');
    });

    it('supports truly header-sized bounded reads (0xc0 GBA and 0x150 GB/GBC) with nonzero offset and surrounding sentinels', () => {
      // Bounded buffer with sentinel prefix (64 bytes) and suffix (64 bytes)
      const sentinelByte = 0xee;
      const prefixLen = 64;
      const suffixLen = 64;

      // 1. GBA bounded read: exactly 0xc0 (192) bytes at offset 64
      const gbaHeaderLen = 0xc0;
      const gbaBuffer = new ArrayBuffer(prefixLen + gbaHeaderLen + suffixLen);
      const gbaBytes = new Uint8Array(gbaBuffer);
      gbaBytes.fill(sentinelByte);

      const fullGba = createCustomGba({ title: 'BOUNDED GBA', gameCode: 'BPEE', makerCode: '01' });
      gbaBytes.set(fullGba.subarray(0, gbaHeaderLen), prefixLen);

      // Slice exact sub-array with nonzero byteOffset and exactly 0xc0 length
      const gbaSubArray = new Uint8Array(gbaBuffer, prefixLen, gbaHeaderLen);
      expect(gbaSubArray.byteOffset).toBe(prefixLen);
      expect(gbaSubArray.byteLength).toBe(gbaHeaderLen);

      const gbaParsed = readHardwareHeader(gbaSubArray);
      expect(gbaParsed.system).toBe('GBA');
      expect(gbaParsed.title).toBe('BOUNDED GBA');
      expect(gbaParsed.gameCode).toBe('BPEE');
      expect(gbaParsed.makerCode).toBe('01');

      // Verify prefix and suffix sentinels remained untouched
      expect(gbaBytes[prefixLen - 1]).toBe(sentinelByte);
      expect(gbaBytes[prefixLen + gbaHeaderLen]).toBe(sentinelByte);

      // 2. GB / GBC bounded read: exactly 0x150 (336) bytes at offset 64
      const gbHeaderLen = 0x150;
      const gbBuffer = new ArrayBuffer(prefixLen + gbHeaderLen + suffixLen);
      const gbBytes = new Uint8Array(gbBuffer);
      gbBytes.fill(sentinelByte);

      const fullGb = createCustomGb({ title: 'BOUNDED GB', color: true, code: 'GB01' });
      gbBytes.set(fullGb.subarray(0, gbHeaderLen), prefixLen);

      // Slice exact sub-array with nonzero byteOffset and exactly 0x150 length
      const gbSubArray = new Uint8Array(gbBuffer, prefixLen, gbHeaderLen);
      expect(gbSubArray.byteOffset).toBe(prefixLen);
      expect(gbSubArray.byteLength).toBe(gbHeaderLen);

      const gbParsed = readHardwareHeader(gbSubArray);
      expect(gbParsed.system).toBe('GBC');
      expect(gbParsed.title).toBe('BOUNDED GB');
      expect(gbParsed.gameCode).toBe('GB01');

      // Verify sentinels untouched
      expect(gbBytes[prefixLen - 1]).toBe(sentinelByte);
      expect(gbBytes[prefixLen + gbHeaderLen]).toBe(sentinelByte);
    });

    it('rejects oversized GB/GBC and truncated declared size in parseHeader', () => {
      // GB ROM > 8 MB
      const oversizedGb = new ArrayBuffer(8 * 1024 * 1024 + 1);
      const oversizedBytes = new Uint8Array(oversizedGb);
      oversizedBytes.set(GB_LOGO, 0x104);
      updateGbChecksum(oversizedBytes);
      expect(() => parseHeader(oversizedGb)).toThrow('GB / GBC 卡带不能超过 8 MB');

      // GB declared size truncation: sizeCode 5 declares 64 banks (1 MB), but buffer is only 32 KB
      const truncatedDeclared = createCustomGb({ sizeCode: 5, bufferSize: 32768 });
      expect(() => parseHeader(truncatedDeclared.buffer)).toThrow(
        '卡带被截断，文件头声明的容量为 1024 KB',
      );
    });
  });

  describe('readCartridge, cartridgeTitle, and romPath contracts', () => {
    it('rejects oversized file before arrayBuffer / hashing is called and restores spies', async () => {
      const oversizedFile = new File([''], 'oversized.gba');
      Object.defineProperty(oversizedFile, 'size', {
        value: MAX_ROM_SIZE + 1,
      });

      const arrayBufferSpy = vi.spyOn(oversizedFile, 'arrayBuffer');
      const digestSpy = vi.spyOn(crypto.subtle, 'digest');

      try {
        await expect(readCartridge(oversizedFile)).rejects.toThrow('卡带不能超过 32 MB');
        expect(arrayBufferSpy).not.toHaveBeenCalled();
        expect(digestSpy).not.toHaveBeenCalled();
      } finally {
        arrayBufferSpy.mockRestore();
        digestSpy.mockRestore();
      }
    });

    it('rejects invalid file extension before reading arrayBuffer', async () => {
      const invalidFile = new File([new Uint8Array(500)], 'invalid.iso');
      const arrayBufferSpy = vi.spyOn(invalidFile, 'arrayBuffer');

      try {
        await expect(readCartridge(invalidFile)).rejects.toThrow('请选择 .gb、.gbc 或 .gba 卡带');
        expect(arrayBufferSpy).not.toHaveBeenCalled();
      } finally {
        arrayBufferSpy.mockRestore();
      }
    });

    it('resolves cartridgeTitle and romPath for catalog editions, custom titles, and fallback filenames', () => {
      // 1. Catalog edition
      const emeraldCart: Cartridge = {
        id: '1234abcd',
        fileName: 'custom-name.gba',
        data: new ArrayBuffer(0),
        header: {
          system: 'GBA',
          title: 'POKEMON EMER',
          gameCode: 'BPEE',
          makerCode: '01',
          version: 0,
          mapper: 'GBA',
          ramSize: 131072,
          declaredSize: null,
          rtc: true,
          size: 1024,
          saveType: 'FLASH1M',
          editionId: 'emerald',
          isEmerald: true,
        },
        addedAt: 0,
        lastPlayed: 0,
        playTime: 0,
      };
      expect(cartridgeTitle(emeraldCart)).toBe('宝可梦 绿宝石');
      expect(romPath(emeraldCart)).toBe('/roms/1234abcd.gba');

      // 2. Custom title without catalog edition
      const customCart: Cartridge = {
        id: '5678ef01',
        fileName: 'rom-filename.gbc',
        data: new ArrayBuffer(0),
        header: {
          system: 'GBC',
          title: 'MY HOMEBREW',
          gameCode: '',
          makerCode: '01',
          version: 0,
          mapper: 'MBC5',
          ramSize: 32768,
          declaredSize: 65536,
          rtc: false,
          size: 65536,
          saveType: 'GB_RAM',
          editionId: null,
          isEmerald: false,
        },
        addedAt: 0,
        lastPlayed: 0,
        playTime: 0,
      };
      expect(cartridgeTitle(customCart)).toBe('MY HOMEBREW');
      expect(romPath(customCart)).toBe('/roms/5678ef01.gbc');

      // 3. Fallback to filename when title is empty
      const emptyTitleCart: Cartridge = {
        id: '9988aabb',
        fileName: 'unnamed-rom.gb',
        data: new ArrayBuffer(0),
        header: {
          system: 'GB',
          title: '',
          gameCode: '',
          makerCode: '01',
          version: 0,
          mapper: 'ROM',
          ramSize: 0,
          declaredSize: 32768,
          rtc: false,
          size: 32768,
          saveType: 'GB_RAM',
          editionId: null,
          isEmerald: false,
        },
        addedAt: 0,
        lastPlayed: 0,
        playTime: 0,
      };
      expect(cartridgeTitle(emptyTitleCart)).toBe('unnamed-rom');
      expect(romPath(emptyTitleCart)).toBe('/roms/9988aabb.gb');
    });
  });
});
