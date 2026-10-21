// Actions: record what you do (menu commands, filters with their settings, adjustment layers,
// image size, layer-style presets, exports) and play it back on any document, or batch it over
// many files into one ZIP. Saved in this browser (localStorage) and exportable as JSON.

import { store } from './store';
import type { Adjust } from './types';

export type ActionStep =
  | { kind: 'command'; id: string; label: string; enabled: boolean }
  | { kind: 'filter'; id: string; params: Record<string, number>; label: string; enabled: boolean }
  | { kind: 'adjust'; adjust: Partial<Adjust>; label: string; enabled: boolean }
  | { kind: 'imageSize'; width: number; height: number; fit: boolean; label: string; enabled: boolean }
  | { kind: 'style'; preset: string; label: string; enabled: boolean }
  | { kind: 'export'; format: 'png' | 'jpeg' | 'webp'; quality: number; scale: number; label: string; enabled: boolean };

/** A step as recorded, before it gets its `enabled` flag. */
export type NewStep = ActionStep extends infer S ? (S extends ActionStep ? Omit<S, 'enabled'> : never) : never;

export interface Action {
  id: string;
  name: string;
  steps: ActionStep[];
}

const KEY = 'photoscale-actions';

const BUILT_IN: Action[] = [
  {
    id: 'builtin-instagram',
    name: 'Instagram ready (1080 px, crisp, JPEG)',
    steps: [
      { kind: 'imageSize', width: 1080, height: 1350, fit: true, label: 'Fit within 1080 × 1350', enabled: true },
      { kind: 'filter', id: 'unsharp', params: { amount: 60, radius: 0.8, threshold: 2 }, label: 'Unsharp Mask', enabled: true },
      { kind: 'export', format: 'jpeg', quality: 0.9, scale: 1, label: 'Export JPEG 90%', enabled: true },
    ],
  },
  {
    id: 'builtin-film',
    name: 'Film look',
    steps: [{ kind: 'adjust', adjust: { contrast: 18, fade: 22, grain: 28, vignette: -25, temperature: 12, saturation: -10 }, label: 'Film adjustment layer', enabled: true }],
  },
  {
    id: 'builtin-web',
    name: 'Web thumbnail (800 px WebP)',
    steps: [
      { kind: 'imageSize', width: 800, height: 800, fit: true, label: 'Fit within 800 × 800', enabled: true },
      { kind: 'export', format: 'webp', quality: 0.82, scale: 1, label: 'Export WebP 82%', enabled: true },
    ],
  },
];

let actions: Action[] = load();
let recording: string | null = null;
let playing = false;
/** While playing, steps don't record themselves again. */
let paused = 0;
/** Exports made while running a batch go here instead of being saved. */
let exportSink: ((blob: Blob, ext: string) => void) | null = null;

function load(): Action[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(v)) return v;
  } catch {
    /* fall through to defaults */
  }
  return structuredClone(BUILT_IN);
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(actions));
  } catch {
    /* private mode: actions last for this session */
  }
  store.emit();
}

export const getActions = () => actions;
export const isRecording = () => recording;
export const isPlaying = () => playing;

export function newAction(name: string): Action {
  const a: Action = { id: `act-${Date.now().toString(36)}`, name, steps: [] };
  actions = [...actions, a];
  save();
  return a;
}

export function updateAction(id: string, patch: Partial<Action>) {
  actions = actions.map((a) => (a.id === id ? { ...a, ...patch } : a));
  save();
}

export function deleteAction(id: string) {
  if (recording === id) recording = null;
  actions = actions.filter((a) => a.id !== id);
  save();
}

export function startRecording(id: string) {
  recording = id;
  store.toast('Recording: menu commands, filters, adjustments, image size, styles and exports are added to the action');
  store.emit();
}

export function stopRecording() {
  recording = null;
  store.emit();
}

/** Called by the app when something recordable happens. */
export function record(step: NewStep) {
  if (!recording || paused) return;
  const a = actions.find((x) => x.id === recording);
  if (!a) return;
  const full = { ...step, enabled: true } as ActionStep;
  const steps = [...a.steps];
  // Dragging an adjustment slider edits the same step instead of adding one per change
  const prev = steps[steps.length - 1];
  if (full.kind === 'adjust' && prev?.kind === 'adjust' && prev.label === full.label) steps[steps.length - 1] = full;
  else steps.push(full);
  updateAction(a.id, { steps });
}

/** Wraps a run so whatever it does internally isn't recorded as extra steps. */
export async function quietly<T>(fn: () => T | Promise<T>): Promise<T> {
  paused++;
  try {
    return await fn();
  } finally {
    paused--;
  }
}

export function setExportSink(fn: typeof exportSink) {
  exportSink = fn;
}

export function getExportSink() {
  return exportSink;
}

