// Print studio: print-ready PDF (bleed, crop and registration marks, colour bars, page info),
// preflight with one-click fixes, ink coverage, and gang-up sheets (n-up imposition).

import { store } from '../store';
import type { Artboard, Doc, Layer, Rect } from '../types';
import { withLayer } from '../types';
import { canvasToBlob, createCanvas, ctx2d } from '../canvas';
import { saveBlob } from '../io';
import { cmykToRgb, hexToRgb, outOfGamut, rgbToHex, separate } from '../color';
import { layerBounds } from '../align';
import { renderRect, boardsOf } from './export';
import { safeName } from './common';

export interface PrintPrefs {
  /** Pixels per inch the document was made at (print presets use 300). */
  ppi: number;
  bleedMm: number;
  safeMm: number;
  cropMarks: boolean;
  registration: boolean;
  colorBars: boolean;
  pageInfo: boolean;
}

export const DEFAULT_PRINT: PrintPrefs = { ppi: 300, bleedMm: 3, safeMm: 4, cropMarks: true, registration: true, colorBars: true, pageInfo: true };
const KEY = 'skillvector.print';

export function loadPrintPrefs(): PrintPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PRINT, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_PRINT };
}
export function savePrintPrefs(p: PrintPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export const mmToPx = (mm: number, ppi: number) => (mm / 25.4) * ppi;
export const pxToMm = (px: number, ppi: number) => (px / ppi) * 25.4;
export const ptToPx = (pt: number, ppi: number) => (pt / 72) * ppi;

// ---------------------------------------------------------------- ink

/** CMYK percentages of a colour as it would separate, and the total ink (TAC, %). */
export function inkCoverage(hex: string): { c: number; m: number; y: number; k: number; total: number } {
  const [c, m, y, k] = separate(hexToRgb(hex)).map((v) => Math.round(v * 100));
  return { c, m, y, k, total: c + m + y + k };
}

// ---------------------------------------------------------------- marks

/** Space around the trim that marks need (mm). */
export function slugMm(p: PrintPrefs): number {
  return p.cropMarks || p.registration || p.colorBars || p.pageInfo ? Math.max(p.bleedMm + 9, 12) : p.bleedMm;
}

/**
 * Draws printer's marks around a trim box on a page canvas (pixels). Marks are in registration
 * black; colour bars use process colours.
 */
export function drawMarks(ctx: CanvasRenderingContext2D, trim: Rect, p: PrintPrefs, info: string) {
  const px = (mm: number) => mmToPx(mm, p.ppi);
  const off = px(p.bleedMm + 1); // marks start outside the bleed
  const len = px(5);
  const lw = Math.max(1, ptToPx(0.25, p.ppi));
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineWidth = lw;
  const L = trim.x, T = trim.y, R = trim.x + trim.width, B = trim.y + trim.height;
  if (p.cropMarks) {
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[L, T, -1, -1], [R, T, 1, -1], [R, B, 1, 1], [L, B, -1, 1]] as const) {
      ctx.moveTo(x + sx * off, y);
      ctx.lineTo(x + sx * (off + len), y);
      ctx.moveTo(x, y + sy * off);
      ctx.lineTo(x, y + sy * (off + len));
    }
    ctx.stroke();
  }
  if (p.registration) {
    const r = px(1.8);
    const d = off + len / 2;
    for (const [x, y] of [[(L + R) / 2, T - d], [(L + R) / 2, B + d], [L - d, (T + B) / 2], [R + d, (T + B) / 2]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r * 1.6, y);
      ctx.lineTo(x + r * 1.6, y);
      ctx.moveTo(x, y - r * 1.6);
      ctx.lineTo(x, y + r * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (p.colorBars) {
    const s = px(4);
    const bars: [number, number, number, number][] = [
      [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 1, 0, 0], [1, 0, 1, 0], [0, 1, 1, 0],
      [0, 0, 0, 0.75], [0, 0, 0, 0.5], [0, 0, 0, 0.25], [0.5, 0, 0, 0], [0, 0.5, 0, 0], [0, 0, 0.5, 0],
    ];
    const y = T - off - s - px(1);
    const x0 = L + px(14);
    bars.forEach((c, i) => {
      if (x0 + (i + 1) * s > R - px(14)) return;
      ctx.fillStyle = rgbToHex(cmykToRgb(c[0], c[1], c[2], c[3]));
      ctx.fillRect(x0 + i * s, y, s, s);
    });
    ctx.strokeRect(x0, y, Math.min(bars.length * s, R - px(14) - x0), s);
  }
  if (p.pageInfo && info) {
    ctx.fillStyle = '#000000';
    ctx.font = `${Math.max(8, ptToPx(6, p.ppi))}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(info, L + px(14), B + off + px(1));
  }
  ctx.restore();
}

/** One printed page: artboard + bleed (content past the bleed is cut off) + marks. */
export function renderPrintPage(doc: Doc, ab: Artboard, p: PrintPrefs): { canvas: HTMLCanvasElement; trim: Rect } {
  const bleed = mmToPx(p.bleedMm, p.ppi);
  // Whole pixels, so the trim (and the marks on its lines) fall on the pixel grid
  const slug = Math.round(mmToPx(slugMm(p), p.ppi));
  const W = Math.round(ab.width + slug * 2);
  const H = Math.round(ab.height + slug * 2);
  const page = createCanvas(W, H);
  const ctx = ctx2d(page);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const art = renderRect(doc, { x: ab.x - bleed, y: ab.y - bleed, width: ab.width + bleed * 2, height: ab.height + bleed * 2 }, 1, '#ffffff');
  ctx.drawImage(art, Math.round(slug - bleed), Math.round(slug - bleed));
  const trim = { x: slug, y: slug, width: ab.width, height: ab.height };
  const mm = (v: number) => Math.round(pxToMm(v, p.ppi) * 10) / 10;
  const info = `${doc.title} · ${ab.name} · ${mm(ab.width)} × ${mm(ab.height)} mm · bleed ${p.bleedMm} mm · ${new Date().toISOString().slice(0, 10)}`;
  drawMarks(ctx, trim, p, info);
  return { canvas: page, trim };
}

const jpg = async (c: HTMLCanvasElement) => new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.95)).arrayBuffer());

/** Print-ready PDF: one page per artboard with bleed and marks, at the document's ppi. */
export async function exportPrintPdf(doc: Doc, p: PrintPrefs, which: 'all' | 'active' = 'all'): Promise<number> {
  const { buildPdfPages } = await import('../formats/pdf');
  const pages = [];
  for (const ab of boardsOf(doc, which)) {
    const { canvas } = renderPrintPage(doc, ab, p);
    pages.push({ img: { width: canvas.width, height: canvas.height, data: await jpg(canvas), filter: 'DCTDecode' as const }, width: (canvas.width * 72) / p.ppi, height: (canvas.height * 72) / p.ppi });
  }
  const pdf = buildPdfPages(pages, doc.title);
  await saveBlob(new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${safeName(doc.title)} (print).pdf`);
  store.toast(`Print PDF: ${pages.length} page${pages.length > 1 ? 's' : ''} with ${p.bleedMm} mm bleed${p.cropMarks ? ' and crop marks' : ''}`, 'success');
  return pages.length;
}

// ---------------------------------------------------------------- gang-up sheets

export const SHEETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'a4', label: 'A4', w: 210, h: 297 },
  { id: 'a3', label: 'A3', w: 297, h: 420 },
  { id: 'sra3', label: 'SRA3', w: 320, h: 450 },
  { id: 'letter', label: 'US Letter', w: 215.9, h: 279.4 },
  { id: 'tabloid', label: 'Tabloid', w: 279.4, h: 431.8 },
  { id: '12x18', label: '12 × 18 in', w: 304.8, h: 457.2 },
];

