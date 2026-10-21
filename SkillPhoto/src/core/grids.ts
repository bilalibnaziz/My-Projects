// Grids: layout grids per artboard (columns, rows, baseline, modular, composition, safe areas,
// fold panels, aspect crops), a preset library for social / video / print / packaging / web, an
// Auto Grid that reads the artboard, and the adaptive document grid that keeps subdividing as you
// zoom in. Pure geometry — the viewport draws it, the move and drawing tools snap to it.
// Identical copy in SkillVector and SkillPhoto: change both.

export type GridKind =
  | 'columns'
  | 'rows'
  | 'baseline'
  | 'square'
  | 'dots'
  | 'isometric'
  | 'thirds'
  | 'golden'
  | 'spiral'
  | 'diagonals'
  | 'center'
  | 'radial'
  | 'safe'
  | 'bleed'
  | 'aspect'
  | 'region'
  | 'panels';

export interface GridSpec {
  id: string;
  kind: GridKind;
  visible: boolean;
  color: string;
  label?: string;
  /** columns / rows: track count. radial: rings. */
  count?: number;
  /** columns / rows: space between tracks (document units). */
  gutter?: number;
  /** columns: left + right margin; rows: top + bottom margin. */
  margin?: number;
  /** columns / rows: stretch to fill, or fixed `size` tracks placed centre / start / end. */
  align?: 'stretch' | 'center' | 'start' | 'end';
  /** Fixed track size (columns / rows) or spacing (baseline, square, dots, isometric). */
  size?: number;
  /** baseline: first line offset from the top. */
  offset?: number;
  /** safe: inset per side, bleed: outset per side — top, right, bottom, left. */
  inset?: [number, number, number, number];
  /** panels: fold / panel positions from the left (axis x) or top (axis y). */
  positions?: number[];
  names?: string[];
  axis?: 'x' | 'y';
  /** aspect: width / height of the centred crop. */
  ratio?: number;
  /** region: rectangle relative to the artboard. */
  rect?: { x: number; y: number; w: number; h: number };
  /** spiral: which corner it curls into (0–3). radial: spokes. */
  turn?: number;
  spokes?: number;
  /** Objects snap to this grid's lines (default on). */
  snap?: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Repeating lines or dots, drawn only where visible (they can be millions at a far zoom). */
export interface GridPattern {
  kind: 'square' | 'dots' | 'baseline' | 'isometric';
  step: number;
  ox: number;
  oy: number;
  /** Clip box (artboard-relative). */
  box: Box;
}

/** Everything one grid draws, relative to its artboard's top-left, in document units. */
export interface GridGeom {
  bands: Box[];
  lines: [number, number, number, number][];
  polys: number[][];
  circles: { cx: number; cy: number; r: number }[];
  rects: (Box & { dash?: boolean })[];
  /** Areas outside an aspect crop, drawn shaded. */
  shade: Box[];
  labels: { x: number; y: number; text: string }[];
  patterns: GridPattern[];
  snapX: number[];
  snapY: number[];
}

const PHI = (1 + Math.sqrt(5)) / 2;

const emptyGeom = (): GridGeom => ({ bands: [], lines: [], polys: [], circles: [], rects: [], shade: [], labels: [], patterns: [], snapX: [], snapY: [] });

/** Track start positions and size for `count` tracks across `len`. */
export function tracks(len: number, count: number, gutter: number, margin: number, align: GridSpec['align'] = 'stretch', size?: number): { starts: number[]; size: number } {
  const n = Math.max(1, Math.round(count));
  let t = (len - margin * 2 - gutter * (n - 1)) / n;
  let start = margin;
  if (align !== 'stretch' && size && size > 0) {
    t = size;
    const total = n * t + (n - 1) * gutter;
    start = align === 'center' ? (len - total) / 2 : align === 'end' ? len - margin - total : margin;
  }
  if (!(t > 0)) return { starts: [], size: 0 };
  return { starts: Array.from({ length: n }, (_, i) => start + i * (t + gutter)), size: t };
}

/** Point where a ray from (x, y) along (dx, dy) leaves the w × h box. */
function exitPoint(x: number, y: number, dx: number, dy: number, w: number, h: number): [number, number] {
  let t = Infinity;
  if (dx > 1e-12) t = Math.min(t, (w - x) / dx);
  if (dx < -1e-12) t = Math.min(t, -x / dx);
  if (dy > 1e-12) t = Math.min(t, (h - y) / dy);
  if (dy < -1e-12) t = Math.min(t, -y / dy);
  return [x + dx * t, y + dy * t];
}

/** Golden spiral fitted to a w × h frame, as a polyline. `turn` flips it into another corner. */
export function goldenSpiral(w: number, h: number, turn = 0): number[] {
  // Built in a φ × 1 golden rectangle, then stretched onto the frame (transposed when portrait)
  const pts: number[] = [];
  let x = 0;
  let y = 0;
  let W = PHI;
  let H = 1;
  for (let i = 0; i < 12; i++) {
    const dir = i % 4;
    let cx: number, cy: number, s: number, a0: number;
    if (dir === 0) { s = H; cx = x + s; cy = y + s; a0 = Math.PI; x += s; W -= s; }
    else if (dir === 1) { s = W; cx = x; cy = y + s; a0 = 1.5 * Math.PI; y += s; H -= s; }
    else if (dir === 2) { s = H; cx = x + W - s; cy = y; a0 = 0; W -= s; }
    else { s = W; cx = x + s; cy = y + H - s; a0 = 0.5 * Math.PI; H -= s; }
    for (let k = i ? 1 : 0; k <= 16; k++) {
      const a = a0 + (k / 16) * (Math.PI / 2);
      pts.push(cx + s * Math.cos(a), cy + s * Math.sin(a));
    }
  }
  const portrait = h > w;
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    let u = pts[i] / PHI;
    let v = pts[i + 1];
    if (portrait) [u, v] = [v, u];
    if (turn & 1) u = 1 - u;
    if (turn & 2) v = 1 - v;
    out.push(u * w, v * h);
  }
  return out;
}

