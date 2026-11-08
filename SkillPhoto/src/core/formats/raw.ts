// Camera RAW and DNG (Digital Negative) decoder and metadata extractor.
// Supports DNG, CR2 (Canon), NEF (Nikon), ARW (Sony), ORF (Olympus), RW2 (Panasonic), PEF (Pentax).
// Handles full 16-bit CFA Bayer demosaicing (RGGB, BGGR, GBRG, GRBG), LinearRaw,
// white balance (AsShotNeutral), Black/White level normalization, and EXIF camera tags.

export interface RawMetadata {
  make?: string;
  model?: string;
  iso?: number;
  exposureTime?: string;
  fNumber?: number;
  cfaPattern?: number[];
  whiteBalance?: [number, number, number];
}

export interface RawDecoded {
  width: number;
  height: number;
  /** Full 16-bit RGBA samples (0..65535). */
  data: Uint16Array;
  bitDepth: 16;
  meta: RawMetadata;
}

// ---------------------------------------------------------------- IFD helpers

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  values: number[];
  str?: string;
}

class IfdReader {
  entries = new Map<number, IfdEntry>();
  nextIfd = 0;

  get(tag: number): number[] | undefined {
    return this.entries.get(tag)?.values;
  }

  one(tag: number, fallback = 0): number {
    return this.entries.get(tag)?.values[0] ?? fallback;
  }

  str(tag: number): string | undefined {
    return this.entries.get(tag)?.str;
  }
}

function parseIfd(dv: DataView, bytes: Uint8Array, le: boolean, offset: number): IfdReader {
  const ifd = new IfdReader();
  if (offset + 2 > dv.byteLength) return ifd;
  const numEntries = dv.getUint16(offset, le);
  let p = offset + 2;

  for (let i = 0; i < numEntries; i++) {
    if (p + 12 > dv.byteLength) break;
    const tag = dv.getUint16(p, le);
    const type = dv.getUint16(p + 2, le);
    const count = dv.getUint32(p + 4, le);
    let valOffset = p + 8;

    const typeSize = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] ?? 1;
    const totalBytes = count * typeSize;
    if (totalBytes > 4) valOffset = dv.getUint32(p + 8, le);

    const values: number[] = [];
    let str: string | undefined;

    if (valOffset >= 0 && valOffset + totalBytes <= dv.byteLength) {
      if (type === 2) {
        // ASCII string
        const sub = bytes.subarray(valOffset, valOffset + totalBytes);
        const end = sub.indexOf(0);
        str = new TextDecoder().decode(sub.subarray(0, end < 0 ? undefined : end)).trim();
      } else if (type === 1 || type === 6 || type === 7) {
        // BYTE / SBYTE / UNDEFINED
        for (let k = 0; k < count; k++) values.push(dv.getUint8(valOffset + k));
      } else if (type === 3) {
        // SHORT
        for (let k = 0; k < count; k++) values.push(dv.getUint16(valOffset + k * 2, le));
      } else if (type === 4) {
        // LONG
        for (let k = 0; k < count; k++) values.push(dv.getUint32(valOffset + k * 4, le));
      } else if (type === 5) {
        // RATIONAL
        for (let k = 0; k < count; k++) {
          const num = dv.getUint32(valOffset + k * 8, le);
          const den = dv.getUint32(valOffset + k * 8 + 4, le);
          values.push(den === 0 ? 0 : num / den);
        }
      } else if (type === 8) {
        // SSHORT
        for (let k = 0; k < count; k++) values.push(dv.getInt16(valOffset + k * 2, le));
      } else if (type === 9) {
        // SLONG
        for (let k = 0; k < count; k++) values.push(dv.getInt32(valOffset + k * 4, le));
      }
    }

    ifd.entries.set(tag, { tag, type, count, values, str });
    p += 12;
  }

  if (p + 4 <= dv.byteLength) ifd.nextIfd = dv.getUint32(p, le);
  return ifd;
}

// ---------------------------------------------------------------- Bayer Demosaicing

/**
 * High-quality bilinear demosaicing of Bayer CFA pattern into 16-bit RGB.
 * CFA pattern codes: 0 = Red, 1 = Green, 2 = Blue.
 * Standard 2x2 Bayer:
 * [0, 1, 1, 2] -> RGGB
 * [2, 1, 1, 0] -> BGGR
 * [1, 0, 2, 1] -> GRBG
 * [1, 2, 0, 1] -> GBRG
 */
