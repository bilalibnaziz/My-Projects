// Layout grids on artboards: read, edit (undoable), presets, Auto Grid, and the snap lines the
// tools use. The geometry lives in grids.ts.

import { store } from './store';
import type { Doc, Layer, PathAnchor } from './types';
import { makeLayer, withLayer } from './types';
import { syncTextBounds } from './render';
import type { Box, GridGeom, GridSpec } from './grids';
import { autoGridSpecs, gridGeometry, gridSnapLines, gridSnapSteps, guessDpi, materialize, presetGrid } from './grids';
import { DOC_PRESETS } from './social';

/** The implicit page of a document without artboards. */
export const PAGE_ID = 'page';

export interface GridPage {
  id: string;
  name: string;
  box: Box;
  grids: GridSpec[];
}

/** Every artboard (or the page) with its box and grids. */
export function gridPages(doc: Doc): GridPage[] {
  if (doc.artboards?.length) return doc.artboards.map((a) => ({ id: a.id, name: a.name, box: { x: a.x, y: a.y, w: a.width, h: a.height }, grids: a.grids ?? [] }));
  return [{ id: PAGE_ID, name: 'Page', box: { x: 0, y: 0, w: doc.width, h: doc.height }, grids: doc.grids ?? [] }];
}

/** The artboard grids are edited on: the active one, else the first. */
export function activeGridPage(doc: Doc): GridPage {
  const pages = gridPages(doc);
  return pages.find((p) => p.id === doc.activeArtboardId) ?? pages[0];
}

/** Print sizes in the New Document presets are 300 dpi; anything else is guessed from its shape. */
export function pageDpi(box: Box): number {
  const p = DOC_PRESETS.find((d) => d.w === Math.round(box.w) && d.h === Math.round(box.h));
  if (p) return p.category === 'Print' || p.category === 'Packaging' ? 300 : 72;
  return guessDpi(box.w, box.h);
}

/** Replaces one page's grids as an undoable step. */
export function setGrids(pageId: string, grids: GridSpec[], label = 'Edit Grids', coalesce?: string) {
  const doc = store.doc;
  if (!doc) return;
  if (pageId === PAGE_ID || !doc.artboards?.length) doc.grids = grids;
  else doc.artboards = doc.artboards.map((a) => (a.id === pageId ? { ...a, grids } : a));
  store.commit(label, {}, { icon: 'grid', coalesce });
}

export function updateGrid(pageId: string, id: string, patch: Partial<GridSpec>, coalesce?: string) {
  const doc = store.doc;
  const page = doc && gridPages(doc).find((p) => p.id === pageId);
  if (!page) return;
  setGrids(pageId, page.grids.map((g) => (g.id === id ? { ...g, ...patch } : g)), 'Edit Grid', coalesce ?? `grid:${id}`);
}

export function removeGrid(pageId: string, id: string) {
  const doc = store.doc;
  const page = doc && gridPages(doc).find((p) => p.id === pageId);
  if (page) setGrids(pageId, page.grids.filter((g) => g.id !== id), 'Remove Grid');
}

/** Adds a preset's grids to the active artboard (or replaces what is there). */
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

/** Auto Grid: picks grids from the active artboard's size and shape. Returns why. */
export function applyAutoGrid(all = false): string {
  const doc = store.doc;
  if (!doc) return '';
  const pages = all ? gridPages(doc) : [activeGridPage(doc)];
  let reason = '';
  for (const page of pages) {
    const a = autoGridSpecs(page.box.w, page.box.h, pageDpi(page.box));
    if (page.id === PAGE_ID || !doc.artboards?.length) doc.grids = a.specs;
    else doc.artboards = doc.artboards!.map((ab) => (ab.id === page.id ? { ...ab, grids: a.specs } : ab));
    reason ||= a.reason;
  }
  store.commit(all ? 'Auto Grid (all artboards)' : 'Auto Grid', {}, { icon: 'grid' });
  showLayoutGrids();
  return reason;
}

export function clearGrids() {
  const doc = store.doc;
  if (!doc) return;
  setGrids(activeGridPage(doc).id, [], 'Clear Grids');
}

function showLayoutGrids() {
  if (!store.state.docGrid.showLayout) store.set({ docGrid: { ...store.state.docGrid, showLayout: true } });
}

/** Lines and steps the move / drawing tools snap to, from every artboard's visible grids. */
export function layoutSnap(doc: Doc): { xs: number[]; ys: number[]; steps: { x?: { step: number; origin: number }; y?: { step: number; origin: number } }[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const steps: ReturnType<typeof gridSnapSteps>[] = [];
  const g = store.state.docGrid;
  if (!g.showLayout || !g.snapLayout) return { xs, ys, steps };
  for (const p of gridPages(doc)) {
    const l = gridSnapLines(p.grids, p.box);
    xs.push(...l.xs);
    ys.push(...l.ys);
    const s = gridSnapSteps(p.grids, p.box);
    if (s.x || s.y) steps.push(s);
  }
  return { xs, ys, steps };
}

// ---------------------------------------------------------------- bake to layers

const pt = (x: number, y: number): PathAnchor => ({ x, y, ix: x, iy: y, ox: x, oy: y });

/** Repeating pattern lines inside their box (capped so a fine grid cannot make a huge file). */
function patternLines(g: GridGeom): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const p of g.patterns) {
    const b = p.box;
    if (p.kind === 'square' || p.kind === 'dots') for (let x = b.x; x <= b.x + b.w + 1e-9 && out.length < 4000; x += p.step) out.push([x, b.y, x, b.y + b.h]);
    if (p.kind !== 'isometric') for (let y = b.y + (p.kind === 'baseline' ? p.oy : 0); y <= b.y + b.h + 1e-9 && out.length < 4000; y += p.step) out.push([b.x, y, b.x + b.w, y]);
  }
  return out;
}

