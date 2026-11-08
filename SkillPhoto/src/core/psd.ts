// Photoshop (.psd) import and export through ag-psd (loaded on demand).
//
// Kept on both sides: pixel layers, groups (open / closed), names, visibility, opacity, fill
// opacity, all blend modes, clipping masks, layer masks and layer styles (drop shadow, inner
// shadow, outer / inner glow, bevel, color and gradient overlay, stroke).
// Text and shape layers are written as pixels with their names; adjustment layers have no PSD
// equivalent here, so they are left out of the layer list (the composite keeps their look).

import type { Layer as PsdLayer, Psd, BlendMode as PsdBlend, LayerEffectsInfo, Color as PsdColor, UnitsValue } from 'ag-psd';
import type { BlendMode, Doc, Layer, LayerFx } from './types';
import { defaultFx, fullFx, hasFx, makeLayer } from './types';
import { createCanvas, ctx2d } from './canvas';
import { renderDocument } from './render';
import { childrenOf } from './groups';
import { hexRgb } from './effects';

// ---------------------------------------------------------------- mapping helpers

const TO_PSD: Partial<Record<BlendMode, PsdBlend>> = {
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  lighter: 'linear dodge',
  'hard-light': 'hard light',
  'soft-light': 'soft light',
  'linear-burn': 'linear burn',
  'darker-color': 'darker color',
  'lighter-color': 'lighter color',
  'vivid-light': 'vivid light',
  'linear-light': 'linear light',
  'pin-light': 'pin light',
  'hard-mix': 'hard mix',
};

export function blendToPsd(b: BlendMode): PsdBlend {
  if (b === 'pass-through') return 'pass through';
  return TO_PSD[b] ?? (b as PsdBlend);
}

export function blendFromPsd(b: PsdBlend | undefined): BlendMode {
  if (b === 'pass through') return 'pass-through';
  if (!b || b === 'linear height' || b === 'height') return 'normal';
  if (b === 'subtraction') return 'subtract';
  const hit = (Object.keys(TO_PSD) as BlendMode[]).find((k) => TO_PSD[k] === b);
  return hit ?? (b as BlendMode);
}

const px = (value: number): UnitsValue => ({ units: 'Pixels', value });
const unit = (u: UnitsValue | undefined, fallback: number) => (u && Number.isFinite(u.value) ? u.value : fallback);

function rgb(hex: string): PsdColor {
  const [r, g, b] = hexRgb(hex);
  return { r, g, b };
}

