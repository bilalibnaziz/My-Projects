import type { Doc, Layer, Mask, Rect, SmartData } from './types';
import { makeLayer, withLayer } from './types';
import { groupLayers } from './groups';
import { canvasToBlob, createCanvas, ctx2d, hasWideGamut, loadImage, pixelsLike, spaceOf, workingSpace, type ColorSpaceId } from './canvas';
import { renderDocument } from './render';
import { contentBounds } from './snap';
import { store } from './store';

export const IMAGE_ACCEPT = 'image/*,.photoscale,.psc,.psd,.tif,.tiff,.heic,.heif,.dng,.cr2,.nef,.arw,.raw,.orf,.rw2,.pef';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const MAX_IMAGE_DIM = 16384;
const MAX_IMAGE_PIXELS = 64_000_000;

function drawImageSafely(src: { width: number; height: number }, draw: (ctx: CanvasRenderingContext2D, dw: number, dh: number) => void, space: ColorSpaceId = workingSpace(), quiet = false): HTMLCanvasElement {
  let w = src.width;
  let h = src.height;
  if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM || w * h > MAX_IMAGE_PIXELS) {
    const scale = Math.min(MAX_IMAGE_DIM / w, MAX_IMAGE_DIM / h, Math.sqrt(MAX_IMAGE_PIXELS / (w * h)));
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    if (!quiet) store.toast(`Image size ${w}×${h} exceeds safe canvas bounds. Scaled to ${dw}×${dh} to prevent crash.`, 'info');
    const c = createCanvas(dw, dh, space);
    draw(ctx2d(c), dw, dh);
    return c;
  }
  const c = createCanvas(w, h, space);
  draw(ctx2d(c), w, h);
  return c;
}

/**
 * Decodes an image file. By default the colour space follows the content: a photo with colours outside
 * sRGB (a Display P3 / Adobe RGB / wide-gamut file) comes back as a Display P3 canvas, anything else as
 * sRGB. `space` forces one (placing into a document uses the document's).
 */
export async function fileToCanvas(file: Blob & { name?: string }, space?: ColorSpaceId): Promise<HTMLCanvasElement> {
  // TIFF: browsers other than Safari can't decode it, so use our own decoder
  if (/\.tiff?$/i.test(file.name ?? '') || file.type === 'image/tiff') {
    try {
      const bmp = await createImageBitmap(file);
      const c = drawImageSafely(bmp, (ctx, dw, dh) => ctx.drawImage(bmp, 0, 0, dw, dh));
      bmp.close();
      return c;
    } catch {
      const { decodeTiff } = await import('./formats/tiff');
      const r = await decodeTiff(await file.arrayBuffer());
      const c = createCanvas(r.width, r.height, 'srgb'); // TIFF pixels are read as sRGB
      ctx2d(c).putImageData(pixelsLike('srgb', r.data as Uint8ClampedArray, r.width, r.height), 0, 0);
      return c;
    }
  }
  try {
    const bmp = await createImageBitmap(file);
    const draw = (ctx: CanvasRenderingContext2D, dw: number, dh: number) => ctx.drawImage(bmp, 0, 0, dw, dh);
    if (space) {
      const c = drawImageSafely(bmp, draw, space);
      bmp.close();
      return c;
    }
    const wide = drawImageSafely(bmp, draw, 'display-p3');
    if (hasWideGamut(wide)) {
      bmp.close();
      return wide;
    }
    const c = drawImageSafely(bmp, draw, 'srgb', true);
    bmp.close();
    return c;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return drawImageSafely({ width: img.naturalWidth, height: img.naturalHeight }, (ctx, dw, dh) => ctx.drawImage(img, 0, 0, dw, dh));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

export function docFromCanvas(canvas: HTMLCanvasElement, title: string, sourceName?: string): Doc {
  const layer = makeLayer({ kind: 'raster', name: 'Background', canvas, width: canvas.width, height: canvas.height });
  return store.addDoc({ title, width: canvas.width, height: canvas.height, layers: [layer], sourceName, colorSpace: spaceOf(canvas) });
}

export async function openFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (/\.(photoscale|psc)$/i.test(file.name)) {
      await store.task(`Opening ${file.name}`, async () => loadProject(await file.text(), stripExt(file.name)));
      continue;
    }
    if (/\.psd$/i.test(file.name)) {
      await store.task(`Opening ${file.name}`, () => openPsd(file));
      continue;
    }
    if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
      // Editable vectors; markup the importer can't read still opens as an image below
      const opened = await store.task(`Opening ${file.name}`, () => openSvg(file));
      if (opened) continue;
    }
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|ico|svg|tiff?|dng|cr2|nef|arw|raw|orf|rw2|pef)$/i.test(file.name)) {
      store.toast(`${file.name}: unsupported file type`, 'error');
      continue;
    }
    await store.task(`Opening ${file.name}`, async () => {
      try {
        // 16-bit PNG / TIFF / RAW keep every value (the browser would decode them to 8 bits)
        if (/\.(png|tiff?|dng|cr2|nef|arw|raw|orf|rw2|pef)$/i.test(file.name) && (await openHighBitFile(file))) return;
        const c = await fileToCanvas(file);
        docFromCanvas(c, stripExt(file.name), file.name);
      } catch (err) {
        const heic = /\.hei[cf]$/i.test(file.name);
        store.toast(heic ? `${file.name}: HEIC opens in the desktop app on macOS; this browser can't decode it` : `Could not open ${file.name}: ${(err as Error).message}`, 'error');
      }
    });
  }
}

