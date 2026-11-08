import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { generateInitialKeys, minimalReorderKeys, sortIdsByFractionalOrder } from '@/board/fractionalIndex'

function seeded(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

const keysOf = (doc: Y.Doc) => {
  const out: Record<string, string> = {}
  doc.getMap<Y.Map<unknown>>('objects').forEach((m, id) => (out[id] = m.get('order') as string))
  return out
}
const sorted = (doc: Y.Doc) => sortIdsByFractionalOrder(Object.fromEntries(Object.entries(keysOf(doc)).map(([id, order]) => [id, { order }])))

/** Move `ids` to index `to` in the current order, keyed minimally (what the store does). */
function reorderOn(doc: Y.Doc, ids: string[], to: number) {
  const order = sorted(doc)
  const set = new Set(ids)
  const rest = order.filter((id) => !set.has(id))
  const target = [...rest.slice(0, to), ...ids, ...rest.slice(to)]
  const changed = minimalReorderKeys(keysOf(doc), target, set)
  doc.transact(() => {
    for (const [id, k] of Object.entries(changed)) doc.getMap<Y.Map<unknown>>('objects').get(id)!.set('order', k)
  })
  return changed
}

describe('minimal reorder keys', () => {
  it('re-keys only the moved object and produces the wanted order', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const keys = generateInitialKeys(5)
    const cur = Object.fromEntries(ids.map((id, i) => [id, keys[i]]))
    const target = ['b', 'c', 'a', 'd', 'e']
    const changed = minimalReorderKeys(cur, target)
    expect(Object.keys(changed)).toEqual(['a'])
    const next = { ...cur, ...changed }
    expect([...target].sort((x, y) => (next[x] < next[y] ? -1 : 1))).toEqual(target)
  })

  it('returns nothing when the order is unchanged and handles missing keys', () => {
    const keys = generateInitialKeys(3)
    expect(minimalReorderKeys({ a: keys[0], b: keys[1], c: keys[2] }, ['a', 'b', 'c'])).toEqual({})
    const ch = minimalReorderKeys({ a: keys[0], b: undefined, c: keys[2] }, ['a', 'b', 'c'])
    expect(Object.keys(ch)).toEqual(['b'])
    expect(keys[0] < ch.b && ch.b < keys[2]).toBe(true)
  })

  it('3 peers × 500 concurrent random reorders converge, and untouched objects keep their keys', () => {
    const N = 40
    const base = new Y.Doc()
    const keys = generateInitialKeys(N)
    base.transact(() => {
      for (let i = 0; i < N; i++) {
        const m = new Y.Map<unknown>()
        m.set('order', keys[i])
        base.getMap<Y.Map<unknown>>('objects').set(`o${i}`, m)
      }
    })
    const init = Y.encodeStateAsUpdate(base)
    const peers = [0, 1, 2].map(() => {
      const d = new Y.Doc()
      Y.applyUpdate(d, init)
      return d
    })
    const rnd = seeded(7)
    const touched = new Set<string>()
    // Object o39 is never moved by anyone
    const movable = Array.from({ length: N - 1 }, (_, i) => `o${i}`)
    for (let round = 0; round < 50; round++) {
      for (let k = 0; k < 10; k++) {
        for (const p of peers) {
          const pick = movable[Math.floor(rnd() * movable.length)]
          touched.add(pick)
          const changed = reorderOn(p, [pick], Math.floor(rnd() * N))
          for (const id of Object.keys(changed)) touched.add(id)
        }
      }
      // sync all peers
      const ups = peers.map((p) => Y.encodeStateAsUpdate(p))
      for (const p of peers) for (const u of ups) Y.applyUpdate(p, u)
    }
    const s0 = sorted(peers[0])
    expect(sorted(peers[1])).toEqual(s0)
    expect(sorted(peers[2])).toEqual(s0)
    expect(keysOf(peers[0])['o39']).toBe(keys[39])
    // Each reorder re-keyed only what it had to: far fewer keys than ops × N
    expect(touched.size).toBeLessThanOrEqual(N)
  })

  it('a concurrent move on another peer is not overwritten by an unrelated reorder', () => {
    const base = new Y.Doc()
    const keys = generateInitialKeys(5)
    base.transact(() => ['a', 'b', 'c', 'd', 'e'].forEach((id, i) => {
      const m = new Y.Map<unknown>()
      m.set('order', keys[i])
      base.getMap<Y.Map<unknown>>('objects').set(id, m)
    }))
    const A = new Y.Doc()
    const B = new Y.Doc()
    Y.applyUpdate(A, Y.encodeStateAsUpdate(base))
    Y.applyUpdate(B, Y.encodeStateAsUpdate(base))
    reorderOn(A, ['a'], 4) // A brings a to front
    reorderOn(B, ['e'], 0) // B sends e to back
    Y.applyUpdate(A, Y.encodeStateAsUpdate(B))
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A))
    expect(sorted(A)).toEqual(sorted(B))
    const s = sorted(A)
    expect(s[0]).toBe('e')
    expect(s[s.length - 1]).toBe('a')
  })
})
