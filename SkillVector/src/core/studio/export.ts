// Artboard export: every artboard as its own file, vectors drawn at the export scale (not an
// enlarged bitmap), as PNG / JPEG / WebP (zipped when there are several) or one multi-page PDF.

import { store } from '../store';
import type { Artboard, Doc, Rect } from '../types';
import { DocRenderer } from '../render';
import { canvasToBlob, createCanvas, ctx2d } from '../canvas';
import { saveBlob } from '../io';
import { getActiveArtboard } from '../vectorOps';
import { safeName } from './common';

export type BoardFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

/** A region of the document rendered at `scale` (crisp vectors), optionally on a background colour. */
export function renderRect(doc: Doc, r: Rect, scale = 1, background: string | null = null): HTMLCanvasElement {
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));
  const src = new DocRenderer().render(doc, undefined, { s: scale, ox: r.x * scale, oy: r.y * scale, w, h });
  const out = createCanvas(w, h);
  const ctx = ctx2d(out);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

export function boardsOf(doc: Doc, which: 'all' | 'active' | string[] = 'all'): Artboard[] {
  const all = doc.artboards?.length ? doc.artboards : [getActiveArtboard(doc)];
  if (which === 'active') return [getActiveArtboard(doc)];
  if (Array.isArray(which)) return all.filter((a) => which.includes(a.id));
  return all;
}

const bytes = async (c: HTMLCanvasElement, type: string, q?: number) => new Uint8Array(await (await canvasToBlob(c, type, q)).arrayBuffer());

/** Unique file names for a list of boards. */
export function boardFileNames(boards: { name: string }[], ext: string, prefix = ''): string[] {
  const used = new Map<string, number>();
  return boards.map((b) => {
    const base = prefix + safeName(b.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return `${n > 1 ? `${base} ${n}` : base}.${ext}`;
  });
}

/** Builds the files without saving them (used by tests and by the export). */
export async function artboardFiles(doc: Doc, opts: { format: BoardFormat; scale?: number; quality?: number; which?: 'all' | 'active' | string[]; background?: string | null; regions?: { name: string; rect: Rect }[] }) {
  const scale = opts.scale ?? 1;
  const regions = opts.regions ?? boardsOf(doc, opts.which).map((a) => ({ name: a.name, rect: { x: a.x, y: a.y, width: a.width, height: a.height } }));
  const fmt = opts.format === 'pdf' ? 'jpeg' : opts.format;
  const bg = opts.background !== undefined ? opts.background : fmt === 'jpeg' ? '#ffffff' : null;
  const names = boardFileNames(regions, fmt === 'jpeg' ? 'jpg' : fmt);
  const files: { name: string; data: Uint8Array; width: number; height: number; rect: Rect }[] = [];
  for (let i = 0; i < regions.length; i++) {
    const c = renderRect(doc, regions[i].rect, scale, fmt === 'jpeg' ? bg ?? '#ffffff' : bg);
    files.push({ name: names[i], data: await bytes(c, `image/${fmt}`, opts.quality ?? 0.92), width: c.width, height: c.height, rect: regions[i].rect });
  }
  return files;
}

/** Exports artboards (or named regions). Returns how many files/pages were written. */
export async function exportArtboards(doc: Doc, opts: Parameters<typeof artboardFiles>[1] & { fileName?: string; dpi?: number }): Promise<number> {
  const files = await artboardFiles(doc, opts);
  if (!files.length) return 0;
  const title = opts.fileName ?? doc.title;
  if (opts.format === 'pdf') {
    const { buildPdfPages } = await import('../formats/pdf');
    const dpi = opts.dpi ?? 72 * (opts.scale ?? 1);
    const pdf = buildPdfPages(
      files.map((f) => ({ img: { width: f.width, height: f.height, data: f.data, filter: 'DCTDecode' as const }, width: (f.width * 72) / dpi, height: (f.height * 72) / dpi })),
      title,
    );
    await saveBlob(new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${safeName(title)}.pdf`);
  } else if (files.length === 1) {
    await saveBlob(new Blob([files[0].data as BlobPart], { type: `image/${opts.format}` }), files[0].name);
  } else {
    const { zip } = await import('../formats/zip');
    await saveBlob(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${safeName(title)}.zip`);
  }
  store.toast(`Exported ${files.length} ${opts.format === 'pdf' ? 'page' : 'file'}${files.length > 1 ? 's' : ''}`, 'success');
  return files.length;
}
