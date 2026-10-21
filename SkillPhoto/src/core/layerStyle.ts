// Layer style editing: per-effect updates, one-click presets, and copy / paste style.

import { store } from './store';
import { record } from './actions';
import type { FxKey, Layer, LayerFx } from './types';
import { defaultFx, fullFx, hasFx, withLayer } from './types';

type FxPatch = { [K in FxKey]?: Partial<LayerFx[K]> };

export interface StylePreset {
  id: string;
  label: string;
  fx: FxPatch;
  fill?: number;
}

const on = { enabled: true };

/** Presets built for social graphics: each replaces the whole style. */
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'soft-shadow', label: 'Soft Shadow', fx: { dropShadow: { ...on, opacity: 35, angle: 90, distance: 10, size: 30 } } },
  { id: 'lifted', label: 'Lifted Card', fx: { dropShadow: { ...on, opacity: 28, angle: 90, distance: 26, size: 56, spread: 0 } } },
  { id: 'hard-shadow', label: 'Retro Offset', fx: { dropShadow: { ...on, opacity: 100, angle: 135, distance: 12, size: 0, color: '#111111' } } },
  { id: 'outline', label: 'Outline', fx: { stroke: { ...on, size: 8, color: '#ffffff', position: 'outside' } } },
  {
    id: 'sticker',
    label: 'Sticker',
    fx: { stroke: { ...on, size: 16, color: '#ffffff', position: 'outside' }, dropShadow: { ...on, opacity: 32, angle: 90, distance: 8, size: 18 } },
  },
  {
    id: 'neon',
    label: 'Neon',
    fx: {
      outerGlow: { ...on, color: '#00e5ff', opacity: 90, size: 36, spread: 8 },
      innerGlow: { ...on, color: '#ffffff', opacity: 70, size: 6 },
      colorOverlay: { ...on, color: '#7df9ff', opacity: 100 },
    },
  },
  { id: 'gradient', label: 'Gradient Pop', fx: { gradientOverlay: { ...on, from: '#7b2ff7', to: '#f107a3', angle: 90 }, dropShadow: { ...on, opacity: 30, angle: 90, distance: 8, size: 20 } } },
  {
    id: 'emboss',
    label: 'Emboss',
    fx: { bevel: { ...on, size: 12, depth: 120, opacity: 75 }, dropShadow: { ...on, opacity: 30, angle: 120, distance: 4, size: 8 } },
  },
  {
    id: 'glass',
    label: 'Glass',
    fill: 0.25,
    fx: {
      bevel: { ...on, size: 10, depth: 80, opacity: 55 },
      innerGlow: { ...on, color: '#ffffff', opacity: 45, size: 18 },
      stroke: { ...on, size: 1, color: '#ffffff', opacity: 55, position: 'inside' },
      dropShadow: { ...on, opacity: 22, angle: 90, distance: 12, size: 32 },
    },
  },
  {
    id: 'long-shadow',
    label: 'Long Shadow',
    fx: { dropShadow: { ...on, opacity: 40, angle: 135, distance: 40, size: 6, spread: 30, color: '#000000' } },
  },
];

export function presetFx(p: StylePreset): LayerFx {
  const fx = defaultFx() as unknown as Record<FxKey, object>;
  for (const k of Object.keys(p.fx) as FxKey[]) fx[k] = { ...fx[k], ...p.fx[k] };
  return fx as unknown as LayerFx;
}

const styleable = (l: Layer | null | undefined): l is Layer => !!l && l.kind !== 'adjustment';

/** Changes one effect on every selected layer (live, coalesced into one undo step). */
export function setEffect<K extends FxKey>(key: K, patch: Partial<LayerFx[K]>) {
  const doc = store.doc;
  if (!doc) return;
  const ids = new Set(store.selectedLayers.filter(styleable).map((l) => l.id));
  if (!ids.size) return;
  const layers = doc.layers.map((l) => {
    if (!ids.has(l.id)) return l;
    const fx = fullFx(l.fx);
    return withLayer(l, { fx: { ...fx, [key]: { ...fx[key], ...patch } } });
  });
  store.commit('Layer Style', { layers }, { icon: 'layer', coalesce: `fx:${key}:${[...ids].join(',')}` });
}

export function setFill(fill: number) {
  const doc = store.doc;
  if (!doc) return;
  const ids = new Set(store.selectedLayers.filter(styleable).map((l) => l.id));
  const layers = doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { fill }) : l));
  store.commit('Fill Opacity', { layers }, { coalesce: `fill:${[...ids].join(',')}` });
}

export function applyPreset(id: string) {
  const p = STYLE_PRESETS.find((x) => x.id === id);
  const doc = store.doc;
  if (!p || !doc) return;
  const ids = new Set(store.selectedLayers.filter(styleable).map((l) => l.id));
  if (!ids.size) return store.toast('Select a pixel, text or shape layer to style');
  const layers = doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { fx: presetFx(p), fill: p.fill ?? 1 }) : l));
  store.commit(`Style: ${p.label}`, { layers }, { icon: 'layer' });
  record({ kind: 'style', preset: id, label: `Layer style: ${p.label}` });
}

export function clearStyle() {
  const doc = store.doc;
  if (!doc) return;
  const ids = new Set(store.selectedLayers.filter((l) => hasFx(l) || (l.fill ?? 1) < 1).map((l) => l.id));
  if (!ids.size) return;
  const layers = doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { fx: undefined, fill: undefined }) : l));
  store.commit('Clear Layer Style', { layers }, { icon: 'layer' });
}

let clipboard: { fx: LayerFx; fill: number } | null = null;

export function copyStyle() {
  const l = store.activeLayer;
  if (!styleable(l) || !hasFx(l)) return store.toast('This layer has no style to copy');
  clipboard = { fx: fullFx(l.fx), fill: l.fill ?? 1 };
  store.toast('Layer style copied', 'success');
}

export function canPasteStyle() {
  return !!clipboard && styleable(store.activeLayer);
}

export function pasteStyle() {
  const doc = store.doc;
  if (!doc || !clipboard) return;
  const ids = new Set(store.selectedLayers.filter(styleable).map((l) => l.id));
  const { fx, fill } = clipboard;
  const layers = doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { fx: structuredClone(fx), fill }) : l));
  store.commit('Paste Layer Style', { layers }, { icon: 'layer' });
}
