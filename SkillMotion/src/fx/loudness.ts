// Loudness to ITU-R BS.1770-4 / EBU R128: K-weighting, gated integrated loudness (LUFS), short-term
// maximum, loudness range (EBU Tech 3342) and 4× oversampled true peak. Plus the plain-signal tools the
// timeline uses: silence detection and waveform peaks. Pure functions on Float32Arrays, no Web Audio.

export interface LoudnessReport {
  integrated: number; // LUFS (-Infinity for silence)
  shortTermMax: number; // LUFS, loudest 3 s window
  momentaryMax: number; // LUFS, loudest 400 ms window
  range: number; // LU (LRA)
  truePeak: number; // dBTP
  samplePeak: number; // dBFS
  duration: number; // seconds measured
}

export interface LoudnessTarget {
  id: string;
  label: string;
  lufs: number;
  peak: number; // true-peak ceiling, dBTP
}

export const LOUDNESS_TARGETS: LoudnessTarget[] = [
  { id: 'youtube', label: 'YouTube / Spotify (−14 LUFS)', lufs: -14, peak: -1 },
  { id: 'apple', label: 'Apple Music / Podcasts (−16 LUFS)', lufs: -16, peak: -1 },
  { id: 'tiktok', label: 'TikTok / Reels (−14 LUFS)', lufs: -14, peak: -1 },
  { id: 'ebu', label: 'Broadcast EBU R128 (−23 LUFS)', lufs: -23, peak: -1 },
  { id: 'atsc', label: 'Broadcast ATSC A/85 (−24 LKFS)', lufs: -24, peak: -2 },
];

type Biquad = [number, number, number, number, number]; // b0 b1 b2 a1 a2

/** The two K-weighting stages (pre-filter shelf + RLB high-pass) for any sample rate. */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let K = Math.tan((Math.PI * 1681.974450955533) / rate);
  const Q1 = 0.7071752369554196;
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q1 + K * K;
  const shelf: Biquad = [
    (Vh + (Vb * K) / Q1 + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q1 + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q1 + K * K) / a0,
  ];
  K = Math.tan((Math.PI * 38.13547087602444) / rate);
  const Q2 = 0.5003270373238773;
  a0 = 1 + K / Q2 + K * K;
  const highpass: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q2 + K * K) / a0];
  return [shelf, highpass];
}

function filter(x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

const toLufs = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

/** Mean square of the summed K-weighted channels, over windows of `win` samples every `hop` samples. */
function windowPowers(weighted: Float32Array[], win: number, hop: number): number[] {
  const n = weighted[0]?.length ?? 0;
  if (n < win) return [];
  // Prefix sums of the channel-summed squares make every window O(1)
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const ch of weighted) s += ch[i] * ch[i];
    prefix[i + 1] = prefix[i] + s;
  }
  const out: number[] = [];
  for (let start = 0; start + win <= n; start += hop) out.push((prefix[start + win] - prefix[start]) / win);
  return out;
}

/** Gated integrated loudness of a list of 400 ms block powers (BS.1770-4 §5). */
function gatedLoudness(powers: number[]): number {
  const abs = powers.filter((z) => toLufs(z) > -70);
  if (!abs.length) return -Infinity;
  const relGate = toLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((z) => toLufs(z) > relGate);
  return rel.length ? toLufs(rel.reduce((a, b) => a + b, 0) / rel.length) : -Infinity;
}

// 4× oversampling interpolator: Hann-windowed sinc, 12 taps per phase (the 48-tap filter BS.1770 annex 2 describes)
const TP_TAPS = 12;
const TP_PHASES = [0.25, 0.5, 0.75].map((frac) => {
  const k = new Float64Array(TP_TAPS);
  let sum = 0;
  for (let j = 0; j < TP_TAPS; j++) {
    const t = j - (TP_TAPS / 2 - 1) - frac; // sample offset from the interpolated point
    const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / (TP_TAPS / 2));
    k[j] = sinc * w;
    sum += k[j];
  }
  for (let j = 0; j < TP_TAPS; j++) k[j] /= sum;
  return k;
});

