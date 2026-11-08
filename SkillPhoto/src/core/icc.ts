// ICC colour profiles (v2 and v4), no dependencies. Shared module: keep identical in SkillPhoto and
// SkillVector.
//
// Reads the header and tags, evaluates device → PCS transforms for:
//   - matrix/TRC profiles (RGB: rXYZ/gXYZ/bXYZ + rTRC/gTRC/bTRC; gray: kTRC), curves as 'curv' or 'para';
//   - LUT profiles: A2B0/1/2 as 'mft1' (8-bit), 'mft2' (16-bit) or 'mAB ' (v4), with n-linear CLUT interpolation;
// and converts PCS (XYZ D50 or Lab D50) to sRGB and Lab for display and ΔE. Also finds profiles
// embedded in JPEG (APP2 ICC_PROFILE), PNG (iCCP) and WebP (ICCP chunk) files.

export type IccSpace = 'RGB' | 'CMYK' | 'GRAY' | 'LAB' | 'XYZ' | string;
export type Intent = 0 | 1 | 2 | 3; // perceptual, relative colorimetric, saturation, absolute colorimetric

export interface IccProfile {
  bytes: Uint8Array;
  version: number;
  deviceClass: string;
  colorSpace: IccSpace;
  pcs: 'XYZ' | 'LAB';
  channels: number;
  description: string;
  /** Media white point (XYZ). */
  white: [number, number, number];
  /** Device values (0..1 per channel) → PCS XYZ, D50, Y of white = 1. */
  toXyz(v: ArrayLike<number>, intent?: Intent): [number, number, number];
}

const D50: [number, number, number] = [0.9642, 1, 0.8249];

// ---------------------------------------------------------------- byte reading

class R {
  constructor(readonly b: Uint8Array) {}
  u8 = (o: number) => this.b[o];
  u16 = (o: number) => (this.b[o] << 8) | this.b[o + 1];
  u32 = (o: number) => ((this.b[o] << 24) >>> 0) + (this.b[o + 1] << 16) + (this.b[o + 2] << 8) + this.b[o + 3];
  s15 = (o: number) => ((this.u32(o) | 0) / 65536);
  sig = (o: number) => String.fromCharCode(this.b[o], this.b[o + 1], this.b[o + 2], this.b[o + 3]);
}

// ---------------------------------------------------------------- curves

type Curve = (x: number) => number;
const identity: Curve = (x) => x;

function table(t: ArrayLike<number>, max: number): Curve {
  const n = t.length;
  return (x) => {
    const p = Math.min(1, Math.max(0, x)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(p));
    const f = p - i;
    return (t[i] * (1 - f) + t[i + 1] * f) / max;
  };
}

/** A 'curv' or 'para' element at `o`; returns the curve and its byte length (padded to 4). */
function readCurve(r: R, o: number): { c: Curve; len: number } {
  const type = r.sig(o);
  if (type === 'curv') {
    const n = r.u32(o + 8);
    const len = 12 + n * 2;
    if (n === 0) return { c: identity, len: (len + 3) & ~3 };
    if (n === 1) {
      const g = r.u16(o + 12) / 256;
      return { c: (x) => Math.pow(Math.max(0, x), g), len: (len + 3) & ~3 };
    }
    const t = new Uint16Array(n);
    for (let i = 0; i < n; i++) t[i] = r.u16(o + 12 + i * 2);
    return { c: table(t, 65535), len: (len + 3) & ~3 };
  }
  if (type === 'para') {
    const fn = r.u16(o + 8);
    const np = [1, 3, 4, 5, 7][fn] ?? 1;
    const p = Array.from({ length: np }, (_, i) => r.s15(o + 12 + i * 4));
    const [g, a = 1, b = 0, c = 0, d = 0, e = 0, f = 0] = p;
    const pw = (x: number) => Math.pow(Math.max(0, x), g);
    const c0: Curve =
      fn === 0 ? (x) => pw(x)
      : fn === 1 ? (x) => (x >= -b / a ? pw(a * x + b) : 0)
      : fn === 2 ? (x) => (x >= -b / a ? pw(a * x + b) + c : c)
      : fn === 3 ? (x) => (x >= d ? pw(a * x + b) : c * x)
      : (x) => (x >= d ? pw(a * x + b) + e : c * x + f);
    return { c: c0, len: (12 + np * 4 + 3) & ~3 };
  }
  throw new Error(`Unsupported curve type '${type}'`);
}

