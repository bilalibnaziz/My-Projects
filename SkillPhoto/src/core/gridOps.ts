// Layout grids on the canvas: read, edit (undoable), presets, Auto Grid, and the snap lines the
// tools use. The geometry lives in grids.ts. (Skill Vector's copy also handles artboards.)

import { store } from './store';
import type { Doc } from './types';
import { makeLayer } from './types';
import { createCanvas, ctx2d } from './canvas';
import { drawLayoutGrids } from '../ui/gridDraw';
import type { Box, GridSpec } from './grids';
import { autoGridSpecs, gridSnapLines, gridSnapSteps, guessDpi, materialize, presetGrid } from './grids';
import { DOC_PRESETS } from './social';

/** The canvas (Skill Photo has one page per document). */
export const PAGE_ID = 'page';

export interface GridPage {
  id: string;
  name: string;
  box: Box;
  grids: GridSpec[];
}

export function gridPages(doc: Doc): GridPage[] {
  return [{ id: PAGE_ID, name: 'Canvas', box: { x: 0, y: 0, w: doc.width, h: doc.height }, grids: doc.grids ?? [] }];
}

export function activeGridPage(doc: Doc): GridPage {
  return gridPages(doc)[0];
}

/** Print sizes in the New Document presets are 300 dpi; anything else is guessed from its shape. */
export function pageDpi(box: Box): number {
  const p = DOC_PRESETS.find((d) => d.w === Math.round(box.w) && d.h === Math.round(box.h));
  if (p) return p.category === 'Print' || p.category === 'Packaging' ? 300 : 72;
  return guessDpi(box.w, box.h);
}

/** Replaces the canvas grids as an undoable step. */
export function setGrids(_pageId: string, grids: GridSpec[], label = 'Edit Grids', coalesce?: string) {
  const doc = store.doc;
  if (!doc) return;
  doc.grids = grids;
  store.commit(label, {}, { icon: 'grid', coalesce });
}

export function updateGrid(pageId: string, id: string, patch: Partial<GridSpec>, coalesce?: string) {
  const doc = store.doc;
  if (!doc) return;
  setGrids(pageId, (doc.grids ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)), 'Edit Grid', coalesce ?? `grid:${id}`);
}

export function removeGrid(pageId: string, id: string) {
  const doc = store.doc;
  if (doc) setGrids(pageId, (doc.grids ?? []).filter((g) => g.id !== id), 'Remove Grid');
}

export function applyGridPreset(presetId: string, mode: 'add' | 'replace' = 'replace'): GridSpec[] {
  const doc = store.doc;
  const preset = presetGrid(presetId);
  if (!doc || !preset) return [];
  const page = activeGridPage(doc);
  const specs = materialize(preset.build({ w: page.box.w, h: page.box.h, dpi: pageDpi(page.box) }));
  setGrids(page.id, mode === 'add' ? [...page.grids, ...specs] : specs, `Grid: ${preset.label}`);
  showLayoutGrids();
  return specs;
}

/** Auto Grid: picks grids from the canvas size and shape. Returns why. */
export function applyAutoGrid(_all = false): string {
  const doc = store.doc;
  if (!doc) return '';
  const page = activeGridPage(doc);
  const a = autoGridSpecs(page.box.w, page.box.h, pageDpi(page.box));
  setGrids(page.id, a.specs, 'Auto Grid');
  showLayoutGrids();
  return a.reason;
}

export function clearGrids() {
  if (store.doc) setGrids(PAGE_ID, [], 'Clear Grids');
}

function showLayoutGrids() {
  if (!store.state.docGrid.showLayout) store.set({ docGrid: { ...store.state.docGrid, showLayout: true } });
}

/** Lines and steps the move / drawing tools snap to. */
export function layoutSnap(doc: Doc): { xs: number[]; ys: number[]; steps: ReturnType<typeof gridSnapSteps>[] } {
  const g = store.state.docGrid;
  if (!g.showLayout || !g.snapLayout) return { xs: [], ys: [], steps: [] };
  const p = activeGridPage(doc);
  const l = gridSnapLines(p.grids, p.box);
  const s = gridSnapSteps(p.grids, p.box);
  return { xs: l.xs, ys: l.ys, steps: s.x || s.y ? [s] : [] };
}

/**
 * Bake Grid: the visible layout grids become a pixel layer above the artwork, at the document's
 * resolution — for print guides, mock-up boards or sharing the layout.
 */
export function bakeGrids(): number {
  const doc = store.doc;
  if (!doc) return 0;
  const page = activeGridPage(doc);
  const specs = page.grids.filter((g) => g.visible);
  if (!specs.length) {
    store.toast('No visible layout grids — add one in the Grids panel first');
    return 0;
  }
  const canvas = createCanvas(doc.width, doc.height);
  // Line weight and labels scale with the image so they read on a 6000 px photo too
  const k = Math.max(1, Math.round(Math.min(doc.width, doc.height) / 900));
  const ctx = ctx2d(canvas);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawLayoutGrids(ctx, [{ box: { x: 0, y: 0, w: doc.width, h: doc.height }, grids: specs }], { zoom: 1 / k, panX: 0, panY: 0, w: doc.width / k, h: doc.height / k });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const layer = makeLayer({ kind: 'raster', name: 'Grid', canvas, width: doc.width, height: doc.height });
  store.commit('Bake Grid', { layers: [...doc.layers, layer], activeId: layer.id }, { icon: 'grid' });
  store.toast(`Baked ${specs.length} grid${specs.length > 1 ? 's' : ''} into the “Grid” layer`, 'success');
  return 1;
}
