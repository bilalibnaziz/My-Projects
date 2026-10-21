// Live shape controls for the Properties panel (shared design with Skill Vector's ToolContext.tsx):
// per-corner radii, corner styles, star / polygon points, pies and donuts, line arrows, presets.
import { Link2, Link2Off, Square, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Maximize2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId, ToolOptions } from '../core/store';
import type { Layer, ShapeProps, ShapeType } from '../core/types';
import { resizeSelectionTo, rotateSelectionBy } from '../core/objectTransform';
import * as ops from '../core/ops';
import {
  CORNER_STYLES, DEFAULT_SPIRAL_TURNS, DEFAULT_STAR_INNER, cornerRadii, polyVertices, rectRing, roundVertices, spiralRing,
} from '../core/shapeGeometry';
import type { CornerStyle } from '../core/shapeGeometry';
import { COMMANDS } from '../core/commands';
import { frameVisible } from '../core/objectTransform';
import { convertToEditablePath } from '../core/vectorOps';
import { IconButton, NumberField, ScrubBlock, Select, Slider, Toggle } from './widgets';

// ---------------------------------------------------------------- shape target

const sameKind = (a: ShapeType, b: ShapeType) => {
  const g = (s: ShapeType) => (s === 'round-rect' ? 'rectangle' : s === 'arrow' ? 'line' : s);
  return g(a) === g(b);
};

/** Live (unconverted) shape layer that the shape controls edit, if any. */
function liveShape(l: Layer | null | undefined): Layer | null {
  return l && l.kind === 'shape' && l.shape && l.shape.shape !== 'path' && !l.shape.points ? l : null;
}

export interface ShapeTarget {
  /** Shape kind being edited or set up. */
  type: ShapeType;
  /** The selected shape being edited live, or null when the controls set up the next shape. */
  layer: Layer | null;
  /** Current values (the layer's, or the next-shape defaults). */
  cur: ShapeProps;
  apply: (patch: Partial<ShapeProps>, label: string) => void;
}

/**
 * What shape controls work on. A shape tool edits a selected shape of its own kind; otherwise it sets up
 * the next shape it draws. Selection tools edit whatever shape is selected.
 */
export function shapeTarget(t: ToolId): ShapeTarget | null {
  const o = store.state.opts;
  const sel = liveShape(store.activeLayer);
  const toolType: ShapeType | null = t === 'shape' ? o.shapeType : null;
  const layer = sel && (!toolType || t === 'shape' || sameKind(toolType, sel.shape!.shape)) ? sel : null;
  if (!layer && !toolType) return null;
  const type = layer ? layer.shape!.shape : toolType!;
  const cur: ShapeProps = layer
    ? layer.shape!
    : {
        shape: type, fill: store.state.fg, fillEnabled: o.shapeFill, stroke: o.shapeStrokeColor, strokeWidth: o.shapeStrokeWidth,
        radius: type === 'round-rect' ? o.shapeRadius || 24 : o.shapeRadius, sides: o.shapeSides, ...(o.shapeExtras ?? {}),
      };
  const apply = (patch: Partial<ShapeProps>, label: string) => {
    if (layer) store.updateLayer(layer.id, { shape: { ...layer.shape!, ...patch } }, label, `live:${layer.id}:${label}`);
    // The next shape remembers the last settings
    const defaults: Partial<ToolOptions> = {};
    const extras: Partial<ShapeProps> = { ...(store.state.opts.shapeExtras ?? {}) };
    for (const [k, v] of Object.entries(patch) as [keyof ShapeProps, unknown][]) {
      if (k === 'radius') defaults.shapeRadius = v as number;
      else if (k === 'sides') defaults.shapeSides = v as number;
      else if (v === undefined) delete extras[k];
      else (extras as Record<string, unknown>)[k] = v;
    }
    store.setOpts({ ...defaults, shapeExtras: extras });
  };
  return { type, layer, cur, apply };
}

// ---------------------------------------------------------------- previews

