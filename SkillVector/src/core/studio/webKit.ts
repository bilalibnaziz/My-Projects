// Web & UI studio: device artboards, live UI components (shapes + text, fully editable), WCAG
// contrast check with an automatic fix, CSS hand-off, 8-pt snapping and @1x/@2x/@3x asset export.

import { store } from '../store';
import type { Doc, Layer } from '../types';
import { withLayer } from '../types';
import { contrastGrade, contrastRatio, hexToRgb, rgbToHex } from '../color';
import { layerBounds } from '../align';
import { getActiveArtboard } from '../vectorOps';
import { activeBoard, addGroup, appendArtboard, centeredText, ellipseLayer, rectLayer, textLayer } from './common';
import { exportArtboards, renderRect } from './export';
import { cornerRadii } from '../shapeGeometry';

export const DEVICES: { id: string; label: string; w: number; h: number }[] = [
  { id: 'iphone-16', label: 'iPhone 16', w: 393, h: 852 },
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', w: 440, h: 956 },
  { id: 'android', label: 'Android (Pixel)', w: 412, h: 915 },
  { id: 'ipad', label: 'iPad', w: 820, h: 1180 },
  { id: 'laptop', label: 'Laptop', w: 1440, h: 900 },
  { id: 'desktop', label: 'Desktop', w: 1920, h: 1080 },
  { id: 'watch', label: 'Watch', w: 198, h: 242 },
  { id: 'og-image', label: 'Link preview (OG)', w: 1200, h: 630 },
];

export function addDevice(id: string) {
  const doc = store.doc;
  const d = DEVICES.find((x) => x.id === id);
  if (!doc || !d) return;
  appendArtboard(doc, d.label, d.w, d.h);
  store.commit(`New ${d.label} Artboard`, {}, { icon: 'artboard' });
}

export interface UiTokens {
  primary: string;
  text: string;
  surface: string;
  radius: number;
  /** Base size: components scale with the artboard (16 on a phone, larger on big boards). */
  base: number;
}

export function defaultTokens(doc: Doc): UiTokens {
  const ab = getActiveArtboard(doc);
  const base = Math.max(14, Math.round(Math.min(ab.width, ab.height) / 26));
  const fg = store.state.fg;
  const primary = /^#[0-9a-f]{6}$/i.test(fg) && contrastRatio(fg, '#ffffff') >= 3 ? fg : '#2563eb';
  return { primary, text: '#111827', surface: '#ffffff', radius: Math.round(base * 0.5), base };
}

export const COMPONENTS = ['button', 'button-outline', 'input', 'search', 'card', 'navbar', 'tabbar', 'toggle', 'checkbox', 'chip', 'avatar', 'alert'] as const;
export type ComponentId = (typeof COMPONENTS)[number];
export const COMPONENT_LABELS: Record<ComponentId, string> = {
  button: 'Button', 'button-outline': 'Outline button', input: 'Text field', search: 'Search bar', card: 'Card', navbar: 'Top bar', tabbar: 'Tab bar',
  toggle: 'Toggle', checkbox: 'Checkbox', chip: 'Chip', avatar: 'Avatar', alert: 'Alert',
};

