/**
 * SVG import as editable vectors: paths (every command, arcs included), basic shapes, groups, <use>,
 * transforms, presentation attributes, inline styles and simple <style> rules (.class / #id / tag),
 * linear and radial gradients, text and embedded images. Everything lands in document space.
 */
import type { Layer, PathAnchor, ShapeGradient, ShapeProps } from '../types';
import { makeLayer, withLayer } from '../types';
import { splitAlpha } from '../gradientStops';

type M = [number, number, number, number, number, number];
type Pt = { x: number; y: number };
/** A document-space anchor: point plus absolute in / out handles. */
type A = { x: number; y: number; ix: number; iy: number; ox: number; oy: number };
type Sub = { pts: A[]; closed: boolean };

const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m: M, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
/** Average scale of a matrix (for stroke widths and font sizes). */
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
/** True when the matrix only scales and translates (axis-aligned shapes stay live shapes). */
const axisAligned = (m: M) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0;

const nums = (s: string | null | undefined): number[] => (s ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];

export function parseTransform(s: string | null): M {
  let m: M = ID;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let t: M = ID;
    switch (fn) {
      case 'matrix':
        if (a.length === 6) t = a as M;
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r), sn = Math.sin(r);
        const cx = a[1] ?? 0, cy = a[2] ?? 0;
        t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, t);
  }
  return m;
}

// ---------------------------------------------------------------- path data

const corner = (p: Pt): A => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y });

/** Cubic Béziers for an SVG elliptical arc (endpoint parameterisation, ≤ 90° per piece). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): [Pt, Pt, Pt][] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x2, y: y2 }]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= Math.PI * 2;
  if (sweep && dt < 0) dt += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const d = dt / n;
  const h = (4 / 3) * Math.tan(d / 4);
  const at = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const deriv = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: [Pt, Pt, Pt][] = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d, b = a + d;
    const p0 = at(a), p3 = at(b), d0 = deriv(a), d3 = deriv(b);
    out.push([{ x: p0.x + h * d0.x, y: p0.y + h * d0.y }, { x: p3.x - h * d3.x, y: p3.y - h * d3.y }, p3]);
  }
  return out;
}

/** Parses SVG path data into sub-paths of anchors (untransformed coordinates). */
export function parsePathData(d: string): Sub[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const subs: Sub[] = [];
  let cur: Sub | null = null;
  let i = 0, cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastC: Pt | null = null; // reflected control point for S / T
  let lastQ: Pt | null = null;
  const num = () => Number(toks[i++]);
  const flag = () => {
    // Arc flags may be packed without separators ("a1 1 0 011 1")
    const t = toks[i];
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.includes('.')) {
      toks[i] = t.slice(1);
      return t[0] === '1';
    }
    i++;
    return t === '1';
  };
  const start = (p: Pt) => {
    cur = { pts: [corner(p)], closed: false };
    subs.push(cur);
  };
  const last = () => cur!.pts[cur!.pts.length - 1];
  const cubic = (c1: Pt, c2: Pt, p: Pt) => {
    if (!cur) start({ x, y });
    const l = last();
    l.ox = c1.x;
    l.oy = c1.y;
    cur!.pts.push({ x: p.x, y: p.y, ix: c2.x, iy: c2.y, ox: p.x, oy: p.y });
  };
  const lineTo = (p: Pt) => {
    if (!cur) start({ x, y });
    cur!.pts.push(corner(p));
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = ox + num();
        y = oy + num();
        start({ x, y });
        sx = x;
        sy = y;
        // Further pairs are implicit line-tos
        cmd = rel ? 'l' : 'L';
        lastC = lastQ = null;
        break;
      }
      case 'L':
        x = ox + num();
        y = oy + num();
        lineTo({ x, y });
        lastC = lastQ = null;
        break;
      case 'H':
        x = ox + num();
        lineTo({ x, y });
        lastC = lastQ = null;
        break;
      case 'V':
        y = oy + num();
        lineTo({ x, y });
        lastC = lastQ = null;
        break;
      case 'C': {
        const c1 = { x: ox + num(), y: oy + num() };
        const c2 = { x: ox + num(), y: oy + num() };
        x = ox + num();
        y = oy + num();
        cubic(c1, c2, { x, y });
        lastC = c2;
        lastQ = null;
        break;
      }
      case 'S': {
        const c1 = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
        const c2 = { x: ox + num(), y: oy + num() };
        x = ox + num();
        y = oy + num();
        cubic(c1, c2, { x, y });
        lastC = c2;
        lastQ = null;
        break;
      }
      case 'Q':
      case 'T': {
        const q: Pt = cmd.toUpperCase() === 'Q' ? { x: ox + num(), y: oy + num() } : lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y };
        const p = { x: ox + num(), y: oy + num() };
        cubic({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
        x = p.x;
        y = p.y;
        lastQ = q;
        lastC = null;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num();
        const large = flag(), sweep = flag();
        const p = { x: ox + num(), y: oy + num() };
        for (const [c1, c2, e] of arcToCubics(x, y, rx, ry, (rot * Math.PI) / 180, large, sweep, p.x, p.y)) cubic(c1, c2, e);
        x = p.x;
        y = p.y;
        lastC = lastQ = null;
        break;
      }
      case 'Z':
        if (cur) {
          (cur as Sub).closed = true;
          const pts = (cur as Sub).pts;
          // A closing segment that ends on the start merges into the first anchor
          const f = pts[0], l = pts[pts.length - 1];
          if (pts.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) {
            f.ix = l.ix;
            f.iy = l.iy;
            pts.pop();
          }
        }
        x = sx;
        y = sy;
        cur = null;
        lastC = lastQ = null;
        break;
      default:
        i++;
    }
    if (Number.isNaN(x) || Number.isNaN(y)) break;
  }
  return subs.filter((s) => s.pts.length > 1 || s.closed);
}