const f2 = (v: number) => Math.round(v * 100) / 100;

function ringD(ring: { x: number; y: number; ix: number; iy: number; ox: number; oy: number }[], closed: boolean, s: number, dx = 0, dy = 0): string {
  if (!ring.length) return '';
  const P = (x: number, y: number) => `${f2(dx + x * s)} ${f2(dy + y * s)}`;
  let d = `M${P(ring[0].x, ring[0].y)}`;
  const n = closed ? ring.length + 1 : ring.length;
  for (let i = 1; i < n; i++) {
    const a = ring[i % ring.length];
    const p = ring[i - 1];
    d += `C${P(p.ox, p.oy)} ${P(a.ix, a.iy)} ${P(a.x, a.y)}`;
  }
  return closed ? d + 'Z' : d;
}

/** Small live preview of the shape being set up. */
function ShapePreview({ t }: { t: ShapeTarget }) {
  const W = 84;
  const H = 60;
  const ref = t.layer ? { w: Math.abs(t.layer.width) || 1, h: Math.abs(t.layer.height) || 1 } : { w: 200, h: t.type === 'rectangle' || t.type === 'round-rect' ? 140 : 200 };
  const s = Math.min((W - 8) / ref.w, (H - 8) / ref.h);
  const dx = (W - ref.w * s) / 2;
  const dy = (H - ref.h * s) / 2;
  let d = '';
  const c = t.cur;
  if (t.type === 'rectangle' || t.type === 'round-rect') d = ringD(rectRing(ref.w, ref.h, cornerRadii(c), c.cornerStyle ?? 'round'), true, s, dx, dy);
  else if (t.type === 'polygon' || t.type === 'star') d = ringD(roundVertices(polyVertices(c, ref.w, ref.h), c.pointRadius ?? 0), true, s, dx, dy);
  else if (t.type === 'spiral') d = ringD(spiralRing(c.turns ?? DEFAULT_SPIRAL_TURNS, ref.w, ref.h), false, s, dx, dy);
  else if (t.type === 'ellipse') {
    const cx = W / 2;
    const cy = H / 2;
    const rx = (ref.w * s) / 2;
    const ry = (ref.h * s) / 2;
    const a0 = ((c.pieStart ?? 0) * Math.PI) / 180;
    let a1 = ((c.pieEnd ?? 360) * Math.PI) / 180;
    if (a1 <= a0) a1 += Math.PI * 2;
    const hole = c.hole ?? 0;
    const pt = (a: number, k: number) => `${f2(cx + rx * k * Math.cos(a))} ${f2(cy + ry * k * Math.sin(a))}`;
    const full = a1 - a0 >= Math.PI * 2 - 1e-6;
    if (full) {
      d = `M${pt(0, 1)}A${f2(rx)} ${f2(ry)} 0 1 1 ${pt(Math.PI, 1)}A${f2(rx)} ${f2(ry)} 0 1 1 ${pt(0, 1)}Z`;
      if (hole > 0) d += `M${pt(0, hole)}A${f2(rx * hole)} ${f2(ry * hole)} 0 1 0 ${pt(Math.PI, hole)}A${f2(rx * hole)} ${f2(ry * hole)} 0 1 0 ${pt(0, hole)}Z`;
    } else {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      d = `M${pt(a0, 1)}A${f2(rx)} ${f2(ry)} 0 ${large} 1 ${pt(a1, 1)}`;
      d += hole > 0 ? `L${pt(a1, hole)}A${f2(rx * hole)} ${f2(ry * hole)} 0 ${large} 0 ${pt(a0, hole)}Z` : `L${f2(cx)} ${f2(cy)}Z`;
    }
  }
  if (!d) return null;
  const open = t.type === 'spiral';
  return (
    <svg className="shape-preview" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <path d={d} fillRule="evenodd" fill={open ? 'none' : 'var(--accent-soft, rgba(0,120,212,.22))'} stroke="var(--accent, #0078d4)" strokeWidth={1.5} />
    </svg>
  );
}

const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];

