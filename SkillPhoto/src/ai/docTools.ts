/**
 * Document tools for the assistant — layer-based apps (Skill Vector, Skill Photo).
 * Shared copy — keep identical in SkillVector/src/ai and SkillPhoto/src/ai.
 */
import { store } from '../core/store';
import { makeLayer, withLayer } from '../core/types';
import type { Layer } from '../core/types';
import { syncTextBounds } from '../core/render';
import * as io from '../core/io';
import * as ops from '../core/ops';
import { createTextAt } from '../core/tools';
import { createCanvas, ctx2d } from '../core/canvas';
import { canvasToJpeg } from './agent';
import type { AppTool } from './agent';
import { generateImage } from './providers';

const num = (v: unknown, d?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : d);
const r1 = (n: number) => Math.round(n * 10) / 10;

function needDoc() {
  const doc = store.doc;
  if (!doc) throw new Error('No document is open. Create one first (run_command "new" opens the New dialog; create_document makes one directly).');
  return doc;
}

function layerById(id: unknown): Layer {
  const doc = needDoc();
  const l = doc.layers.find((x) => x.id === id);
  if (!l) throw new Error(`No layer with id "${String(id)}". Call get_document for the current ids.`);
  return l;
}

function describeLayer(l: Layer, depth: number): string {
  const bits = [`${'  '.repeat(depth)}- ${l.id} ${l.kind} "${l.name}" at ${Math.round(l.x)},${Math.round(l.y)} ${Math.round(l.width)}×${Math.round(l.height)}`];
  if (!l.visible) bits.push('hidden');
  if (l.locked) bits.push('locked');
  if (l.opacity < 1) bits.push(`opacity ${r1(l.opacity)}`);
  if (l.blend !== 'normal') bits.push(`blend ${l.blend}`);
  if (l.rotation) bits.push(`rot ${Math.round(l.rotation)}°`);
  if (l.text) bits.push(`text "${l.text.text.slice(0, 80).replace(/\n/g, '⏎')}" ${l.text.font} ${Math.round(l.text.size)}px w${l.text.weight} ${l.text.color} ${l.text.align}`);
  if (l.shape) {
    const s = l.shape as { kind?: string; fill: string; fillEnabled: boolean; stroke: string; strokeWidth: number; radius: number };
    bits.push(`${s.kind ?? 'shape'} fill ${s.fillEnabled ? s.fill : 'none'} stroke ${s.strokeWidth ? `${s.stroke} ${r1(s.strokeWidth)}px` : 'none'}${s.radius ? ` radius ${r1(s.radius)}` : ''}`);
  }
  if (l.clip) bits.push('clipped');
  if (l.mask) bits.push('masked');
  return bits.join(' · ');
}

/** Text summary of the open document for the model (layers top to bottom, nested by group). */
export function documentSummary(maxLayers = 160): string {
  const doc = store.doc;
  if (!doc) return 'No document open.';
  const lines = [`Document "${doc.title}" ${doc.width}×${doc.height}px, ${doc.layers.length} layers. Active layer: ${doc.activeId}.`];
  const sel = store.selectedLayers.map((l) => l.id);
  if (sel.length > 1) lines.push(`Selected layers: ${sel.join(', ')}`);
  if (doc.selection) {
    const b = doc.selection.bounds;
    lines.push(`Pixel selection: ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}`);
  }
  // Artboards exist in Skill Vector only
  const boards = (doc as { artboards?: { id: string; name: string; x: number; y: number; width: number; height: number }[]; activeArtboardId?: string }).artboards;
  const activeBoard = (doc as { activeArtboardId?: string }).activeArtboardId;
  if (boards?.length) lines.push(`Artboards: ${boards.map((a) => `${a.id} "${a.name}" ${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.width)}×${Math.round(a.height)}`).join('; ')}${activeBoard ? ` (active ${activeBoard})` : ''}`);
  lines.push('Layers, top first:');
  const children = new Map<string | undefined, Layer[]>();
  for (const l of doc.layers) {
    const k = l.parent;
    if (!children.has(k)) children.set(k, []);
    children.get(k)!.push(l);
  }
  let n = 0;
  const walk = (parent: string | undefined, depth: number) => {
    for (const l of [...(children.get(parent) ?? [])].reverse()) {
      if (n++ >= maxLayers) return;
      lines.push(describeLayer(l, depth));
      if (l.kind === 'group') walk(l.id, depth + 1);
    }
  };
  walk(undefined, 0);
  if (n > maxLayers) lines.push(`… ${doc.layers.length - maxLayers} more layers not shown.`);
  return lines.join('\n');
}

