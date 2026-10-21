// Tool-aware properties: what the Properties panel and options bar show follows the active tool and
// the selection. Shape tools edit the selected shape of their kind live, or set up the next one.

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Link2, Link2Off, Square, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Maximize2, Trash2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId, ToolOptions } from '../core/store';
import type { Layer, ShapeProps } from '../core/types';
import { applyTextStyle, getToolShapeType, isShapeTool, updateText } from '../core/tools';
import { COMMANDS } from '../core/commands';
import { resizeSelectionTo, rotateSelectionBy } from '../core/objectTransform';
import * as ops from '../core/ops';
import { convertToEditablePath } from '../core/vectorOps';
import {
  CORNER_STYLES, DEFAULT_SPIRAL_TURNS, DEFAULT_STAR_INNER, cornerRadii, polyVertices, rectRing, roundVertices, spiralRing,
} from '../core/shapeGeometry';
import type { CornerStyle } from '../core/shapeGeometry';
import { convertAnchor, deleteSelectedAnchor, moveAnchorTo, selectedAnchor, setAnchorCorner, setHandleLength, stepAnchor } from '../core/anchorEdit';
import type { AnchorKind } from '../core/anchorEdit';
import { ColorInput, IconButton, NumberField, ScrubBlock, Select, Slider, Toggle } from './widgets';
import { TOOLS } from './ToolRail';

type ShapeType = ShapeProps['shape'];

// ---------------------------------------------------------------- families & key tips

export type ToolFamily = 'select' | 'path' | 'shape' | 'type' | 'draw' | 'reshape' | 'cut' | 'color' | 'symbols' | 'graph' | 'layout' | 'navigate' | 'raster';

const FAMILY: Partial<Record<ToolId, ToolFamily>> = {
  'master-select': 'select', move: 'select', 'group-select': 'select', wand: 'select', lasso: 'select', 'perspective-select': 'select', 'live-paint-select': 'select',
  'direct-select': 'path', pen: 'path', 'add-anchor': 'path', 'delete-anchor': 'path', 'anchor-point': 'path', curvature: 'path', smooth: 'path', join: 'path', reshape: 'path',
  text: 'type', 'area-type': 'type', 'path-type': 'type', 'vertical-type': 'type', 'vertical-area-type': 'type', 'vertical-path-type': 'type', 'touch-type': 'type',
  brush: 'draw', 'blob-brush': 'draw', pencil: 'draw', shaper: 'draw',
  rotate: 'reshape', reflect: 'reshape', scale: 'reshape', shear: 'reshape', 'free-transform': 'reshape', 'puppet-warp': 'reshape', width: 'reshape',
  warp: 'reshape', twirl: 'reshape', pucker: 'reshape', bloat: 'reshape', scallop: 'reshape', crystallize: 'reshape', wrinkle: 'reshape',
  'shape-builder': 'cut', eraser: 'cut', scissors: 'cut', knife: 'cut', 'path-eraser': 'cut',
  mesh: 'color', gradient: 'color', eyedropper: 'color', blend: 'color', bucket: 'color', ruler: 'layout',
  slice: 'layout', 'slice-select': 'layout', artboard: 'layout', packaging: 'layout', 'print-tiling': 'layout', 'perspective-grid': 'layout',
  hand: 'navigate', zoom: 'navigate',
};

export function toolFamily(t: ToolId): ToolFamily {
  if (isShapeTool(t)) return t.startsWith('graph-') ? 'graph' : 'shape';
  if (t.startsWith('symbol-')) return 'symbols';
  return FAMILY[t] ?? 'raster';
}

const LIQUIFY = ['warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'];

