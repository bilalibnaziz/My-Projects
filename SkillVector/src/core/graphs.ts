/**
 * Graph tools: turns a data table into chart geometry (bars, lines, wedges, axes, labels).
 * Pure: no store or canvas. `graphOps.ts` turns the primitives into editable layers.
 */

export type GraphType = 'column' | 'stacked-column' | 'bar' | 'stacked-bar' | 'line' | 'area' | 'scatter' | 'pie' | 'radar';

export const GRAPH_TYPES: { id: GraphType; label: string }[] = [
  { id: 'column', label: 'Column' },
  { id: 'stacked-column', label: 'Stacked Column' },
  { id: 'bar', label: 'Bar' },
  { id: 'stacked-bar', label: 'Stacked Bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'pie', label: 'Pie' },
  { id: 'radar', label: 'Radar' },
];

/** What a graph group keeps, so its data can be edited and the graph rebuilt. */
export interface GraphSpec {
  type: GraphType;
  /** The table as typed: one row per line, cells split by tab, comma or semicolon. */
  data: string;
  legend: boolean;
  axis: boolean;
  colors?: string[];
}

export interface GraphData {
  labels: string[];
  series: { name: string; values: number[] }[];
}

export interface GraphAnchor {
  x: number;
  y: number;
  /** Incoming / outgoing Bézier handles (absent = corner). */
  ix?: number;
  iy?: number;
  ox?: number;
  oy?: number;
}

export type GraphRole = 'data' | 'axis' | 'grid' | 'label' | 'legend';

export type GraphPrim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; role: GraphRole; name: string }
  | { kind: 'path'; pts: GraphAnchor[]; closed: boolean; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; role: GraphRole; name: string }
  | { kind: 'text'; text: string; x: number; y: number; size: number; align: 'left' | 'center' | 'right'; color: string; role: GraphRole; name: string };

export const GRAPH_PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const TEXT = '#444444';
const AXIS = '#8a8a8a';
const GRID = '#dddddd';

export const SAMPLE_GRAPH_DATA = 'Quarter\tSales\tCosts\nQ1\t40\t24\nQ2\t75\t38\nQ3\t60\t41\nQ4\t95\t52';

const num = (s: string): number => {
  const t = s.replace(/[\s,$€£%]/g, '');
  return t === '' ? NaN : Number(t);
};

/** Parses a pasted table. A non-numeric first row is the series names, a non-numeric first column the labels. */
export function parseGraphData(text: string): GraphData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { labels: [], series: [] };
  const delim = text.includes('\t') ? '\t' : lines.some((l) => l.includes(';')) ? ';' : ',';
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  // Commas as the delimiter can't also be thousands separators
  const val = (s: string) => (delim === ',' ? num(s) : num(s.replace(/,/g, '.')));
  const width = Math.max(...rows.map((r) => r.length));
  const isText = (s: string | undefined) => s !== undefined && s !== '' && !Number.isFinite(val(s));
  const header = rows[0].slice(1).some(isText) || (rows.length > 1 && isText(rows[0][0]) && rows[0].slice(1).every((c) => c === '' || isText(c)));
  const body = header ? rows.slice(1) : rows;
  const hasLabels = body.some((r) => isText(r[0])) || (header && isText(rows[0][0]) && width > 1);
  const first = hasLabels ? 1 : 0;
  const series: GraphData['series'] = [];
  for (let c = first; c < width; c++) {
    series.push({
      name: (header ? rows[0][c] : '') || `Series ${c - first + 1}`,
      values: body.map((r) => {
        const v = val(r[c] ?? '');
        return Number.isFinite(v) ? v : 0;
      }),
    });
  }
  return { labels: body.map((r, i) => (hasLabels ? r[0] : String(i + 1))), series };
}

