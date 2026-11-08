import { connectorBounds, intersects, rotatedBounds } from '@/board/geometry'
import type { BoardObj, ID, MindObj, Rect } from '@/board/types'

export interface CulledBoard {
  /** Objects in z-order that intersect the view (plus the connector being edited) */
  visible: BoardObj[]
  /** Mind children of collapsed nodes: still in `visible`, filtered out when rendering */
  hidden: Set<ID>
  /** Branches from a visible mind node to its uncollapsed mind parent */
  branches: { o: MindObj; parent: MindObj }[]
}

/**
 * Everything Canvas needs from the board per frame, in as few passes as possible.
 *
 * Canvas re-renders on every board transaction (it subscribes to the whole doc), and this used to
 * be three separate scans per render: culling, the hidden-children walk (which re-scanned the
 * whole order for every collapsed mind node via mindDescendants), and branches. Under load
 * (30 peers x 10 edits/s, batched to one transaction per frame) that is three O(n) passes plus a
 * nested order scan per collapsed subtree, every frame; now it is two linear passes over `order`
 * plus one walk per collapsed subtree over a children map built in the first pass.
 *
 * Behaviour is identical to the three memos it replaces, with one fix: the old culling memo
 * read `editingId` but did not list it as a dependency, so starting to edit an off-screen
 * connector did not show it until the next board/view change; `editingId` is now an input.
 * Pure: covered by src/test/culling.test.ts.
 */
export function cullBoard(
  objects: Record<ID, BoardObj>,
  order: ID[],
  view: Rect,
  editingId: ID | null,
): CulledBoard {
  const visible: BoardObj[] = []
  const hidden = new Set<ID>()
  const branches: { o: MindObj; parent: MindObj }[] = []

  // Children by parent, so a collapsed subtree is walked from the map instead of re-scanning
  // `order` for every node (what mindDescendants did).
  const kids = new Map<ID, MindObj[]>()
  for (const id of order) {
    const o = objects[id]
    if (o?.kind === 'mind' && o.parent) {
      const list = kids.get(o.parent)
      if (list) list.push(o)
      else kids.set(o.parent, [o])
    }
  }

  // Mind children of collapsed nodes are hidden — the whole subtree, however deep, and whether
  // or not an intermediate node is itself collapsed (same set mindDescendants returned).
  const collapsed: ID[] = []
  for (const id of order) {
    const o = objects[id]
    if (o?.kind === 'mind' && o.collapsed) collapsed.push(id)
  }
  const stack = [...collapsed]
  while (stack.length) {
    const id = stack.pop()!
    for (const c of kids.get(id) ?? []) {
      if (hidden.has(c.id)) continue
      hidden.add(c.id)
      stack.push(c.id)
    }
  }

  for (const id of order) {
    const o = objects[id]
    if (!o) continue
    if (o.kind === 'connector') {
      // Lines are culled too (a big board can have hundreds); curves bulge, so pad generously
      const cb = connectorBounds(o, objects)
      if (intersects({ x: cb.x - 200, y: cb.y - 200, w: cb.w + 400, h: cb.h + 400 }, view) || id === editingId) visible.push(o)
      continue
    }
    if (!intersects(rotatedBounds(o), view)) continue
    visible.push(o)
    if (o.kind === 'mind' && o.parent) {
      const p = objects[o.parent]
      if (p?.kind === 'mind' && !p.collapsed) branches.push({ o, parent: p })
    }
  }
  return { visible, hidden, branches }
}