// ---------------------------------------------------------------- CLUT (n-linear interpolation)

function clut(grid: number[], outCh: number, data: ArrayLike<number>, max: number) {
  const inCh = grid.length;
  // stride per input dimension (first input varies slowest)
  const stride: number[] = new Array(inCh);
  let s = outCh;
  for (let i = inCh - 1; i >= 0; i--) {
    stride[i] = s;
    s *= grid[i];
  }
  const out = new Float64Array(outCh);
  return (v: ArrayLike<number>): Float64Array => {
    out.fill(0);
    const base: number[] = [], frac: number[] = [];
    for (let i = 0; i < inCh; i++) {
      const p = Math.min(1, Math.max(0, v[i])) * (grid[i] - 1);
      const k = Math.min(grid[i] - 2, Math.floor(p));
      base[i] = Math.max(0, k);
      frac[i] = grid[i] > 1 ? p - base[i] : 0;
    }
    const corners = 1 << inCh;
    for (let c = 0; c < corners; c++) {
      let w = 1, idx = 0;
      for (let i = 0; i < inCh; i++) {
        const hi = (c >> (inCh - 1 - i)) & 1;
        w *= hi ? frac[i] : 1 - frac[i];
        idx += (base[i] + (grid[i] > 1 ? hi : 0)) * stride[i];
      }
      if (w === 0) continue;
      for (let o = 0; o < outCh; o++) out[o] += w * data[idx + o];
    }
    for (let o = 0; o < outCh; o++) out[o] /= max;
    return out;
  };
}

// ---------------------------------------------------------------- LUT tags → normalised PCS (0..1)

type Lut = { eval: (v: ArrayLike<number>) => number[]; kind: 'mft1' | 'mft2' | 'mAB' };

function readLut(r: R, o: number): Lut {
  const type = r.sig(o);
  if (type === 'mft1' || type === 'mft2') {
    const inCh = r.u8(o + 8), outCh = r.u8(o + 9), g = r.u8(o + 10);
    const wide = type === 'mft2';
    const inN = wide ? r.u16(o + 48) : 256, outN = wide ? r.u16(o + 50) : 256;
    let p = o + (wide ? 52 : 48);
    const sz = wide ? 2 : 1;
    const rd = wide ? r.u16 : r.u8;
    const max = wide ? 65535 : 255;
    const inT: Curve[] = [];
    for (let c = 0; c < inCh; c++) {
      const t = new Float64Array(inN);
      for (let i = 0; i < inN; i++) t[i] = rd(p + i * sz);
      inT.push(table(t, max));
      p += inN * sz;
    }
    const n = Math.pow(g, inCh) * outCh;
    const data = new Float64Array(n);
    for (let i = 0; i < n; i++) data[i] = rd(p + i * sz);
    p += n * sz;
    const lut = clut(new Array(inCh).fill(g), outCh, data, max);
    const outT: Curve[] = [];
    for (let c = 0; c < outCh; c++) {
      const t = new Float64Array(outN);
      for (let i = 0; i < outN; i++) t[i] = rd(p + i * sz);
      outT.push(table(t, max));
      p += outN * sz;
    }
    const tmp = new Float64Array(inCh);
    return {
      kind: type,
      eval: (v) => {
        for (let c = 0; c < inCh; c++) tmp[c] = inT[c](v[c]);
        const x = lut(tmp);
        return Array.from(x, (y, c) => outT[c](y));
      },
    };
  }
  if (type === 'mAB ') {
    const inCh = r.u8(o + 8), outCh = r.u8(o + 9);
    const offB = r.u32(o + 12), offMat = r.u32(o + 16), offM = r.u32(o + 20), offC = r.u32(o + 24), offA = r.u32(o + 28);
    const curves = (off: number, n: number) => {
      if (!off) return null;
      const cs: Curve[] = [];
      let p = o + off;
      for (let i = 0; i < n; i++) {
        const { c, len } = readCurve(r, p);
        cs.push(c);
        p += len;
      }
      return cs;
    };
    const A = curves(offA, inCh), M = curves(offM, outCh), B = curves(offB, outCh);
    let C: ((v: ArrayLike<number>) => Float64Array) | null = null;
    if (offC) {
      const p = o + offC;
      const grid = Array.from({ length: inCh }, (_, i) => r.u8(p + i));
      const prec = r.u8(p + 16);
      const n = grid.reduce((a, b) => a * b, 1) * outCh;
      const data = new Float64Array(n);
      for (let i = 0; i < n; i++) data[i] = prec === 1 ? r.u8(p + 20 + i) : r.u16(p + 20 + i * 2);
      C = clut(grid, outCh, data, prec === 1 ? 255 : 65535);
    }
    let mat: number[] | null = null;
    if (offMat) mat = Array.from({ length: 12 }, (_, i) => r.s15(o + offMat + i * 4));
    return {
      kind: 'mAB',
      eval: (v) => {
        let x: number[] = Array.from({ length: inCh }, (_, i) => (A ? A[i](v[i]) : v[i]));
        if (C) x = Array.from(C(x));
        if (M) x = x.map((y, i) => M[i](y));
        if (mat && x.length === 3) {
          const [a, b, c] = x;
          x = [mat[0] * a + mat[1] * b + mat[2] * c + mat[9], mat[3] * a + mat[4] * b + mat[5] * c + mat[10], mat[6] * a + mat[7] * b + mat[8] * c + mat[11]];
        }
        if (B) x = x.map((y, i) => B[i](y));
        return x;
      },
    };
  }
  throw new Error(`Unsupported LUT type '${type}'`);
}

