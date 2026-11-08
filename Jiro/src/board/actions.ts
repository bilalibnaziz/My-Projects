import { toast } from 'sonner'
import { contains, intersects, rotatedBounds, uid } from './geometry'
import {
  inkFor, makeCard, makeComment, makeConnector, makeEmoji, makeFrame, makeImage, makeMind, makeShape, makeSticky, makeText, MIND_COLORS,
} from './factory'
import { mindChildren, mindWidthFor } from './mindmap'
import { boundsOf, useBoard } from './store'
import { useTeam } from '@/team/team'
import type { Anchor, BoardObj, ID, Pt, Rect, Tool } from './types'

const st = () => useBoard.getState()

export function textOf(o: BoardObj): string {
  switch (o.kind) {
    case 'sticky': case 'shape': case 'text': case 'mind': return o.text
    case 'frame': return o.title
    case 'card': return `${o.title}\n${o.body}`
    case 'connector': return o.label
    case 'comment': return o.thread.map((t) => t.text).join('\n')
    case 'emoji': return o.char
    default: return ''
  }
}

/** Ids of objects fully inside a frame (moved along with it) */
export function frameChildren(frame: Rect & { id: ID }, objects: Record<ID, BoardObj>, order: ID[]): ID[] {
  const out: ID[] = []
  for (const id of order) {
    const o = objects[id]
    if (!o || id === frame.id || o.kind === 'connector') continue
    if (o.kind === 'frame' && o.w * o.h >= frame.w * frame.h) continue
    if (contains(frame, rotatedBounds(o))) out.push(id)
  }
  return out
}

/** Deep-clone objects with fresh ids, keeping groups, connector ends and mind-map parents linked */
export function cloneObjects(objs: BoardObj[], dx: number, dy: number): BoardObj[] {
  const idMap = new Map<ID, ID>()
  const groupMap = new Map<ID, ID>()
  for (const o of objs) idMap.set(o.id, uid())
  return objs.map((o) => {
    const c = structuredClone(o) as BoardObj
    c.id = idMap.get(o.id)!
    if (o.groupId) {
      if (!groupMap.has(o.groupId)) groupMap.set(o.groupId, uid())
      c.groupId = groupMap.get(o.groupId)
    }
    if (c.kind === 'connector') {
      c.from = { ...c.from, x: c.from.x + dx, y: c.from.y + dy, id: c.from.id ? idMap.get(c.from.id) : undefined }
      c.to = { ...c.to, x: c.to.x + dx, y: c.to.y + dy, id: c.to.id ? idMap.get(c.to.id) : undefined }
      // A connector whose ends both fell outside the copy keeps its free positions
      if (!c.from.id) delete c.from.id
      if (!c.to.id) delete c.to.id
    } else {
      c.x += dx
      c.y += dy
    }
    if (c.kind === 'mind' && c.parent) c.parent = idMap.get(c.parent)
    return c
  })
}

let clip: BoardObj[] = []
const CLIP_PREFIX = 'jiro/objects:'

/** Serialise the selection (plus connectors between selected items) for the clipboard */
export function selectionPayload(): string | null {
  const { doc, selection } = st()
  if (!doc || !selection.length) return null
  const ids = new Set(selection)
  for (const id of doc.order) {
    const o = doc.objects[id]
    if (o?.kind === 'connector' && o.from.id && o.to.id && ids.has(o.from.id) && ids.has(o.to.id)) ids.add(id)
  }
  clip = doc.order.filter((id) => ids.has(id)).map((id) => doc.objects[id])
  return CLIP_PREFIX + JSON.stringify(clip)
}

/** Native copy / cut (fired by ⌘C/⌘X and by the app's Edit menu) */
export function handleCopy(e: ClipboardEvent, cut: boolean) {
  const payload = selectionPayload()
  if (!payload || !e.clipboardData) return
  e.preventDefault()
  e.clipboardData.setData('text/plain', payload)
  if (cut) st().remove(st().selection)
}

