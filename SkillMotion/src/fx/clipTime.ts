// Timeline time ↔ source-file time for a clip, with speed and reverse. Every place that shows, plays,
// mixes, splits or trims footage goes through here so they all agree on which source frame is used.
import type { TimelineClip } from './types';

type Timed = Pick<TimelineClip, 'offset' | 'duration' | 'speed' | 'reversed'>;

export const MIN_SPEED = 0.0625; // What <video>.playbackRate supports in every browser
export const MAX_SPEED = 16;

export function clipSpeed(c: Pick<TimelineClip, 'speed'>): number {
  const s = c.speed ?? 1;
  return Number.isFinite(s) && s > 0 ? Math.max(MIN_SPEED, Math.min(MAX_SPEED, s)) : 1;
}

/** Seconds of the source file the clip uses. */
export function sourceSpan(c: Timed): number {
  return c.duration * clipSpeed(c);
}

/**
 * Source time shown / heard `local` seconds into the clip. A reversed clip starts at the end of its
 * source range and runs back to `offset`.
 */
export function sourceTimeAt(c: Timed, local: number): number {
  const l = Math.max(0, Math.min(c.duration, local));
  return c.offset + (c.reversed ? c.duration - l : l) * clipSpeed(c);
}

/** Clip-local time at which source time `src` is shown (inverse of sourceTimeAt). */
export function localTimeAt(c: Timed, src: number): number {
  const l = (src - c.offset) / clipSpeed(c);
  return c.reversed ? c.duration - l : l;
}

/** Offsets of the two halves when a clip is split `at` seconds in, so both keep showing the same frames. */
export function splitOffsets(c: Timed, at: number): { left: number; right: number } {
  const s = clipSpeed(c);
  if (c.reversed) return { left: c.offset + (c.duration - at) * s, right: c.offset };
  return { left: c.offset, right: c.offset + at * s };
}

/** Longest the clip may run from its offset without running past the end of the source. */
export function maxDurationFor(c: Timed, sourceDuration: number): number {
  return (sourceDuration - c.offset) / clipSpeed(c);
}

/**
 * Parts of a clip to keep once `silent` source ranges are cut out, in clip-local seconds and in play
 * order. Each kept part grows by `pad` into the silence on both sides (so words aren't clipped), and
 * silences shorter than `minSilence` or parts shorter than `minKeep` are left alone / dropped.
 */
export function keptParts(
  c: Timed,
  silent: Array<[number, number]>,
  { pad = 0.08, minSilence = 0.4, minKeep = 0.1 } = {}
): Array<[number, number]> {
  const cuts = silent
    .map(([a, b]) => {
      const x = localTimeAt(c, a);
      const y = localTimeAt(c, b);
      return [Math.max(0, Math.min(x, y)), Math.min(c.duration, Math.max(x, y))] as [number, number];
    })
    .filter(([a, b]) => b - a >= minSilence)
    .sort((p, q) => p[0] - q[0]);

  const keep: Array<[number, number]> = [];
  let cursor = 0;
  for (const [a, b] of cuts) {
    // Silence touching the clip edge is cut right to the edge; inside, the cut shrinks by the padding
    const from = a <= 1e-6 ? 0 : a + pad;
    const to = b >= c.duration - 1e-6 ? c.duration : b - pad;
    if (to - from <= 0) continue;
    if (from > cursor) keep.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < c.duration) keep.push([cursor, c.duration]);
  return keep.filter(([a, b]) => b - a >= minKeep);
}
