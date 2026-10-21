// Core document model for Skill Photo.
//
// Layers are immutable records: any change produces a new object (see `withLayer`).
// Pixel data lives in canvases. A canvas referenced by a history snapshot is never
// mutated again — edits always clone first (copy-on-write), which is what makes
// undo/redo cheap and correct.

export type BlendMode =
  | 'normal'
  | 'dissolve'
  | 'linear-burn'
  | 'darker-color'
  | 'lighter-color'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'subtract'
  | 'divide'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'lighter'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Photoshop's full list, in its order; `sep` starts a new group in the menu. */
export const BLEND_MODES: { id: BlendMode; label: string; sep?: boolean }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'darken', label: 'Darken', sep: true },
  { id: 'multiply', label: 'Multiply' },
  { id: 'color-burn', label: 'Color Burn' },
  { id: 'linear-burn', label: 'Linear Burn' },
  { id: 'darker-color', label: 'Darker Color' },
  { id: 'lighten', label: 'Lighten', sep: true },
  { id: 'screen', label: 'Screen' },
  { id: 'color-dodge', label: 'Color Dodge' },
  { id: 'lighter', label: 'Linear Dodge (Add)' },
  { id: 'lighter-color', label: 'Lighter Color' },
  { id: 'overlay', label: 'Overlay', sep: true },
  { id: 'soft-light', label: 'Soft Light' },
  { id: 'hard-light', label: 'Hard Light' },
  { id: 'vivid-light', label: 'Vivid Light' },
  { id: 'linear-light', label: 'Linear Light' },
  { id: 'pin-light', label: 'Pin Light' },
  { id: 'hard-mix', label: 'Hard Mix' },
  { id: 'difference', label: 'Difference', sep: true },
  { id: 'exclusion', label: 'Exclusion' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'divide', label: 'Divide' },
  { id: 'hue', label: 'Hue', sep: true },
  { id: 'saturation', label: 'Saturation' },
  { id: 'color', label: 'Color' },
  { id: 'luminosity', label: 'Luminosity' },
];

import type { GridSpec } from './grids';
import type { TextWarpStyle } from './warp';
import type { WidthPoint } from './strokeProfile';

export type LayerKind = 'raster' | 'adjustment' | 'text' | 'shape' | 'group';

export interface CurvePoint {
  x: number; // 0..255
  y: number; // 0..255
}

export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export const HSL_BANDS: HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

export interface Adjust {
  exposure: number; // -5..5 EV
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number; // -100 (cool) .. 100 (warm)
  tint: number; // -100 (green) .. 100 (magenta)
  vibrance: number;
  saturation: number;
  hue: number; // -180..180
  clarity: number;
  dehaze: number;
  sharpen: number; // 0..100
  vignette: number; // -100..100 (negative darkens)
  grain: number; // 0..100
  fade: number; // 0..100
  bw: boolean;
  invert: boolean;
  threshold: number; // 0 = off, else 1..255
  posterize: number; // 0 = off, else 2..32
  levels: { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number };
  curves: { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
  hsl: Record<HslBand, { h: number; s: number; l: number }>;
  grade: { shadowHue: number; shadowSat: number; highlightHue: number; highlightSat: number; balance: number };
  /** Channel Mixer: each output channel as % of R, G, B (Photoshop's -200..200). */
  mixer: { r: [number, number, number]; g: [number, number, number]; b: [number, number, number]; mono: boolean };
  /** Selective Color: cyan / magenta / yellow / black shifts (-100..100) per color range. */
  selective: Record<SelRange, { c: number; m: number; y: number; k: number }>;
  /** Photo Filter: tint by a color at a density (0 = off), optionally keeping luminosity. */
  photoFilter: { color: string; density: number; preserve: boolean };
  /** Gradient Map: luminance → 2 or 3 colors, blended by amount (0 = off). */
  gradientMap: { amount: number; shadow: string; mid: string; highlight: string; useMid: boolean };
  /** Color Balance: cyan↔red, magenta↔green, yellow↔blue shifts (−100..100) per tonal range. */
  colorBalance: { shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number]; preserve: boolean };
  /** Black & White: Photoshop's per-color gray mix (%), with an optional tint. */
  bwMix: { enabled: boolean; reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number; tint: boolean; tintColor: string };
  /** Color Lookup: a 3D LUT (.cube), stored as base64 16-bit RGB, blended by amount (%). */
  lut: { name: string; size: number; data: string; amount: number; base?: { size: number; data: string }; tweak?: import('./looks').LookRecipe } | null;
}