/** Mouse + modifier gestures per tool (only ones the tool really handles). */
export function keyTips(t: ToolId): [string, string][] {
  const fam = toolFamily(t);
  if (fam === 'shape') {
    if (t === 'line') return [['Shift', '45° steps'], ['Drag', 'draw']];
    if (t === 'arc' || t === 'spiral') return [['Drag', 'draw'], ['Shift', 'constrain']];
    const base: [string, string][] = [['Shift', t === 'shape-ellipse' ? 'circle' : 'equal sides'], ['⌥', 'from centre'], ['Drag', 'draw']];
    if (t === 'shape-rect' || t === 'shape-round-rect') return [...base, ['Corner dots', 'drag in to round'], ['⌥ dot', 'one corner · click: style']];
    if (t === 'shape-polygon' || t === 'shape-star') return [...base, ['◆', 'drag up / down: sides'], ['Top dot', 'round points'], ...(t === 'shape-star' ? [['Inner dot', 'inner radius'] as [string, string]] : [])];
    if (t === 'shape-ellipse') return [...base, ['Rim dot', 'drag round: pie'], ['Inner dot', 'drag out: donut']];
    return base;
  }
  if (LIQUIFY.includes(t)) return [['Drag', 'over a shape to reshape'], ['[ ]', 'brush size']];
  if (t.startsWith('symbol-')) return t === 'symbol-sprayer' ? [['Drag', 'spray instances']] : [['Drag', 'over instances'], ['⌥', 'reverse the effect']];
  const tips: Partial<Record<ToolId, [string, string][]>> = {
    move: [['Shift', 'keep ratio · 15° turns'], ['⌥ drag', 'duplicate'], ['⌥ handle', 'scale from centre'], ['Shape dots', 'corners · sides · pie'], ['Dbl-click', 'edit points / text']],
    'direct-select': [['Click', 'pick anchor'], ['Drag handle', 'shape the curve'], ['⌥', 'break symmetry'], ['⌘J', 'join'], ['Panel', 'X / Y · corner / smooth']],
    pen: [['Click', 'corner'], ['Drag', 'curve'], ['Shift', '45°'], ['Click start', 'close'], ['Enter / Esc', 'finish']],
    curvature: [['Click', 'smooth point'], ['Dbl-click', 'corner']],
    'add-anchor': [['Click a path', 'add a point']],
    'delete-anchor': [['Click a point', 'remove it']],
    smooth: [['Click a path', 'smooth it']],
    join: [['Click', 'join the selected ends (⌘J)']],
    text: [['Click', 'point text'], ['Drag', 'text box'], ['⌘Enter / Esc', 'finish']],
    'area-type': [['Drag', 'text box that wraps'], ['Click text', 'edit it'], ['⌘Enter / Esc', 'finish']],
    'vertical-type': [['Click', 'vertical text'], ['Drag', 'vertical text box'], ['⌘Enter / Esc', 'finish']],
    'vertical-area-type': [['Drag', 'vertical text box'], ['Click text', 'edit it'], ['⌘Enter / Esc', 'finish']],
    'touch-type': [['Click text', 'edit it'], ['Drag', 'text box'], ['⌘Enter / Esc', 'finish']],
    'path-type': [['Click a path', 'type along it'], ['Click text', 'edit it']],
    'vertical-path-type': [['Click a path', 'type down along it'], ['Click text', 'edit it']],
    'master-select': [['Click', 'select an object'], ['Panel', 'scan text from images']],
    'group-select': [['Click', 'pick one object'], ['Click again', 'add its whole group']],
    wand: [['Click', 'pick similar colours'], ['Shift', 'add'], ['⌥', 'subtract']],
    lasso: [['Drag', 'draw a selection'], ['Shift', 'add'], ['⌥', 'subtract']],
    'anchor-point': [['Click an anchor', 'corner ⇄ smooth']],
    reshape: [['Drag a point', 'pull the path softly around it']],
    'perspective-select': [['Drag a shape', 'move it on the grid']],
    slice: [['Drag', 'new slice'], ['Then', 'File ▸ Export Slices']],
    'slice-select': [['Click a slice', 'select it'], ['Drag', 'move it']],
    packaging: [['Click', 'place the box dieline'], ['Bar', 'box type & size']],
    brush: [['Drag', 'paint a path'], ['⌥ click', 'pick colour'], ['[ ]', 'size']],
    'blob-brush': [['Drag', 'paint filled shapes'], ['[ ]', 'size']],
    pencil: [['Drag', 'draw'], ['Hold at the end', 'snap to a clean shape'], ['From a selected path', 'reshape / extend / close it'], ['End on the start', 'close the shape']],
    shaper: [['Scribble', 'a rough circle / box / triangle']],
    rotate: [['Click', 'open the transform box'], ['Shift', '15° steps'], ['Enter', 'apply']],
    scale: [['Click', 'open the transform box'], ['Shift', 'free ratio'], ['Enter', 'apply']],
    'free-transform': [['⌘ corner', 'distort'], ['⌘ edge', 'skew'], ['Enter', 'apply']],
    reflect: [['Click', 'flip horizontal'], ['⌥ click', 'flip vertical']],
    shear: [['Drag', 'slant the selection']],
    'puppet-warp': [['Click', 'add pin'], ['Drag pin', 'bend'], ['⌥ click', 'remove pin']],
    width: [['Drag from a stroke', 'set its width there'], ['Drag a point', 'resize it'], ['⌥ click point', 'delete it']],
    'shape-builder': [['Drag', 'merge regions'], ['⌥ drag', 'delete regions']],
    eraser: [['Drag', 'erase through shapes'], ['[ ]', 'size']],
    'path-eraser': [['Drag along a path', 'erase that part']],
    scissors: [['Click a path', 'cut it there']],
    knife: [['Drag across', 'slice a shape']],
    mesh: [['Click inside', 'add colour point'], ['Drag', 'move it'], ['⌥ click', 'remove']],
    gradient: [['Drag', 'linear gradient'], ['⌥ drag', 'radial'], ['Drag an end', 'move it (⇧ 45°)'], ['Drag a stop', 'move it · pull off to delete'], ['Click the line', 'add a stop']],
    eyedropper: [['Click', 'sample colour (nothing selected)'], ['Click object', 'copy its look to the selection'], ['⌥ click object', 'paint the selection’s look onto it'], ['⇧ click', 'colour into the selection’s fill']],
    blend: [['Click A, then B', 'blend between them']],
    bucket: [['Click', 'fill'], ['⌥ click', 'paint the stroke'], ['2+ shapes selected', 'paint one region']],
    'live-paint-select': [['Click', 'pick a region'], ['⇧ click', 'add / remove'], ['Dbl-click', 'same colour']],
    'print-tiling': [['Drag', 'move the pages'], ['Dbl-click', 'paper & export']],
    'symbol-sprayer': [['Drag', 'spray the chosen symbol'], ['⌥ drag', 'remove instances']],
    artboard: [['Drag', 'new artboard'], ['⌥ drag', 'move only the board']],
    'perspective-grid': [['Drag', 'adjust the grid'], ['Shift click', 'hide it']],
    hand: [['Space', 'pan from any tool']],
    zoom: [['Click', 'zoom in'], ['⌥ click', 'zoom out']],
    ruler: [['Drag', 'measure'], ['Shift', '45°']],
  };
  if (t.startsWith('graph-')) return [['Drag', 'graph box'], ['Click', '400 × 300 graph'], ['Then', 'type or paste the data']];
  return tips[t] ?? [];
}

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
  const drawing = isShapeTool(t) && !t.startsWith('graph-');
  const toolType = drawing ? getToolShapeType(t, o.shapeType) : null;
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
      <path d={d} fillRule="evenodd" fill={open ? 'none' : 'var(--accent-soft, rgba(255,154,0,.22))'} stroke="var(--accent, #ff9a00)" strokeWidth={1.5} />
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