/** How many copies of a w×h (mm) piece fit on a sheet; tries both orientations of the piece. */
export function nUpLayout(pieceW: number, pieceH: number, sheetW: number, sheetH: number, gutter: number, margin: number): { cols: number; rows: number; rotated: boolean; count: number } {
  const fit = (w: number, h: number) => {
    const cols = Math.max(0, Math.floor((sheetW - 2 * margin + gutter) / (w + gutter)));
    const rows = Math.max(0, Math.floor((sheetH - 2 * margin + gutter) / (h + gutter)));
    return { cols, rows, count: cols * rows };
  };
  const a = fit(pieceW, pieceH);
  const b = fit(pieceH, pieceW);
  return b.count > a.count ? { ...b, rotated: true } : { ...a, rotated: false };
}

/**
 * Gang-up sheet: as many copies of the active artboard as fit, each with its own bleed, crop marks
 * along every cut line at the sheet edges. Saves a PDF; returns the layout.
 */
export async function exportGangSheet(doc: Doc, p: PrintPrefs, sheetId: string, gutterMm = 6, marginMm = 10) {
  const sheet = SHEETS.find((s) => s.id === sheetId) ?? SHEETS[0];
  const ab = boardsOf(doc, 'active')[0];
  const px = (mm: number) => mmToPx(mm, p.ppi);
  const wMm = pxToMm(ab.width, p.ppi);
  const hMm = pxToMm(ab.height, p.ppi);
  const lay = nUpLayout(wMm, hMm, sheet.w, sheet.h, Math.max(gutterMm, p.bleedMm * 2), marginMm);
  if (!lay.count) {
    store.toast(`The artboard (${Math.round(wMm)} × ${Math.round(hMm)} mm) doesn't fit on ${sheet.label}`, 'error');
    return lay;
  }
  const bleed = px(p.bleedMm);
  const art = renderRect(doc, { x: ab.x - bleed, y: ab.y - bleed, width: ab.width + bleed * 2, height: ab.height + bleed * 2 }, 1, '#ffffff');
  const W = Math.round(px(sheet.w));
  const H = Math.round(px(sheet.h));
  const page = createCanvas(W, H);
  const ctx = ctx2d(page);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const cw = lay.rotated ? ab.height : ab.width;
  const ch = lay.rotated ? ab.width : ab.height;
  const gut = px(Math.max(gutterMm, p.bleedMm * 2));
  const blockW = lay.cols * cw + (lay.cols - 1) * gut;
  const blockH = lay.rows * ch + (lay.rows - 1) * gut;
  const ox = (W - blockW) / 2;
  const oy = (H - blockH) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let r = 0; r < lay.rows; r++) {
    for (let c = 0; c < lay.cols; c++) {
      const x = ox + c * (cw + gut);
      const y = oy + r * (ch + gut);
      ctx.save();
      // Each copy shows its own bleed, but never over its neighbour's
      ctx.beginPath();
      ctx.rect(x - Math.min(bleed, gut / 2), y - Math.min(bleed, gut / 2), cw + Math.min(bleed, gut / 2) * 2, ch + Math.min(bleed, gut / 2) * 2);
      ctx.clip();
      ctx.translate(x + cw / 2, y + ch / 2);
      if (lay.rotated) ctx.rotate(Math.PI / 2);
      ctx.drawImage(art, -art.width / 2, -art.height / 2);
      ctx.restore();
      if (r === 0) xs.push(x, x + cw);
      if (c === 0) ys.push(y, y + ch);
    }
  }
  // Crop marks along every cut line, outside the block
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, ptToPx(0.25, p.ppi));
  const off = px(2);
  const len = px(Math.min(6, marginMm - 3));
  ctx.beginPath();
  for (const x of xs) {
    ctx.moveTo(x, oy - off);
    ctx.lineTo(x, oy - off - len);
    ctx.moveTo(x, oy + blockH + off);
    ctx.lineTo(x, oy + blockH + off + len);
  }
  for (const y of ys) {
    ctx.moveTo(ox - off, y);
    ctx.lineTo(ox - off - len, y);
    ctx.moveTo(ox + blockW + off, y);
    ctx.lineTo(ox + blockW + off + len, y);
  }
  ctx.stroke();
  const { buildPdfPages } = await import('../formats/pdf');
  const pdf = buildPdfPages([{ img: { width: W, height: H, data: await jpg(page), filter: 'DCTDecode' }, width: (sheet.w / 25.4) * 72, height: (sheet.h / 25.4) * 72 }], doc.title);
  await saveBlob(new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${safeName(doc.title)} ${lay.count}-up ${sheet.label}.pdf`);
  store.toast(`${lay.count} copies on ${sheet.label} (${lay.cols} × ${lay.rows}${lay.rotated ? ', rotated' : ''})`, 'success');
  return lay;
}

// ---------------------------------------------------------------- preflight

export interface PreflightIssue {
  id: string;
  level: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  layerIds: string[];
  fix?: 'bleed' | 'hairline';
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Every leaf layer with its document bounds (inside groups too). */
function leaves(doc: Doc): { l: Layer; b: Rect }[] {
  // The page itself (the bottom pixel layer that fills the document) is paper, not artwork
  const backdrop = (l: Layer) => l.kind === 'raster' && !l.parent && doc.layers[0]?.id === l.id && !!l.canvas && l.x <= 0 && l.y <= 0 && l.x + l.canvas.width >= doc.width && l.y + l.canvas.height >= doc.height;
  return doc.layers.filter((l) => l.kind !== 'group' && l.kind !== 'adjustment' && !backdrop(l)).flatMap((l) => {
    const b = layerBounds(l);
    return b ? [{ l, b }] : [];
  });
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Checks the document for print problems. */
export function preflight(doc: Doc, p: PrintPrefs): PreflightIssue[] {
  const boards = boardsOf(doc);
  const bleed = mmToPx(p.bleedMm, p.ppi);
  const safe = mmToPx(p.safeMm, p.ppi);
  const hair = ptToPx(0.25, p.ppi);
  const out: PreflightIssue[] = [];
  const add = (i: Omit<PreflightIssue, 'id'>) => i.layerIds.length && out.push({ ...i, id: `${i.title}:${out.length}` });
  const all = leaves(doc);
  const onBoard = all.filter(({ b }) => boards.some((ab) => overlaps(b, ab)));

  // Artwork that reaches a trim edge but stops there: a white sliver shows after cutting
  const short: string[] = [];
  for (const { l, b } of onBoard) {
    if (!l.visible) continue;
    for (const ab of boards) {
      if (!overlaps(b, ab)) continue;
      const tol = 1;
      const edges = [
        near(b.x, ab.x, tol) && b.x > ab.x - bleed + tol,
        near(b.y, ab.y, tol) && b.y > ab.y - bleed + tol,
        near(b.x + b.width, ab.x + ab.width, tol) && b.x + b.width < ab.x + ab.width + bleed - tol,
        near(b.y + b.height, ab.y + ab.height, tol) && b.y + b.height < ab.y + ab.height + bleed - tol,
      ];
      if (edges.some(Boolean)) short.push(l.id);
    }
  }
  add({ level: 'error', title: 'Artwork stops at the trim', detail: `Extend it ${p.bleedMm} mm past the edge, or a thin white line may show after cutting.`, layerIds: [...new Set(short)], fix: 'bleed' });

  // Text inside the safe margin
  const tight = onBoard.filter(({ l, b }) => l.kind === 'text' && l.visible && boards.some((ab) => overlaps(b, ab) && (b.x < ab.x + safe || b.y < ab.y + safe || b.x + b.width > ab.x + ab.width - safe || b.y + b.height > ab.y + ab.height - safe)));
  add({ level: 'warn', title: 'Text too close to the edge', detail: `Keep text ${p.safeMm} mm inside the trim so cutting can't clip it.`, layerIds: tight.map(({ l }) => l.id) });

  // Hairlines
  const thin = onBoard.filter(({ l }) => l.kind === 'shape' && l.shape && l.shape.strokeWidth > 0 && l.shape.strokeWidth < hair);
  add({ level: 'warn', title: 'Hairline strokes', detail: 'Strokes under 0.25 pt may not print. Fix sets them to 0.25 pt.', layerIds: thin.map(({ l }) => l.id), fix: 'hairline' });

  // Tiny text
  const tiny = onBoard.filter(({ l }) => l.kind === 'text' && l.text && l.text.size < ptToPx(6, p.ppi));
  add({ level: 'warn', title: 'Text under 6 pt', detail: 'Very small text can fill in or blur in print.', layerIds: tiny.map(({ l }) => l.id) });

  // Ink: total coverage and colours outside CMYK
  const heavy: string[] = [];
  const dull: string[] = [];
  for (const { l } of onBoard) {
    const cols = l.kind === 'shape' && l.shape ? [l.shape.fillEnabled ? l.shape.fill : null, l.shape.strokeWidth > 0 ? l.shape.stroke : null] : l.kind === 'text' && l.text ? [l.text.color] : [];
    for (const c of cols) {
      if (!c || !/^#[0-9a-f]{6}/i.test(c)) continue;
      if (inkCoverage(c).total > 300) heavy.push(l.id);
      if (outOfGamut(hexToRgb(c))) dull.push(l.id);
    }
  }
  add({ level: 'warn', title: 'Ink over 300%', detail: 'Heavy ink can smear or dry slowly. Lighten the colour or use a rich black like 60/40/40/100.', layerIds: [...new Set(heavy)] });
  add({ level: 'info', title: 'Colours outside CMYK', detail: 'These bright RGB colours will print duller. Turn on the CMYK proof to see how.', layerIds: [...new Set(dull)] });

  // Low-resolution images (pixels per inch at print size)
  const lowRes = onBoard.filter(({ l }) => l.kind === 'raster' && l.canvas && !l.name.startsWith('Template · ') && (l.canvas.width / Math.max(1, l.width)) * p.ppi < 200 && p.ppi < 200);
  add({ level: 'warn', title: 'Low print resolution', detail: `The document is set to ${p.ppi} ppi; photos need about 300 ppi to print sharp.`, layerIds: lowRes.map(({ l }) => l.id) });

  // Hidden and off-board artwork
  const hidden = onBoard.filter(({ l }) => !l.visible);
  add({ level: 'info', title: 'Hidden layers', detail: "Hidden layers won't print.", layerIds: hidden.map(({ l }) => l.id) });
  const off = all.filter(({ l, b }) => l.visible && !boards.some((ab) => overlaps(b, { x: ab.x - bleed, y: ab.y - bleed, width: ab.width + 2 * bleed, height: ab.height + 2 * bleed })));
  add({ level: 'info', title: 'Artwork off the artboards', detail: "Objects on the pasteboard don't print.", layerIds: off.map(({ l }) => l.id) });
  return out;
}

/** Sets every hairline stroke in `ids` to 0.25 pt. */
export function fixHairlines(ids: string[], p: PrintPrefs): number {
  const doc = store.doc;
  if (!doc) return 0;
  const set = new Set(ids);
  const w = ptToPx(0.25, p.ppi);
  store.commit('Fix Hairlines', { layers: doc.layers.map((l) => (set.has(l.id) && l.shape ? withLayer(l, { shape: { ...l.shape, strokeWidth: Math.max(l.shape.strokeWidth, w) } }) : l)) }, { icon: 'shape' });
  return set.size;
}

/** Pushes the edges of shapes and pictures that stop at a trim edge out to the bleed. */
export function extendToBleed(ids: string[], p: PrintPrefs): number {
  const doc = store.doc;
  if (!doc) return 0;
  const set = new Set(ids);
  const bleed = mmToPx(p.bleedMm, p.ppi);
  const boards = boardsOf(doc);
  let n = 0;
  const layers = doc.layers.map((l) => {
    if (!set.has(l.id) || l.rotation || (l.kind !== 'shape' && l.kind !== 'raster')) return l;
    const b = layerBounds(l);
    const ab = b && boards.find((a) => overlaps(b, a));
    if (!b || !ab) return l;
    let { x, y, width, height } = l;
    const tol = 1;
    if (near(b.x, ab.x, tol)) { x -= bleed; width += bleed; }
    if (near(b.y, ab.y, tol)) { y -= bleed; height += bleed; }
    if (near(b.x + b.width, ab.x + ab.width, tol)) width += bleed;
    if (near(b.y + b.height, ab.y + ab.height, tol)) height += bleed;
    if (x === l.x && y === l.y && width === l.width && height === l.height) return l;
    n++;
    if (l.kind === 'raster' && l.canvas) {
      // Stretch the picture to the new box (a few pixels; content stays aligned to the trim)
      const c = createCanvas(Math.round(width), Math.round(height));
      const cx = ctx2d(c);
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(l.canvas, 0, 0, c.width, c.height);
      return withLayer(l, { x: Math.round(x), y: Math.round(y), width: c.width, height: c.height, canvas: c });
    }
    return withLayer(l, { x, y, width, height });
  });
  if (n) store.commit('Extend to Bleed', { layers }, { icon: 'shape' });
  return n;
}
