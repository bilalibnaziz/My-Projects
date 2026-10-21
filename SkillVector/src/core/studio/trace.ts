// Trace studio: image → vectors placed exactly over the image, template layers for tracing by hand,
// and clean-up of the result (recolour, merge or drop a colour, simplify every path).

import { store } from '../store';
import type { Layer } from '../types';
import { makeLayer, withLayer } from '../types';
import { createCanvas, ctx2d } from '../canvas';
import { curveBounds, traceLayer, traceLayerAsync, traceCanvas, TRACE_PRESETS } from '../tracer';
import type { TraceOptions, TraceResult } from '../tracer';
import { groupLayers, descendants, ungroup } from '../groups';
import { simplifyPathPoints } from '../vectorOps';
import { flatten } from '../io';

export { TRACE_PRESETS };
export type { TraceOptions };

/** What a trace leaves in the document: one group, loose paths, or one path per separate shape. */
export type TraceOutput = 'group' | 'ungroup' | 'shapes';

/** The image the Trace studio works on: the selected pixel layer, else the topmost visible one. */
export function traceSource(): Layer | null {
  const doc = store.doc;
  if (!doc) return null;
  const a = store.activeLayer;
  if (a?.kind === 'raster' && a.canvas) return a;
  return [...doc.layers].reverse().find((l) => l.kind === 'raster' && l.canvas && l.visible && !l.parent) ?? null;
}

/** Quick preview: the trace of a small copy of the image (fast enough to run on every slider move). */
export function previewTrace(layer: Layer, opts: TraceOptions, maxSide = 360): TraceResult | null {
  if (!layer.canvas) return null;
  return traceCanvas(layer.canvas, opts, maxSide);
}

export type SourceAfter = 'hide' | 'keep' | 'delete';

/**
 * Traces `layer` and puts the paths, grouped, right above it. The image is hidden (default), kept or
 * deleted. One undo step; the new group is selected.
 */
export function traceImage(layer: Layer, opts: TraceOptions, after: SourceAfter = 'hide'): { groupId: string; paths: number; anchors: number; colors: string[] } | null {
  const doc = store.doc;
  if (!doc || !layer.canvas) return null;
  const res = traceLayer(layer, opts);
  if (!res || !res.layers.length) {
    store.toast('Nothing to trace: try another preset or threshold', 'info');
    return null;
  }
  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const parts = res.layers.map((l) => ({ ...l, parent: layer.parent }));
  let layers = [...doc.layers.slice(0, idx + 1), ...parts, ...doc.layers.slice(idx + 1)];
  if (after === 'hide') layers = layers.map((l) => (l.id === layer.id ? withLayer(l, { visible: false }) : l));
  if (after === 'delete') layers = layers.filter((l) => l.id !== layer.id);
  const g = groupLayers(layers, parts.map((l) => l.id), `Traced · ${layer.name}`);
  if (!g) return null;
  store.commit(`Image Trace (${res.colors.length} colour${res.colors.length === 1 ? '' : 's'})`, { layers: g.layers, activeId: g.group.id }, { icon: 'shape' });
  store.toast(`Traced into ${res.colors.length} colour path${res.colors.length === 1 ? '' : 's'} · ${res.anchorCount.toLocaleString()} anchors`, 'success');
  return { groupId: g.group.id, paths: parts.length, anchors: res.anchorCount, colors: res.colors };
}

/** Traces whatever is visible on the active artboard (all layers flattened). */
export function traceVisible(opts: TraceOptions): ReturnType<typeof traceImage> {
  const doc = store.doc;
  if (!doc) return null;
  const flat = flatten(doc);
  const c = createCanvas(flat.width, flat.height);
  ctx2d(c).drawImage(flat, 0, 0);
  const temp = { ...doc.layers[0], kind: 'raster' as const, canvas: c, x: 0, y: 0, width: c.width, height: c.height, name: 'Artwork' };
  const res = traceLayer(temp, opts);
  if (!res?.layers.length) return null;
  const g = groupLayers([...doc.layers, ...res.layers], res.layers.map((l) => l.id), 'Traced · Artwork');
  if (!g) return null;
  store.commit('Image Trace (visible artwork)', { layers: g.layers, activeId: g.group.id }, { icon: 'shape' });
  return { groupId: g.group.id, paths: res.layers.length, anchors: res.anchorCount, colors: res.colors };
}