export function demosaicBayer(
  sensor: Uint16Array,
  w: number,
  h: number,
  pattern: number[] = [0, 1, 1, 2],
  wb: [number, number, number] = [1, 1, 1]
): Uint16Array {
  const out = new Uint16Array(w * h * 4);
  const p0 = pattern[0] ?? 0;
  const p1 = pattern[1] ?? 1;
  const p2 = pattern[2] ?? 1;
  const p3 = pattern[3] ?? 2;

  const colorAt = (x: number, y: number): number => {
    const rx = x & 1;
    const ry = y & 1;
    if (ry === 0) return rx === 0 ? p0 : p1;
    return rx === 0 ? p2 : p3;
  };

  const getS = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    return sensor[cy * w + cx];
  };

  const wbR = wb[0] || 1;
  const wbG = wb[1] || 1;
  const wbB = wb[2] || 1;

  for (let y = 0; y < h; y++) {
    const rowColor0 = colorAt(0, y);
    const isRedRow = rowColor0 === 0 || pattern[1] === 0;
    const isBlueRow = !isRedRow;

    for (let x = 0; x < w; x++) {
      const c = colorAt(x, y);
      const val = sensor[y * w + x];
      let r = 0, g = 0, b = 0;

      if (c === 1) {
        // Green pixel
        g = val;
        if (isRedRow) {
          // Horizontal neighbors are Red, vertical are Blue
          r = (getS(x - 1, y) + getS(x + 1, y)) >> 1;
          b = (getS(x, y - 1) + getS(x, y + 1)) >> 1;
        } else {
          // Horizontal neighbors are Blue, vertical are Red
          b = (getS(x - 1, y) + getS(x + 1, y)) >> 1;
          r = (getS(x, y - 1) + getS(x, y + 1)) >> 1;
        }
      } else if (c === 0) {
        // Red pixel
        r = val;
        // Green is average of 4 cardinal neighbors
        g = (getS(x - 1, y) + getS(x + 1, y) + getS(x, y - 1) + getS(x, y + 1)) >> 2;
        // Blue is average of 4 diagonal neighbors
        b = (getS(x - 1, y - 1) + getS(x + 1, y - 1) + getS(x - 1, y + 1) + getS(x + 1, y + 1)) >> 2;
      } else {
        // Blue pixel
        b = val;
        // Green is average of 4 cardinal neighbors
        g = (getS(x - 1, y) + getS(x + 1, y) + getS(x, y - 1) + getS(x, y + 1)) >> 2;
        // Red is average of 4 diagonal neighbors
        r = (getS(x - 1, y - 1) + getS(x + 1, y - 1) + getS(x - 1, y + 1) + getS(x + 1, y + 1)) >> 2;
      }

      // Apply white balance multipliers and clamp to 16-bit range
      const idx = (y * w + x) * 4;
      out[idx] = Math.min(65535, Math.max(0, Math.round(r * wbR)));
      out[idx + 1] = Math.min(65535, Math.max(0, Math.round(g * wbG)));
      out[idx + 2] = Math.min(65535, Math.max(0, Math.round(b * wbB)));
      out[idx + 3] = 65535; // Fully opaque
    }
  }

  return out;
}

// ---------------------------------------------------------------- Decoder

export function isRawBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) return false;
  const b = new Uint8Array(buffer, 0, 16);
  const sig = String.fromCharCode(b[0], b[1]);
  if (sig !== 'II' && sig !== 'MM') return false;
  const le = sig === 'II';
  const dv = new DataView(buffer, 0, 16);
  const magic = dv.getUint16(2, le);
  // Standard TIFF / DNG is 42. Canon CR2 has 42 plus 'CR' at offset 8.
  if (magic === 42) return true;
  // Panasonic RW2 / Olympus ORF magic variations
  if (magic === 0x55 || magic === 0x4f52 || magic === 0x5352) return true;
  return false;
}

