import { describe, it, expect } from 'vitest';
import { detectSilence, measureLoudness, normalizeGain, truePeakOf, waveformPeaks, blockLevel } from '../loudness';
import { keptParts, localTimeAt, maxDurationFor, sourceTimeAt, splitOffsets } from '../clipTime';

const RATE = 48000;

function sine(seconds: number, dbfs: number, freq = 997, rate = RATE, phase = 0): Float32Array {
  const a = Math.pow(10, dbfs / 20);
  const x = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * freq * i) / rate + phase);
  return x;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('loudness (EBU Tech 3341 cases)', () => {
  it('stereo 1 kHz sine at −23 dBFS reads −23.0 LUFS', () => {
    const x = sine(20, -23);
    const r = measureLoudness([x, x], RATE);
    expect(r.integrated).toBeCloseTo(-23, 1);
    expect(r.shortTermMax).toBeCloseTo(-23, 1);
    expect(r.momentaryMax).toBeCloseTo(-23, 1);
  });

  it('−33 dBFS reads −33.0 LUFS, and the result does not depend on the sample rate', () => {
    const x = sine(20, -33);
    expect(measureLoudness([x, x], RATE).integrated).toBeCloseTo(-33, 1);
    const y = sine(20, -33, 997, 44100);
    expect(measureLoudness([y, y], 44100).integrated).toBeCloseTo(-33, 1);
  });

  it('relative gate ignores the quiet parts (−36 / −23 / −36 dBFS → −23 LUFS)', () => {
    const x = concat(sine(10, -36), sine(60, -23), sine(10, -36));
    expect(measureLoudness([x, x], RATE).integrated).toBeCloseTo(-23, 1);
  });

  it('absolute gate: digital silence around the tone does not lower the reading', () => {
    // Only the few 400 ms blocks that straddle an edge read lower (BS.1770 counts them): within 0.2 LU
    const x = concat(new Float32Array(RATE * 5), sine(10, -23), new Float32Array(RATE * 5));
    const r = measureLoudness([x, x], RATE).integrated;
    expect(r).toBeGreaterThan(-23.2);
    expect(r).toBeLessThan(-22.95);
  });

  it('silence is −∞ and normalize leaves it alone', () => {
    const r = measureLoudness([new Float32Array(RATE * 2), new Float32Array(RATE * 2)], RATE);
    expect(r.integrated).toBe(-Infinity);
    expect(normalizeGain(r, { lufs: -14, peak: -1 })).toEqual({ gainDb: 0, limitedBy: 'silence' });
  });

  it('loudness range of a 20 dB step is close to 20 LU', () => {
    const x = concat(sine(20, -40), sine(20, -20));
    const r = measureLoudness([x, x], RATE);
    expect(r.range).toBeGreaterThan(18);
    expect(r.range).toBeLessThan(21);
  });

  it('true peak finds the inter-sample peak a sample meter misses', () => {
    // fs/4 at 45° phase: every sample lands at ±0.707, the waveform peaks at 1.0
    const x = sine(1, 0, RATE / 4, RATE, Math.PI / 4);
    let samplePeak = 0;
    for (const v of x) samplePeak = Math.max(samplePeak, Math.abs(v));
    expect(samplePeak).toBeCloseTo(Math.SQRT1_2, 3);
    expect(truePeakOf(x)).toBeGreaterThan(0.97);
    expect(truePeakOf(x)).toBeLessThan(1.03);
  });

  it('normalize hits the target, or stops at the true-peak ceiling', () => {
    const quiet = sine(10, -30);
    const r = measureLoudness([quiet, quiet], RATE);
    const g = normalizeGain(r, { lufs: -14, peak: -1 });
    expect(g.limitedBy).toBe('loudness');
    expect(g.gainDb).toBeCloseTo(16, 1);

    const hot = sine(10, -2); // −2 dBFS peak, ≈ −2 LUFS: going to −14 means turning it down
    const r2 = measureLoudness([hot, hot], RATE);
    expect(normalizeGain(r2, { lufs: -14, peak: -1 }).gainDb).toBeCloseTo(-12, 0);

    // Peaky signal: a quiet bed plus a full-scale click. Loudness wants +, the peak allows almost nothing
    const peaky = sine(10, -40);
    peaky[RATE] = 0.99;
    const r3 = measureLoudness([peaky, peaky], RATE);
    const g3 = normalizeGain(r3, { lufs: -14, peak: -1 });
    expect(g3.limitedBy).toBe('peak');
    expect(r3.truePeak + g3.gainDb).toBeCloseTo(-1, 5);
  });
});

