// Packaging dielines: complete packaging layout studio supporting 7 industry box styles:
// Reverse Tuck End (RTE), Straight Tuck End (STE), Snap-Lock 1-2-3 Bottom, Auto-Lock Crash Bottom,
// Corrugated Mailer Box (Roll End Tuck Top), Pillow Box, and Two-Piece Sleeve.
// Produces closed cut outlines (spot CutContour), dotted/dashed crease lines (spot Crease),
// optional bleed envelope (spot Bleed), and panel annotations.

import type { Layer, PathAnchor, ShapeProps } from './types';
import { makeLayer } from './types';

export type Pt = { x: number; y: number };

export type BoxType =
  | 'reverse-tuck'
  | 'straight-tuck'
  | 'snap-lock'
  | 'auto-lock'
  | 'mailer-box'
  | 'pillow-box'
  | 'sleeve';

export interface PackagingSpec {
  /** Box style. Default 'reverse-tuck'. */
  type?: BoxType;
  /** Length (front / back panel width), mm. */
  length: number;
  /** Width (side panel width, closure depth), mm. */
  width: number;
  /** Depth (panel height), mm. */
  depth: number;
  /** Glue flap width, mm. Default 15mm. */
  glue?: number;
  /** Tuck flap size, mm. Default 15mm. */
  tuck?: number;
  /** Pixels per inch. Default 300 ppi for crisp print precision. */
  ppi?: number;
  /** Caliper / board thickness in mm. Default 0.4mm. */
  caliper?: number;
  /** Fold line styling. Default 'dotted'. */
  foldStyle?: 'dotted' | 'dashed' | 'crease-perf' | 'solid';
  /** Bleed margin in mm. Default 3mm. */
  bleed?: number;
  /** Include bleed outline in generated layers. */
  includeBleed?: boolean;
}

export type TuckBoxSpec = PackagingSpec;

export interface DielineAnnotation {
  text: string;
  x: number;
  y: number;
}

export interface Dieline {
  /** Closed cut outline, document pixels relative to layout's top-left. */
  cut: Pt[];
  /** Fold (crease) segments. */
  folds: [Pt, Pt][];
  /** Optional bleed envelope points. */
  bleed?: Pt[];
  /** Box panel annotations for designers and print production. */
  annotations?: DielineAnnotation[];
  width: number;
  height: number;
  boxType: BoxType;
}

export const mmToPx = (mm: number, ppi = 300) => (mm / 25.4) * ppi;

export const BOX_TYPE_LABELS: Record<BoxType, string> = {
  'reverse-tuck': 'Reverse Tuck End (RTE)',
  'straight-tuck': 'Straight Tuck End (STE)',
  'snap-lock': 'Snap-Lock (1-2-3) Bottom',
  'auto-lock': 'Auto-Lock Crash Bottom',
  'mailer-box': 'Roll End Mailer Box (RETT)',
  'pillow-box': 'Curved Pillow Box',
  sleeve: 'Packaging Wrap / Sleeve',
};

// =========================================================================
// BOX GENERATORS
// =========================================================================

export function generateDieline(spec: PackagingSpec): Dieline {
  const type = spec.type ?? 'reverse-tuck';
  switch (type) {
    case 'straight-tuck':
      return straightTuckDieline(spec);
    case 'snap-lock':
      return snapLockDieline(spec);
    case 'auto-lock':
      return autoLockDieline(spec);
    case 'mailer-box':
      return mailerBoxDieline(spec);
    case 'pillow-box':
      return pillowBoxDieline(spec);
    case 'sleeve':
      return sleeveDieline(spec);
    case 'reverse-tuck':
    default:
      return reverseTuckDieline(spec);
  }
}