/** Template for tracing by hand: the image dimmed and locked, the Pen tool ready. */
export function makeTemplate(layer: Layer, opacity = 0.35) {
  const doc = store.doc;
  if (!doc) return;
  const name = layer.name.startsWith('Template · ') ? layer.name : `Template · ${layer.name}`;
  store.commit('Make Template', { layers: doc.layers.map((l) => (l.id === layer.id ? withLayer(l, { opacity, locked: true, name }) : l)) }, { icon: 'layer' });
  store.setTool('pen');
  store.toast('Template ready: the image is dimmed and locked. Draw over it with the Pen (P)', 'success');
}

export function releaseTemplate(layer: Layer) {
  const doc = store.doc;
  if (!doc) return;
  store.commit('Release Template', { layers: doc.layers.map((l) => (l.id === layer.id ? withLayer(l, { opacity: 1, locked: false, name: l.name.replace(/^Template · /, '') }) : l)) }, { icon: 'layer' });
}

/** Shape layers the colour tools act on: the selected traced group's paths, or the selected shapes. */
export function colorTargets(): Layer[] {
  const doc = store.doc;
  if (!doc) return [];
  const out: Layer[] = [];
  for (const l of store.selectedLayers) {
    if (l.kind === 'group') out.push(...descendants(doc.layers, l.id).filter((d) => d.kind === 'shape' && d.shape));
    else if (l.kind === 'shape' && l.shape) out.push(l);
  }
  return [...new Map(out.map((l) => [l.id, l])).values()];
}

/** Colours in the targets, most used first (by box area). */
export function colorsIn(targets: Layer[]): { color: string; ids: string[] }[] {
  const m = new Map<string, { ids: string[]; area: number }>();
  for (const l of targets) {
    const c = l.shape!.fill.toLowerCase();
    const e = m.get(c) ?? { ids: [], area: 0 };
    e.ids.push(l.id);
    e.area += Math.abs(l.width * l.height);
    m.set(c, e);
  }
  return [...m.entries()].sort((a, b) => b[1].area - a[1].area).map(([color, e]) => ({ color, ids: e.ids }));
}

/** Recolours every target path filled with `from` (fill and its gap stroke). */
export function recolor(from: string, to: string): number {
  const doc = store.doc;
  if (!doc) return 0;
  const ids = new Set(colorTargets().filter((l) => l.shape!.fill.toLowerCase() === from.toLowerCase()).map((l) => l.id));
  if (!ids.size) return 0;
  store.commit('Recolour Trace', {
    layers: doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { shape: { ...l.shape!, fill: to, stroke: l.shape!.stroke.toLowerCase() === from.toLowerCase() ? to : l.shape!.stroke } }) : l)),
  }, { icon: 'shape', coalesce: `recolor:${[...ids].join(',')}` });
  return ids.size;
}

/** Deletes every target path of one colour (e.g. a leftover background). */
export function dropColor(color: string): number {
  const doc = store.doc;
  if (!doc) return 0;
  const ids = new Set(colorTargets().filter((l) => l.shape!.fill.toLowerCase() === color.toLowerCase()).map((l) => l.id));
  if (!ids.size) return 0;
  store.commit('Delete Trace Colour', { layers: doc.layers.filter((l) => !ids.has(l.id)) }, { icon: 'trash' });
  return ids.size;
}

/** Simplifies every target path (all rings), keeping corners. Returns anchors before / after. */
export function simplifyTargets(tolerance = 0.004): { before: number; after: number } {
  const doc = store.doc;
  const targets = colorTargets().filter((l) => l.shape!.points);
  if (!doc || !targets.length) return { before: 0, after: 0 };
  let before = 0, after = 0;
  const next = new Map<string, Layer>();
  for (const l of targets) {
    const s = l.shape!;
    const rings = s.compoundPoints ?? [s.points!];
    const simp = rings.map((r) => {
      before += r.length;
      const out = r.length > 4 ? simplifyPathPoints(r, tolerance) : r;
      after += out.length;
      return out;
    });
    next.set(l.id, withLayer(l, { shape: { ...s, points: simp[0], compoundPoints: s.compoundPoints ? simp : undefined } }));
  }
  store.commit('Simplify Traced Paths', { layers: doc.layers.map((l) => next.get(l.id) ?? l) }, { icon: 'shape' });
  return { before, after };
}

