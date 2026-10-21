// App side of Auto Tune: measures what's under the adjustment (only the selected area when there is a
// selection), and builds or updates an editable adjustment layer.
import { createCanvas, ctx2d } from './canvas';
import { renderDocument } from './render';
import { store } from './store';
import { defaultAdjust } from './types';
import type { Adjust, Layer } from './types';
import * as ops from './ops';
import { analyze, autoColor, autoContrast, autoTone, autoWhiteBalance, smartTune, whiteBalanceFrom, INTENTS } from './autoTune';
import type { Intent, PhotoStats } from './autoTune';

export const AUTO_PREFIX = 'Auto · ';
const WB_NAME = 'White Balance';

/** The picture below `upTo` (exclusive), as pixels. Without `upTo`, everything visible. */
function pixelsBelow(upTo?: Layer): { data: Uint8ClampedArray; w: number; h: number } | null {
  const doc = store.doc;
  if (!doc) return null;
  const idx = upTo ? doc.layers.findIndex((l) => l.id === upTo.id) : -1;
  const view = idx >= 0 ? { ...doc, layers: doc.layers.slice(0, idx) } : doc;
  const c = createCanvas(doc.width, doc.height);
  renderDocument(view, c);
  return { data: ctx2d(c).getImageData(0, 0, doc.width, doc.height).data, w: doc.width, h: doc.height };
}

function selectionBytes(): Uint8Array | null {
  const doc = store.doc;
  if (!doc?.selection) return null;
  const d = ctx2d(doc.selection.canvas).getImageData(0, 0, doc.width, doc.height).data;
  const out = new Uint8Array(doc.width * doc.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** An Auto Tune layer we made, if it's the active layer. */
export function activeAutoLayer(prefix = AUTO_PREFIX): Layer | null {
  const l = store.activeLayer;
  return l?.kind === 'adjustment' && l.name.startsWith(prefix) ? l : null;
}

/** Intent of the active Auto Tune layer (from its name). */
export function activeIntent(): Intent | null {
  const l = activeAutoLayer();
  if (!l) return null;
  const label = l.name.slice(AUTO_PREFIX.length);
  return ((Object.keys(INTENTS) as Intent[]).find((k) => INTENTS[k].label === label) ?? null) as Intent | null;
}

function stats(upTo?: Layer): PhotoStats | null {
  const px = pixelsBelow(upTo);
  return px ? analyze(px.data, upTo ? null : selectionBytes()) : null;
}

/** Applies (or re-applies at a new strength) an intent. Clicking another intent swaps the active Auto layer. */
export function applyIntent(intent: Intent, strength = 1) {
  const doc = store.doc;
  if (!doc) return;
  const existing = activeAutoLayer();
  const s = stats(existing ?? undefined);
  if (!s) return;
  const recipe = smartTune(s, intent, strength);
  const name = AUTO_PREFIX + INTENTS[intent].label;
  if (existing) {
    ops.setAdjust(existing.id, { ...defaultAdjust(), ...recipe }, `Auto Tune: ${INTENTS[intent].label}`);
    if (existing.name !== name) store.updateLayer(existing.id, { name }, 'Rename Auto Tune', `auto-name:${existing.id}`);
  } else {
    ops.newAdjustmentLayer(recipe, name, false);
    store.toast(`${INTENTS[intent].label} tune added — every slider stays editable in Adjust`, 'success');
  }
}

export type AutoKind = 'tone' | 'contrast' | 'color' | 'wb';
export const AUTO_LABELS: Record<AutoKind, string> = { tone: 'Auto Tone', contrast: 'Auto Contrast', color: 'Auto Color', wb: 'Auto White Balance' };

/** Photoshop-style one-shot autos, as adjustment layers. */
export function applyAuto(kind: AutoKind) {
  const s = stats();
  if (!s) return;
  const recipe: Partial<Adjust> = kind === 'tone' ? autoTone(s) : kind === 'contrast' ? autoContrast(s) : kind === 'color' ? autoColor(s) : autoWhiteBalance(s);
  ops.newAdjustmentLayer(recipe, AUTO_LABELS[kind], false);
}

/**
 * White-balance eyedropper: click something that should be neutral grey or white. Updates the active
 * White Balance layer (measured underneath it) or creates one.
 */
export function whiteBalanceAt(x: number, y: number, size = 5) {
  const doc = store.doc;
  if (!doc) return;
  const existing = activeAutoLayer(WB_NAME);
  const px = pixelsBelow(existing ?? undefined);
  if (!px) return;
  const half = Math.floor(size / 2);
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = Math.floor(y) - half; yy <= Math.floor(y) + half; yy++)
    for (let xx = Math.floor(x) - half; xx <= Math.floor(x) + half; xx++) {
      if (xx < 0 || yy < 0 || xx >= px.w || yy >= px.h) continue;
      const i = (yy * px.w + xx) * 4;
      if (px.data[i + 3] < 128) continue;
      r += px.data[i];
      g += px.data[i + 1];
      b += px.data[i + 2];
      n++;
    }
  if (!n) return;
  const recipe = whiteBalanceFrom([r / n, g / n, b / n]);
  if (existing) ops.setAdjust(existing.id, { ...defaultAdjust(), ...recipe }, 'White Balance');
  else ops.newAdjustmentLayer(recipe, WB_NAME, false);
  store.toast(`White balance set · Temperature ${recipe.temperature}, Tint ${recipe.tint}`, 'success');
}
