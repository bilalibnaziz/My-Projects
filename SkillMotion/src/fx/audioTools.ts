// Browser side of the loudness / silence tools: renders the real mix (the same one the export writes)
// and runs the pure analysis in loudness.ts on it.
import { channelsOf, decodeSource, mixAudio, planAudio, SAMPLE_RATE } from './offlineRender';
import { detectSilence, measureLoudness, normalizeGain, type LoudnessReport, type LoudnessTarget } from './loudness';
import { sourceSpan } from './clipTime';
import type { TimelineClip, TimelineTrack } from './types';

/** Loudness of the mix between `start` and `end`, before the master fader. */
export async function measureMix(tracks: TimelineTrack[], clips: TimelineClip[], start: number, end: number): Promise<LoudnessReport> {
  const buf = await mixAudio(planAudio(tracks, clips, start, end, 1), Math.max(0.1, end - start));
  return measureLoudness(channelsOf(buf), SAMPLE_RATE);
}

/** Report as heard through a master fader of `master` (linear). */
export function throughMaster(r: LoudnessReport, master: number): LoudnessReport {
  const g = master > 0 ? 20 * Math.log10(master) : -Infinity;
  return { ...r, integrated: r.integrated + g, shortTermMax: r.shortTermMax + g, momentaryMax: r.momentaryMax + g, truePeak: r.truePeak + g, samplePeak: r.samplePeak + g };
}

/** Master fader gain that brings the pre-fader mix to the target (true peak kept under the ceiling). */
export function masterFor(r: LoudnessReport, target: Pick<LoudnessTarget, 'lufs' | 'peak'>) {
  const g = normalizeGain(r, target);
  return { ...g, master: Math.pow(10, g.gainDb / 20) };
}

/** Quiet source ranges inside the part of the file the clip uses. Null when it has no decodable sound. */
export async function findSilence(clip: TimelineClip, thresholdDb: number, minDuration: number): Promise<Array<[number, number]> | null> {
  if (!clip.sourceUrl) return null;
  const buf = await decodeSource(clip.sourceUrl);
  if (!buf) return null;
  return detectSilence(channelsOf(buf), buf.sampleRate, { thresholdDb, minDuration, from: clip.offset, to: clip.offset + sourceSpan(clip) });
}