// ---------------------------------------------------------------- styles

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
  magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00',
  navy: '#000080', purple: '#800080', teal: '#008080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082',
  violet: '#ee82ee', coral: '#ff7f50', salmon: '#fa8072', tomato: '#ff6347', crimson: '#dc143c', darkgray: '#a9a9a9', lightgray: '#d3d3d3',
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** A CSS colour as #rrggbb (or #rrggbbaa with `alpha` < 1); null for none / unknown. */
export function parseColor(v: string | undefined, alpha = 1): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  let rgb: [number, number, number] | null = null;
  let a = alpha;
  if (s === 'currentcolor') rgb = [0, 0, 0];
  else if (NAMED[s]) rgb = [parseInt(NAMED[s].slice(1, 3), 16), parseInt(NAMED[s].slice(3, 5), 16), parseInt(NAMED[s].slice(5, 7), 16)];
  else if (/^#[0-9a-f]{3,4}$/.test(s)) {
    rgb = [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
    if (s.length === 5) a *= parseInt(s[4] + s[4], 16) / 255;
  } else if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) {
    rgb = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    if (s.length === 9) a *= parseInt(s.slice(7, 9), 16) / 255;
  } else if (/^rgba?\(/.test(s)) {
    const n = nums(s);
    const pct = s.includes('%');
    rgb = [n[0], n[1], n[2]].map((c) => (pct ? (c * 255) / 100 : c)) as [number, number, number];
    if (n.length > 3) a *= n[3];
  }
  if (!rgb) return null;
  return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}${a < 0.999 ? hex2(a * 255) : ''}`;
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-rule', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'visibility', 'color'];
const OWN = ['opacity', 'display', 'transform'];

type Style = Record<string, string>;
type Rule = { sel: string; decl: Style };

const parseDecl = (s: string): Style =>
  Object.fromEntries(
    s
      .split(';')
      .map((d) => d.split(':'))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k.trim().toLowerCase(), v.join(':').trim()])
  );

/** Simple style sheet rules (.class, #id, tag, and comma lists of those). */
function parseRules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const [, sels, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decl = parseDecl(body);
    for (const sel of sels.split(',').map((x) => x.trim()).filter(Boolean)) out.push({ sel, decl });
  }
  return out;
}

const matches = (el: Element, sel: string) =>
  sel.startsWith('.') ? el.classList?.contains(sel.slice(1)) : sel.startsWith('#') ? el.getAttribute('id') === sel.slice(1) : el.tagName.toLowerCase() === sel.toLowerCase();

/** Own style of an element: presentation attributes, then sheet rules, then style="" (CSS precedence). */
function ownStyle(el: Element, rules: Rule[]): Style {
  const st: Style = {};
  for (const k of [...INHERITED, ...OWN]) {
    const v = el.getAttribute(k);
    if (v !== null) st[k] = v;
  }
  for (const r of rules) if (matches(el, r.sel)) Object.assign(st, r.decl);
  Object.assign(st, parseDecl(el.getAttribute('style') ?? ''));
  return st;
}

// ---------------------------------------------------------------- import

export interface SvgImport {
  width: number;
  height: number;
  layers: Layer[];
  /** Embedded / linked images to load (layers are placeholders until then). */
  images: { layerId: string; href: string }[];
}

const len = (v: string | null | undefined, ref: number) => {
  if (v == null || v === '') return NaN;
  const n = parseFloat(v);
  if (v.trim().endsWith('%')) return (n / 100) * ref;
  const unit = v.trim().replace(/^[-+\d.eE]+/, '');
  const k: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };
  return n * (k[unit] ?? 1);
};

/**
 * Imports SVG markup as layers in document space. Layers come back bottom first; groups are group
 * layers with their contents directly below them (as the rest of the app expects).
 */
export function importSvg(text: string): SvgImport {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = dom.querySelector('svg');
  if (!root || dom.querySelector('parsererror')) throw new Error('Not a valid SVG file');
  const vb = nums(root.getAttribute('viewBox'));
  let width = len(root.getAttribute('width'), vb[2] || 300);
  let height = len(root.getAttribute('height'), vb[3] || 150);
  if (!(width > 0)) width = vb.length === 4 ? vb[2] : 300;
  if (!(height > 0)) height = vb.length === 4 ? vb[3] : 150;
  // viewBox → document pixels (preserveAspectRatio xMidYMid meet)
  let rootM: M = ID;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const k = Math.min(width / vb[2], height / vb[3]);
    rootM = [k, 0, 0, k, (width - vb[2] * k) / 2 - vb[0] * k, (height - vb[3] * k) / 2 - vb[1] * k];
  }
  const rules = [...dom.querySelectorAll('style')].flatMap((s) => parseRules(s.textContent ?? ''));
  const byId = new Map<string, Element>();
  dom.querySelectorAll('[id]').forEach((el) => byId.set(el.getAttribute('id')!, el));
  const layers: Layer[] = [];
  const images: SvgImport['images'] = [];
  const nameOf = (el: Element, fallback: string) =>
    el.getAttribute('inkscape:label') ?? el.getAttribute('data-name') ?? el.getAttribute('id') ?? el.querySelector(':scope > title')?.textContent ?? fallback;

  const gradientFor = (ref: string, box: { x: number; y: number; w: number; h: number }, m: M, opacity: number): { fill: string; gradient?: ShapeGradient } | null => {
    const id = /url\(\s*['"]?#([^'")]+)/.exec(ref)?.[1];
    let g = id ? byId.get(id) : undefined;
    if (!g) return null;
    // Stops can come from a gradient this one links to
    let stopsEl: Element | undefined = g;
    for (let n = 0; stopsEl && !stopsEl.querySelector('stop') && n < 8; n++) {
      const href: string | null = stopsEl.getAttribute('href') ?? stopsEl.getAttribute('xlink:href');
      stopsEl = href ? byId.get(href.slice(1)) : undefined;
    }
    const stops = [...(stopsEl?.querySelectorAll('stop') ?? [])].map((s) => {
      const st = { ...Object.fromEntries([...s.attributes].map((a) => [a.name, a.value])), ...parseDecl(s.getAttribute('style') ?? '') } as Style;
      const off = st.offset?.trim().endsWith('%') ? parseFloat(st.offset) / 100 : parseFloat(st.offset ?? '0');
      return { offset: Math.max(0, Math.min(1, off || 0)), color: parseColor(st['stop-color'] ?? '#000000', parseFloat(st['stop-opacity'] ?? '1') * opacity) ?? '#00000000' };
    });
    if (!stops.length) return null;
    if (stops.length === 1) return { fill: stops[0].color };
    const user = g.getAttribute('gradientUnits') === 'userSpaceOnUse';
    const radial = g.tagName.toLowerCase().endsWith('radialgradient');
    const attr = (k: string, def: number) => {
      const v = g!.getAttribute(k);
      if (v == null) return def;
      return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
    };
    const gm = mul(m, parseTransform(g.getAttribute('gradientTransform')));
    // Endpoints in document space, then relative to the shape's box
    const toBox = (u: number, v: number) => {
      const p = user ? ap(gm, u, v) : { x: box.x + u * box.w, y: box.y + v * box.h };
      return { x: (p.x - box.x) / (box.w || 1), y: (p.y - box.y) / (box.h || 1) };
    };
    let a: Pt, b: Pt;
    if (radial) {
      const cx = attr('cx', user ? 0 : 0.5), cy = attr('cy', user ? 0 : 0.5), r = attr('r', user ? 0 : 0.5);
      a = toBox(cx, cy);
      b = toBox(cx + r, cy);
    } else {
      a = toBox(attr('x1', 0), attr('y1', 0));
      b = toBox(attr('x2', user ? 0 : 1), attr('y2', 0));
    }
    return { fill: stops[0].color, gradient: { type: radial ? 'radial' : 'linear', stops, x0: a.x, y0: a.y, x1: b.x, y1: b.y } as ShapeGradient };
  };

  /** Shape layer from transformed sub-paths, styled from `st`. */
  const pathLayer = (subs: Sub[], st: Style, m: M, name: string): Layer | null => {
    const doc = subs.map((s) => ({ closed: s.closed, pts: s.pts.map((a): A => {
      const p = ap(m, a.x, a.y), i = ap(m, a.ix, a.iy), o = ap(m, a.ox, a.oy);
      return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
    }) }));
    const all = doc.flatMap((s) => s.pts);
    if (!all.length) return null;
    const xs = all.flatMap((a) => [a.x, a.ix, a.ox]), ys = all.flatMap((a) => [a.y, a.iy, a.oy]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const W = Math.max(1e-3, Math.max(...xs) - minX), H = Math.max(1e-3, Math.max(...ys) - minY);
    const norm = (a: A): PathAnchor => {
      const curved = a.ix !== a.x || a.iy !== a.y || a.ox !== a.x || a.oy !== a.y;
      return { x: (a.x - minX) / W, y: (a.y - minY) / H, ix: (a.ix - minX) / W, iy: (a.iy - minY) / H, ox: (a.ox - minX) / W, oy: (a.oy - minY) / H, type: curved ? 'smooth' : 'corner' };
    };
    const pts = doc.map((s) => s.pts.map(norm));
    const shape = styledShape(st, m, { x: minX, y: minY, w: W, h: H });
    if (!shape) return null;
    return makeLayer({
      kind: 'shape',
      name,
      x: minX,
      y: minY,
      width: W,
      height: H,
      shape: { ...shape, shape: 'path', points: pts[0], compoundPoints: pts.length > 1 ? pts : undefined, closed: doc[0].closed },
    });
  };

  /** Fill / stroke settings from a resolved style; null when the element draws nothing. */
  const styledShape = (st: Style, m: M, box: { x: number; y: number; w: number; h: number }): Omit<ShapeProps, 'shape'> | null => {
    const fillOp = parseFloat(st['fill-opacity'] ?? '1');
    const strokeOp = parseFloat(st['stroke-opacity'] ?? '1');
    const fillRef = st.fill ?? '#000000';
    const grad = fillRef.startsWith('url(') ? gradientFor(fillRef, box, m, fillOp) : null;
    const fill = grad ? grad.fill : parseColor(fillRef === 'currentColor' ? st.color : fillRef, fillOp);
    const strokeRef = st.stroke;
    const strokeGrad = strokeRef?.startsWith('url(') ? gradientFor(strokeRef, box, m, strokeOp) : null;
    const stroke = strokeGrad ? strokeGrad.fill : parseColor(strokeRef === 'currentColor' ? st.color : strokeRef, strokeOp);
    const sw = stroke ? len(st['stroke-width'] ?? '1', 1) * scaleOf(m) : 0;
    if (!fill && !(stroke && sw > 0)) return null;
    const dash = st['stroke-dasharray'] && st['stroke-dasharray'] !== 'none' ? nums(st['stroke-dasharray']).map((d) => d * scaleOf(m)) : undefined;
    // Solid colours keep their alpha as the shape's fill / stroke opacity (editable in Appearance)
    const f = fill && !grad ? splitAlpha(fill) : null;
    const k = stroke && !strokeGrad ? splitAlpha(stroke) : null;
    return {
      fill: f ? f.hex : fill ?? '#000000',
      fillOpacity: f && f.a < 0.999 ? f.a : undefined,
      fillEnabled: !!fill,
      gradient: grad?.gradient,
      stroke: k ? k.hex : stroke ?? '#000000',
      strokeGradient: strokeGrad?.gradient,
      strokeOpacity: k && k.a < 0.999 ? k.a : undefined,
      strokeWidth: stroke ? sw : 0,
      radius: 0,
      strokeCap: (['butt', 'round', 'square'].includes(st['stroke-linecap']) ? st['stroke-linecap'] : 'butt') as ShapeProps['strokeCap'],
      strokeJoin: (['miter', 'round', 'bevel'].includes(st['stroke-linejoin']) ? st['stroke-linejoin'] : 'miter') as ShapeProps['strokeJoin'],
      strokeMiterLimit: st['stroke-miterlimit'] ? parseFloat(st['stroke-miterlimit']) : undefined,
      strokeDash: dash?.length ? dash : undefined,
    };
  };

  const ellipseSubs = (cx: number, cy: number, rx: number, ry: number): Sub[] => {
    const k = 0.5522847498;
    const p = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): A => ({ x, y, ix, iy, ox, oy });
    return [{ closed: true, pts: [
      p(cx + rx, cy, cx + rx, cy - k * ry, cx + rx, cy + k * ry),
      p(cx, cy + ry, cx + k * rx, cy + ry, cx - k * rx, cy + ry),
      p(cx - rx, cy, cx - rx, cy + k * ry, cx - rx, cy - k * ry),
      p(cx, cy - ry, cx - k * rx, cy - ry, cx + k * rx, cy - ry),
    ] }];
  };

  const walk = (el: Element, parentM: M, inherited: Style, parentId: string | undefined, parentOpacity: number, depth = 0) => {
    if (depth > 64) return;
    const tag = el.tagName.toLowerCase().replace(/^svg:/, '');
    if (['defs', 'clippath', 'mask', 'pattern', 'symbol', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata', 'filter', 'marker'].includes(tag)) return;
    const own = ownStyle(el, rules);
    if (own.display === 'none') return;
    const st: Style = { ...inherited };
    for (const k of INHERITED) if (own[k] !== undefined && own[k] !== 'inherit') st[k] = own[k];
    if (st.visibility === 'hidden') return;
    const m = mul(parentM, parseTransform(own.transform ?? el.getAttribute('transform')));
    const opacity = parseFloat(own.opacity ?? '1');
    const g = (k: string) => parseFloat(el.getAttribute(k) ?? '0') || 0;
    const add = (l: Layer | null) => {
      if (!l) return;
      layers.push(withLayer(l, { parent: parentId, opacity: opacity * (parentId ? 1 : parentOpacity) }));
    };
    switch (tag) {
      case 'svg':
      case 'g':
      case 'a':
      case 'switch': {
        // Nested <svg>: its own viewport offset
        const mm = tag === 'svg' && depth > 0 ? mul(m, [1, 0, 0, 1, g('x'), g('y')]) : m;
        const kids = [...el.children];
        if (tag === 'svg' && depth === 0) {
          for (const k of kids) walk(k, mm, st, parentId, opacity, depth + 1);
          return;
        }
        const group = makeLayer({ kind: 'group', name: nameOf(el, 'Group'), parent: parentId, opacity });
        const before = layers.length;
        for (const k of kids) walk(k, mm, st, group.id, 1, depth + 1);
        // Groups that end up empty are dropped; a group with one child is kept (it may carry a name)
        if (layers.length > before) layers.push(group);
        return;
      }
      case 'use': {
        const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
        const ref = href?.startsWith('#') ? byId.get(href.slice(1)) : undefined;
        if (!ref) return;
        const um = mul(m, [1, 0, 0, 1, g('x'), g('y')]);
        if (ref.tagName.toLowerCase() === 'symbol') {
          const group = makeLayer({ kind: 'group', name: nameOf(ref, 'Symbol'), parent: parentId, opacity });
          const before = layers.length;
          for (const k of [...ref.children]) walk(k, um, st, group.id, 1, depth + 1);
          if (layers.length > before) layers.push(group);
        } else walk(ref, um, st, parentId, opacity * parentOpacity, depth + 1);
        return;
      }
      case 'path':
        add(pathLayer(parsePathData(el.getAttribute('d') ?? ''), st, m, nameOf(el, 'Path')));
        return;
      case 'rect': {
        const w = len(el.getAttribute('width'), width), h = len(el.getAttribute('height'), height);
        if (!(w > 0 && h > 0)) return;
        const x = g('x'), y = g('y');
        let rx = len(el.getAttribute('rx'), w), ry = len(el.getAttribute('ry'), h);
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        if (axisAligned(m) && Math.abs(rx * m[0] - ry * m[3]) < 0.5) {
          // Stays a live (editable) rectangle
          const p = ap(m, x, y);
          const box = { x: p.x, y: p.y, w: w * m[0], h: h * m[3] };
          const shape = styledShape(st, m, box);
          if (shape) add(makeLayer({ kind: 'shape', name: nameOf(el, 'Rectangle'), x: box.x, y: box.y, width: box.w, height: box.h, shape: { ...shape, shape: rx > 0 ? 'round-rect' : 'rectangle', radius: rx * m[0] } }));
          return;
        }
        const k = 0.5522847498;
        const P = (px: number, py: number, ix = px, iy = py, ox = px, oy = py): A => ({ x: px, y: py, ix, iy, ox, oy });
        const pts: A[] = rx > 0
          ? [P(x + rx, y, x + rx - k * rx, y), P(x + w - rx, y, x + w - rx, y, x + w - rx + k * rx, y), P(x + w, y + ry, x + w, y + ry - k * ry), P(x + w, y + h - ry, x + w, y + h - ry, x + w, y + h - ry + k * ry), P(x + w - rx, y + h, x + w - rx + k * rx, y + h), P(x + rx, y + h, x + rx, y + h, x + rx - k * rx, y + h), P(x, y + h - ry, x, y + h - ry + k * ry), P(x, y + ry, x, y + ry, x, y + ry - k * ry)]
          : [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
        add(pathLayer([{ pts, closed: true }], st, m, nameOf(el, 'Rectangle')));
        return;
      }
      case 'circle':
      case 'ellipse': {
        const cx = g('cx'), cy = g('cy');
        const rx = tag === 'circle' ? g('r') : len(el.getAttribute('rx'), width);
        const ry = tag === 'circle' ? g('r') : len(el.getAttribute('ry'), height);
        if (!(rx > 0 && ry > 0)) return;
        if (axisAligned(m)) {
          const p = ap(m, cx - rx, cy - ry);
          const box = { x: p.x, y: p.y, w: 2 * rx * m[0], h: 2 * ry * m[3] };
          const shape = styledShape(st, m, box);
          if (shape) add(makeLayer({ kind: 'shape', name: nameOf(el, tag === 'circle' ? 'Circle' : 'Ellipse'), x: box.x, y: box.y, width: box.w, height: box.h, shape: { ...shape, shape: 'ellipse' } }));
          return;
        }
        add(pathLayer(ellipseSubs(cx, cy, rx, ry), st, m, nameOf(el, 'Ellipse')));
        return;
      }
      case 'line':
        add(pathLayer([{ closed: false, pts: [corner({ x: g('x1'), y: g('y1') }), corner({ x: g('x2'), y: g('y2') })] }], { ...st, fill: 'none' }, m, nameOf(el, 'Line')));
        return;
      case 'polyline':
      case 'polygon': {
        const n = nums(el.getAttribute('points'));
        const pts: A[] = [];
        for (let i = 0; i + 1 < n.length; i += 2) pts.push(corner({ x: n[i], y: n[i + 1] }));
        if (pts.length >= 2) add(pathLayer([{ pts, closed: tag === 'polygon' }], st, m, nameOf(el, tag === 'polygon' ? 'Polygon' : 'Polyline')));
        return;
      }
      case 'text': {
        const content = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!content) return;
        const firstSpan = el.querySelector('tspan');
        const x = el.hasAttribute('x') ? nums(el.getAttribute('x'))[0] : firstSpan ? nums(firstSpan.getAttribute('x'))[0] || 0 : 0;
        const y = el.hasAttribute('y') ? nums(el.getAttribute('y'))[0] : firstSpan ? nums(firstSpan.getAttribute('y'))[0] || 0 : 0;
        const size = len(st['font-size'] ?? '16', 16) * scaleOf(m);
        const p = ap(m, x, y);
        const anchor = st['text-anchor'];
        const color = parseColor(st.fill ?? '#000000', parseFloat(st['fill-opacity'] ?? '1')) ?? '#000000';
        const weight = st['font-weight'] === 'bold' ? 700 : parseInt(st['font-weight'] ?? '400', 10) || 400;
        add(makeLayer({
          kind: 'text',
          name: content.slice(0, 40),
          x: p.x,
          // SVG places the baseline; text layers start at the top of the line
          y: p.y - size * 0.9,
          width: content.length * size * 0.55,
          height: size * 1.2,
          text: {
            text: content,
            font: (st['font-family'] ?? 'Inter').split(',')[0].replace(/['"]/g, '').trim() || 'Inter',
            size,
            weight,
            italic: st['font-style'] === 'italic',
            color,
            align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
            lineHeight: 1.2,
            tracking: 0,
            shadow: false,
            stroke: 0,
            strokeColor: '#000000',
          },
        }));
        return;
      }
      case 'image': {
        const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
        const w = len(el.getAttribute('width'), width), h = len(el.getAttribute('height'), height);
        if (!href || !(w > 0 && h > 0)) return;
        const p = ap(m, g('x'), g('y'));
        const l = makeLayer({ kind: 'raster', name: nameOf(el, 'Image'), x: Math.round(p.x), y: Math.round(p.y), width: Math.max(1, Math.round(w * m[0])), height: Math.max(1, Math.round(h * m[3])) });
        add(l);
        images.push({ layerId: l.id, href });
        return;
      }
    }
  };
  walk(root, rootM, {}, undefined, 1);
  return { width: Math.round(width), height: Math.round(height), layers, images };
}