/** Rounded axis range and step that cover [lo, hi] in about `ticks` steps. */
export function niceScale(lo: number, hi: number, ticks = 5): { min: number; max: number; step: number } {
  if (!(hi > lo)) {
    hi = lo + (lo === 0 ? 1 : Math.abs(lo));
  }
  const raw = (hi - lo) / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const fix = (v: number) => Number(v.toFixed(10));
  return { min: fix(Math.floor(lo / step + 1e-9) * step), max: fix(Math.ceil(hi / step - 1e-9) * step), step };
}

const fmt = (v: number) => {
  const r = Number(v.toPrecision(6));
  return Math.abs(r) >= 10000 ? r.toLocaleString('en-US') : String(r);
};

const line = (pts: { x: number; y: number }[], stroke: string, strokeWidth: number, role: GraphRole, name: string): GraphPrim => ({
  kind: 'path',
  pts,
  closed: false,
  stroke,
  strokeWidth,
  role,
  name,
});

/** Closed wedge (or full disc) from angle a0 to a1, clockwise in screen space, as Bézier arcs. */
export function wedge(cx: number, cy: number, r: number, a0: number, a1: number): GraphAnchor[] {
  const span = a1 - a0;
  const full = span >= Math.PI * 2 - 1e-6;
  const n = Math.max(1, Math.ceil(span / (Math.PI / 2) - 1e-9));
  const d = span / n;
  const k = (4 / 3) * Math.tan(d / 4) * r;
  const at = (a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  const arc: GraphAnchor[] = [];
  for (let i = 0; i <= (full ? n - 1 : n); i++) {
    const a = a0 + i * d;
    const p = at(a);
    const tx = -Math.sin(a) * k;
    const ty = Math.cos(a) * k;
    arc.push({ ...p, ix: p.x - tx, iy: p.y - ty, ox: p.x + tx, oy: p.y + ty });
  }
  if (full) return arc;
  // The straight sides meet the arc at corners
  const s = arc[0];
  const e = arc[arc.length - 1];
  arc[0] = { x: s.x, y: s.y, ox: s.ox, oy: s.oy };
  arc[arc.length - 1] = { x: e.x, y: e.y, ix: e.ix, iy: e.iy };
  return [{ x: cx, y: cy }, ...arc];
}

/** Builds every primitive of a graph drawn into the box (x, y, w, h). */
export function buildGraph(spec: GraphSpec, box: { x: number; y: number; w: number; h: number }): GraphPrim[] {
  const data = parseGraphData(spec.data);
  const colors = spec.colors?.length ? spec.colors : GRAPH_PALETTE;
  const color = (i: number) => colors[i % colors.length];
  const out: GraphPrim[] = [];
  if (!data.series.length || !data.labels.length) return out;
  const fs = Math.max(8, Math.min(28, Math.round(Math.min(box.w, box.h) * 0.045)));
  const thin = Math.max(1, fs / 12);
  const text = (t: string, x: number, y: number, align: 'left' | 'center' | 'right', role: GraphRole = 'label', size = fs) =>
    out.push({ kind: 'text', text: t, x, y, size, align, color: TEXT, role, name: t });

  // Legend on the right: one swatch per series (per slice for a pie)
  const legendNames = spec.type === 'pie' ? data.labels : spec.type === 'scatter' ? scatterSeries(data).map((s) => s.name) : data.series.map((s) => s.name);
  let plotW = box.w;
  if (spec.legend && legendNames.length) {
    const lw = Math.min(box.w * 0.35, fs * (2 + Math.max(...legendNames.map((n) => n.length)) * 0.6));
    plotW = box.w - lw - fs;
    const lx = box.x + plotW + fs;
    legendNames.forEach((n, i) => {
      const ly = box.y + i * fs * 1.6;
      out.push({ kind: 'rect', x: lx, y: ly, w: fs, h: fs, fill: color(i), role: 'legend', name: `Legend ${n}` });
      text(n, lx + fs * 1.4, ly + fs * 0.5, 'left', 'legend');
    });
  }
  const plot = { x: box.x, y: box.y, w: Math.max(fs * 4, plotW), h: box.h };

  switch (spec.type) {
    case 'pie':
      pie(data, plot, fs, color, out, text);
      break;
    case 'radar':
      radar(data, plot, fs, thin, color, out, text, spec.axis);
      break;
    case 'scatter':
      scatter(data, plot, fs, thin, color, out, text, spec.axis);
      break;
    default:
      cartesian(spec.type, data, plot, fs, thin, color, out, text, spec.axis);
  }
  return out;
}

type TextFn = (t: string, x: number, y: number, align: 'left' | 'center' | 'right', role?: GraphRole, size?: number) => void;

function cartesian(
  type: GraphType,
  data: GraphData,
  plot: { x: number; y: number; w: number; h: number },
  fs: number,
  thin: number,
  color: (i: number) => string,
  out: GraphPrim[],
  text: TextFn,
  axis: boolean
) {
  const horizontal = type === 'bar' || type === 'stacked-bar';
  const stacked = type === 'stacked-column' || type === 'stacked-bar' || type === 'area';
  const n = data.labels.length;
  // Value range (stacks add positives and negatives separately)
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of data.series) {
        if (s.values[i] >= 0) pos += s.values[i];
        else neg += s.values[i];
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    } else {
      for (const s of data.series) {
        hi = Math.max(hi, s.values[i]);
        lo = Math.min(lo, s.values[i]);
      }
    }
  }
  const sc = niceScale(lo, hi);
  const longest = Math.max(...data.labels.map((l) => l.length));
  const valueW = Math.max(...[sc.min, sc.max].map((v) => fmt(v).length));
  // Room for the labels
  const left = axis ? fs * (horizontal ? Math.min(10, longest) * 0.6 + 1 : valueW * 0.6 + 1) : 0;
  const bottom = axis ? fs * 2 : 0;
  const top = fs * 0.5;
  const area = { x: plot.x + left, y: plot.y + top, w: Math.max(1, plot.w - left - fs * 0.5), h: Math.max(1, plot.h - bottom - top) };
  // Value → position along the value axis
  const vlen = horizontal ? area.w : area.h;
  const vpos = (v: number) => ((v - sc.min) / (sc.max - sc.min)) * vlen;
  const toXY = (cat: number, v: number) =>
    horizontal ? { x: area.x + vpos(v), y: area.y + cat } : { x: area.x + cat, y: area.y + area.h - vpos(v) };

  if (axis) {
    for (let v = sc.min; v <= sc.max + sc.step / 2; v += sc.step) {
      const tick = Number(v.toFixed(10));
      const a = toXY(0, tick);
      const b = toXY(horizontal ? area.h : area.w, tick);
      out.push(line([a, b], tick === 0 ? AXIS : GRID, thin, tick === 0 ? 'axis' : 'grid', `Gridline ${fmt(tick)}`));
      if (horizontal) text(fmt(tick), a.x, area.y + area.h + fs, 'center');
      else text(fmt(tick), area.x - fs * 0.4, a.y, 'right');
    }
    // Category axis line
    out.push(line(horizontal ? [{ x: area.x, y: area.y }, { x: area.x, y: area.y + area.h }] : [{ x: area.x, y: area.y + area.h }, { x: area.x + area.w, y: area.y + area.h }], AXIS, thin, 'axis', 'Category Axis'));
  }

  const clen = horizontal ? area.h : area.w;
  const band = clen / n;
  data.labels.forEach((l, i) => {
    if (!axis) return;
    const c = band * (i + 0.5);
    if (horizontal) text(l, area.x - fs * 0.4, area.y + c, 'right');
    else text(l, area.x + c, area.y + area.h + fs, 'center');
  });

  if (type === 'line' || type === 'area') {
    const m = data.series.length;
    const base = new Array<number>(n).fill(0);
    const ms = Math.max(3, fs * 0.45);
    data.series.forEach((s, si) => {
      const tops = s.values.map((v, i) => (type === 'area' ? base[i] + v : v));
      const pts = tops.map((v, i) => toXY(band * (i + 0.5), v));
      if (type === 'area') {
        const under = base.map((v, i) => toXY(band * (i + 0.5), v)).reverse();
        out.push({ kind: 'path', pts: [...pts, ...under], closed: true, fill: color(si), role: 'data', name: s.name });
        tops.forEach((v, i) => (base[i] = v));
      } else {
        out.push({ ...(line(pts, color(si), Math.max(1.5, fs * 0.15), 'data', s.name) as Extract<GraphPrim, { kind: 'path' }>) });
        pts.forEach((p, i) => out.push({ kind: 'rect', x: p.x - ms / 2, y: p.y - ms / 2, w: ms, h: ms, fill: color(si), role: 'data', name: `${s.name} · ${data.labels[i]}` }));
      }
    });
    void m;
    return;
  }

  // Columns and bars
  const m = data.series.length;
  const inner = band * 0.75;
  const bw = stacked ? inner : inner / m;
  for (let i = 0; i < n; i++) {
    let pos = 0;
    let neg = 0;
    data.series.forEach((s, si) => {
      const v = s.values[i];
      let from = 0;
      let to = v;
      if (stacked) {
        from = v >= 0 ? pos : neg;
        to = from + v;
        if (v >= 0) pos = to;
        else neg = to;
      }
      const c0 = band * i + (band - inner) / 2 + (stacked ? 0 : si * bw);
      const a = toXY(c0, from);
      const b = toXY(c0 + bw, to);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (w > 0 && h > 0) out.push({ kind: 'rect', x, y, w, h, fill: color(si), role: 'data', name: `${s.name} · ${data.labels[i]}` });
    });
  }
}

