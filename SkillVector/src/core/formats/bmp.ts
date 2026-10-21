// Windows BMP writer: 32-bit BGRA with an alpha mask (BITMAPV4HEADER), top-down.

export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const header = 14 + 108;
  const size = header + width * height * 4;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, header, true);
  dv.setUint32(14, 108, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, -height, true); // top-down rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 32, true);
  dv.setUint32(30, 3, true); // BI_BITFIELDS
  dv.setUint32(34, width * height * 4, true);
  dv.setInt32(38, 2835, true); // 72 dpi
  dv.setInt32(42, 2835, true);
  dv.setUint32(54, 0x00ff0000, true); // R mask
  dv.setUint32(58, 0x0000ff00, true); // G
  dv.setUint32(62, 0x000000ff, true); // B
  dv.setUint32(66, 0xff000000, true); // A
  dv.setUint32(70, 0x73524742, true); // 'sRGB'
  for (let i = 0, o = header; i < rgba.length; i += 4, o += 4) {
    out[o] = rgba[i + 2];
    out[o + 1] = rgba[i + 1];
    out[o + 2] = rgba[i];
    out[o + 3] = rgba[i + 3];
  }
  return out;
}