/** Paths of every target merged by colour into one compound path per colour. */
export function mergeByColor(): number {
  const doc = store.doc;
  const targets = colorTargets().filter((l) => l.shape!.points && !l.rotation);
  if (!doc || targets.length < 2) return 0;
  const groups = colorsIn(targets).filter((g) => g.ids.length > 1);
  if (!groups.length) return 0;
  const byId = new Map(targets.map((l) => [l.id, l]));
  const drop = new Set<string>();
  const replace = new Map<string, Layer>();
  for (const g of groups) {
    const ls = g.ids.map((id) => byId.get(id)!);
    // Rings back in document space, then one box for all of them
    const doc2: { x: number; y: number; ix: number; iy: number; ox: number; oy: number; type?: 'corner' | 'smooth' }[][] = [];
    for (const l of ls) for (const r of l.shape!.compoundPoints ?? [l.shape!.points!]) {
      doc2.push(r.map((a) => ({ ...a, x: l.x + a.x * l.width, y: l.y + a.y * l.height, ix: l.x + a.ix * l.width, iy: l.y + a.iy * l.height, ox: l.x + a.ox * l.width, oy: l.y + a.oy * l.height })));
    }
    const all = doc2.flat();
    const x0 = Math.min(...all.flatMap((a) => [a.x, a.ix, a.ox]));
    const y0 = Math.min(...all.flatMap((a) => [a.y, a.iy, a.oy]));
    const W = Math.max(...all.flatMap((a) => [a.x, a.ix, a.ox])) - x0 || 1;
    const H = Math.max(...all.flatMap((a) => [a.y, a.iy, a.oy])) - y0 || 1;
    const rings = doc2.map((r) => r.map((a) => ({ ...a, x: (a.x - x0) / W, y: (a.y - y0) / H, ix: (a.ix - x0) / W, iy: (a.iy - y0) / H, ox: (a.ox - x0) / W, oy: (a.oy - y0) / H })));
    const keep = ls[0];
    replace.set(keep.id, withLayer(keep, { x: x0, y: y0, width: W, height: H, shape: { ...keep.shape!, points: rings[0], compoundPoints: rings.length > 1 ? rings : undefined } }));
    for (const l of ls.slice(1)) drop.add(l.id);
  }
  store.commit('Merge Paths by Colour', { layers: doc.layers.filter((l) => !drop.has(l.id)).map((l) => replace.get(l.id) ?? l) }, { icon: 'shape' });
  return drop.size;
}

/**
 * Picks a preset from what the picture looks like: pixel art (small, few exact colours), line art
 * (thin dark strokes), a logo (two tones), flat colour art, greys, or a photo.
 */
export function suggestPreset(buf: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): string {
  return analyse(buf).preset;
}

interface Analysis {
  preset: string;
  /** Coarse colour buckets covering 95% of the picture. */
  buckets: number;
  /** The border is one flat colour that isn't white (a backdrop worth dropping). */
  flatBackdrop: boolean;
}

