import { uid } from './geometry'
import type {
  BoardDoc, CardObj, CommentObj, ConnectorObj, EmojiObj, FrameObj, ImageObj, MindObj, PenObj, ShapeKind, ShapeObj, StickyObj, TextObj,
} from './types'

export const STICKY_COLORS = [
  { name: 'Yellow', fill: '#fff176' },
  { name: 'Light yellow', fill: '#fff9b1' },
  { name: 'Orange', fill: '#ffc46b' },
  { name: 'Peach', fill: '#ffb3a1' },
  { name: 'Pink', fill: '#f7a8cf' },
  { name: 'Violet', fill: '#c9b6ff' },
  { name: 'Blue', fill: '#9fd3ff' },
  { name: 'Cyan', fill: '#9be7e0' },
  { name: 'Green', fill: '#b8e994' },
  { name: 'Lime', fill: '#dbf08c' },
  { name: 'Gray', fill: '#e2e2e2' },
  { name: 'Black', fill: '#2d2d36' },
]

export const INK_COLORS = ['#1a1a2e', '#ffffff', '#6b7280', '#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f']

export const FILL_COLORS = ['transparent', '#ffffff', '#f3f4f6', '#fff3bf', '#ffe8cc', '#ffe3e3', '#fcc2d7', '#e5dbff', '#d0ebff', '#c3fae8', '#d3f9d8', '#1a1a2e', '#ffd02f', '#4262ff', '#e5484d', '#30a46c']

export const CARD_TAGS = ['#4262ff', '#30a46c', '#f76b15', '#e5484d', '#8e4ec6', '#12a594', '#ffc53d']

export const MIND_COLORS = ['#4262ff', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f']

/** Readable ink over a fill */
export function inkFor(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill)
  if (!m) return '#1a1a2e'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? '#ffffff' : '#1a1a2e'
}

const textDefaults = { fontSize: 0, color: '#1a1a2e', align: 'center', valign: 'middle', font: 'sans' } as const

export function makeSticky(x: number, y: number, fill = '#fff176', text = ''): StickyObj {
  return { id: uid(), kind: 'sticky', x, y, w: 200, h: 200, rotation: 0, fill, text, ...textDefaults, color: inkFor(fill) }
}

export function makeShape(shape: ShapeKind, x: number, y: number, w = 180, h = 120): ShapeObj {
  return {
    id: uid(), kind: 'shape', shape, x, y, w, h, rotation: 0,
    fill: '#ffffff', stroke: '#1a1a2e', strokeWidth: 2, dash: 'solid', text: '',
    ...textDefaults, fontSize: 18,
  }
}

export function makeText(x: number, y: number, text = ''): TextObj {
  return {
    id: uid(), kind: 'text', x, y, w: 240, h: 40, rotation: 0, text, autoWidth: true,
    ...textDefaults, fontSize: 24, align: 'left', valign: 'top',
  }
}

export function makeFrame(x: number, y: number, w = 800, h = 560, title = 'Frame'): FrameObj {
  return { id: uid(), kind: 'frame', x, y, w, h, rotation: 0, title, fill: '#ffffff' }
}

export function makeCard(x: number, y: number, title = 'New card', tag = '#4262ff'): CardObj {
  return { id: uid(), kind: 'card', x, y, w: 280, h: 132, rotation: 0, title, body: '', tag, status: 'todo' }
}

export function makePen(x: number, y: number, points: number[], color: string, width: number, highlighter = false): PenObj {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i])
    y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1])
  }
  const rel = points.map((v, i) => (i % 2 ? v - y0 : v - x0))
  return { id: uid(), kind: 'pen', x: x + x0, y: y + y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), rotation: 0, points: rel, color, width, highlighter }
}

export function makeImage(x: number, y: number, src: string, natW: number, natH: number): ImageObj {
  const s = Math.min(1, 640 / Math.max(natW, natH))
  return { id: uid(), kind: 'image', x, y, w: natW * s, h: natH * s, rotation: 0, src, natW, natH }
}

export function makeMind(x: number, y: number, text: string, parent?: string, color = '#4262ff'): MindObj {
  const root = !parent
  return { id: uid(), kind: 'mind', x, y, w: root ? 200 : 160, h: root ? 56 : 40, rotation: 0, text, parent, color, side: root ? 'right' : undefined }
}

export function makeEmoji(x: number, y: number, char: string): EmojiObj {
  return { id: uid(), kind: 'emoji', x, y, w: 64, h: 64, rotation: 0, char }
}

export function makeComment(x: number, y: number, author: string, text: string): CommentObj {
  return { id: uid(), kind: 'comment', x, y, w: 32, h: 32, rotation: 0, thread: text ? [{ id: uid(), author, text, at: Date.now() }] : [] }
}

export function makeConnector(from: ConnectorObj['from'], to: ConnectorObj['to'], style: ConnectorObj['style'] = 'curve'): ConnectorObj {
  return {
    id: uid(), kind: 'connector', x: 0, y: 0, w: 0, h: 0, rotation: 0,
    from, to, style, stroke: '#1a1a2e', strokeWidth: 2, dash: 'solid', startCap: 'none', endCap: 'arrow', label: '',
  }
}

export function emptyBoard(name = 'Untitled board'): BoardDoc {
  const now = Date.now()
  return { id: uid(), name, createdAt: now, updatedAt: now, objects: {}, order: [], viewport: { x: 0, y: 0, zoom: 1 }, background: 'dots' }
}