/** Builds a component's layers at (x, y) — pure, so it can be tested and previewed. */
export function buildComponent(id: ComponentId, x: number, y: number, t: UiTokens, boardWidth: number): { name: string; parts: Layer[] } {
  const B = t.base;
  const r = t.radius;
  const soft = mix(t.primary, '#ffffff', 0.88);
  const muted = '#6b7280';
  const line = '#d1d5db';
  switch (id) {
    case 'button':
    case 'button-outline': {
      const outline = id === 'button-outline';
      const label = textLayer('Label', 'Get started', 0, 0, { size: B, weight: 600, color: outline ? t.primary : '#ffffff' });
      const w = Math.round(label.width + B * 2.5);
      const h = Math.round(B * 3);
      const bg = rectLayer('Background', x, y, w, h, outline ? 'none' : t.primary, { radius: r, stroke: t.primary, strokeWidth: outline ? Math.max(1, B / 12) : 0 });
      return { name: `Button · ${outline ? 'Outline' : 'Primary'}`, parts: [bg, { ...label, x: x + (w - label.width) / 2, y: y + (h - label.height) / 2 }] };
    }
    case 'input':
    case 'search': {
      const w = Math.round(Math.min(boardWidth * 0.8, B * 22));
      const h = Math.round(B * 3);
      const lab = textLayer('Label', 'Email', x, y, { size: B * 0.85, weight: 600, color: t.text });
      const top = id === 'input' ? y + lab.height + B * 0.4 : y;
      const box = rectLayer('Field', x, top, w, h, t.surface, { radius: id === 'search' ? h / 2 : r, stroke: line, strokeWidth: Math.max(1, B / 16) });
      const ph = textLayer('Placeholder', id === 'search' ? 'Search' : 'you@example.com', 0, 0, { size: B, color: muted });
      const icon = id === 'search' ? [ellipseLayer('Search icon', x + B * 0.9, top + h / 2 - B * 0.45, B * 0.8, B * 0.8, 'none', { stroke: muted, strokeWidth: Math.max(1.5, B / 10) })] : [];
      const px = id === 'search' ? x + B * 2.3 : x + B;
      return { name: id === 'search' ? 'Search bar' : 'Text field', parts: [...(id === 'input' ? [lab] : []), box, ...icon, { ...ph, x: px, y: top + (h - ph.height) / 2 }] };
    }
    case 'card': {
      const w = Math.round(Math.min(boardWidth * 0.85, B * 20));
      const img = Math.round(w * 0.56);
      const bg = rectLayer('Card', x, y, w, Math.round(img + B * 9), t.surface, { radii: [r * 1.5, r * 1.5, r * 1.5, r * 1.5], cornerStyle: 'smooth', stroke: line, strokeWidth: Math.max(1, B / 16) });
      const media = rectLayer('Image', x, y, w, img, soft, { radii: [r * 1.5, r * 1.5, 0, 0], cornerStyle: 'smooth' });
      const title = textLayer('Title', 'Card title', x + B, y + img + B, { size: B * 1.25, weight: 700, color: t.text });
      const body = textLayer('Body', 'A short line that explains the card.', x + B, y + img + B * 2.9, { size: B * 0.9, color: muted, boxWidth: w - B * 2 });
      const btn = buildComponent('button', x + B, y + img + B * 5.4, { ...t, base: B * 0.85 }, boardWidth).parts;
      return { name: 'Card', parts: [bg, media, title, body, ...btn] };
    }
    case 'navbar': {
      const w = boardWidth;
      const h = Math.round(B * 3.5);
      const bar = rectLayer('Top bar', x, y, w, h, t.surface, { stroke: line, strokeWidth: 0 });
      const rule = rectLayer('Divider', x, y + h - 1, w, 1, line);
      const title = textLayer('Title', 'Brand', x + B * 1.2, 0, { size: B * 1.2, weight: 700, color: t.text });
      const avatar = ellipseLayer('Avatar', x + w - B * 3.2, y + (h - B * 2) / 2, B * 2, B * 2, soft);
      return { name: 'Top bar', parts: [bar, rule, { ...title, y: y + (h - title.height) / 2 }, avatar] };
    }
    case 'tabbar': {
      const w = boardWidth;
      const h = Math.round(B * 4);
      const bar = rectLayer('Tab bar', x, y, w, h, t.surface);
      const rule = rectLayer('Divider', x, y, w, 1, line);
      const names = ['Home', 'Search', 'Saved', 'Profile'];
      const tabs = names.flatMap((n, i) => {
        const cx = x + (w / names.length) * (i + 0.5);
        const color = i === 0 ? t.primary : muted;
        return [ellipseLayer(`${n} icon`, cx - B * 0.6, y + B * 0.7, B * 1.2, B * 1.2, i === 0 ? t.primary : 'none', { stroke: color, strokeWidth: Math.max(1.5, B / 10) }), centeredText(`${n} label`, n, cx, y + B * 2.2, { size: B * 0.7, weight: i === 0 ? 600 : 400, color })];
      });
      return { name: 'Tab bar', parts: [bar, rule, ...tabs] };
    }
    case 'toggle': {
      const w = Math.round(B * 3.2);
      const h = Math.round(B * 1.8);
      return { name: 'Toggle · On', parts: [rectLayer('Track', x, y, w, h, t.primary, { radius: h / 2 }), ellipseLayer('Knob', x + w - h + B * 0.2, y + B * 0.2, h - B * 0.4, h - B * 0.4, '#ffffff')] };
    }
    case 'checkbox': {
      const s = Math.round(B * 1.4);
      const box = rectLayer('Box', x, y, s, s, t.primary, { radius: Math.max(2, r * 0.4) });
      const tick = textLayer('Tick', '✓', 0, 0, { size: B, weight: 700, color: '#ffffff' });
      const lab = textLayer('Label', 'Remember me', x + s + B * 0.6, 0, { size: B, color: t.text });
      return { name: 'Checkbox', parts: [box, { ...tick, x: x + (s - tick.width) / 2, y: y + (s - tick.height) / 2 }, { ...lab, y: y + (s - lab.height) / 2 }] };
    }
    case 'chip': {
      const lab = textLayer('Label', 'Design', 0, 0, { size: B * 0.85, weight: 600, color: t.primary });
      const w = Math.round(lab.width + B * 1.6);
      const h = Math.round(B * 2);
      return { name: 'Chip', parts: [rectLayer('Chip', x, y, w, h, soft, { radius: h / 2 }), { ...lab, x: x + (w - lab.width) / 2, y: y + (h - lab.height) / 2 }] };
    }
    case 'avatar': {
      const s = Math.round(B * 3);
      const ini = textLayer('Initials', 'AB', 0, 0, { size: B * 1.1, weight: 700, color: t.primary });
      return { name: 'Avatar', parts: [ellipseLayer('Avatar', x, y, s, s, soft), { ...ini, x: x + (s - ini.width) / 2, y: y + (s - ini.height) / 2 }] };
    }
    case 'alert': {
      const w = Math.round(Math.min(boardWidth * 0.85, B * 24));
      const h = Math.round(B * 4.2);
      const bg = rectLayer('Alert', x, y, w, h, soft, { radius: r });
      const bar = rectLayer('Accent', x, y, Math.max(3, B / 4), h, t.primary, { radii: [r, 0, 0, r] });
      const title = textLayer('Title', 'Saved', x + B, y + B * 0.7, { size: B, weight: 700, color: t.text });
      const body = textLayer('Message', 'Your changes are live.', x + B, y + B * 2.1, { size: B * 0.9, color: muted });
      return { name: 'Alert', parts: [bg, bar, title, body] };
    }
  }
}