/** Geometry of one grid on a w × h artboard. */
export function gridGeometry(spec: GridSpec, w: number, h: number): GridGeom {
  const g = emptyGeom();
  const all = { x: 0, y: 0, w, h };
  const vline = (x: number) => (g.lines.push([x, 0, x, h]), g.snapX.push(x));
  const hline = (y: number) => (g.lines.push([0, y, w, y]), g.snapY.push(y));
  switch (spec.kind) {
    case 'columns': {
      const t = tracks(w, spec.count ?? 12, spec.gutter ?? 0, spec.margin ?? 0, spec.align, spec.size);
      for (const x of t.starts) {
        g.bands.push({ x, y: 0, w: t.size, h });
        g.snapX.push(x, x + t.size);
      }
      break;
    }
    case 'rows': {
      const t = tracks(h, spec.count ?? 6, spec.gutter ?? 0, spec.margin ?? 0, spec.align, spec.size);
      for (const y of t.starts) {
        g.bands.push({ x: 0, y, w, h: t.size });
        g.snapY.push(y, y + t.size);
      }
      break;
    }
    case 'baseline':
    case 'square':
    case 'dots':
    case 'isometric': {
      const step = Math.max(0.01, spec.size ?? 8);
      g.patterns.push({ kind: spec.kind, step, ox: spec.kind === 'baseline' ? (spec.offset ?? 0) : 0, oy: spec.kind === 'baseline' ? (spec.offset ?? 0) : 0, box: all });
      break;
    }
    case 'thirds':
      for (const f of [1 / 3, 2 / 3]) {
        vline(w * f);
        hline(h * f);
      }
      break;
    case 'golden':
      for (const f of [1 / PHI ** 2, 1 / PHI]) {
        vline(w * f);
        hline(h * f);
      }
      break;
    case 'spiral':
      g.polys.push(goldenSpiral(w, h, spec.turn ?? 0));
      // The spiral's eye sits on the golden sections
      g.snapX.push(w / PHI ** 2, w / PHI);
      g.snapY.push(h / PHI ** 2, h / PHI);
      break;
    case 'diagonals': {
      // Harmonic armature: both diagonals plus the reciprocals (from each corner, at right angles
      // to the diagonal it does not lie on)
      g.lines.push([0, 0, w, h], [w, 0, 0, h]);
      const corners: [number, number, number, number][] = [
        [0, 0, h, w],
        [w, 0, -h, w],
        [0, h, h, -w],
        [w, h, -h, -w],
      ];
      for (const [x, y, dx, dy] of corners) {
        const [ex, ey] = exitPoint(x, y, dx, dy, w, h);
        g.lines.push([x, y, ex, ey]);
      }
      g.snapX.push(w / 2);
      g.snapY.push(h / 2);
      break;
    }
    case 'center':
      vline(w / 2);
      hline(h / 2);
      break;
    case 'radial': {
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2;
      const n = Math.max(1, Math.round(spec.count ?? 6));
      for (let i = 1; i <= n; i++) g.circles.push({ cx, cy, r: (R * i) / n });
      const sp = Math.max(0, Math.round(spec.spokes ?? 12));
      for (let i = 0; i < sp; i++) {
        const a = (i / sp) * Math.PI * 2;
        g.lines.push([cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
      }
      g.snapX.push(cx);
      g.snapY.push(cy);
      break;
    }
    case 'safe':
    case 'bleed': {
      const [t, r, b, l] = spec.inset ?? [0, 0, 0, 0];
      const k = spec.kind === 'bleed' ? -1 : 1;
      const box = { x: l * k, y: t * k, w: w - (l + r) * k, h: h - (t + b) * k };
      if (box.w > 0 && box.h > 0) {
        g.rects.push({ ...box, dash: spec.kind === 'safe' });
        g.snapX.push(box.x, box.x + box.w);
        g.snapY.push(box.y, box.y + box.h);
        if (spec.label) g.labels.push({ x: box.x, y: spec.kind === 'bleed' ? box.y + box.h : box.y, text: spec.label });
      }
      break;
    }
    case 'aspect': {
      const r = spec.ratio && spec.ratio > 0 ? spec.ratio : 1;
      const cw = w / h > r ? h * r : w;
      const ch = w / h > r ? h : w / r;
      const x = (w - cw) / 2;
      const y = (h - ch) / 2;
      g.rects.push({ x, y, w: cw, h: ch });
      if (x > 0.01) g.shade.push({ x: 0, y: 0, w: x, h }, { x: x + cw, y: 0, w: w - x - cw, h });
      if (y > 0.01) g.shade.push({ x: 0, y: 0, w, h: y }, { x: 0, y: y + ch, w, h: h - y - ch });
      g.snapX.push(x, x + cw);
      g.snapY.push(y, y + ch);
      // Bottom-left, so it never sits on a safe-area label at the top
      if (spec.label) g.labels.push({ x, y: y + ch - 16, text: spec.label });
      break;
    }
    case 'region': {
      const r = spec.rect;
      if (r) {
        g.bands.push({ x: r.x, y: r.y, w: r.w, h: r.h });
        g.rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, dash: true });
        g.snapX.push(r.x, r.x + r.w);
        g.snapY.push(r.y, r.y + r.h);
        if (spec.label) g.labels.push({ x: r.x, y: r.y, text: spec.label });
      }
      break;
    }
    case 'panels': {
      const pos = (spec.positions ?? []).slice().sort((a, b) => a - b);
      const len = spec.axis === 'y' ? h : w;
      for (const p of pos) (spec.axis === 'y' ? hline : vline)(p);
      // Panel names centred between folds
      const edges = [0, ...pos.filter((p) => p > 0 && p < len), len];
      (spec.names ?? []).forEach((name, i) => {
        if (i >= edges.length - 1 || !name) return;
        const mid = (edges[i] + edges[i + 1]) / 2;
        g.labels.push(spec.axis === 'y' ? { x: 4, y: mid, text: name } : { x: mid, y: 4, text: name });
      });
      break;
    }
  }
  if (spec.snap === false) {
    g.snapX = [];
    g.snapY = [];
  }
  return g;
}

