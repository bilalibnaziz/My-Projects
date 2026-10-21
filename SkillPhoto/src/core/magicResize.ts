// Responsive resize ("magic resize") planning: given a design's top-level layers and a new canvas size,
// decides where each one goes so the design reads as if it had been made for that size, not shrunk.
//
//  - Backgrounds (and adjustments) cover the new canvas.
//  - Edge bands (a bar along the top, bottom or a side) stretch along that edge and keep their thickness share.
//  - Corner and edge items (logo, badge, URL) stay pinned to the same corner / edge of the platform's safe
//    zone, and move off areas the platform covers (the profile photo on an X header or LinkedIn banner).
//  - The rest is content, split into a text cluster (text, buttons) and a visual cluster (photos, products,
//    big shapes). When the shape changes a lot they re-flow: side by side on wide formats, stacked on tall
//    ones; otherwise the whole block keeps its arrangement and is fitted into the safe area.
// Pure geometry: no canvases, no store. socialStudio.ts applies the plan to real layers.

import type { Rect } from './types';
import { SAFE_ZONES } from './social';

export type Role = 'background' | 'band' | 'anchor' | 'text' | 'visual';
export type Mode = 'keep' | 'side' | 'stack';

export interface Item {
  id: string;
  bounds: Rect;
  /** Adjustment layers always cover. */
  adjustment?: boolean;
  /** Text, or a group with text in it (a button). */
  text?: boolean;
  /** A live shape (may be stretched along one axis). */
  shape?: boolean;
}

/** Where a layer goes: every point p maps to (dx + p.x·sx, dy + p.y·sy). */
export interface Place {
  id: string;
  role: Role;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
}

export interface Frame {
  w: number;
  h: number;
  /** Where content must stay (the platform's safe zone plus breathing room). */
  safe: Rect;
  /** Areas the platform covers inside the frame (profile photos, buttons). */
  avoid: Rect[];
}

export interface Plan {
  mode: Mode;
  places: Place[];
  /** The area content was laid out in. */
  content: Rect;
}

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const cx = (r: Rect) => r.x + r.width / 2;
const cy = (r: Rect) => r.y + r.height / 2;
const union = (rs: Rect[]): Rect | null =>
  rs.length
    ? rs.reduce((a, b) => {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
      })
    : null;
const overlaps = (a: Rect, b: Rect) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** The target frame for a size and its safe-zone id (see social.ts SAFE_ZONES). */
export function targetFrame(w: number, h: number, zoneId = 'margin'): Frame {
  const z = SAFE_ZONES[zoneId] ?? SAFE_ZONES.margin;
  // At least a 5% margin on every side, more where the platform covers the frame
  const pad = 0.05;
  const l = Math.max(z.left, pad) * w, r = Math.max(z.right, pad) * w;
  const t = Math.max(z.top, pad) * h, b = Math.max(z.bottom, pad) * h;
  // Very wide zones (YouTube's 1546×423 centre) are already tight: only a small extra margin there
  const extraX = z.left > 0.1 ? 0.01 * w : 0, extraY = z.top > 0.1 ? 0.01 * h : 0;
  const safe = { x: l + extraX, y: t + extraY, width: w - l - r - 2 * extraX, height: h - t - b - 2 * extraY };
  const avoid = (z.extra ?? []).map((e) => ({ x: e.x * w, y: e.y * h, width: e.w * w, height: e.h * h }));
  return { w, h, safe, avoid };
}

type Corner = { h: 'l' | 'r' | 'c'; v: 't' | 'b'; f: number };