/** Undo-turn hooks for layer apps: the document and its history position. */
export function docCheckpoint(): unknown {
  const doc = store.doc;
  return doc ? { id: doc.id, h: doc.hIndex } : null;
}
export function docRevertTo(mark: unknown): number {
  const m = mark as { id: string; h: number } | null;
  const doc = store.doc;
  if (!m || !doc || doc.id !== m.id) return 0;
  let n = 0;
  while (store.doc && store.doc.hIndex > m.h && n < 500) {
    const before = store.doc.hIndex;
    store.undo();
    if (store.doc.hIndex === before) break;
    n++;
  }
  return n;
}

export function shortContext(): string {
  const doc = store.doc;
  if (!doc) return 'No document open.';
  const a = store.activeLayer;
  return `Document "${doc.title}" ${doc.width}×${doc.height}px, ${doc.layers.length} layers; active: ${a ? `${a.id} ${a.kind} "${a.name}"` : 'none'}; tool: ${store.state.tool}.`;
}

export function snapshotDoc(max = 1024): string | null {
  const doc = store.doc;
  if (!doc) return null;
  return canvasToJpeg(store.docPixels(), doc.width, doc.height, max);
}

const dataUrlToCanvas = (url: string) =>
  new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = createCanvas(img.naturalWidth, img.naturalHeight);
      ctx2d(c).drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('The generated image could not be decoded.'));
    img.src = url;
  });

/** Draws `src` to cover a w×h box (centre crop), like CSS object-fit: cover. */
export function coverCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const g = ctx2d(c);
  const k = Math.max(c.width / src.width, c.height / src.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (c.width - src.width * k) / 2, (c.height - src.height * k) / 2, src.width * k, src.height * k);
  return c;
}

export async function imageLayerFromUrl(url: string, name: string, box: { x: number; y: number; width: number; height: number }): Promise<Layer> {
  const src = await dataUrlToCanvas(url);
  const canvas = coverCanvas(src, box.width, box.height);
  const layer = makeLayer({ kind: 'raster', name, canvas, x: Math.round(box.x), y: Math.round(box.y), width: canvas.width, height: canvas.height });
  store.insertLayer(layer, undefined, `AI: ${name}`);
  return layer;
}

const TEXT_KEYS = ['text', 'font', 'size', 'weight', 'italic', 'color', 'align', 'lineHeight', 'tracking', 'caps'] as const;
const SHAPE_KEYS = ['fill', 'stroke', 'strokeWidth', 'radius', 'fillOpacity', 'strokeOpacity'] as const;

function layerPatch(l: Layer, a: Record<string, unknown>): Partial<Layer> {
  const patch: Partial<Layer> = {};
  if (typeof a.name === 'string') patch.name = a.name;
  for (const k of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    const v = num(a[k]);
    if (v !== undefined) patch[k] = v;
  }
  const op = num(a.opacity);
  if (op !== undefined) patch.opacity = Math.max(0, Math.min(1, op > 1 ? op / 100 : op));
  if (typeof a.visible === 'boolean') patch.visible = a.visible;
  if (typeof a.locked === 'boolean') patch.locked = a.locked;
  if (typeof a.blend === 'string') patch.blend = a.blend as Layer['blend'];
  if (l.text) {
    const t = { ...l.text } as Record<string, unknown>;
    let any = false;
    for (const k of TEXT_KEYS) {
      if (a[k] === undefined) continue;
      t[k] = k === 'size' || k === 'weight' || k === 'lineHeight' || k === 'tracking' ? num(a[k]) : a[k];
      any = true;
    }
    if (typeof a.fill === 'string' && a.color === undefined) {
      t.color = a.fill;
      any = true;
    }
    if (any) patch.text = t as unknown as Layer['text'];
  }
  if (l.shape) {
    const s = { ...l.shape } as Record<string, unknown>;
    let any = false;
    for (const k of SHAPE_KEYS) {
      if (a[k] === undefined) continue;
      any = true;
      if (k === 'fill') {
        if (a.fill === 'none' || a.fill === null) s.fillEnabled = false;
        else {
          s.fill = a.fill;
          s.fillEnabled = true;
        }
      } else if (k === 'stroke') {
        if (a.stroke === 'none' || a.stroke === null) s.strokeWidth = 0;
        else s.stroke = a.stroke;
      } else s[k] = num(a[k]);
    }
    if (any) patch.shape = s as unknown as Layer['shape'];
  }
  return patch;
}

