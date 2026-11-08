/** Jiro's assistant adapter: board knowledge and whiteboard tools for the shared Skill AI agent. */
import { clusterByColor, sortByText, textOf, tidyUp } from '@/board/actions'
import { layoutFlow, freeSpot } from '@/board/diagram'
import { exportPng } from '@/board/exporter'
import {
  CARD_TAGS, inkFor, makeCard, makeConnector, makeEmoji, makeFrame, makeMind, makeShape, makeSticky, makeText, MIND_COLORS, STICKY_COLORS,
} from '@/board/factory'
import { rotatedBounds } from '@/board/geometry'
import { layoutMind, mindWidthFor } from '@/board/mindmap'
import { SHAPES } from '@/board/shapes'
import { boundsOf, useBoard } from '@/board/store'
import { TEMPLATES } from '@/board/templates'
import type { Anchor, BoardObj, ID, MindObj, ShapeKind } from '@/board/types'
import { stage, viewCenter, visibleRect, zoomToRect } from '@/canvas/viewport'
import { insertTemplate } from '@/ui/CommandPalette'
import { setAssignees, todayIso } from '@/team/collab'
import { everyone, MEMBER_COLORS, toPerson } from '@/team/team'
import type { Person } from '@/board/types'
import type { AppAdapter, AppTool } from './agent'

/** A teammate by (case-insensitive, prefix-tolerant) name; unknown names become ad-hoc people */
function personByName(name: string): Person {
  const n = name.trim().toLowerCase()
  const all = everyone()
  const m = all.find((x) => x.name.toLowerCase() === n) ?? all.find((x) => x.name.toLowerCase().startsWith(n)) ?? (n === 'me' ? all[0] : undefined)
  return m ? toPerson(m) : { id: 'adhoc:' + n, name: name.trim(), color: MEMBER_COLORS[n.length % MEMBER_COLORS.length] }
}

const st = () => useBoard.getState()
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : undefined)
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const arr = <T = Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const STICKY_NAMES: Record<string, string> = Object.fromEntries(STICKY_COLORS.map((c) => [c.name.toLowerCase(), c.fill]))
const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#1a1a2e', ink: '#1a1a2e', gray: '#6b7280', grey: '#6b7280', red: '#e5484d', orange: '#f76b15', amber: '#ffc53d', yellow: '#ffd02f',
  green: '#30a46c', teal: '#12a594', cyan: '#12a594', blue: '#0090ff', indigo: '#3e63dd', violet: '#8e4ec6', purple: '#8e4ec6', pink: '#d6409f', transparent: 'transparent', none: 'transparent',
}
/** Accepts #hex or a colour name; sticky names map to the sticky palette */
function color(v: unknown, sticky = false): string | undefined {
  const s = str(v).trim().toLowerCase()
  if (!s) return undefined
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + Array.from(s.slice(1)).map((c) => c + c).join('')
  if (sticky && STICKY_NAMES[s]) return STICKY_NAMES[s]
  if (sticky && s === 'purple') return STICKY_NAMES.violet
  return NAMED[s] ?? STICKY_NAMES[s]
}

function describe(o: BoardObj): string {
  const t = textOf(o).replace(/\s+/g, ' ').trim()
  const parts = [o.id, o.kind]
  if (o.kind === 'shape') parts.push(o.shape)
  if (t) parts.push(JSON.stringify(t.length > 160 ? t.slice(0, 160) + '…' : t))
  if (o.kind !== 'connector') parts.push(`@${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.w)}×${Math.round(o.h)}`)
  if ('fill' in o) parts.push(`fill ${o.fill}`)
  if (o.kind === 'card') parts.push(`tag ${o.tag} status ${o.status ?? 'todo'}${o.assignees?.length ? ' assignees ' + o.assignees.map((p) => p.name).join(', ') : o.assignee ? ' assignee ' + o.assignee : ''}${o.due ? ' due ' + o.due : ''}${o.priority ? ' priority ' + o.priority : ''}`)
  if (o.kind === 'mind') parts.push(o.parent ? `parent ${o.parent}` : 'root')
  if (o.kind === 'connector') parts.push(`${o.from.id ?? 'free'} → ${o.to.id ?? 'free'} ${o.style}`)
  if (o.votes) parts.push(`votes ${o.votes}`)
  if (o.locked) parts.push('locked')
  if (o.groupId) parts.push(`group ${o.groupId}`)
  return parts.join(' · ')
}