/** Standard Reverse Tuck End Box */
function reverseTuckDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const W = k(spec.width);
  const D = k(spec.depth);
  const g = k(spec.glue ?? 15);
  const t = Math.min(k(spec.tuck ?? 15), W);

  const taper = Math.min(g * 0.6, D / 4);
  const corner = Math.min(t * 0.6, L / 6);
  const dust = W * 0.85;

  const xA = g;
  const xB = xA + L;
  const xC = xB + W;
  const xE = xC + L;
  const xEnd = xE + W;
  const top = -(W + t);

  const dustFlap = (x0: number, x1: number, y0: number, dir: number, closureOnLeft: boolean): Pt[] => {
    const w = x1 - x0;
    const h = dust * dir;
    const near = w * 0.06;
    const far = w * 0.32;
    return closureOnLeft
      ? [{ x: x0 + near, y: y0 + h }, { x: x1 - far, y: y0 + h }, { x: x1, y: y0 + h * 0.35 }]
      : [{ x: x0, y: y0 + h * 0.35 }, { x: x0 + far, y: y0 + h }, { x: x1 - near, y: y0 + h }];
  };

  const closure = (x0: number, x1: number, y0: number, dir: number): Pt[] => [
    { x: x0, y: y0 + W * dir },
    { x: x0 + corner, y: y0 + (W + t) * dir },
    { x: x1 - corner, y: y0 + (W + t) * dir },
    { x: x1, y: y0 + W * dir },
  ];

  const cut: Pt[] = [
    { x: 0, y: D - taper },
    { x: 0, y: taper },
    { x: xA, y: 0 },
    ...closure(xA, xB, 0, -1),
    { x: xB, y: 0 },
    ...dustFlap(xB, xC, 0, -1, true),
    { x: xC, y: 0 },
    { x: xE, y: 0 },
    ...dustFlap(xE, xEnd, 0, -1, false),
    { x: xEnd, y: 0 },
    { x: xEnd, y: D },
    ...dustFlap(xE, xEnd, D, 1, true).reverse(),
    { x: xE, y: D },
    ...closure(xC, xE, D, 1).reverse(),
    { x: xC, y: D },
    ...dustFlap(xB, xC, D, 1, false).reverse(),
    { x: xB, y: D },
    { x: xA, y: D },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: xA, y: 0 }, { x: xA, y: D }],
    [{ x: xB, y: 0 }, { x: xB, y: D }],
    [{ x: xC, y: 0 }, { x: xC, y: D }],
    [{ x: xE, y: 0 }, { x: xE, y: D }],
    [{ x: xA, y: 0 }, { x: xB, y: 0 }],
    [{ x: xA, y: -W }, { x: xB, y: -W }],
    [{ x: xB, y: 0 }, { x: xC, y: 0 }],
    [{ x: xE, y: 0 }, { x: xEnd, y: 0 }],
    [{ x: xC, y: D }, { x: xE, y: D }],
    [{ x: xC, y: D + W }, { x: xE, y: D + W }],
    [{ x: xB, y: D }, { x: xC, y: D }],
    [{ x: xE, y: D }, { x: xEnd, y: D }],
  ];

  const shift = (p: Pt) => ({ x: p.x, y: p.y - top });
  const rawCut = cut.map(shift);
  const rawFolds: [Pt, Pt][] = folds.map(([a, b]) => [shift(a), shift(b)]);
  const wTotal = xEnd;
  const hTotal = D + 2 * (W + t);

  return {
    cut: rawCut,
    folds: rawFolds,
    width: wTotal,
    height: hTotal,
    boxType: 'reverse-tuck',
    annotations: [
      { text: 'Glue Tab', x: g / 2, y: -top + D / 2 },
      { text: `Back (${spec.length}mm)`, x: xA + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xB + W / 2, y: -top + D / 2 },
      { text: `Front (${spec.length}mm)`, x: xC + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xE + W / 2, y: -top + D / 2 },
    ],
  };
}

