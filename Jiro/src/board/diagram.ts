import { intersects, rotatedBounds } from './geometry'
import type { BoardObj, ID, Rect } from './types'

export interface FlowNode {
  key: string
  w: number
  h: number
}
export interface FlowEdge {
  from: string
  to: string
}

/**
 * Layered (Sugiyama-lite) layout for flowcharts: ranks by longest path from the sources
 * (back edges of cycles ignored), orders each layer by the mean position of its parents,
 * centres every layer. Returns top-left positions keyed by node key.
 */
export function layoutFlow(nodes: FlowNode[], edges: FlowEdge[], dir: 'down' | 'right' = 'down', gapMain = 90, gapCross = 60): Record<string, { x: number; y: number }> {
  const keys = nodes.map((n) => n.key)
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const out = new Map<string, string[]>(keys.map((k) => [k, []]))
  const inn = new Map<string, string[]>(keys.map((k) => [k, []]))
  for (const e of edges) {
    if (!byKey.has(e.from) || !byKey.has(e.to) || e.from === e.to) continue
    out.get(e.from)!.push(e.to)
    inn.get(e.to)!.push(e.from)
  }
  // DFS from sources (input order) to find back edges so cycles (retry loops) don't break ranking
  const back = new Set<string>()
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (k: string) => {
    state.set(k, 1)
    for (const t of out.get(k)!) {
      if (state.get(t) === 1) back.add(k + '\u0000' + t)
      else if (!state.get(t)) visit(t)
    }
    state.set(k, 2)
  }
  for (const k of keys) if (!inn.get(k)!.length && !state.get(k)) visit(k)
  for (const k of keys) if (!state.get(k)) visit(k)
  const fwd = (a: string, b: string) => !back.has(a + '\u0000' + b)

  // Longest-path ranks over forward edges (Kahn order)
  const rank = new Map<string, number>(keys.map((k) => [k, 0]))
  const indeg = new Map<string, number>(keys.map((k) => [k, inn.get(k)!.filter((p) => fwd(p, k)).length]))
  const queue = keys.filter((k) => indeg.get(k) === 0)
  while (queue.length) {
    const k = queue.shift()!
    for (const t of out.get(k)!) {
      if (!fwd(k, t)) continue
      rank.set(t, Math.max(rank.get(t)!, rank.get(k)! + 1))
      indeg.set(t, indeg.get(t)! - 1)
      if (indeg.get(t) === 0) queue.push(t)
    }
  }

  const layers: string[][] = []
  for (const k of keys) (layers[rank.get(k)!] ??= []).push(k)
  // Order layers by parents' mean index (one downward sweep is enough for small charts)
  const index = new Map<string, number>()
  layers.forEach((layer, li) => {
    if (li > 0) {
      const score = (k: string) => {
        const ps = inn.get(k)!.filter((p) => index.has(p) && rank.get(p)! < li)
        return ps.length ? ps.reduce((s, p) => s + index.get(p)!, 0) / ps.length : Number.MAX_SAFE_INTEGER / 2 + keys.indexOf(k)
      }
      layer.sort((a, b) => score(a) - score(b))
    }
    layer.forEach((k, i) => index.set(k, i))
  })

  const pos: Record<string, { x: number; y: number }> = {}
  const main = (n: FlowNode) => (dir === 'down' ? n.h : n.w)
  const cross = (n: FlowNode) => (dir === 'down' ? n.w : n.h)
  let m = 0
  for (const layer of layers) {
    if (!layer) continue
    const ns = layer.map((k) => byKey.get(k)!)
    const thick = Math.max(...ns.map(main))
    const total = ns.reduce((s, n) => s + cross(n), 0) + gapCross * (ns.length - 1)
    let c = -total / 2
    for (const n of ns) {
      const along = m + (thick - main(n)) / 2
      pos[n.key] = dir === 'down' ? { x: c, y: along } : { x: along, y: c }
      c += cross(n) + gapCross
    }
    m += thick + gapMain
  }
  return pos
}

/** A spot for a w×h block: centred on `prefer` if that's empty, otherwise right of all content */
export function freeSpot(w: number, h: number, prefer: { x: number; y: number }, objects: Record<ID, BoardObj>, order: ID[]): { x: number; y: number } {
  const want: Rect = { x: prefer.x - w / 2, y: prefer.y - h / 2, w, h }
  let maxX = -Infinity, minY = Infinity
  let hit = false
  for (const id of order) {
    const o = objects[id]
    if (!o || o.kind === 'connector') continue
    const b = rotatedBounds(o)
    maxX = Math.max(maxX, b.x + b.w)
    minY = Math.min(minY, b.y)
    if (!hit && intersects({ x: want.x - 40, y: want.y - 40, w: w + 80, h: h + 80 }, b)) hit = true
  }
  if (!hit) return { x: want.x, y: want.y }
  return { x: maxX + 200, y: minY }
}