// ---------------------------------------------------------------- presets

export type GridCategory = 'Social' | 'Video' | 'Print' | 'Packaging' | 'Web & UI' | 'Composition';

export const GRID_CATEGORIES: GridCategory[] = ['Social', 'Video', 'Print', 'Packaging', 'Web & UI', 'Composition'];

export interface GridContext {
  w: number;
  h: number;
  /** Pixels per inch used for print measurements (mm, inches). */
  dpi: number;
}

export type GridDraft = Omit<GridSpec, 'id' | 'visible'> & { visible?: boolean };

export interface GridPreset {
  id: string;
  label: string;
  category: GridCategory;
  /** One line on what it is for. */
  hint: string;
  build: (c: GridContext) => GridDraft[];
}

export const GRID_COLORS = {
  columns: '#ff3b6b',
  rows: '#4daafc',
  baseline: '#2ea043',
  composition: '#ff9a00',
  safe: '#4daafc',
  action: '#2ea043',
  bleed: '#f85149',
  panels: '#c586ff',
  crop: '#e2c08d',
  zone: '#f85149',
};

const mm = (c: GridContext, v: number) => (v / 25.4) * c.dpi;
const inch = (c: GridContext, v: number) => v * c.dpi;
/** Scales a value given for a reference width (e.g. 1080 px platform specs) to this artboard. */
const ref = (c: GridContext, v: number, base = 1080) => (v * c.w) / base;
const pct = (v: number, len: number) => v * len;

const thirds = (): GridDraft => ({ kind: 'thirds', color: GRID_COLORS.composition, snap: true });
const center = (): GridDraft => ({ kind: 'center', color: GRID_COLORS.composition });
const safePct = (c: GridContext, f: number, label: string, color = GRID_COLORS.safe): GridDraft => {
  const v = Math.min(c.w, c.h) * f;
  return { kind: 'safe', inset: [v, v, v, v], label, color };
};
const zone = (x: number, y: number, w: number, h: number, label: string): GridDraft => ({ kind: 'region', rect: { x, y, w, h }, label, color: GRID_COLORS.zone, snap: false });