/** Works out each item's role in the source design. */
export function classify(items: Item[], W: number, H: number): Map<string, { role: Role; corner?: Corner; edge?: 'top' | 'bottom' | 'left' | 'right' }> {
  const out = new Map<string, { role: Role; corner?: Corner; edge?: 'top' | 'bottom' | 'left' | 'right' }>();
  const near = 0.02;
  const area = W * H;
  for (const it of items) {
    const b = it.bounds;
    const covers = b.x <= W * 0.03 && b.y <= H * 0.03 && right(b) >= W * 0.97 && bottom(b) >= H * 0.97;
    if (it.adjustment || covers) {
      out.set(it.id, { role: 'background' });
      continue;
    }
    if (it.shape && !it.text) {
      const spansX = b.width >= W * 0.85, spansY = b.height >= H * 0.85;
      if (spansX && b.height <= H * 0.45 && (b.y <= H * near || bottom(b) >= H * (1 - near))) {
        out.set(it.id, { role: 'band', edge: b.y <= H * near ? 'top' : 'bottom' });
        continue;
      }
      if (spansY && b.width <= W * 0.45 && (b.x <= W * near || right(b) >= W * (1 - near))) {
        out.set(it.id, { role: 'band', edge: b.x <= W * near ? 'left' : 'right' });
        continue;
      }
    }
    const small = b.width * b.height <= area * 0.06 && b.width <= W * 0.35 && b.height <= H * 0.35;
    const x = cx(b) / W, y = cy(b) / H;
    if (small && (x < 0.22 || x > 0.78) && (y < 0.2 || y > 0.8)) {
      out.set(it.id, { role: 'anchor', corner: { h: x < 0.5 ? 'l' : 'r', v: y < 0.5 ? 't' : 'b', f: x } });
      continue;
    }
    // A thin line of small print along the top or bottom (a URL, a date)
    if (b.width * b.height <= area * 0.04 && b.height <= H * 0.1 && (y < 0.1 || y > 0.9)) {
      out.set(it.id, { role: 'anchor', corner: { h: 'c', v: y < 0.5 ? 't' : 'b', f: x } });
      continue;
    }
    out.set(it.id, { role: it.text ? 'text' : 'visual' });
  }
  // A shape behind or around text (a button, a tag, a highlight) travels with the text
  const texts = items.filter((i) => out.get(i.id)?.role === 'text');
  for (const it of items) {
    if (!it.shape || out.get(it.id)?.role !== 'visual') continue;
    const b = it.bounds;
    const holds = texts.some((t) => {
      const c = { x: cx(t.bounds), y: cy(t.bounds) };
      return c.x >= b.x && c.x <= right(b) && c.y >= b.y && c.y <= bottom(b) && b.width * b.height <= t.bounds.width * t.bounds.height * 6;
    });
    if (holds) out.set(it.id, { role: 'text' });
  }
  return out;
}

