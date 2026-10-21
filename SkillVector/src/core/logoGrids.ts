// Logo Design Studio: 10 professional logo construction grids.
// Generates precision vector guides and lines for logo designers.
// Works seamlessly with the Shape Builder / Grid Joiner Tool (⇧M) to fuse grid cells into solid brand marks.

import type { Layer, PathAnchor, ShapeProps } from './types';
import { makeLayer } from './types';
import { groupLayers } from './groups';
import { store } from './store';
import { getActiveArtboard } from './vectorOps';

export type LogoGridType =
  | 'golden-ratio'
  | 'modular-matrix'
  | 'isometric-hex'
  | 'polar-radial'
  | 'triangular-delta'
  | 'monogram-lettermark'
  | 'diagonal-dynamic'
  | 'concentric-rings'
  | 'diamond-rhombus'
  | 'sacred-flower';

export interface LogoGridDef {
  id: LogoGridType;
  name: string;
  category: 'Geometric' | 'Mathematical' | 'Radial' | 'Typography';
  description: string;
  iconHint: string;
}

export const LOGO_GRID_CATALOG: LogoGridDef[] = [
  {
    id: 'golden-ratio',
    name: 'Golden Ratio (Phi) Circles & Spiral',
    category: 'Mathematical',
    description: '1:1.618 harmonic circles (ratios 1, 2, 3, 5, 8, 13, 21) used for Apple, Twitter, and Pepsi marks.',
    iconHint: 'φ',
  },
  {
    id: 'modular-matrix',
    name: 'Modular Square & Matrix Grid',
    category: 'Geometric',
    description: 'Precision Cartesian grid with 45° diagonal bisectors and node circles for modern tech emblems.',
    iconHint: '⊞',
  },
  {
    id: 'isometric-hex',
    name: 'Isometric 30°/60° Hexagonal Grid',
    category: 'Geometric',
    description: 'Isometric cubes, impossible shapes, and 3D geometric polygon brandmarks.',
    iconHint: '⬡',
  },
  {
    id: 'polar-radial',
    name: 'Polar 12/24 Radial Symmetry Grid',
    category: 'Radial',
    description: 'Rotational symmetry circles and spokes for crests, badges, seals, and circular emblems.',
    iconHint: '✹',
  },
  {
    id: 'triangular-delta',
    name: 'Equilateral Delta Mesh Grid',
    category: 'Geometric',
    description: '60° equilateral triangles for dynamic geometric, aerospace, and delta-themed logos.',
    iconHint: '▲',
  },
  {
    id: 'monogram-lettermark',
    name: 'Monogram & Lettermark Grid',
    category: 'Typography',
    description: 'Stem proportions, cap height, baseline, and optical curve radii for bespoke monogram marks.',
    iconHint: 'M',
  },
  {
    id: 'diagonal-dynamic',
    name: 'Dynamic 45° / 60° Slanted Speed Grid',
    category: 'Geometric',
    description: 'Forward-leaning angles, italicized dynamic vectors for sports, automotive, and fintech marks.',
    iconHint: '⧄',
  },
  {
    id: 'concentric-rings',
    name: 'Concentric Target Rings Grid',
    category: 'Radial',
    description: 'Harmonic concentric circular bands with equal annular steps for app icons and target marks.',
    iconHint: '◎',
  },
  {
    id: 'diamond-rhombus',
    name: 'Diamond & Rhombus Lattice Grid',
    category: 'Geometric',
    description: 'Refined diagonal diamond tessellation for luxury, fashion, and jewelry brand identities.',
    iconHint: '◇',
  },
  {
    id: 'sacred-flower',
    name: 'Sacred Geometry Flower of Life',
    category: 'Mathematical',
    description: 'Overlapping circular petals derived from sacred geometry for organic, wellness, and holistic logos.',
    iconHint: '✿',
  },
];

export interface LogoGridOptions {
  size?: number; // Overall bounding size in pixels (default 400)
  color?: string; // Guide stroke color (default #00d2ff)
  strokeWidth?: number; // Stroke weight (default 1.5)
  dashed?: boolean; // Dashed lines
}

const corner = (x: number, y: number): PathAnchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' });

/**
 * Generates vector guide layers for any of the 10 logo construction grids.
 */
