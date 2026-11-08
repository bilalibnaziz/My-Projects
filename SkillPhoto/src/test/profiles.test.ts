// @vitest-environment node
// Profiles in the formats that didn't have them yet: WebP exports (ICCP chunk) and 8-bit TIFF
// exports (tag 34675). Pure byte-level checks: no canvas, no browser, no sips.
import { describe, expect, it } from 'vitest';
import { embedProfile } from '../core/formats/iccEmbed';
import { decodeTiff, encodeTiff } from '../core/formats/tiff';
import { makeWorkingProfile, matchesWorkingSpace, parseIcc, readWebpIcc } from '../core/icc';

const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];

function chunk(name: string, data: number[]): number[] {
  const out = [...tag(name), ...u32le(data.length), ...data];
  if (data.length % 2) out.push(0); // RIFF chunks are word-aligned
  return out;
}

/** Minimal WebP container: an (invalid) VP8L payload is fine — only the container is exercised. */
function webp(vp8x: boolean): Uint8Array {
  const body = [
    ...tag('WEBP'),
    // VP8X: flags 0, reserved, 4x2 canvas (width-1 / height-1, 3 bytes each)
    ...(vp8x ? chunk('VP8X', [0, 0, 0, 0, 3, 0, 0, 1, 0, 0]) : []),
    ...chunk('VP8L', [0x2f, 0x01, 0x02, 0x03, 0x04]),
  ];
  return Uint8Array.from([...tag('RIFF'), ...u32le(body.length), ...body]);
}

const findTag = (b: Uint8Array, name: string) => {
  const t = tag(name);
  for (let i = 0; i + 4 <= b.length; i++) if (t.every((v, k) => b[i + k] === v)) return i;
  return -1;
};

const riffSize = (b: Uint8Array) => b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);

describe('WebP profiles', () => {
  it('embeds the Display P3 working profile and reads it back identical', async () => {
    const profile = makeWorkingProfile('display-p3');
    const out = new Uint8Array(await (await embedProfile(new Blob([webp(false) as BlobPart], { type: 'image/webp' }), profile, 'Display P3')).arrayBuffer());
    expect(readWebpIcc(out)).toEqual(profile);
    expect(matchesWorkingSpace(parseIcc(readWebpIcc(out)!), 'display-p3')).toBe(true);
    expect(riffSize(out)).toBe(out.length - 8);
    // The image chunk survives verbatim after the inserted ICCP chunk
    const at = findTag(out, 'VP8L');
    expect(at).toBeGreaterThan(12);
    expect(Array.from(out.subarray(at + 8, at + 13))).toEqual([0x2f, 0x01, 0x02, 0x03, 0x04]);
  });

  it('sets the VP8X ICC flag on extended WebP', async () => {
    const out = new Uint8Array(await (await embedProfile(new Blob([webp(true) as BlobPart], { type: 'image/webp' }), makeWorkingProfile('srgb'), 'sRGB')).arrayBuffer());
    expect(readWebpIcc(out)).toEqual(makeWorkingProfile('srgb'));
    expect(out[20] & 0x20).toBe(0x20); // VP8X chunk data starts at 20; bit 5 = ICC present
    expect(riffSize(out)).toBe(out.length - 8);
  });

  it('embedding twice is a no-op', async () => {
    const blob = new Blob([webp(false) as BlobPart], { type: 'image/webp' });
    const once = await embedProfile(blob, makeWorkingProfile('srgb'), 'sRGB');
    const twice = await embedProfile(once, makeWorkingProfile('display-p3'), 'Display P3');
    expect(new Uint8Array(await twice.arrayBuffer())).toEqual(new Uint8Array(await once.arrayBuffer()));
  });

  it('an odd-length profile is padded and later chunks still walk', async () => {
    const fake = Uint8Array.from([9, 8, 7, 6, 5]);
    const out = new Uint8Array(await (await embedProfile(new Blob([webp(false) as BlobPart], { type: 'image/webp' }), fake, 'Fake')).arrayBuffer());
    expect(readWebpIcc(out)).toEqual(fake);
    const at = findTag(out, 'VP8L');
    expect(at).toBeGreaterThan(12);
    expect(Array.from(out.subarray(at + 8, at + 13))).toEqual([0x2f, 0x01, 0x02, 0x03, 0x04]);
    expect(riffSize(out)).toBe(out.length - 8);
  });

  it('leaves non-WebP blobs and malformed WebP alone', async () => {
    const text = new Blob(['hello'], { type: 'text/plain' });
    expect(await embedProfile(text, makeWorkingProfile('srgb'), 'sRGB')).toBe(text);
    const bad = new Blob([Uint8Array.from([110, 111, 116, 32, 97, 32, 119, 101, 98, 112, 33, 33]) as BlobPart], { type: 'image/webp' });
    const out = await embedProfile(bad, makeWorkingProfile('srgb'), 'sRGB');
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array(await bad.arrayBuffer()));
    expect(readWebpIcc(webp(false))).toBeNull();
  });
});

describe('8-bit TIFF profiles', () => {
  const data = new Uint8ClampedArray([
    200, 40, 30, 255, 30, 160, 90, 255, 10, 20, 200, 128, 255, 255, 255, 255,
    0, 0, 0, 255, 90, 90, 90, 255, 1, 2, 3, 255, 4, 5, 6, 255,
  ]);

  it('carries the working profile (tag 34675) and decodes pixel-identical', async () => {
    const profile = makeWorkingProfile('display-p3');
    const bytes = encodeTiff({ width: 4, height: 2, data }, { icc: profile });
    const back = await decodeTiff(bytes.buffer as ArrayBuffer);
    expect(back.icc).toEqual(profile);
    expect(matchesWorkingSpace(parseIcc(back.icc!), 'display-p3')).toBe(true);
    expect(back.data).toEqual(data);
  });

  it('has no profile when none is passed', async () => {
    const bytes = encodeTiff({ width: 4, height: 2, data }, {});
    expect((await decodeTiff(bytes.buffer as ArrayBuffer)).icc).toBeUndefined();
  });

  it('never embeds the RGB working profile in a CMYK TIFF', async () => {
    const bytes = encodeTiff({ width: 4, height: 2, data }, { cmyk: true, icc: makeWorkingProfile('srgb') });
    expect((await decodeTiff(bytes.buffer as ArrayBuffer)).icc).toBeUndefined();
  });
});