/** Plans the layout of `items` (from a W×H design) on `frame`. */
export function planLayout(items: Item[], W: number, H: number, frame: Frame): Plan {
  const { w, h } = frame;
  const roles = classify(items, W, H);
  const places: Place[] = [];
  const S = frame.safe;
  const gap = Math.max(Math.min(w, h) * 0.04, Math.max(w, h) * 0.02);

  // Backgrounds cover, centred
  const cover = Math.max(w / W, h / H);
  // Anchors and band thickness follow the size of the safe area relative to the source's own 5% margins
  const sa = Math.min(S.width / (W * 0.9), S.height / (H * 0.9));

  const contentItems: Item[] = [];
  const anchors: { it: Item; to: Rect; corner: Corner }[] = [];
  const bands: { it: Item; to: Rect; edge: 'top' | 'bottom' | 'left' | 'right'; place: Place }[] = [];
  // Backgrounds and bands first: small print sitting on a band travels with it
  for (const it of items) {
    const r = roles.get(it.id)!;
    if (r.role === 'background') {
      places.push({ id: it.id, role: 'background', sx: cover, sy: cover, dx: (w - W * cover) / 2, dy: (h - H * cover) / 2 });
    } else if (r.role === 'band') {
      let place: Place;
      if (r.edge === 'top' || r.edge === 'bottom') {
        const sx = w / W, sy = Math.min(h / H, 1.25 * sa);
        place = { id: it.id, role: 'band', sx, sy, dx: 0, dy: r.edge === 'top' ? 0 : h - H * sy };
      } else {
        const sy = h / H, sx = Math.min(w / W, 1.25 * sa);
        place = { id: it.id, role: 'band', sx, sy, dy: 0, dx: r.edge === 'left' ? 0 : w - W * sx };
      }
      places.push(place);
      bands.push({ it, to: placeRect(place, it.bounds), edge: r.edge!, place });
    }
  }
  for (const it of items) {
    const r = roles.get(it.id)!;
    const b = it.bounds;
    if (r.role === 'background' || r.role === 'band') continue;
    if (r.role !== 'anchor') {
      contentItems.push(it);
      continue;
    }
    const c = r.corner!;
    // On a band that is still visible in the safe zone: same spot on the band
    const host = bands.find((k) => cx(b) >= k.it.bounds.x && cx(b) <= right(k.it.bounds) && cy(b) >= k.it.bounds.y && cy(b) <= bottom(k.it.bounds));
    if (host && overlaps(host.to, S)) {
      const horiz = host.edge === 'top' || host.edge === 'bottom';
      const k = Math.min(sa * 1.25, horiz ? host.place.sy : host.place.sx);
      const tw = b.width * k, th = b.height * k;
      const hb = host.it.bounds;
      const ccx = horiz ? Math.min(right(S) - tw / 2, Math.max(S.x + tw / 2, (cx(b) / W) * w)) : cx(host.to) + (cx(b) - cx(hb)) * k;
      const ccy = horiz ? cy(host.to) + (cy(b) - cy(hb)) * k : Math.min(bottom(S) - th / 2, Math.max(S.y + th / 2, (cy(b) / H) * h));
      const to = { x: ccx - tw / 2, y: ccy - th / 2, width: tw, height: th };
      places.push({ id: it.id, role: 'anchor', sx: k, sy: k, dx: to.x - b.x * k, dy: to.y - b.y * k });
      continue;
    }
    const tw = b.width * sa, th = b.height * sa;
    const m = 0.05;
    // Distance in from the source edge beyond its 5% margin, scaled
    const offX = c.h === 'l' ? Math.max(0, b.x - W * m) : c.h === 'r' ? Math.max(0, W * (1 - m) - right(b)) : 0;
    const offY = c.v === 't' ? Math.max(0, b.y - H * m) : Math.max(0, H * (1 - m) - bottom(b));
    // Corner items stay clear of bands that cover the safe zone's edge
    const top = Math.max(S.y, ...bands.filter((k) => k.edge === 'top').map((k) => bottom(k.to) + gap * 0.5));
    const bot = Math.min(bottom(S), ...bands.filter((k) => k.edge === 'bottom').map((k) => k.to.y - gap * 0.5));
    const place = (hh: Corner['h']): Rect => ({
      x: hh === 'l' ? S.x + offX * sa : hh === 'r' ? right(S) - offX * sa - tw : Math.min(right(S) - tw, Math.max(S.x, S.x + c.f * S.width - tw / 2)),
      y: c.v === 't' ? top + offY * sa : bot - offY * sa - th,
      width: tw,
      height: th,
    });
    let to = place(c.h);
    // Off the profile photo: try the other side
    if (frame.avoid.some((a) => overlaps(a, to))) {
      const alt = place(c.h === 'l' ? 'r' : c.h === 'r' ? 'l' : cx(to) < w / 2 ? 'r' : 'l');
      if (!frame.avoid.some((a) => overlaps(a, alt))) to = alt;
    }
    anchors.push({ it, to, corner: c });
  }

  const T = union(contentItems.filter((i) => roles.get(i.id)!.role === 'text').map((i) => i.bounds));
  const V = union(contentItems.filter((i) => roles.get(i.id)!.role === 'visual').map((i) => i.bounds));
  const B = union([T, V].filter((r): r is Rect => !!r));

  // Content area: the safe zone, minus anchored items' strips and areas the platform covers
  let C: Rect = { ...S };
  // How much the frame's shape changes decides the layout (not the content's own shape)
  const frameRatio = S.width / S.height / (W / H);
  const sideways = frameRatio > 1.66;
  for (const a of anchors) {
    const r = a.to;
    if (sideways && a.corner.h !== 'c') {
      if (a.corner.h === 'l') C = { ...C, x: Math.max(C.x, right(r) + gap), width: right(C) - Math.max(C.x, right(r) + gap) };
      else C = { ...C, width: Math.min(right(C), r.x - gap) - C.x };
    } else if (a.corner.v === 't') C = { ...C, y: Math.max(C.y, bottom(r) + gap * 1.5), height: bottom(C) - Math.max(C.y, bottom(r) + gap * 1.5) };
    else C = { ...C, height: Math.min(bottom(C), r.y - gap) - C.y };
  }
  for (const k of bands) {
    if (!overlaps(k.to, C)) continue;
    if (k.edge === 'bottom') C = { ...C, height: k.to.y - gap * 0.5 - C.y };
    else if (k.edge === 'top') C = { ...C, y: bottom(k.to) + gap * 0.5, height: bottom(C) - (bottom(k.to) + gap * 0.5) };
    else if (k.edge === 'left') C = { ...C, x: right(k.to) + gap * 0.5, width: right(C) - (right(k.to) + gap * 0.5) };
    else C = { ...C, width: k.to.x - gap * 0.5 - C.x };
  }
  for (const a of frame.avoid) {
    if (!overlaps(a, C)) continue;
    if (cx(a) < cx(C)) C = { ...C, x: right(a) + gap * 0.5, width: right(C) - (right(a) + gap * 0.5) };
    else C = { ...C, width: a.x - gap * 0.5 - C.x };
  }
  // Never squeeze content to nothing: fall back to the safe zone
  if (C.width < S.width * 0.35 || C.height < S.height * 0.35) C = { ...S };

  let mode: Mode = 'keep';
  const put = (src: Rect, s: number, x: number, y: number, list: Item[], role: Role) => {
    for (const it of list) places.push({ id: it.id, role, sx: s, sy: s, dx: x - src.x * s, dy: y - src.y * s });
  };
  const textItems = contentItems.filter((i) => roles.get(i.id)!.role === 'text');
  const visualItems = contentItems.filter((i) => roles.get(i.id)!.role === 'visual');
  if (B) {
    // The layout that shows the content biggest wins; the original arrangement unless another is clearly better
    const sKeep = Math.min(C.width / B.width, C.height / B.height, cover);
    if (T && V) {
      const sSide = Math.min(C.height / Math.max(T.height, V.height), (C.width - gap) / (T.width + V.width), cover);
      const sStack = Math.min(C.width / Math.max(T.width, V.width), (C.height - gap) / (T.height + V.height), cover);
      if (sSide > sKeep * 1.15 && sSide >= sStack) mode = 'side';
      else if (sStack > sKeep * 1.15) mode = 'stack';
    }
    if (mode === 'side' && T && V) {
      // Keep left/right order; a stacked source puts text first (reading order)
      const visualFirst = cx(V) < cx(T) - Math.min(T.width, V.width) * 0.25;
      const [A, Bb] = visualFirst ? [V, T] : [T, V];
      const s = Math.min(C.height / Math.max(A.height, Bb.height), (C.width - gap) / (A.width + Bb.width), cover);
      const free = C.width - (A.width + Bb.width) * s - gap;
      const ax = C.x + free * 0.25;
      const bx = ax + A.width * s + gap + free * 0.5;
      const ay = C.y + (C.height - A.height * s) / 2, by = C.y + (C.height - Bb.height * s) / 2;
      put(A, s, ax, ay, visualFirst ? visualItems : textItems, visualFirst ? 'visual' : 'text');
      put(Bb, s, bx, by, visualFirst ? textItems : visualItems, visualFirst ? 'text' : 'visual');
    } else if (mode === 'stack' && T && V) {
      // Keep top/bottom order; a side-by-side source puts the headline on top
      const visualFirst = cy(V) < cy(T) - Math.min(T.height, V.height) * 0.25;
      const [A, Bb] = visualFirst ? [V, T] : [T, V];
      const s = Math.min(C.width / Math.max(A.width, Bb.width), (C.height - gap) / (A.height + Bb.height), cover);
      const free = C.height - (A.height + Bb.height) * s - gap;
      const ay = C.y + free * 0.3;
      const by = ay + A.height * s + gap + free * 0.4;
      const ax = C.x + (C.width - A.width * s) / 2, bx = C.x + (C.width - Bb.width * s) / 2;
      put(A, s, ax, ay, visualFirst ? visualItems : textItems, visualFirst ? 'visual' : 'text');
      put(Bb, s, bx, by, visualFirst ? textItems : visualItems, visualFirst ? 'text' : 'visual');
    } else {
      // Same arrangement, fitted; a block that hugged a side of the source keeps hugging it
      const s = Math.min(C.width / B.width, C.height / B.height, cover);
      const bw = B.width * s, bh = B.height * s;
      const hug = (lo: number, hi: number, size: number) => (lo < size * 0.12 && hi < size * 0.75 ? 'start' : hi > size * 0.88 && lo > size * 0.25 ? 'end' : 'mid');
      const hx = hug(B.x, right(B), W), hy = hug(B.y, bottom(B), H);
      const x = hx === 'start' ? C.x : hx === 'end' ? right(C) - bw : C.x + (C.width - bw) / 2;
      const y = hy === 'start' ? C.y : hy === 'end' ? bottom(C) - bh : C.y + (C.height - bh) / 2;
      for (const it of contentItems) places.push({ id: it.id, role: roles.get(it.id)!.role, sx: s, sy: s, dx: x - B.x * s, dy: y - B.y * s });
    }
  }
  for (const a of anchors) places.push({ id: a.it.id, role: 'anchor', sx: sa, sy: sa, dx: a.to.x - a.it.bounds.x * sa, dy: a.to.y - a.it.bounds.y * sa });
  return { mode, places, content: C };
}

/** Where a source rect lands under a place. */
export function placeRect(p: Place, r: Rect): Rect {
  return { x: p.dx + r.x * p.sx, y: p.dy + r.y * p.sy, width: r.width * p.sx, height: r.height * p.sy };
}