export function createLogoGridLayers(type: LogoGridType, cx: number, cy: number, opts: LogoGridOptions = {}): Layer[] {
  const S = opts.size ?? 400;
  const col = opts.color ?? '#00d2ff';
  const sw = opts.strokeWidth ?? 1.5;
  const dash = opts.dashed ? [4, 4] : undefined;

  const style: Omit<ShapeProps, 'shape'> = {
    fill: '#ffffff',
    fillEnabled: false,
    stroke: col,
    strokeWidth: sw,
    radius: 0,
    strokeDash: dash,
    strokeJoin: 'round',
    strokeCap: 'round',
  };

  const layers: Layer[] = [];

  const addLine = (name: string, x1: number, y1: number, x2: number, y2: number) => {
    layers.push(
      makeLayer({
        kind: 'shape',
        name,
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        shape: { ...style, shape: 'line' },
      })
    );
  };

  const addCircle = (name: string, x: number, y: number, r: number) => {
    layers.push(
      makeLayer({
        kind: 'shape',
        name,
        x: x - r,
        y: y - r,
        width: r * 2,
        height: r * 2,
        shape: { ...style, shape: 'ellipse' },
      })
    );
  };

  switch (type) {
    case 'golden-ratio': {
      // Golden circles based on Fibonacci sequence: 1, 2, 3, 5, 8, 13, 21, 34
      const fib = [13, 21, 34, 55, 89, 144, 233];
      const maxF = fib[fib.length - 1];
      const scale = (S / 2) / maxF;
      for (const f of fib) {
        addCircle(`Phi Circle ${f}`, cx, cy, f * scale);
      }
      // Horizontal and vertical axis bisectors
      addLine('Axis H', cx - S / 2, cy, cx + S / 2, cy);
      addLine('Axis V', cx, cy - S / 2, cx, cy + S / 2);
      break;
    }

    case 'modular-matrix': {
      const steps = 8;
      const step = S / steps;
      const left = cx - S / 2;
      const top = cy - S / 2;
      for (let i = 0; i <= steps; i++) {
        addLine(`V Line ${i}`, left + i * step, top, left + i * step, top + S);
        addLine(`H Line ${i}`, left, top + i * step, left + S, top + i * step);
      }
      // 45 degree diagonal guides
      addLine('Diagonal 1', left, top, left + S, top + S);
      addLine('Diagonal 2', left, top + S, left + S, top);
      addCircle('Center Circle', cx, cy, S * 0.35);
      break;
    }

    case 'isometric-hex': {
      const r = S / 2;
      addCircle('Outer Bounding Circle', cx, cy, r);
      // Hexagon vertices at 60 degree intervals
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const x1 = cx + r * Math.cos(ang);
        const y1 = cy + r * Math.sin(ang);
        const angNext = ((i + 1) * Math.PI) / 3;
        const x2 = cx + r * Math.cos(angNext);
        const y2 = cy + r * Math.sin(angNext);
        addLine(`Hex Edge ${i + 1}`, x1, y1, x2, y2);
        addLine(`Hex Spoke ${i + 1}`, cx, cy, x1, y1);
      }
      // Inner isometric sub-divisions
      addCircle('Inner Circle', cx, cy, r * 0.5);
      break;
    }

    case 'polar-radial': {
      const r = S / 2;
      const sectors = 12;
      for (let i = 0; i < sectors; i++) {
        const ang = (i * 2 * Math.PI) / sectors;
        addLine(`Radial Spoke ${i + 1}`, cx, cy, cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      }
      addCircle('Ring Outer', cx, cy, r);
      addCircle('Ring Mid 2', cx, cy, r * 0.75);
      addCircle('Ring Mid 1', cx, cy, r * 0.5);
      addCircle('Ring Core', cx, cy, r * 0.25);
      break;
    }

    case 'triangular-delta': {
      const r = S / 2;
      const hTri = r * Math.sqrt(3);
      addLine('Base', cx - r, cy + r * 0.5, cx + r, cy + r * 0.5);
      addLine('Left Slant', cx - r, cy + r * 0.5, cx, cy - r);
      addLine('Right Slant', cx + r, cy + r * 0.5, cx, cy - r);
      // Inverted inner triangle
      addLine('Inner Base', cx - r * 0.5, cy - r * 0.25, cx + r * 0.5, cy - r * 0.25);
      addLine('Inner Left', cx - r * 0.5, cy - r * 0.25, cx, cy + r * 0.5);
      addLine('Inner Right', cx + r * 0.5, cy - r * 0.25, cx, cy + r * 0.5);
      addCircle('Inscribed Circle', cx, cy, r * 0.5);
      break;
    }

    case 'monogram-lettermark': {
      const left = cx - S / 2;
      const top = cy - S / 2;
      // Cap height, midline, baseline, descender
      addLine('Cap Height', left, top + S * 0.15, left + S, top + S * 0.15);
      addLine('X-Height', left, top + S * 0.38, left + S, top + S * 0.38);
      addLine('Baseline', left, top + S * 0.75, left + S, top + S * 0.75);
      addLine('Descender', left, top + S * 0.9, left + S, top + S * 0.9);
      // Vertical stem guides
      addLine('Stem Left', left + S * 0.25, top, left + S * 0.25, top + S);
      addLine('Stem Center', cx, top, cx, top + S);
      addLine('Stem Right', left + S * 0.75, top, left + S * 0.75, top + S);
      // Letter bowl arc guide
      addCircle('Bowl Arc', left + S * 0.5, top + S * 0.45, S * 0.28);
      break;
    }

    case 'diagonal-dynamic': {
      const left = cx - S / 2;
      const top = cy - S / 2;
      // Slanted 60 degree parallel guides
      for (let offset = -S; offset <= S; offset += S * 0.2) {
        addLine(`Slant ${offset}`, left + offset, top + S, left + offset + S * 0.6, top);
      }
      addLine('Horizontal Base', left, cy, left + S, cy);
      addCircle('Dynamic Eye Circle', cx, cy, S * 0.3);
      break;
    }

    case 'concentric-rings': {
      const r = S / 2;
      const bands = 6;
      for (let i = 1; i <= bands; i++) {
        addCircle(`Target Ring ${i}`, cx, cy, (r / bands) * i);
      }
      addLine('Crosshair H', cx - r, cy, cx + r, cy);
      addLine('Crosshair V', cx, cy - r, cx, cy + r);
      break;
    }

    case 'diamond-rhombus': {
      const left = cx - S / 2;
      const top = cy - S / 2;
      // Outer diamond rhombus
      addLine('Diamond Top-Right', cx, top, left + S, cy);
      addLine('Diamond Bottom-Right', left + S, cy, cx, top + S);
      addLine('Diamond Bottom-Left', cx, top + S, left, cy);
      addLine('Diamond Top-Left', left, cy, cx, top);
      // Inner diamond
      const half = S * 0.25;
      addLine('Inner Top-Right', cx, cy - half, cx + half, cy);
      addLine('Inner Bottom-Right', cx + half, cy, cx, cy + half);
      addLine('Inner Bottom-Left', cx, cy + half, cx - half, cy);
      addLine('Inner Top-Left', cx - half, cy, cx, cy - half);
      addCircle('Inscribed Circle', cx, cy, half);
      break;
    }

    case 'sacred-flower': {
      const r = S * 0.28;
      // Center circle
      addCircle('Center Petal', cx, cy, r);
      // 6 surrounding overlapping petals
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const px = cx + r * Math.cos(ang);
        const py = cy + r * Math.sin(ang);
        addCircle(`Petal Ring ${i + 1}`, px, py, r);
      }
      // Outer bounding enclosure
      addCircle('Outer Enclosure', cx, cy, r * 2);
      break;
    }
  }

  return layers;
}

/**
 * Places a selected logo construction grid onto the active document canvas as an editable grouped guide layer.
 */
export function insertLogoGridOntoCanvas(type: LogoGridType, opts: LogoGridOptions = {}) {
  const doc = store.doc;
  if (!doc) return;
  const ab = getActiveArtboard(doc);
  const cx = Math.round(ab.x + ab.width / 2);
  const cy = Math.round(ab.y + ab.height / 2);

  const parts = createLogoGridLayers(type, cx, cy, opts);
  const foundDef = LOGO_GRID_CATALOG.find((g) => g.id === type);
  const label = `Logo Grid · ${foundDef?.name ?? type}`;
  const grouped = groupLayers([...doc.layers, ...parts], parts.map((l) => l.id), label);
  if (!grouped) return;

  store.commit('Add Logo Construction Grid', {
    layers: grouped.layers,
    activeId: grouped.group.id,
  }, { icon: 'shape' });

  store.toast(`Placed ${foundDef?.name ?? type} on artboard. Use Shape Builder (⇧M) to join grid cells!`, 'success');
}