export const GRID_PRESETS: GridPreset[] = [
  // ------------------------------------------------------------ Social
  {
    id: 'social-square',
    label: 'Square post 1:1',
    category: 'Social',
    hint: 'Thirds, 5% safe margin and 6 columns for posts and carousels',
    build: (c) => [safePct(c, 0.05, 'SAFE 5%'), thirds(), { kind: 'columns', count: 6, gutter: ref(c, 24), margin: ref(c, 54), color: GRID_COLORS.columns }],
  },
  {
    id: 'social-portrait',
    label: 'Feed post 4:5',
    category: 'Social',
    hint: 'The profile grid shows a centred 3:4 crop — keep key content inside it',
    build: (c) => [{ kind: 'aspect', ratio: 3 / 4, label: 'PROFILE GRID 3:4', color: GRID_COLORS.crop }, safePct(c, 0.05, 'SAFE 5%'), thirds()],
  },
  {
    id: 'social-story',
    label: 'Story 9:16',
    category: 'Social',
    hint: 'Profile bar on top, reply bar below — text stays in the middle band',
    build: (c) => [
      { kind: 'safe', inset: [ref(c, 250), ref(c, 65), ref(c, 340), ref(c, 65)], label: 'STORY SAFE', color: GRID_COLORS.safe },
      zone(0, 0, c.w, ref(c, 250) * 0.6, 'Profile & progress'),
      zone(0, c.h - ref(c, 340) * 0.7, c.w, ref(c, 340) * 0.7, 'Reply bar'),
      thirds(),
    ],
  },
  {
    id: 'social-reel',
    label: 'Reel / TikTok / Short',
    category: 'Social',
    hint: 'Caption and audio at the bottom, buttons on the right, 4:5 feed crop',
    build: (c) => [
      { kind: 'safe', inset: [ref(c, 270), ref(c, 140), ref(c, 670), ref(c, 60)], label: 'VIDEO SAFE', color: GRID_COLORS.safe },
      zone(c.w - ref(c, 130), c.h * 0.45, ref(c, 130), c.h * 0.55 - ref(c, 370), 'Buttons'),
      zone(0, c.h - ref(c, 370), c.w, ref(c, 370), 'Caption & audio'),
      { kind: 'aspect', ratio: 4 / 5, label: 'FEED 4:5', color: GRID_COLORS.crop },
      center(),
    ],
  },
  {
    id: 'social-carousel',
    label: 'Carousel panorama',
    category: 'Social',
    hint: 'One wide artboard cut into slides; content crossing a seam stays seamless',
    build: (c) => {
      const count = carouselSlides(c.w, c.h) || Math.max(2, Math.round(c.w / c.h));
      const sw = c.w / count;
      return [
        { kind: 'panels', axis: 'x', positions: Array.from({ length: count - 1 }, (_, i) => sw * (i + 1)), names: Array.from({ length: count }, (_, i) => `SLIDE ${i + 1}`), color: GRID_COLORS.panels },
        { kind: 'safe', inset: [c.h * 0.05, sw * 0.05, c.h * 0.05, sw * 0.05], label: 'SAFE', color: GRID_COLORS.safe },
      ];
    },
  },
  {
    id: 'social-thumb',
    label: 'YouTube thumbnail',
    category: 'Social',
    hint: 'Bottom-right is covered by the video length; thirds for the face and title',
    build: (c) => [safePct(c, 0.04, 'SAFE'), zone(c.w * 0.86, c.h * 0.86, c.w * 0.11, c.h * 0.1, 'Duration'), thirds()],
  },
  {
    id: 'social-yt-banner',
    label: 'YouTube banner',
    category: 'Social',
    hint: 'Only the centre 1546 × 423 shows everywhere; 1855 wide on tablets',
    build: (c) => {
      const s = c.w / 2560;
      return [
        { kind: 'region', rect: { x: (c.w - 1546 * s) / 2, y: (c.h - 423 * s) / 2, w: 1546 * s, h: 423 * s }, label: 'ALL DEVICES 1546×423', color: GRID_COLORS.safe },
        { kind: 'safe', inset: [(c.h - 423 * s) / 2, (c.w - 1855 * s) / 2, (c.h - 423 * s) / 2, (c.w - 1855 * s) / 2], label: 'TABLET 1855', color: GRID_COLORS.crop },
        { kind: 'safe', inset: [(c.h - 1440 * s * 0.6) / 2, 0, (c.h - 1440 * s * 0.6) / 2, 0], label: 'DESKTOP', color: GRID_COLORS.action },
      ];
    },
  },
  {
    id: 'social-banner',
    label: 'Profile banner (X / LinkedIn)',
    category: 'Social',
    hint: 'Profile photo overlaps the lower left; edges crop on phones',
    build: (c) => [
      { kind: 'safe', inset: [c.h * 0.12, c.w * 0.03, c.h * 0.12, c.w * 0.03], label: 'SAFE', color: GRID_COLORS.safe },
      zone(c.w * 0.03, c.h * 0.55, c.h * 0.6, c.h * 0.45, 'Profile photo'),
      thirds(),
    ],
  },
  // ------------------------------------------------------------ Video
  {
    id: 'video-broadcast',
    label: 'Title & action safe',
    category: 'Video',
    hint: 'Action safe 93%, title safe 90% and centre cross for any frame size',
    build: (c) => [
      { kind: 'safe', inset: [pct(0.035, c.h), pct(0.035, c.w), pct(0.035, c.h), pct(0.035, c.w)], label: 'ACTION SAFE 93%', color: GRID_COLORS.action },
      { kind: 'safe', inset: [pct(0.05, c.h), pct(0.05, c.w), pct(0.05, c.h), pct(0.05, c.w)], label: 'TITLE SAFE 90%', color: GRID_COLORS.crop },
      center(),
    ],
  },
  {
    id: 'video-vertical-cut',
    label: '9:16 centre cut',
    category: 'Video',
    hint: 'Frame a landscape shot so it also works cropped to vertical',
    build: () => [{ kind: 'aspect', ratio: 9 / 16, label: '9:16', color: GRID_COLORS.crop }, center()],
  },
  {
    id: 'video-square-cut',
    label: '1:1 and 4:5 centre cuts',
    category: 'Video',
    hint: 'Repurpose one edit for square and portrait feeds',
    build: () => [
      { kind: 'aspect', ratio: 1, label: '1:1', color: GRID_COLORS.crop },
      { kind: 'aspect', ratio: 4 / 5, label: '4:5', color: GRID_COLORS.panels },
    ],
  },
  {
    id: 'video-43',
    label: '4:3 centre cut',
    category: 'Video',
    hint: 'Classic TV protection inside a widescreen frame',
    build: () => [{ kind: 'aspect', ratio: 4 / 3, label: '4:3', color: GRID_COLORS.crop }, center()],
  },
  {
    id: 'video-scope',
    label: 'Cinemascope 2.39:1',
    category: 'Video',
    hint: 'Letterbox for a cinematic frame',
    build: () => [{ kind: 'aspect', ratio: 2.39, label: '2.39:1', color: GRID_COLORS.crop }, thirds()],
  },
  {
    id: 'video-lower-third',
    label: 'Lower third',
    category: 'Video',
    hint: 'Name-title band inside title safe',
    build: (c) => [
      { kind: 'safe', inset: [pct(0.05, c.h), pct(0.05, c.w), pct(0.05, c.h), pct(0.05, c.w)], label: 'TITLE SAFE', color: GRID_COLORS.crop },
      { kind: 'region', rect: { x: c.w * 0.05, y: c.h * 0.7, w: c.w * 0.5, h: c.h * 0.18 }, label: 'LOWER THIRD', color: GRID_COLORS.panels },
    ],
  },
  // ------------------------------------------------------------ Print
  {
    id: 'print-bleed',
    label: 'Bleed 3 mm + safe 5 mm',
    category: 'Print',
    hint: 'Standard print setup: extend art to the bleed, keep text inside safe',
    build: (c) => [
      { kind: 'bleed', inset: [mm(c, 3), mm(c, 3), mm(c, 3), mm(c, 3)], label: 'BLEED 3 mm', color: GRID_COLORS.bleed },
      { kind: 'safe', inset: [mm(c, 5), mm(c, 5), mm(c, 5), mm(c, 5)], label: 'SAFE 5 mm', color: GRID_COLORS.safe },
    ],
  },
  {
    id: 'print-us-bleed',
    label: 'Bleed ⅛ in + safe ⅛ in',
    category: 'Print',
    hint: 'US printers: business cards, flyers, postcards',
    build: (c) => [
      { kind: 'bleed', inset: [inch(c, 0.125), inch(c, 0.125), inch(c, 0.125), inch(c, 0.125)], label: 'BLEED ⅛ in', color: GRID_COLORS.bleed },
      { kind: 'safe', inset: [inch(c, 0.125), inch(c, 0.125), inch(c, 0.125), inch(c, 0.125)], label: 'SAFE ⅛ in', color: GRID_COLORS.safe },
    ],
  },
  {
    id: 'print-magazine',
    label: 'Magazine 12 columns',
    category: 'Print',
    hint: '12 columns, 4 mm gutters, 15 mm margins and a 12 pt baseline',
    build: (c) => [
      { kind: 'columns', count: 12, gutter: mm(c, 4), margin: mm(c, 15), color: GRID_COLORS.columns },
      { kind: 'baseline', size: (12 / 72) * c.dpi, offset: mm(c, 15), color: GRID_COLORS.baseline },
      { kind: 'safe', inset: [mm(c, 15), mm(c, 15), mm(c, 15), mm(c, 15)], label: 'MARGIN', color: GRID_COLORS.safe },
    ],
  },
  {
    id: 'print-swiss',
    label: 'Swiss modular 6 × 8',
    category: 'Print',
    hint: 'International Typographic Style: 6 columns × 8 rows of modules',
    build: (c) => [
      { kind: 'columns', count: 6, gutter: mm(c, 5), margin: mm(c, 15), color: GRID_COLORS.columns },
      { kind: 'rows', count: 8, gutter: mm(c, 5), margin: mm(c, 15), color: GRID_COLORS.rows },
    ],
  },
  {
    id: 'print-canon',
    label: 'Book canon (Van de Graaf)',
    category: 'Print',
    hint: 'Classic text block: margins 1/9 and 2/9 of the page',
    build: (c) => [
      { kind: 'safe', inset: [c.h / 9, (c.w * 2) / 9, (c.h * 2) / 9, c.w / 9], label: 'TEXT BLOCK', color: GRID_COLORS.safe },
      { kind: 'diagonals', color: 'rgba(160,160,160,0.6)', snap: false },
    ],
  },
  {
    id: 'print-trifold',
    label: 'Tri-fold brochure',
    category: 'Print',
    hint: 'Three panels with the fold-in panel 1/16 in narrower',
    build: (c) => {
      const p = c.w / 3;
      const k = inch(c, 1 / 32);
      return [
        { kind: 'panels', axis: 'x', positions: [p + k, 2 * p + k], names: ['INSIDE FLAP', 'BACK', 'COVER'], color: GRID_COLORS.panels },
        { kind: 'bleed', inset: [mm(c, 3), mm(c, 3), mm(c, 3), mm(c, 3)], label: 'BLEED', color: GRID_COLORS.bleed },
        { kind: 'safe', inset: [mm(c, 5), mm(c, 5), mm(c, 5), mm(c, 5)], label: 'SAFE', color: GRID_COLORS.safe },
      ];
    },
  },
  {
    id: 'print-bifold',
    label: 'Bi-fold / greeting card',
    category: 'Print',
    hint: 'Centre fold with safe margins on each panel',
    build: (c) => [
      { kind: 'panels', axis: c.w >= c.h ? 'x' : 'y', positions: [c.w >= c.h ? c.w / 2 : c.h / 2], names: ['BACK', 'FRONT'], color: GRID_COLORS.panels },
      { kind: 'bleed', inset: [mm(c, 3), mm(c, 3), mm(c, 3), mm(c, 3)], label: 'BLEED', color: GRID_COLORS.bleed },
      { kind: 'safe', inset: [mm(c, 5), mm(c, 5), mm(c, 5), mm(c, 5)], label: 'SAFE', color: GRID_COLORS.safe },
    ],
  },
  // ------------------------------------------------------------ Packaging
  {
    id: 'pack-box-wrap',
    label: 'Box wrap: 4 faces + glue flap',
    category: 'Packaging',
    hint: 'Front, side, back, side and a 15 mm glue flap across the sheet',
    build: (c) => {
      const glue = mm(c, 15);
      const face = (c.w - glue) / 3; // front + back = 2 faces, two sides = 1 face (sides half as deep)
      const side = face / 2;
      const xs = [face, face + side, 2 * face + side, 2 * face + 2 * side];
      return [
        { kind: 'panels', axis: 'x', positions: xs, names: ['FRONT', 'SIDE', 'BACK', 'SIDE', 'GLUE'], color: GRID_COLORS.panels },
        { kind: 'bleed', inset: [mm(c, 3), mm(c, 3), mm(c, 3), mm(c, 3)], label: 'BLEED', color: GRID_COLORS.bleed },
        { kind: 'safe', inset: [mm(c, 4), mm(c, 4), mm(c, 4), mm(c, 4)], label: 'SAFE', color: GRID_COLORS.safe },
      ];
    },
  },
  {
    id: 'pack-bottle',
    label: 'Bottle / can wrap label',
    category: 'Packaging',
    hint: 'Front and back halves, 6 mm overlap seam, barcode zone on the back',
    build: (c) => {
      const lap = mm(c, 6);
      const body = c.w - lap;
      return [
        { kind: 'panels', axis: 'x', positions: [body / 4, (body * 3) / 4, body], names: ['', 'FRONT', 'BACK', 'OVERLAP'], color: GRID_COLORS.panels },
        zone(body * 0.8, c.h * 0.55, Math.min(inch(c, 1.5), body * 0.18), Math.min(inch(c, 1), c.h * 0.35), 'Barcode'),
        { kind: 'bleed', inset: [mm(c, 2), mm(c, 2), mm(c, 2), mm(c, 2)], label: 'BLEED', color: GRID_COLORS.bleed },
        { kind: 'safe', inset: [mm(c, 4), mm(c, 4), mm(c, 4), mm(c, 4)], label: 'SAFE', color: GRID_COLORS.safe },
      ];
    },
  },
  {
    id: 'pack-pouch',
    label: 'Stand-up pouch',
    category: 'Packaging',
    hint: 'Top seal and zipper, side seals and the bottom gusset',
    build: (c) => [
      zone(0, 0, c.w, mm(c, 12), 'Top seal'),
      zone(0, mm(c, 12), c.w, mm(c, 10), 'Zipper'),
      zone(0, c.h - mm(c, 38), c.w, mm(c, 38), 'Bottom gusset'),
      { kind: 'safe', inset: [mm(c, 30), mm(c, 10), mm(c, 45), mm(c, 10)], label: 'PRINT SAFE', color: GRID_COLORS.safe },
    ],
  },
  {
    id: 'pack-label',
    label: 'Product label',
    category: 'Packaging',
    hint: 'Bleed 1.5 mm, safe 3 mm, barcode and nutrition areas',
    build: (c) => [
      { kind: 'bleed', inset: [mm(c, 1.5), mm(c, 1.5), mm(c, 1.5), mm(c, 1.5)], label: 'BLEED', color: GRID_COLORS.bleed },
      { kind: 'safe', inset: [mm(c, 3), mm(c, 3), mm(c, 3), mm(c, 3)], label: 'SAFE', color: GRID_COLORS.safe },
      zone(c.w * 0.62, c.h * 0.8, c.w * 0.33, c.h * 0.15, 'Barcode'),
      center(),
    ],
  },
  {
    id: 'pack-round',
    label: 'Round sticker / lid',
    category: 'Packaging',
    hint: 'Concentric safe rings and a centre cross for circular labels',
    build: () => [{ kind: 'radial', count: 4, spokes: 8, color: GRID_COLORS.panels, snap: true }],
  },
  // ------------------------------------------------------------ Web & UI
  {
    id: 'web-desktop',
    label: 'Desktop 12 col (1440)',
    category: 'Web & UI',
    hint: '12 columns, 24 gutter, 80 margins, 8 pt square grid',
    build: (c) => [{ kind: 'columns', count: 12, gutter: ref(c, 24, 1440), margin: ref(c, 80, 1440), color: GRID_COLORS.columns }],
  },
  {
    id: 'web-container',
    label: 'Centred container 1320',
    category: 'Web & UI',
    hint: 'Fixed 12-column container centred on wide screens (Bootstrap XXL)',
    build: (c) => [{ kind: 'columns', count: 12, gutter: 24, align: 'center', size: Math.min((1320 - 11 * 24) / 12, (c.w - 11 * 24) / 12), color: GRID_COLORS.columns }],
  },
  {
    id: 'web-tablet',
    label: 'Tablet 8 col',
    category: 'Web & UI',
    hint: '8 columns, 24 gutter, 32 margins',
    build: () => [{ kind: 'columns', count: 8, gutter: 24, margin: 32, color: GRID_COLORS.columns }],
  },
  {
    id: 'web-mobile',
    label: 'Mobile 4 col',
    category: 'Web & UI',
    hint: '4 columns, 16 gutter, 16 margins',
    build: () => [{ kind: 'columns', count: 4, gutter: 16, margin: 16, color: GRID_COLORS.columns }],
  },
  {
    id: 'web-8pt',
    label: '8 pt grid + 4 pt baseline',
    category: 'Web & UI',
    hint: 'Spacing system: everything on multiples of 8, type on a 4 pt baseline',
    build: () => [
      { kind: 'square', size: 8, color: 'rgba(77,170,252,0.5)' },
      { kind: 'baseline', size: 4, color: 'rgba(46,160,67,0.35)', snap: false },
    ],
  },
  {
    id: 'web-icon',
    label: 'App icon keylines',
    category: 'Web & UI',
    hint: 'Keyline circle, square and safe padding for app and UI icons',
    build: (c) => {
      const s = Math.min(c.w, c.h);
      return [
        { kind: 'safe', inset: [s / 12, s / 12, s / 12, s / 12], label: 'KEYLINE', color: GRID_COLORS.safe },
        { kind: 'radial', count: 2, spokes: 0, color: GRID_COLORS.composition },
        { kind: 'diagonals', color: 'rgba(160,160,160,0.6)', snap: false },
        center(),
      ];
    },
  },
  // ------------------------------------------------------------ Composition
  { id: 'comp-thirds', label: 'Rule of thirds', category: 'Composition', hint: 'Place subjects on the lines and their crossings', build: () => [thirds()] },
  { id: 'comp-golden', label: 'Golden ratio (phi grid)', category: 'Composition', hint: 'Lines at 38.2% and 61.8%', build: () => [{ kind: 'golden', color: GRID_COLORS.composition }] },
  {
    id: 'comp-spiral',
    label: 'Golden spiral',
    category: 'Composition',
    hint: 'Fibonacci spiral — click again in the Grids panel to turn it',
    build: () => [{ kind: 'spiral', turn: 0, color: GRID_COLORS.composition }, { kind: 'golden', color: 'rgba(255,154,0,0.35)', snap: false }],
  },
  { id: 'comp-diagonals', label: 'Dynamic symmetry', category: 'Composition', hint: 'Diagonals and reciprocals (harmonic armature)', build: () => [{ kind: 'diagonals', color: GRID_COLORS.composition }] },
  { id: 'comp-center', label: 'Centre & quadrants', category: 'Composition', hint: 'Symmetric layouts and centred logos', build: () => [center()] },
  { id: 'comp-iso', label: 'Isometric grid', category: 'Composition', hint: '30° lines for isometric illustration and icons', build: (c) => [{ kind: 'isometric', size: Math.max(8, Math.round(Math.min(c.w, c.h) / 40)), color: 'rgba(77,170,252,0.55)' }] },
  { id: 'comp-dots', label: 'Dot grid', category: 'Composition', hint: 'Light dot grid for sketching and lettering', build: (c) => [{ kind: 'dots', size: Math.max(8, Math.round(Math.min(c.w, c.h) / 40)), color: 'rgba(160,160,160,0.9)' }] },
  { id: 'comp-radial', label: 'Radial / mandala', category: 'Composition', hint: 'Rings and 12 spokes for badges, seals and patterns', build: () => [{ kind: 'radial', count: 6, spokes: 12, color: GRID_COLORS.composition }] },
];