export function pickFiles(accept = IMAGE_ACCEPT, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files);
    };
    input.oncancel = () => {
      input.remove();
      resolve([]);
    };
    input.click();
  });
}

/** SVG markup as editable layers, with embedded / linked images loaded. Null when it can't be read. */
async function svgLayers(file: Blob): Promise<{ width: number; height: number; layers: Layer[] } | null> {
  const { importSvg } = await import('./formats/svgImport');
  let r;
  try {
    r = importSvg(await file.text());
  } catch {
    return null;
  }
  if (!r.layers.length) return null;
  const pixels = new Map<string, HTMLCanvasElement>();
  for (const im of r.images) {
    const l = r.layers.find((x) => x.id === im.layerId)!;
    try {
      const img = await loadImage(im.href);
      const c = createCanvas(l.width, l.height);
      ctx2d(c).drawImage(img, 0, 0, l.width, l.height);
      pixels.set(l.id, c);
    } catch {
      // A missing linked image is left out
    }
  }
  const layers = r.layers.filter((l) => l.kind !== 'raster' || pixels.has(l.id)).map((l) => (pixels.has(l.id) ? withLayer(l, { canvas: pixels.get(l.id) }) : l));
  return { width: r.width, height: r.height, layers };
}

/** Opens an SVG file as a new document of editable vector layers. */
async function openSvg(file: File): Promise<boolean> {
  const r = await svgLayers(file);
  if (!r) return false;
  const bg = createCanvas(r.width, r.height);
  const bctx = ctx2d(bg);
  bctx.fillStyle = '#ffffff';
  bctx.fillRect(0, 0, r.width, r.height);
  const doc = store.addDoc({ title: stripExt(file.name), width: r.width, height: r.height, layers: [makeLayer({ kind: 'raster', name: 'Background', canvas: bg, width: r.width, height: r.height }), ...r.layers], sourceName: file.name });
  const n = r.layers.filter((l) => l.kind !== 'group').length;
  store.toast(`Opened ${file.name} as ${n} editable object${n === 1 ? '' : 's'}`, 'success');
  return !!doc;
}

/** The area a placed file lands on (Photo has a single canvas; Vector picks the artboard under `at`). */
export function placeArea(doc: Doc, _at?: { x: number; y: number }): Rect & { name?: string } {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}

export interface PlaceOptions {
  /** Document point to centre on (the drop point); the board's centre when missing. */
  at?: { x: number; y: number };
  /** Shape to fill and clip the image to; `undefined` = the selected shape, `null` = none. */
  frame?: Layer | null;
  /** nth file of a multi-file place: each one steps down-right so they don't stack exactly. */
  cascade?: number;
}

/** Where a w×h item goes inside `area`: centred on `at` (or the area), kept inside it when it fits. */
export function placeBox(area: Rect, w: number, h: number, at?: { x: number; y: number }, cascade = 0): { x: number; y: number } {
  const step = 24 * cascade;
  const cx = (at ? at.x : area.x + area.width / 2) + step;
  const cy = (at ? at.y : area.y + area.height / 2) + step;
  const clamp = (v: number, lo: number, len: number, size: number) => (size >= len ? lo + (len - size) / 2 : Math.min(Math.max(v, lo), lo + len - size));
  return { x: Math.round(clamp(cx - w / 2, area.x, area.width, w)), y: Math.round(clamp(cy - h / 2, area.y, area.height, h)) };
}