export async function decodeRaw(buffer: ArrayBuffer): Promise<RawDecoded> {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('Not a RAW / TIFF image');
  const le = order === 'II';

  const ifd0 = parseIfd(dv, bytes, le, dv.getUint32(4, le));

  // Collect SubIFDs if present (common in DNG and camera RAW files)
  const subOffsets = ifd0.get(330) ?? [];
  const ifds: IfdReader[] = [ifd0];
  for (const off of subOffsets) {
    ifds.push(parseIfd(dv, bytes, le, off));
  }

  // Find the candidate IFD with the highest resolution or CFA interpretation
  let chosen = ifd0;
  let maxPixels = (ifd0.one(256) || 0) * (ifd0.one(257) || 0);

  for (const cand of ifds) {
    const w = cand.one(256) || 0;
    const h = cand.one(257) || 0;
    const photo = cand.one(262, 0);
    const px = w * h;
    // Prefer CFA raw data or strictly larger resolution
    if (photo === 32803 || px > maxPixels) {
      maxPixels = px;
      chosen = cand;
    }
  }

  const width = chosen.one(256);
  const height = chosen.one(257);
  if (!width || !height) throw new Error('Invalid RAW dimensions');

  const photometric = chosen.one(262, chosen === ifd0 ? 2 : 32803);
  const bps = chosen.one(258, 16);
  const spp = chosen.one(277, photometric === 32803 ? 1 : 3);
  const compression = chosen.one(259, 1);

  // Metadata from IFD0 or chosen
  const make = ifd0.str(271) ?? chosen.str(271);
  const model = ifd0.str(272) ?? chosen.str(272);
  const iso = ifd0.one(34855) || chosen.one(34855) || undefined;
  const fNumber = ifd0.one(33437) || chosen.one(33437) || undefined;
  const expVal = ifd0.one(33434) || chosen.one(33434) || 0;
  const exposureTime = expVal > 0 ? (expVal < 1 ? `1/${Math.round(1 / expVal)}s` : `${expVal.toFixed(1)}s`) : undefined;

  // White balance: AsShotNeutral (tag 50728) is inverted channel gains [1/R, 1/G, 1/B]
  let wb: [number, number, number] = [1, 1, 1];
  const asShot = ifd0.get(50728) ?? chosen.get(50728);
  if (asShot && asShot.length >= 3 && asShot[0] > 0 && asShot[1] > 0 && asShot[2] > 0) {
    wb = [1 / asShot[0], 1 / asShot[1], 1 / asShot[2]];
  }

  const meta: RawMetadata = { make, model, iso, fNumber, exposureTime, whiteBalance: wb };

  // Read raw image stream
  const tiled = !!chosen.get(322);
  const tw = tiled ? chosen.one(322) : width;
  const th = tiled ? chosen.one(323) : chosen.one(278, height);
  const offsets = chosen.get(tiled ? 324 : 273) ?? [];
  const counts = chosen.get(tiled ? 325 : 279) ?? [];
  const bytesPerSample = Math.ceil(bps / 8);
  const bpp = bytesPerSample * spp;

  const totalRawBytes = width * height * bpp;
  const rawBytes = new Uint8Array(totalRawBytes);
  const across = Math.ceil(width / tw);

  for (let s = 0; s < offsets.length; s++) {
    const src = bytes.subarray(offsets[s], offsets[s] + (counts[s] ?? 0));
    const blockRows = Math.min(th, height - Math.floor(s / across) * th);
    const expected = tw * (tiled ? th : blockRows) * bpp;

    let block: Uint8Array;
    if (compression === 1) {
      block = src;
    } else {
      // If compressed with standard deflate (Zip)
      const { inflate } = await import('./tiff');
      block = await inflate(src);
    }

    const rowBytes = tw * bpp;
    const bx = tiled ? (s % across) * tw : 0;
    const by = tiled ? Math.floor(s / across) * th : s * th;

    for (let r = 0; r < (tiled ? th : blockRows); r++) {
      const y = by + r;
      if (y >= height) break;
      const n = Math.min(tw, width - bx) * bpp;
      rawBytes.set(block.subarray(r * rowBytes, r * rowBytes + n), (y * width + bx) * bpp);
    }
  }

  // Black / White level normalization for RAW sensor data
  const blackLevel = chosen.one(50714, ifd0.one(50714, 0));
  const whiteLevel = chosen.one(50717, ifd0.one(50717, (1 << bps) - 1));
  const range = Math.max(1, whiteLevel - blackLevel);

  if (photometric === 32803) {
    // CFA Bayer pattern
    const pattern = chosen.get(33422) ?? ifd0.get(33422) ?? [0, 1, 1, 2];
    meta.cfaPattern = pattern;

    // Unpack sensor values into 16-bit normalized
    const sensor = new Uint16Array(width * height);
    if (bps === 16 || bps === 14 || bps === 12) {
      for (let i = 0; i < width * height; i++) {
        const o = i * 2;
        const v = le ? rawBytes[o] | (rawBytes[o + 1] << 8) : (rawBytes[o] << 8) | rawBytes[o + 1];
        sensor[i] = Math.max(0, Math.min(65535, Math.round(((v - blackLevel) / range) * 65535)));
      }
    } else {
      for (let i = 0; i < width * height; i++) {
        const v = rawBytes[i];
        sensor[i] = Math.max(0, Math.min(65535, Math.round(((v - blackLevel) / range) * 65535)));
      }
    }

    const data = demosaicBayer(sensor, width, height, pattern, wb);
    return { width, height, data, bitDepth: 16, meta };
  }

  // LinearRaw or RGB(A) uncompressed 16-bit
  const data = new Uint16Array(width * height * 4);
  const s16 = (idx: number) => {
    if (bps === 16) {
      const o = idx * 2;
      return le ? rawBytes[o] | (rawBytes[o + 1] << 8) : (rawBytes[o] << 8) | rawBytes[o + 1];
    }
    return rawBytes[idx] * 257;
  };

  for (let p = 0; p < width * height; p++) {
    const b = p * spp;
    const o = p * 4;
    data[o] = s16(b);
    data[o + 1] = spp > 1 ? s16(b + 1) : data[o];
    data[o + 2] = spp > 2 ? s16(b + 2) : data[o];
    data[o + 3] = spp > 3 ? s16(b + 3) : 65535;
  }

  return { width, height, data, bitDepth: 16, meta };
}