export function duplicateSelection() {
  const { doc, selection } = st()
  if (!doc || !selection.length) return
  const objs = doc.order.filter((id) => selection.includes(id)).map((id) => doc.objects[id])
  st().add(cloneObjects(objs, 24, 24))
}

export function pasteObjects(objs: BoardObj[], at?: Pt) {
  if (!objs.length) return
  const b = boundsOf(objs.map((o) => o.id), Object.fromEntries(objs.map((o) => [o.id, o])))
  let dx = 24, dy = 24
  if (at && b) {
    dx = at.x - (b.x + b.w / 2)
    dy = at.y - (b.y + b.h / 2)
  }
  const clones = cloneObjects(objs, dx, dy)
  // Mind nodes whose parent wasn't copied become roots
  for (const c of clones) if (c.kind === 'mind' && c.parent && !clones.some((o) => o.id === c.parent)) c.parent = undefined
  st().add(clones)
}

/** Copy from a menu (no native copy event): system clipboard when allowed, internal clipboard always */
export async function copyFromMenu(cut = false) {
  const payload = selectionPayload()
  if (!payload) return
  try {
    await navigator.clipboard.writeText(payload)
  } catch {
    /* internal clipboard still holds it */
  }
  if (cut) st().remove(st().selection)
}

/** Paste from a menu at a board point: system clipboard text when readable, else the internal one */
export async function pasteFromMenu(at: Pt) {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch {
    /* not permitted */
  }
  if (text.startsWith(CLIP_PREFIX)) {
    try {
      return pasteObjects(JSON.parse(text.slice(CLIP_PREFIX.length)), at)
    } catch { /* fall through */ }
  }
  if (text.trim() && !clip.length) return textToStickies(text, at)
  if (clip.length) pasteObjects(clip, at)
  else if (text.trim()) textToStickies(text, at)
}

export const hasClipboard = () => clip.length > 0

/** Handles a native paste: Jiro objects, images, or text (one sticky per line) */
export async function handlePaste(e: ClipboardEvent, at: Pt) {
  const dt = e.clipboardData
  if (!dt) return
  const files = [...dt.files].filter((f) => f.type.startsWith('image/'))
  if (files.length) {
    e.preventDefault()
    await addImageFiles(files, at)
    return
  }
  const text = dt.getData('text/plain')
  if (/jiro:\/\/open\?b=[A-Za-z0-9_-]{20,}|jiro:\/\/live\?\S+/.test(text)) {
    // A pasted share link (or the message it came in) opens that board
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('jiro:open-link', { detail: text }))
    return
  }
  if (text.startsWith(CLIP_PREFIX)) {
    e.preventDefault()
    try {
      pasteObjects(JSON.parse(text.slice(CLIP_PREFIX.length)), at)
    } catch {
      pasteObjects(clip, at)
    }
    return
  }
  if (text.trim()) {
    e.preventDefault()
    textToStickies(text, at)
    return
  }
  if (clip.length) pasteObjects(clip, at)
}

export function textToStickies(text: string, at: Pt) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•\d.)]+\s+/, '').trim()).filter(Boolean)
  if (lines.length <= 1) {
    const t = makeText(at.x - 120, at.y - 20, text.trim())
    st().add(t)
    return
  }
  const cols = Math.ceil(Math.sqrt(lines.length))
  const fill = st().opts.stickyColor
  const out = lines.slice(0, 400).map((l, i) => makeSticky(at.x + (i % cols) * 220 - (cols * 220) / 2, at.y + Math.floor(i / cols) * 220 - 100, fill, l))
  st().add(out)
  toast.success(`Pasted ${out.length} sticky notes`)
}

