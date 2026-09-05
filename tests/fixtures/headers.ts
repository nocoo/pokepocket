import { GB_LOGO } from '../../src/lib/rom-header';

export function gbFixture(title = 'POKEMON RED', color = false, type = 0x13, code = '') {
  const bytes = new Uint8Array(32768);
  bytes.set(GB_LOGO, 0x104);
  bytes.set(new TextEncoder().encode(title), 0x134);
  if (code) bytes.set(new TextEncoder().encode(code), 0x13f);
  bytes[0x143] = color ? 0x80 : 0;
  bytes[0x147] = type;
  bytes[0x148] = 0;
  bytes[0x149] = 3;
  updateGbChecksum(bytes);
  return bytes;
}
export function updateGbChecksum(bytes: Uint8Array) {
  let checksum = 0;
  for (let i = 0x134; i <= 0x14c; i++) checksum = (checksum - bytes[i]! - 1) & 0xff;
  bytes[0x14d] = checksum;
}
export function gbaFixture(code = 'BPEE') {
  const bytes = new Uint8Array(1024);
  bytes.set(new TextEncoder().encode('POKEMON EMER'), 0xa0);
  bytes.set(new TextEncoder().encode(code + '01'), 0xac);
  bytes[0xb2] = 0x96;
  let checksum = -0x19;
  for (let i = 0xa0; i <= 0xbc; i++) checksum -= bytes[i]!;
  bytes[0xbd] = checksum & 0xff;
  bytes.set(new TextEncoder().encode('FLASH1M_V103'), 0x180);
  return bytes;
}

/** Original GB instructions draw a repeating tile. No game ROM is used by CI. */
export function playableFixture() {
  const bytes = gbFixture();
  bytes.set([0xc3, 0x50, 0x01, 0x00], 0x100); // JP $0150
  bytes.set(
    [
      0xf3,
      0x31,
      0xfe,
      0xff, // DI; LD SP,$fffe
      0xaf,
      0xe0,
      0x40, // XOR A; turn LCD off
      0x3e,
      0xe4,
      0xe0,
      0x47, // Set the background palette
      0x21,
      0x00,
      0x80,
      0x06,
      0x10,
      0x3e,
      0xaa, // Tile address; 16 bytes; pattern
      0x22,
      0x2f,
      0x05,
      0x20,
      0xfb, // Write alternating rows
      0x3e,
      0x91,
      0xe0,
      0x40, // Enable the LCD
      0x18,
      0xfe, // Loop forever
    ],
    0x150,
  );
  return bytes;
}