/** Places an SVG in the active document as one editable group on the current board. Returns false when it can't be read. */
export async function placeSvg(file: Blob, name: string, o: PlaceOptions = {}): Promise<boolean> {
  const doc = store.doc;
  if (!doc) return false;
  const r = await svgLayers(file);
  if (!r) return false;
  const area = placeArea(doc, o.at);
  // Fit inside the board (leaf layers move and scale; groups have no geometry of their own)
  const k = Math.min(1, (area.width * 0.9) / r.width, (area.height * 0.9) / r.height);
  const { x: dx, y: dy } = placeBox(area, r.width * k, r.height * k, o.at, o.cascade);
  const moved = r.layers.map((l) => {
    if (l.kind === 'group') return l;
    const patch: Partial<Layer> = { x: dx + l.x * k, y: dy + l.y * k, width: l.width * k, height: l.height * k };
    if (l.shape && k !== 1) patch.shape = { ...l.shape, strokeWidth: l.shape.strokeWidth * k, radius: l.shape.radius * k };
    if (l.text && k !== 1) patch.text = { ...l.text, size: l.text.size * k };
    return withLayer(l, patch);
  });
  const at = doc.layers.findIndex((l) => l.id === doc.activeId);
  const layers = [...doc.layers];
  layers.splice(at < 0 ? layers.length : at + 1, 0, ...moved);
  const grouped = groupLayers(layers, moved.filter((l) => !l.parent).map((l) => l.id), name);
  if (!grouped) return false;
  store.commit('Place SVG', { layers: grouped.layers, activeId: grouped.group.id }, { icon: 'shape' });
  return true;
}

/**
 * Places an image file as a new layer on the board being worked on: centred on `o.at` (the drop
 * point) or the board, scaled down to fit it. Over a shape frame it fills the shape and clips to it.
 */
export async function placeImage(file: Blob, name = 'Placed Image', o: PlaceOptions = {}) {
  const doc = store.doc;
  if (!doc) return;
  // SVG comes in as editable vectors (markup the importer can't read is placed as an image)
  if (file.type === 'image/svg+xml' && (await placeSvg(file, name, o))) return;
  const c = await fileToCanvas(file, workingSpace());
  // A shape acts as a frame: the image covers it and is clipped to it
  const frameLayer = o.frame !== undefined ? o.frame : store.activeLayer?.kind === 'shape' ? store.activeLayer : null;
  const frame = frameLayer ? contentBounds(frameLayer) : null;
  if (frameLayer && frame) {
    const k = Math.max(frame.width / c.width, frame.height / c.height);
    const fitted = createCanvas(Math.ceil(c.width * k), Math.ceil(c.height * k));
    const fctx = ctx2d(fitted);
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(c, 0, 0, fitted.width, fitted.height);
    const layer = makeLayer({
      kind: 'raster',
      name,
      canvas: fitted,
      clip: true,
      x: Math.round(frame.x + (frame.width - fitted.width) / 2),
      y: Math.round(frame.y + (frame.height - fitted.height) / 2),
      width: fitted.width,
      height: fitted.height,
    });
    // Above the frame and any images already clipped to it
    const layers = doc.layers;
    let i = layers.findIndex((l) => l.id === frameLayer.id);
    while (layers[i + 1]?.clip) i++;
    store.insertLayer(layer, layers[i].id, 'Place Image in Frame');
    store.toast('Image placed in frame — move it to reposition inside the shape', 'success');
    return;
  }
  const area = placeArea(doc, o.at);
  let canvas = c;
  // Fit oversized images inside the board
  const s = Math.min(1, area.width / c.width, area.height / c.height);
  if (s < 1) {
    canvas = createCanvas(Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)));
    const ctx = ctx2d(canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, canvas.width, canvas.height);
  }
  store.newRasterLayer(name, { canvas, ...placeBox(area, canvas.width, canvas.height, o.at, o.cascade) });
}

const PROJECT_FILE = /\.(photoscale|psc|illustratorscale|psd)$/i;

/**
 * Files dropped on the window. With a document open, images and SVGs are placed on the board being
 * worked on (the one under the drop point, else the active one); project files still open as
 * documents. `asDocuments` (Shift-drop) opens everything as new documents.
 */
export async function dropFiles(files: File[], o: { at?: { x: number; y: number }; frame?: Layer | null; asDocuments?: boolean } = {}) {
  const doc = store.doc;
  if (!doc || o.asDocuments) return openFiles(files);
  const isImage = (f: File) => !PROJECT_FILE.test(f.name) && (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|ico|svg|tiff?|dng|cr2|nef|arw|raw|orf|rw2|pef)$/i.test(f.name));
  const images = files.filter(isImage);
  let placed = 0;
  for (const f of images) {
    const n = placed;
    try {
      await store.task(`Placing ${f.name}`, () => placeImage(f, stripExt(f.name), { at: o.at, frame: n === 0 ? o.frame ?? null : null, cascade: n }));
      placed++;
    } catch (err) {
      store.toast(`Could not place ${f.name}: ${(err as Error).message}`, 'error');
    }
  }
  if (placed && !(placed === 1 && o.frame)) {
    const board = placeArea(doc, o.at).name;
    store.toast(`Placed ${placed === 1 ? images[0].name : `${placed} images`}${board ? ` on ${board}` : ''} · Shift-drop opens as a new document`, 'success');
  }
  const rest = files.filter((f) => !isImage(f));
  if (rest.length) await openFiles(rest);
}

// ---------------------------------------------------------------- saving

