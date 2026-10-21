/**
 * Transform Again (⌘D) and Transform Each (⌥⇧⌘D), as in Illustrator.
 *
 * Transform Again repeats the last move / scale / rotate of the selection. It reads the change from the
 * last two history steps, so it works whichever tool or field made it. After an ⌥-drag copy (Duplicate,
 * then Move) it repeats the copy too: step-and-repeat.
 */
import type { Layer } from './types';
import { withLayer } from './types';
import { store } from './store';
import { isGroup, descendants } from './groups';
import * as ops from './ops';

export interface TransformDelta {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** Degrees, clockwise. */
  rot: number;
  /** Repeat a copy as well (step-and-repeat). */
  copy: boolean;
  /** Transform Each: about each object's own centre instead of the selection's. */
  each?: boolean;
}

type Box = { x: number; y: number; w: number; h: number };

let last: TransformDelta | null = null;
export const lastTransform = () => last;

/** Leaf layers (group contents instead of groups) of a set of layers, from a given layer list. */
function leaves(all: Layer[], picked: Layer[]): Layer[] {
  const out = new Map<string, Layer>();
  for (const l of picked) {
    if (isGroup(l)) for (const d of descendants(all, l.id)) if (!isGroup(d)) out.set(d.id, d);
    if (!isGroup(l)) out.set(l.id, l);
  }
  return [...out.values()];
}

function boxOf(ls: Layer[]): Box | null {
  if (!ls.length) return null;
  const x = Math.min(...ls.map((l) => l.x));
  const y = Math.min(...ls.map((l) => l.y));
  return { x, y, w: Math.max(...ls.map((l) => l.x + l.width)) - x, h: Math.max(...ls.map((l) => l.y + l.height)) - y };
}

const rotatable = (l: Layer) => l.kind === 'shape' || l.kind === 'text';

/** One layer transformed: scaled and rotated about (cx, cy), then moved. Pixel layers only move. */
function transformed(l: Layer, d: TransformDelta, cx: number, cy: number): Layer {
  const lcx = l.x + l.width / 2;
  const lcy = l.y + l.height / 2;
  // Text scales uniformly (by font size); pixel layers keep their size
  const k = Math.sqrt(Math.abs(d.sx * d.sy));
  const sx = l.kind === 'shape' ? d.sx : l.kind === 'text' ? k : 1;
  const sy = l.kind === 'shape' ? d.sy : l.kind === 'text' ? k : 1;
  // Centre: scale about the pivot, then rotate about it
  let nx = cx + (lcx - cx) * d.sx;
  let ny = cy + (lcy - cy) * d.sy;
  if (d.rot) {
    const a = (d.rot * Math.PI) / 180;
    const rx = nx - cx;
    const ry = ny - cy;
    nx = cx + rx * Math.cos(a) - ry * Math.sin(a);
    ny = cy + rx * Math.sin(a) + ry * Math.cos(a);
  }
  const w = l.width * sx;
  const h = l.height * sy;
  const patch: Partial<Layer> = { x: nx - w / 2 + d.dx, y: ny - h / 2 + d.dy, width: w, height: h };
  if (d.rot && rotatable(l)) patch.rotation = (((l.rotation ?? 0) + d.rot) % 360 + 360) % 360 || undefined;
  if (l.kind === 'text' && l.text && k !== 1) patch.text = { ...l.text, size: l.text.size * k, boxWidth: l.text.boxWidth ? l.text.boxWidth * k : undefined };
  return withLayer(l, patch);
}

/** `all` with the selected layers transformed (no history). `random` gives each object its own amount. */
export function transformedLayers(all: Layer[], sel: Layer[], d: TransformDelta, random = false): Layer[] | null {
  const ls = leaves(all, sel);
  const box = boxOf(ls);
  if (!box) return null;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const changed = new Map(
    ls.map((l) => {
      const dd = random ? randomized(d) : d;
      return [l.id, d.each ? transformed(l, dd, l.x + l.width / 2, l.y + l.height / 2) : transformed(l, dd, cx, cy)];
    })
  );
  return all.map((l) => changed.get(l.id) ?? l);
}

