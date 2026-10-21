// Looks in the document: a look is a Color Lookup adjustment layer named "Look · …", so it stays
// non-destructive (intensity = the layer's LUT amount, toggle it, mask it, change it later).
// Also: the user's own looks (saved adjustments, imported .cube, Match Look) and batch apply.

import { store } from './store';
import type { Adjust, Doc, Layer } from './types';
import { withLayer } from './types';
import { decodeLut, encodeLut, getBuiltinLutData, parseCube, writeCube, type Lut3D } from './lut';
import { colorStats, matchLookLut } from './looks';
import { getAdjustEngine } from './gl';
import { createCanvas, ctx2d } from './canvas';
import { renderDocument } from './render';
import * as ops from './ops';
import { saveBlob } from './io';

export const LOOK_PREFIX = 'Look · ';

export interface LutData {
  name: string;
  size: number;
  data: string;
}

/** A look the user made or imported, kept in this browser / app profile. */
export interface MyLook extends LutData {
  id: string;
  source: 'adjustments' | 'cube' | 'match' | 'custom';
  created: number;
}

export const isLookLayer = (l: Layer | null | undefined): boolean => !!l && l.kind === 'adjustment' && !!l.adjust?.lut && l.name.startsWith(LOOK_PREFIX);

/** The look layer the Looks panel edits: the active one, else the topmost look in the document. */
export function currentLookLayer(doc: Doc | null = store.doc): Layer | null {
  if (!doc) return null;
  const active = doc.layers.find((l) => l.id === doc.activeId);
  return active && isLookLayer(active) ? active : null;
}

/** Applies a look: updates the selected look layer in place, or adds a new look layer on top. */
export function applyLook(lut: LutData, amount?: number): Layer | null {
  const doc = store.doc;
  if (!doc) return null;
  const cur = currentLookLayer(doc);
  if (cur) {
    const next = withLayer(cur, {
      name: LOOK_PREFIX + lut.name,
      adjust: { ...cur.adjust!, lut: { name: lut.name, size: lut.size, data: lut.data, amount: amount ?? cur.adjust!.lut!.amount } },
    });
    store.commit(`Look: ${lut.name}`, { layers: doc.layers.map((l) => (l.id === cur.id ? next : l)) }, { coalesce: `look-${cur.id}` });
    return next;
  }
  const layer = ops.newAdjustmentLayer({ lut: { name: lut.name, size: lut.size, data: lut.data, amount: amount ?? 100 } }, LOOK_PREFIX + lut.name, false);
  return layer ?? null;
}

export function applyBuiltinLook(id: string, amount?: number) {
  const data = getBuiltinLutData(id);
  return data ? applyLook(data, amount) : null;
}

/** Intensity (0..100) of the selected look layer. */
export function setLookAmount(amount: number) {
  const doc = store.doc;
  const cur = currentLookLayer(doc);
  if (!doc || !cur) return;
  const next = withLayer(cur, { adjust: { ...cur.adjust!, lut: { ...cur.adjust!.lut!, amount: Math.max(0, Math.min(100, Math.round(amount))) } } });
  store.commit('Look Intensity', { layers: doc.layers.map((l) => (l.id === cur.id ? next : l)) }, { coalesce: `look-amt-${cur.id}` });
}

// ---------------------------------------------------------------- the user's own looks

const MY_KEY = 'skillphoto.looks.mine';
const FAV_KEY = 'skillphoto.looks.fav';

export function loadMyLooks(): MyLook[] {
  try {
    const raw = localStorage.getItem(MY_KEY);
    const list = raw ? (JSON.parse(raw) as MyLook[]) : [];
    return Array.isArray(list) ? list.filter((l) => l && typeof l.data === 'string' && l.size > 1) : [];
  } catch {
    return [];
  }
}

function saveMyLooks(list: MyLook[]): boolean {
  try {
    localStorage.setItem(MY_KEY, JSON.stringify(list));
    return true;
  } catch {
    store.toast('Not enough room to save more looks: delete some from My Looks', 'error');
    return false;
  }
}

