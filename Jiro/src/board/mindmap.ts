import type { BoardObj, ID, MindObj } from './types'

const GAP_X = 64
const GAP_Y = 18

/** Children of a mind node in board order */
export function mindChildren(objs: Record<ID, BoardObj>, order: ID[], id: ID): MindObj[] {
  const out: MindObj[] = []
  for (const oid of order) {
    const o = objs[oid]
    if (o?.kind === 'mind' && o.parent === id) out.push(o)
  }
  return out
}

export function mindRoot(objs: Record<ID, BoardObj>, id: ID): MindObj | null {
  let o = objs[id]
  let guard = 0
  while (o?.kind === 'mind' && o.parent && guard++ < 999) o = objs[o.parent]
  return o?.kind === 'mind' ? o : null
}

export function mindDescendants(objs: Record<ID, BoardObj>, order: ID[], id: ID): ID[] {
  const out: ID[] = []
  const walk = (pid: ID) => {
    for (const c of mindChildren(objs, order, pid)) {
      out.push(c.id)
      walk(c.id)
    }
  }
  walk(id)
  return out
}

/**
 * Tidy tree layout from a root: children stack vertically to the right (or split left/right for
 * 'both'), each subtree centred on its parent. Returns position patches for moved nodes only.
 */
export function layoutMind(objs: Record<ID, BoardObj>, order: ID[], rootId: ID): Record<ID, { x: number; y: number }> {
  const root = objs[rootId]
  if (root?.kind !== 'mind') return {}
  const patches: Record<ID, { x: number; y: number }> = {}
  const heights = new Map<ID, number>()

  const measure = (n: MindObj): number => {
    const kids = n.collapsed ? [] : mindChildren(objs, order, n.id)
    if (!kids.length) {
      heights.set(n.id, n.h)
      return n.h
    }
    const sum = kids.reduce((s, k) => s + measure(k), 0) + GAP_Y * (kids.length - 1)
    const h = Math.max(n.h, sum)
    heights.set(n.id, h)
    return h
  }

  const place = (n: MindObj, nx: number, ny: number, dir: 1 | -1) => {
    if (n.x !== nx || n.y !== ny) patches[n.id] = { x: nx, y: ny }
    const kids = n.collapsed ? [] : mindChildren(objs, order, n.id)
    if (!kids.length) return
    const total = kids.reduce((s, k) => s + heights.get(k.id)!, 0) + GAP_Y * (kids.length - 1)
    let y = ny + n.h / 2 - total / 2
    for (const k of kids) {
      const kh = heights.get(k.id)!
      const kx = dir === 1 ? nx + n.w + GAP_X : nx - GAP_X - k.w
      place(k, kx, y + kh / 2 - k.h / 2, dir)
      y += kh + GAP_Y
    }
  }

  const kids = root.collapsed ? [] : mindChildren(objs, order, root.id)
  if (root.side === 'both' && kids.length > 1) {
    const right = kids.filter((_, i) => i % 2 === 0)
    const left = kids.filter((_, i) => i % 2 === 1)
    for (const k of kids) measure(k)
    for (const [side, dir] of [[right, 1], [left, -1]] as const) {
      const total = side.reduce((s, k) => s + heights.get(k.id)!, 0) + GAP_Y * (side.length - 1)
      let y = root.y + root.h / 2 - total / 2
      for (const k of side) {
        const kh = heights.get(k.id)!
        const kx = dir === 1 ? root.x + root.w + GAP_X : root.x - GAP_X - k.w
        place(k, kx, y + kh / 2 - k.h / 2, dir)
        y += kh + GAP_Y
      }
    }
  } else {
    measure(root)
    place(root, root.x, root.y, 1)
  }
  return patches
}

/** Which side of its parent a node hangs on (for drawing the branch) */
export function mindSide(objs: Record<ID, BoardObj>, n: MindObj): 1 | -1 {
  const p = n.parent ? objs[n.parent] : null
  if (!p) return 1
  return n.x + n.w / 2 >= p.x + p.w / 2 ? 1 : -1
}

/** Estimate node width from its text so long labels don't overflow */
export function mindWidthFor(text: string, root: boolean) {
  const fs = root ? 18 : 15
  const longest = Math.max(1, ...text.split('\n').map((l) => l.length))
  return Math.max(root ? 160 : 96, Math.min(420, longest * fs * 0.56 + 36))
}