/** Highest absolute value of the signal and of its 4× oversampled reconstruction. */
export function truePeakOf(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const half = TP_TAPS / 2 - 1;
  for (let i = half; i + TP_TAPS - half < x.length; i++) {
    for (const k of TP_PHASES) {
      let v = 0;
      for (let j = 0; j < TP_TAPS; j++) v += k[j] * x[i - half + j];
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
  }
  return peak;
}

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** Full loudness report of stereo (or mono) audio. */
export function measureLoudness(channels: Float32Array[], rate: number): LoudnessReport {
  const [shelf, hp] = kWeighting(rate);
  const weighted = channels.map((ch) => filter(filter(ch, shelf), hp));

  const block = Math.round(0.4 * rate);
  const momentary = windowPowers(weighted, block, Math.round(0.1 * rate)); // 75 % overlap
  const shortTerm = windowPowers(weighted, Math.round(3 * rate), Math.round(0.1 * rate));

  // Loudness range: short-term values gated at −70 LUFS absolute and −20 LU relative, 10th–95th percentile
  const stAbs = shortTerm.filter((z) => toLufs(z) > -70);
  let range = 0;
  if (stAbs.length) {
    const gate = toLufs(stAbs.reduce((a, b) => a + b, 0) / stAbs.length) - 20;
    const vals = stAbs.map(toLufs).filter((l) => l > gate).sort((a, b) => a - b);
    if (vals.length) {
      const at = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
      range = at(0.95) - at(0.1);
    }
  }

  let samplePeak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) samplePeak = Math.max(samplePeak, Math.abs(ch[i]));
  const truePeak = Math.max(...channels.map(truePeakOf), 0);

  return {
    integrated: gatedLoudness(momentary),
    shortTermMax: shortTerm.length ? toLufs(Math.max(...shortTerm)) : toLufs(Math.max(0, ...momentary)),
    momentaryMax: momentary.length ? toLufs(Math.max(...momentary)) : -Infinity,
    range,
    truePeak: db(truePeak),
    samplePeak: db(samplePeak),
    duration: (channels[0]?.length ?? 0) / rate,
  };
}

/**
 * Gain (dB) that brings `report` to `target` without the true peak passing the target's ceiling.
 * `limitedBy` says which one decided.
 */
export function normalizeGain(report: LoudnessReport, target: Pick<LoudnessTarget, 'lufs' | 'peak'>): { gainDb: number; limitedBy: 'loudness' | 'peak' | 'silence' } {
  if (!Number.isFinite(report.integrated)) return { gainDb: 0, limitedBy: 'silence' };
  const toTarget = target.lufs - report.integrated;
  const headroom = target.peak - report.truePeak;
  return toTarget <= headroom ? { gainDb: toTarget, limitedBy: 'loudness' } : { gainDb: headroom, limitedBy: 'peak' };
}

/**
 * Quiet stretches of audio as [start, end] seconds: runs where the 20 ms RMS of the loudest channel
 * stays under `thresholdDb` for at least `minDuration` seconds.
 */
export function detectSilence(
  channels: Float32Array[],
  rate: number,
  { thresholdDb = -40, minDuration = 0.4, from = 0, to = Infinity } = {}
): Array<[number, number]> {
  const n = channels[0]?.length ?? 0;
  const win = Math.max(1, Math.round(0.02 * rate));
  const first = Math.max(0, Math.floor(from * rate));
  const last = Math.min(n, Math.ceil(to * rate));
  const limit = Math.pow(10, thresholdDb / 20);
  const out: Array<[number, number]> = [];
  let runStart = -1;
  for (let s = first; s < last; s += win) {
    const e = Math.min(last, s + win);
    let ms = 0;
    for (const ch of channels) {
      let sum = 0;
      for (let i = s; i < e; i++) sum += ch[i] * ch[i];
      ms = Math.max(ms, sum / (e - s));
    }
    const quiet = Math.sqrt(ms) < limit;
    if (quiet && runStart < 0) runStart = s;
    if (!quiet && runStart >= 0) {
      if ((s - runStart) / rate >= minDuration) out.push([runStart / rate, s / rate]);
      runStart = -1;
    }
  }
  if (runStart >= 0 && (last - runStart) / rate >= minDuration) out.push([runStart / rate, last / rate]);
  return out;
}

/** Min / max pairs of `buckets` equal slices of [from, to) seconds (all channels folded together). */
export function waveformPeaks(channels: Float32Array[], rate: number, from: number, to: number, buckets: number): Float32Array {
  const out = new Float32Array(Math.max(0, buckets) * 2);
  const n = channels[0]?.length ?? 0;
  const span = (to - from) * rate;
  for (let b = 0; b < buckets; b++) {
    const s = Math.max(0, Math.floor(from * rate + (span * b) / buckets));
    const e = Math.min(n, Math.max(s + 1, Math.floor(from * rate + (span * (b + 1)) / buckets)));
    let lo = 0, hi = 0;
    for (const ch of channels) {
      for (let i = s; i < e; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    out[b * 2] = lo;
    out[b * 2 + 1] = hi;
  }
  return out;
}

/** Display level of a time-domain block for a meter: RMS and peak in dBFS. */
export function blockLevel(x: Float32Array | number[]): { rmsDb: number; peakDb: number } {
  let sum = 0, peak = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    peak = Math.max(peak, Math.abs(x[i]));
  }
  return { rmsDb: db(Math.sqrt(sum / Math.max(1, x.length))), peakDb: db(peak) };
}