/** Add objects (frames behind) as one undo step and show them */
function place(objs: BoardObj[], opts: { zoom?: boolean; select?: boolean } = {}) {
  if (!objs.length) return
  const s = st()
  s.checkpoint()
  const frames = objs.filter((o) => o.kind === 'frame')
  const rest = objs.filter((o) => o.kind !== 'frame')
  if (frames.length) s.add(frames, { back: true, history: false, select: false })
  if (rest.length) s.add(rest, { history: false, select: false })
  if (opts.select !== false) s.select(objs.map((o) => o.id))
  if (opts.zoom !== false) {
    const b = boundsOf(objs.map((o) => o.id), st().doc!.objects)
    const v = visibleRect(s.vp, 0)
    if (b && !(b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h)) zoomToRect(b, { maxZoom: 1 })
  }
}

const SHAPE_KINDS = SHAPES.map((s) => s.kind)
const FLOW_TYPES: Record<string, { shape: ShapeKind; w: number; h: number; fill: string }> = {
  start: { shape: 'round', w: 200, h: 80, fill: '#d3f9d8' },
  end: { shape: 'round', w: 200, h: 80, fill: '#ffe3e3' },
  step: { shape: 'rect', w: 220, h: 100, fill: '#ffffff' },
  decision: { shape: 'diamond', w: 240, h: 150, fill: '#fff3bf' },
  io: { shape: 'parallelogram', w: 240, h: 100, fill: '#d0ebff' },
  data: { shape: 'cylinder', w: 200, h: 120, fill: '#e5dbff' },
}

interface MindIn {
  text?: string
  children?: MindIn[]
}