/** Runs one step on the active document. */
async function runStep(step: ActionStep) {
  const ops = await import('./ops');
  const doc = store.doc;
  if (!doc) throw new Error('No document');
  switch (step.kind) {
    case 'command': {
      const { COMMANDS } = await import('./commands');
      const c = COMMANDS.find((x) => x.id === step.id);
      if (!c) throw new Error(`Unknown command ${step.id}`);
      if (c.enabled && !c.enabled()) throw new Error(`"${c.label}" isn't available here`);
      await c.run();
      return;
    }
    case 'filter': {
      // Filters need pixels: target the topmost pixel layer if the active one isn't one
      if (store.activeLayer?.kind !== 'raster') {
        const px = [...doc.layers].reverse().find((l) => l.kind === 'raster');
        if (px) store.selectLayer(px.id);
      }
      ops.commitFilter(step.id, step.params);
      return;
    }
    case 'adjust':
      ops.newAdjustmentLayer(step.adjust, step.label.replace(/ adjustment layer$/i, ''));
      return;
    case 'imageSize': {
      let { width, height } = step;
      if (step.fit) {
        const k = Math.min(step.width / doc.width, step.height / doc.height);
        width = Math.max(1, Math.round(doc.width * k));
        height = Math.max(1, Math.round(doc.height * k));
      }
      if (width !== doc.width || height !== doc.height) ops.imageSize(width, height);
      return;
    }
    case 'style': {
      const { applyPreset } = await import('./layerStyle');
      if (!store.activeLayer || store.activeLayer.kind === 'adjustment') {
        const top = [...doc.layers].reverse().find((l) => l.kind !== 'adjustment' && l.kind !== 'group');
        if (top) store.selectLayer(top.id);
      }
      applyPreset(step.preset);
      return;
    }
    case 'export': {
      const io = await import('./io');
      const blob = await io.renderExport(store.doc!, step.format, step.quality, step.scale);
      const ext = step.format === 'jpeg' ? 'jpg' : step.format;
      if (exportSink) exportSink(blob, ext);
      else await io.saveBlob(blob, `${store.doc!.title}.${ext}`);
      return;
    }
  }
}

/** Plays an action on the active document. Stops at the first failing step. */
export async function playAction(id: string): Promise<boolean> {
  const a = actions.find((x) => x.id === id);
  if (!a || !store.doc || playing) return false;
  playing = true;
  store.emit();
  try {
    await quietly(async () => {
      for (const [i, step] of a.steps.entries()) {
        if (!step.enabled) continue;
        try {
          await runStep(step);
        } catch (err) {
          throw new Error(`Step ${i + 1} (${step.label}): ${(err as Error).message}`);
        }
      }
    });
    return true;
  } catch (err) {
    store.toast(`${a.name}: ${(err as Error).message}`, 'error');
    return false;
  } finally {
    playing = false;
    store.emit();
  }
}

/**
 * Batch: opens each file, plays the action, collects its exports (or a PNG of the result if
 * the action has no export step) into one ZIP, and closes the file again.
 */
export async function batch(id: string, files: File[], onProgress?: (done: number, total: number) => void): Promise<{ zip: Blob; ok: number; failed: string[] }> {
  const a = actions.find((x) => x.id === id);
  if (!a) throw new Error('No such action');
  const io = await import('./io');
  const { zip } = await import('./formats/zip');
  const out: { name: string; data: Uint8Array }[] = [];
  const failed: string[] = [];
  const hasExport = a.steps.some((s) => s.kind === 'export' && s.enabled);
  const prevDoc = store.state.activeDocId;
  for (const [i, file] of files.entries()) {
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      const canvas = await io.fileToCanvas(file);
      const doc = io.docFromCanvas(canvas, base, file.name);
      const made: { blob: Blob; ext: string }[] = [];
      setExportSink((blob, ext) => made.push({ blob, ext }));
      const ok = await playAction(id);
      setExportSink(null);
      if (!ok) throw new Error('action failed');
      if (!hasExport) made.push({ blob: await io.renderExport(store.doc!, 'png', 1, 1), ext: 'png' });
      for (const [k, m] of made.entries()) out.push({ name: `${base}${made.length > 1 ? `-${k + 1}` : ''}.${m.ext}`, data: new Uint8Array(await m.blob.arrayBuffer()) });
      store.closeDoc(doc.id);
    } catch {
      setExportSink(null);
      failed.push(file.name);
    }
    onProgress?.(i + 1, files.length);
  }
  if (prevDoc && store.state.docs.some((d) => d.id === prevDoc)) store.switchDoc(prevDoc);
  return { zip: new Blob([zip(out) as BlobPart], { type: 'application/zip' }), ok: out.length, failed };
}

export function exportActionsJson(): string {
  return JSON.stringify({ format: 'photoscale-actions', version: 1, actions }, null, 2);
}

export function importActionsJson(json: string): number {
  const v = JSON.parse(json);
  if (v?.format !== 'photoscale-actions' || !Array.isArray(v.actions)) throw new Error('Not a Photoscale actions file');
  const incoming: Action[] = v.actions
    .filter((a: Action) => a && typeof a.name === 'string' && Array.isArray(a.steps))
    .map((a: Action) => ({ ...a, id: `act-${Math.random().toString(36).slice(2, 9)}` }));
  actions = [...actions, ...incoming];
  save();
  return incoming.length;
}