/** Rounded-corner glyph turned to face its corner (0 top-left, clockwise). */
function CornerIcon({ i }: { i: number }) {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden style={{ transform: `rotate(${i * 90}deg)` }}>
      <path d="M2 11V7a5 5 0 0 1 5-5h4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

/** Tiny glyph for a corner style button. */
function CornerGlyph({ style }: { style: CornerStyle }) {
  const d = ringD(rectRing(14, 14, [6, 6, 6, 6], style), true, 1, 1, 1);
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}

// ---------------------------------------------------------------- per-shape controls

type Preset = { label: string; title?: string; patch: (ref: number) => Partial<ShapeProps> };

function Presets({ items, t }: { items: Preset[]; t: ShapeTarget }) {
  const ref = t.layer ? Math.min(Math.abs(t.layer.width), Math.abs(t.layer.height)) : 160;
  return (
    <div className="shape-presets">
      {items.map((p) => (
        <button key={p.label} className="preset-chip" title={p.title ?? p.label} onClick={() => t.apply(p.patch(ref), `Shape · ${p.label}`)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

const R = (k: number) => (ref: number) => Math.round(ref * k);
const RECT_PRESETS: Preset[] = [
  { label: 'Sharp', patch: () => ({ radius: 0, radii: undefined, cornerStyle: 'round' }) },
  { label: 'Soft', patch: (r) => ({ radius: R(0.06)(r), radii: undefined, cornerStyle: 'round' }) },
  { label: 'Card', patch: (r) => ({ radius: R(0.12)(r), radii: undefined, cornerStyle: 'smooth' }), title: 'Smooth 12% corners, like app cards' },
  { label: 'Pill', patch: (r) => ({ radius: Math.ceil(r / 2), radii: undefined, cornerStyle: 'round' }) },
  { label: 'Tab', patch: (r) => ({ radii: [R(0.18)(r), R(0.18)(r), 0, 0], cornerStyle: 'round' }), title: 'Top corners only' },
  { label: 'Leaf', patch: (r) => ({ radii: [R(0.45)(r), 0, R(0.45)(r), 0], cornerStyle: 'round' }), title: 'Opposite corners' },
  { label: 'Bubble', patch: (r) => ({ radii: [R(0.2)(r), R(0.2)(r), R(0.2)(r), 0], cornerStyle: 'round' }), title: 'Speech bubble / chat corner' },
  { label: 'Ticket', patch: (r) => ({ radius: R(0.12)(r), radii: undefined, cornerStyle: 'scoop' }) },
  { label: 'Badge', patch: (r) => ({ radius: R(0.16)(r), radii: undefined, cornerStyle: 'chamfer' }) },
];

function RectControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  const c = t.cur;
  const radii = cornerRadii(c);
  const linked = !c.radii;
  const style = c.cornerStyle ?? 'round';
  const max = t.layer ? Math.max(1, Math.ceil(Math.min(Math.abs(t.layer.width), Math.abs(t.layer.height)) / 2)) : 500;
  const setAll = (v: number) => t.apply({ radius: v, radii: undefined }, 'Corner Radius');
  const setOne = (i: number, v: number) => {
    const next = [...radii] as [number, number, number, number];
    next[i] = v;
    t.apply({ radii: next }, 'Corner Radius');
  };
  const toggleLink = () => (linked ? t.apply({ radii: [...radii] as [number, number, number, number] }, 'Unlink Corners') : t.apply({ radius: radii[0], radii: undefined }, 'Link Corners'));
  const link = (
    <IconButton
      icon={linked ? <Link2 size={13} /> : <Link2Off size={13} />}
      title={linked ? 'All corners together — click to set each corner on its own' : 'Each corner on its own — click to link them'}
      active={linked}
      onClick={toggleLink}
    />
  );
  const styleSel = (
    <span className="seg compact corner-styles" role="radiogroup" aria-label="Corner style">
      {CORNER_STYLES.map((cs) => (
        <button key={cs.id} role="radio" aria-checked={style === cs.id} className={style === cs.id ? 'active' : ''} title={`${cs.label} — ${cs.hint}`} onClick={() => t.apply({ cornerStyle: cs.id }, 'Corner Style')}>
          <CornerGlyph style={cs.id} />
        </button>
      ))}
    </span>
  );
  if (bar) {
    return (
      <>
        {linked ? (
          <NumberField label="Corners" value={radii[0]} min={0} max={max} unit="px" onChange={setAll} />
        ) : (
          radii.map((r, i) => <NumberField key={i} label={['↖', '↗', '↘', '↙'][i]} value={r} min={0} max={max} width={34} onChange={(v) => setOne(i, v)} />)
        )}
        {link}
        {styleSel}
      </>
    );
  }
  const avg = Math.round(radii.reduce((a, b) => a + b, 0) / 4);
  const block = (i: number) => (
    <ScrubBlock
      key={i}
      className={`corner-${i}`}
      icon={<CornerIcon i={i} />}
      value={Math.min(radii[i], max)}
      min={0}
      max={max}
      title={`${CORNER_NAMES[i]} corner`}
      active={radii[i] > 0}
      onChange={(v) => setOne(i, v)}
    />
  );
  return (
    <>
      <div className="corner-blocks">
        {block(0)}
        <div className="corner-blocks-preview">
          <ShapePreview t={t} />
        </div>
        {block(1)}
        {block(3)}
        {block(2)}
      </div>
      <div className="prop-row">
        <ScrubBlock
          className="all-corners"
          label={linked ? 'All corners' : 'All · mixed'}
          value={linked ? Math.min(radii[0], max) : avg}
          min={0}
          max={max}
          title="All four corners"
          active={radii.some((r) => r > 0)}
          onChange={setAll}
        />
      </div>
      <div className="prop-row">
        <span className="prop-label">Corners</span>
        {styleSel}
      </div>
      <Presets items={RECT_PRESETS} t={t} />
    </>
  );
}

const STAR_PRESETS: Preset[] = [
  { label: 'Classic', patch: () => ({ sides: 5, innerRatio: 0.45, pointRadius: 0 }) },
  { label: 'Sparkle', patch: () => ({ sides: 4, innerRatio: 0.2, pointRadius: 0 }) },
  { label: 'Burst', patch: () => ({ sides: 14, innerRatio: 0.72, pointRadius: 0 }), title: 'Sale / price burst' },
  { label: 'Seal', patch: (r) => ({ sides: 24, innerRatio: 0.88, pointRadius: Math.max(1, Math.round(r * 0.02)) }), title: 'Quality seal / badge edge' },
  { label: 'Flower', patch: (r) => ({ sides: 6, innerRatio: 0.55, pointRadius: Math.round(r * 0.12) }) },
  { label: 'Soft star', patch: (r) => ({ sides: 5, innerRatio: 0.5, pointRadius: Math.round(r * 0.05) }) },
];
const POLY_PRESETS: Preset[] = [
  { label: 'Triangle', patch: () => ({ sides: 3 }) },
  { label: 'Diamond', patch: () => ({ sides: 4 }) },
  { label: 'Pentagon', patch: () => ({ sides: 5 }) },
  { label: 'Hexagon', patch: () => ({ sides: 6 }) },
  { label: 'Octagon', patch: () => ({ sides: 8 }) },
  { label: 'Rounded', patch: (r) => ({ pointRadius: Math.round(r * 0.08) }) },
];

function PolyControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  const c = t.cur;
  const star = t.type === 'star';
  const sides = c.sides ?? (star ? 5 : 6);
  const inner = Math.round((c.innerRatio ?? DEFAULT_STAR_INNER) * 100);
  const round = c.pointRadius ?? 0;
  if (bar) {
    return (
      <>
        <NumberField label={star ? 'Points' : 'Sides'} value={sides} min={3} max={star ? 60 : 64} onChange={(v) => t.apply({ sides: v }, 'Sides')} />
        {star && <NumberField label="Inner" value={inner} min={2} max={98} unit="%" onChange={(v) => t.apply({ innerRatio: v / 100 }, 'Star Inner Radius')} />}
        <NumberField label="Round" value={round} min={0} max={1000} unit="px" onChange={(v) => t.apply({ pointRadius: v }, 'Round Points')} />
      </>
    );
  }
  return (
    <>
      <div className="corner-editor single">
        <ShapePreview t={t} />
      </div>
      <Slider label={star ? 'Points' : 'Sides'} value={sides} min={3} max={star ? 60 : 24} onChange={(v) => t.apply({ sides: v }, 'Sides')} />
      {star && <Slider label="Inner radius" value={inner} min={2} max={98} def={45} unit="%" onChange={(v) => t.apply({ innerRatio: v / 100 }, 'Star Inner Radius')} />}
      <Slider label="Round points" value={round} min={0} max={200} def={0} unit="px" onChange={(v) => t.apply({ pointRadius: v }, 'Round Points')} />
      <Presets items={star ? STAR_PRESETS : POLY_PRESETS} t={t} />
    </>
  );
}

const ELLIPSE_PRESETS: Preset[] = [
  { label: 'Full', patch: () => ({ pieStart: undefined, pieEnd: undefined, hole: undefined }) },
  { label: 'Half', patch: () => ({ pieStart: 180, pieEnd: 360, hole: undefined }) },
  { label: 'Pie', patch: () => ({ pieStart: 30, pieEnd: 330, hole: undefined }) },
  { label: 'Quarter', patch: () => ({ pieStart: 270, pieEnd: 360, hole: undefined }) },
  { label: 'Donut', patch: () => ({ pieStart: undefined, pieEnd: undefined, hole: 0.55 }) },
  { label: 'Ring', patch: () => ({ pieStart: undefined, pieEnd: undefined, hole: 0.82 }) },
  { label: 'Gauge', patch: () => ({ pieStart: 135, pieEnd: 45, hole: 0.72 }), title: '270° progress gauge' },
];

function EllipseControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  const c = t.cur;
  const start = c.pieStart ?? 0;
  const end = c.pieEnd ?? 360;
  const hole = Math.round((c.hole ?? 0) * 100);
  const setHole = (v: number) => t.apply({ hole: v > 0 ? v / 100 : undefined }, 'Ellipse Hole');
  if (bar) {
    return (
      <>
        <NumberField label="Start" value={start} min={0} max={360} unit="°" width={38} onChange={(v) => t.apply({ pieStart: v }, 'Pie Start')} />
        <NumberField label="End" value={end} min={0} max={360} unit="°" width={38} onChange={(v) => t.apply({ pieEnd: v }, 'Pie End')} />
        <NumberField label="Hole" value={hole} min={0} max={95} unit="%" width={34} onChange={setHole} />
      </>
    );
  }
  return (
    <>
      <div className="corner-editor single">
        <ShapePreview t={t} />
      </div>
      <Slider label="Pie start" value={start} min={0} max={360} def={0} unit="°" onChange={(v) => t.apply({ pieStart: v }, 'Pie Start')} />
      <Slider label="Pie end" value={end} min={0} max={360} def={360} unit="°" onChange={(v) => t.apply({ pieEnd: v }, 'Pie End')} />
      <Slider label="Hole" value={hole} min={0} max={95} def={0} unit="%" onChange={setHole} />
      <Presets items={ELLIPSE_PRESETS} t={t} />
    </>
  );
}

function LineControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  const c = t.cur;
  const dash = c.strokeDash?.length ? (c.strokeDash[0] > 4 ? 'dashed' : 'dotted') : 'solid';
  const l = t.layer;
  const len = l ? Math.round(Math.hypot(l.width, l.height) * 10) / 10 : 0;
  const ang = l ? Math.round((Math.atan2(l.height, l.width) * 180) / Math.PI * 10) / 10 : 0;
  const setVec = (length: number, deg: number) => {
    if (!l) return;
    const a = (deg * Math.PI) / 180;
    store.updateLayer(l.id, { width: Math.round(length * Math.cos(a) * 100) / 100, height: Math.round(length * Math.sin(a) * 100) / 100 }, 'Line Length', `line:${l.id}`);
  };
  return (
    <>
      {l && t.type !== 'arc' && (
        <div className="prop-row">
          <NumberField label="Length" value={len} min={1} max={100000} unit="px" onChange={(v) => setVec(v, ang)} />
          <NumberField label="Angle" value={ang} min={-180} max={180} unit="°" onChange={(v) => setVec(len, v)} />
        </div>
      )}
      <div className={bar ? 'opt-group' : 'prop-row'}>
        <Toggle label="◀ Start arrow" checked={!!c.arrowStart} onChange={(v) => t.apply({ arrowStart: v }, 'Arrowheads')} />
        <Toggle label="End arrow ▶" checked={!!c.arrowEnd || c.shape === 'arrow'} onChange={(v) => t.apply({ arrowEnd: v }, 'Arrowheads')} />
        {!bar && <Select
          value={dash}
          title="Dash"
          onChange={(d) => t.apply({ strokeDash: d === 'dashed' ? [8, 5] : d === 'dotted' ? [2, 4] : [] }, 'Stroke Dash')}
          options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]}
        />}
      </div>
    </>
  );
}

function SpiralControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  const turns = t.cur.turns ?? DEFAULT_SPIRAL_TURNS;
  if (bar) return <NumberField label="Turns" value={turns} min={0.5} max={50} step={0.5} onChange={(v) => t.apply({ turns: v }, 'Spiral Turns')} />;
  return (
    <>
      <div className="corner-editor single">
        <ShapePreview t={t} />
      </div>
      <Slider label="Turns" value={turns} min={0.5} max={20} step={0.5} def={3.5} onChange={(v) => t.apply({ turns: v }, 'Spiral Turns')} />
    </>
  );
}

function GridControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  const n = t.cur.sides || 5;
  return bar ? (
    <NumberField label="Divisions" value={n} min={1} max={100} onChange={(v) => t.apply({ sides: v }, 'Grid Divisions')} />
  ) : (
    <Slider label="Divisions" value={n} min={1} max={40} onChange={(v) => t.apply({ sides: v }, 'Grid Divisions')} />
  );
}

/** The live geometry controls for one shape kind. `bar` = compact options-bar form. */
export function ShapeGeometryControls({ t, bar }: { t: ShapeTarget; bar?: boolean }) {
  switch (t.type) {
    case 'rectangle':
    case 'round-rect':
      return <RectControls t={t} bar={bar} />;
    case 'polygon':
    case 'star':
      return <PolyControls t={t} bar={bar} />;
    case 'ellipse':
      return <EllipseControls t={t} bar={bar} />;
    case 'line':
    case 'arrow':
    case 'arc':
      return <LineControls t={t} bar={bar} />;
    case 'spiral':
      return <SpiralControls t={t} bar={bar} />;
    case 'grid':
    case 'polar-grid':
      return <GridControls t={t} bar={bar} />;
    default:
      return null;
  }
}

const KIND_NAMES: Partial<Record<ShapeType, string>> = {
  rectangle: 'rectangle', 'round-rect': 'rounded rectangle', ellipse: 'ellipse', polygon: 'polygon', star: 'star', line: 'line', arrow: 'arrow',
  arc: 'arc', spiral: 'spiral', grid: 'grid', 'polar-grid': 'polar grid', triangle: 'triangle', flare: 'flare',
};

