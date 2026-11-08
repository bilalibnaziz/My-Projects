// 16-bit PNG reading and writing (the browser decodes PNGs to 8 bits). Non-interlaced gray, gray+alpha, RGB and
// RGBA at 8 or 16 bits are read exactly; writing is RGBA 16-bit, optionally with an embedded ICC profile (iCCP).

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array, start = 0, end = b.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(data: Uint8Array, inflate: boolean): Promise<Uint8Array> {
  const s = inflate ? new DecompressionStream('deflate') : new CompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(s)).arrayBuffer());
}

export interface Png16 {
  width: number;
  height: number;
  /** Bits per channel in the file. */
  bitDepth: 8 | 16;
  /** RGBA, 0..65535 (8-bit files are scaled exactly: v × 257). */
  data: Uint16Array;
  /** Embedded ICC profile (inflated), if any. */
  icc?: Uint8Array;
}

/** Reads a PNG at full precision. Returns null for files this reader doesn't cover (palette, interlaced, < 8 bits). */
export async function decodePng16(bytes: Uint8Array): Promise<Png16 | null> {
  if (bytes.length < 33 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  let icc: Uint8Array | undefined;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'iCCP') {
      const nul = body.indexOf(0);
      try { icc = await zlib(body.subarray(nul + 2), true); } catch { /* ignore a broken profile */ }
    } else if (type === 'IEND') break;
    p += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || (bitDepth !== 8 && bitDepth !== 16) || interlace || !width || !height) return null;
  const all = new Uint8Array(idat.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of idat) { all.set(c, o); o += c.length; }
  const raw = await zlib(all, true);
  const bpp = (channels * bitDepth) / 8;
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is truncated');
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = (ch: number) => (bitDepth === 16 ? (cur[(x * channels + ch) * 2] << 8) | cur[(x * channels + ch) * 2 + 1] : cur[x * channels + ch] * 257);
      const d = (y * width + x) * 4;
      if (channels <= 2) {
        out[d] = out[d + 1] = out[d + 2] = s(0);
        out[d + 3] = channels === 2 ? s(1) : 65535;
      } else {
        out[d] = s(0); out[d + 1] = s(1); out[d + 2] = s(2);
        out[d + 3] = channels === 4 ? s(3) : 65535;
      }
    }
    prev.set(cur);
  }
  return { width, height, bitDepth: bitDepth as 8 | 16, data: out, icc };
}

/** Writes RGBA 16-bit (filter: Sub per row, a good default for photos). */
export async function encodePng16(width: number, height: number, data: Uint16Array, icc?: { name: string; bytes: Uint8Array }): Promise<Uint8Array> {
  const stride = width * 8;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1; // Sub
    for (let x = 0; x < width * 4; x++) {
      const v = data[y * width * 4 + x];
      const left = x >= 4 ? data[y * width * 4 + x - 4] : 0;
      raw[o + 1 + x * 2] = ((v >> 8) - (left >> 8)) & 255;
      raw[o + 2 + x * 2] = ((v & 255) - (left & 255)) & 255;
    }
  }
  const chunks: Uint8Array[] = [];
  const chunk = (type: string, body: Uint8Array) => {
    const c = new Uint8Array(12 + body.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(body, 8);
    dv.setUint32(8 + body.length, crc32(c, 4, 8 + body.length));
    chunks.push(c);
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr.set([16, 6, 0, 0, 0], 8);
  chunk('IHDR', ihdr);
  if (icc) {
    const name = new TextEncoder().encode(icc.name.replace(/[^\x20-\x7e]/g, '').slice(0, 79) || 'ICC');
    const z = await zlib(icc.bytes, false);
    const body = new Uint8Array(name.length + 2 + z.length);
    body.set(name, 0);
    body.set(z, name.length + 2);
    chunk('iCCP', body);
  }
  chunk('IDAT', await zlib(raw, false));
  chunk('IEND', new Uint8Array(0));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = new Uint8Array(8 + chunks.reduce((a, c) => a + c.length, 0));
  out.set(sig, 0);
  let o = 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