function hex(c: PsdColor | undefined, fallback: string): string {
  if (!c) return fallback;
  let r: number, g: number, b: number;
  if ('r' in c) [r, g, b] = [c.r, c.g, c.b];
  else if ('fr' in c) [r, g, b] = [c.fr * 255, c.fg * 255, c.fb * 255];
  else if ('k' in c && !('c' in c)) r = g = b = 255 - c.k * 2.55;
  else return fallback;
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Our layer styles → Photoshop's effect descriptors. */
export function fxToPsd(fxIn: LayerFx): LayerEffectsInfo {
  const fx = fullFx(fxIn);
  const out: LayerEffectsInfo = {};
  const ds = fx.dropShadow;
  if (ds.enabled) out.dropShadow = [{ enabled: true, present: true, showInDialog: true, color: rgb(ds.color), opacity: ds.opacity / 100, angle: ds.angle, distance: px(ds.distance), size: px(ds.size), choke: px(ds.spread), blendMode: 'normal', useGlobalLight: false, layerConceals: true }];
  const is = fx.innerShadow;
  if (is.enabled) out.innerShadow = [{ enabled: true, present: true, showInDialog: true, color: rgb(is.color), opacity: is.opacity / 100, angle: is.angle, distance: px(is.distance), size: px(is.size), choke: px(is.spread), blendMode: 'normal', useGlobalLight: false }];
  const og = fx.outerGlow;
  if (og.enabled) out.outerGlow = { enabled: true, present: true, showInDialog: true, color: rgb(og.color), opacity: og.opacity / 100, size: px(og.size), choke: px(og.spread), blendMode: 'normal' };
  const ig = fx.innerGlow;
  if (ig.enabled) out.innerGlow = { enabled: true, present: true, showInDialog: true, color: rgb(ig.color), opacity: ig.opacity / 100, size: px(ig.size), choke: px(ig.spread), blendMode: 'normal', source: 'edge' };
  const bv = fx.bevel;
  if (bv.enabled)
    out.bevel = {
      enabled: true, present: true, showInDialog: true, size: px(bv.size), strength: bv.depth, angle: bv.angle, altitude: bv.altitude, useGlobalLight: false,
      highlightColor: rgb(bv.highlight), shadowColor: rgb(bv.shadow), highlightOpacity: bv.opacity / 100, shadowOpacity: bv.opacity / 100,
      highlightBlendMode: 'screen', shadowBlendMode: 'multiply', style: 'inner bevel', technique: 'smooth', direction: 'up',
    };
  const co = fx.colorOverlay;
  if (co.enabled) out.solidFill = [{ enabled: true, present: true, showInDialog: true, color: rgb(co.color), opacity: co.opacity / 100, blendMode: 'normal' }];
  const go = fx.gradientOverlay;
  if (go.enabled)
    out.gradientOverlay = [{
      enabled: true, present: true, showInDialog: true, opacity: go.opacity / 100, angle: go.angle, type: 'linear', blendMode: 'normal', align: true, scale: 100,
      gradient: {
        name: 'Custom', type: 'solid',
        colorStops: [{ color: rgb(go.from), location: 0, midpoint: 50 }, { color: rgb(go.to), location: 1, midpoint: 50 }],
        opacityStops: [{ opacity: 1, location: 0, midpoint: 50 }, { opacity: 1, location: 1, midpoint: 50 }],
      },
    }];
  const st = fx.stroke;
  if (st.enabled) out.stroke = [{ enabled: true, present: true, showInDialog: true, size: px(st.size), position: st.position, fillType: 'color', color: rgb(st.color), opacity: st.opacity / 100, blendMode: 'normal' }];
  return out;
}

/** Photoshop effects → our layer styles (the ones we render; others are dropped). */
export function fxFromPsd(e: LayerEffectsInfo | undefined): LayerFx | undefined {
  if (!e || e.disabled) return undefined;
  const fx = defaultFx();
  const pct = (v: number | undefined, d: number) => Math.round((v ?? d / 100) * 100);
  const ds = e.dropShadow?.find((s) => s.enabled !== false);
  if (ds) fx.dropShadow = { enabled: true, color: hex(ds.color, '#000000'), opacity: pct(ds.opacity, 75), angle: ds.angle ?? 120, distance: unit(ds.distance, 5), size: unit(ds.size, 5), spread: unit(ds.choke, 0) };
  const is = e.innerShadow?.find((s) => s.enabled !== false);
  if (is) fx.innerShadow = { enabled: true, color: hex(is.color, '#000000'), opacity: pct(is.opacity, 75), angle: is.angle ?? 120, distance: unit(is.distance, 5), size: unit(is.size, 5), spread: unit(is.choke, 0) };
  const og = e.outerGlow;
  if (og && og.enabled !== false) fx.outerGlow = { enabled: true, color: hex(og.color, '#ffffbe'), opacity: pct(og.opacity, 75), size: unit(og.size, 5), spread: unit(og.choke, 0) };
  const ig = e.innerGlow;
  if (ig && ig.enabled !== false) fx.innerGlow = { enabled: true, color: hex(ig.color, '#ffffbe'), opacity: pct(ig.opacity, 75), size: unit(ig.size, 5), spread: unit(ig.choke, 0) };
  const bv = e.bevel;
  if (bv && bv.enabled !== false)
    fx.bevel = { enabled: true, size: unit(bv.size, 5), depth: bv.strength ?? 100, angle: bv.angle ?? 120, altitude: bv.altitude ?? 30, highlight: hex(bv.highlightColor, '#ffffff'), shadow: hex(bv.shadowColor, '#000000'), opacity: pct(bv.highlightOpacity, 75) };
  const co = e.solidFill?.find((s) => s.enabled !== false);
  if (co) fx.colorOverlay = { enabled: true, color: hex(co.color, '#ff0000'), opacity: pct(co.opacity, 100) };
  const go = e.gradientOverlay?.find((s) => s.enabled !== false);
  if (go && go.gradient?.type === 'solid' && go.gradient.colorStops.length) {
    const stops = [...go.gradient.colorStops].sort((a, b) => a.location - b.location);
    const [first, last] = go.reverse ? [stops[stops.length - 1], stops[0]] : [stops[0], stops[stops.length - 1]];
    fx.gradientOverlay = { enabled: true, from: hex(first.color, '#000000'), to: hex(last.color, '#ffffff'), angle: go.angle ?? 90, opacity: pct(go.opacity, 100) };
  }
  const st = e.stroke?.find((s) => s.enabled !== false && (s.fillType ?? 'color') === 'color');
  if (st) fx.stroke = { enabled: true, color: hex(st.color, '#000000'), opacity: pct(st.opacity, 100), size: unit(st.size, 3), position: st.position ?? 'outside' };
  return Object.values(fx).some((x) => x.enabled) ? fx : undefined;
}

// ---------------------------------------------------------------- export

/** Pixels of a layer in document space, as (canvas, left, top). */
function layerPixels(doc: Doc, l: Layer): { canvas: HTMLCanvasElement; left: number; top: number } {
  // Pixel layers keep pixels that hang outside the canvas, like Photoshop does
  if (l.kind === 'raster' && l.canvas) return { canvas: l.canvas, left: Math.round(l.x), top: Math.round(l.y) };
  // Text and shapes: render just this layer, unstyled, at full opacity
  const solo = { ...l, opacity: 1, blend: 'normal' as BlendMode, clip: false, mask: undefined, fx: undefined, fill: 1, parent: undefined, visible: true };
  const full = createCanvas(doc.width, doc.height);
  renderDocument({ ...doc, layers: [solo] }, full);
  return { canvas: full, left: 0, top: 0 };
}

/** Mask alpha → Photoshop's grayscale mask. */
function maskToGray(mask: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(mask.width, mask.height);
  const ctx = ctx2d(c);
  const src = ctx2d(mask).getImageData(0, 0, mask.width, mask.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    d[i] = d[i + 1] = d[i + 2] = a;
    d[i + 3] = 255;
  }
  ctx.putImageData(src, 0, 0);
  return c;
}

export function docToPsd(doc: Doc): { psd: Psd; skipped: number } {
  let skipped = 0;
  const convert = (l: Layer): PsdLayer | null => {
    if (l.kind === 'adjustment') {
      skipped++;
      return null;
    }
    const base: PsdLayer = {
      name: l.name,
      hidden: !l.visible,
      opacity: l.opacity,
      blendMode: l.kind === 'group' && l.blend === 'normal' ? 'pass through' : blendToPsd(l.blend),
      clipping: l.clip,
    };
    if ((l.fill ?? 1) < 1) base.fillOpacity = l.fill ?? 1;
    if (hasFx(l)) base.effects = fxToPsd(l.fx!);
    if (l.mask) {
      base.mask = {
        left: l.mask.x, top: l.mask.y, right: l.mask.x + l.mask.canvas.width, bottom: l.mask.y + l.mask.canvas.height,
        defaultColor: 0, disabled: !l.mask.enabled, canvas: maskToGray(l.mask.canvas),
      };
    }
    if (l.kind === 'group') {
      return { ...base, opened: !l.collapsed, children: childrenOf(doc.layers, l.id).map(convert).filter((x): x is PsdLayer => !!x) };
    }
    const p = layerPixels(doc, l);
    return { ...base, canvas: p.canvas, left: p.left, top: p.top };
  };
  const composite = createCanvas(doc.width, doc.height);
  renderDocument(doc, composite);
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    canvas: composite,
    children: childrenOf(doc.layers, undefined).map(convert).filter((x): x is PsdLayer => !!x),
  };
  return { psd, skipped };
}

