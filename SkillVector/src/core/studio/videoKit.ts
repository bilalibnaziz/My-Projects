// Video studio: frame sizes and broadcast graphics laid out inside the title-safe area (90% / 80%
// of the frame), exported as transparent PNG overlays for any editor.

import { store } from '../store';
import type { Artboard, Layer } from '../types';
import { activeBoard, addGroup, appendArtboard, centeredText, ellipseLayer, rectLayer, textLayer } from './common';
import { exportArtboards } from './export';

export const FRAMES: { id: string; label: string; w: number; h: number }[] = [
  { id: 'fhd', label: '1080p 16:9', w: 1920, h: 1080 },
  { id: '4k', label: '4K UHD', w: 3840, h: 2160 },
  { id: 'vertical', label: 'Vertical 9:16', w: 1080, h: 1920 },
  { id: 'square', label: 'Square 1:1', w: 1080, h: 1080 },
  { id: 'feed', label: 'Feed 4:5', w: 1080, h: 1350 },
  { id: 'scope', label: 'Cinema 2.39:1', w: 2048, h: 858 },
  { id: 'thumb', label: 'YouTube Thumbnail', w: 1280, h: 720 },
];

export function addFrame(id: string) {
  const doc = store.doc;
  const f = FRAMES.find((x) => x.id === id);
  if (!doc || !f) return;
  appendArtboard(doc, f.label, f.w, f.h);
  store.commit(`New ${f.label} Frame`, {}, { icon: 'artboard' });
}

/** Title-safe (80%) and action-safe (90%) boxes of a frame. */
export function safeAreas(ab: { x: number; y: number; width: number; height: number }) {
  const box = (k: number) => ({ x: ab.x + (ab.width * (1 - k)) / 2, y: ab.y + (ab.height * (1 - k)) / 2, width: ab.width * k, height: ab.height * k });
  return { title: box(0.8), action: box(0.9) };
}

export const GRAPHICS = ['lower-third', 'lower-third-bar', 'title', 'subtitle', 'end-screen', 'logo-bug', 'thumb-headline', 'chapter'] as const;
export type GraphicId = (typeof GRAPHICS)[number];
export const GRAPHIC_LABELS: Record<GraphicId, string> = {
  'lower-third': 'Lower third', 'lower-third-bar': 'Lower third · bar', title: 'Title card', subtitle: 'Subtitle',
  'end-screen': 'End screen', 'logo-bug': 'Logo bug', 'thumb-headline': 'Thumbnail headline', chapter: 'Chapter marker',
};

