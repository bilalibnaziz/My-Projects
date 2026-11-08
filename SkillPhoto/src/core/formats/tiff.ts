// TIFF reading and writing.
// Reads baseline TIFFs as saved by Photoshop, Lightroom, scanners and cameras: little or big
// endian, strips or tiles, uncompressed / PackBits / LZW / Deflate, horizontal predictor,
// 8 or 16 bits, gray, RGB(A), palette and CMYK. Writes uncompressed RGBA or print-ready CMYK.

import { separate } from '../color';

export interface RasterRGBA {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** 16-bit gray / RGB(A) files: the full samples, RGBA 0..65535. */
  data16?: Uint16Array;
  /** Embedded ICC profile (tag 34675), if any. */
  icc?: Uint8Array;
}

const MAX_SIDE = 30000;

// ---------------------------------------------------------------- decompression

function packbits(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++];
    } else if (n !== -128) {
      const v = src[i++];
      for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = v;
    }
  }
  return out;
}

/** TIFF LZW (MSB-first codes, "early change"). */
function lzw(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  let bitPos = 0;
  const read = (bits: number) => {
    let v = 0;
    for (let k = 0; k < bits; k++) {
      const byte = src[(bitPos >> 3)] ?? 0;
      v = (v << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      bitPos++;
    }
    return v;
  };
  let dict: Uint8Array[] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i));
    dict.push(new Uint8Array(0), new Uint8Array(0)); // 256 clear, 257 end
  };
  reset();
  let width = 9;
  let prev: Uint8Array | null = null;
  while (bitPos + width <= src.length * 8 && o < expected) {
    const code = read(width);
    if (code === 257) break;
    if (code === 256) {
      reset();
      width = 9;
      prev = null;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length) entry = dict[code];
    else if (prev) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev);
      entry[prev.length] = prev[0];
    } else break;
    for (let k = 0; k < entry.length && o < expected; k++) out[o++] = entry[k];
    if (prev) {
      const next = new Uint8Array(prev.length + 1);
      next.set(prev);
      next[prev.length] = entry[0];
      dict.push(next);
    }
    prev = entry;
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