/** Applies a transform to the current selection as one undo step. */
export function applyToSelection(d: TransformDelta, label: string, random = false): boolean {
  const doc = store.doc;
  if (!doc || !store.selectedLayers.length) return false;
  if (d.copy) ops.duplicateLayer();
  const sel = store.selectedLayers;
  const layers = transformedLayers(doc.layers, sel, d, random);
  if (!layers) return false;
  store.commit(label, { layers }, { icon: 'move' });
  store.setSelectedLayers(sel.map((l) => l.id).filter((id) => doc.layers.some((x) => x.id === id)));
  last = { ...d };
  return true;
}

/**
 * The selection's change in the last history step: move, scale and rotation of its bounding box, and
 * whether that step moved fresh copies (⌥-drag), which makes the repeat copy too.
 */
export function readLastTransform(): TransformDelta | null {
  const doc = store.doc;
  if (!doc || doc.hIndex < 1) return null;
  const cur = doc.history[doc.hIndex];
  const prev = doc.history[doc.hIndex - 1];
  // Repeating a repeat: same transform again
  if (last && /^(Transform Again|Transform Each)$/.test(cur.label)) return last;
  const sel = store.selectedLayers;
  if (!sel.length) return null;
  const before = new Map(prev.layers.map((l) => [l.id, l]));
  const nowLeaves = leaves(cur.layers, sel);
  const thenLeaves = nowLeaves.map((l) => before.get(l.id));
  if (!nowLeaves.length || thenLeaves.some((l) => !l)) return null;
  const a = boxOf(thenLeaves as Layer[])!;
  const b = boxOf(nowLeaves)!;
  const rotOf = (l: Layer | undefined) => l?.rotation ?? 0;
  const rot = ((rotOf(nowLeaves[0]) - rotOf(thenLeaves[0]) + 540) % 360) - 180;
  const sx = a.w > 0 ? b.w / a.w : 1;
  const sy = a.h > 0 ? b.h / a.h : 1;
  const d: TransformDelta = { dx: b.x + b.w / 2 - (a.x + a.w / 2), dy: b.y + b.h / 2 - (a.y + a.h / 2), sx: rot ? 1 : sx, sy: rot ? 1 : sy, rot, copy: false };
  if (Math.abs(d.dx) < 1e-6 && Math.abs(d.dy) < 1e-6 && Math.abs(d.sx - 1) < 1e-6 && Math.abs(d.sy - 1) < 1e-6 && !d.rot) return null;
  // ⌥-drag copy: the step before made these layers (they didn't exist two steps back)
  const older = doc.hIndex >= 2 ? new Set(doc.history[doc.hIndex - 2].layers.map((l) => l.id)) : null;
  d.copy = !!older && /^Duplicate/.test(prev.label) && nowLeaves.every((l) => !older.has(l.id));
  return d;
}

/** Object ▸ Transform ▸ Transform Again (⌘D). */
export function transformAgain(): boolean {
  const d = readLastTransform();
  if (!d) {
    store.toast('Transform Again: move, scale or rotate something first');
    return false;
  }
  return applyToSelection(d, 'Transform Again');
}

/** Small random spread for Transform Each ▸ Random (each value between 0 and the set amount). */
export function randomized(d: TransformDelta, rnd = Math.random): TransformDelta {
  return { ...d, dx: d.dx * rnd(), dy: d.dy * rnd(), sx: 1 + (d.sx - 1) * rnd(), sy: 1 + (d.sy - 1) * rnd(), rot: d.rot * rnd() };
}

/** Transform Each: each selected object about its own centre (optionally with a random amount each). */
export function transformEach(d: Omit<TransformDelta, 'each'>, random = false): boolean {
  return applyToSelection({ ...d, each: true }, 'Transform Each', random);
}