/** Saves a LUT as one of My Looks (stored at up to 25³ to keep the library small). */
export function addMyLook(name: string, lut: Lut3D, source: MyLook['source']): MyLook | null {
  const small = lut.size > 25 ? resampleLut(lut, 25) : lut;
  const look: MyLook = { id: `my-${Date.now().toString(36)}`, name, size: small.size, data: encodeLut(small), source, created: Date.now() };
  const list = [look, ...loadMyLooks()];
  return saveMyLooks(list) ? look : null;
}

export function deleteMyLook(id: string) {
  saveMyLooks(loadMyLooks().filter((l) => l.id !== id));
}

export function renameMyLook(id: string, name: string) {
  saveMyLooks(loadMyLooks().map((l) => (l.id === id ? { ...l, name } : l)));
}

export function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function toggleFavorite(id: string): Set<string> {
  const fav = loadFavorites();
  if (fav.has(id)) fav.delete(id);
  else fav.add(id);
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...fav]));
  } catch {
    /* favourites are a convenience */
  }
  return fav;
}

/** Trilinear resample of a LUT to another size. */
export function resampleLut(lut: Lut3D, size: number): Lut3D {
  const out = new Float32Array(size * size * size * 3);
  const n = lut.size - 1, s = lut.size;
  let k = 0;
  for (let bi = 0; bi < size; bi++) for (let gi = 0; gi < size; gi++) for (let ri = 0; ri < size; ri++) {
    const fr = (ri / (size - 1)) * n, fg = (gi / (size - 1)) * n, fb = (bi / (size - 1)) * n;
    const r0 = Math.min(n - 1, Math.floor(fr)), g0 = Math.min(n - 1, Math.floor(fg)), b0 = Math.min(n - 1, Math.floor(fb));
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    for (let c = 0; c < 3; c++) {
      const at = (r: number, g: number, b: number) => lut.data[((b * s + g) * s + r) * 3 + c];
      const c00 = at(r0, g0, b0) * (1 - tr) + at(r0 + 1, g0, b0) * tr;
      const c10 = at(r0, g0 + 1, b0) * (1 - tr) + at(r0 + 1, g0 + 1, b0) * tr;
      const c01 = at(r0, g0, b0 + 1) * (1 - tr) + at(r0 + 1, g0, b0 + 1) * tr;
      const c11 = at(r0, g0 + 1, b0 + 1) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1) * tr;
      out[k++] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
    }
  }
  return { size, data: out };
}

// ---------------------------------------------------------------- premium: create looks

/** Adjustment settings that change pixels by position, not by colour, so they can't live in a LUT. */
const SPATIAL: (keyof Adjust)[] = ['clarity', 'dehaze', 'sharpen', 'vignette', 'grain'];

/**
 * Save Adjustments as Look: bakes an adjustment layer's colour settings (curves, HSL, grading,
 * channel mixer, selective colour…) into a LUT by running an identity image through the GPU engine.
 */
export function bakeAdjustToLut(adjust: Adjust, size = 25): { lut: Lut3D; skipped: string[] } | null {
  const engine = getAdjustEngine();
  if (!engine) return null;
  const skipped = SPATIAL.filter((k) => (adjust[k] as number) !== 0) as string[];
  const adj: Adjust = { ...adjust };
  for (const k of SPATIAL) (adj as unknown as Record<string, number>)[k] = 0;
  // An image holding every grid colour: x = r + size·b, y = g
  const src = createCanvas(size * size, size);
  const img = ctx2d(src).createImageData(size * size, size);
  for (let g = 0; g < size; g++) for (let b = 0; b < size; b++) for (let r = 0; r < size; r++) {
    const i = (g * size * size + b * size + r) * 4;
    img.data[i] = Math.round((r / (size - 1)) * 255);
    img.data[i + 1] = Math.round((g / (size - 1)) * 255);
    img.data[i + 2] = Math.round((b / (size - 1)) * 255);
    img.data[i + 3] = 255;
  }
  ctx2d(src).putImageData(img, 0, 0);
  const outCanvas = engine.process(src, adj, null);
  const read = createCanvas(size * size, size);
  ctx2d(read).drawImage(outCanvas, 0, 0);
  const px = ctx2d(read).getImageData(0, 0, size * size, size).data;
  const data = new Float32Array(size * size * size * 3);
  let k = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const i = (g * size * size + b * size + r) * 4;
    data[k++] = px[i] / 255;
    data[k++] = px[i + 1] / 255;
    data[k++] = px[i + 2] / 255;
  }
  return { lut: { size, data }, skipped };
}