/** Scatter: columns pair up as (x, y) for each series. */
function scatterSeries(data: GraphData): { name: string; pts: { x: number; y: number }[] }[] {
  const out: { name: string; pts: { x: number; y: number }[] }[] = [];
  for (let c = 0; c + 1 < data.series.length; c += 2) {
    const xs = data.series[c].values;
    const ys = data.series[c + 1].values;
    out.push({ name: data.series[c + 1].name, pts: xs.map((x, i) => ({ x, y: ys[i] })) });
  }
  // A single column: plotted against the row number
  if (!out.length && data.series.length) out.push({ name: data.series[0].name, pts: data.series[0].values.map((y, i) => ({ x: i + 1, y })) });
  return out;
}

function scatter(
  data: GraphData,
  plot: { x: number; y: number; w: number; h: number },
  fs: number,
  thin: number,
  color: (i: number) => string,
  out: GraphPrim[],
  text: TextFn,
  axis: boolean
) {
  const series = scatterSeries(data);
  const all = series.flatMap((s) => s.pts);
  const sx = niceScale(Math.min(0, ...all.map((p) => p.x)), Math.max(...all.map((p) => p.x)));
  const sy = niceScale(Math.min(0, ...all.map((p) => p.y)), Math.max(...all.map((p) => p.y)));
  const left = axis ? fs * (Math.max(fmt(sy.min).length, fmt(sy.max).length) * 0.6 + 1) : 0;
  const bottom = axis ? fs * 2 : 0;
  const area = { x: plot.x + left, y: plot.y + fs * 0.5, w: Math.max(1, plot.w - left - fs * 0.5), h: Math.max(1, plot.h - bottom - fs * 0.5) };
  const X = (v: number) => area.x + ((v - sx.min) / (sx.max - sx.min)) * area.w;
  const Y = (v: number) => area.y + area.h - ((v - sy.min) / (sy.max - sy.min)) * area.h;
  if (axis) {
    for (let v = sy.min; v <= sy.max + sy.step / 2; v += sy.step) {
      const t = Number(v.toFixed(10));
      out.push(line([{ x: area.x, y: Y(t) }, { x: area.x + area.w, y: Y(t) }], t === sy.min ? AXIS : GRID, thin, t === sy.min ? 'axis' : 'grid', `Gridline ${fmt(t)}`));
      text(fmt(t), area.x - fs * 0.4, Y(t), 'right');
    }
    for (let v = sx.min; v <= sx.max + sx.step / 2; v += sx.step) {
      const t = Number(v.toFixed(10));
      out.push(line([{ x: X(t), y: area.y }, { x: X(t), y: area.y + area.h }], t === sx.min ? AXIS : GRID, thin, t === sx.min ? 'axis' : 'grid', `Gridline x ${fmt(t)}`));
      text(fmt(t), X(t), area.y + area.h + fs, 'center');
    }
  }
  const ms = Math.max(3, fs * 0.5);
  series.forEach((s, si) =>
    s.pts.forEach((p, i) => out.push({ kind: 'rect', x: X(p.x) - ms / 2, y: Y(p.y) - ms / 2, w: ms, h: ms, fill: color(si), role: 'data', name: `${s.name} ${i + 1}` }))
  );
}

