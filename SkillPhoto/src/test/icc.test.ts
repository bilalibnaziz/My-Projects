// @vitest-environment node
// The ICC engine against an independent reference: Apple ColorSync (sips) converting the same colours with
// the same system profiles. Skipped where macOS profiles / sips are not available.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng16 } from '../core/formats/png16';
import { convertToWorkingFloat, deltaE00, labToXyz, makeWorkingProfile, matchesWorkingSpace, parseIcc, PRIMARIES_D50, readJpegIcc, srgbToXyzD50, toSrgbTransform, xyzD50ToSrgb, xyzToLab } from '../core/icc';

const SYS = '/System/Library/ColorSync/Profiles';
const have = existsSync(`${SYS}/Generic CMYK Profile.icc`) && existsSync('/usr/bin/sips');
const dir = mkdtempSync(join(tmpdir(), 'icc-test-'));

/** Minimal uncompressed TIFF: 1 row of pixels, 3 (RGB) or 4 (CMYK) samples. */
function tiff(px: number[][], cmyk: boolean): Uint8Array {
  const spp = cmyk ? 4 : 3, w = px.length;
  const data = Uint8Array.from(px.flat());
  const entries: [number, number, number, number][] = [
    [256, 3, 1, w], [257, 3, 1, 1], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, cmyk ? 5 : 2],
    [273, 4, 1, 0], [277, 3, 1, spp], [278, 3, 1, 1], [279, 4, 1, data.length], [284, 3, 1, 1],
  ];
  const ifdOff = 8, ifdLen = 2 + entries.length * 12 + 4, dataOff = ifdOff + ifdLen;
  const buf = new DataView(new ArrayBuffer(dataOff + data.length));
  buf.setUint16(0, 0x4d4d); buf.setUint16(2, 42); buf.setUint32(4, ifdOff);
  buf.setUint16(ifdOff, entries.length);
  entries.forEach(([tag, type, count, val], i) => {
    const o = ifdOff + 2 + i * 12;
    buf.setUint16(o, tag); buf.setUint16(o + 2, type); buf.setUint32(o + 4, count);
    if (tag === 273) buf.setUint32(o + 8, dataOff);
    else if (type === 3) buf.setUint16(o + 8, val);
    else buf.setUint32(o + 8, val);
  });
  const out = new Uint8Array(buf.buffer);
  out.set(data, dataOff);
  return out;
}

/** ColorSync: pixels in `profile` → sRGB, read back from a BMP. */
function colorsync(px: number[][], cmyk: boolean, profile: string, to = `${SYS}/sRGB Profile.icc`): number[][] {
  const t = join(dir, `in-${Math.random().toString(36).slice(2)}.tif`), o = t.replace('.tif', '.bmp');
  writeFileSync(t, tiff(px, cmyk));
  execFileSync('/usr/bin/sips', ['--embedProfile', profile.startsWith('/') ? profile : `${SYS}/${profile}`, t], { stdio: 'ignore' });
  execFileSync('/usr/bin/sips', ['--matchTo', to, '-s', 'format', 'bmp', t, '--out', o], { stdio: 'ignore' });
  const d = readFileSync(o);
  const off = d.readUInt32LE(10), bpp = d.readUInt16LE(28) / 8;
  return px.map((_, x) => [d[off + x * bpp + 2], d[off + x * bpp + 1], d[off + x * bpp]]);
}
/** ColorSync conversion written as PNG (keeps the target profile's values; BMP would be converted again). */
async function colorsyncPng(px: number[][], profile: string, to: string): Promise<number[][]> {
  const t = join(dir, `in-${Math.random().toString(36).slice(2)}.tif`), o = t.replace('.tif', '.png');
  writeFileSync(t, tiff(px, false));
  execFileSync('/usr/bin/sips', ['--embedProfile', profile, t], { stdio: 'ignore' });
  execFileSync('/usr/bin/sips', ['--matchTo', to, '-s', 'format', 'png', t, '--out', o], { stdio: 'ignore' });
  const r = (await decodePng16(new Uint8Array(readFileSync(o))))!;
  return px.map((_, x) => [0, 1, 2].map((k) => Math.round(r.data[x * 4 + k] / 257)));
}
const lab = (rgb: number[]) => xyzToLab(srgbToXyzD50(rgb as [number, number, number]));

