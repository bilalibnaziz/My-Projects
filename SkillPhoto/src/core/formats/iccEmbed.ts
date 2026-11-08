// Puts an ICC profile into an encoded PNG (iCCP chunk), JPEG (APP2 ICC_PROFILE segments) or
// WebP (ICCP chunk), so other apps show the colours as they look here. Files that already carry a profile are left alone.
import { readJpegIcc, readPngIcc, readWebpIcc } from '../icc';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

async function deflate(data: Uint8Array) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

async function embedPng(png: Uint8Array, icc: Uint8Array, name: string): Promise<Uint8Array> {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8;
  let done = false;
  while (p + 8 <= png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const chunk = png.subarray(p, p + 12 + len);
    // sRGB / gAMA / cHRM describe colour another way and must not sit next to an iCCP
    if (type !== 'sRGB' && type !== 'gAMA' && type !== 'cHRM') parts.push(chunk);
    if (type === 'IHDR' && !done) {
      const nm = new TextEncoder().encode(name.replace(/[^\x20-\x7e]/g, '').slice(0, 79) || 'ICC');
      const z = await deflate(icc);
      const body = new Uint8Array(4 + nm.length + 2 + z.length);
      body.set([0x69, 0x43, 0x43, 0x50], 0); // "iCCP"
      body.set(nm, 4);
      body.set(z, 4 + nm.length + 2);
      const c = new Uint8Array(12 + body.length - 4);
      const cv = new DataView(c.buffer);
      cv.setUint32(0, body.length - 4);
      c.set(body, 4);
      cv.setUint32(c.length - 4, crc32(body));
      parts.push(c);
      done = true;
    }
    p += 12 + len;
  }
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

function embedJpeg(jpg: Uint8Array, icc: Uint8Array): Uint8Array {
  // ICC_PROFILE segments of up to 65519 bytes each, after SOI (and after JFIF APP0 when present)
  const max = 65519;
  const n = Math.ceil(icc.length / max);
  const segs: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const part = icc.subarray(i * max, Math.min(icc.length, (i + 1) * max));
    const s = new Uint8Array(4 + 14 + part.length);
    const len = 2 + 14 + part.length;
    s.set([0xff, 0xe2, len >> 8, len & 255], 0);
    s.set([...'ICC_PROFILE'].map((c) => c.charCodeAt(0)), 4);
    s.set([0, i + 1, n], 15);
    s.set(part, 18);
    segs.push(s);
  }
  let at = 2;
  if (jpg[2] === 0xff && jpg[3] === 0xe0) at = 4 + ((jpg[4] << 8) | jpg[5]);
  const out = new Uint8Array(jpg.length + segs.reduce((a, s) => a + s.length, 0));
  out.set(jpg.subarray(0, at), 0);
  let o = at;
  for (const s of segs) { out.set(s, o); o += s.length; }
  out.set(jpg.subarray(at), o);
  return out;
}

function embedWebp(webp: Uint8Array, icc: Uint8Array): Uint8Array {
  // Not a WebP at all: leave it alone rather than writing a bogus chunk into it.
  if (webp.length < 12 || String.fromCharCode(webp[0], webp[1], webp[2], webp[3]) !== 'RIFF' || String.fromCharCode(webp[8], webp[9], webp[10], webp[11]) !== 'WEBP') return webp;
  // ICCP chunk: tag + little-endian size + profile, padded to an even length (pad byte is 0).
  const chunk = new Uint8Array(8 + icc.length + (icc.length % 2));
  chunk.set([0x49, 0x43, 0x43, 0x50], 0); // "ICCP"
  new DataView(chunk.buffer).setUint32(4, icc.length, true);
  chunk.set(icc, 8);
  // After VP8X when present (its ICC flag is set too), else straight after the RIFF header.
  // The ICCP chunk must come before the image data, so both spots are before VP8 / VP8L.
  let at = 12;
  let vp8x = -1;
  if (webp.length >= 20 && String.fromCharCode(webp[12], webp[13], webp[14], webp[15]) === 'VP8X') vp8x = 12;
  if (vp8x >= 0) {
    const size = webp[16] | (webp[17] << 8) | (webp[18] << 16) | (webp[19] << 24);
    at = vp8x + 8 + size + (size % 2);
    if (size < 0 || at > webp.length) at = 12; // corrupt VP8X size: fall back to the header
  }
  const out = new Uint8Array(webp.length + chunk.length);
  out.set(webp.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(webp.subarray(at), at + chunk.length);
  new DataView(out.buffer).setUint32(4, out.length - 8, true); // RIFF size = file size - 8
  if (vp8x >= 0 && at !== 12) out[vp8x + 8] |= 0x20; // VP8X flags: ICC profile present
  return out;
}

/** The file with `icc` embedded (unchanged when it already has a profile, or isn't PNG / JPEG / WebP). */
export async function embedProfile(blob: Blob, icc: Uint8Array, name: string): Promise<Blob> {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (blob.type === 'image/png') {
    if (await readPngIcc(b).catch(() => null)) return blob;
    return new Blob([(await embedPng(b, icc, name)) as BlobPart], { type: 'image/png' });
  }
  if (blob.type === 'image/jpeg') {
    if (readJpegIcc(b)) return blob;
    return new Blob([embedJpeg(b, icc) as BlobPart], { type: 'image/jpeg' });
  }
  if (blob.type === 'image/webp') {
    if (readWebpIcc(b)) return blob;
    return new Blob([embedWebp(b, icc) as BlobPart], { type: 'image/webp' });
  }
  return blob;
}