// ---------------------------------------------------------------- colour maths

export function labToXyz([L, a, b]: [number, number, number], wp = D50): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
  return [wp[0] * inv(fx), wp[1] * inv(fy), wp[2] * inv(fz)];
}

export function xyzToLab([x, y, z]: [number, number, number], wp = D50): [number, number, number] {
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fx = f(x / wp[0]), fy = f(y / wp[1]), fz = f(z / wp[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// sRGB primaries adapted to D50 (Bradford), as in the ICC sRGB profile
const SRGB_TO_XYZ_D50 = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];
const XYZ_D50_TO_SRGB = [3.1338561, -1.6168667, -0.4906146, -0.9787684, 1.9161415, 0.033454, 0.0719453, -0.2289914, 1.4052427];
const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const dec = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** PCS XYZ (D50) → sRGB 0..255 (clipped). */
export function xyzD50ToSrgb([x, y, z]: [number, number, number]): [number, number, number] {
  const m = XYZ_D50_TO_SRGB;
  const lin = [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
  return lin.map((v) => Math.round(Math.max(0, Math.min(1, enc(Math.max(0, v)))) * 255)) as [number, number, number];
}

/** sRGB 0..255 → PCS XYZ (D50). */
export function srgbToXyzD50([r, g, b]: [number, number, number]): [number, number, number] {
  const m = SRGB_TO_XYZ_D50;
  const R = dec(r / 255), G = dec(g / 255), B = dec(b / 255);
  return [m[0] * R + m[1] * G + m[2] * B, m[3] * R + m[4] * G + m[5] * B, m[6] * R + m[7] * G + m[8] * B];
}

/** CIEDE2000 colour difference of two Lab colours. */
export function deltaE00(l1: [number, number, number], l2: [number, number, number]): number {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b: number, a: number) => { const t = Math.atan2(b, a) / rad; return t < 0 ? t + 360 : t; };
  const h1p = C1p === 0 ? 0 : h(b1, a1p), h2p = C2p === 0 ? 0 : h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hpm += h1p + h2p < 360 ? 360 : -360; hpm /= 2; }
  const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// ---------------------------------------------------------------- parsing

function textOf(r: R, o: number): string {
  const t = r.sig(o);
  if (t === 'desc') {
    const n = r.u32(o + 8);
    let s = '';
    for (let i = 0; i < n - 1 && i < 512; i++) s += String.fromCharCode(r.u8(o + 12 + i));
    return s;
  }
  if (t === 'mluc') {
    const count = r.u32(o + 8);
    if (!count) return '';
    const len = r.u32(o + 20), off = r.u32(o + 24);
    let s = '';
    for (let i = 0; i < len; i += 2) s += String.fromCharCode(r.u16(o + off + i));
    return s;
  }
  if (t === 'text') {
    let s = '';
    for (let i = o + 8; i < r.b.length && r.b[i]; i++) s += String.fromCharCode(r.b[i]);
    return s;
  }
  return '';
}

const SPACES: Record<string, IccSpace> = { 'RGB ': 'RGB', CMYK: 'CMYK', GRAY: 'GRAY', 'Lab ': 'LAB', 'XYZ ': 'XYZ' };
const CHANNELS: Record<string, number> = { RGB: 3, CMYK: 4, GRAY: 1, LAB: 3, XYZ: 3 };

export function parseIcc(input: ArrayBuffer | Uint8Array): IccProfile {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 132) throw new Error('Not an ICC profile (too short)');
  const r = new R(bytes);
  if (r.sig(36) !== 'acsp') throw new Error("Not an ICC profile (no 'acsp' signature)");
  const version = r.u8(8);
  const colorSpace = SPACES[r.sig(16)] ?? r.sig(16).trim();
  const pcs = r.sig(20) === 'Lab ' ? 'LAB' : 'XYZ';
  const tags = new Map<string, number>();
  const count = r.u32(128);
  for (let i = 0; i < count; i++) tags.set(r.sig(132 + i * 12), r.u32(136 + i * 12));
  const tag = (s: string) => tags.get(s);
  const description = tag('desc') !== undefined ? textOf(r, tag('desc')!) : '';
  const xyzTag = (s: string): [number, number, number] | null => {
    const o = tag(s);
    return o === undefined ? null : [r.s15(o + 8), r.s15(o + 12), r.s15(o + 16)];
  };
  const white = xyzTag('wtpt') ?? D50;
  const channels = CHANNELS[colorSpace] ?? 3;

  // LUT-based A2B tags win over matrix/TRC (the spec's precedence)
  const luts: (Lut | null)[] = [0, 1, 2].map((i) => {
    const o = tag(`A2B${i}`);
    return o === undefined ? null : readLut(r, o);
  });
  const lutFor = (intent: Intent) => luts[intent === 3 ? 1 : intent] ?? luts[0] ?? luts[1] ?? luts[2];
  const lutToXyz = (lut: Lut, v: ArrayLike<number>): [number, number, number] => {
    const o = lut.eval(v);
    if (pcs === 'LAB') {
      // Lab encodings: v4 / mft1 use 0..1 → L 0..100; legacy 16-bit (mft2) uses 0xFF00 for 100
      const s = lut.kind === 'mft2' ? 65535 / 65280 : 1;
      return labToXyz([o[0] * s * 100, o[1] * s * 255 - 128, o[2] * s * 255 - 128]);
    }
    const s = 65535 / 32768; // u1Fixed15
    return [o[0] * s, o[1] * s, o[2] * s];
  };

  let matrixToXyz: ((v: ArrayLike<number>) => [number, number, number]) | null = null;
  if (colorSpace === 'RGB' && tag('rXYZ') !== undefined && tag('rTRC') !== undefined) {
    const rx = xyzTag('rXYZ')!, gx = xyzTag('gXYZ')!, bx = xyzTag('bXYZ')!;
    const tr = readCurve(r, tag('rTRC')!).c, tg = readCurve(r, tag('gTRC')!).c, tb = readCurve(r, tag('bTRC')!).c;
    matrixToXyz = (v) => {
      const R0 = tr(v[0]), G0 = tg(v[1]), B0 = tb(v[2]);
      return [rx[0] * R0 + gx[0] * G0 + bx[0] * B0, rx[1] * R0 + gx[1] * G0 + bx[1] * B0, rx[2] * R0 + gx[2] * G0 + bx[2] * B0];
    };
  } else if (colorSpace === 'GRAY' && tag('kTRC') !== undefined) {
    const tk = readCurve(r, tag('kTRC')!).c;
    matrixToXyz = (v) => {
      const k = tk(v[0]);
      return [D50[0] * k, D50[1] * k, D50[2] * k];
    };
  }

  return {
    bytes,
    version,
    deviceClass: r.sig(12),
    colorSpace,
    pcs,
    channels,
    description,
    white,
    toXyz(v, intent = 0) {
      const lut = lutFor(intent);
      if (lut) return lutToXyz(lut, v);
      if (matrixToXyz) return matrixToXyz(v);
      throw new Error(`No device → PCS transform in this ${colorSpace} profile`);
    },
  };
}

/** Device values (0..1) of `profile` → sRGB 0..255, cached per quantised input (fast for images and previews). */
export function toSrgbTransform(profile: IccProfile, intent: Intent = 0): (v: ArrayLike<number>) => [number, number, number] {
  const cache = new Map<string, [number, number, number]>();
  return (v) => {
    const key = Array.from(v, (x) => Math.round(x * 1000)).join(',');
    let out = cache.get(key);
    if (!out) {
      out = xyzD50ToSrgb(profile.toXyz(v, intent));
      if (cache.size > 200_000) cache.clear();
      cache.set(key, out);
    }
    return out;
  };
}

/** Lab (D50) of device values. */
export const toLab = (profile: IccProfile, v: ArrayLike<number>, intent: Intent = 0) => xyzToLab(profile.toXyz(v, intent));

// ---------------------------------------------------------------- embedded profiles

/** ICC profile embedded in a JPEG (APP2 "ICC_PROFILE" chunks, possibly split), or null. */
export function readJpegIcc(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: { seq: number; data: Uint8Array }[] = [];
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xe2 && String.fromCharCode(...b.subarray(p + 4, p + 15)) === 'ICC_PROFILE') {
      parts.push({ seq: b[p + 16], data: b.subarray(p + 18, p + 2 + len) });
    }
    p += 2 + len;
  }
  if (!parts.length) return null;
  parts.sort((x, y) => x.seq - y.seq);
  const out = new Uint8Array(parts.reduce((a, x) => a + x.data.length, 0));
  let o = 0;
  for (const x of parts) { out.set(x.data, o); o += x.data.length; }
  return out;
}

