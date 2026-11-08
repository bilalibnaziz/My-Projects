/**
 * File ▸ Automate ▸ Merge to HDR / Focus Stack: fuse the selected (or all visible) pixel layers into a
 * new layer on top; with fewer than two layers, pick the bracketed / focus-bracketed photos instead and
 * open the result as a new document. The heavy lifting runs in fusion.worker.ts.
 */
import { createCanvas, ctx2d, pixelsLike } from './canvas';
import { fuse, type FusionInput, type FusionMode, type FusionResult } from './fusion';
import { fileToCanvas, docFromCanvas, pickFiles } from './io';
import { layerSurface } from './render';
import { makeLayer } from './types';
import type { Layer } from './types';
import { store } from './store';

const LABEL: Record<FusionMode, string> = { exposure: 'Merge to HDR', focus: 'Focus Stack' };
/** Above this many pixels per shot the work canvas is scaled down (memory: ~40 bytes per pixel per level). */
const MAX_PIXELS = 24_000_000;

function runInWorker(input: FusionInput): Promise<FusionResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(fuse(input));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./fusion.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(fuse(input));
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.result) {
        worker.terminate();
        resolve(e.data.result as FusionResult);
      } else if (e.data.error) {
        worker.terminate();
        reject(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Fusion worker failed'));
    };
    worker.postMessage(input, input.images.map((d) => d.buffer));
  });
}

/** A plain fill (e.g. the white Background of a new document): nothing to fuse. Checked on a 16 × 16 copy. */
function isFlat(c: HTMLCanvasElement): boolean {
  const t = createCanvas(16, 16, 'srgb');
  const g = ctx2d(t);
  g.drawImage(c, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  for (let i = 4; i < d.length; i += 4) {
    if (Math.abs(d[i] - d[0]) > 2 || Math.abs(d[i + 1] - d[1]) > 2 || Math.abs(d[i + 2] - d[2]) > 2 || Math.abs(d[i + 3] - d[3]) > 2) return false;
  }
  return true;
}

/** Pixel layers to fuse: the selection when it has two or more, else every visible pixel layer with content. */
export function fusionLayers(): Layer[] {
  const doc = store.doc;
  if (!doc) return [];
  const isPixels = (l: Layer) => l.kind === 'raster' && !!l.canvas && l.visible;
  const sel = store.selectedLayers.filter(isPixels);
  return sel.length >= 2 ? sel : doc.layers.filter((l) => isPixels(l) && !isFlat(l.canvas!));
}

/** One shot at document size (layer pixels at their position), as sRGB bytes for the fusion maths. */
function shotPixels(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number, scale: number): Uint8ClampedArray {
  const c = createCanvas(Math.round(w * scale), Math.round(h * scale), 'srgb');
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, x * scale, y * scale, canvas.width * scale, canvas.height * scale);
  return g.getImageData(0, 0, c.width, c.height).data;
}

async function fuseCanvases(shots: { canvas: HTMLCanvasElement; x: number; y: number }[], w: number, h: number, mode: FusionMode, align: boolean): Promise<{ canvas: HTMLCanvasElement; shifts: [number, number][]; scale: number }> {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const images = shots.map((s) => shotPixels(s.canvas, s.x, s.y, w, h, scale));
  const r = await runInWorker({ images, w: sw, h: sh, mode, align });
  const out = createCanvas(sw, sh, 'srgb');
  ctx2d(out).putImageData(pixelsLike('srgb', r.data, sw, sh), 0, 0);
  // Back to full size, in the working colour space (drawImage converts sRGB → Display P3 when needed)
  const full = createCanvas(w, h);
  const g = ctx2d(full);
  g.imageSmoothingQuality = 'high';
  g.drawImage(out, 0, 0, w, h);
  return { canvas: full, shifts: r.shifts, scale };
}

const shiftNote = (shifts: [number, number][], scale: number) => {
  const moved = shifts.filter(([x, y]) => x || y).length;
  if (!moved) return '';
  const max = Math.max(...shifts.map(([x, y]) => Math.hypot(x, y))) / scale;
  return ` · aligned ${moved} shot${moved > 1 ? 's' : ''} (up to ${Math.round(max)} px)`;
};

/** Fuses layers of the open document into a new layer on top (one undo step). */
export async function fuseLayers(mode: FusionMode, align = true): Promise<boolean> {
  const doc = store.doc;
  if (!doc) return false;
  const layers = fusionLayers();
  if (layers.length < 2) return false;
  const shots = layers.map((l) => layerSurface(l)!).filter(Boolean);
  const r = await store.task(`${LABEL[mode]} (${shots.length} shots)`, () => fuseCanvases(shots, doc.width, doc.height, mode, align));
  if (!r || store.doc !== doc) return false;
  const layer = makeLayer({ kind: 'raster', name: LABEL[mode], canvas: r.canvas, width: doc.width, height: doc.height });
  store.commit(LABEL[mode], { layers: [...doc.layers, layer], activeId: layer.id }, { icon: 'merge' });
  store.toast(`${LABEL[mode]}: blended ${shots.length} shots${shiftNote(r.shifts, r.scale)}`);
  return true;
}

/** Picks photos and fuses them into a new document (the shots are all scaled to the first one's size). */
export async function fuseFiles(mode: FusionMode, files?: File[]): Promise<boolean> {
  const picked = files ?? (await pickFiles());
  if (picked.length < 2) {
    if (picked.length) store.toast(`${LABEL[mode]}: choose two or more photos of the same scene`);
    return false;
  }
  const r = await store.task(`${LABEL[mode]} (${picked.length} photos)`, async () => {
    const canvases = await Promise.all(picked.map((f) => fileToCanvas(f, 'srgb')));
    const { width: w, height: h } = canvases[0];
    const shots = canvases.map((c) => {
      if (c.width === w && c.height === h) return { canvas: c, x: 0, y: 0 };
      // Different size: fit into the first shot's frame
      const fit = createCanvas(w, h, 'srgb');
      ctx2d(fit).drawImage(c, 0, 0, w, h);
      return { canvas: fit, x: 0, y: 0 };
    });
    return { ...(await fuseCanvases(shots, w, h, mode, true)), name: picked[0].name.replace(/\.[^.]+$/, '') };
  });
  if (!r) return false;
  docFromCanvas(r.canvas, `${r.name} ${LABEL[mode]}`);
  store.toast(`${LABEL[mode]}: blended ${picked.length} photos${shiftNote(r.shifts, r.scale)}`);
  return true;
}

/** Menu entry: layers when there are two or more, else ask for files. */
export async function runFusion(mode: FusionMode): Promise<boolean> {
  if (fusionLayers().length >= 2) return fuseLayers(mode);
  return fuseFiles(mode);
}