export type SelRange = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas' | 'whites' | 'neutrals' | 'blacks';
export const SEL_RANGES: SelRange[] = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];

const identityCurve = (): CurvePoint[] => [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

export function defaultAdjust(): Adjust {
  const hsl = {} as Adjust['hsl'];
  for (const b of HSL_BANDS) hsl[b] = { h: 0, s: 0, l: 0 };
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    hue: 0,
    clarity: 0,
    dehaze: 0,
    sharpen: 0,
    vignette: 0,
    grain: 0,
    fade: 0,
    bw: false,
    invert: false,
    threshold: 0,
    posterize: 0,
    levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
    curves: { rgb: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() },
    hsl,
    grade: { shadowHue: 220, shadowSat: 0, highlightHue: 40, highlightSat: 0, balance: 0 },
    mixer: { r: [100, 0, 0], g: [0, 100, 0], b: [0, 0, 100], mono: false },
    selective: Object.fromEntries(SEL_RANGES.map((r) => [r, { c: 0, m: 0, y: 0, k: 0 }])) as Adjust['selective'],
    photoFilter: { color: '#ec8a00', density: 0, preserve: true },
    gradientMap: { amount: 0, shadow: '#1b0f3b', mid: '#e8505b', highlight: '#f9d56e', useMid: true },
    colorBalance: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserve: true },
    bwMix: { enabled: false, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1d3b3' },
    lut: null,
  };
}

export interface TextProps {
  text: string;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number; // multiplier
  tracking: number; // px
  shadow: boolean;
  stroke: number; // px, 0 = none
  strokeColor: string;
  caps?: boolean; // render in uppercase (the typed text is kept as-is)
  box?: boolean; // highlight box behind the text block (social-style caption)
  boxColor?: string;
  boxPad?: number; // px around the text
  boxRadius?: number; // px
  underline?: boolean;
  strike?: boolean;
  /** Styled character ranges (rich text), as indices into `text`. */
  runs?: TextRun[];
  /** Paragraph text: wrap lines to this width (px). Unset = point text. */
  boxWidth?: number;
  /** Warp Text (Photoshop-style): Arc, Arch, Bulge, Flag, Wave, Rise; bend −100..100. */
  warp?: { style: TextWarpStyle; bend: number };
}

/** Character-level overrides for rich text. */
export interface TextStyle {
  font?: string;
  size?: number;
  weight?: number;
  italic?: boolean;
  color?: string;
  underline?: boolean;
  strike?: boolean;
}

export interface TextRun extends TextStyle {
  start: number;
  end: number;
}

/** Text exactly as drawn (after the caps transform). */
export function shownText(t: TextProps): string {
  return t.caps ? t.text.toUpperCase() : t.text;
}

export type ShapeType =
  | 'rectangle'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'path'
  | 'round-rect'
  | 'arc'
  | 'spiral'
  | 'grid'
  | 'polar-grid'
  | 'flare'
  | 'graph';

/** A bézier anchor with its two handles (absolute coordinates in the same space as x, y). */
export interface PathAnchor {
  x: number;
  y: number;
  ix: number; // incoming handle
  iy: number;
  ox: number; // outgoing handle
  oy: number;
  type?: 'corner' | 'smooth';
  /** Live corner radius in px (rounded at render time). */
  corner?: number;
}

export interface ShapeProps {
  shape: ShapeType;
  fill: string;
  fillEnabled: boolean;
  /** Fill opacity (0..1, default 1): fades the fill (and gradient / mesh) but not the stroke. */
  fillOpacity?: number;
  stroke: string;
  /** Stroke opacity (0..1, default 1). */
  strokeOpacity?: number;
  strokeWidth: number;
  radius: number;
  sides?: number;
  /** Pen paths: anchors normalised to the layer box (0..1), so resizing the layer scales the path. */
  points?: PathAnchor[];
  closed?: boolean;
  strokeCap?: 'butt' | 'round' | 'square';
  strokeJoin?: 'miter' | 'round' | 'bevel';
  strokeMiterLimit?: number;
  strokeDash?: number[];
  /** Closed shapes: where the stroke sits on the outline. */
  strokeAlign?: 'center' | 'inside' | 'outside';
  /** Variable width: widths along the path, as multiples of strokeWidth. */
  widthPoints?: WidthPoint[];
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Rectangle corner radii, clockwise from top-left (px). Overrides `radius` when set. */
  radii?: [number, number, number, number];
  /** Rectangle corner shape (default round). */
  cornerStyle?: 'round' | 'smooth' | 'chamfer' | 'scoop' | 'notch';
  /** Star: inner radius as a fraction of the outer one (default 0.45). */
  innerRatio?: number;
  /** Polygon / star: rounding of every point (px along each edge). */
  pointRadius?: number;
  /** Ellipse pie: start / end angle in degrees, clockwise from 3 o'clock. */
  pieStart?: number;
  pieEnd?: number;
  /** Ellipse: hole size as a fraction of the radius (donut / ring). */
  hole?: number;
  /** Spiral: number of turns (default 3.5). */
  turns?: number;
  compoundPoints?: PathAnchor[][];
  /** Gradient fill (replaces the flat fill colour while set). */
  gradient?: ShapeGradient;
  /** Gradient mesh points: soft colour spots blended over the fill, clipped to the shape. */
  mesh?: MeshPoint[];
}

