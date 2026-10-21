// Text layout: rich text (styled runs inside one layer), paragraph boxes with word wrap, and
// mixed sizes sharing a baseline. Used by the renderer and for measuring text layers.

import type { TextProps, TextRun, TextStyle } from './types';
import { ctx2d, scratch } from './canvas';

/** Style of each character: the layer's base style with any run overrides applied. */
export interface CharStyle {
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  underline: boolean;
  strike: boolean;
}

export interface Segment {
  text: string;
  style: CharStyle;
  x: number;
  width: number;
}

export interface LayoutLine {
  segments: Segment[];
  width: number;
  top: number;
  height: number;
  baseline: number; // y of the baseline
}

export interface TextLayout {
  width: number;
  height: number;
  lines: LayoutLine[];
}

const ASCENT = 0.8; // glyph top → baseline, as a fraction of the font size

export function styleFont(s: Pick<CharStyle, 'italic' | 'weight' | 'size' | 'font'>): string {
  return `${s.italic ? 'italic ' : ''}${s.weight} ${s.size}px ${JSON.stringify(s.font)}, system-ui, sans-serif`;
}

function baseStyle(t: TextProps): CharStyle {
  return { font: t.font, size: t.size, weight: t.weight, italic: t.italic, color: t.color, underline: !!t.underline, strike: !!t.strike };
}

/** Per-character styles for the layer's text. */
export function charStyles(t: TextProps): CharStyle[] {
  const base = baseStyle(t);
  const out: CharStyle[] = Array.from({ length: t.text.length }, () => base);
  for (const r of t.runs ?? []) {
    for (let i = Math.max(0, r.start); i < Math.min(t.text.length, r.end); i++) out[i] = { ...out[i], ...stripUndefined(r) };
  }
  return out;
}

function stripUndefined(r: TextRun): Partial<CharStyle> {
  const o: Partial<CharStyle> = {};
  for (const k of ['font', 'size', 'weight', 'italic', 'color', 'underline', 'strike'] as const) if (r[k] !== undefined) (o as Record<string, unknown>)[k] = r[k];
  return o;
}

const sameStyle = (a: CharStyle, b: CharStyle) =>
  a === b || (a.font === b.font && a.size === b.size && a.weight === b.weight && a.italic === b.italic && a.color === b.color && a.underline === b.underline && a.strike === b.strike);

function measure(text: string, s: CharStyle, tracking: number): number {
  const ctx = ctx2d(scratch('textMeasure', 4, 4));
  ctx.font = styleFont(s);
  return ctx.measureText(text).width + text.length * tracking;
}

interface Glyphs {
  chars: string[];
  styles: CharStyle[];
}

/** Splits [from, to) of a paragraph into same-style segments, measured. */
function segmentsOf(g: Glyphs, from: number, to: number, tracking: number): Segment[] {
  const segs: Segment[] = [];
  let x = 0;
  let i = from;
  while (i < to) {
    let j = i + 1;
    while (j < to && sameStyle(g.styles[j], g.styles[i])) j++;
    const text = g.chars.slice(i, j).join('');
    const width = measure(text, g.styles[i], tracking);
    segs.push({ text, style: g.styles[i], x, width });
    x += width;
    i = j;
  }
  return segs;
}