/** Places a component in the middle of the active artboard (top bars hug the top edge). */
export function insertComponent(id: ComponentId) {
  const doc = store.doc;
  if (!doc) return;
  const ab = activeBoard(doc);
  const t = defaultTokens(doc);
  const probe = buildComponent(id, 0, 0, t, ab.width);
  const b = bounds(probe.parts);
  const x = id === 'navbar' || id === 'tabbar' ? ab.x : Math.round(ab.x + (ab.width - b.width) / 2);
  const y = id === 'navbar' ? ab.y : id === 'tabbar' ? ab.y + ab.height - b.height : Math.round(ab.y + (ab.height - b.height) / 2);
  addGroup(buildComponent(id, x, y, t, ab.width).parts, probe.name, `Add ${probe.name}`);
}

function bounds(parts: Layer[]) {
  const xs = parts.flatMap((l) => [l.x, l.x + Math.abs(l.width)]);
  const ys = parts.flatMap((l) => [l.y, l.y + Math.abs(l.height)]);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t)) as [number, number, number]);
}

// ---------------------------------------------------------------- contrast

/** Average colour behind a text layer (the layer itself hidden). */
export function backgroundBehind(doc: Doc, l: Layer): string {
  const b = layerBounds(l);
  if (!b) return '#ffffff';
  const hidden = { ...doc, layers: doc.layers.map((x) => (x.id === l.id ? { ...x, visible: false } : x)) };
  const c = renderRect(hidden, b, Math.min(1, 200 / Math.max(b.width, b.height)), '#ffffff');
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++;
  }
  return n ? rgbToHex([Math.round(r / n), Math.round(g / n), Math.round(bl / n)]) : '#ffffff';
}

