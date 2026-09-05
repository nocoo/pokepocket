/** GB/GBC headers occupy $0100–$014f; GBA headers occupy $0000–$00bf. */
export type GameSystem = 'GB' | 'GBC' | 'GBA';
export const GB_LOGO = new Uint8Array([
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
]);
export interface HardwareHeader {
  system: GameSystem;
  title: string;
  gameCode: string;
  makerCode: string;
  version: number;
  mapper: string;
  ramSize: number;
  declaredSize: number | null;
  rtc: boolean;
}
function ascii(view: DataView, start: number, end: number) {
  const slice = new Uint8Array(view.buffer, view.byteOffset + start, end - start);
  return new TextDecoder().decode(slice).replace(/\0/g, '').trim();
}
/** Accepts bounded reads so Workers do not need to buffer the whole ROM. */
export function readHardwareHeader(bytes: Uint8Array): HardwareHeader {
  if (bytes.length < 0xc0) throw new Error('卡带文件不完整，无法读取文件头。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gameBoy =
    bytes.length >= 0x150 && GB_LOGO.every((byte, i) => view.getUint8(0x104 + i) === byte);
  if (gameBoy) {
    let checksum = 0;
    for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - view.getUint8(i) - 1) & 0xff;
    if (checksum !== view.getUint8(0x14d))
      throw new Error('GB / GBC 文件头校验失败，卡带可能已损坏。');
    const color = (view.getUint8(0x143) & 0x80) !== 0;
    const code = color ? ascii(view, 0x13f, 0x143) : '';
    const hasCode = /^[A-Z0-9]{4}$/.test(code);
    const type = view.getUint8(0x147);
    const mapper = [0, 8, 9].includes(type)
      ? 'ROM'
      : [1, 2, 3].includes(type)
        ? 'MBC1'
        : [5, 6].includes(type)
          ? 'MBC2'
          : type >= 0x0f && type <= 0x13
            ? 'MBC3'
            : type >= 0x19 && type <= 0x1e
              ? 'MBC5'
              : `TYPE ${type.toString(16).padStart(2, '0').toUpperCase()}`;
    const ramSizes = [0, 2048, 8192, 32768, 131072, 65536];
    const sizeCode = view.getUint8(0x148);
    const irregular: Record<number, number> = { 82: 72, 83: 80, 84: 96 };
    const banks = sizeCode <= 8 ? 2 ** (sizeCode + 1) : irregular[sizeCode];
    if (!banks) throw new Error('无法识别 GB / GBC 卡带容量。');
    const makerCodeByte = view.getUint8(0x14b);
    return {
      system: color ? 'GBC' : 'GB',
      title: ascii(view, 0x134, color ? (hasCode ? 0x13f : 0x143) : 0x144),
      gameCode: hasCode ? code : '',
      makerCode: makerCodeByte === 0x33 ? ascii(view, 0x144, 0x146) : makerCodeByte.toString(16),
      version: view.getUint8(0x14c),
      mapper,
      ramSize: mapper === 'MBC2' ? 512 : (ramSizes[view.getUint8(0x149)] ?? 0),
      declaredSize: banks * 16384,
      rtc: type === 0x0f || type === 0x10,
    };
  }
  if (view.getUint8(0xb2) !== 0x96) throw new Error('这不是有效的 GB / GBC / GBA 卡带。');
  let checksum = -0x19;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= view.getUint8(i);
  if ((checksum & 0xff) !== view.getUint8(0xbd))
    throw new Error('GBA 文件头校验失败，卡带可能已损坏。');
  return {
    system: 'GBA',
    title: ascii(view, 0xa0, 0xac),
    gameCode: ascii(view, 0xac, 0xb0),
    makerCode: ascii(view, 0xb0, 0xb2),
    version: view.getUint8(0xbc),
    mapper: 'GBA',
    ramSize: 0,
    declaredSize: null,
    rtc: false,
  };
}