// ---------------------------------------------------------------- anchor points

const ANCHOR_KINDS: { id: Exclude<AnchorKind, 'cusp'>; label: string; hint: string }[] = [
  { id: 'corner', label: 'Corner', hint: 'Sharp point, handles pulled in' },
  { id: 'smooth', label: 'Smooth', hint: 'Handles in line, each keeps its own length' },
  { id: 'symmetric', label: 'Symmetric', hint: 'Handles in line and the same length' },
];

/** The anchor picked with Direct Selection: position, type, handle lengths, stepping and delete. */
export function AnchorSection({ tool }: { tool: ToolId }) {
  useStore();
  if (toolFamily(tool) !== 'path') return null;
  const a = selectedAnchor();
  const l = store.activeLayer;
  if (!a) {
    if (tool !== 'direct-select' || l?.kind !== 'shape') return null;
    return (
      <div className="panel-section anchor-section">
        <div className="mini-title">Anchor point</div>
        <div className="hint">Click an anchor on the outline to edit it here: position, corner or smooth, handle lengths.</div>
      </div>
    );
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return (
    <div className="panel-section anchor-section">
      <div className="mini-title">
        Anchor {a.index + 1} of {a.count}
        <span className="mode-badge live" title="Changes apply to the selected anchor">{a.kind === 'cusp' ? 'Broken' : ANCHOR_KINDS.find((k) => k.id === a.kind)!.label}</span>
      </div>
      <div className="prop-grid">
        <NumberField label="X" value={r(a.x)} min={-100000} max={100000} unit="px" onChange={(v) => moveAnchorTo(v, undefined)} />
        <NumberField label="Y" value={r(a.y)} min={-100000} max={100000} unit="px" onChange={(v) => moveAnchorTo(undefined, v)} />
      </div>
      <div className="prop-row">
        <span className="seg compact anchor-kinds" role="radiogroup" aria-label="Point type">
          {ANCHOR_KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={a.kind === k.id} className={a.kind === k.id ? 'active' : ''} title={k.hint} onClick={() => convertAnchor(k.id)}>
              {k.label}
            </button>
          ))}
        </span>
      </div>
      {a.maxCorner !== null && (
        <div className="prop-row" title="Live corner: rounds this point without moving it. Drag the dot inside the corner on the canvas, or ⌥-click it to make it sharp.">
          <NumberField label="Corner" value={r(a.corner)} min={0} max={Math.max(1, Math.floor(a.maxCorner))} unit="px" onChange={(v) => setAnchorCorner(v)} />
          {a.corner >= a.maxCorner - 0.5 && a.corner > 0 && <span className="hint">max</span>}
        </div>
      )}
      <div className="prop-grid">
        <NumberField label="In" value={r(a.inLen)} min={0} max={100000} unit="px" onChange={(v) => setHandleLength('in', v)} />
        <NumberField label="Out" value={r(a.outLen)} min={0} max={100000} unit="px" onChange={(v) => setHandleLength('out', v)} />
      </div>
      <div className="prop-row">
        <IconButton icon={<ChevronLeft size={14} />} title="Previous anchor" onClick={() => stepAnchor(-1)} />
        <IconButton icon={<ChevronRight size={14} />} title="Next anchor" onClick={() => stepAnchor(1)} />
        <IconButton icon={<Trash2 size={13} />} title="Delete this anchor (the curve closes over it)" onClick={deleteSelectedAnchor} />
        <span className="hint">⌥ drag a handle breaks the pair</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tool card

/** One-line status: what a press of the active tool will do right now. */
function toolStatus(t: ToolId): string | null {
  const sel = store.selectedLayers;
  const shapes = sel.filter((l) => l.kind === 'shape');
  const fam = toolFamily(t);
  if (fam === 'shape') {
    const st = shapeTarget(t);
    return st?.layer ? `Editing the selected ${KIND_NAMES[st.type] ?? 'shape'} · drag on empty canvas for a new one` : null;
  }
  if (fam === 'reshape' || fam === 'cut' || t === 'direct-select' || t === 'smooth' || t === 'mesh' || t === 'gradient') {
    if (t === 'shape-builder') return shapes.length >= 2 ? `${shapes.length} shapes ready · drag across regions to merge` : 'Select two or more overlapping shapes first';
    if (t === 'knife' || t === 'eraser' || t === 'path-eraser') return null;
    if (!shapes.length) return 'Select a shape first, or click one with this tool';
    return shapes.length === 1 ? `Working on “${shapes[0].name}”` : `Working on ${shapes.length} shapes`;
  }
  if (t === 'blend') return shapes.length ? null : 'Click the first shape, then the second';
  return null;
}

/** Live settings of the active tool (other than shapes, which have their own section). */
function ToolSettings({ t }: { t: ToolId }) {
  const s = useStore();
  const o = s.opts;
  const set = (p: Partial<ToolOptions>) => store.setOpts(p);
  if (LIQUIFY.includes(t) || t === 'blob-brush' || t === 'eraser' || t === 'path-eraser' || t === 'brush' || t.startsWith('symbol-')) {
    return <Slider label={t.startsWith('symbol-') ? 'Brush size' : 'Size'} value={o.size} min={2} max={600} unit="px" onChange={(v) => set({ size: v })} />;
  }
  if (t === 'blend') return <Slider label="Steps" value={o.blendSteps} min={1} max={60} onChange={(v) => set({ blendSteps: v })} />;
  if (t === 'smooth') return <Slider label="Brush size" value={o.size} min={4} max={400} unit="px" onChange={(v) => set({ size: v })} />;
  if (toolFamily(t) === 'type') {
    const tl = store.activeLayer?.kind === 'text' ? store.activeLayer : null;
    const size = tl?.text?.size ?? o.fontSize;
    return (
      <>
        <Slider
          label="Font size"
          value={Math.round(size)}
          min={4}
          max={400}
          unit="px"
          onChange={(v) => {
            set({ fontSize: v });
            if (tl) applyTextStyle(tl.id, { size: v }, 'Font Size');
          }}
        />
        <div className="prop-row">
          <span className="seg compact" role="radiogroup" aria-label="Alignment">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                role="radio"
                aria-checked={(tl?.text?.align ?? o.textAlign) === a}
                className={(tl?.text?.align ?? o.textAlign) === a ? 'active' : ''}
                onClick={() => {
                  set({ textAlign: a });
                  if (tl) updateText(tl.id, { align: a }, 'Text Alignment');
                }}
              >
                {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </span>
        </div>
      </>
    );
  }
  if (t === 'mesh') {
    const ml = store.activeLayer?.kind === 'shape' && store.activeLayer.shape?.mesh?.length ? store.activeLayer : null;
    return (
      <div className="prop-row">
        <span className="prop-label">Point colour</span>
        <ColorInput value={s.fg} title="Colour of the next mesh point" onChange={(c) => store.set({ fg: c })} />
        {ml && (
          <button className="btn ghost" onClick={() => store.updateLayer(ml.id, { shape: { ...ml.shape!, mesh: undefined } }, 'Clear Mesh')}>
            Clear mesh ({ml.shape!.mesh!.length})
          </button>
        )}
      </div>
    );
  }
  if (t === 'hand' || t === 'zoom') {
    return (
      <div className="prop-row">
        {(['fit', 'actual', 'zoom-out', 'zoom-in'] as const).map((id) => {
          const c = run(id);
          return c ? (
            <button key={id} className="preset-chip" onClick={() => c.run()} title={c.label}>
              {id === 'fit' ? 'Fit' : id === 'actual' ? '100%' : id === 'zoom-in' ? 'Zoom +' : 'Zoom −'}
            </button>
          ) : null;
        })}
      </div>
    );
  }
  const cmdRow = (ids: string[]) => {
    const cmds = ids.map(run).filter((c): c is NonNullable<typeof c> => !!c);
    return (
      <div className="prop-row">
        {cmds.map((c) => (
          <button key={c.id} className="btn ghost" disabled={!!c.enabled && !c.enabled()} onClick={() => c.run()} title={c.keys ? `${c.label} (${c.keys.replace('Mod', '⌘')})` : c.label}>
            {c.label.replace(/^(Slice|Graph) ▸ /, '').replace(/…$/, '')}
          </button>
        ))}
      </div>
    );
  };
  if (t === 'join' || t === 'add-anchor' || t === 'delete-anchor' || t === 'anchor-point' || t === 'scissors' || t === 'knife') return cmdRow(['join-path', 'simplify-path']);
  if (t === 'slice' || t === 'slice-select') return cmdRow(['slice-from-selection', 'export-slices', 'slice-delete-all']);
  if (t.startsWith('graph-')) return cmdRow(['graph-data']);
  if (t === 'print-tiling') return cmdRow(['print-tiling']);
  if (t === 'rotate' || t === 'reflect' || t === 'scale' || t === 'free-transform') {
    const has = store.selectedLayers.length > 0;
    return (
      <div className="prop-row">
        {t === 'rotate' && (
          <>
            {[-90, -45, -15, 15, 45, 90].map((a) => (
              <button key={a} className="preset-chip" disabled={!has} onClick={() => rotateSelectionBy(a)} title={`Rotate ${a}°`}>
                {a > 0 ? `+${a}` : a}°
              </button>
            ))}
          </>
        )}
        {t === 'reflect' && (
          <>
            <button className="btn ghost" disabled={!has} onClick={() => ops.flipLayer('h')}><FlipHorizontal2 size={13} /> Horizontal</button>
            <button className="btn ghost" disabled={!has} onClick={() => ops.flipLayer('v')}><FlipVertical2 size={13} /> Vertical</button>
          </>
        )}
        {(t === 'scale' || t === 'free-transform') && (
          <>
            {[50, 75, 125, 150, 200].map((p) => (
              <button
                key={p}
                className="preset-chip"
                disabled={!has}
                title={`Scale to ${p}%`}
                onClick={() => {
                  const l = store.activeLayer;
                  if (l) resizeSelectionTo(Math.abs(l.width) * (p / 100), Math.abs(l.height) * (p / 100), false);
                }}
              >
                {p}%
              </button>
            ))}
          </>
        )}
      </div>
    );
  }
  if (t === 'width') {
    const l = liveShape(store.activeLayer) ?? (store.activeLayer?.kind === 'shape' ? store.activeLayer : null);
    if (!l?.shape) return null;
    return <Slider label="Stroke width" value={l.shape.strokeWidth} min={0} max={200} unit="px" onChange={(v) => store.updateLayer(l.id, { shape: { ...l.shape!, strokeWidth: v } }, 'Stroke Width', `sw:${l.id}`)} />;
  }
  return null;
}

/** Top of the Properties panel: the active tool, what it does now, its settings and its gestures. */
export function ToolCard({ extra }: { extra?: ReactNode }) {
  const s = useStore();
  const t = s.tool;
  const def = TOOLS[t];
  const status = toolStatus(t);
  const tips = keyTips(t);
  return (
    <div className="panel-section tool-card">
      <div className="tool-card-head">
        <span className="tool-card-icon">{def?.icon}</span>
        <span className="tool-card-name">{def?.label ?? t}</span>
        {def?.key && <kbd className="kbd">{def.key}</kbd>}
      </div>
      {status ? <div className="tool-card-status">{status}</div> : def?.hint && <div className="hint">{def.hint}</div>}
      <ToolSettings t={t} />
      {extra}
      {tips.length > 0 && (
        <div className="key-tips">
          {tips.map(([k, v]) => (
            <span key={k} className="key-tip">
              <kbd>{k}</kbd> {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- next steps

const run = (id: string) => COMMANDS.find((c) => c.id === id);

/** One-click next steps that fit the current selection. */
export function SmartActions() {
  useStore();
  const sel = store.selectedLayers;
  if (!sel.length) return null;
  const shapes = sel.filter((l) => l.kind === 'shape' && l.shape);
  const one = sel.length === 1 ? sel[0] : null;
  const ids: string[] = [];
  if (shapes.length >= 2) ids.push('pathfinder-unite', 'pathfinder-minus', 'pathfinder-intersect', 'pathfinder-exclude', 'pathfinder-divide', 'make-compound');
  if (one?.kind === 'shape' && one.shape) {
    const isPath = one.shape.shape === 'path' || !!one.shape.points;
    if (isPath) ids.push('simplify-path', 'join-path');
    if (one.shape.strokeWidth > 0) ids.push('outline-stroke');
  }
  if (one?.kind === 'text') ids.push('create-outlines');
  ids.push('make-button', 'release-button');
  if (sel.length >= 2) ids.push('group');
  if (one?.kind === 'group') ids.push('ungroup');
  ids.push('dup-layer');
  const cmds = ids.map(run).filter((c): c is NonNullable<typeof c> => !!c && (!c.enabled || c.enabled()));
  const convertible = one && liveShape(one);
  if (!cmds.length && !convertible) return null;
  return (
    <div className="panel-section">
      <div className="mini-title">Next steps</div>
      <div className="smart-actions">
        {cmds.map((c) => (
          <button key={c.id} className="btn ghost" onClick={() => c.run()} title={c.keys ? `${c.label} (${c.keys.replace('Mod', '⌘')})` : c.label}>
            {c.label.replace(/^Pathfinder: /, '')}
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