export async function psdBytes(doc: Doc): Promise<{ bytes: ArrayBuffer; skipped: number }> {
  const { writePsd } = await import('ag-psd');
  const { psd, skipped } = docToPsd(doc);
  // trimImageData keeps files small; noBackground keeps the bottom layer a normal layer
  return { bytes: writePsd(psd, { trimImageData: true, noBackground: true, generateThumbnail: true }), skipped };
}

// ---------------------------------------------------------------- import

/** Limits for untrusted files (ag-psd's guidance): checked before any bitmap is decoded. */
const MAX_SIDE = 16384;
const MAX_LAYERS = 2000;

function pixelCanvas(data: { data: ArrayLike<number>; width: number; height: number } | undefined): HTMLCanvasElement | null {
  if (!data || !data.width || !data.height) return null;
  const c = createCanvas(data.width, data.height);
  const img = ctx2d(c).createImageData(data.width, data.height);
  img.data.set(data.data as ArrayLike<number>);
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

/** Photoshop's grayscale mask → our alpha mask (canvas covers the mask bounds). */
function grayToMask(data: { data: ArrayLike<number>; width: number; height: number }): HTMLCanvasElement {
  const c = createCanvas(data.width, data.height);
  const img = ctx2d(c).createImageData(data.width, data.height);
  const s = data.data;
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = s[i];
  }
  ctx2d(c).putImageData(img, 0, 0);
  return c;
}