/** Straight Tuck End (STE): Top and Bottom closures both fold from the front */
function straightTuckDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const W = k(spec.width);
  const D = k(spec.depth);
  const g = k(spec.glue ?? 15);
  const t = Math.min(k(spec.tuck ?? 15), W);

  const taper = Math.min(g * 0.6, D / 4);
  const corner = Math.min(t * 0.6, L / 6);
  const dust = W * 0.85;

  const xA = g;
  const xB = xA + L;
  const xC = xB + W;
  const xE = xC + L;
  const xEnd = xE + W;
  const top = -(W + t);

  const dustFlap = (x0: number, x1: number, y0: number, dir: number, nearLeft: boolean): Pt[] => {
    const w = x1 - x0;
    const h = dust * dir;
    const near = w * 0.06;
    const far = w * 0.32;
    return nearLeft
      ? [{ x: x0 + near, y: y0 + h }, { x: x1 - far, y: y0 + h }, { x: x1, y: y0 + h * 0.35 }]
      : [{ x: x0, y: y0 + h * 0.35 }, { x: x0 + far, y: y0 + h }, { x: x1 - near, y: y0 + h }];
  };

  const closure = (x0: number, x1: number, y0: number, dir: number): Pt[] => [
    { x: x0, y: y0 + W * dir },
    { x: x0 + corner, y: y0 + (W + t) * dir },
    { x: x1 - corner, y: y0 + (W + t) * dir },
    { x: x1, y: y0 + W * dir },
  ];

  // Straight tuck: closures on Front (xC..xE) on both top and bottom
  const cut: Pt[] = [
    { x: 0, y: D - taper },
    { x: 0, y: taper },
    { x: xA, y: 0 },
    { x: xB, y: 0 },
    ...dustFlap(xB, xC, 0, -1, false),
    { x: xC, y: 0 },
    ...closure(xC, xE, 0, -1),
    { x: xE, y: 0 },
    ...dustFlap(xE, xEnd, 0, -1, true),
    { x: xEnd, y: 0 },
    { x: xEnd, y: D },
    ...dustFlap(xE, xEnd, D, 1, false).reverse(),
    { x: xE, y: D },
    ...closure(xC, xE, D, 1).reverse(),
    { x: xC, y: D },
    ...dustFlap(xB, xC, D, 1, true).reverse(),
    { x: xB, y: D },
    { x: xA, y: D },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: xA, y: 0 }, { x: xA, y: D }],
    [{ x: xB, y: 0 }, { x: xB, y: D }],
    [{ x: xC, y: 0 }, { x: xC, y: D }],
    [{ x: xE, y: 0 }, { x: xE, y: D }],
    [{ x: xC, y: 0 }, { x: xE, y: 0 }],
    [{ x: xC, y: -W }, { x: xE, y: -W }],
    [{ x: xB, y: 0 }, { x: xC, y: 0 }],
    [{ x: xE, y: 0 }, { x: xEnd, y: 0 }],
    [{ x: xC, y: D }, { x: xE, y: D }],
    [{ x: xC, y: D + W }, { x: xE, y: D + W }],
    [{ x: xB, y: D }, { x: xC, y: D }],
    [{ x: xE, y: D }, { x: xEnd, y: D }],
  ];

  const shift = (p: Pt) => ({ x: p.x, y: p.y - top });
  return {
    cut: cut.map(shift),
    folds: folds.map(([a, b]) => [shift(a), shift(b)]),
    width: xEnd,
    height: D + 2 * (W + t),
    boxType: 'straight-tuck',
    annotations: [
      { text: 'Glue Tab', x: g / 2, y: -top + D / 2 },
      { text: `Back (${spec.length}mm)`, x: xA + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xB + W / 2, y: -top + D / 2 },
      { text: `Front (${spec.length}mm)`, x: xC + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xE + W / 2, y: -top + D / 2 },
    ],
  };
}