/** Gradient on a shape. Points are in the layer box (0..1); radial runs from the centre (x0, y0) to (x1, y1). */
export interface ShapeGradient {
  type: 'linear' | 'radial';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: { offset: number; color: string }[];
}

/** A gradient-mesh colour point, in the layer box (0..1). `spread` is its reach as a fraction of the box diagonal. */
export interface MeshPoint {
  x: number;
  y: number;
  color: string;
  spread?: number;
}

/** A mask lives in document space at (x, y). Pixel value = alpha channel (255 = reveal). */
export interface Mask {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  enabled: boolean;
}

export interface Layer {
  readonly id: string;
  readonly v: number; // identity version, bumped on every record change
  kind: LayerKind;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  clip: boolean; // clipped to the nearest non-clipped layer below
  x: number;
  y: number;
  width: number;
  height: number;
  canvas?: HTMLCanvasElement; // raster pixels
  mask?: Mask;
  adjust?: Adjust;
  adjustLabel?: string;
  text?: TextProps;
  shape?: ShapeProps;
  /** Fill opacity (0..1): fades the layer's own pixels but not its effects. Default 1. */
  fill?: number;
  /** Layer styles (drop shadow, glow, stroke…), rendered live from the layer's alpha. */
  fx?: LayerFx;
  /** Id of the group this layer sits in (see groups.ts). */
  parent?: string;
  /** Groups: contents hidden in the Layers panel. */
  collapsed?: boolean;
  /** Smart Object: original pixels + transform + Smart Filters (see smart.ts). */
  smart?: SmartData;
  /** Color label shown in the Layers panel. */
  label?: LayerLabel;
  /** Lock transparency: painting can't change the layer's alpha. */
  lockAlpha?: boolean;
  /** Shape and text layers: clockwise rotation in degrees about the centre of their x/y/width/height box. Stays live (editable). */
  rotation?: number;
  /** Shapes: hugs a text layer with padding (a button that grows with its label). See hug.ts. */
  hug?: { target: string; padX: number; padY: number };
}

export type LayerLabel = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray';
export const LAYER_LABELS: { id: LayerLabel; color: string }[] = [
  { id: 'red', color: '#e5484d' },
  { id: 'orange', color: '#f76b15' },
  { id: 'yellow', color: '#ffc53d' },
  { id: 'green', color: '#30a46c' },
  { id: 'blue', color: '#3e63dd' },
  { id: 'violet', color: '#8e4ec6' },
  { id: 'gray', color: '#8b8d98' },
];

export interface SmartFilter {
  id: string;
  params: Record<string, number>;
  enabled: boolean;
}

export interface SmartData {
  /** Untouched original pixels. */
  source: HTMLCanvasElement;
  scaleX: number;
  scaleY: number;
  angle: number; // radians
  /** Centre of the source box, relative to the layer's x / y. */
  ax: number;
  ay: number;
  /** Free corners (skew / distort / perspective), relative to the layer's x / y. */
  quad?: { x: number; y: number }[];
  /** Warp mesh (16 points), relative to the layer's x / y. */
  mesh?: { x: number; y: number }[];
  filters: SmartFilter[];
}

// ---------------------------------------------------------------- layer styles

/** Opacity, spread and depth values are percentages (0..100); sizes and distances are pixels. */
export interface ShadowFx {
  enabled: boolean;
  color: string;
  opacity: number;
  angle: number; // degrees, direction the light comes from (120 = upper left)
  distance: number;
  size: number;
  spread: number;
}