export interface ContrastRow {
  layer: Layer;
  fg: string;
  bg: string;
  ratio: number;
  grade: ReturnType<typeof contrastGrade>;
  /** Large text (≥ 24 px, or ≥ 18.66 px bold) only needs 3:1. */
  large: boolean;
  pass: boolean;
}

export function contrastReport(doc: Doc, layers = doc.layers): ContrastRow[] {
  return layers.filter((l) => l.kind === 'text' && l.text && l.visible).map((l) => {
    const fg = l.text!.color;
    const bg = backgroundBehind(doc, l);
    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    const large = l.text!.size >= 24 || (l.text!.size >= 18.66 && l.text!.weight >= 700);
    return { layer: l, fg, bg, ratio, grade: contrastGrade(ratio), large, pass: ratio >= (large ? 3 : 4.5) };
  });
}

/** The closest colour to `fg` (same hue, moved toward black or white) that reaches `target` on `bg`. */
export function passingColor(fg: string, bg: string, target = 4.5): string {
  if (contrastRatio(fg, bg) >= target) return fg;
  // Step toward black and toward white; keep whichever passes with the smaller change
  const cands = ['#000000', '#ffffff'].flatMap((to) => {
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const c = mix(fg, to, Math.min(1, t));
      if (contrastRatio(c, bg) >= target) return [{ c, t }];
    }
    return [];
  });
  cands.sort((a, b) => a.t - b.t);
  return cands[0]?.c ?? (contrastRatio('#000000', bg) > contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff');
}

export function fixContrast(rows: ContrastRow[]): number {
  const doc = store.doc;
  if (!doc) return 0;
  const fix = new Map(rows.filter((r) => !r.pass).map((r) => [r.layer.id, passingColor(r.fg, r.bg, r.large ? 3 : 4.5)]));
  if (!fix.size) return 0;
  store.commit('Fix Contrast', { layers: doc.layers.map((l) => (fix.has(l.id) && l.text ? withLayer(l, { text: { ...l.text, color: fix.get(l.id)!, runs: l.text.runs?.map(({ color: _c, ...r }) => r) } }) : l)) }, { icon: 'shape' });
  return fix.size;
}

// ---------------------------------------------------------------- CSS hand-off

const px = (v: number) => `${Math.round(v * 100) / 100}px`;