describe('silence, waveform and meter levels', () => {
  it('finds the quiet stretch between two tones', () => {
    const x = concat(sine(1, -12), new Float32Array(RATE * 1.5), sine(1, -12));
    const s = detectSilence([x], RATE, { thresholdDb: -40, minDuration: 0.4 });
    expect(s).toHaveLength(1);
    expect(s[0][0]).toBeCloseTo(1, 1);
    expect(s[0][1]).toBeCloseTo(2.5, 1);
  });

  it('ignores pauses shorter than the minimum and respects the threshold', () => {
    const x = concat(sine(1, -12), new Float32Array(RATE * 0.2), sine(1, -12), sine(1, -50));
    expect(detectSilence([x], RATE, { minDuration: 0.4 })).toEqual([[2.2, 3.2]].map(([a, b]) => [expect.closeTo(a, 1), expect.closeTo(b, 1)]));
    expect(detectSilence([x], RATE, { thresholdDb: -60, minDuration: 0.4 })).toEqual([]);
  });

  it('waveform peaks give min/max per bucket', () => {
    const x = concat(new Float32Array(100), new Float32Array(100).fill(0.5), new Float32Array(100).fill(-0.25));
    const p = waveformPeaks([x], 300, 0, 1, 3);
    expect(Array.from(p)).toEqual([0, 0, 0, 0.5, -0.25, 0]);
  });

  it('block level reads a full-scale square as 0 dBFS', () => {
    const l = blockLevel([1, -1, 1, -1]);
    expect(l.rmsDb).toBeCloseTo(0, 6);
    expect(l.peakDb).toBeCloseTo(0, 6);
  });
});

describe('clip time with speed and reverse', () => {
  const c = { offset: 2, duration: 4, speed: 2, reversed: false };

  it('2× runs through the source twice as fast', () => {
    expect(sourceTimeAt(c, 0)).toBe(2);
    expect(sourceTimeAt(c, 1.5)).toBe(5);
    expect(localTimeAt(c, 5)).toBe(1.5);
    expect(maxDurationFor(c, 10)).toBe(4);
  });

  it('reverse runs from the end of the range back to the offset', () => {
    const r = { ...c, reversed: true };
    expect(sourceTimeAt(r, 0)).toBe(10);
    expect(sourceTimeAt(r, 4)).toBe(2);
    expect(localTimeAt(r, sourceTimeAt(r, 1.25))).toBeCloseTo(1.25, 9);
  });

  it('splitting keeps every frame where it was', () => {
    for (const reversed of [false, true]) {
      const k = { ...c, reversed };
      const at = 1.5;
      const { left, right } = splitOffsets(k, at);
      const L = { ...k, offset: left, duration: at };
      const R = { ...k, offset: right, duration: k.duration - at };
      for (const t of [0, 0.7, 1.4]) expect(sourceTimeAt(L, t)).toBeCloseTo(sourceTimeAt(k, t), 9);
      for (const t of [1.5, 2.2, 3.9]) expect(sourceTimeAt(R, t - at)).toBeCloseTo(sourceTimeAt(k, t), 9);
    }
  });

  it('silence cut keeps padded speech and drops the gaps', () => {
    const k = { offset: 0, duration: 10, speed: 1, reversed: false };
    expect(keptParts(k, [[3, 5], [9, 10]], { pad: 0.1 })).toEqual([[0, 3.1], [4.9, 9.1]]);
    // A pause shorter than the minimum stays
    expect(keptParts(k, [[3, 3.2]], { minSilence: 0.4 })).toEqual([[0, 10]]);
    // Source ranges are mapped through speed: 2× clip, silence at source 4–8 = local 2–4
    expect(keptParts({ ...k, speed: 2, duration: 5 }, [[4, 8]], { pad: 0 })).toEqual([[0, 2], [4, 5]]);
  });
});