function analyse(buf: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): Analysis {
  const { width: w, height: h, data } = buf;
  const N = w * h;
  const step = Math.max(1, Math.floor(N / 40000));
  const exact = new Set<number>();
  const coarse = new Map<number, number>();
  let n = 0, sat = 0;
  for (let i = 0; i < N; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    n++;
    if (exact.size <= 300) exact.add((r << 16) | (g << 8) | b);
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    coarse.set(key, (coarse.get(key) ?? 0) + 1);
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  // Border: one flat, non-white colour all the way round?
  const edge = new Map<number, number>();
  let en = 0;
  const vote = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    if (data[o + 3] < 128) return;
    en++;
    const key = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
    edge.set(key, (edge.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < w; x++) { vote(x, 0); vote(x, h - 1); }
  for (let y = 0; y < h; y++) { vote(0, y); vote(w - 1, y); }
  let topKey = -1, top = 0;
  for (const [k, c] of edge) if (c > top) { top = c; topKey = k; }
  const flatBackdrop = en > 0 && top / en > 0.6 && topKey !== 0xfff && topKey !== 0xffe && ((topKey >> 8) < 14 || ((topKey >> 4) & 15) < 14 || (topKey & 15) < 14);

  if (!n) return { preset: 'logo', buckets: 0, flatBackdrop };
  if (Math.max(w, h) <= 256 && exact.size <= 64) return { preset: 'pixel-art', buckets: exact.size, flatBackdrop };
  const counts = [...coarse.values()].sort((a, b) => b - a);
  let acc = 0, k = 0;
  while (k < counts.length && acc < n * 0.95) acc += counts[k++];
  const grey = sat / n < 18;
  let preset: string;
  if (k <= 2 && grey) {
    // Thin ink (few dark pixels with dark on all four sides) is line art, solid ink a logo
    let dark = 0, inner = 0;
    const isDark = (x: number, y: number) => {
      const o = (y * w + x) * 4;
      return data[o + 3] >= 128 && data[o] + data[o + 1] + data[o + 2] < 384;
    };
    for (let y = 1; y < h - 1; y += Math.max(1, Math.floor(h / 200))) {
      for (let x = 1; x < w - 1; x += Math.max(1, Math.floor(w / 200))) {
        if (!isDark(x, y)) continue;
        dark++;
        if (isDark(x - 1, y) && isDark(x + 1, y) && isDark(x, y - 1) && isDark(x, y + 1)) inner++;
      }
    }
    preset = dark && inner / dark < 0.3 ? 'line-art' : 'logo';
  } else if (k <= 2) preset = flatBackdrop ? 'color-logo' : '3-colors';
  else if (grey) preset = 'grays';
  else if (k <= 16) preset = 'color-logo';
  else preset = 'photo-low';
  return { preset, buckets: k, flatBackdrop };
}

const autoCache = new WeakMap<HTMLCanvasElement, { key: string; res: { presetId: string; opts: TraceOptions; why: string } }>();

/**
 * Auto: looks at the picture and returns the preset that suits it, tuned to it (how many colours
 * flat art needs, dropping a flat coloured backdrop, finer fitting for small pictures).
 */
export function autoTrace(layer: Layer): { presetId: string; opts: TraceOptions; why: string } {
  const c = layer.canvas!;
  const key = `${c.width}x${c.height}:${layer.v ?? 0}`;
  const hit = autoCache.get(c);
  if (hit?.key === key) return hit.res;
  const k = Math.min(1, 240 / Math.max(c.width, c.height));
  let buf: ImageData;
  if (k >= 1 || Math.max(c.width, c.height) <= 256) buf = ctx2d(c).getImageData(0, 0, c.width, c.height);
  else {
    const t = createCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
    ctx2d(t).drawImage(c, 0, 0, t.width, t.height);
    buf = ctx2d(t).getImageData(0, 0, t.width, t.height);
  }
  const a = analyse(buf);
  const preset = TRACE_PRESETS.find((p) => p.id === a.preset) ?? TRACE_PRESETS[0];
  const opts: TraceOptions = { ...preset.opts };
  const why: string[] = [preset.label];
  if (opts.mode === 'color' && preset.id === 'color-logo') {
    opts.colors = a.buckets > 6 ? 24 : 12;
    if (a.flatBackdrop) why.push('backdrop dropped');
    else opts.removeBackground = false;
  }
  if (opts.autoColors) why.push('colours found automatically');
  // Small pictures: every pixel matters, so fit closer and keep smaller details
  const side = Math.max(c.width, c.height);
  if (side < 500 && opts.mode !== 'pixel-exact') {
    opts.simplification = Math.max(0.5, (opts.simplification ?? 1) * 0.85);
    opts.minArea = Math.max(2, Math.round((opts.minArea ?? 4) / 2));
  }
  const res = { presetId: preset.id, opts, why: why.join(' · ') };
  autoCache.set(c, { key, res });
  return res;
}

/** Brand colours typed as text ("#e11d48, 0f172a") → hex list. */
export function parsePalette(text: string): string[] {
  return text.split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^#?[0-9a-f]{6}$/i.test(x)).map((x) => (x.startsWith('#') ? x : `#${x}`).toLowerCase());
}

/** The settings the Image Trace tool and the Trace studio share (Auto resolves per picture). */
export function currentTraceOptions(layer: Layer | null): TraceOptions {
  const o = store.state.opts;
  let opts: TraceOptions = o.tracePreset === 'auto' && layer?.canvas ? autoTrace(layer).opts : { ...o.traceOpts };
  const pal = parsePalette(o.tracePalette);
  if (pal.length && (opts.mode === 'color' || opts.mode === 'bw' || opts.mode === 'line-art' || opts.mode === 'centerline')) opts = { ...opts, palette: pal, autoColors: false };
  if (o.traceOutput === 'shapes') opts = { ...opts, split: true };
  return opts;
}

/**
 * Traces `layer` (or a `crop` of it, in its canvas pixels) off the main thread and puts the result
 * right above it: grouped, loose, or as one path per separate shape. One undo step.
 */
export async function runTrace(layer: Layer, opts: TraceOptions, o: { after?: SourceAfter; output?: TraceOutput; crop?: { x: number; y: number; width: number; height: number } } = {}) {
  const doc = store.doc;
  if (!doc || !layer.canvas || traceOverlay.busy) return null;
  traceOverlay.busy = true;
  store.requestRender();
  try {
    const res = await store.task('Tracing image…', () => traceLayerAsync(layer, opts, o.crop));
    if (!res || !res.layers.length) {
      store.toast('Nothing to trace here: try another preset or threshold', 'info');
      return null;
    }
    // The document may have changed while the worker ran
    const now = store.doc;
    if (!now || now.id !== doc.id || !now.layers.some((l) => l.id === layer.id)) return null;
    return placeResult(layer, res, o.after ?? 'hide', o.output ?? 'group', !!o.crop);
  } finally {
    traceOverlay.busy = false;
    store.requestRender();
  }
}

function placeResult(layer: Layer, res: TraceResult, after: SourceAfter, output: TraceOutput, partial: boolean) {
  const doc = store.doc!;
  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const parts = res.layers.map((l) => ({ ...l, parent: layer.parent }));
  let layers = [...doc.layers.slice(0, idx + 1), ...parts, ...doc.layers.slice(idx + 1)];
  // A traced region leaves the rest of the picture alone
  const fate = partial ? 'keep' : after;
  if (fate === 'hide') layers = layers.map((l) => (l.id === layer.id ? withLayer(l, { visible: false }) : l));
  if (fate === 'delete') layers = layers.filter((l) => l.id !== layer.id);
  const label = `Image Trace (${res.colors.length} colour${res.colors.length === 1 ? '' : 's'})`;
  const what = `${parts.length.toLocaleString()} path${parts.length === 1 ? '' : 's'} · ${res.colors.length} colour${res.colors.length === 1 ? '' : 's'} · ${res.anchorCount.toLocaleString()} anchors`;
  if (output === 'group') {
    const g = groupLayers(layers, parts.map((l) => l.id), `Traced · ${layer.name}`);
    if (!g) return null;
    store.commit(label, { layers: g.layers, activeId: g.group.id }, { icon: 'shape' });
    store.toast(`Traced into ${what}`, 'success');
    return { groupId: g.group.id, ids: parts.map((l) => l.id), paths: parts.length, anchors: res.anchorCount, colors: res.colors };
  }
  store.commit(label, { layers, activeId: parts[parts.length - 1].id }, { icon: 'shape' });
  store.setSelectedLayers(parts.map((l) => l.id));
  store.toast(`Traced into ${what}${output === 'shapes' ? ', each shape on its own' : ''}`, 'success');
  return { groupId: null, ids: parts.map((l) => l.id), paths: parts.length, anchors: res.anchorCount, colors: res.colors };
}

// ---------------------------------------------------------------- expand / ungroup a trace

type Anchor = NonNullable<NonNullable<Layer['shape']>['points']>[number];

const ringArea = (r: Anchor[]) => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    a += r[i].x * r[j].y - r[j].x * r[i].y;
  }
  return a / 2;
};