/** CSS for a layer, positioned relative to its artboard. */
export function cssFor(l: Layer, doc: Doc): string {
  const ab = (doc.artboards ?? []).find((a) => l.x >= a.x && l.y >= a.y && l.x < a.x + a.width && l.y < a.y + a.height) ?? { x: 0, y: 0 };
  const lines: string[] = [`/* ${l.name} */`, `position: absolute;`, `left: ${px(l.x - ab.x)};`, `top: ${px(l.y - ab.y)};`, `width: ${px(Math.abs(l.width))};`, `height: ${px(Math.abs(l.height))};`];
  if (l.kind === 'shape' && l.shape) {
    const s = l.shape;
    if (s.fillEnabled) {
      if (s.gradient) {
        const g = s.gradient;
        const stops = g.stops.map((st) => `${st.color} ${Math.round(st.offset * 100)}%`).join(', ');
        lines.push(g.type === 'radial' ? `background: radial-gradient(circle, ${stops});` : `background: linear-gradient(${Math.round((Math.atan2(g.y1 - g.y0, g.x1 - g.x0) * 180) / Math.PI + 90)}deg, ${stops});`);
      } else lines.push(`background: ${s.fill};`);
    }
    if (s.strokeWidth > 0) lines.push(`border: ${px(s.strokeWidth)} ${s.strokeDash?.length ? 'dashed' : 'solid'} ${s.stroke};`);
    if (s.shape === 'ellipse') lines.push('border-radius: 50%;');
    else if (s.shape === 'rectangle' || s.shape === 'round-rect') {
      const r = cornerRadii(s);
      if (r.some((v) => v > 0)) lines.push(r.every((v) => v === r[0]) ? `border-radius: ${px(r[0])};` : `border-radius: ${r.map(px).join(' ')};`);
      if (s.cornerStyle === 'smooth') lines.push('/* smooth (squircle) corners: approximate with border-radius or an SVG mask */');
    }
  }
  if (l.kind === 'text' && l.text) {
    const t = l.text;
    lines.push(`font-family: "${t.font}", sans-serif;`, `font-size: ${px(t.size)};`, `font-weight: ${t.weight};`, `line-height: ${t.lineHeight};`, `color: ${t.color};`);
    if (t.tracking) lines.push(`letter-spacing: ${px(t.tracking)};`);
    if (t.align !== 'left') lines.push(`text-align: ${t.align};`);
    if (t.italic) lines.push('font-style: italic;');
    if (t.caps) lines.push('text-transform: uppercase;');
  }
  if (l.opacity < 1) lines.push(`opacity: ${Math.round(l.opacity * 100) / 100};`);
  if (l.rotation) lines.push(`transform: rotate(${Math.round(l.rotation * 100) / 100}deg);`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- 8-pt grid & assets

/** Rounds position and size of the selected objects to the grid step. Returns how many moved. */
export function snapSelection(step = 8): number {
  const doc = store.doc;
  if (!doc) return 0;
  const ids = new Set(store.selectedLayers.filter((l) => l.kind === 'shape' || l.kind === 'text').map((l) => l.id));
  let n = 0;
  const q = (v: number) => Math.round(v / step) * step;
  const layers = doc.layers.map((l) => {
    if (!ids.has(l.id)) return l;
    const patch = l.kind === 'text' ? { x: q(l.x), y: q(l.y) } : { x: q(l.x), y: q(l.y), width: Math.max(step, q(l.width)), height: Math.max(step, q(l.height)) };
    if (Object.entries(patch).every(([k, v]) => l[k as 'x'] === v)) return l;
    n++;
    return withLayer(l, patch);
  });
  if (n) store.commit(`Snap to ${step}-pt Grid`, { layers }, { icon: 'shape' });
  return n;
}

/** Exports each selected object (its bounds) at @1x, @2x and @3x in one ZIP. */
export async function exportSelectionAssets(scales = [1, 2, 3]) {
  const doc = store.doc;
  if (!doc) return 0;
  const sel = store.selectedLayers.filter((l) => !l.parent || !store.selectedLayers.some((p) => p.id === l.parent));
  if (!sel.length) {
    store.toast('Select the icons or objects to export first');
    return 0;
  }
  const { artboardFiles } = await import('./export');
  const { zip } = await import('../formats/zip');
  const files: { name: string; data: Uint8Array }[] = [];
  for (const s of scales) {
    const regions = sel.map((l) => ({ name: `${l.name}${s === 1 ? '' : `@${s}x`}`, rect: layerBounds(l)! })).filter((r) => r.rect);
    files.push(...(await artboardFiles(doc, { format: 'png', scale: s, regions })));
  }
  const { saveBlob } = await import('../io');
  await saveBlob(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${doc.title} assets.zip`);
  store.toast(`Exported ${sel.length} asset${sel.length > 1 ? 's' : ''} at ${scales.map((s) => `@${s}x`).join(', ')}`, 'success');
  return files.length;
}

export { exportArtboards };