export function readImage(file: Blob): Promise<{ src: string; w: number; h: number }> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => {
      const img = new Image()
      img.onload = () => res({ src: r.result as string, w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = rej
      img.src = r.result as string
    }
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

export async function addImageFiles(files: File[], at: Pt) {
  const objs: BoardObj[] = []
  let x = at.x
  for (const f of files) {
    try {
      const { src, w, h } = await readImage(f)
      const o = makeImage(0, 0, src, w, h)
      o.x = x - (files.length === 1 ? o.w / 2 : 0)
      o.y = at.y - o.h / 2
      x += o.w + 24
      objs.push(o)
    } catch {
      toast.error(`Could not read ${f.name}`)
    }
  }
  if (objs.length) st().add(objs)
}

/** Place an object for a creation tool at a board point (centred), or into a dragged rect */
export function createWithTool(tool: Tool, p: Pt, rect?: Rect): BoardObj | null {
  const { opts } = st()
  const author = useTeam.getState().me.name
  let o: BoardObj | null = null
  switch (tool) {
    case 'sticky':
      o = makeSticky(p.x - 100, p.y - 100, opts.stickyColor)
      break
    case 'shape':
      o = makeShape(opts.shape, p.x - 90, p.y - (opts.shape === 'ellipse' || opts.shape === 'star' ? 90 : 60), 180, opts.shape === 'ellipse' || opts.shape === 'star' ? 180 : 120)
      break
    case 'text':
      o = makeText(p.x, p.y - 16)
      break
    case 'frame':
      o = makeFrame(p.x - 400, p.y - 280)
      break
    case 'card':
      o = makeCard(p.x - 140, p.y - 66)
      break
    case 'mind': {
      const m = makeMind(p.x - 100, p.y - 28, 'Central topic')
      o = m
      break
    }
    case 'emoji':
      o = makeEmoji(p.x - 32, p.y - 32, opts.emoji)
      break
    case 'comment':
      o = makeComment(p.x, p.y - 32, author, '')
      break
  }
  if (!o) return null
  if (rect && rect.w > 8 && rect.h > 8 && o.kind !== 'emoji' && o.kind !== 'comment' && o.kind !== 'mind') {
    Object.assign(o, rect)
    if (o.kind === 'text') o.autoWidth = false
  }
  if (o.kind === 'frame') {
    const { doc } = st()
    const n = doc ? doc.order.filter((id) => doc.objects[id]?.kind === 'frame').length + 1 : 1
    o.title = `Frame ${n}`
  }
  st().add(o, { back: o.kind === 'frame' })
  return o
}

// ---------- Quick-create ("+" handles) and mind-map keyboard flow ----------

/** Does a rect overlap any visible content (frames don't count)? */
export function collides(r: Rect, objects: Record<ID, BoardObj>, order: ID[], margin = 8): boolean {
  const g = { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 }
  for (const id of order) {
    const o = objects[id]
    if (!o || o.kind === 'connector' || o.kind === 'frame' || o.kind === 'comment') continue
    if (intersects(g, rotatedBounds(o))) return true
  }
  return false
}

const opposite: Record<Exclude<Anchor, 'auto'>, Exclude<Anchor, 'auto'>> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/** Clone a sticky/shape/card in a direction and connect it — the fastest way to build a flow */
export function quickCreate(id: ID, dir: Exclude<Anchor, 'auto'>) {
  const { doc } = st()
  const src = doc?.objects[id]
  if (!doc || !src) return
  if (src.kind === 'mind') {
    if (dir === 'bottom' || dir === 'top') return mindAddSibling(id, dir === 'top')
    return mindAddChild(id)
  }
  const gap = 100
  const dx = dir === 'right' ? src.w + gap : dir === 'left' ? -src.w - gap : 0
  const dy = dir === 'bottom' ? src.h + gap : dir === 'top' ? -src.h - gap : 0
  const [copy] = cloneObjects([src], dx, dy)
  // Step further along the direction until the new item lands in free space
  const stepX = Math.sign(dx) * (src.w + 40), stepY = Math.sign(dy) * (src.h + 40)
  for (let i = 0; i < 40 && collides({ x: copy.x, y: copy.y, w: copy.w, h: copy.h }, doc.objects, doc.order); i++) {
    copy.x += stepX
    copy.y += stepY
  }
  if ('text' in copy) (copy as { text: string }).text = ''
  if (copy.kind === 'card') copy.title = 'New card'
  copy.votes = undefined
  copy.groupId = undefined
  const c = makeConnector({ id: src.id, anchor: dir, x: 0, y: 0 }, { id: copy.id, anchor: opposite[dir], x: 0, y: 0 }, src.kind === 'shape' ? 'elbow' : 'curve')
  st().add([copy, c], { select: false })
  st().select([copy.id])
  st().setEditing(copy.id)
}

export function mindAddChild(id: ID) {
  const { doc } = st()
  const p = doc?.objects[id]
  if (!doc || p?.kind !== 'mind') return
  const depth1 = !p.parent
  const color = depth1 ? MIND_COLORS[mindChildren(doc.objects, doc.order, id).length % MIND_COLORS.length] : p.color
  const n = makeMind(p.x + p.w + 64, p.y, '', id, color)
  n.w = mindWidthFor('', false)
  if (p.collapsed) st().update(id, { collapsed: false })
  st().add(n)
  st().setEditing(n.id)
}

export function mindAddSibling(id: ID, before = false) {
  const { doc } = st()
  const s = doc?.objects[id]
  if (!doc || s?.kind !== 'mind' || !s.parent) return
  const n = makeMind(s.x, s.y + s.h + 18, '', s.parent, s.color)
  n.w = mindWidthFor('', false)
  st().add(n)
  // place right after (or before) the sibling in board order so layout keeps the sequence
  const d = st().doc!
  const order = d.order.filter((x) => x !== n.id)
  const i = order.indexOf(id)
  order.splice(before ? i : i + 1, 0, n.id)
  st().reorder(order)
  st().relayoutMind(n.id)
  st().setEditing(n.id)
}

// ---------- Organize ----------

const isNote = (o: BoardObj) => o.kind !== 'connector' && o.kind !== 'frame' && o.kind !== 'comment'

function selected(): BoardObj[] {
  const { doc, selection } = st()
  if (!doc) return []
  return selection.map((id) => doc.objects[id]).filter((o) => o && isNote(o) && !o.locked)
}

/** Arrange the selection in a neat grid, keeping reading order */
export function tidyUp() {
  const objs = selected()
  if (objs.length < 2) return
  const b = boundsOf(objs.map((o) => o.id), st().doc!.objects)!
  const sorted = [...objs].sort((a, c) => (Math.abs(a.y - c.y) > 60 ? a.y - c.y : a.x - c.x))
  const cw = Math.max(...objs.map((o) => o.w)), ch = Math.max(...objs.map((o) => o.h))
  const cols = Math.max(1, Math.round(Math.sqrt(objs.length * (b.w / Math.max(1, b.h)) * (ch / cw))) || Math.ceil(Math.sqrt(objs.length)))
  const gap = 24
  const patches: Record<ID, Partial<BoardObj>> = {}
  sorted.forEach((o, i) => {
    patches[o.id] = { x: b.x + (i % cols) * (cw + gap) + (cw - o.w) / 2, y: b.y + Math.floor(i / cols) * (ch + gap) + (ch - o.h) / 2 }
  })
  st().updateMany(patches)
}

/** Group stickies into columns by colour — instant affinity map */
export function clusterByColor() {
  const objs = selected()
  if (objs.length < 2) return
  const b = boundsOf(objs.map((o) => o.id), st().doc!.objects)!
  const key = (o: BoardObj) => ('fill' in o ? o.fill : o.kind === 'card' ? o.tag : o.kind)
  const groups = new Map<string, BoardObj[]>()
  for (const o of objs) groups.set(key(o), [...(groups.get(key(o)) ?? []), o])
  const patches: Record<ID, Partial<BoardObj>> = {}
  let x = b.x
  for (const [, g] of groups) {
    const cw = Math.max(...g.map((o) => o.w))
    let y = b.y
    for (const o of g) {
      patches[o.id] = { x, y }
      y += o.h + 20
    }
    x += cw + 60
  }
  st().updateMany(patches)
  toast.success(`Clustered into ${groups.size} group${groups.size === 1 ? '' : 's'}`)
}

export function sortByText() {
  const objs = selected()
  if (objs.length < 2) return
  const slots = [...objs].sort((a, c) => (Math.abs(a.y - c.y) > 60 ? a.y - c.y : a.x - c.x)).map((o) => ({ x: o.x, y: o.y }))
  const byText = [...objs].sort((a, c) => textOf(a).localeCompare(textOf(c), undefined, { sensitivity: 'base', numeric: true }))
  const patches: Record<ID, Partial<BoardObj>> = {}
  byText.forEach((o, i) => (patches[o.id] = slots[i]))
  st().updateMany(patches)
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export function align(mode: AlignMode) {
  const objs = selected()
  if (objs.length < 2) return
  const b = boundsOf(objs.map((o) => o.id), st().doc!.objects)!
  const patches: Record<ID, Partial<BoardObj>> = {}
  for (const o of objs) {
    if (mode === 'left') patches[o.id] = { x: b.x }
    if (mode === 'right') patches[o.id] = { x: b.x + b.w - o.w }
    if (mode === 'hcenter') patches[o.id] = { x: b.x + b.w / 2 - o.w / 2 }
    if (mode === 'top') patches[o.id] = { y: b.y }
    if (mode === 'bottom') patches[o.id] = { y: b.y + b.h - o.h }
    if (mode === 'vcenter') patches[o.id] = { y: b.y + b.h / 2 - o.h / 2 }
  }
  st().updateMany(patches)
}

export function distribute(axis: 'h' | 'v') {
  const objs = selected()
  if (objs.length < 3) return
  const s = [...objs].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y))
  const first = s[0], last = s[s.length - 1]
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y
  const total = s.reduce((t, o) => t + (axis === 'h' ? o.w : o.h), 0)
  const gap = (span - total) / (s.length - 1)
  let pos = axis === 'h' ? first.x : first.y
  const patches: Record<ID, Partial<BoardObj>> = {}
  for (const o of s) {
    patches[o.id] = axis === 'h' ? { x: pos } : { y: pos }
    pos += (axis === 'h' ? o.w : o.h) + gap
  }
  st().updateMany(patches)
}

/** Wrap the selection in a new frame */
export function frameSelection() {
  const { doc, selection } = st()
  if (!doc || !selection.length) return
  const b = boundsOf(selection, doc.objects)!
  const f = makeFrame(b.x - 40, b.y - 40, b.w + 80, b.h + 80)
  f.title = `Frame ${doc.order.filter((id) => doc.objects[id]?.kind === 'frame').length + 1}`
  st().add(f, { back: true })
}

export function vote(id: ID, delta: 1 | -1) {
  const o = st().doc?.objects[id]
  if (!o || o.kind === 'connector') return
  st().update(id, { votes: Math.max(0, (o.votes ?? 0) + delta) || undefined })
}

export function clearVotes() {
  const { doc } = st()
  if (!doc) return
  const patches: Record<ID, Partial<BoardObj>> = {}
  for (const id of doc.order) if (doc.objects[id]?.votes) patches[id] = { votes: undefined }
  st().updateMany(patches)
}

export function setStickyColorFor(id: ID, fill: string) {
  st().update(id, { fill, color: inkFor(fill) } as Partial<BoardObj>)
}

export function searchBoard(q: string): BoardObj[] {
  const { doc } = st()
  if (!doc || !q.trim()) return []
  const needle = q.toLowerCase()
  return doc.order.map((id) => doc.objects[id]).filter((o) => o && textOf(o).toLowerCase().includes(needle)).slice(0, 50)
}