/** Lays out the text: paragraphs split on newlines, wrapped to `boxWidth` when set. */
export function layoutText(t: TextProps): TextLayout {
  const styles = charStyles(t);
  const raw = t.text;
  const lines: { from: number; to: number; g: Glyphs }[] = [];
  const shown = (ch: string) => (t.caps ? ch.toUpperCase() : ch);
  let start = 0;
  const paragraphs: [number, number][] = [];
  for (let i = 0; i <= raw.length; i++) {
    if (i === raw.length || raw[i] === '\n') {
      paragraphs.push([start, i]);
      start = i + 1;
    }
  }
  const g: Glyphs = { chars: Array.from(raw, shown), styles };
  const wrap = t.boxWidth && t.boxWidth > 0 ? t.boxWidth : 0;
  for (const [a, b] of paragraphs) {
    if (!wrap || a === b) {
      lines.push({ from: a, to: b, g });
      continue;
    }
    // Greedy word wrap; words longer than the box break between characters
    let lineStart = a;
    let i = a;
    let lastBreak = -1;
    while (i < b) {
      if (raw[i] === ' ') lastBreak = i;
      const w = measureRange(g, lineStart, i + 1, t.tracking);
      if (w > wrap && i > lineStart) {
        if (lastBreak >= lineStart) {
          lines.push({ from: lineStart, to: lastBreak, g });
          lineStart = lastBreak + 1;
        } else {
          lines.push({ from: lineStart, to: i, g });
          lineStart = i;
        }
        lastBreak = -1;
        i = lineStart;
        continue;
      }
      i++;
    }
    lines.push({ from: lineStart, to: b, g });
  }

  const out: LayoutLine[] = [];
  let y = 0;
  for (const l of lines) {
    const segs = segmentsOf(l.g, l.from, l.to, t.tracking);
    // Tracking only goes between letters, not after the last one
    const width = Math.max(0, segs.reduce((s, x) => s + x.width, 0) - (l.to > l.from ? t.tracking : 0));
    const maxSize = Math.max(t.size, ...l.g.styles.slice(l.from, l.to).map((s) => s.size));
    const height = maxSize * t.lineHeight;
    out.push({ segments: segs, width, top: y, height, baseline: y + (height - maxSize) / 2 + maxSize * ASCENT });
    y += height;
  }
  const width = Math.max(1, wrap || 0, ...out.map((l) => l.width));
  // Alignment within the block
  for (const l of out) {
    const dx = t.align === 'center' ? (width - l.width) / 2 : t.align === 'right' ? width - l.width : 0;
    for (const s of l.segments) s.x += dx;
  }
  return { width, height: Math.max(1, y), lines: out };
}

function measureRange(g: Glyphs, from: number, to: number, tracking: number): number {
  let w = 0;
  for (const s of segmentsOf(g, from, to, tracking)) w += s.width;
  return w - (to > from ? tracking : 0);
}