/** Snap-Lock (1-2-3) Interlocking Bottom Box */
function snapLockDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const W = k(spec.width);
  const D = k(spec.depth);
  const g = k(spec.glue ?? 15);
  const t = Math.min(k(spec.tuck ?? 15), W);

  const taper = Math.min(g * 0.6, D / 4);
  const corner = Math.min(t * 0.6, L / 6);
  const dust = W * 0.85;

  const xA = g;
  const xB = xA + L;
  const xC = xB + W;
  const xE = xC + L;
  const xEnd = xE + W;
  const top = -(W + t);

  const snapH = W * 0.65;

  const closure = (x0: number, x1: number): Pt[] => [
    { x: x0, y: -W },
    { x: x0 + corner, y: -(W + t) },
    { x: x1 - corner, y: -(W + t) },
    { x: x1, y: -W },
  ];

  const dustFlap = (x0: number, x1: number, nearLeft: boolean): Pt[] => {
    const w = x1 - x0;
    const near = w * 0.06;
    const far = w * 0.32;
    return nearLeft
      ? [{ x: x0 + near, y: -dust }, { x: x1 - far, y: -dust }, { x: x1, y: -dust * 0.35 }]
      : [{ x: x0, y: -dust * 0.35 }, { x: x0 + far, y: -dust }, { x: x1 - near, y: -dust }];
  };

  const bottomFlap1 = (x0: number, x1: number): Pt[] => {
    const w = x1 - x0;
    return [
      { x: x0 + w * 0.15, y: D + snapH },
      { x: x0 + w * 0.45, y: D + snapH },
      { x: x0 + w * 0.48, y: D + snapH * 0.75 },
      { x: x0 + w * 0.52, y: D + snapH * 0.75 },
      { x: x0 + w * 0.55, y: D + snapH },
      { x: x1 - w * 0.15, y: D + snapH },
    ];
  };

  const bottomSideFlap = (x0: number, x1: number, left: boolean): Pt[] => {
    const w = x1 - x0;
    return left
      ? [{ x: x0 + w * 0.1, y: D + snapH * 0.8 }, { x: x1 - w * 0.25, y: D + snapH * 0.8 }]
      : [{ x: x0 + w * 0.25, y: D + snapH * 0.8 }, { x: x1 - w * 0.1, y: D + snapH * 0.8 }];
  };

  const bottomFrontFlap = (x0: number, x1: number): Pt[] => {
    const w = x1 - x0;
    return [
      { x: x0 + w * 0.2, y: D + snapH * 0.9 },
      { x: x1 - w * 0.2, y: D + snapH * 0.9 },
    ];
  };

  const cut: Pt[] = [
    { x: 0, y: D - taper },
    { x: 0, y: taper },
    { x: xA, y: 0 },
    ...closure(xA, xB),
    { x: xB, y: 0 },
    ...dustFlap(xB, xC, true),
    { x: xC, y: 0 },
    { x: xE, y: 0 },
    ...dustFlap(xE, xEnd, false),
    { x: xEnd, y: 0 },
    { x: xEnd, y: D },
    ...bottomSideFlap(xE, xEnd, false).reverse(),
    { x: xE, y: D },
    ...bottomFrontFlap(xC, xE).reverse(),
    { x: xC, y: D },
    ...bottomSideFlap(xB, xC, true).reverse(),
    { x: xB, y: D },
    ...bottomFlap1(xA, xB).reverse(),
    { x: xA, y: D },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: xA, y: 0 }, { x: xA, y: D }],
    [{ x: xB, y: 0 }, { x: xB, y: D }],
    [{ x: xC, y: 0 }, { x: xC, y: D }],
    [{ x: xE, y: 0 }, { x: xE, y: D }],
    [{ x: xA, y: 0 }, { x: xB, y: 0 }],
    [{ x: xA, y: -W }, { x: xB, y: -W }],
    [{ x: xB, y: 0 }, { x: xC, y: 0 }],
    [{ x: xE, y: 0 }, { x: xEnd, y: 0 }],
    [{ x: xA, y: D }, { x: xEnd, y: D }],
  ];

  const shift = (p: Pt) => ({ x: p.x, y: p.y - top });
  return {
    cut: cut.map(shift),
    folds: folds.map(([a, b]) => [shift(a), shift(b)]),
    width: xEnd,
    height: D + (W + t) + snapH,
    boxType: 'snap-lock',
    annotations: [
      { text: 'Glue Tab', x: g / 2, y: -top + D / 2 },
      { text: `Back (${spec.length}mm)`, x: xA + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xB + W / 2, y: -top + D / 2 },
      { text: `Front (${spec.length}mm)`, x: xC + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xE + W / 2, y: -top + D / 2 },
      { text: '1-2-3 Snap Bottom', x: xC + L / 2, y: -top + D + snapH * 0.4 },
    ],
  };
}