/** ICC profile in a PNG's iCCP chunk (inflated), or null. */
export async function readPngIcc(b: Uint8Array): Promise<Uint8Array | null> {
  if (b[0] !== 0x89 || b[1] !== 0x50) return null;
  let p = 8;
  while (p + 8 <= b.length) {
    const len = ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === 'iCCP') {
      const data = b.subarray(p + 8, p + 8 + len);
      const nul = data.indexOf(0);
      const z = data.subarray(nul + 2); // name, NUL, compression method, zlib data
      const ds = new DecompressionStream('deflate');
      const out = await new Response(new Blob([z as BlobPart]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(out);
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    p += 12 + len;
  }
  return null;
}

/** ICC profile in a WebP's ICCP chunk, or null. Walks the RIFF chunks (little-endian sizes, odd sizes padded to even). */
export function readWebpIcc(b: Uint8Array): Uint8Array | null {
  if (b.length < 12 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'RIFF' || String.fromCharCode(b[8], b[9], b[10], b[11]) !== 'WEBP') return null;
  let p = 12;
  while (p + 8 <= b.length) {
    const type = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    if (size < 0 || p + 8 + size > b.length) return null;
    if (type === 'ICCP') return b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  return null;
}

// ---------------------------------------------------------------- working-space profiles (written by us)

/** Primaries (XYZ of R, G, B at full, D50 via Bradford) of the working spaces. Published standard values. */
export const PRIMARIES_D50: Record<'srgb' | 'display-p3', [[number, number, number], [number, number, number], [number, number, number]]> = {
  srgb: [[0.4360747, 0.2225045, 0.0139322], [0.3850649, 0.7168786, 0.0971045], [0.1430804, 0.0606169, 0.7141733]],
  'display-p3': [[0.5151215, 0.2411957, -0.0010529], [0.2919769, 0.6922455, 0.0418854], [0.1571045, 0.0665741, 0.7840729]],
};

function inv3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** sRGB transfer curve (also Display P3's), 0..1 both ways. */
export const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
export const srgbEncode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/**
 * Pixels (RGBA float 0..1, straight alpha) from `src`'s colours into a working space, in place, at full precision.
 * Out-of-gamut values are clipped. Gray profiles are supported (they use the R channel).
 */
export function convertToWorkingFloat(src: IccProfile, data: Float32Array, space: 'srgb' | 'display-p3', intent: Intent = 1) {
  const P = PRIMARIES_D50[space];
  const toRgb = inv3([P[0][0], P[1][0], P[2][0], P[0][1], P[1][1], P[2][1], P[0][2], P[1][2], P[2][2]]);
  const v = new Float64Array(src.channels);
  for (let i = 0; i < data.length; i += 4) {
    if (src.channels === 1) v[0] = data[i];
    else { v[0] = data[i]; v[1] = data[i + 1]; v[2] = data[i + 2]; }
    const [x, y, z] = src.toXyz(v, intent);
    for (let c = 0; c < 3; c++) {
      const lin = toRgb[c * 3] * x + toRgb[c * 3 + 1] * y + toRgb[c * 3 + 2] * z;
      data[i + c] = Math.min(1, Math.max(0, srgbEncode(Math.max(0, lin))));
    }
  }
}

/** True when a profile is (close enough to) the given working space: no conversion needed. */
export function matchesWorkingSpace(p: IccProfile, space: 'srgb' | 'display-p3'): boolean {
  if (p.colorSpace !== 'RGB') return false;
  const P = PRIMARIES_D50[space];
  try {
    for (let c = 0; c < 3; c++) {
      const v = [0, 0, 0];
      v[c] = 1;
      const xyz = p.toXyz(v, 1);
      if (xyz.some((q, k) => Math.abs(q - P[c][k]) > 0.003)) return false;
      v[c] = 0.5;
      const half = p.toXyz(v, 1)[1] / P[c][1];
      if (Math.abs(half - srgbDecode(0.5)) > 0.004) return false;
    }
  } catch {
    return false;
  }
  return true;
}

/** An ICC v4 display profile for sRGB or Display P3 (matrix + parametric curves), to embed in exports. */
export function makeWorkingProfile(space: 'srgb' | 'display-p3'): Uint8Array {
  const name = space === 'srgb' ? 'sRGB (Skill)' : 'Display P3 (Skill)';
  const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const s15 = (v: number) => u32(Math.round(v * 65536) >>> 0);
  const mluc = (s: string) => [...enc('mluc'), 0, 0, 0, 0, ...u32(1), ...u32(12), ...enc('en'), ...enc('US'), ...u32(s.length * 2), ...u32(28), ...Array.from(s).flatMap((c) => [0, c.charCodeAt(0)])];
  const xyz = (p: number[]) => [...enc('XYZ '), 0, 0, 0, 0, ...s15(p[0]), ...s15(p[1]), ...s15(p[2])];
  const para = [...enc('para'), 0, 0, 0, 0, 0, 3, 0, 0, ...s15(2.4), ...s15(1 / 1.055), ...s15(0.055 / 1.055), ...s15(1 / 12.92), ...s15(0.04045)];
  const chad = [...enc('sf32'), 0, 0, 0, 0, ...[1.0478112, 0.0228866, -0.050127, 0.0295424, 0.9904844, -0.0170491, -0.0092345, 0.0150436, 0.7521316].flatMap(s15)];
  const P = PRIMARIES_D50[space];
  const tags: [string, number[]][] = [
    ['desc', mluc(name)], ['cprt', mluc('No copyright, use freely')], ['wtpt', xyz([0.9642, 1, 0.8249])], ['chad', chad],
    ['rXYZ', xyz(P[0])], ['gXYZ', xyz(P[1])], ['bXYZ', xyz(P[2])], ['rTRC', para], ['gTRC', para], ['bTRC', para],
  ];
  const pad = (a: number[]) => { while (a.length % 4) a.push(0); return a; };
  let off = 128 + 4 + tags.length * 12;
  const table: number[] = [...u32(tags.length)];
  const body: number[] = [];
  for (const [sig, data] of tags) {
    table.push(...enc(sig), ...u32(off), ...u32(data.length));
    const d = pad([...data]);
    body.push(...d);
    off += d.length;
  }
  const size = 128 + table.length + body.length;
  const h = new Array(128).fill(0);
  h.splice(0, 4, ...u32(size));
  h.splice(8, 4, 4, 0x30, 0, 0); // version 4.3
  h.splice(12, 4, ...enc('mntr'));
  h.splice(16, 4, ...enc('RGB '));
  h.splice(20, 4, ...enc('XYZ '));
  h.splice(24, 12, 0x07, 0xea, 0, 11, 0, 7, 0, 0, 0, 0, 0, 0); // 2026-11-07
  h.splice(36, 4, ...enc('acsp'));
  h.splice(68, 12, ...s15(0.9642), ...s15(1), ...s15(0.8249));
  h.splice(80, 4, ...enc('SKLL'));
  return Uint8Array.from([...h, ...table, ...body]);
}