const tools = (): AppTool[] => [
  {
    name: 'get_board',
    description: 'Read the board: every item with id, kind, text, position/size, colours, mind-map parents and connector ends. Pass ids to read only those (e.g. the selection).',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Only these items (optional).' } } },
    run: ({ ids }) => {
      const { doc } = st()
      if (!doc) throw new Error('No board is open.')
      const want = arr<string>(ids)
      const list = (want.length ? want : doc.order).map((id) => doc.objects[id]).filter(Boolean)
      if (!list.length) return 'The board is empty.'
      const lines = list.slice(0, 600).map((o) => describe(o))
      return lines.join('\n') + (list.length > 600 ? `\n… and ${list.length - 600} more` : '')
    },
  },
  {
    name: 'create_stickies',
    description: 'Add sticky notes laid out in a tidy grid in free space near the user\'s view (or at x,y). Optionally wrap them in a titled frame. Use for brainstorms, lists of ideas, research notes.',
    parameters: {
      type: 'object',
      properties: {
        notes: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, color: { type: 'string', description: `Sticky colour name (${STICKY_COLORS.map((c) => c.name.toLowerCase()).join(', ')}) or #hex.` } }, required: ['text'] } },
        columns: { type: 'number', description: 'Grid columns (default: roughly square).' },
        frame_title: { type: 'string', description: 'Wrap the notes in a frame with this title.' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['notes'],
    },
    run: ({ notes, columns, frame_title, x, y }) => {
      const list = arr<{ text?: unknown; color?: unknown }>(notes).slice(0, 200)
      if (!list.length) throw new Error('No notes given.')
      const cols = Math.max(1, Math.min(12, Math.round(num(columns) ?? Math.ceil(Math.sqrt(list.length)))))
      const rows = Math.ceil(list.length / cols)
      const S = 200, G = 24, pad = frame_title ? 48 : 0
      const W = cols * S + (cols - 1) * G + pad * 2, H = rows * S + (rows - 1) * G + pad * 2
      const d = st().doc!
      const at = num(x) !== undefined && num(y) !== undefined ? { x: num(x)!, y: num(y)! } : freeSpot(W, H, viewCenter(), d.objects, d.order)
      const fill0 = st().opts.stickyColor
      const out: BoardObj[] = []
      if (frame_title) out.push(makeFrame(at.x, at.y, W, H, str(frame_title)))
      list.forEach((n, i) => {
        const fill = color(n.color, true) ?? fill0
        out.push(makeSticky(at.x + pad + (i % cols) * (S + G), at.y + pad + Math.floor(i / cols) * (S + G), fill, str(n.text)))
      })
      place(out)
      return `Added ${list.length} stickies${frame_title ? ' in a frame' : ''}: ${out.filter((o) => o.kind === 'sticky').map((o) => o.id).join(', ')}${frame_title ? ` (frame ${out[0].id})` : ''}`
    },
  },
  {
    name: 'create_items',
    description: 'Add items at exact board positions (x,y = top-left). Kinds: sticky, shape, text, card, frame, emoji. Shapes: ' + SHAPE_KINDS.join(', ') + '. Returns ids in order.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['sticky', 'shape', 'text', 'card', 'frame', 'emoji'] },
              text: { type: 'string', description: 'Text / card title / frame title / emoji character.' },
              body: { type: 'string', description: 'Card description.' },
              x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
              shape: { type: 'string', enum: SHAPE_KINDS },
              fill: { type: 'string', description: 'Fill colour (#hex or name).' },
              stroke: { type: 'string' },
              color: { type: 'string', description: 'Text colour.' },
              font_size: { type: 'number', description: '0 = auto-fit (stickies/shapes).' },
              bold: { type: 'boolean' },
              tag: { type: 'string', description: 'Card tag colour.' },
              status: { type: 'string', enum: ['todo', 'doing', 'done'] },
              assignees: { type: 'array', items: { type: 'string' }, description: 'Card assignees by teammate name (see list_team).' },
              due: { type: 'string', description: 'Card due date YYYY-MM-DD.' },
            },
            required: ['kind', 'x', 'y'],
          },
        },
      },
      required: ['items'],
    },
    run: ({ items }) => {
      const out: BoardObj[] = []
      for (const it of arr(items).slice(0, 300)) {
        const x = num(it.x) ?? 0, y = num(it.y) ?? 0
        const text = str(it.text)
        let o: BoardObj
        switch (it.kind) {
          case 'sticky': o = makeSticky(x, y, color(it.fill, true) ?? st().opts.stickyColor, text); break
          case 'shape': {
            const shape = SHAPE_KINDS.includes(it.shape as ShapeKind) ? (it.shape as ShapeKind) : 'rect'
            o = { ...makeShape(shape, x, y), text }
            const f = color(it.fill)
            if (f) Object.assign(o, { fill: f, color: f === 'transparent' ? '#1a1a2e' : inkFor(f) })
            break
          }
          case 'text': o = { ...makeText(x, y, text), autoWidth: !num(it.w) }; break
          case 'card': {
            o = { ...makeCard(x, y, text || 'Card', color(it.tag) ?? CARD_TAGS[0]), body: str(it.body) }
            if (['todo', 'doing', 'done'].includes(str(it.status))) o.status = it.status as 'todo'
            if (arr(it.assignees).length) o.assignees = arr<string>(it.assignees).map(personByName)
            if (/^\d{4}-\d{2}-\d{2}$/.test(str(it.due))) o.due = str(it.due)
            break
          }
          case 'frame': o = makeFrame(x, y, num(it.w) ?? 800, num(it.h) ?? 560, text || 'Frame'); if (color(it.fill)) o.fill = color(it.fill)!; break
          case 'emoji': o = makeEmoji(x, y, text || '👍'); break
          default: throw new Error(`Unknown kind "${str(it.kind)}".`)
        }
        if (num(it.w) && o.kind !== 'emoji') o.w = num(it.w)!
        if (num(it.h) && o.kind !== 'emoji') o.h = num(it.h)!
        if ('stroke' in o && color(it.stroke)) o.stroke = color(it.stroke)!
        if ('fontSize' in o && num(it.font_size) !== undefined) o.fontSize = num(it.font_size)!
        if ('color' in o && typeof o.color === 'string' && color(it.color)) (o as { color: string }).color = color(it.color)!
        if ((o.kind === 'sticky' || o.kind === 'shape' || o.kind === 'text') && typeof it.bold === 'boolean') o.bold = it.bold
        out.push(o)
      }
      place(out)
      return `Created ${out.length} item(s): ${out.map((o) => `${o.id} (${o.kind})`).join(', ')}`
    },
  },
  {
    name: 'connect',
    description: 'Draw connector lines between items by id. They stay attached when items move.',
    parameters: {
      type: 'object',
      properties: {
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' },
              style: { type: 'string', enum: ['curve', 'elbow', 'straight'] },
              arrow: { type: 'boolean', description: 'Arrow at the end (default true).' },
              dashed: { type: 'boolean' },
            },
            required: ['from', 'to'],
          },
        },
      },
      required: ['links'],
    },
    run: ({ links }) => {
      const d = st().doc!
      const out: BoardObj[] = []
      for (const l of arr(links)) {
        const a = str(l.from), b = str(l.to)
        if (!d.objects[a] || !d.objects[b]) throw new Error(`Unknown id in link ${a} → ${b}. Read the board first.`)
        const c = makeConnector({ id: a, anchor: 'auto', x: 0, y: 0 }, { id: b, anchor: 'auto', x: 0, y: 0 }, (['curve', 'elbow', 'straight'].includes(str(l.style)) ? l.style : st().opts.connectorStyle) as 'curve')
        c.label = str(l.label)
        if (l.arrow === false) c.endCap = 'none'
        if (l.dashed) c.dash = 'dashed'
        out.push(c)
      }
      place(out, { zoom: false, select: false })
      return `Connected ${out.length} link(s).`
    },
  },
  {
    name: 'update_items',
    description: 'Change existing items: text, position, size, colours, font size, card fields, frame title, rotation, lock.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, text: { type: 'string' }, body: { type: 'string' },
              x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, rotation: { type: 'number' },
              fill: { type: 'string' }, stroke: { type: 'string' }, color: { type: 'string' }, tag: { type: 'string' },
              font_size: { type: 'number' }, bold: { type: 'boolean' },
              status: { type: 'string', enum: ['todo', 'doing', 'done'] }, assignees: { type: 'array', items: { type: 'string' }, description: 'Replace card assignees (teammate names).' },
              due: { type: 'string', description: 'YYYY-MM-DD, or "" to clear.' }, priority: { type: 'string', enum: ['low', 'medium', 'high', ''] }, locked: { type: 'boolean' },
            },
            required: ['id'],
          },
        },
      },
      required: ['updates'],
    },
    run: ({ updates }) => {
      const d = st().doc!
      const patches: Record<ID, Partial<BoardObj>> = {}
      for (const u of arr(updates)) {
        const o = d.objects[str(u.id)]
        if (!o) throw new Error(`No item "${str(u.id)}".`)
        const p: Record<string, unknown> = {}
        for (const k of ['x', 'y', 'w', 'h', 'rotation'] as const) if (num(u[k]) !== undefined) p[k] = num(u[k])
        if (u.text !== undefined) {
          if (o.kind === 'frame') p.title = str(u.text)
          else if (o.kind === 'card') p.title = str(u.text)
          else if (o.kind === 'connector') p.label = str(u.text)
          else if (o.kind === 'emoji') p.char = str(u.text)
          else if ('text' in o) p.text = str(u.text)
          if (o.kind === 'mind') p.w = mindWidthFor(str(u.text), !o.parent)
        }
        if (u.body !== undefined && o.kind === 'card') p.body = str(u.body)
        const f = color(u.fill, o.kind === 'sticky')
        if (f && 'fill' in o) Object.assign(p, { fill: f }, o.kind === 'sticky' || o.kind === 'shape' ? { color: f === 'transparent' ? '#1a1a2e' : inkFor(f) } : {})
        if (f && o.kind === 'mind') p.color = f
        if (color(u.stroke) && 'stroke' in o) p.stroke = color(u.stroke)
        if (color(u.color) && 'color' in o) p.color = color(u.color)
        if (color(u.tag) && o.kind === 'card') p.tag = color(u.tag)
        if (num(u.font_size) !== undefined && 'fontSize' in o) p.fontSize = num(u.font_size)
        if (typeof u.bold === 'boolean') p.bold = u.bold
        if (o.kind === 'card' && ['todo', 'doing', 'done'].includes(str(u.status))) p.status = u.status
        if (o.kind === 'card' && Array.isArray(u.assignees)) { setAssignees(o.id, arr<string>(u.assignees).map(personByName)); }
        if (o.kind === 'card' && u.due !== undefined) p.due = /^\d{4}-\d{2}-\d{2}$/.test(str(u.due)) ? str(u.due) : undefined
        if (o.kind === 'card' && u.priority !== undefined) p.priority = ['low', 'medium', 'high'].includes(str(u.priority)) ? u.priority : undefined
        if (typeof u.locked === 'boolean') p.locked = u.locked
        patches[o.id] = p as Partial<BoardObj>
      }
      st().updateMany(patches)
      return `Updated ${Object.keys(patches).length} item(s).`
    },
  },
  {
    name: 'delete_items',
    description: 'Delete items by id (attached connectors and mind-map subtrees go too).',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    run: ({ ids }) => {
      const d = st().doc!
      const list = arr<string>(ids).filter((id) => d.objects[id])
      st().remove(list)
      return `Deleted ${list.length} item(s).`
    },
  },
  {
    name: 'create_mind_map',
    description: 'Build a mind map from a nested outline. It is laid out automatically (children to the right, or both sides). Users extend it with Tab / Enter.',
    parameters: {
      type: 'object',
      properties: {
        root: {
          type: 'object',
          description: 'The central topic: { text, children: [{ text, children: [...] }] }. Keep labels short (1–5 words).',
          properties: { text: { type: 'string' }, children: { type: 'array', items: { type: 'object' } } },
          required: ['text'],
        },
        both_sides: { type: 'boolean', description: 'Spread first-level branches left and right (default true when there are 4+ branches).' },
      },
      required: ['root'],
    },
    run: ({ root, both_sides }) => {
      const r = root as MindIn
      if (!r?.text) throw new Error('The root needs text.')
      const all: MindObj[] = []
      const rootObj = makeMind(0, 0, str(r.text))
      rootObj.w = mindWidthFor(rootObj.text, true)
      all.push(rootObj)
      const walk = (n: MindIn, parent: MindObj, colorOf: string | null, depth: number) => {
        arr<MindIn>(n.children).slice(0, 40).forEach((c, i) => {
          if (all.length > 300) return
          const col = colorOf ?? MIND_COLORS[i % MIND_COLORS.length]
          const m = makeMind(0, 0, str(c.text), parent.id, col)
          m.w = mindWidthFor(m.text, false)
          all.push(m)
          if (depth < 6) walk(c, m, col, depth + 1)
        })
      }
      walk(r, rootObj, null, 1)
      const kids = arr(r.children).length
      rootObj.side = (both_sides ?? kids >= 4) ? 'both' : 'right'
      const objs: Record<ID, BoardObj> = Object.fromEntries(all.map((o) => [o.id, o]))
      const order = all.map((o) => o.id)
      Object.entries(layoutMind(objs, order, rootObj.id)).forEach(([id, p]) => Object.assign(objs[id], p))
      const b = boundsOf(order, objs)!
      const d = st().doc!
      const at = freeSpot(b.w, b.h, viewCenter(), d.objects, d.order)
      const dx = at.x - b.x, dy = at.y - b.y
      for (const o of all) {
        o.x += dx
        o.y += dy
      }
      place(all)
      return `Mind map with ${all.length} nodes; root ${rootObj.id}.`
    },
  },
  {
    name: 'create_flowchart',
    description: 'Build a flowchart from nodes and edges; shapes, sizes and the layered layout are chosen automatically. Node types: start, end, step, decision, io, data. Label decision branches (e.g. "Yes"/"No"). Loops back to earlier steps are fine.',
    parameters: {
      type: 'object',
      properties: {
        nodes: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, text: { type: 'string' }, type: { type: 'string', enum: Object.keys(FLOW_TYPES) } }, required: ['key', 'text'] } },
        edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
        direction: { type: 'string', enum: ['down', 'right'] },
        title: { type: 'string', description: 'Optional frame title around the chart.' },
      },
      required: ['nodes', 'edges'],
    },
    run: ({ nodes, edges, direction, title }) => {
      const ns = arr(nodes).slice(0, 120)
      if (!ns.length) throw new Error('No nodes.')
      const spec = ns.map((n) => ({ n, t: FLOW_TYPES[str(n.type)] ?? FLOW_TYPES.step }))
      const dir = direction === 'right' ? 'right' : 'down'
      const pos = layoutFlow(spec.map(({ n, t }) => ({ key: str(n.key), w: t.w, h: t.h })), arr(edges).map((e) => ({ from: str(e.from), to: str(e.to) })), dir)
      const shapes = new Map<string, BoardObj>()
      for (const { n, t } of spec) {
        const p = pos[str(n.key)] ?? { x: 0, y: 0 }
        const s = { ...makeShape(t.shape, p.x, p.y, t.w, t.h), text: str(n.text), fill: t.fill }
        shapes.set(str(n.key), s)
      }
      const all = [...shapes.values()]
      const b = boundsOf(all.map((o) => o.id), Object.fromEntries(all.map((o) => [o.id, o])))!
      const pad = title ? 60 : 0
      const d = st().doc!
      const at = freeSpot(b.w + pad * 2, b.h + pad * 2, viewCenter(), d.objects, d.order)
      for (const o of all) {
        o.x += at.x + pad - b.x
        o.y += at.y + pad - b.y
      }
      const out: BoardObj[] = []
      if (title) out.push(makeFrame(at.x, at.y, b.w + pad * 2, b.h + pad * 2, str(title)))
      out.push(...all)
      const midX = at.x + pad + b.w / 2, midY = at.y + pad + b.h / 2
      for (const e of arr(edges)) {
        const a = shapes.get(str(e.from)), c = shapes.get(str(e.to))
        if (!a || !c) continue
        // Loops back to an earlier step go round the side instead of over the main line
        const backward = dir === 'down' ? c.y + c.h <= a.y : c.x + c.w <= a.x
        let fa: Anchor = 'auto', ta: Anchor = 'auto'
        if (backward) {
          if (dir === 'down') fa = ta = a.x + a.w / 2 <= midX ? 'left' : 'right'
          else fa = ta = a.y + a.h / 2 <= midY ? 'top' : 'bottom'
        }
        const k = makeConnector({ id: a.id, anchor: fa, x: 0, y: 0 }, { id: c.id, anchor: ta, x: 0, y: 0 }, 'elbow')
        k.label = str(e.label)
        out.push(k)
      }
      place(out)
      return `Flowchart with ${all.length} shapes and ${out.filter((o) => o.kind === 'connector').length} connectors. Ids by key: ${[...shapes].map(([k, o]) => `${k}=${o.id}`).join(', ')}`
    },
  },
  {
    name: 'cluster_stickies',
    description: 'Affinity-map existing items into themed groups: each cluster becomes a titled frame holding its items in a grid, laid out side by side where the items were. Decide the themes yourself from the text (read the board first).',
    parameters: {
      type: 'object',
      properties: {
        clusters: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['title', 'ids'] } },
        recolor: { type: 'boolean', description: 'Give each cluster its own sticky colour.' },
      },
      required: ['clusters'],
    },
    run: ({ clusters, recolor }) => {
      const d = st().doc!
      const cls = arr(clusters).map((c) => ({ title: str(c.title), ids: arr<string>(c.ids).filter((id) => d.objects[id] && d.objects[id].kind !== 'connector') })).filter((c) => c.ids.length)
      if (!cls.length) throw new Error('No valid ids in the clusters.')
      const all = cls.flatMap((c) => c.ids)
      const origin = boundsOf(all, d.objects)!
      const s = st()
      s.checkpoint()
      const palette = ['#fff176', '#9fd3ff', '#f7a8cf', '#b8e994', '#ffc46b', '#c9b6ff', '#9be7e0', '#ffb3a1', '#dbf08c', '#e2e2e2']
      const pad = 40, G = 20, GAP = 60
      // Measure every cluster first, then find room for the whole arrangement
      const dims = cls.map((c) => {
        const items = c.ids.map((id) => d.objects[id])
        const cw = Math.max(...items.map((o) => o.w)), ch = Math.max(...items.map((o) => o.h))
        const cols = items.length > 6 ? 3 : items.length >= 2 ? 2 : 1
        const rows = Math.ceil(items.length / cols)
        return { items, cw, ch, cols, fw: cols * cw + (cols - 1) * G + pad * 2, fh: rows * ch + (rows - 1) * G + pad * 2 }
      })
      const W = dims.reduce((t, m) => t + m.fw, 0) + GAP * (dims.length - 1)
      const H = Math.max(...dims.map((m) => m.fh))
      const moving = new Set(all)
      const others = d.order.filter((id) => !moving.has(id))
      const at = freeSpot(W, H, { x: origin.x + W / 2, y: origin.y + H / 2 }, d.objects, others)
      const patches: Record<ID, Partial<BoardObj>> = {}
      const frames: BoardObj[] = []
      let x = at.x
      dims.forEach((m, ci) => {
        m.items.forEach((o, i) => {
          const p: Record<string, unknown> = { x: x + pad + (i % m.cols) * (m.cw + G), y: at.y + pad + Math.floor(i / m.cols) * (m.ch + G) }
          if (recolor && o.kind === 'sticky') Object.assign(p, { fill: palette[ci % palette.length], color: '#1a1a2e' })
          patches[o.id] = p as Partial<BoardObj>
        })
        frames.push(makeFrame(x, at.y, m.fw, m.fh, cls[ci].title))
        x += m.fw + GAP
      })
      s.updateMany(patches, { history: false })
      s.add(frames, { back: true, history: false, select: false })
      s.select(frames.map((f) => f.id))
      const b = boundsOf(frames.map((f) => f.id), st().doc!.objects)
      if (b) zoomToRect(b, { maxZoom: 1 })
      return `Arranged ${all.length} items into ${cls.length} clusters: ${cls.map((c, i) => `${c.title} (${frames[i].id})`).join(', ')}.`
    },
  },
  {
    name: 'organize',
    description: 'Tidy items into a grid, cluster them by colour, or sort them A→Z in place.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['tidy', 'by_color', 'sort'] } }, required: ['ids', 'mode'] },
    run: ({ ids, mode }) => {
      st().select(arr<string>(ids))
      if (mode === 'tidy') tidyUp()
      else if (mode === 'by_color') clusterByColor()
      else sortByText()
      return `Done (${str(mode)}).`
    },
  },
  {
    name: 'add_template',
    description: 'Insert a ready-made template next to the existing work. Ids: ' + TEMPLATES.map((t) => `${t.id} (${t.name})`).join(', '),
    parameters: { type: 'object', properties: { id: { type: 'string', enum: TEMPLATES.map((t) => t.id) } }, required: ['id'] },
    run: ({ id }) => {
      if (!TEMPLATES.some((t) => t.id === id)) throw new Error('Unknown template.')
      const before = new Set(st().doc!.order)
      insertTemplate(str(id))
      const added = st().doc!.order.filter((x) => !before.has(x))
      return `Inserted ${str(id)}: ${added.length} items. New ids: ${added.slice(0, 80).join(', ')}`
    },
  },
  {
    name: 'list_team',
    description: 'The user (me) and their teammates with roles and contact details, for assigning tasks.',
    parameters: { type: 'object', properties: {} },
    run: () => everyone().map((m, i) => `${m.name}${i === 0 ? ' (me)' : ''}${m.role ? ' — ' + m.role : ''}${m.email ? ' · ' + m.email : ''}`).join('\n'),
  },
  {
    name: 'focus',
    description: 'Select items and fly the view to them so the user sees the result.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    run: ({ ids }) => {
      const d = st().doc!
      const list = arr<string>(ids).filter((id) => d.objects[id])
      st().select(list)
      const b = boundsOf(list, d.objects)
      if (b) zoomToRect(b, { maxZoom: 1.5 })
      return `Showing ${list.length} item(s).`
    },
  },
]