/** Tools every layer-based app shares. */
export function docTools(): AppTool[] {
  return [
    {
      name: 'get_document',
      description: 'Full state of the open document: size, artboards, pixel selection and every layer (id, kind, name, position, size, text and shape styling), top layer first.',
      parameters: { type: 'object', properties: {} },
      run: () => documentSummary(),
    },
    {
      name: 'look',
      description: 'See the current canvas as an image (the whole document). Use it to check your work.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const img = snapshotDoc(1280);
        if (!img) throw new Error('No document open.');
        return { text: 'Snapshot of the document.', image: img };
      },
    },
    {
      name: 'create_document',
      description: 'Create and open a new blank document (opens in a new tab).',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, background: { type: 'string', description: 'CSS colour, or "transparent". Default white.' } },
        required: ['width', 'height'],
      },
      run: (a) => {
        const w = Math.round(num(a.width, 1080)!);
        const h = Math.round(num(a.height, 1080)!);
        if (w < 1 || h < 1 || w > 16000 || h > 16000) throw new Error('Width and height must be 1–16000 px.');
        const bg = createCanvas(w, h);
        const color = typeof a.background === 'string' ? a.background : '#ffffff';
        if (color !== 'transparent') {
          const g = ctx2d(bg);
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
        }
        io.docFromCanvas(bg, typeof a.title === 'string' && a.title ? a.title : 'Untitled', undefined);
        return `Created "${store.doc?.title}" ${w}×${h}px.`;
      },
    },
    {
      name: 'select_layers',
      description: 'Select layers by id (the first becomes active). Many commands act on the selection.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
      run: (a) => {
        const ids = (Array.isArray(a.ids) ? a.ids : []).map(String);
        if (!ids.length) throw new Error('Give at least one id.');
        ids.forEach((id) => layerById(id));
        store.selectLayer(ids[0], 'replace');
        for (const id of ids.slice(1)) store.selectLayer(id, 'toggle');
        return `Selected ${ids.length} layer(s).`;
      },
    },
    {
      name: 'update_layer',
      description:
        'Change a layer: name, x, y, width, height, rotation (deg), opacity (0–1), visible, locked, blend. Text layers: text, font, size, weight (100–900), italic, color, align (left|center|right), lineHeight (multiplier), tracking (px), caps. Shape layers: fill (CSS colour or "none"), stroke (colour or "none"), strokeWidth, radius, fillOpacity, strokeOpacity.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          rotation: { type: 'number' },
          opacity: { type: 'number' },
          visible: { type: 'boolean' },
          locked: { type: 'boolean' },
          blend: { type: 'string' },
          text: { type: 'string' },
          font: { type: 'string' },
          size: { type: 'number' },
          weight: { type: 'number' },
          italic: { type: 'boolean' },
          color: { type: 'string' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          lineHeight: { type: 'number' },
          tracking: { type: 'number' },
          caps: { type: 'boolean' },
          fill: { type: 'string' },
          stroke: { type: 'string' },
          strokeWidth: { type: 'number' },
          radius: { type: 'number' },
          fillOpacity: { type: 'number' },
          strokeOpacity: { type: 'number' },
        },
        required: ['id'],
      },
      run: (a) => {
        const l = layerById(a.id);
        const patch = layerPatch(l, a);
        if (!Object.keys(patch).length) throw new Error('Nothing to change: no recognised properties for this layer kind.');
        if (patch.text) Object.assign(patch, syncTextBounds(withLayer(l, patch)));
        store.updateLayer(l.id, patch, `AI: Edit ${l.name}`);
        return `Updated ${l.id}: ${Object.keys(patch).join(', ')}.`;
      },
    },
    {
      name: 'add_text',
      description: 'Add a text layer. x/y is the top-left of the text block. Give width for a wrapping paragraph box.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number', description: 'Paragraph box width; omit for a single line.' },
          font: { type: 'string', description: 'Font family, e.g. "Inter", "Playfair Display", "Montserrat" (Google Fonts load on demand).' },
          size: { type: 'number' },
          weight: { type: 'number' },
          italic: { type: 'boolean' },
          color: { type: 'string' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          lineHeight: { type: 'number' },
          tracking: { type: 'number' },
          caps: { type: 'boolean' },
          name: { type: 'string' },
        },
        required: ['text', 'x', 'y'],
      },
      run: (a) => {
        needDoc();
        const x = num(a.x, 0)!;
        const y = num(a.y, 0)!;
        const width = num(a.width);
        createTextAt(x, y, width ?? undefined);
        const l = store.activeLayer;
        store.set({ textEditId: null });
        if (!l || l.kind !== 'text') throw new Error('Could not create the text layer.');
        const patch = layerPatch(l, { ...a, name: typeof a.name === 'string' ? a.name : String(a.text).slice(0, 32) });
        const placed = withLayer(l, patch);
        Object.assign(patch, syncTextBounds(placed), { x, y });
        store.updateLayer(l.id, patch, 'AI: Text');
        return `Added text ${l.id} at ${Math.round(x)},${Math.round(y)}.`;
      },
    },
    {
      name: 'insert_svg',
      description:
        'Draw vector artwork: SVG markup becomes editable layers (rect, circle, ellipse, line, polyline, polygon, path, text, linearGradient / radialGradient fills, groups). Use a viewBox. It is placed as a group, centred at (x, y) or on the board, scaled down only if larger than the board. Best for icons, logos, illustrations, layouts of shapes.',
      parameters: {
        type: 'object',
        properties: {
          svg: { type: 'string', description: 'Complete <svg …>…</svg> markup.' },
          name: { type: 'string', description: 'Name for the group.' },
          x: { type: 'number', description: 'Centre x in document pixels (optional).' },
          y: { type: 'number', description: 'Centre y in document pixels (optional).' },
        },
        required: ['svg'],
      },
      run: async (a) => {
        needDoc();
        const svg = String(a.svg ?? '');
        if (!/<svg[\s>]/i.test(svg)) throw new Error('Not SVG markup (needs an <svg> root).');
        const before = new Set(store.doc!.layers.map((l) => l.id));
        const cx = num(a.x);
        const cy = num(a.y);
        const name = typeof a.name === 'string' && a.name ? a.name : 'AI artwork';
        await io.placeImage(new Blob([svg], { type: 'image/svg+xml' }), name, { frame: null, ...(cx !== undefined && cy !== undefined ? { at: { x: cx, y: cy } } : {}) });
        const added = store.doc!.layers.filter((l) => !before.has(l.id));
        if (!added.length) throw new Error('The SVG could not be read.');
        const vector = added.filter((l) => l.kind !== 'raster').length;
        return `Placed "${name}" as ${added.length} layer(s) (${vector} editable). Group id: ${store.doc!.activeId}.`;
      },
    },
    {
      name: 'delete_layers',
      description: 'Delete layers by id.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
      run: (a) => {
        const ids = (Array.isArray(a.ids) ? a.ids : []).map(String);
        ids.forEach((id) => layerById(id));
        for (const id of ids) ops.deleteLayer(id);
        return `Deleted ${ids.length} layer(s).`;
      },
    },
    {
      name: 'generate_image',
      description:
        'Generate a picture with an image model (ChatGPT / Gemini image generation) and place it as a new image layer covering the box (default: the whole document). For photos, textures, backgrounds, illustrations in a painted style. Not for text or logos — draw those with add_text / insert_svg.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description: subject, style, lighting, composition, colours.' },
          name: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          transparent: { type: 'boolean', description: 'Ask for a transparent background (cut-out object). OpenAI only.' },
        },
        required: ['prompt'],
      },
      run: async (a, ctx) => {
        const doc = needDoc();
        const box = { x: num(a.x, 0)!, y: num(a.y, 0)!, width: num(a.width, doc.width)!, height: num(a.height, doc.height)! };
        const url = await generateImage(ctx.settings, { prompt: String(a.prompt), size: box, transparent: a.transparent === true, signal: ctx.signal });
        const name = typeof a.name === 'string' && a.name ? a.name : 'AI image';
        const l = await imageLayerFromUrl(url, name, box);
        return `Placed generated image ${l.id} at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}.`;
      },
    },
  ];
}