/** Saves the active adjustment layer's colour grade as one of My Looks. */
export function saveAdjustmentsAsLook(name?: string): MyLook | null {
  const layer = store.activeLayer;
  if (!layer || layer.kind !== 'adjustment' || !layer.adjust || isLookLayer(layer)) {
    store.toast('Select an adjustment layer (curves, HSL, colour grading…) to save as a look');
    return null;
  }
  const baked = bakeAdjustToLut(layer.adjust);
  if (!baked) {
    store.toast('Saving looks needs GPU adjustments (WebGL2)', 'error');
    return null;
  }
  const look = addMyLook(name?.trim() || layer.name.replace(/ adjustment$/i, ''), baked.lut, 'adjustments');
  if (look) {
    store.toast(baked.skipped.length ? `Saved "${look.name}" (without ${baked.skipped.join(', ')}: they work by position, not colour)` : `Saved "${look.name}" to My Looks`, 'success');
  }
  return look;
}

/** Imports .cube files into My Looks. */
export async function importCubeLooks(files: File[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    try {
      const lut = parseCube(await f.text());
      if (addMyLook(f.name.replace(/\.cube$/i, ''), lut, 'cube')) n++;
    } catch (err) {
      store.toast(`${f.name}: ${(err as Error).message}`, 'error');
    }
  }
  if (n) store.toast(`Imported ${n} look${n > 1 ? 's' : ''}`, 'success');
  return n;
}

/** The document as it looks under the look layers (what a look is applied to), downscaled. */
export function lookSource(doc: Doc, maxSide = 900): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(doc.width, doc.height));
  const full = createCanvas(doc.width, doc.height);
  renderDocument({ ...doc, layers: doc.layers.filter((l) => !isLookLayer(l)) }, full);
  if (k === 1) return full;
  const c = createCanvas(Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, c.width, c.height);
  return c;
}

/**
 * Match Look: makes a look that gives this photo the colour of a reference image (average tone,
 * colour cast and contrast), applies it, and keeps it in My Looks.
 */
export async function matchLookFromFile(file: File, strength = 1): Promise<MyLook | null> {
  const doc = store.doc;
  if (!doc) return null;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const ref = createCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  ctx2d(ref).drawImage(bmp, 0, 0, ref.width, ref.height);
  bmp.close?.();
  const src = lookSource(doc, 600);
  const refStats = colorStats(ctx2d(ref).getImageData(0, 0, ref.width, ref.height).data, 2);
  const srcStats = colorStats(ctx2d(src).getImageData(0, 0, src.width, src.height).data, 2);
  const lut = matchLookLut(srcStats, refStats, strength, 25);
  const name = `Match · ${file.name.replace(/\.[a-z0-9]+$/i, '')}`;
  const look = addMyLook(name, lut, 'match');
  applyLook({ name, size: lut.size, data: encodeLut(lut) });
  return look;
}

/** Applies the selected look layer's LUT to every other open photo (each gets its own look layer). */
export function applyLookToAllDocs(): number {
  const doc = store.doc;
  const cur = currentLookLayer(doc);
  const lut = cur?.adjust?.lut;
  if (!doc || !cur || !lut) {
    store.toast('Select a look layer first');
    return 0;
  }
  const startId = store.state.activeDocId;
  let n = 0;
  for (const d of store.state.docs) {
    if (d.id === doc.id) continue;
    store.set({ activeDocId: d.id });
    if (ops.newAdjustmentLayer({ lut: { ...lut } }, cur.name, false)) n++;
  }
  store.set({ activeDocId: startId });
  store.toast(n ? `Applied "${lut.name}" to ${n} more photo${n > 1 ? 's' : ''}` : 'No other photos are open', n ? 'success' : 'info');
  return n;
}

/** Exports a look as an industry-standard .cube file (works in Premiere, Resolve, Final Cut, Lightroom profiles…). */
export async function exportLookCube(lut: LutData) {
  const text = writeCube({ size: lut.size, data: decodeLut(lut.data, lut.size) }, lut.name);
  await saveBlob(new Blob([text], { type: 'text/plain' }), `${lut.name.replace(/[\\/:*?"<>|]/g, '-')}.cube`);
}