export async function saveBlob(blob: Blob, filename: string) {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b64 = await blobToBase64(blob);
      const path = await invoke<string>('save_to_downloads', { filename, dataBase64: b64 });
      store.toast(`Saved to ${path}`, 'success');
      return;
    } catch (err) {
      console.warn('Native save failed, falling back to download', err);
    }
  }
  const webkit = (window as unknown as { webkit?: { messageHandlers?: { saveFile?: { postMessage: (data: unknown) => void } } } }).webkit;
  if (webkit?.messageHandlers?.saveFile) {
    try {
      const b64 = await blobToBase64(blob);
      webkit.messageHandlers.saveFile.postMessage({ filename, dataBase64: b64 });
      store.toast(`Saved ${filename} to Downloads`, 'success');
      return;
    } catch (err) {
      console.warn('Native webkit save failed, falling back to download', err);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  store.toast(`Saved ${filename}`, 'success');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function flatten(doc: Doc): HTMLCanvasElement {
  const c = createCanvas(doc.width, doc.height);
  renderDocument(doc, c);
  return c;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';

// ---------------------------------------------------------------- more formats

const flatPixels = (doc: Doc) => {
  const c = flatten(doc);
  return { canvas: c, data: ctx2d(c).getImageData(0, 0, c.width, c.height).data };
};

/** 16-bit composite of the document (float compositing); falls back to the 8-bit render, saying why. */
export async function highBitComposite(doc: Doc): Promise<{ data: Uint16Array; exact: boolean; why: string | null }> {
  const { compositeBuffer, highBitCompositeBlocker } = await import('./hibit');
  const why = highBitCompositeBlocker(doc);
  const pb = why ? null : compositeBuffer(doc, 16);
  if (pb) return { data: pb.getContiguousArray() as Uint16Array, exact: true, why: null };
  const { data } = flatPixels(doc);
  return { data: Uint16Array.from(data, (v) => v * 257), exact: false, why: why ?? 'no float GPU support' };
}

/** File ▸ Export: 16-bit PNG or TIFF from the full-depth composite. */
export async function exportHighBit(doc: Doc, kind: 'png' | 'tiff') {
  const { data, exact, why } = await highBitComposite(doc);
  let bytes: Uint8Array;
  // Both formats carry the working space's profile (written by us: no licensed profile needed)
  const { makeWorkingProfile } = await import('./icc');
  const space = doc.colorSpace ?? 'srgb';
  const icc = makeWorkingProfile(space);
  if (kind === 'png') {
    const { encodePng16 } = await import('./formats/png16');
    bytes = await encodePng16(doc.width, doc.height, data, { name: space === 'srgb' ? 'sRGB' : 'Display P3', bytes: icc });
  } else {
    const { encodeTiff16 } = await import('./formats/tiff');
    bytes = encodeTiff16(doc.width, doc.height, data, 72, icc);
  }
  await saveBlob(new Blob([bytes as BlobPart], { type: kind === 'png' ? 'image/png' : 'image/tiff' }), `${doc.title} (16-bit).${kind === 'png' ? 'png' : 'tif'}`);
  if (exact) store.toast(`16-bit ${kind.toUpperCase()} written from the ${doc.depth ?? 8}-bit layers`, 'success');
  else store.toast(`16-bit ${kind.toUpperCase()} written from the 8-bit render (${why} not composited in float yet)`, 'info');
}

/** 16-bit PNG / TIFF / RAW: open as a 16-bit document with the file's exact values. Null when the file isn't 16-bit. */
export async function openHighBitFile(file: Blob & { name?: string }): Promise<Doc | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let img: { width: number; height: number; data: Uint16Array; icc?: Uint8Array } | null = null;
  let rawNote = '';
  if (/\.png$/i.test(file.name ?? '') || file.type === 'image/png') {
    const { decodePng16 } = await import('./formats/png16');
    const r = await decodePng16(bytes).catch(() => null);
    if (r && r.bitDepth === 16) img = r;
  } else if (/\.(dng|cr2|nef|arw|raw|orf|rw2|pef)$/i.test(file.name ?? '')) {
    const { decodeRaw } = await import('./formats/raw');
    const r = await decodeRaw(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).catch(() => null);
    if (r?.data) {
      img = { width: r.width, height: r.height, data: r.data };
      const model = [r.meta.make, r.meta.model].filter(Boolean).join(' ');
      if (model) rawNote = ` · ${model} RAW (16-bit)`;
    }
  } else if (/\.tiff?$/i.test(file.name ?? '') || file.type === 'image/tiff') {
    const { decodeTiff } = await import('./formats/tiff');
    const r = await decodeTiff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).catch(() => null);
    if (r?.data16) img = { width: r.width, height: r.height, data: r.data16, icc: r.icc };
  }
  if (!img) return null;
  const { PixelBuffer } = await import('./pixels');
  // An embedded profile other than sRGB: convert at full precision (to Display P3 for wide-gamut files)
  let space: 'srgb' | 'display-p3' = 'srgb';
  let note = rawNote;
  if (img.icc) {
    const I = await import('./icc');
    try {
      const prof = I.parseIcc(img.icc);
      if (I.matchesWorkingSpace(prof, 'display-p3')) space = 'display-p3';
      else if (!I.matchesWorkingSpace(prof, 'srgb')) {
        space = 'display-p3';
        const f = new Float32Array(img.data.length);
        for (let i = 0; i < f.length; i++) f[i] = img.data[i] / 65535;
        I.convertToWorkingFloat(prof, f, space);
        img = { ...img, data: Uint16Array.from(f, (v) => Math.round(v * 65535)) };
        note = ` · converted from “${prof.description || 'embedded profile'}” to Display P3`;
      }
    } catch (e) {
      note = ` · embedded profile ignored (${(e as Error).message})`;
    }
  }
  const pb = PixelBuffer.fromArray(img.data, img.width, img.height, 16);
  const canvas = pb.toCanvas(space, true);
  const layer = makeLayer({ kind: 'raster', name: 'Background', canvas, width: img.width, height: img.height });
  const withPx = { ...layer, pixels: pb } as Layer;
  const doc = store.addDoc({ title: stripExt(file.name ?? 'Untitled'), width: img.width, height: img.height, layers: [withPx], sourceName: file.name, colorSpace: space });
  doc.depth = 16;
  doc.history[0].depth = 16;
  store.emit();
  store.toast(`Opened as a 16-bit document${note}`);
  return doc;
}

export async function exportTiff(doc: Doc, cmyk = false) {
  const isCmyk = cmyk || doc.colorMode === 'cmyk';
  const { encodeTiff } = await import('./formats/tiff');
  const { data } = flatPixels(doc);
  // RGB TIFFs carry the working-space profile (tag 34675); CMYK files never do — the working profile is RGB.
  const { makeWorkingProfile } = await import('./icc');
  const bytes = encodeTiff({ width: doc.width, height: doc.height, data }, { cmyk: isCmyk, dpi: isCmyk ? 300 : 72, icc: isCmyk ? undefined : makeWorkingProfile(doc.colorSpace ?? 'srgb') });
  await saveBlob(new Blob([bytes as BlobPart], { type: 'image/tiff' }), `${doc.title}${isCmyk ? ' (CMYK)' : ''}.tif`);
}

export async function exportPdf(doc: Doc, opts: { lossless?: boolean; quality?: number; dpi?: number } = {}) {
  const { buildPdf, deflate } = await import('./formats/pdf');
  const { canvas, data } = flatPixels(doc);
  const n = doc.width * doc.height;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { opaque = false; break; }
  const alpha = opaque ? undefined : await deflate(Uint8Array.from({ length: n }, (_, i) => data[i * 4 + 3]));
  let img: Parameters<typeof buildPdf>[0];
  if (opts.lossless) {
    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], i * 3);
    img = { width: doc.width, height: doc.height, data: await deflate(rgb), filter: 'FlateDecode', alpha };
  } else {
    // JPEG has no alpha: put the colour on white, keep transparency in the soft mask
    const flat = createCanvas(doc.width, doc.height);
    const fctx = ctx2d(flat);
    fctx.fillStyle = '#fff';
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    const jpg = new Uint8Array(await (await canvasToBlob(flat, 'image/jpeg', opts.quality ?? 0.92)).arrayBuffer());
    img = { width: doc.width, height: doc.height, data: jpg, filter: 'DCTDecode', alpha };
  }
  const bytes = buildPdf(img, { dpi: opts.dpi ?? 72, title: doc.title });
  await saveBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${doc.title}.pdf`);
}

export async function exportSvg(doc: Doc) {
  const { docToSvg } = await import('./formats/svg');
  await saveBlob(new Blob([docToSvg(doc)], { type: 'image/svg+xml' }), `${doc.title}.svg`);
}

export async function exportBmp(doc: Doc) {
  const { encodeBmp } = await import('./formats/bmp');
  const { data } = flatPixels(doc);
  await saveBlob(new Blob([encodeBmp(doc.width, doc.height, data) as BlobPart], { type: 'image/bmp' }), `${doc.title}.bmp`);
}

const pngBytes = async (c: HTMLCanvasElement) => new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());

function scaled(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/** Favicon / app icon: 16, 32, 48, 64, 128 and 256 px, fitted into a square. */
export async function exportIco(doc: Doc) {
  const { encodeIco } = await import('./formats/ico');
  const flat = flatten(doc);
  const images = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const c = createCanvas(size, size);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = 'high';
    const k = Math.min(size / doc.width, size / doc.height);
    ctx.drawImage(flat, (size - doc.width * k) / 2, (size - doc.height * k) / 2, doc.width * k, doc.height * k);
    images.push({ size, png: await pngBytes(c) });
  }
  await saveBlob(new Blob([encodeIco(images) as BlobPart], { type: 'image/x-icon' }), `${doc.title}.ico`);
}

/** File ▸ Export ▸ Layers to Files: every visible layer as its own PNG (with styles), zipped. */
export async function exportLayers(doc: Doc, opts: { trim?: boolean } = {}) {
  const { zip } = await import('./formats/zip');
  const files: { name: string; data: Uint8Array }[] = [];
  let i = 0;
  for (const l of [...doc.layers].reverse()) {
    if (l.kind === 'adjustment' || l.kind === 'group' || !l.visible) continue;
    i++;
    const c = createCanvas(doc.width, doc.height);
    renderDocument({ ...doc, layers: [{ ...l, parent: undefined, clip: false }] }, c);
    let out = c;
    if (opts.trim) {
      const { alphaBounds } = await import('./canvas');
      const b = alphaBounds(c);
      if (!b) continue;
      out = createCanvas(b.width, b.height);
      ctx2d(out).drawImage(c, -b.x, -b.y);
    }
    files.push({ name: `${String(i).padStart(2, '0')} ${l.name.trim() || 'Layer'}.png`, data: await pngBytes(out) });
  }
  if (!files.length) return store.toast('No visible pixel, text or shape layers to export');
  await saveBlob(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${doc.title} layers.zip`);
}