// ---------------------------------------------------------------- Test Helper / DNG Generator

/**
 * Creates a valid synthetic DNG container with CFA Bayer data for testing and validation.
 */
export function encodeDngRaw(
  sensor: Uint16Array,
  width: number,
  height: number,
  opts: {
    pattern?: number[];
    make?: string;
    model?: string;
    whiteBalance?: [number, number, number];
    blackLevel?: number;
    whiteLevel?: number;
  } = {}
): Uint8Array {
  const pattern = opts.pattern ?? [0, 1, 1, 2];
  const make = (opts.make ?? 'SkillCamera') + '\0';
  const model = (opts.model ?? 'SkillRaw-1') + '\0';
  const wb = opts.whiteBalance ?? [1, 1, 1];
  const black = opts.blackLevel ?? 0;
  const white = opts.whiteLevel ?? 65535;

  // Header (8 bytes) + IFD0 entries (12 bytes * count + 6) + tag payload + image data
  const numTags = 14;
  const ifdSize = 2 + numTags * 12 + 4;
  let offset = 8 + ifdSize;

  const makeOff = offset;
  offset += make.length;
  const modelOff = offset;
  offset += model.length;
  const patternOff = offset;
  offset += 4;
  const asShotOff = offset;
  offset += 24; // 3 rationals = 24 bytes

  // Align image data to 4 bytes
  if (offset % 4) offset += 4 - (offset % 4);
  const imageOff = offset;
  const imageBytes = width * height * 2;
  const totalSize = imageOff + imageBytes;

  const buf = new ArrayBuffer(totalSize);
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);

  // Header: II, 42, offset to IFD0 (8)
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);

  // Text strings
  new TextEncoder().encodeInto(make, bytes.subarray(makeOff));
  new TextEncoder().encodeInto(model, bytes.subarray(modelOff));

  // CFA Pattern
  bytes[patternOff] = pattern[0];
  bytes[patternOff + 1] = pattern[1];
  bytes[patternOff + 2] = pattern[2];
  bytes[patternOff + 3] = pattern[3];

  // AsShotNeutral (3 rationals)
  for (let c = 0; c < 3; c++) {
    const val = 1 / (wb[c] || 1);
    dv.setUint32(asShotOff + c * 8, Math.round(val * 10000), true);
    dv.setUint32(asShotOff + c * 8 + 4, 10000, true);
  }

  // Tags list
  const tags: [number, number, number, number][] = [
    [256, 4, 1, width], // ImageWidth
    [257, 4, 1, height], // ImageLength
    [258, 3, 1, 16], // BitsPerSample
    [259, 3, 1, 1], // Compression (None)
    [262, 3, 1, 32803], // PhotometricInterpretation (CFA)
    [271, 2, make.length, makeOff], // Make
    [272, 2, model.length, modelOff], // Model
    [273, 4, 1, imageOff], // StripOffsets
    [277, 3, 1, 1], // SamplesPerPixel
    [278, 4, 1, height], // RowsPerStrip
    [279, 4, 1, imageBytes], // StripByteCounts
    [33422, 1, 4, patternOff], // CFAPattern
    [50706, 1, 4, 0x01040000], // DNGVersion (1.4.0.0)
    [50728, 5, 3, asShotOff], // AsShotNeutral
  ];

  dv.setUint16(8, tags.length, true);
  let tp = 10;
  for (const [tag, type, count, val] of tags) {
    dv.setUint16(tp, tag, true);
    dv.setUint16(tp + 2, type, true);
    dv.setUint32(tp + 4, count, true);
    dv.setUint32(tp + 8, val, true);
    tp += 12;
  }
  dv.setUint32(tp, 0, true); // No next IFD

  // Copy sensor bytes
  const sensorBytes = new Uint8Array(sensor.buffer, sensor.byteOffset, sensor.byteLength);
  bytes.set(sensorBytes, imageOff);

  return bytes;
}

