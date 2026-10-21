// "Hug" links: a shape that wraps a text layer with padding, like a button around its label.
// After every change the link is kept true:
// - the text changed (typed, restyled, moved): the shape refits around it with the same padding;
// - only the shape was moved: the label moves with it;
// - only the shape was resized: the padding follows the new size and the label is re-centred.
// Rotated shapes or labels are left alone. Pure functions: store.commit runs `applyHugs`.

import type { Layer } from './types';
import { withLayer } from './types';

type Box = { x: number; y: number; w: number; h: number };
const box = (l: Layer): Box => ({ x: l.x, y: l.y, w: l.width, h: l.height });
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;

/** The layers with every hug link applied; returns the same array when nothing needs to change. */
export function applyHugs(prev: Layer[] | undefined, layers: Layer[]): Layer[] {
  if (!layers.some((l) => l.hug)) return layers;
  const byId = new Map(layers.map((l) => [l.id, l]));
  const before = new Map((prev ?? []).map((l) => [l.id, l]));
  const out = new Map<string, Layer>();
  for (const s of layers) {
    if (!s.hug || s.kind !== 'shape') continue;
    const t = out.get(s.hug.target) ?? byId.get(s.hug.target);
    if (!t || t.kind !== 'text' || s.rotation || t.rotation) continue;
    const ps = before.get(s.id), pt = before.get(t.id);
    const S = box(s), T = box(t);
    const P = ps ? box(ps) : S, Q = pt ? box(pt) : T;
    // Decided against the last committed state, so every live frame of a drag gives the same answer
    const labelResized = Math.abs(Q.w - T.w) > 1e-6 || Math.abs(Q.h - T.h) > 1e-6;
    if (!labelResized && !same(P, S)) {
      if (Math.abs(P.w - S.w) < 1e-6 && Math.abs(P.h - S.h) < 1e-6) {
        // The shape moved: the label comes along
        const x = Q.x + S.x - P.x, y = Q.y + S.y - P.y;
        if (Math.abs(x - t.x) > 1e-6 || Math.abs(y - t.y) > 1e-6) out.set(t.id, withLayer(t, { x, y }));
      } else {
        // The shape was resized: new padding, label centred
        const padX = Math.max(0, (S.w - T.w) / 2), padY = Math.max(0, (S.h - T.h) / 2);
        if (Math.abs(padX - s.hug.padX) > 1e-6 || Math.abs(padY - s.hug.padY) > 1e-6) out.set(s.id, withLayer(s, { hug: { ...s.hug, padX, padY } }));
        const x = S.x + (S.w - T.w) / 2, y = S.y + (S.h - T.h) / 2;
        if (Math.abs(x - t.x) > 1e-6 || Math.abs(y - t.y) > 1e-6) out.set(t.id, withLayer(t, { x, y }));
      }
      continue;
    }
    // The label changed (typed, restyled, moved): the shape refits around it
    const fit = { x: T.x - s.hug.padX, y: T.y - s.hug.padY, w: T.w + 2 * s.hug.padX, h: T.h + 2 * s.hug.padY };
    if (!same(fit, S)) out.set(s.id, withLayer(s, { x: fit.x, y: fit.y, width: fit.w, height: fit.h }));
  }
  return out.size ? layers.map((l) => out.get(l.id) ?? l) : layers;
}

/** Padding that makes a button read well at a given type size (≈ 1.5em × 0.75em). */
export const buttonPadding = (size: number) => ({ padX: Math.round(size * 1.5), padY: Math.round(size * 0.75) });