export function presetGrid(id: string) {
  return GRID_PRESETS.find((p) => p.id === id);
}

let gridSeq = 1;
export const gridId = () => `grid-${Date.now().toString(36)}-${(gridSeq++).toString(36)}`;

export function materialize(drafts: GridDraft[]): GridSpec[] {
  return drafts.map((d) => ({ visible: true, ...d, id: gridId() }));
}

// ---------------------------------------------------------------- auto grid

/** Print documents in this app are set up at 300 dpi; screen ones at 72. */
export function guessDpi(w: number, h: number): number {
  const big = Math.max(w, h) >= 1700;
  const r = Math.max(w, h) / Math.min(w, h);
  const paper = Math.abs(r - Math.SQRT2) < 0.02 || Math.abs(r - 11 / 8.5) < 0.02 || Math.abs(r - 1.75) < 0.02 || Math.abs(r - 1.5) < 0.01;
  return big && paper ? 300 : 72;
}

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / b < tol;

/** Slides in a carousel strip (2–10 square or 4:5 slides side by side), or 0. */
export function carouselSlides(w: number, h: number): number {
  // Only the heights platforms use for slides: a 16:10 screen is not a 2-slide carousel
  if (![1080, 1350, 1440].includes(Math.round(h))) return 0;
  for (const slide of [1, 4 / 5]) {
    const n = w / h / slide;
    if (n >= 1.9 && Math.abs(n - Math.round(n)) < 0.04 && Math.round(n) <= 10) return Math.round(n);
  }
  return 0;
}