async function inflate(src: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- reading

interface Ifd {
  get(tag: number): number[] | undefined;
  one(tag: number, fallback?: number): number;
}

function parseIfd(dv: DataView, le: boolean, offset: number): Ifd {
  const n = dv.getUint16(offset, le);
  const tags = new Map<number, number[]>();
  const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  for (let i = 0; i < n; i++) {
    const e = offset + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const count = dv.getUint32(e + 4, le);
    const size = SIZES[type] ?? 1;
    const at = size * count <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    if (at + size * count > dv.byteLength || count > 1e7) continue;
    const vals: number[] = [];
    for (let k = 0; k < count; k++) {
      const p = at + k * size;
      if (type === 3 || type === 8) vals.push(dv.getUint16(p, le));
      else if (type === 4 || type === 9) vals.push(dv.getUint32(p, le));
      else if (type === 5) vals.push(dv.getUint32(p, le) / (dv.getUint32(p + 4, le) || 1));
      else vals.push(dv.getUint8(p));
    }
    tags.set(tag, vals);
  }
  return {
    get: (t) => tags.get(t),
    one: (t, f = 0) => tags.get(t)?.[0] ?? f,
  };
}

export async function decodeTiff(buffer: ArrayBuffer): Promise<RasterRGBA> {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('Not a TIFF file');
  const le = order === 'II';
  if (dv.getUint16(2, le) !== 42) throw new Error('Unsupported TIFF (BigTIFF?)');
  const ifd = parseIfd(dv, le, dv.getUint32(4, le));
  const width = ifd.one(256);
  const height = ifd.one(257);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) throw new Error('Unsupported TIFF size');
  const bps = ifd.one(258, 1);
  const spp = ifd.one(277, 1);
  const compression = ifd.one(259, 1);
  const photometric = ifd.one(262, 2);
  const planar = ifd.one(284, 1);
  const predictor = ifd.one(317, 1);
  const extra = ifd.get(338)?.[0];
  if (bps !== 8 && bps !== 16) throw new Error(`${bps}-bit TIFFs are not supported`);
  if (planar !== 1) throw new Error('Planar TIFFs are not supported');
  const bpp = (bps / 8) * spp;

  // Strips or tiles, each decompressed into a tile-sized block
  const tiled = !!ifd.get(322);
  const tw = tiled ? ifd.one(322) : width;
  const th = tiled ? ifd.one(323) : ifd.one(278, height);
  const offsets = ifd.get(tiled ? 324 : 273) ?? [];
  const counts = ifd.get(tiled ? 325 : 279) ?? [];
  const across = Math.ceil(width / tw);
  const raw = new Uint8Array(width * height * bpp);
  for (let s = 0; s < offsets.length; s++) {
    const src = bytes.subarray(offsets[s], offsets[s] + (counts[s] ?? 0));
    const blockRows = Math.min(th, height - Math.floor(s / across) * th);
    const expected = tw * (tiled ? th : blockRows) * bpp;
    let block: Uint8Array;
    if (compression === 1) block = src;
    else if (compression === 32773) block = packbits(src, expected);
    else if (compression === 5) block = lzw(src, expected);
    else if (compression === 8 || compression === 32946) block = await inflate(src);
    else throw new Error(`TIFF compression ${compression} is not supported`);
    const rowBytes = tw * bpp;
    if (predictor === 2) {
      for (let r = 0; r < (tiled ? th : blockRows); r++) {
        const base = r * rowBytes;
        if (bps === 8) for (let i = bpp; i < rowBytes; i++) block[base + i] = (block[base + i] + block[base + i - bpp]) & 255;
        else {
          // 16-bit horizontal differencing works on whole samples
          const rd = (i: number) => (le ? block[base + i] | (block[base + i + 1] << 8) : (block[base + i] << 8) | block[base + i + 1]);
          const wr = (i: number, v: number) => { if (le) { block[base + i] = v & 255; block[base + i + 1] = v >> 8; } else { block[base + i] = v >> 8; block[base + i + 1] = v & 255; } };
          for (let i = bpp; i < rowBytes; i += 2) wr(i, (rd(i) + rd(i - bpp)) & 0xffff);
        }
      }
    }
    const bx = tiled ? (s % across) * tw : 0;
    const by = tiled ? Math.floor(s / across) * th : s * th;
    for (let r = 0; r < (tiled ? th : blockRows); r++) {
      const y = by + r;
      if (y >= height) break;
      const n = Math.min(tw, width - bx) * bpp;
      raw.set(block.subarray(r * rowBytes, r * rowBytes + n), (y * width + bx) * bpp);
    }
  }

  // To 8-bit RGBA
  const out = new Uint8ClampedArray(width * height * 4);
  const sample = (i: number): number => (bps === 16 ? (le ? raw[i * 2 + 1] : raw[i * 2]) : raw[i]);
  const palette = ifd.get(320);
  for (let p = 0; p < width * height; p++) {
    const b = p * spp;
    const o = p * 4;
    let r: number, g: number, bl: number, a = 255;
    if (photometric === 0 || photometric === 1) {
      let v = sample(b);
      if (photometric === 0) v = 255 - v;
      r = g = bl = v;
      if (spp > 1) a = sample(b + 1);
    } else if (photometric === 3 && palette) {
      const idx = sample(b);
      const n = palette.length / 3;
      r = palette[idx] >> 8;
      g = palette[n + idx] >> 8;
      bl = palette[2 * n + idx] >> 8;
    } else if (photometric === 5) {
      const c = sample(b), m = sample(b + 1), y = sample(b + 2), k = spp > 3 ? sample(b + 3) : 0;
      r = (255 - c) * (255 - k) / 255;
      g = (255 - m) * (255 - k) / 255;
      bl = (255 - y) * (255 - k) / 255;
      if (spp > 4) a = sample(b + 4);
    } else {
      r = sample(b);
      g = sample(b + 1);
      bl = sample(b + 2);
      if (spp > 3) a = sample(b + 3);
      // Associated (premultiplied) alpha
      if (spp > 3 && extra === 1 && a > 0 && a < 255) {
        r = (r * 255) / a;
        g = (g * 255) / a;
        bl = (bl * 255) / a;
      }
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = bl;
    out[o + 3] = a;
  }
  // Full 16-bit samples for gray and RGB(A)
  let data16: Uint16Array | undefined;
  if (bps === 16 && (photometric === 0 || photometric === 1 || photometric === 2)) {
    data16 = new Uint16Array(width * height * 4);
    const s16 = (i: number) => (le ? raw[i * 2] | (raw[i * 2 + 1] << 8) : (raw[i * 2] << 8) | raw[i * 2 + 1]);
    for (let p = 0; p < width * height; p++) {
      const b = p * spp, o = p * 4;
      if (photometric !== 2) {
        let v = s16(b);
        if (photometric === 0) v = 65535 - v;
        data16[o] = data16[o + 1] = data16[o + 2] = v;
        data16[o + 3] = spp > 1 ? s16(b + 1) : 65535;
      } else {
        let r = s16(b), g = s16(b + 1), bl = s16(b + 2);
        const a = spp > 3 ? s16(b + 3) : 65535;
        if (spp > 3 && extra === 1 && a > 0 && a < 65535) {
          r = Math.round((r * 65535) / a);
          g = Math.round((g * 65535) / a);
          bl = Math.round((bl * 65535) / a);
        }
        data16[o] = Math.min(65535, r); data16[o + 1] = Math.min(65535, g); data16[o + 2] = Math.min(65535, bl); data16[o + 3] = a;
      }
    }
  }
  const iccTag = ifd.get(34675);
  return { width, height, data: out, data16, icc: iccTag && iccTag.length > 128 ? Uint8Array.from(iccTag) : undefined };
}

/** Uncompressed RGBA 16-bit TIFF (unassociated alpha), little endian. */
export function encodeTiff16(width: number, height: number, data: Uint16Array, dpi = 72, icc?: Uint8Array): Uint8Array {
  const tags: [number, number, number, number[]][] = [
    [256, 4, 1, [width]], [257, 4, 1, [height]], [258, 3, 4, [16, 16, 16, 16]], [259, 3, 1, [1]], [262, 3, 1, [2]],
    [273, 4, 1, [0]], [277, 3, 1, [4]], [278, 4, 1, [height]], [279, 4, 1, [data.length * 2]],
    [282, 5, 1, [dpi]], [283, 5, 1, [dpi]], [284, 3, 1, [1]], [296, 3, 1, [2]], [338, 3, 1, [2]],
  ];
  if (icc) tags.push([34675, 7, icc.length, [0]]); // ICC profile, stored after the pixels
  const ifdSize = 2 + tags.length * 12 + 4;
  const extraAt = 8 + ifdSize, dataAt = extraAt + 8 + 16;
  const iccAt = dataAt + data.length * 2;
  const buf = new ArrayBuffer(iccAt + (icc ? icc.length : 0));
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8[0] = u8[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, tags.length, true);
  let extra = extraAt;
  tags.forEach(([tag, type, count, vals], k) => {
    const e = 10 + k * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, count, true);
    if (tag === 273) dv.setUint32(e + 8, dataAt, true);
    else if (tag === 34675) dv.setUint32(e + 8, iccAt, true);
    else if (type === 5) {
      dv.setUint32(e + 8, extra, true);
      dv.setUint32(extra, vals[0], true);
      dv.setUint32(extra + 4, 1, true);
      extra += 8;
    } else if (count === 4 && type === 3) {
      dv.setUint32(e + 8, extra, true);
      vals.forEach((v, i) => dv.setUint16(extra + i * 2, v, true));
      extra += 8;
    } else if (type === 3) dv.setUint16(e + 8, vals[0], true);
    else dv.setUint32(e + 8, vals[0], true);
  });
  dv.setUint32(10 + tags.length * 12, 0, true);
  for (let i = 0; i < data.length; i++) dv.setUint16(dataAt + i * 2, data[i], true);
  if (icc) u8.set(icc, iccAt);
  return u8;
}