export const jiroAdapter: AppAdapter = {
  app: 'Jiro',
  get system() {
    return `Jiro is an infinite whiteboard (like Miro / FigJam) for brainstorming, planning, diagrams and workshops. Board coordinates are in px; x grows right, y grows down; items have a top-left x,y and w,h. A sticky is 200×200.
Team: cards can be assigned to teammates (list_team; assign with create_items / update_items "assignees" by name) and have a due date and priority. Today is ${todayIso()}. Use them when the user talks about owners, deadlines or "who does what".
Item kinds: sticky (fill colour, text auto-fits), shape (${SHAPE_KINDS.join('/')}, fill, stroke, text), text, card (kanban card: title, body, tag colour, status todo/doing/done, assignee), frame (titled area; also a presentation slide; holds what is inside it), mind (mind-map node with parent), connector (line between two ids), pen, image, emoji, comment.
Prefer the structured tools: create_stickies for ideas and lists, create_mind_map for hierarchies, create_flowchart for processes, cluster_stickies for affinity mapping / grouping by theme, create_items for exact layouts (kanban columns = frames + cards). They place things in free space so existing work is never covered.
When the user says "these", "selected" or "this", use the selected ids from the context. Write sticky text short and concrete (under ~12 words). Use colour meaningfully (one colour per theme or category).`
  },
  tools,
  context: () => {
    const { doc, selection, vp } = st()
    if (!doc) return 'No board open.'
    const counts: Record<string, number> = {}
    for (const id of doc.order) counts[doc.objects[id].kind] = (counts[doc.objects[id].kind] ?? 0) + 1
    const c = viewCenter()
    const sel = selection.slice(0, 40).map((id) => describe(doc.objects[id]))
    return [
      `Board "${doc.name}": ${doc.order.length} items (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || 'empty'}).`,
      `View centre ${Math.round(c.x)},${Math.round(c.y)} at zoom ${vp.zoom.toFixed(2)} (${Math.round(stage.w / vp.zoom)}×${Math.round(stage.h / vp.zoom)} board px visible).`,
      sel.length ? `Selected (${selection.length}):\n${sel.join('\n')}` : 'Nothing selected.',
    ].join('\n')
  },
  snapshot: async () => {
    const { doc, vp } = st()
    if (!doc || !doc.order.length) return null
    const v = visibleRect(vp, 0)
    const ids = doc.order.filter((id) => {
      const o = doc.objects[id]
      if (o.kind === 'connector') return true
      const b = rotatedBounds(o)
      return b.x < v.x + v.w && b.x + b.w > v.x && b.y < v.y + v.h && b.y + b.h > v.y
    })
    if (!ids.length) return null
    const b = boundsOf(ids, doc.objects)!
    const blob = await exportPng(doc, { ids, scale: Math.min(1, 1024 / Math.max(b.w, b.h)), background: '#f4f3ef', padding: 24 })
    if (!blob) return null
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d')!.drawImage(bmp, 0, 0)
    return c.toDataURL('image/jpeg', 0.82)
  },
  starters: [
    { label: 'Brainstorm ideas', prompt: 'Brainstorm 12 ideas for growing a small online business, as stickies in a frame, coloured by category.' },
    { label: 'Cluster my stickies by theme', prompt: 'Group all the sticky notes on the board into themed clusters with clear titles.' },
    { label: 'Mind map a topic', prompt: 'Make a mind map for planning a product launch.' },
    { label: 'Flowchart a process', prompt: 'Draw a flowchart of a user signing up, verifying their email and logging in, including the failure paths.' },
    { label: 'Summarize this board', prompt: 'Read the board and summarize the key points and decisions in a text block next to the content.' },
    { label: 'Turn selection into tasks', prompt: 'Turn the selected stickies into kanban cards in To do / Doing / Done frames.' },
  ],
  checkpoint: () => {
    const d = st().doc
    return d ? { id: d.id, objects: d.objects, order: d.order } : null
  },
  revertTo: (mark) => {
    const m = mark as { id: string; objects: BoardDoc['objects']; order: string[] } | null
    const s = st()
    if (!m || !s.doc || s.doc.id !== m.id || (s.doc.objects === m.objects && s.doc.order === m.order)) return 0
    // Going back is itself one undo step (⌘Z re-applies what the assistant did)
    s.replaceContent(m.objects, m.order)
    return 1
  },
}

type BoardDoc = NonNullable<ReturnType<typeof st>['doc']>