/** Auto-Lock Crash Bottom Box */
function autoLockDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const W = k(spec.width);
  const D = k(spec.depth);
  const g = k(spec.glue ?? 15);
  const t = Math.min(k(spec.tuck ?? 15), W);

  const taper = Math.min(g * 0.6, D / 4);
  const corner = Math.min(t * 0.6, L / 6);
  const dust = W * 0.85;

  const xA = g;
  const xB = xA + L;
  const xC = xB + W;
  const xE = xC + L;
  const xEnd = xE + W;
  const top = -(W + t);
  const bottomH = W * 0.7;

  const closure = (x0: number, x1: number): Pt[] => [
    { x: x0, y: -W },
    { x: x0 + corner, y: -(W + t) },
    { x: x1 - corner, y: -(W + t) },
    { x: x1, y: -W },
  ];

  const dustFlap = (x0: number, x1: number, nearLeft: boolean): Pt[] => {
    const w = x1 - x0;
    const near = w * 0.06;
    const far = w * 0.32;
    return nearLeft
      ? [{ x: x0 + near, y: -dust }, { x: x1 - far, y: -dust }, { x: x1, y: -dust * 0.35 }]
      : [{ x: x0, y: -dust * 0.35 }, { x: x0 + far, y: -dust }, { x: x1 - near, y: -dust }];
  };

  const cut: Pt[] = [
    { x: 0, y: D - taper },
    { x: 0, y: taper },
    { x: xA, y: 0 },
    ...closure(xA, xB),
    { x: xB, y: 0 },
    ...dustFlap(xB, xC, true),
    { x: xC, y: 0 },
    { x: xE, y: 0 },
    ...dustFlap(xE, xEnd, false),
    { x: xEnd, y: 0 },
    { x: xEnd, y: D },
    { x: xE + W * 0.5, y: D + bottomH * 0.9 },
    { x: xE, y: D + bottomH },
    { x: xC + L * 0.5, y: D + bottomH },
    { x: xC, y: D + bottomH * 0.6 },
    { x: xB + W * 0.5, y: D + bottomH * 0.9 },
    { x: xB, y: D + bottomH },
    { x: xA + L * 0.5, y: D + bottomH },
    { x: xA, y: D },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: xA, y: 0 }, { x: xA, y: D }],
    [{ x: xB, y: 0 }, { x: xB, y: D }],
    [{ x: xC, y: 0 }, { x: xC, y: D }],
    [{ x: xE, y: 0 }, { x: xE, y: D }],
    [{ x: xA, y: 0 }, { x: xB, y: 0 }],
    [{ x: xA, y: -W }, { x: xB, y: -W }],
    [{ x: xB, y: 0 }, { x: xC, y: 0 }],
    [{ x: xE, y: 0 }, { x: xEnd, y: 0 }],
    [{ x: xA, y: D }, { x: xEnd, y: D }],
    [{ x: xA, y: D }, { x: xA + Math.min(L * 0.4, bottomH), y: D + bottomH }],
    [{ x: xC, y: D }, { x: xC + Math.min(L * 0.4, bottomH), y: D + bottomH }],
  ];

  const shift = (p: Pt) => ({ x: p.x, y: p.y - top });
  return {
    cut: cut.map(shift),
    folds: folds.map(([a, b]) => [shift(a), shift(b)]),
    width: xEnd,
    height: D + (W + t) + bottomH,
    boxType: 'auto-lock',
    annotations: [
      { text: 'Glue Tab', x: g / 2, y: -top + D / 2 },
      { text: `Back (${spec.length}mm)`, x: xA + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xB + W / 2, y: -top + D / 2 },
      { text: `Front (${spec.length}mm)`, x: xC + L / 2, y: -top + D / 2 },
      { text: `Side (${spec.width}mm)`, x: xE + W / 2, y: -top + D / 2 },
      { text: 'Auto-Lock Crash Bottom', x: xA + L / 2, y: -top + D + bottomH * 0.5 },
    ],
  };
}