/** Builds a broadcast graphic for a frame (pure). Positions keep text inside title-safe. */
export function buildGraphic(id: GraphicId, ab: Artboard, accent: string): { name: string; parts: Layer[] } {
  const { title: T, action: A } = safeAreas(ab);
  const u = Math.min(ab.width, ab.height) / 1080; // 1 at 1080p
  const vertical = ab.height > ab.width;
  switch (id) {
    case 'lower-third':
    case 'lower-third-bar': {
      const bar = id === 'lower-third-bar';
      const name = textLayer('Name', 'Alex Morgan', 0, 0, { size: 54 * u, weight: 700, color: '#ffffff' });
      const role = textLayer('Role', 'Creative Director', 0, 0, { size: 32 * u, weight: 500, color: bar ? '#ffffff' : '#e5e7eb' });
      const pad = 24 * u;
      const w = Math.max(name.width, role.width) + pad * 3;
      const h = name.height + role.height + pad * 2;
      const x = T.x;
      const y = vertical ? T.y + T.height * 0.72 : T.y + T.height - h;
      const parts: Layer[] = bar
        ? [rectLayer('Plate', x, y, w, h, '#111111', {}, { opacity: 0.85 }), rectLayer('Accent', x, y, 10 * u, h, accent)]
        : [rectLayer('Name plate', x, y, w, name.height + pad, accent), rectLayer('Role plate', x, y + name.height + pad, w * 0.82, role.height + pad, '#111111')];
      parts.push({ ...name, x: x + pad * 1.5, y: y + pad / 2 }, { ...role, x: x + pad * 1.5, y: y + name.height + pad * (bar ? 1 : 1.5) });
      return { name: GRAPHIC_LABELS[id], parts };
    }
    case 'title': {
      const t = centeredText('Title', 'Episode Title', ab.x + ab.width / 2, 0, { size: 120 * u, weight: 800, color: '#ffffff' });
      const s = centeredText('Subtitle', 'A short subtitle', ab.x + ab.width / 2, 0, { size: 44 * u, weight: 500, color: '#d1d5db' });
      const cy = ab.y + ab.height / 2;
      const rule = rectLayer('Rule', ab.x + ab.width / 2 - 60 * u, cy + 8 * u, 120 * u, 6 * u, accent);
      return { name: 'Title card', parts: [rectLayer('Background', ab.x, ab.y, ab.width, ab.height, '#0b0b0f'), { ...t, y: cy - t.height - 12 * u }, rule, { ...s, y: cy + 40 * u }] };
    }
    case 'subtitle': {
      const t = centeredText('Subtitle text', 'This is how a subtitle line will look', ab.x + ab.width / 2, 0, { size: 46 * u, weight: 600, color: '#ffffff', box: true, boxColor: '#000000b3', boxPad: 14 * u, boxRadius: 8 * u });
      return { name: 'Subtitle', parts: [{ ...t, y: T.y + T.height - t.height - 10 * u }] };
    }
    case 'end-screen': {
      // YouTube end screen: two video tiles and a subscribe circle, kept clear of the edges
      const vw = A.width * 0.36;
      const vh = (vw * 9) / 16;
      const gap = A.width * 0.04;
      const y = ab.y + ab.height * 0.42;
      const x0 = ab.x + (ab.width - (vw * 2 + gap)) / 2;
      const head = centeredText('Heading', 'Watch next', ab.x + ab.width / 2, ab.y + ab.height * 0.18, { size: 64 * u, weight: 800, color: '#ffffff' });
      const sub = 150 * u;
      return {
        name: 'End screen',
        parts: [
          rectLayer('Background', ab.x, ab.y, ab.width, ab.height, '#111318'),
          head,
          rectLayer('Video 1', x0, y, vw, vh, '#2a2d36', { radius: 16 * u, stroke: '#ffffff40', strokeWidth: 2 * u }),
          rectLayer('Video 2', x0 + vw + gap, y, vw, vh, '#2a2d36', { radius: 16 * u, stroke: '#ffffff40', strokeWidth: 2 * u }),
          ellipseLayer('Subscribe', ab.x + ab.width / 2 - sub / 2, y + vh + 40 * u, sub, sub, accent),
        ],
      };
    }
    case 'logo-bug': {
      const s = 96 * u;
      const mark = ellipseLayer('Logo', A.x + A.width - s, A.y, s, s, accent, {}, ) as Layer;
      const t = centeredText('Logo text', 'LIVE', A.x + A.width - s / 2, 0, { size: 26 * u, weight: 800, color: '#ffffff' });
      return { name: 'Logo bug', parts: [{ ...mark, opacity: 0.9 }, { ...t, y: A.y + (s - t.height) / 2 }] };
    }
    case 'thumb-headline': {
      const t = textLayer('Headline', 'BIG IDEA', A.x, 0, { size: 170 * u, weight: 900, color: '#ffffff', stroke: 10 * u, strokeColor: '#000000', caps: true });
      const tag = rectLayer('Tag', A.x, A.y + A.height * 0.62 + t.height + 10 * u, 360 * u, 70 * u, accent, { radius: 10 * u });
      const tagT = textLayer('Tag text', 'NEW', A.x + 24 * u, A.y + A.height * 0.62 + t.height + 18 * u, { size: 48 * u, weight: 800, color: '#ffffff' });
      return { name: 'Thumbnail headline', parts: [{ ...t, y: A.y + A.height * 0.62 - t.height * 0.4 }, tag, tagT] };
    }
    case 'chapter': {
      const n = textLayer('Number', '01', T.x, T.y, { size: 90 * u, weight: 800, color: accent });
      const t = textLayer('Chapter', 'Chapter title', T.x, T.y + n.height, { size: 56 * u, weight: 700, color: '#ffffff' });
      return { name: 'Chapter marker', parts: [n, t] };
    }
  }
}

export function insertGraphic(id: GraphicId) {
  const doc = store.doc;
  if (!doc) return;
  const ab = activeBoard(doc);
  const g = buildGraphic(id, ab, store.state.fg && store.state.fg !== '#000000' ? store.state.fg : '#e11d48');
  addGroup(g.parts, g.name, `Add ${g.name}`);
}

/** The active frame as a transparent PNG overlay (or every frame, zipped). */
export async function exportOverlays(which: 'active' | 'all' = 'active', scale = 1) {
  const doc = store.doc;
  if (!doc) return 0;
  return exportArtboards(doc, { format: 'png', which, scale, background: null });
}
