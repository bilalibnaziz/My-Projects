import { makeCard, makeConnector, makeFrame, makeMind, makeShape, makeSticky, makeText } from './factory'
import { layoutMind } from './mindmap'
import type { BoardObj, ID, ShapeObj, StickyObj } from './types'

export interface Template {
  id: string
  name: string
  description: string
  category: 'Ideate' | 'Plan' | 'Agile' | 'Strategy' | 'Diagram'
  accent: string
  build(): BoardObj[]
}

const sticky = (x: number, y: number, fill: string, text: string, w = 200, h = 200): StickyObj => ({ ...makeSticky(x, y, fill, text), w, h })
const title = (x: number, y: number, text: string, size = 40) => ({ ...makeText(x, y, text), fontSize: size, bold: true })

function columns(names: string[], colors: string[], w = 420, h = 760, gap = 40): BoardObj[] {
  const out: BoardObj[] = []
  names.forEach((n, i) => {
    const f = makeFrame(i * (w + gap), 0, w, h, n)
    f.fill = colors[i % colors.length]
    out.push(f)
  })
  return out
}

export const TEMPLATES: Template[] = [
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Central question with idea clusters around it',
    category: 'Ideate',
    accent: '#ffd02f',
    build() {
      const out: BoardObj[] = []
      const q: ShapeObj = { ...makeShape('ellipse', -180, -90, 360, 180), fill: '#ffd02f', stroke: '#1a1a2e', text: 'How might we…?', fontSize: 28, bold: true }
      out.push(q)
      const clusters = [
        { x: -760, y: -520, c: '#9fd3ff', label: 'Quick wins' },
        { x: 400, y: -520, c: '#f7a8cf', label: 'Big bets' },
        { x: -760, y: 260, c: '#b8e994', label: 'Experiments' },
        { x: 400, y: 260, c: '#c9b6ff', label: 'Wild ideas' },
      ]
      for (const cl of clusters) {
        out.push(title(cl.x, cl.y - 64, cl.label, 32))
        for (let i = 0; i < 4; i++) out.push(sticky(cl.x + (i % 2) * 180, cl.y + Math.floor(i / 2) * 180, cl.c, '', 160, 160))
      }
      return out
    },
  },
  {
    id: 'kanban',
    name: 'Kanban board',
    description: 'To do · Doing · Done with cards',
    category: 'Agile',
    accent: '#4262ff',
    build() {
      const out = columns(['To do', 'In progress', 'Review', 'Done'], ['#f4f6ff', '#fff8e1', '#fdf0ff', '#effaf1'], 340, 820, 32)
      const items: [number, string, string][] = [
        [0, 'Research competitors', '#4262ff'], [0, 'Draft onboarding copy', '#8e4ec6'], [0, 'Collect user interviews', '#12a594'],
        [1, 'Design new dashboard', '#f76b15'], [1, 'API for exports', '#4262ff'],
        [2, 'Pricing page', '#e5484d'],
        [3, 'Set up analytics', '#30a46c'],
      ]
      const count = [0, 0, 0, 0]
      for (const [col, t, tag] of items) {
        const c = makeCard(col * 372 + 30, 80 + count[col]++ * 152, t, tag)
        c.status = col === 3 ? 'done' : col === 0 ? 'todo' : 'doing'
        out.push(c)
      }
      return out
    },
  },
  {
    id: 'retro',
    name: 'Retrospective',
    description: 'What went well, what to improve, actions',
    category: 'Agile',
    accent: '#30a46c',
    build() {
      const out = columns(['😀  Went well', '🤔  To improve', '🚀  Action items'], ['#effaf1', '#fff4ec', '#f4f6ff'], 520, 760, 40)
      const fills = ['#b8e994', '#ffc46b', '#9fd3ff']
      fills.forEach((f, i) => {
        for (let k = 0; k < 4; k++) out.push(sticky(i * 560 + 40 + (k % 2) * 230, 90 + Math.floor(k / 2) * 230, f, '', 200, 200))
      })
      return out
    },
  },
  {
    id: 'mindmap',
    name: 'Mind map',
    description: 'Tab adds a child, Enter adds a sibling',
    category: 'Ideate',
    accent: '#8e4ec6',
    build() {
      const root = makeMind(0, 0, 'Product launch')
      root.side = 'both'
      root.w = 220
      const out: BoardObj[] = [root]
      const branches: [string, string, string[]][] = [
        ['Audience', '#4262ff', ['Creators', 'Teams', 'Students']],
        ['Channels', '#e5484d', ['Social', 'Newsletter']],
        ['Timeline', '#30a46c', ['Beta — May', 'Launch — June']],
        ['Messaging', '#f76b15', ['Offline first', 'Fast & private']],
      ]
      for (const [t, c, kids] of branches) {
        const b = makeMind(0, 0, t, root.id, c)
        out.push(b)
        for (const k of kids) out.push(makeMind(0, 0, k, b.id, c))
      }
      const objs: Record<ID, BoardObj> = Object.fromEntries(out.map((o) => [o.id, o]))
      const p = layoutMind(objs, out.map((o) => o.id), root.id)
      return out.map((o) => (p[o.id] ? { ...o, ...p[o.id] } : o))
    },
  },
  {
    id: 'flowchart',
    name: 'Flowchart',
    description: 'Start, steps, a decision and connectors',
    category: 'Diagram',
    accent: '#12a594',
    build() {
      const start: ShapeObj = { ...makeShape('round', 0, 0, 200, 80), text: 'Start', fill: '#d3f9d8' }
      const step: ShapeObj = { ...makeShape('rect', 0, 180, 200, 100), text: 'Fill in the form' }
      const dec: ShapeObj = { ...makeShape('diamond', -10, 380, 220, 140), text: 'Valid?', fill: '#fff3bf' }
      const ok: ShapeObj = { ...makeShape('rect', 0, 620, 200, 100), text: 'Save & confirm' }
      const fix: ShapeObj = { ...makeShape('rect', 340, 400, 200, 100), text: 'Show errors', fill: '#ffe3e3' }
      const end: ShapeObj = { ...makeShape('round', 0, 820, 200, 80), text: 'End', fill: '#d3f9d8' }
      const c = (a: ShapeObj, b: ShapeObj, label = '', af?: 'right' | 'top', bt?: 'top' | 'right') => {
        const k = makeConnector({ id: a.id, anchor: af ?? 'auto', x: 0, y: 0 }, { id: b.id, anchor: bt ?? 'auto', x: 0, y: 0 }, 'elbow')
        k.label = label
        return k
      }
      return [start, step, dec, ok, fix, end, c(start, step), c(step, dec), c(dec, ok, 'Yes'), c(dec, fix, 'No', 'right'), c(fix, step, '', 'top', 'right'), c(ok, end)]
    },
  },
  {
    id: 'swot',
    name: 'SWOT analysis',
    description: 'Strengths, weaknesses, opportunities, threats',
    category: 'Strategy',
    accent: '#e5484d',
    build() {
      const q: [string, string, string, number, number][] = [
        ['Strengths', '#effaf1', '#b8e994', 0, 0],
        ['Weaknesses', '#fff1f0', '#ffb3a1', 1, 0],
        ['Opportunities', '#f4f6ff', '#9fd3ff', 0, 1],
        ['Threats', '#fff8e1', '#ffc46b', 1, 1],
      ]
      const out: BoardObj[] = []
      for (const [n, bg, st, cx, cy] of q) {
        const f = makeFrame(cx * 620, cy * 520, 600, 500, n)
        f.fill = bg
        out.push(f)
        for (let k = 0; k < 3; k++) out.push(sticky(cx * 620 + 30 + k * 190, cy * 520 + 60, st, '', 170, 170))
      }
      return out
    },
  },
  {
    id: 'eisenhower',
    name: 'Priority matrix',
    description: 'Urgent vs important — decide what to do first',
    category: 'Plan',
    accent: '#f76b15',
    build() {
      const out: BoardObj[] = []
      const labels: [string, string, number, number][] = [
        ['Do first', '#ffe3e3', 0, 0], ['Schedule', '#fff3bf', 1, 0], ['Delegate', '#d0ebff', 0, 1], ['Drop', '#f3f4f6', 1, 1],
      ]
      for (const [n, c, cx, cy] of labels) {
        const f = makeFrame(cx * 520, cy * 420, 500, 400, n)
        f.fill = c
        out.push(f)
      }
      out.push({ ...title(-150, 360, 'Important', 28), rotation: -90 })
      out.push(title(380, -90, 'Urgent  →  Not urgent', 28))
      return out
    },
  },
  {
    id: 'weekly',
    name: 'Weekly planner',
    description: 'Seven days of focus and to-dos',
    category: 'Plan',
    accent: '#0090ff',
    build() {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const out = columns(days, ['#ffffff'], 260, 640, 20)
      days.forEach((_, i) => out.push(sticky(i * 280 + 30, 80, i < 5 ? '#fff9b1' : '#f7a8cf', '', 200, 160)))
      return out
    },
  },
  {
    id: 'storymap',
    name: 'User story map',
    description: 'Activities across, stories beneath, releases as rows',
    category: 'Agile',
    accent: '#d6409f',
    build() {
      const acts = ['Discover', 'Sign up', 'Create board', 'Collaborate', 'Share']
      const out: BoardObj[] = []
      acts.forEach((a, i) => {
        out.push({ ...makeShape('round', i * 240, 0, 220, 90), text: a, fill: '#1a1a2e', color: '#ffffff', stroke: '#1a1a2e', bold: true })
        for (let r = 0; r < 2; r++) out.push(sticky(i * 240 + 10, 140 + r * 220, r ? '#9fd3ff' : '#fff176', '', 200, 190))
      })
      out.push({ ...title(-280, 210, 'Release 1', 26) }, { ...title(-280, 430, 'Release 2', 26) })
      return out
    },
  },
  {
    id: 'lean',
    name: 'Lean canvas',
    description: 'One-page business model',
    category: 'Strategy',
    accent: '#30a46c',
    build() {
      const W = 260, H = 300
      const cells: [string, number, number, number, number][] = [
        ['Problem', 0, 0, 1, 2], ['Solution', 1, 0, 1, 1], ['Key metrics', 1, 1, 1, 1], ['Unique value', 2, 0, 1, 2],
        ['Unfair advantage', 3, 0, 1, 1], ['Channels', 3, 1, 1, 1], ['Customer segments', 4, 0, 1, 2],
        ['Cost structure', 0, 2, 2.5, 0.8], ['Revenue streams', 2.5, 2, 2.5, 0.8],
      ]
      return cells.map(([n, cx, cy, cw, ch]) => {
        const f = makeFrame(cx * W, cy * H, cw * W - 12, ch * H - 12, n)
        f.fill = '#ffffff'
        return f
      })
    },
  },
]

/** Template objects re-centred around (cx, cy), with fresh ids and connector refs remapped */
export function instantiate(t: Template, cx: number, cy: number): BoardObj[] {
  const objs = t.build()
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const o of objs) {
    if (o.kind === 'connector') continue
    x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y)
    x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + o.h)
  }
  const dx = cx - (x0 + x1) / 2, dy = cy - (y0 + y1) / 2
  return objs.map((o) => (o.kind === 'connector' ? o : { ...o, x: o.x + dx, y: o.y + dy }))
}