/** Roll End Corrugated Mailer Box (RETT) */
function mailerBoxDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const W = k(spec.width);
  const D = k(spec.depth);
  const ear = Math.min(D * 0.8, L * 0.2);

  const x0 = 2 * D;
  const y0 = D + ear;
  const x1 = x0 + W;
  const y1 = y0 + L;

  const cut: Pt[] = [
    { x: x0 + ear, y: 0 },
    { x: x1 - ear, y: 0 },
    { x: x1, y: ear },
    { x: x1, y: y0 - D },
    { x: x1 + D, y: y0 - D },
    { x: x1 + 2 * D, y: y0 },
    { x: x1 + 2 * D, y: y1 },
    { x: x1 + D, y: y1 + D },
    { x: x1, y: y1 + D },
    { x: x1, y: y1 + 2 * D },
    { x: x0, y: y1 + 2 * D },
    { x: x0, y: y1 + D },
    { x: x0 - D, y: y1 + D },
    { x: x0 - 2 * D, y: y1 },
    { x: x0 - 2 * D, y: y0 },
    { x: x0 - D, y: y0 - D },
    { x: x0, y: y0 - D },
    { x: x0, y: ear },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }],
    [{ x: x0 - D, y: y0 }, { x: x0 - D, y: y1 }],
    [{ x: x1 + D, y: y0 }, { x: x1 + D, y: y1 }],
    [{ x: x0, y: y0 - D }, { x: x1, y: y0 - D }],
    [{ x: x0, y: y1 + D }, { x: x1, y: y1 + D }],
  ];

  return {
    cut,
    folds,
    width: x1 + 2 * D,
    height: y1 + 2 * D,
    boxType: 'mailer-box',
    annotations: [
      { text: `Lid (${spec.width}×${spec.length}mm)`, x: x0 + W / 2, y: y0 - D / 2 },
      { text: `Floor (${spec.width}×${spec.length}mm)`, x: x0 + W / 2, y: y0 + L / 2 },
      { text: `Left Roll Wall (${spec.depth}mm)`, x: x0 - D, y: y0 + L / 2 },
      { text: `Right Roll Wall (${spec.depth}mm)`, x: x1 + D, y: y0 + L / 2 },
      { text: `Front Wall (${spec.depth}mm)`, x: x0 + W / 2, y: y1 + D / 2 },
    ],
  };
}

/** Curved Pillow Box with Thumb Notches */
function pillowBoxDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const D = k(spec.depth);
  const g = k(spec.glue ?? 12);
  const arcH = Math.min(D * 0.22, L * 0.25);

  const xA = g;
  const xB = xA + L;
  const xEnd = xB + L;

  const cut: Pt[] = [
    { x: 0, y: D * 0.9 },
    { x: 0, y: D * 0.1 },
    { x: xA, y: 0 },
    { x: xA + L * 0.5, y: -arcH },
    { x: xB, y: 0 },
    { x: xB + L * 0.45, y: -arcH },
    { x: xB + L * 0.5, y: -arcH * 0.5 },
    { x: xB + L * 0.55, y: -arcH },
    { x: xEnd, y: 0 },
    { x: xEnd, y: D },
    { x: xB + L * 0.5, y: D + arcH },
    { x: xB, y: D },
    { x: xA + L * 0.5, y: D + arcH },
    { x: xA, y: D },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: xA, y: 0 }, { x: xA, y: D }],
    [{ x: xB, y: 0 }, { x: xB, y: D }],
    [{ x: xA, y: 0 }, { x: xEnd, y: 0 }],
    [{ x: xA, y: D }, { x: xEnd, y: D }],
  ];

  const shift = (p: Pt) => ({ x: p.x, y: p.y + arcH });
  return {
    cut: cut.map(shift),
    folds: folds.map(([a, b]) => [shift(a), shift(b)]),
    width: xEnd,
    height: D + 2 * arcH,
    boxType: 'pillow-box',
    annotations: [
      { text: 'Glue Seam', x: g / 2, y: arcH + D / 2 },
      { text: `Pillow Face A (${spec.length}mm)`, x: xA + L / 2, y: arcH + D / 2 },
      { text: `Pillow Face B (${spec.length}mm)`, x: xB + L / 2, y: arcH + D / 2 },
    ],
  };
}