/** Shape section of the Properties panel. */
export function ShapeSection({ tool }: { tool: ToolId }) {
  useStore();
  const t = shapeTarget(tool);
  if (!t) return null;
  const name = KIND_NAMES[t.type] ?? 'shape';
  const geo = <ShapeGeometryControls t={t} />;
  const l = t.layer;
  return (
    <div className="panel-section shape-section">
      <div className="mini-title">
        {l ? `Selected ${name}` : `Next ${name}`}
        <span className={`mode-badge ${l ? 'live' : ''}`} title={l ? 'Changes apply to the selected shape right away' : 'Settings for the next shape you draw'}>
          {l ? 'Live' : 'Next'}
        </span>
      </div>
      {geo}
      {l && (
        <div className="prop-row">
          <IconButton icon={<Square size={13} />} title={`Make equal sides (${t.type === 'ellipse' ? 'perfect circle' : 'square box'})`} onClick={() => { const m = Math.min(Math.abs(l.width), Math.abs(l.height)); resizeSelectionTo(m, m, false); }} />
          <IconButton icon={<Maximize2 size={13} />} title="Swap width and height" onClick={() => resizeSelectionTo(Math.abs(l.height), Math.abs(l.width), false)} />
          <IconButton icon={<RotateCcw size={13} />} title="Rotate 15° counter-clockwise" onClick={() => rotateSelectionBy(-15)} />
          <IconButton icon={<RotateCw size={13} />} title="Rotate 15° clockwise" onClick={() => rotateSelectionBy(15)} />
          <IconButton icon={<FlipHorizontal2 size={13} />} title="Flip horizontal" onClick={() => ops.flipLayer('h')} />
          <IconButton icon={<FlipVertical2 size={13} />} title="Flip vertical" onClick={() => ops.flipLayer('v')} />
        </div>
      )}
      {!l && <div className="hint">Drag on the canvas to draw. Select a {name} to edit it here live.</div>}
    </div>
  );
}


