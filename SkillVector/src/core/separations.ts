// Ink separations of a document, as they will print: one plate per process ink (C, M, Y, K) and per spot
// colour. Each visible layer is rendered on its own and mapped to its exact ink values (PrintColors: the
// Paint behind every colour), then composited plate by plate:
//   - knockout (default): the layer's inks replace what is below, by its coverage;
//   - overprint (Attributes ▸ Overprint Fill / Stroke, OPM 1): only the inks the layer uses replace the ones
//     below; inks at 0 % leave the plates below untouched.
// Used by View ▸ Overprint Preview and Window ▸ Separations Preview (and the ink readout).

import type { Doc, Layer } from './types';
import { DocRenderer, type RenderView } from './render';
import { ctx2d } from './canvas';
import { simulatePrint } from './color';
import { PrintColors } from './formats/vectorPdf';

export interface Plate {
  name: string;
  kind: 'process' | 'spot';
  /** What 100 % of this ink looks like, as CMYK 0..1 (process: the ink itself; spot: its alternate). */
  ink: [number, number, number, number];
  /** Coverage 0..1 per pixel. */
  data: Float32Array;
}

export interface Separations {
  w: number;
  h: number;
  view: RenderView;
  plates: Plate[];
  /** Where anything prints at all (0..1): outside it the canvas stays as it is (pasteboard). */
  cover: Float32Array;
}

export const PROCESS = ['Cyan', 'Magenta', 'Yellow', 'Black'] as const;

/**
 * One ink of one pixel after a layer: knockout replaces what's below by the layer's coverage `a`; overprint
 * (OPM 1) leaves the plate untouched where the layer has none of this ink.
 */
export function mixInk(below: number, v: number, a: number, overprint: boolean): number {
  if (overprint && v === 0) return below;
  return below + (v - below) * a;
}

/** Visible leaf layers bottom → top (groups contribute their contents; adjustments don't print as ink). */
function printedLayers(doc: Doc): Layer[] {
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  const shown = (l: Layer): boolean => {
    for (let p: Layer | undefined = l; p; p = p.parent ? byId.get(p.parent) : undefined) if (!p.visible) return false;
    return true;
  };
  return doc.layers.filter((l) => l.kind !== 'group' && l.kind !== 'adjustment' && shown(l));
}

/** The layer split into what overprints and what knocks out (fill and stroke can differ). */
function parts(l: Layer): { layer: Layer; overprint: boolean }[] {
  const s = l.shape;
  if (!s || (!l.overprintFill && !l.overprintStroke)) return [{ layer: l, overprint: false }];
  if (!!l.overprintFill === !!l.overprintStroke) return [{ layer: l, overprint: true }];
  const out: { layer: Layer; overprint: boolean }[] = [];
  if (s.fillEnabled !== false) out.push({ layer: { ...l, shape: { ...s, strokeWidth: 0 } } as Layer, overprint: !!l.overprintFill });
  if ((s.strokeWidth ?? 0) > 0) out.push({ layer: { ...l, shape: { ...s, fillEnabled: false } } as Layer, overprint: !!l.overprintStroke });
  return out;
}