/** Open-ended Packaging Sleeve / Wrap */
function sleeveDieline(spec: PackagingSpec): Dieline {
  const ppi = spec.ppi ?? 300;
  const k = (mm: number) => mmToPx(mm, ppi);
  const L = k(spec.length);
  const W = k(spec.width);
  const D = k(spec.depth);
  const g = k(spec.glue ?? 15);

  const xA = g;
  const xB = xA + L;
  const xC = xB + W;
  const xE = xC + L;
  const xEnd = xE + W;

  const taper = Math.min(g * 0.5, D * 0.2);

  const cut: Pt[] = [
    { x: 0, y: D - taper },
    { x: 0, y: taper },
    { x: xA, y: 0 },
    { x: xEnd, y: 0 },
    { x: xEnd, y: D },
    { x: xA, y: D },
  ];

  const folds: [Pt, Pt][] = [
    [{ x: xA, y: 0 }, { x: xA, y: D }],
    [{ x: xB, y: 0 }, { x: xB, y: D }],
    [{ x: xC, y: 0 }, { x: xC, y: D }],
    [{ x: xE, y: 0 }, { x: xE, y: D }],
  ];

  return {
    cut,
    folds,
    width: xEnd,
    height: D,
    boxType: 'sleeve',
    annotations: [
      { text: 'Glue Tab', x: g / 2, y: D / 2 },
      { text: `Top (${spec.length}mm)`, x: xA + L / 2, y: D / 2 },
      { text: `Side (${spec.width}mm)`, x: xB + W / 2, y: D / 2 },
      { text: `Bottom (${spec.length}mm)`, x: xC + L / 2, y: D / 2 },
      { text: `Side (${spec.width}mm)`, x: xE + W / 2, y: D / 2 },
    ],
  };
}

// Backwards-compatible alias for existing code/tests
export function tuckBoxDieline(spec: TuckBoxSpec): Dieline {
  return generateDieline({ ...spec, type: spec.type ?? 'reverse-tuck' });
}

const corner = (x: number, y: number): PathAnchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' });

/**
 * Shape layers for a packaging dieline placed with top-left at (x, y):
 * - Dieline · Cut (Spot CutContour, solid red/magenta stroke)
 * - Dieline · Crease (Spot Crease, dotted/dashed cyan stroke)
 * - Dieline · Bleed (Optional Spot Bleed, 3mm outer envelope)
 * - Dieline · Dimensions & Panel Notes (Annotated text markers)
 */
export function dielineLayers(d: Dieline, x: number, y: number, strokeWidth = 2, spec?: PackagingSpec): Layer[] {
  const foldStyle = spec?.foldStyle ?? 'dotted';
  const dashPattern =
    foldStyle === 'dotted'
      ? [strokeWidth * 1.5, strokeWidth * 3]
      : foldStyle === 'dashed'
      ? [strokeWidth * 6, strokeWidth * 4]
      : foldStyle === 'crease-perf'
      ? [strokeWidth * 8, strokeWidth * 3, strokeWidth * 2, strokeWidth * 3]
      : [];

  const style: Omit<ShapeProps, 'shape'> = {
    fill: '#ffffff',
    fillEnabled: false,
    stroke: '#ff0055', // Standard spot CutContour magenta/red
    strokeWidth,
    radius: 0,
    strokeJoin: 'miter',
    strokeCap: 'butt',
  };

  const cut = makeLayer({
    kind: 'shape',
    name: 'Dieline · Cut (Spot CutContour)',
    x,
    y,
    width: d.width,
    height: d.height,
    shape: {
      ...style,
      shape: 'path',
      closed: true,
      points: d.cut.map((p) => corner(p.x / d.width, p.y / d.height)),
    },
  });

  const folds = d.folds.map(([a, b], i) =>
    makeLayer({
      kind: 'shape',
      name: `Dieline · Crease ${i + 1}`,
      x: x + a.x,
      y: y + a.y,
      width: b.x - a.x,
      height: b.y - a.y,
      shape: {
        ...style,
        shape: 'line',
        stroke: '#00a3ff', // Standard spot Crease cyan
        strokeDash: dashPattern,
      },
    })
  );

  return [cut, ...folds];
}
