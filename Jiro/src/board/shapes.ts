import type { ShapeKind } from './types'

export const SHAPES: { kind: ShapeKind; label: string; key?: string }[] = [
  { kind: 'rect', label: 'Rectangle', key: 'R' },
  { kind: 'round', label: 'Rounded' },
  { kind: 'ellipse', label: 'Circle', key: 'O' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'star', label: 'Star' },
  { kind: 'cylinder', label: 'Database' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'callout', label: 'Speech bubble' },
  { kind: 'cross', label: 'Plus' },
]

/** SVG path for a shape in its own w×h box (origin top-left) */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  switch (kind) {
    case 'rect':
      return `M0,0 H${w} V${h} H0 Z`
    case 'round': {
      const r = Math.min(20, w / 4, h / 4)
      return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`
    }
    case 'ellipse': {
      const rx = w / 2, ry = h / 2
      return `M0,${ry} A${rx},${ry} 0 1 0 ${w},${ry} A${rx},${ry} 0 1 0 0,${ry} Z`
    }
    case 'triangle':
      return `M${w / 2},0 L${w},${h} L0,${h} Z`
    case 'diamond':
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`
    case 'hexagon': {
      const i = Math.min(w * 0.25, h * 0.5)
      return `M${i},0 H${w - i} L${w},${h / 2} L${w - i},${h} H${i} L0,${h / 2} Z`
    }
    case 'parallelogram': {
      const i = Math.min(w * 0.22, h * 0.6)
      return `M${i},0 H${w} L${w - i},${h} H0 Z`
    }
    case 'star': {
      const cx = w / 2, cy = h / 2
      let d = ''
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5
        const r = k % 2 ? 0.4 : 1
        d += `${k ? 'L' : 'M'}${cx + Math.cos(a) * (w / 2) * r},${cy + Math.sin(a) * (h / 2) * r * 1.05 + h * 0.03}`
      }
      return d + 'Z'
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 24)
      return `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry}`
    }
    case 'arrow': {
      const head = Math.min(w * 0.4, h)
      const t = h * 0.25
      return `M0,${t} H${w - head} V0 L${w},${h / 2} L${w - head},${h} V${h - t} H0 Z`
    }
    case 'callout': {
      const bh = h * 0.78
      const r = Math.min(16, w / 5, bh / 4)
      return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${bh - r} Q${w},${bh} ${w - r},${bh} H${w * 0.42} L${w * 0.22},${h} L${w * 0.26},${bh} H${r} Q0,${bh} 0,${bh - r} V${r} Q0,0 ${r},0 Z`
    }
    case 'cross': {
      const a = w / 3, b = h / 3
      return `M${a},0 H${2 * a} V${b} H${w} V${2 * b} H${2 * a} V${h} H${a} V${2 * b} H0 V${b} H${a} Z`
    }
  }
}

/** Inner text box for shapes whose text area is smaller than the bounds */
export function shapeTextBox(kind: ShapeKind, w: number, h: number) {
  const pad = 12
  switch (kind) {
    case 'ellipse':
      return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 }
    case 'diamond':
      return { x: w * 0.25, y: h * 0.25, w: w * 0.5, h: h * 0.5 }
    case 'triangle':
      return { x: w * 0.25, y: h * 0.45, w: w * 0.5, h: h * 0.5 }
    case 'star':
      return { x: w * 0.3, y: h * 0.35, w: w * 0.4, h: h * 0.4 }
    case 'callout':
      return { x: pad, y: pad, w: w - pad * 2, h: h * 0.78 - pad * 2 }
    case 'cylinder':
      return { x: pad, y: Math.min(h * 0.28, 48), w: w - pad * 2, h: h - Math.min(h * 0.28, 48) - pad }
    case 'hexagon':
    case 'parallelogram':
      return { x: w * 0.2, y: pad, w: w * 0.6, h: h - pad * 2 }
    default:
      return { x: pad, y: pad, w: Math.max(4, w - pad * 2), h: Math.max(4, h - pad * 2) }
  }
}