/**
 * Picks grids for an artboard from its shape and size: vertical video gets platform safe zones,
 * paper sizes get bleed + margins + columns, a wide multi-slide strip gets carousel panels, and so on.
 */
export function autoGrid(w: number, h: number, dpi = guessDpi(w, h)): { presets: string[]; reason: string } {
  const r = w / h;
  if (near(r, 9 / 16)) return { presets: ['social-reel'], reason: `${w}×${h} is vertical video (9:16): Reel / TikTok safe zones and the 4:5 feed crop` };
  if (near(r, 4 / 5)) return { presets: ['social-portrait'], reason: `${w}×${h} is a 4:5 feed post: profile-grid crop, safe margin and thirds` };
  if (near(r, 1) && w <= 1600) return { presets: ['social-square'], reason: `${w}×${h} is square: thirds, safe margin and 6 columns` };
  if (near(r, 1)) return { presets: ['pack-round', 'comp-center'], reason: `${w}×${h} is a large square: rings and centre for stickers, lids and badges` };
  if (near(r, 16 / 9) && w <= 1280) return { presets: ['social-thumb'], reason: `${w}×${h} is a thumbnail: safe margin, duration corner and thirds` };
  if (near(r, 16 / 9)) return { presets: ['video-broadcast', 'comp-thirds'], reason: `${w}×${h} is a 16:9 frame: title / action safe, centre and thirds` };
  if (near(r, 2560 / 1440, 0.005) && w >= 2560) return { presets: ['social-yt-banner'], reason: `${w}×${h} is a channel banner: device-safe areas` };
  const slides = carouselSlides(w, h);
  if (slides) return { presets: ['social-carousel'], reason: `${w}×${h} holds ${slides} slides: carousel panels with a safe margin per slide` };
  if (r > 2.5) return { presets: ['social-banner'], reason: `${w}×${h} is a banner: safe area, profile-photo zone and thirds` };
  if (dpi >= 300) {
    if (r > 1.25 && near(r, 11 / 8.5)) return { presets: ['print-trifold'], reason: `${w}×${h} at ${dpi} dpi is a landscape letter sheet: tri-fold panels, bleed and safe` };
    return { presets: ['print-bleed', 'print-magazine'], reason: `${w}×${h} at ${dpi} dpi is a print page: 3 mm bleed, 5 mm safe, 12 columns and baseline` };
  }
  if (w >= 1200 && r > 1.3) return { presets: ['web-desktop'], reason: `${w}×${h} is a desktop screen: 12-column layout` };
  if (w <= 480 && r < 0.75) return { presets: ['web-mobile'], reason: `${w}×${h} is a phone screen: 4-column layout` };
  return { presets: ['comp-thirds', 'web-desktop'], reason: `${w}×${h}: thirds plus a 12-column grid` };
}