/**
 * Bake Grid: the visible layout grids of the active artboard become real vector paths (a locked
 * group above the artwork) — for print guides, presentation boards, dieline sheets or exporting.
 */
export function bakeGrids(): number {
  const doc = store.doc;
  if (!doc) return 0;
  const page = activeGridPage(doc);
  const specs = page.grids.filter((g) => g.visible);
  if (!specs.length) {
    store.toast('No visible layout grids on this artboard — add one in the Grids panel first');
    return 0;
  }
  const { x: bx, y: by, w, h } = page.box;
  const hair = Math.max(1, Math.min(w, h) / 1000);
  const group = makeLayer({ kind: 'group', name: `Grid · ${page.name}` });
  const kids: Layer[] = [];
  // Paths are stored relative to the layer box (0..1), here the artboard
  const nx = (x: number) => x / w;
  const ny = (y: number) => y / h;
  const shape = (name: string, subs: PathAnchor[][], color: string, opts: { fill?: boolean; dash?: boolean; closed?: boolean } = {}) =>
    makeLayer({
      kind: 'shape',
      name,
      x: bx,
      y: by,
      width: w,
      height: h,
      parent: group.id,
      opacity: opts.fill ? 0.14 : 1,
      shape: {
        shape: 'path',
        ...(subs.length === 1 && opts.closed === false ? { points: subs[0], closed: false } : { compoundPoints: subs, closed: true }),
        fill: color,
        fillEnabled: !!opts.fill,
        stroke: color,
        strokeWidth: opts.fill ? 0 : hair,
        strokeDash: opts.dash ? [hair * 5, hair * 4] : undefined,
        radius: 0,
      },
    });
  for (const spec of specs) {
    const g = gridGeometry(spec, w, h);
    const label = spec.label ?? spec.kind;
    const lines = [...g.lines, ...patternLines(g)];
    const subs: PathAnchor[][] = lines.map(([x1, y1, x2, y2]) => [pt(nx(x1), ny(y1)), pt(nx(x2), ny(y2))]);
    for (const r of g.rects) subs.push([pt(nx(r.x), ny(r.y)), pt(nx(r.x + r.w), ny(r.y)), pt(nx(r.x + r.w), ny(r.y + r.h)), pt(nx(r.x), ny(r.y + r.h))]);
    for (const c of g.circles) {
      // Four Bézier quarter arcs
      const k = 0.5523 * c.r;
      const P = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): PathAnchor => ({ x: nx(x), y: ny(y), ix: nx(ix), iy: ny(iy), ox: nx(ox), oy: ny(oy) });
      subs.push([
        P(c.cx + c.r, c.cy, c.cx + c.r, c.cy - k, c.cx + c.r, c.cy + k),
        P(c.cx, c.cy + c.r, c.cx + k, c.cy + c.r, c.cx - k, c.cy + c.r),
        P(c.cx - c.r, c.cy, c.cx - c.r, c.cy + k, c.cx - c.r, c.cy - k),
        P(c.cx, c.cy - c.r, c.cx - k, c.cy - c.r, c.cx + k, c.cy - c.r),
      ]);
    }
    if (subs.length) kids.push(shape(`${label} lines`, subs, spec.color, { dash: spec.kind === 'safe' || spec.kind === 'panels' }));
    for (const poly of g.polys) {
      const pts: PathAnchor[] = [];
      for (let i = 0; i < poly.length; i += 2) pts.push(pt(nx(poly[i]), ny(poly[i + 1])));
      kids.push(shape(`${label} curve`, [pts], spec.color, { closed: false }));
    }
    const fills = [...g.bands, ...g.shade];
    if (fills.length) kids.push(shape(`${label} areas`, fills.map((r) => [pt(nx(r.x), ny(r.y)), pt(nx(r.x + r.w), ny(r.y)), pt(nx(r.x + r.w), ny(r.y + r.h)), pt(nx(r.x), ny(r.y + r.h))]), spec.kind === 'aspect' ? '#000000' : spec.color, { fill: true }));
    for (const l of g.labels) {
      const t = makeLayer({
        kind: 'text',
        name: l.text,
        x: bx + l.x + 3 * hair,
        y: by + l.y + 3 * hair,
        parent: group.id,
        text: { text: l.text, font: 'Inter', size: Math.max(8, Math.round(Math.min(w, h) / 70)), weight: 600, italic: false, color: spec.color.startsWith('#') ? spec.color : '#4daafc', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' },
      });
      kids.push(withLayer(t, syncTextBounds(t)));
    }
  }
  if (!kids.length) return 0;
  group.locked = true;
  store.commit('Bake Grid', { layers: [...doc.layers, ...kids, group] }, { icon: 'grid' });
  store.toast(`Baked ${specs.length} grid${specs.length > 1 ? 's' : ''} into “${group.name}” (locked group above the artwork)`, 'success');
  return kids.length;
}
