/** Skill Photo's assistant adapter: photo-editing knowledge, adjustment and generative tools. */
import { COMMANDS } from '../core/commands';
import { store } from '../core/store';
import { makeLayer } from '../core/types';
import type { Adjust } from '../core/types';
import * as ops from '../core/ops';
import { createCanvas, ctx2d } from '../core/canvas';
import { commandTools } from './agent';
import type { AppAdapter, AppTool } from './agent';
import { docCheckpoint, docRevertTo, docTools, shortContext, snapshotDoc } from './docTools';
import { generateImage } from './providers';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SCALARS: [keyof Adjust, number, number][] = [
  ['exposure', -5, 5],
  ['contrast', -100, 100],
  ['highlights', -100, 100],
  ['shadows', -100, 100],
  ['whites', -100, 100],
  ['blacks', -100, 100],
  ['temperature', -100, 100],
  ['tint', -100, 100],
  ['vibrance', -100, 100],
  ['saturation', -100, 100],
  ['hue', -180, 180],
  ['clarity', -100, 100],
  ['dehaze', -100, 100],
  ['sharpen', 0, 100],
  ['vignette', -100, 100],
  ['grain', 0, 100],
  ['fade', 0, 100],
];

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The generated image could not be decoded.'));
    img.src = url;
  });

/** Repaints the selected area with an image model; the result is a new layer clipped to the selection. */
async function generativeFill(prompt: string, settings: Parameters<typeof generateImage>[0], signal: AbortSignal, name: string): Promise<string> {
  const doc = store.doc;
  if (!doc) throw new Error('No document open.');
  const sel = doc.selection;
  if (!sel) throw new Error('Make a selection first (e.g. run_command "select-subject", or ask the user to lasso the area).');
  // Context around the selection helps the model match light and texture
  const pad = Math.round(Math.max(sel.bounds.width, sel.bounds.height) * 0.25 + 16);
  const x0 = clamp(Math.floor(sel.bounds.x - pad), 0, doc.width);
  const y0 = clamp(Math.floor(sel.bounds.y - pad), 0, doc.height);
  const x1 = clamp(Math.ceil(sel.bounds.x + sel.bounds.width + pad), 0, doc.width);
  const y1 = clamp(Math.ceil(sel.bounds.y + sel.bounds.height + pad), 0, doc.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) throw new Error('The selection is too small.');
  const crop = createCanvas(w, h);
  ctx2d(crop).drawImage(store.docPixels(), -x0, -y0);
  // OpenAI mask: opaque = keep, transparent = repaint
  const mask = createCanvas(w, h);
  const mg = ctx2d(mask);
  mg.fillStyle = '#000';
  mg.fillRect(0, 0, w, h);
  mg.globalCompositeOperation = 'destination-out';
  mg.drawImage(sel.canvas, -x0, -y0);
  const url = await generateImage(settings, { prompt, image: crop.toDataURL('image/png'), mask: mask.toDataURL('image/png'), size: { width: w, height: h }, signal });
  const img = await loadImage(url);
  const out = createCanvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  // Keep only the selected area, with a slightly softened edge
  g.globalCompositeOperation = 'destination-in';
  g.filter = 'blur(1.5px)';
  g.drawImage(sel.canvas, -x0, -y0);
  g.filter = 'none';
  const layer = makeLayer({ kind: 'raster', name, canvas: out, x: x0, y: y0, width: w, height: h });
  store.insertLayer(layer, undefined, `AI: ${name}`);
  return layer.id;
}