/** Export @1x / @2x / @3x (or any scales) of the image in one ZIP, for apps and the web. */
export async function exportScales(doc: Doc, scales = [1, 2, 3], format: ExportFormat = 'png') {
  const { zip } = await import('./formats/zip');
  const flat = flatten(doc);
  const files = [];
  for (const k of scales) {
    const c = scaled(flat, Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
    const blob = await canvasToBlob(c, `image/${format}`, 0.92);
    files.push({ name: `${doc.title}${k === 1 ? '' : `@${k}x`}.${format === 'jpeg' ? 'jpg' : format}`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  await saveBlob(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${doc.title} sizes.zip`);
}

export type MultiExportFormatId = 'psd' | 'pdf' | 'cmyk-tiff' | 'tiff' | 'png' | 'jpeg' | 'webp';

export interface BatchExportConfig {
  formats: MultiExportFormatId[];
  scale?: number;
  quality?: number;
  asZip?: boolean;
}

/** Simultaneous multi-format export across PSD, PDF, CMYK TIFF, TIFF, PNG, JPEG, WebP. */
export async function batchExportFormats(doc: Doc, config: BatchExportConfig): Promise<number> {
  const formats = config.formats || [];
  if (!formats.length) {
    store.toast('Please select at least one format to export', 'info');
    return 0;
  }

  const files: { name: string; data: Uint8Array; type: string }[] = [];
  const scale = config.scale ?? 1;
  const quality = config.quality ?? 0.92;

  for (const fmt of formats) {
    if (fmt === 'psd') {
      const { psdBytes } = await import('./psd');
      const { bytes } = await psdBytes(doc);
      files.push({
        name: `${doc.title}.psd`,
        data: new Uint8Array(bytes),
        type: 'image/vnd.adobe.photoshop',
      });
    } else if (fmt === 'pdf') {
      const { buildPdf, deflate } = await import('./formats/pdf');
      const { canvas, data } = flatPixels(doc);
      const n = doc.width * doc.height;
      let opaque = true;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { opaque = false; break; }
      const alpha = opaque ? undefined : await deflate(Uint8Array.from({ length: n }, (_, i) => data[i * 4 + 3]));
      const flat = createCanvas(doc.width, doc.height);
      const fctx = ctx2d(flat);
      fctx.fillStyle = '#fff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(canvas, 0, 0);
      const jpg = new Uint8Array(await (await canvasToBlob(flat, 'image/jpeg', quality)).arrayBuffer());
      const img = { width: doc.width, height: doc.height, data: jpg, filter: 'DCTDecode' as const, alpha };
      const pdfBytes = buildPdf(img, { dpi: 300, title: doc.title });
      files.push({
        name: `${doc.title}.pdf`,
        data: pdfBytes,
        type: 'application/pdf',
      });
    } else if (fmt === 'cmyk-tiff' || fmt === 'tiff') {
      const { encodeTiff } = await import('./formats/tiff');
      const { data } = flatPixels(doc);
      const isCmyk = fmt === 'cmyk-tiff';
      const { makeWorkingProfile } = await import('./icc');
      const bytes = encodeTiff({ width: doc.width, height: doc.height, data }, { cmyk: isCmyk, dpi: isCmyk ? 300 : 72, icc: isCmyk ? undefined : makeWorkingProfile(doc.colorSpace ?? 'srgb') });
      files.push({
        name: `${doc.title}${isCmyk ? ' (CMYK)' : ''}.tif`,
        data: bytes,
        type: 'image/tiff',
      });
    } else if (fmt === 'png') {
      const blob = await renderExport(doc, 'png', 1, scale, null);
      files.push({
        name: `${doc.title}${scale !== 1 ? `@${scale}x` : ''}.png`,
        data: new Uint8Array(await blob.arrayBuffer()),
        type: 'image/png',
      });
    } else if (fmt === 'jpeg') {
      const blob = await renderExport(doc, 'jpeg', quality, scale, '#ffffff');
      files.push({
        name: `${doc.title}${scale !== 1 ? `@${scale}x` : ''}.jpg`,
        data: new Uint8Array(await blob.arrayBuffer()),
        type: 'image/jpeg',
      });
    } else if (fmt === 'webp') {
      const blob = await renderExport(doc, 'webp', quality, scale, null);
      files.push({
        name: `${doc.title}${scale !== 1 ? `@${scale}x` : ''}.webp`,
        data: new Uint8Array(await blob.arrayBuffer()),
        type: 'image/webp',
      });
    }
  }

  if (config.asZip ?? true) {
    const { zip } = await import('./formats/zip');
    const zipBytes = zip(files.map((f) => ({ name: f.name, data: f.data })));
    await saveBlob(new Blob([zipBytes as BlobPart], { type: 'application/zip' }), `${doc.title} Multi-Format Export.zip`);
  } else {
    for (const f of files) {
      await saveBlob(new Blob([f.data as BlobPart], { type: f.type }), f.name);
    }
  }

  store.toast(`Batch export complete (${files.length} formats)!`, 'success');
  return files.length;
}

export async function exportImage(doc: Doc, format: ExportFormat, quality: number, scale: number, background: string | null) {
  const { record } = await import('./actions');
  record({ kind: 'export', format, quality, scale, label: `Export ${format.toUpperCase()}${format === 'png' ? '' : ` ${Math.round(quality * 100)}%`}${scale !== 1 ? ` at ${Math.round(scale * 100)}%` : ''}` });
  const blob = await renderExport(doc, format, quality, scale, background);
  await saveBlob(blob, `${doc.title}.${format === 'jpeg' ? 'jpg' : format}`);
}

/** The exported file as a Blob (used by Export, actions and batches). */
export async function renderExport(doc: Doc, format: ExportFormat, quality: number, scale: number, background: string | null = null): Promise<Blob> {
  const flat = flatten(doc);
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  const out = createCanvas(w, h);
  const ctx = ctx2d(out);
  if (background || format === 'jpeg') {
    ctx.fillStyle = background ?? '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(flat, 0, 0, w, h);
  const blob = await canvasToBlob(out, `image/${format}`, quality);
  // Tag the file with the working space, so other apps show the same colours
  const { makeWorkingProfile } = await import('./icc');
  const { embedProfile } = await import('./formats/iccEmbed');
  const space = doc.colorSpace ?? 'srgb';
  return embedProfile(blob, makeWorkingProfile(space), space === 'srgb' ? 'sRGB' : 'Display P3');
}

// ---------------------------------------------------------------- Photoshop

export async function openPsd(file: Blob & { name?: string }) {
  const { psdToLayers } = await import('./psd');
  try {
    const r = await psdToLayers(await file.arrayBuffer());
    const title = stripExt(file.name ?? 'Untitled');
    store.addDoc({ title, width: r.width, height: r.height, layers: r.layers, sourceName: file.name });
    store.toast(r.notes.length ? `Opened ${title}.psd · ${r.notes.join(', ')} kept as they look` : `Opened ${title}.psd with ${r.layers.length} layers`, 'success');
  } catch (err) {
    store.toast(`Could not open PSD: ${(err as Error).message}`, 'error');
  }
}

export async function exportPsd(doc: Doc) {
  const { psdBytes } = await import('./psd');
  const { bytes, skipped } = await psdBytes(doc);
  await saveBlob(new Blob([bytes], { type: 'image/vnd.adobe.photoshop' }), `${doc.title}.psd`);
  if (skipped) store.toast(`${skipped} adjustment layer${skipped > 1 ? 's were' : ' was'} left out of the PSD layers (the preview image keeps the look)`);
}

// ---------------------------------------------------------------- project format

interface ProjectLayer extends Omit<Layer, 'canvas' | 'mask' | 'v' | 'smart'> {
  png?: string;
  mask?: Omit<Mask, 'canvas'> & { png: string };
  smart?: Omit<SmartData, 'source'> & { source: string };
}

interface ProjectFile {
  format: 'photoscale';
  version: 3;
  title: string;
  width: number;
  height: number;
  activeId: string;
  layers: ProjectLayer[];
  safeZone?: string;
  grids?: Doc['grids'];
  /** Display P3 documents (the PNGs carry their profile); absent = sRGB. */
  colorSpace?: Doc['colorSpace'];
}

export function serializeProject(doc: Doc): string {
  const file: ProjectFile = {
    format: 'photoscale',
    version: 3,
    title: doc.title,
    width: doc.width,
    height: doc.height,
    activeId: doc.activeId,
    safeZone: doc.safeZone,
    grids: doc.grids,
    colorSpace: doc.colorSpace,
    layers: doc.layers.map((l) => {
      const { canvas, mask, v: _v, smart, ...rest } = l;
      return {
        ...rest,
        smart: smart ? { ...smart, source: smart.source.toDataURL('image/png') } : undefined,
        png: canvas ? canvas.toDataURL('image/png') : undefined,
        mask: mask ? { x: mask.x, y: mask.y, enabled: mask.enabled, png: mask.canvas.toDataURL('image/png') } : undefined,
      };
    }),
  };
  return JSON.stringify(file);
}

async function dataUrlToCanvas(url: string, space: ColorSpaceId = 'srgb'): Promise<HTMLCanvasElement> {
  const img = await loadImage(url);
  const c = createCanvas(img.naturalWidth, img.naturalHeight, space);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

export async function loadProject(json: string, fallbackTitle = 'Untitled'): Promise<Doc> {
  const file = JSON.parse(json) as ProjectFile;
  if (file.format !== 'photoscale' || !Array.isArray(file.layers)) throw new Error('Not a Skill Photo project');
  const layers: Layer[] = [];
  const space: ColorSpaceId = file.colorSpace === 'display-p3' ? 'display-p3' : 'srgb';
  for (const pl of file.layers) {
    const { png, mask, smart, ...rest } = pl;
    const layer = makeLayer({ ...rest, kind: rest.kind, name: rest.name });
    if (smart) layer.smart = { ...smart, source: await dataUrlToCanvas(smart.source, space) };
    (layer as { id: string }).id = rest.id;
    if (png) layer.canvas = await dataUrlToCanvas(png, space);
    if (mask) layer.mask = { x: mask.x, y: mask.y, enabled: mask.enabled, canvas: await dataUrlToCanvas(mask.png, space) };
    layers.push(layer);
  }
  if (!layers.length) throw new Error('Project has no layers');
  const doc = store.addDoc({ title: file.title || fallbackTitle, width: file.width, height: file.height, layers, safeZone: file.safeZone, colorSpace: space });
  if (layers.some((l) => l.id === file.activeId)) doc.activeId = file.activeId;
  if (Array.isArray(file.grids)) doc.grids = file.grids;
  doc.history[0].activeId = doc.activeId;
  doc.history[0].grids = doc.grids;
  store.emit();
  return doc;
}

export async function saveProject(doc: Doc) {
  const blob = new Blob([serializeProject(doc)], { type: 'application/json' });
  await saveBlob(blob, `${doc.title}.photoscale`);
  doc.dirty = false;
  store.emit();
}

// ---------------------------------------------------------------- clipboard

export async function copyCanvasToClipboard(c: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await canvasToBlob(c, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- crash recovery (IndexedDB)

const DB = 'photoscale-recovery';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('docs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function computeRecoveryChecksum(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export async function saveRecovery(doc: Doc) {
  try {
    const db = await idb();
    const json = serializeProject(doc);
    const checksum = computeRecoveryChecksum(json);
    const recoveryItem = { json, checksum, time: Date.now(), title: doc.title };

    const tx = db.transaction('docs', 'readwrite');
    const storeObj = tx.objectStore('docs');

    // Atomic staging write first
    storeObj.put(recoveryItem, 'latest_staging');

    // Rotate existing recoveries (keep last 3)
    const existingReq = storeObj.get('latest');
    existingReq.onsuccess = () => {
      const existing = existingReq.result;
      if (existing) {
        const r1Req = storeObj.get('recovery_1');
        r1Req.onsuccess = () => {
          if (r1Req.result) {
            storeObj.put(r1Req.result, 'recovery_2');
          }
          storeObj.put(existing, 'recovery_1');
        };
      }
      // Commit staging into latest and remove staging
      storeObj.put(recoveryItem, 'latest');
      storeObj.delete('latest_staging');
    };
  } catch {
    /* recovery is best-effort */
  }
}

export async function readRecovery(): Promise<{ json: string; time: number; title: string } | null> {
  try {
    const db = await idb();
    const tryKeys = ['latest', 'recovery_1', 'recovery_2'];
    for (const key of tryKeys) {
      const item = await new Promise<{ json: string; checksum?: string; time: number; title: string } | null>((resolve) => {
        const req = db.transaction('docs').objectStore('docs').get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
      if (item && item.json) {
        if (!item.checksum || computeRecoveryChecksum(item.json) === item.checksum) {
          return item;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearRecovery() {
  try {
    const db = await idb();
    const tx = db.transaction('docs', 'readwrite');
    const storeObj = tx.objectStore('docs');
    storeObj.delete('latest');
    storeObj.delete('latest_staging');
    storeObj.delete('recovery_1');
    storeObj.delete('recovery_2');
  } catch {
    /* ignore */
  }
}