function insideRing(p: { x: number; y: number }, ring: Anchor[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * One compound path → one path per separate shape (outer ring plus the holes inside it). Rings are
 * told apart by winding, as the tracer writes them; works in the layer's own (normalised) space.
 */
export function splitCompound(l: Layer): Layer[] {
  const s = l.shape;
  if (!s?.compoundPoints || s.compoundPoints.length < 2) return [l];
  const rings = s.compoundPoints;
  // The sign of the biggest ring is "outer"
  const signs = rings.map((r) => Math.sign(ringArea(r) * (l.width || 1) * (l.height || 1)));
  const big = rings.reduce((bi, r, i) => (Math.abs(ringArea(r)) > Math.abs(ringArea(rings[bi])) ? i : bi), 0);
  const outerSign = signs[big] || 1;
  const outers = rings.map((r, i) => ({ r, i, area: Math.abs(ringArea(r)) })).filter((o) => signs[o.i] === outerSign).sort((a, b) => a.area - b.area);
  if (outers.length < 2) return [l];
  const holes = new Map<number, Anchor[][]>(outers.map((o) => [o.i, []]));
  rings.forEach((r, i) => {
    if (signs[i] === outerSign) return;
    // Middle of the hole's first segment: on no other ring
    const p = { x: (r[0].x + r[1 % r.length].x) / 2, y: (r[0].y + r[1 % r.length].y) / 2 };
    const host = outers.find((o) => insideRing(p, o.r));
    if (host) holes.get(host.i)!.push(r);
  });
  const toDoc = (a: Anchor) => ({ ...a, x: l.x + a.x * l.width, y: l.y + a.y * l.height, ix: l.x + a.ix * l.width, iy: l.y + a.iy * l.height, ox: l.x + a.ox * l.width, oy: l.y + a.oy * l.height });
  return outers.sort((a, b) => b.area - a.area).map((o, k) => {
    const docRings = [o.r, ...holes.get(o.i)!].map((r) => r.map(toDoc));
    const bb = curveBounds(docRings);
    const x0 = bb.x, y0 = bb.y, W = bb.width || 1, H = bb.height || 1;
    const norm = docRings.map((r) => r.map((a) => ({ ...a, x: (a.x - x0) / W, y: (a.y - y0) / H, ix: (a.ix - x0) / W, iy: (a.iy - y0) / H, ox: (a.ox - x0) / W, oy: (a.oy - y0) / H })));
    return makeLayer({ ...l, name: `${l.name.replace(/ · \d+$/, '')} · ${k + 1}`, x: x0, y: y0, width: W, height: H, shape: { ...s, points: norm[0], compoundPoints: norm.length > 1 ? norm : undefined } });
  });
}

/**
 * Expand a trace: ungroups the selected traced groups and splits every compound path into one path
 * per separate shape, so each piece can be moved, recoloured or deleted on its own.
 */
export function expandTrace(opts: { split?: boolean } = {}): number {
  const doc = store.doc;
  if (!doc) return 0;
  const split = opts.split ?? true;
  const sel = store.selectedLayers;
  let layers = doc.layers;
  const groups = sel.filter((l) => l.kind === 'group');
  const targets = new Set<string>();
  for (const g of groups) {
    for (const d of descendants(layers, g.id)) if (d.kind === 'shape') targets.add(d.id);
    // Nested groups open too, so every path ends up loose
    for (const sub of [...descendants(layers, g.id).filter((d) => d.kind === 'group').reverse(), g]) layers = ungroup(layers, sub.id);
  }
  for (const l of sel) if (l.kind === 'shape') targets.add(l.id);
  if (!targets.size) return 0;
  const out: Layer[] = [];
  const picked: string[] = [];
  for (const l of layers) {
    if (!targets.has(l.id)) { out.push(l); continue; }
    const parts = split && l.kind === 'shape' && !l.rotation ? splitCompound(l) : [l];
    out.push(...parts);
    picked.push(...parts.map((p) => p.id));
  }
  store.commit(split ? 'Expand Trace' : 'Ungroup Trace', { layers: out, activeId: picked[picked.length - 1] }, { icon: 'shape' });
  store.setSelectedLayers(picked);
  store.toast(`${picked.length.toLocaleString()} separate path${picked.length === 1 ? '' : 's'}${split ? ' — every shape on its own' : ''}`, 'success');
  return picked.length;
}

// ---------------------------------------------------------------- the Image Trace tool

/** What the viewport draws for the Image Trace tool. */
export const traceOverlay = {
  hover: null as null | { x: number; y: number; width: number; height: number; name: string },
  drag: null as null | { x: number; y: number; width: number; height: number },
  busy: false,
};

/** The topmost visible, unlocked picture whose box holds the point (transparent parts count). */
export function rasterAt(p: { x: number; y: number }): Layer | null {
  const doc = store.doc;
  if (!doc) return null;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.kind !== 'raster' || !l.canvas || !l.visible || l.locked) continue;
    if (l.parent && !doc.layers.some((g) => g.id === l.parent && g.visible)) continue;
    const w = l.width || l.canvas.width, h = l.height || l.canvas.height;
    if (p.x >= l.x && p.y >= l.y && p.x < l.x + w && p.y < l.y + h) return l;
  }
  return null;
}