// ---------------------------------------------------------------- writing

/**
 * Uncompressed baseline TIFF. `cmyk` writes a print-ready separated image (colour-managed
 * separation; alpha is flattened onto white); otherwise RGBA with unassociated alpha.
 * `icc` embeds the profile (tag 34675) in RGB files; CMYK files never carry it — the working
 * profile is RGB and would mis-tag the separation (a CMYK profile is still open).
 */
export function encodeTiff(img: RasterRGBA, opts: { cmyk?: boolean; dpi?: number; icc?: Uint8Array } = {}): Uint8Array {
  const { width: w, height: h, data } = img;
  const cmyk = !!opts.cmyk;
  const icc = cmyk ? undefined : opts.icc;
  const spp = 4;
  const pixels = new Uint8Array(w * h * spp);
  // Separation is costly: cache per colour
  const cache = new Map<number, [number, number, number, number]>();
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (cmyk) {
      const a = data[i + 3] / 255;
      const r = Math.round(data[i] * a + 255 * (1 - a));
      const g = Math.round(data[i + 1] * a + 255 * (1 - a));
      const b = Math.round(data[i + 2] * a + 255 * (1 - a));
      const key = (r << 16) | (g << 8) | b;
      let s = cache.get(key);
      if (!s) {
        s = separate([r, g, b]);
        if (cache.size < 200000) cache.set(key, s);
      }
      for (let k = 0; k < 4; k++) pixels[i + k] = Math.round((s[k] / 100) * 255);
    } else {
      pixels.set(data.subarray(i, i + 4), i);
    }
  }
  const dpi = opts.dpi ?? 72;
  const tags: [number, number, number, number[]][] = [
    // tag, type, count, values
    [256, 4, 1, [w]],
    [257, 4, 1, [h]],
    [258, 3, 4, [8, 8, 8, 8]],
    [259, 3, 1, [1]],
    [262, 3, 1, [cmyk ? 5 : 2]],
    [273, 4, 1, [0]], // strip offset, patched below
    [277, 3, 1, [spp]],
    [278, 4, 1, [h]],
    [279, 4, 1, [pixels.length]],
    [282, 5, 1, [dpi]],
    [283, 5, 1, [dpi]],
    [284, 3, 1, [1]],
    [296, 3, 1, [2]],
  ];
  if (cmyk) tags.push([332, 3, 1, [1]]);
  else tags.push([338, 3, 1, [2]]);
  tags.sort((a, b) => a[0] - b[0]);
  if (icc) tags.push([34675, 7, icc.length, [0]]); // ICC profile, stored after the pixels
  const ifdSize = 2 + tags.length * 12 + 4;
  const extraAt = 8 + ifdSize;
  // Out-of-line values: BitsPerSample (8 bytes) and the two rationals (16 bytes)
  const extraSize = 8 + 16;
  const dataAt = extraAt + extraSize;
  const iccAt = dataAt + pixels.length;
  const buf = new ArrayBuffer(iccAt + (icc ? icc.length : 0));
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8[0] = 0x49;
  u8[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, tags.length, true);
  let extra = extraAt;
  tags.forEach(([tag, type, count, vals], k) => {
    const e = 10 + k * 12;
    dv.setUint16(e, tag, true);
    dv.setUint16(e + 2, type, true);
    dv.setUint32(e + 4, count, true);
    if (tag === 273) dv.setUint32(e + 8, dataAt, true);
    else if (tag === 34675) dv.setUint32(e + 8, iccAt, true);
    else if (type === 5) {
      dv.setUint32(e + 8, extra, true);
      dv.setUint32(extra, Math.round(vals[0] * 1000), true);
      dv.setUint32(extra + 4, 1000, true);
      extra += 8;
    } else if (count * (type === 3 ? 2 : 4) > 4) {
      dv.setUint32(e + 8, extra, true);
      vals.forEach((v, j) => dv.setUint16(extra + j * 2, v, true));
      extra += 8;
    } else if (type === 3) dv.setUint16(e + 8, vals[0], true);
    else dv.setUint32(e + 8, vals[0], true);
  });
  dv.setUint32(10 + tags.length * 12, 0, true);
  u8.set(pixels, dataAt);
  if (icc) u8.set(icc, iccAt);
  return u8;
}