/** Separates the document over `view` (the same view the canvas renders). */
export function separateDoc(doc: Doc, view: RenderView): Separations {
  const colors = new PrintColors(doc);
  const n = view.w * view.h;
  const plates: Plate[] = PROCESS.map((name, i) => ({ name, kind: 'process' as const, ink: [0, 1, 2, 3].map((j) => (j === i ? 1 : 0)) as Plate['ink'], data: new Float32Array(n) }));
  const cover = new Float32Array(n);
  const spotPlate = new Map<number, Plate>();
  const plateOfSpot = (i: number) => {
    let p = spotPlate.get(i);
    if (!p) {
      const sp = colors.spots[i];
      p = { name: sp.name, kind: 'spot', ink: [...sp.alt] as Plate['ink'], data: new Float32Array(n) };
      spotPlate.set(i, p);
      plates.push(p);
    }
    return p;
  };
  // colour → inks, cached (artwork has few colours)
  type Inks = { c: [number, number, number, number]; spot: number; tint: number };
  const cache = new Map<number, Inks>();
  const inksOf = (r: number, g: number, b: number): Inks => {
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (!v) {
      const pc = colors.cmyk ? colors.resolve(r / 255, g / 255, b / 255) : { space: 'cmyk' as const, v: colors.separate(r / 255, g / 255, b / 255) };
      if (pc.space === 'spot') v = { c: [0, 0, 0, 0], spot: pc.spot!, tint: pc.v[0] };
      else if (pc.space === 'gray') v = { c: [0, 0, 0, 1 - pc.v[0]], spot: -1, tint: 0 };
      else if (pc.space === 'cmyk') v = { c: pc.v as Inks['c'], spot: -1, tint: 0 };
      else v = { c: colors.separate(pc.v[0], pc.v[1], pc.v[2]), spot: -1, tint: 0 };
      cache.set(key, v);
    }
    return v;
  };

  for (const l of printedLayers(doc)) {
    for (const part of parts(l)) {
      const sub: Doc = { ...doc, layers: [{ ...part.layer, parent: undefined } as Layer] };
      const img = new DocRenderer().render(sub, undefined, view);
      const px = ctx2d(img).getImageData(0, 0, view.w, view.h).data;
      for (let i = 0; i < n; i++) {
        const a8 = px[i * 4 + 3];
        if (!a8) continue;
        const a = a8 / 255;
        cover[i] += (1 - cover[i]) * a;
        const ink = inksOf(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        if (ink.spot >= 0) plateOfSpot(ink.spot);
        for (let c = 0; c < 4; c++) {
          plates[c].data[i] = mixInk(plates[c].data[i], ink.c[c], a, part.overprint);
        }
        for (const [si, p] of spotPlate) {
          p.data[i] = mixInk(p.data[i], si === ink.spot ? ink.tint : 0, a, part.overprint);
        }
      }
    }
  }
  return { w: view.w, h: view.h, view, plates, cover };
}

/**
 * The separations as a screen image: visible plates combined as inks on paper, or one plate alone in grayscale
 * (`solo`). Hidden plates print nothing.
 */
export function compositeSeparations(
  sep: Separations,
  hidden: ReadonlySet<string> = new Set(),
  solo?: string,
  /** CMYK (0..100) → screen sRGB; defaults to the coated-paper model, or pass an ICC output profile's transform. */
  inkToRgb: (c: number, m: number, y: number, k: number) => readonly [number, number, number] = simulatePrint,
): ImageData {
  const { w, h, plates } = sep;
  const out = new ImageData(w, h);
  const d = out.data;
  const n = w * h;
  if (solo) {
    const p = plates.find((x) => x.name === solo);
    for (let i = 0; i < n; i++) {
      const g = Math.round(255 * (1 - (p ? p.data[i] : 0)));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
      d[i * 4 + 3] = Math.round(sep.cover[i] * 255);
    }
    return out;
  }
  const on = plates.map((p) => !hidden.has(p.name));
  const spots = plates.slice(4).map((p, k) => ({ p, on: on[4 + k], rgb: inkToRgb(p.ink[0] * 100, p.ink[1] * 100, p.ink[2] * 100, p.ink[3] * 100) }));
  const cache = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    // process inks quantised to 0.5 % for the cache (finer than the eye can see on screen)
    const q = [0, 1, 2, 3].map((c) => (on[c] ? Math.round(plates[c].data[i] * 200) : 0));
    const key = ((q[0] * 201 + q[1]) * 201 + q[2]) * 201 + q[3];
    let rgb = cache.get(key);
    if (!rgb) {
      rgb = inkToRgb(q[0] / 2, q[1] / 2, q[2] / 2, q[3] / 2) as [number, number, number];
      cache.set(key, rgb);
    }
    let r = rgb[0], g = rgb[1], b = rgb[2];
    // spot inks print over the process inks: each one filters the light by its colour and tint
    for (const s of spots) {
      if (!s.on) continue;
      const t = s.p.data[i];
      if (!t) continue;
      r *= 1 - t * (1 - s.rgb[0] / 255);
      g *= 1 - t * (1 - s.rgb[1] / 255);
      b *= 1 - t * (1 - s.rgb[2] / 255);
    }
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = Math.round(sep.cover[i] * 255);
  }
  return out;
}

/** Ink per plate (0..100 %) at a pixel of the separations, and the total ink coverage. */
export function inkAt(sep: Separations, x: number, y: number): { plates: { name: string; value: number }[]; total: number } | null {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= sep.w || yi >= sep.h) return null;
  const i = yi * sep.w + xi;
  const plates = sep.plates.map((p) => ({ name: p.name, value: Math.round(p.data[i] * 1000) / 10 }));
  return { plates, total: Math.round(plates.reduce((a, p) => a + p.value, 0) * 10) / 10 };
}