let toolDrag: { layer: Layer; start: { x: number; y: number } } | null = null;

/** Pointer down: on a picture starts a click (trace it all) or a drag (trace a region). ⌥ samples a colour. */
export function traceToolDown(p: { x: number; y: number }, alt: boolean): void {
  const l = rasterAt(p);
  if (!l) {
    store.toast('Click a picture to trace it, or drag over part of one', 'info');
    return;
  }
  if (alt) {
    const sx = l.canvas!.width / (l.width || l.canvas!.width), sy = l.canvas!.height / (l.height || l.canvas!.height);
    const d = ctx2d(l.canvas!).getImageData(Math.floor((p.x - l.x) * sx), Math.floor((p.y - l.y) * sy), 1, 1).data;
    if (d[3] < 128) return;
    const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    const pal = parsePalette(store.state.opts.tracePalette);
    if (!pal.includes(hex)) {
      store.set({ opts: { ...store.state.opts, tracePalette: [...pal, hex].join(', ') } });
      store.toast(`Trace colours: ${[...pal, hex].length} — traces now use exactly these (clear them in the options bar)`, 'success');
    }
    return;
  }
  toolDrag = { layer: l, start: p };
  traceOverlay.drag = { x: p.x, y: p.y, width: 0, height: 0 };
}