describe('ICC colour maths', () => {
  it('Lab ↔ XYZ and sRGB ↔ XYZ round-trip', () => {
    const l: [number, number, number] = [52.3, 41.7, -18.2];
    const back = xyzToLab(labToXyz(l));
    l.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
    for (const c of [[255, 255, 255], [12, 200, 90], [0, 0, 0], [128, 64, 250]] as [number, number, number][])
      expect(xyzD50ToSrgb(srgbToXyzD50(c))).toEqual(c);
    // D50 white is L 100 and neutral
    const w = xyzToLab(srgbToXyzD50([255, 255, 255]));
    expect(w[0]).toBeCloseTo(100, 1);
    expect(Math.abs(w[1]) + Math.abs(w[2])).toBeLessThan(0.1);
  });
  it('CIEDE2000 matches the published test pairs (Sharma et al.)', () => {
    expect(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE00([50, 2.5, 0], [56, -27, -3])).toBeCloseTo(31.903, 2);
    expect(deltaE00([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 3);
  });
  it('rejects files that are not profiles', () => {
    expect(() => parseIcc(new Uint8Array(200))).toThrow(/acsp/);
  });
});

describe.skipIf(!have)('ICC profiles vs Apple ColorSync', { timeout: 60_000 }, () => {
  it('reads system profiles of every kind (mft1 LUT, curv, para, mluc)', () => {
    const cmyk = parseIcc(readFileSync(`${SYS}/Generic CMYK Profile.icc`));
    expect([cmyk.colorSpace, cmyk.pcs, cmyk.channels]).toEqual(['CMYK', 'LAB', 4]);
    expect(cmyk.description).toMatch(/CMYK/);
    const p3 = parseIcc(readFileSync(`${SYS}/Display P3.icc`));
    expect([p3.colorSpace, p3.version, p3.description]).toEqual(['RGB', 4, 'Display P3']);
  });

  it('CMYK (Generic CMYK, A2B0 mft1) → sRGB within ΔE00 < 2 of ColorSync', () => {
    const prof = parseIcc(readFileSync(`${SYS}/Generic CMYK Profile.icc`));
    const px = [[0, 0, 0, 0], [255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [0, 0, 0, 255], [0, 246, 149, 0], [128, 64, 32, 16], [255, 255, 0, 0], [60, 0, 230, 20], [0, 0, 0, 128]];
    const ref = colorsync(px, true, 'Generic CMYK Profile.icc');
    const ours = px.map((p) => toSrgbTransform(prof)(p.map((v) => v / 255)));
    const dE = ours.map((o, i) => deltaE00(lab(o), lab(ref[i])));
    console.log('CMYK vs ColorSync: max ΔE00', Math.max(...dE).toFixed(2), 'mean', (dE.reduce((a, b) => a + b, 0) / dE.length).toFixed(2));
    expect(Math.max(...dE), JSON.stringify({ ours, ref, dE })).toBeLessThan(2);
  });

  it('Adobe RGB (1998) and Display P3 (matrix/TRC, curv + para) → sRGB within ΔE00 < 1 of ColorSync', () => {
    const px = [[128, 128, 128], [200, 40, 60], [30, 150, 90], [250, 240, 200], [10, 20, 200], [180, 180, 30]];
    for (const name of ['AdobeRGB1998.icc', 'Display P3.icc']) {
      const prof = parseIcc(readFileSync(`${SYS}/${name}`));
      const ref = colorsync(px, false, name);
      const ours = px.map((p) => toSrgbTransform(prof, 1)(p.map((v) => v / 255)));
      const dE = ours.map((o, i) => deltaE00(lab(o), lab(ref[i])));
      console.log(name, 'vs ColorSync: max ΔE00', Math.max(...dE).toFixed(2));
      expect(Math.max(...dE), JSON.stringify({ name, ours, ref, dE })).toBeLessThan(1);
    }
  });

  it('finds a profile embedded in a JPEG (APP2 ICC_PROFILE)', () => {
    const icc = readFileSync(`${SYS}/Display P3.icc`);
    const app2 = new Uint8Array(18 + icc.length);
    app2.set([0xff, 0xe2, ((16 + icc.length) >> 8) & 255, (16 + icc.length) & 255]);
    app2.set([...'ICC_PROFILE'].map((c) => c.charCodeAt(0)), 4);
    app2.set([0, 1, 1], 15);
    app2.set(icc, 18);
    const jpg = new Uint8Array([0xff, 0xd8, ...app2, 0xff, 0xd9]);
    const got = readJpegIcc(jpg);
    expect(got && parseIcc(got).description).toBe('Display P3');
  });
});

describe.skipIf(!have)('working-space profiles written by us, vs ColorSync', { timeout: 60_000 }, () => {
  const px = [[0, 0, 0], [255, 255, 255], [128, 128, 128], [200, 40, 60], [30, 150, 90], [10, 20, 200], [250, 240, 30]];
  for (const [space, apple] of [['srgb', 'sRGB Profile.icc'], ['display-p3', 'Display P3.icc']] as const) {
    it(`our ${space} profile parses back to its primaries and matches Apple's ${apple}`, async () => {
      const bytes = makeWorkingProfile(space);
      const p = parseIcc(bytes);
      expect([p.version, p.colorSpace, p.pcs]).toEqual([4, 'RGB', 'XYZ']);
      expect(matchesWorkingSpace(p, space)).toBe(true);
      expect(matchesWorkingSpace(parseIcc(readFileSync(`${SYS}/${apple}`)), space)).toBe(true);
      // ColorSync: pixels tagged with our profile, converted to Apple's profile of the same space, stay put
      const ours = join(dir, `${space}.icc`);
      writeFileSync(ours, bytes);
      const out = await colorsyncPng(px, ours, `${SYS}/${apple}`);
      const worst = Math.max(...out.map((o, i) => Math.max(...o.map((v, k) => Math.abs(v - px[i][k])))));
      console.log(space, 'profile through ColorSync: max change', worst);
      expect(worst).toBeLessThanOrEqual(1);
    });
  }
  it('Adobe RGB → Display P3 at full precision matches ColorSync within ΔE00 < 1', async () => {
    const prof = parseIcc(readFileSync(`${SYS}/AdobeRGB1998.icc`));
    const ref = await colorsyncPng(px, `${SYS}/AdobeRGB1998.icc`, `${SYS}/Display P3.icc`);
    const f = Float32Array.from(px.flatMap((p) => [...p.map((v) => v / 255), 1]));
    convertToWorkingFloat(prof, f, 'display-p3');
    // compare in Lab through the P3 primaries
    const P = PRIMARIES_D50['display-p3'];
    const labP3 = (rgb: number[]) => {
      const l = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return xyzToLab([0, 1, 2].map((k) => P[0][k] * l[0] + P[1][k] * l[1] + P[2][k] * l[2]) as [number, number, number]);
    };
    const dE = px.map((_, i) => deltaE00(labP3([f[i * 4] * 255, f[i * 4 + 1] * 255, f[i * 4 + 2] * 255]), labP3(ref[i])));
    console.log('Adobe RGB → P3 vs ColorSync: max ΔE00', Math.max(...dE).toFixed(2));
    expect(Math.max(...dE)).toBeLessThan(1);
  });
});