/** The grids Auto Grid would add to a w × h artboard. */
export function autoGridSpecs(w: number, h: number, dpi = guessDpi(w, h)): { specs: GridSpec[]; reason: string } {
  const a = autoGrid(w, h, dpi);
  const c = { w, h, dpi };
  return { specs: materialize(a.presets.flatMap((id) => presetGrid(id)?.build(c) ?? [])), reason: a.reason };
}

// ---------------------------------------------------------------- document grid

export interface DocGridPrefs {
  /** Major line spacing (document units). */
  size: number;
  subdivisions: number;
  style: 'lines' | 'dots';
  color: string;
  /** Super zoom: keep subdividing (and merging) so lines stay 8–80 px apart at any zoom. */
  adaptive: boolean;
  /** Snap objects and new points to the document grid. */
  snap: boolean;
  /** Snap to layout grid lines (columns, safe areas, panels …). */
  snapLayout: boolean;
  /** Draw layout grids. */
  showLayout: boolean;
}

export const DEFAULT_DOC_GRID: DocGridPrefs = { size: 100, subdivisions: 4, style: 'lines', color: '#4daafc', adaptive: true, snap: false, snapLayout: true, showLayout: true };

export interface GridLevel {
  step: number;
  /** 0..1 strength (finer levels fade in as they open up). */
  alpha: number;
}

