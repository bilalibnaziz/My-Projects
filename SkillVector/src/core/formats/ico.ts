// Favicon / app icon (.ico) with PNG-compressed images at several sizes.

export function encodeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const head = 6 + images.length * 16;
  const total = head + images.reduce((s, i) => s + i.png.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); // icon
  dv.setUint16(4, images.length, true);
  let offset = head;
  images.forEach((img, k) => {
    const e = 6 + k * 16;
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, img.png.length, true);
    dv.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}