// ---------------------------------------------------------------- next steps

const run = (id: string) => COMMANDS.find((c) => c.id === id);

/** One-click next steps that fit the current selection (Pathfinder, Make Button, Outline Stroke…). */
export function SmartActions() {
  useStore();
  const sel = frameVisible() ? store.selectedLayers : [];
  if (!sel.length) return null;
  const shapes = sel.filter((l) => l.kind === 'shape' && l.shape);
  const one = sel.length === 1 ? sel[0] : null;
  const ids: string[] = [];
  if (shapes.length >= 2) ids.push('pathfinder-unite', 'pathfinder-minus', 'pathfinder-intersect', 'pathfinder-exclude', 'pathfinder-divide', 'make-compound');
  if (one?.kind === 'shape' && one.shape) {
    const isPath = one.shape.shape === 'path' || !!one.shape.points;
    if (isPath) ids.push('simplify-path');
    if (one.shape.strokeWidth > 0) ids.push('outline-stroke');
  }
  ids.push('make-button', 'release-button');
  if (sel.length >= 2) ids.push('group');
  if (one?.kind === 'group') ids.push('ungroup');
  if (shapes.length || sel.some((l) => l.kind === 'text')) ids.push('recolor');
  const cmds = ids.map(run).filter((c): c is NonNullable<typeof c> => !!c && (!c.enabled || c.enabled()));
  const convertible = one && liveShape(one);
  if (!cmds.length && !convertible) return null;
  return (
    <div className="panel-section">
      <div className="mini-title">Next steps</div>
      <div className="smart-actions">
        {cmds.map((c) => (
          <button key={c.id} className="btn ghost" onClick={() => c.run()} title={c.keys ? `${c.label} (${c.keys.replace('Mod', '⌘')})` : c.label}>
            {c.label.replace(/^Shape ▸ (Pathfinder: )?/, '').replace(/…$/, '')}
          </button>
        ))}
        {convertible && (
          <button className="btn ghost" onClick={() => convertSelected()} title="Turn the live shape into Bézier anchors you can edit point by point">
            Convert to Path
          </button>
        )}
      </div>
    </div>
  );
}

function convertSelected() {
  const doc = store.doc;
  const l = liveShape(store.activeLayer);
  if (!doc || !l) return;
  const conv = convertToEditablePath(l, true, true);
  store.commit('Convert to Path', { layers: doc.layers.map((x) => (x.id === l.id ? conv : x)) });
}
