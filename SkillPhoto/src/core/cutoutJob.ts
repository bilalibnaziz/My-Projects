// A unit of cutout work, run by cutout.worker.ts or (without workers) on the main thread.
import { cutout, snapRegion } from './cutout';
import type { CutoutOptions, CutoutResult, Prior } from './cutout';
import * as seg from './segment';
import type { Box } from './segment';
import type { RGBA } from './matte';

export type CutoutJob =
  | { kind: 'prior'; img: RGBA; roi: Box; prior: Prior; opts: CutoutOptions }
  /** Classic engine (no models): Select Subject, a box, or a click, then the full-resolution edge snap. */
  | { kind: 'classic'; img: RGBA; box?: Box; at?: { x: number; y: number }; pixels?: boolean };

/** Runs a job (shared by the worker and the fallback). */
export function runJob(job: CutoutJob): CutoutResult | null {
  if (job.kind === 'prior') return cutout(job.img, job.roi, job.prior, job.opts);
  const { img } = job;
  const r = job.box ? seg.selectObjectInBox(img, job.box) : job.at ? seg.selectObjectAt(img, job.at.x, job.at.y) : seg.selectSubject(img);
  if (!r.alpha.some((v) => v >= 0.5)) return null;
  return snapRegion(img, r, 'crisp', Math.max(1, Math.max(r.roi.w, r.roi.h) / 400), job.pixels);
}