export interface PsdImport {
  width: number;
  height: number;
  layers: Layer[];
  /** Layers we couldn't keep editable (adjustments, smart objects…), imported as pixels or dropped. */
  notes: string[];
}

export async function psdToLayers(buffer: ArrayBuffer): Promise<PsdImport> {
  const ag = await import('ag-psd');
  const psd = ag.readPsd(buffer, { useRawData: true, useRawThumbnail: true, skipThumbnail: true });
  if (psd.width > MAX_SIDE || psd.height > MAX_SIDE) throw new Error(`The document is larger than ${MAX_SIDE}px`);
  if ((psd.bitsPerChannel ?? 8) !== 8) throw new Error('Only 8-bit PSD files are supported');
  if (psd.colorMode !== undefined && psd.colorMode !== 3) throw new Error('Only RGB PSD files are supported');
  const layers: Layer[] = [];
  const notes = new Set<string>();
  let count = 0;

  const visit = (pl: PsdLayer, parent: string | undefined) => {
    if (++count > MAX_LAYERS) throw new Error('Too many layers');
    const common = {
      name: pl.name || 'Layer',
      visible: !pl.hidden,
      opacity: pl.opacity ?? 1,
      blend: blendFromPsd(pl.blendMode),
      clip: !!pl.clipping,
      fill: pl.fillOpacity !== undefined && pl.fillOpacity < 1 ? pl.fillOpacity : undefined,
      fx: fxFromPsd(pl.effects),
      parent,
    };
    let layer: Layer;
    if (pl.children) {
      layer = makeLayer({ kind: 'group', ...common, collapsed: pl.opened === false });
      // Children first: our flat array lists a group's contents below the group
      for (const c of pl.children) visit(c, layer.id);
    } else {
      if (pl.adjustment) notes.add('adjustment layers');
      if (pl.placedLayer) notes.add('smart objects (imported as pixels)');
      if (pl.text) notes.add('text (imported as pixels)');
      const w = (pl.right ?? 0) - (pl.left ?? 0);
      const h = (pl.bottom ?? 0) - (pl.top ?? 0);
      if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`Layer "${common.name}" is too large`);
      const canvas = pixelCanvas(ag.getLayerImageData(pl)) ?? createCanvas(1, 1);
      layer = makeLayer({ kind: 'raster', ...common, canvas, x: pl.left ?? 0, y: pl.top ?? 0, width: canvas.width, height: canvas.height });
    }
    const m = pl.mask;
    if (m && !m.fromVectorData) {
      const mw = (m.right ?? 0) - (m.left ?? 0);
      const mh = (m.bottom ?? 0) - (m.top ?? 0);
      if (mw > MAX_SIDE || mh > MAX_SIDE) throw new Error(`The mask of "${common.name}" is too large`);
      const md = ag.getLayerMaskImageData(pl);
      if (md && md.width && md.height) {
        let canvas = grayToMask(md);
        let mx = m.left ?? 0;
        let my = m.top ?? 0;
        // A white default reveals outside the mask's box: extend the mask over the document
        if ((m.defaultColor ?? 0) >= 128) {
          const full = createCanvas(psd.width, psd.height);
          const fctx = ctx2d(full);
          fctx.fillStyle = '#fff';
          fctx.fillRect(0, 0, psd.width, psd.height);
          fctx.clearRect(mx, my, canvas.width, canvas.height);
          fctx.drawImage(canvas, mx, my);
          canvas = full;
          mx = 0;
          my = 0;
        }
        layer.mask = { canvas, x: mx, y: my, enabled: !m.disabled };
      }
    }
    layers.push(layer);
  };
  for (const pl of psd.children ?? []) visit(pl, undefined);

  // A flat PSD (no layer records) still has its composite image
  if (!layers.length) {
    const comp = pixelCanvas(ag.getCompositeImageData(psd));
    if (!comp) throw new Error('The PSD has no image data');
    layers.push(makeLayer({ kind: 'raster', name: 'Background', canvas: comp, width: comp.width, height: comp.height }));
  }
  return { width: psd.width, height: psd.height, layers, notes: [...notes] };
}
