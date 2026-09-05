import { getEdition, identifyEdition } from './catalog';
import { readHardwareHeader, type HardwareHeader } from './rom-header';

export const MAX_ROM_SIZE = 32 * 1024 * 1024;
export type SaveType = 'FLASH1M' | 'FLASH512' | 'EEPROM' | 'SRAM' | 'GB_RAM' | 'AUTO';
export interface CartridgeHeader extends HardwareHeader {
  size: number;
  saveType: SaveType;
  editionId: string | null;
  isEmerald: boolean;
}
export interface Cartridge {
  id: string;
  fileName: string;
  data: ArrayBuffer;
  header: CartridgeHeader;
  addedAt: number;
  lastPlayed: number;
  playTime: number;
}
export function parseHeader(data: ArrayBuffer): CartridgeHeader {
  const bytes = new Uint8Array(data);
  if (bytes.length > MAX_ROM_SIZE) throw new Error('卡带不能超过 32 MB。');
  const hardware = readHardwareHeader(bytes);
  const editionId = identifyEdition(hardware.system, hardware.title, hardware.gameCode);
  let saveType: SaveType = 'GB_RAM';
  let rtc = hardware.rtc;
  let ramSize = hardware.ramSize;
  if (hardware.system === 'GBA') {
    const contents = new TextDecoder('latin1').decode(bytes);
    saveType = contents.includes('FLASH1M_V')
      ? 'FLASH1M'
      : /FLASH(512)?_V/.test(contents)
        ? 'FLASH512'
        : contents.includes('EEPROM_V')
          ? 'EEPROM'
          : /SRAM(_F)?_V/.test(contents)
            ? 'SRAM'
            : 'AUTO';
    rtc =
      ['ruby', 'sapphire', 'emerald'].includes(editionId ?? '') || contents.includes('SIIRTC_V');
    ramSize =
      saveType === 'FLASH1M'
        ? 131072
        : saveType === 'FLASH512'
          ? 65536
          : saveType === 'SRAM'
            ? 32768
            : 0;
  } else {
    if (bytes.length > 8 * 1024 * 1024) throw new Error('GB / GBC 卡带不能超过 8 MB。');
    if (hardware.declaredSize && bytes.length < hardware.declaredSize)
      throw new Error(`卡带被截断，文件头声明的容量为 ${hardware.declaredSize / 1024} KB。`);
  }
  return {
    ...hardware,
    ramSize,
    rtc,
    size: bytes.length,
    saveType,
    editionId,
    isEmerald: editionId === 'emerald',
  };
}
export async function readCartridge(file: File): Promise<Cartridge> {
  if (!/\.(gba|gbc|gb)$/i.test(file.name))
    throw new Error('请选择 .gb、.gbc 或 .gba 卡带；当前支持 Game Boy 系列掌机。');
  if (file.size > MAX_ROM_SIZE) throw new Error('卡带不能超过 32 MB。');
  const data = await file.arrayBuffer();
  const header = parseHeader(data);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const id = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { id, fileName: file.name, data, header, addedAt: Date.now(), lastPlayed: 0, playTime: 0 };
}
export function cartridgeTitle(cartridge: Cartridge): string {
  const edition = getEdition(cartridge.header.editionId);
  return edition
    ? `宝可梦 ${edition.name}`
    : cartridge.header.title || cartridge.fileName.replace(/\.(gba|gbc|gb)$/i, '');
}
export function romPath(cartridge: Cartridge): string {
  return `/roms/${cartridge.id}.${cartridge.header.system.toLowerCase()}`;
}
export function validateBatterySave(size: number, header: CartridgeHeader): void {
  const sizes: Record<SaveType, number[]> = {
    FLASH1M: [131072],
    FLASH512: [65536],
    EEPROM: [512, 8192],
    SRAM: [32768],
    GB_RAM: header.ramSize ? [header.ramSize] : [],
    AUTO: [512, 8192, 32768, 65536, 131072],
  };
  // Common mGBA / VBA / BGB exports append up to 64 bytes of RTC state.
  if (!sizes[header.saveType].some((base) => size >= base && size <= base + 64)) {
    const capacity = header.ramSize ? `${header.ramSize / 1024} KB` : '匹配卡带容量';
    throw new Error(`这枚卡带需要 ${capacity} 的 .sav 存档，请确认文件对应当前版本。`);
  }
}