function pie(data: GraphData, plot: { x: number; y: number; w: number; h: number }, fs: number, color: (i: number) => string, out: GraphPrim[], text: TextFn) {
  // One pie per series, side by side
  const m = data.series.length;
  const cellW = plot.w / m;
  const titled = m > 1;
  const r = Math.max(4, Math.min(cellW * 0.45, (plot.h - (titled ? fs * 2 : 0)) / 2));
  data.series.forEach((s, si) => {
    const cx = plot.x + cellW * (si + 0.5);
    const cy = plot.y + r;
    const vals = s.values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (v <= 0) return;
      const span = (v / total) * Math.PI * 2;
      out.push({ kind: 'path', pts: wedge(cx, cy, r, a, a + span), closed: true, fill: color(i), stroke: '#ffffff', strokeWidth: Math.max(1, fs / 10), role: 'data', name: `${s.name} · ${data.labels[i]}` });
      a += span;
    });
    if (titled) text(s.name, cx, cy + r + fs, 'center');
  });
}

function radar(
  data: GraphData,
  plot: { x: number; y: number; w: number; h: number },
  fs: number,
  thin: number,
  color: (i: number) => string,
  out: GraphPrim[],
  text: TextFn,
  axis: boolean
) {
  const n = data.labels.length;
  const hi = Math.max(0, ...data.series.flatMap((s) => s.values));
  const sc = niceScale(0, hi);
  const R = Math.max(4, Math.min(plot.w, plot.h) / 2 - fs * 2.2);
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const at = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const r = (Math.max(0, v) / sc.max) * R;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  if (axis) {
    for (let v = sc.step; v <= sc.max + sc.step / 2; v += sc.step) {
      const t = Number(v.toFixed(10));
      out.push({ kind: 'path', pts: data.labels.map((_, i) => at(i, t)), closed: true, stroke: GRID, strokeWidth: thin, role: 'grid', name: `Ring ${fmt(t)}` });
      text(fmt(t), cx + fs * 0.3, at(0, t).y, 'left', 'label', Math.max(7, fs * 0.8));
    }
    data.labels.forEach((l, i) => {
      out.push(line([{ x: cx, y: cy }, at(i, sc.max)], AXIS, thin, 'axis', `Spoke ${l}`));
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const lx = cx + (R + fs * 1.2) * Math.cos(a);
      const ly = cy + (R + fs * 1.2) * Math.sin(a);
      text(l, lx, ly, Math.abs(Math.cos(a)) < 0.2 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right');
    });
  }
  data.series.forEach((s, si) =>
    out.push({ kind: 'path', pts: s.values.map((v, i) => at(i, v)), closed: true, fill: color(si), stroke: color(si), strokeWidth: Math.max(1.5, fs * 0.12), opacity: 0.45, role: 'data', name: s.name })
  );
}
