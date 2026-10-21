import { describe, it, expect } from 'vitest';
import { decodeTiff, encodeTiff } from '../core/formats/tiff';
import { crc32, zip } from '../core/formats/zip';
import { encodeBmp } from '../core/formats/bmp';
import { encodeIco } from '../core/formats/ico';
import { buildPdf } from '../core/formats/pdf';

const img = (w: number, h: number) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([(i * 37) % 256, (i * 11) % 256, (i * 5) % 256, i % 3 ? 255 : 128], i * 4);
  return { width: w, height: h, data };
};

/** Minimal TIFF writer for testing the decoder with other compressions. */
function tiffWith(w: number, h: number, rgb: Uint8Array, compression: number, strip: Uint8Array, predictor = 1) {
  const tags: [number, number, number][] = [
    [256, 3, w], [257, 3, h], [258, 3, 8], [259, 3, compression], [262, 3, 2], [273, 4, 0], [277, 3, 3], [278, 3, h], [279, 4, strip.length], [317, 3, predictor],
  ];
  const ifd = 8;
  const dataAt = ifd + 2 + tags.length * 12 + 4;
  const buf = new Uint8Array(dataAt + strip.length);
  const dv = new DataView(buf.buffer);
  buf[0] = buf[1] = 0x4d; // big endian, to test 'MM' too
  dv.setUint16(2, 42);
  dv.setUint32(4, ifd);
  dv.setUint16(ifd, tags.length);
  tags.forEach(([t, type, v], k) => {
    const e = ifd + 2 + k * 12;
    dv.setUint16(e, t);
    dv.setUint16(e + 2, type);
    dv.setUint32(e + 4, 1);
    if (t === 273) dv.setUint32(e + 8, dataAt);
    else if (type === 3) dv.setUint16(e + 8, v);
    else dv.setUint32(e + 8, v);
  });
  buf.set(strip, dataAt);
  void rgb;
  return buf.buffer;
}

function packbitsEncode(src: Uint8Array): Uint8Array {
  // Literal runs only: valid PackBits
  const out: number[] = [];
  for (let i = 0; i < src.length; i += 128) {
    const n = Math.min(128, src.length - i);
    out.push(n - 1, ...src.subarray(i, i + n));
  }
  return Uint8Array.from(out);
}

function lzwEncode(src: Uint8Array): Uint8Array {
  const bits: number[] = [];
  let width = 9;
  const put = (code: number) => {
    for (let k = width - 1; k >= 0; k--) bits.push((code >> k) & 1);
  };
  let dict = new Map<string, number>();
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  };
  reset();
  let next = 258;
  put(256);
  let w = '';
  for (const byte of src) {
    const c = String.fromCharCode(byte);
    if (dict.has(w + c)) w += c;
    else {
      put(dict.get(w)!);
      dict.set(w + c, next++);
      if (next + 1 >= 1 << width && width < 12) width++;
      w = c;
    }
  }
  if (w) put(dict.get(w)!);
  put(257);
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => (out[i >> 3] |= b << (7 - (i & 7))));
  return out;
}

describe('TIFF', () => {
  it('round-trips RGBA exactly', async () => {
    const a = img(13, 7);
    const back = await decodeTiff(encodeTiff(a).buffer as ArrayBuffer);
    expect([back.width, back.height]).toEqual([13, 7]);
    expect(Array.from(back.data)).toEqual(Array.from(a.data));
  });
  it('writes CMYK separations that read back close to the original', async () => {
    const a = { width: 2, height: 1, data: new Uint8ClampedArray([200, 120, 90, 255, 90, 120, 150, 255]) };
    const bytes = encodeTiff(a, { cmyk: true });
    expect(new DataView(bytes.buffer).getUint16(2, true)).toBe(42);
    const back = await decodeTiff(bytes.buffer as ArrayBuffer);
    // Naive CMYK→RGB on read differs from the print simulation, but stays in the same colour family
    expect(back.data[0]).toBeGreaterThan(back.data[2]);
    expect(back.data[6]).toBeGreaterThan(back.data[4]);
  });
  it('decodes PackBits and LZW (with predictor) in big-endian files', async () => {
    const w = 9, h = 4;
    const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 7) % 256);
    const pb = await decodeTiff(tiffWith(w, h, rgb, 32773, packbitsEncode(rgb)));
    expect(Array.from(pb.data.filter((_, i) => i % 4 !== 3))).toEqual(Array.from(rgb));
    const lz = await decodeTiff(tiffWith(w, h, rgb, 5, lzwEncode(rgb)));
    expect(Array.from(lz.data.filter((_, i) => i % 4 !== 3))).toEqual(Array.from(rgb));
    // Horizontal predictor: store differences
    const diff = new Uint8Array(rgb);
    for (let y = 0; y < h; y++) for (let x = w - 1; x > 0; x--) for (let c = 0; c < 3; c++) {
      const i = (y * w + x) * 3 + c;
      diff[i] = (rgb[i] - rgb[i - 3]) & 255;
    }
    const pr = await decodeTiff(tiffWith(w, h, rgb, 5, lzwEncode(diff), 2));
    expect(Array.from(pr.data.filter((_, i) => i % 4 !== 3))).toEqual(Array.from(rgb));
  });
  it('rejects non-TIFF data', async () => {
    await expect(decodeTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).rejects.toThrow(/Not a TIFF/);
  });
});

describe('other writers', () => {
  it('ZIP: CRC-32 and structure', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = zip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }, { name: 'a.txt', data: new Uint8Array(3) }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(z.length - 12, true)).toBe(2);
    expect(new TextDecoder().decode(z)).toContain('a 2.txt');
  });
  it('BMP and ICO headers', () => {
    const b = encodeBmp(2, 2, new Uint8ClampedArray(16).fill(255));
    expect(String.fromCharCode(b[0], b[1])).toBe('BM');
    expect(new DataView(b.buffer).getInt32(22, true)).toBe(-2);
    const ico = encodeIco([{ size: 16, png: new Uint8Array(10) }, { size: 256, png: new Uint8Array(20) }]);
    const dv = new DataView(ico.buffer);
    expect([dv.getUint16(2, true), dv.getUint16(4, true), ico[6], ico[22]]).toEqual([1, 2, 16, 0]);
    expect(ico.length).toBe(6 + 32 + 30);
  });
  it('PDF: valid header, xref offsets and trailer', () => {
    const pdf = buildPdf({ width: 100, height: 50, data: new Uint8Array([1, 2, 3]), filter: 'DCTDecode', alpha: new Uint8Array([4]) }, { title: 'Test (1)' });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 100.000 50.000]');
    expect(text).toContain('/SMask 6 0 R');
    const xref = +text.match(/startxref\n(\d+)/)![1];
    expect(text.slice(xref, xref + 4)).toBe('xref');
    // Every object offset points at "n 0 obj"
    const offs = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => +m[1]);
    offs.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