/** Visible levels of the document grid at `zoom` (screen px per document unit), finest first. */
export function gridLevels(p: DocGridPrefs, zoom: number): GridLevel[] {
  const sub = Math.max(2, Math.round(p.subdivisions));
  const size = Math.max(1e-6, p.size);
  const MIN = 6;
  let steps: number[];
  if (p.adaptive) {
    // Every power of the subdivision around the major size, as many as the zoom asks for
    steps = [];
    let s = size;
    while (s * zoom > MIN * sub && s > 1e-6) s /= sub;
    while (s * zoom < MIN) s *= sub;
    for (let i = 0; i < 3; i++, s *= sub) steps.push(s);
  } else {
    steps = [size / sub, size].filter((s) => s * zoom >= 4);
  }
  return steps.map((step, i) => {
    const px = step * zoom;
    const fade = Math.max(0, Math.min(1, (px - MIN) / (MIN * 3)));
    return { step, alpha: i === 0 ? 0.22 * fade + 0.06 : Math.min(0.75, 0.3 + i * 0.18) };
  });
}

/** Spacing new points and moved objects snap to: the finest grid level you can see. */
export function snapStep(p: DocGridPrefs, zoom: number): number {
  const lv = gridLevels(p, zoom);
  return lv.length ? lv[0].step : p.size / Math.max(2, Math.round(p.subdivisions));
}

export function snapValue(v: number, step: number, origin = 0): number {
  return origin + Math.round((v - origin) / step) * step;
}

const PREFS_KEY = 'skill.docGrid';

export function loadDocGrid(): DocGridPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_DOC_GRID, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_DOC_GRID };
}

export function saveDocGrid(p: DocGridPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/** Snap lines (document space) of every visible, snapping grid on a box. */
export function gridSnapLines(specs: GridSpec[] | undefined, box: Box): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of specs ?? []) {
    if (!s.visible) continue;
    const g = gridGeometry(s, box.w, box.h);
    for (const x of g.snapX) xs.push(box.x + x);
    for (const y of g.snapY) ys.push(box.y + y);
  }
  return { xs, ys };
}

/** Pattern grids (square / baseline) a box snaps to by step. */
export function gridSnapSteps(specs: GridSpec[] | undefined, box: Box): { x?: { step: number; origin: number }; y?: { step: number; origin: number } } {
  const out: { x?: { step: number; origin: number }; y?: { step: number; origin: number } } = {};
  for (const s of specs ?? []) {
    if (!s.visible || s.snap === false) continue;
    const step = s.size ?? 8;
    if (s.kind === 'square') {
      out.x ??= { step, origin: box.x };
      out.y ??= { step, origin: box.y };
    } else if (s.kind === 'baseline') out.y ??= { step, origin: box.y + (s.offset ?? 0) };
  }
  return out;
}