/** Draws laid-out text with its highlight box, shadow and outline, at (ox, oy). */
export function drawLayout(ctx: CanvasRenderingContext2D, t: TextProps, L: TextLayout, ox: number, oy: number) {
  // 'top' like the original renderer, so single-style text draws exactly as before;
  // mixed sizes line up by placing each segment's top ASCENT·size above the shared baseline
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${t.tracking}px`;
  if (t.box) {
    const bp = t.boxPad ?? 0;
    ctx.fillStyle = t.boxColor ?? '#000000';
    ctx.beginPath();
    ctx.roundRect(ox - bp, oy - bp, L.width + bp * 2, L.height + bp * 2, Math.max(0, t.boxRadius ?? 0));
    ctx.fill();
  }
  for (const line of L.lines) {
    for (const seg of line.segments) {
      const s = seg.style;
      ctx.font = styleFont(s);
      const x = ox + seg.x;
      const y = oy + line.baseline - s.size * ASCENT;
      if (t.shadow) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        // Shadow sizes are in device pixels: follow the zoom of a hi-res view render
        const k = devScale(ctx);
        ctx.shadowBlur = s.size * 0.15 * k;
        ctx.shadowOffsetY = s.size * 0.06 * k;
        ctx.fillStyle = s.color;
        ctx.fillText(seg.text, x, y);
        ctx.restore();
      }
      if (t.stroke > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = t.stroke * 2;
        ctx.strokeStyle = t.strokeColor;
        ctx.strokeText(seg.text, x, y);
      }
      ctx.fillStyle = s.color;
      ctx.fillText(seg.text, x, y);
      const lw = Math.max(1, s.size * 0.06);
      const base = y + s.size * ASCENT;
      if (s.underline) ctx.fillRect(x, base + s.size * 0.1, seg.width - t.tracking, lw);
      if (s.strike) ctx.fillRect(x, base - s.size * 0.3, seg.width - t.tracking, lw);
    }
  }
}

// ---------------------------------------------------------------- runs

/** Rebuilds runs from per-character overrides, merging neighbours with identical styles. */
function compress(over: TextStyle[], len: number): TextRun[] {
  const runs: TextRun[] = [];
  const key = (o: TextStyle) => JSON.stringify(o);
  let i = 0;
  while (i < len) {
    const k = key(over[i]);
    let j = i + 1;
    while (j < len && key(over[j]) === k) j++;
    if (k !== '{}') runs.push({ start: i, end: j, ...over[i] });
    i = j;
  }
  return runs;
}

function overrides(t: TextProps): TextStyle[] {
  const over: TextStyle[] = Array.from({ length: t.text.length }, () => ({}));
  for (const r of t.runs ?? []) {
    const { start, end, ...style } = r;
    for (let i = Math.max(0, start); i < Math.min(t.text.length, end); i++) over[i] = { ...over[i], ...style };
  }
  return over;
}

/** Applies a style to characters [start, end). Values equal to the base style clear the override. */
export function styleRange(t: TextProps, start: number, end: number, style: TextStyle): TextRun[] {
  const over = overrides(t);
  const base = baseStyle(t) as unknown as Record<string, unknown>;
  for (let i = Math.max(0, start); i < Math.min(t.text.length, end); i++) {
    const next = { ...over[i], ...style } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === base[k]) delete next[k];
    over[i] = next as TextStyle;
  }
  return compress(over, t.text.length);
}

/** Keeps runs attached to the right characters after the text is edited. */
export function remapRuns(runs: TextRun[] | undefined, before: string, after: string): TextRun[] | undefined {
  if (!runs?.length) return runs;
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s; // [p, oldEnd) was replaced
  const delta = after.length - before.length;
  const map = (i: number, isEnd: boolean) => {
    if (i < p) return i;
    // At or after the edit: shift. Text typed right before a run stays outside it, text typed
    // right after a run's last character joins it (like word processors)
    if (i >= oldEnd) return i + delta;
    // Inside the replaced span: clamp to its new extent (typing inside a run extends it)
    return isEnd ? oldEnd + delta : p;
  };
  return runs.map((r) => ({ ...r, start: map(r.start, false), end: map(r.end, true) })).filter((r) => r.end > r.start);
}

/** The style shown for a selection: its first character's. */
export function styleAt(t: TextProps, i: number): CharStyle {
  return charStyles(t)[Math.max(0, Math.min(t.text.length - 1, i))] ?? baseStyle(t);
}

// ---------------------------------------------------------------- vertical type and type on a path

/** One glyph placed by vertical or on-path layout: centre point and rotation (radians). */
export interface PlacedGlyph {
  ch: string;
  style: CharStyle;
  x: number;
  y: number;
  angle: number;
}

/** Vertical type: columns of upright glyphs, read top to bottom, right to left. */
export function layoutVertical(t: TextProps): { width: number; height: number; glyphs: PlacedGlyph[] } {
  const styles = charStyles(t);
  const raw = t.text;
  const wrap = t.boxWidth && t.boxWidth > 0 ? t.boxWidth : 0;
  const adv = (i: number) => (raw[i] === ' ' ? styles[i].size * 0.5 : styles[i].size) + t.tracking;
  // Split into columns at line breaks, and where a column would run past the wrap length
  const cols: number[][] = [[]];
  let len = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\n') {
      cols.push([]);
      len = 0;
      continue;
    }
    if (wrap && len + adv(i) > wrap && cols[cols.length - 1].length) {
      cols.push([]);
      len = 0;
    }
    cols[cols.length - 1].push(i);
    len += adv(i);
  }
  const colW = (c: number[]) => Math.max(t.size, ...c.map((i) => styles[i].size)) * t.lineHeight;
  const lens = cols.map((c) => Math.max(0, c.reduce((a, i) => a + adv(i), 0) - (c.length ? t.tracking : 0)));
  const width = Math.max(1, cols.reduce((a, c) => a + colW(c), 0));
  const height = Math.max(1, wrap, ...lens);
  const glyphs: PlacedGlyph[] = [];
  let right = width;
  cols.forEach((c, k) => {
    const w = colW(c);
    const cx = right - w / 2;
    right -= w;
    // Alignment along the column: left = top, center, right = bottom
    let y = t.align === 'center' ? (height - lens[k]) / 2 : t.align === 'right' ? height - lens[k] : 0;
    for (const i of c) {
      const a = adv(i);
      glyphs.push({ ch: t.caps ? raw[i].toUpperCase() : raw[i], style: styles[i], x: cx, y: y + (a - t.tracking) / 2, angle: 0 });
      y += a;
    }
  });
  return { width, height, glyphs };
}

/** Size of the box an on-path text layer needs (its path points are relative to the layer origin). */
export function pathTextSize(t: TextProps): { width: number; height: number } {
  const pts = t.path?.points ?? [];
  let w = 1, h = 1;
  for (const p of pts) {
    w = Math.max(w, p.x);
    h = Math.max(h, p.y);
  }
  return { width: Math.ceil(w + t.size), height: Math.ceil(h + t.size) };
}

/** Glyphs placed along the path: the baseline follows it (vertical: glyphs stay upright, centred on it). */
export function layoutOnPath(t: TextProps): PlacedGlyph[] {
  const path = t.path;
  if (!path || path.points.length < 2) return [];
  const pts = path.closed ? [...path.points, path.points[0]] : path.points;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1];
  const at = (d: number) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const u = (d - cum[i - 1]) / seg;
    const a = pts[i - 1], b = pts[i];
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  const styles = charStyles(t);
  const ctx = ctx2d(scratch('text-path', 1, 1));
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  const chars = Array.from(t.text.replace(/\n/g, ' '), (ch) => (t.caps ? ch.toUpperCase() : ch));
  const advs = chars.map((ch, i) => {
    const st = styles[i] ?? styles[styles.length - 1];
    ctx.font = styleFont(st);
    return (t.vertical ? st.size : ctx.measureText(ch).width) + t.tracking;
  });
  const total = Math.max(0, advs.reduce((a, b) => a + b, 0) - t.tracking);
  let d = t.align === 'center' ? (L - total) / 2 : t.align === 'right' ? L - total : 0;
  const out: PlacedGlyph[] = [];
  chars.forEach((ch, i) => {
    const mid = d + (advs[i] - t.tracking) / 2;
    d += advs[i];
    // Text that runs past the end of the path is hidden, like overset type
    if (mid < 0 || mid > L) return;
    const p = at(mid);
    out.push({ ch, style: styles[i] ?? styles[styles.length - 1], x: p.x, y: p.y, angle: t.vertical ? 0 : p.angle });
  });
  return out;
}

/** Draws placed glyphs (vertical or on-path) with the text's shadow and outline, offset by (ox, oy). */
export function drawPlaced(ctx: CanvasRenderingContext2D, t: TextProps, glyphs: PlacedGlyph[], ox: number, oy: number, onPath: boolean) {
  ctx.textAlign = 'center';
  ctx.textBaseline = onPath && !t.vertical ? 'alphabetic' : 'middle';
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
  for (const g of glyphs) {
    if (g.ch === ' ') continue;
    const s = g.style;
    ctx.save();
    ctx.translate(ox + g.x, oy + g.y);
    if (g.angle) ctx.rotate(g.angle);
    ctx.font = styleFont(s);
    if (t.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      const k = devScale(ctx);
      ctx.shadowBlur = s.size * 0.15 * k;
      ctx.shadowOffsetY = s.size * 0.06 * k;
      ctx.fillStyle = s.color;
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    }
    if (t.stroke > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = t.stroke * 2;
      ctx.strokeStyle = t.strokeColor;
      ctx.strokeText(g.ch, 0, 0);
    }
    ctx.fillStyle = s.color;
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  }
}

/** Device pixels per user unit of the context's current transform. */
function devScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}