export function traceToolMove(p: { x: number; y: number }, buttons: number): void {
  if (buttons && toolDrag) {
    traceOverlay.drag = { x: Math.min(toolDrag.start.x, p.x), y: Math.min(toolDrag.start.y, p.y), width: Math.abs(p.x - toolDrag.start.x), height: Math.abs(p.y - toolDrag.start.y) };
  } else {
    const l = rasterAt(p);
    traceOverlay.hover = l ? { x: l.x, y: l.y, width: l.width || l.canvas!.width, height: l.height || l.canvas!.height, name: l.name } : null;
  }
  store.requestRender();
}

export async function traceToolUp(zoom: number): Promise<void> {
  const d = toolDrag;
  const r = traceOverlay.drag;
  toolDrag = null;
  traceOverlay.drag = null;
  store.requestRender();
  if (!d) return;
  const l = d.layer;
  const o = store.state.opts;
  let crop: { x: number; y: number; width: number; height: number } | undefined;
  if (r && r.width * zoom > 6 && r.height * zoom > 6) {
    const sx = l.canvas!.width / (l.width || l.canvas!.width), sy = l.canvas!.height / (l.height || l.canvas!.height);
    const x0 = Math.max(0, (r.x - l.x) * sx), y0 = Math.max(0, (r.y - l.y) * sy);
    const x1 = Math.min(l.canvas!.width, (r.x + r.width - l.x) * sx), y1 = Math.min(l.canvas!.height, (r.y + r.height - l.y) * sy);
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    crop = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  await runTrace(l, currentTraceOptions(l), { after: o.traceAfter, output: o.traceOutput, crop });
}