export interface GlowFx {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  spread: number;
}

export interface StrokeFx {
  enabled: boolean;
  color: string;
  opacity: number;
  size: number;
  position: 'outside' | 'center' | 'inside';
}

export interface OverlayFx {
  enabled: boolean;
  color: string;
  opacity: number;
}

export interface GradientFx {
  enabled: boolean;
  from: string;
  to: string;
  angle: number; // 90 = from bottom to top
  opacity: number;
}

export interface BevelFx {
  enabled: boolean;
  size: number;
  depth: number; // 1..500
  angle: number;
  altitude: number; // degrees above the horizon
  highlight: string;
  shadow: string;
  opacity: number;
}

export interface LayerFx {
  dropShadow: ShadowFx;
  outerGlow: GlowFx;
  innerShadow: ShadowFx;
  innerGlow: GlowFx;
  bevel: BevelFx;
  colorOverlay: OverlayFx;
  gradientOverlay: GradientFx;
  stroke: StrokeFx;
}

export type FxKey = keyof LayerFx;

export function defaultFx(): LayerFx {
  return {
    dropShadow: { enabled: false, color: '#000000', opacity: 45, angle: 120, distance: 12, size: 24, spread: 0 },
    outerGlow: { enabled: false, color: '#ffd54a', opacity: 75, size: 28, spread: 0 },
    innerShadow: { enabled: false, color: '#000000', opacity: 50, angle: 120, distance: 6, size: 10, spread: 0 },
    innerGlow: { enabled: false, color: '#ffffff', opacity: 60, size: 14, spread: 0 },
    bevel: { enabled: false, size: 10, depth: 100, angle: 120, altitude: 30, highlight: '#ffffff', shadow: '#000000', opacity: 70 },
    colorOverlay: { enabled: false, color: '#ff3b6b', opacity: 100 },
    gradientOverlay: { enabled: false, from: '#7b2ff7', to: '#f107a3', angle: 90, opacity: 100 },
    stroke: { enabled: false, color: '#ffffff', opacity: 100, size: 6, position: 'outside' },
  };
}

/** Fills in any effects missing from older project files. */
export function fullFx(fx: Partial<LayerFx> | undefined): LayerFx {
  const d = defaultFx();
  if (!fx) return d;
  const out = { ...d } as Record<FxKey, unknown>;
  for (const k of Object.keys(d) as FxKey[]) if (fx[k]) out[k] = { ...d[k], ...fx[k] };
  return out as unknown as LayerFx;
}

export function hasFx(l: Layer): boolean {
  const fx = l.fx;
  if (!fx) return false;
  return Object.values(fx).some((e) => e && (e as { enabled: boolean }).enabled);
}

export interface Selection {
  canvas: HTMLCanvasElement; // doc-sized, alpha = selection strength
  bounds: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Snapshot {
  label: string;
  icon: string;
  layers: Layer[];
  activeId: string;
  width: number;
  height: number;
  selection: Selection | null;
  /** Layout grids at this step. */
  grids?: GridSpec[];
  time: number;
}

export interface Doc {
  id: string;
  title: string;
  width: number;
  height: number;
  layers: Layer[]; // index 0 = bottom
  activeId: string;
  selection: Selection | null;
  lastSelection: Selection | null;
  editMask: boolean; // painting targets the active layer's mask
  history: Snapshot[];
  hIndex: number;
  dirty: boolean;
  view: { zoom: number; panX: number; panY: number; fitted: boolean };
  sourceName?: string;
  safeZone?: string; // id into SAFE_ZONES (social platform UI overlays)
  /** Layers selected together in the Layers panel (always includes activeId). UI state, not history. */
  selectedIds?: string[];
  /** Color sampler points (Info panel), in document pixels. */
  samplers?: { x: number; y: number }[];
  /** Layout grids over the canvas (columns, safe areas, panels …). */
  grids?: GridSpec[];
}

let layerVersion = 1;
let idCounter = 1;

export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export function makeLayer(init: Partial<Layer> & { kind: LayerKind; name: string }): Layer {
  return {
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    clip: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    ...init,
    // Always a fresh identity, even when `init` is spread from another layer
    id: uid('layer'),
    v: layerVersion++,
  };
}

/** Returns a new layer record with the patch applied (never mutates). */
export function withLayer(layer: Layer, patch: Partial<Layer>): Layer {
  return { ...layer, ...patch, v: layerVersion++ };
}