const photoTools = (): AppTool[] => [
  {
    name: 'adjust',
    description:
      'Add a non-destructive adjustment layer above the active layer. Scalars: exposure (-5..5 EV), contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, clarity, dehaze, vignette (-100..100), hue (-180..180), sharpen, grain, fade (0..100), bw (true for black & white). Colour grade: shadowHue/highlightHue (0..360), shadowSat/highlightSat (0..100), balance (-100..100). Use small, tasteful values; check with look afterwards.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        ...Object.fromEntries(SCALARS.map(([k]) => [k, { type: 'number' }])),
        bw: { type: 'boolean' },
        shadowHue: { type: 'number' },
        shadowSat: { type: 'number' },
        highlightHue: { type: 'number' },
        highlightSat: { type: 'number' },
        balance: { type: 'number' },
      },
    },
    run: (a) => {
      if (!store.doc) throw new Error('No document open.');
      const patch: Partial<Adjust> = {};
      for (const [k, lo, hi] of SCALARS) {
        const v = num(a[k]);
        if (v !== undefined) (patch as Record<string, number>)[k] = clamp(v, lo, hi);
      }
      if (typeof a.bw === 'boolean') patch.bw = a.bw;
      const gradeKeys = ['shadowHue', 'shadowSat', 'highlightHue', 'highlightSat', 'balance'] as const;
      if (gradeKeys.some((k) => num(a[k]) !== undefined)) {
        patch.grade = { shadowHue: num(a.shadowHue) ?? 0, shadowSat: clamp(num(a.shadowSat) ?? 0, 0, 100), highlightHue: num(a.highlightHue) ?? 0, highlightSat: clamp(num(a.highlightSat) ?? 0, 0, 100), balance: clamp(num(a.balance) ?? 0, -100, 100) };
      }
      if (!Object.keys(patch).length) throw new Error('No adjustment values given.');
      const name = typeof a.name === 'string' && a.name ? a.name : 'AI Adjustment';
      ops.newAdjustmentLayer(patch, name, false);
      return `Added adjustment layer "${name}": ${Object.keys(patch).join(', ')}.`;
    },
  },
  {
    name: 'generative_fill',
    description:
      'Repaint the current pixel selection from a prompt with an image model (needs a ChatGPT or Gemini key). The result is a new layer limited to the selection, so the original stays untouched. Use for adding or replacing things in a photo.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'What should appear in the selected area, matching the photo’s light and perspective.' } }, required: ['prompt'] },
    run: async (a, ctx) => {
      const id = await generativeFill(String(a.prompt), ctx.settings, ctx.signal, 'Generative Fill');
      return `Filled the selection — new layer ${id}.`;
    },
  },
  {
    name: 'remove_object',
    description: 'Remove whatever is inside the current pixel selection and rebuild the background there with an image model (needs a ChatGPT or Gemini key). Select the object generously first.',
    parameters: { type: 'object', properties: { hint: { type: 'string', description: 'Optional: what the background is (e.g. "sand and sea").' } } },
    run: async (a, ctx) => {
      const hint = typeof a.hint === 'string' && a.hint ? ` The background here is ${a.hint}.` : '';
      const id = await generativeFill(`Remove the object in the masked area completely and continue the surrounding background seamlessly, matching texture, light, grain and perspective. No new objects.${hint}`, ctx.settings, ctx.signal, 'Object Removed');
      return `Removed the selected object — new layer ${id}.`;
    },
  },
];

export const photoAdapter: AppAdapter = {
  app: 'Skill Photo',
  system: `Skill Photo is a Photoshop-class photo editor: layers and masks, adjustment layers, Looks (LUTs), Auto Tune, smart selections (Subject / Sky / Object, on-device), AI cutout, Sky Replacement, Liquify, restore tools, text, vector shapes and a Social studio for post design.

Photo edits: prefer non-destructive work — the adjust tool (adjustment layers), and generative_fill / remove_object which add layers. Look at the photo first, judge exposure, white balance and contrast, then make moderate changes; check the result with look.
Selections: run_command "select-subject" (or list_commands "select") before generative_fill / remove_object if nothing is selected.
Design: add_text and insert_svg for posts, banners and thumbnails over the photo; respect safe margins.`,
  tools: () => [...docTools(), ...photoTools(), ...commandTools(() => COMMANDS, (c) => c.id === 'ai-assistant')],
  context: shortContext,
  snapshot: () => snapshotDoc(1024),
  checkpoint: docCheckpoint,
  revertTo: docRevertTo,
  starters: [
    { label: 'Enhance this photo', prompt: 'Look at my photo and enhance it like a professional retoucher: fix exposure, white balance and contrast with adjustment layers. Tell me what you changed.' },
    { label: 'Cinematic look', prompt: 'Give this photo a subtle cinematic colour grade (teal shadows, warm highlights, gentle fade) using adjustment layers.' },
    { label: 'Remove distraction', prompt: 'Find the most distracting object in this photo, tell me what it is, and if I have a selection, remove it.' },
    { label: 'Make a thumbnail', prompt: 'Turn this photo into a 1280×720 YouTube thumbnail: bold 3–5 word headline with strong contrast, and a subtle darkening behind the text.' },
    { label: 'Critique', prompt: 'Critique this image like a photo editor: composition, light, colour. Give three concrete fixes.' },
  ],
};
