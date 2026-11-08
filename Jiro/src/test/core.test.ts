import { beforeEach, describe, expect, it } from 'vitest'
import { cloneObjects } from '@/board/actions'
import { makeConnector, makeMind, makeShape, makeSticky } from '@/board/factory'
import { elbowPoints, facingAnchor, intersects, rotatedBounds, simplify } from '@/board/geometry'
import { layoutMind, mindDescendants } from '@/board/mindmap'
import { useBoard } from '@/board/store'
import { instantiate, TEMPLATES } from '@/board/templates'
import { wrapText } from '@/board/text'
import { emptyBoard } from '@/board/factory'
import type { BoardObj } from '@/board/types'
import { parseBoard, serializeBoard } from '@/ui/boardIo'
import { buildPdf } from '@/board/pdf'
import { layoutFlow } from '@/board/diagram'

const byId = (objs: BoardObj[]) => Object.fromEntries(objs.map((o) => [o.id, o]))

describe('geometry', () => {
  it('rotated bounds grow for a 45° square', () => {
    const r = rotatedBounds({ x: 0, y: 0, w: 100, h: 100, rotation: 45 })
    expect(r.w).toBeCloseTo(141.42, 1)
    expect(r.x + r.w / 2).toBeCloseTo(50)
  })
  it('picks the side facing a point', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 }
    expect(facingAnchor(r, { x: 500, y: 25 })).toBe('right')
    expect(facingAnchor(r, { x: 50, y: -300 })).toBe('top')
  })
  it('elbow routes are orthogonal and end on the endpoints', () => {
    const pts = elbowPoints({ x: 0, y: 0 }, 'right', { x: 300, y: 200 }, 'left')
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts.at(-1)).toEqual({ x: 300, y: 200 })
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true)
  })
  it('simplify keeps the shape but drops collinear points', () => {
    const line = Array.from({ length: 50 }, (_, i) => [i, 0]).flat()
    expect(simplify(line, 0.5)).toEqual([0, 0, 49, 0])
  })
})

describe('mind map layout', () => {
  it('stacks children to the right of the root without overlap', () => {
    const root = makeMind(0, 0, 'Root')
    const kids = [1, 2, 3].map((i) => makeMind(0, 0, 'K' + i, root.id))
    const objs = byId([root, ...kids])
    const p = layoutMind(objs, Object.keys(objs), root.id)
    const placed = kids.map((k) => ({ ...k, ...p[k.id] }))
    for (const k of placed) expect(k.x).toBeGreaterThan(root.x + root.w)
    for (let i = 1; i < placed.length; i++) expect(placed[i].y).toBeGreaterThanOrEqual(placed[i - 1].y + placed[i - 1].h)
    const mid = (placed[0].y + placed.at(-1)!.y + placed.at(-1)!.h) / 2
    expect(mid).toBeCloseTo(root.y + root.h / 2, 0)
  })
  it('both-sided roots split children left and right', () => {
    const root = { ...makeMind(0, 0, 'Root'), side: 'both' as const }
    const kids = [1, 2, 3, 4].map((i) => makeMind(0, 0, 'K' + i, root.id))
    const objs = byId([root, ...kids])
    const p = layoutMind(objs, Object.keys(objs), root.id)
    const sides = kids.map((k) => (p[k.id].x > root.x ? 'R' : 'L'))
    expect(sides).toEqual(['R', 'L', 'R', 'L'])
  })
  it('finds every descendant', () => {
    const root = makeMind(0, 0, 'Root')
    const a = makeMind(0, 0, 'a', root.id)
    const b = makeMind(0, 0, 'b', a.id)
    const objs = byId([root, a, b])
    expect(mindDescendants(objs, Object.keys(objs), root.id).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('clone', () => {
  it('remaps connector ends, groups and mind parents to the copies', () => {
    const a = { ...makeSticky(0, 0), groupId: 'g1' }
    const b = { ...makeShape('rect', 300, 0), groupId: 'g1' }
    const c = makeConnector({ id: a.id, x: 0, y: 0 }, { id: b.id, x: 0, y: 0 })
    const root = makeMind(0, 400, 'R')
    const kid = makeMind(0, 400, 'k', root.id)
    const out = cloneObjects([a, b, c, root, kid], 10, 20)
    const [a2, b2, c2, r2, k2] = out
    expect(new Set(out.map((o) => o.id)).size).toBe(5)
    expect(out.every((o, i) => o.id !== [a, b, c, root, kid][i].id)).toBe(true)
    expect(c2.kind === 'connector' && c2.from.id === a2.id && c2.to.id === b2.id).toBe(true)
    expect(a2.groupId).toBe(b2.groupId)
    expect(a2.groupId).not.toBe('g1')
    expect(k2.kind === 'mind' && k2.parent === r2.id).toBe(true)
    expect(a2.x).toBe(10)
    expect(a2.y).toBe(20)
  })
})

describe('board store', () => {
  beforeEach(() => useBoard.getState().open(emptyBoard('t')))
  it('undo / redo restores adds and moves', () => {
    const s = useBoard.getState()
    const n = makeSticky(0, 0)
    s.add(n)
    s.update(n.id, { x: 100 })
    expect(useBoard.getState().doc!.objects[n.id].x).toBe(100)
    useBoard.getState().undo()
    expect(useBoard.getState().doc!.objects[n.id].x).toBe(0)
    useBoard.getState().undo()
    expect(useBoard.getState().doc!.objects[n.id]).toBeUndefined()
    useBoard.getState().redo()
    useBoard.getState().redo()
    expect(useBoard.getState().doc!.objects[n.id].x).toBe(100)
  })
  it('a gesture is one undo step however many updates it makes', () => {
    const n = makeSticky(0, 0)
    useBoard.getState().add(n)
    const before = useBoard.getState().past.length
    useBoard.getState().beginGesture()
    for (let i = 1; i <= 20; i++) useBoard.getState().update(n.id, { x: i * 5 })
    useBoard.getState().endGesture()
    expect(useBoard.getState().past.length).toBe(before + 1)
    useBoard.getState().undo()
    expect(useBoard.getState().doc!.objects[n.id].x).toBe(0)
  })
  it('deleting an item removes connectors attached to it', () => {
    const a = makeSticky(0, 0), b = makeSticky(400, 0)
    const c = makeConnector({ id: a.id, x: 0, y: 0 }, { id: b.id, x: 0, y: 0 })
    useBoard.getState().add([a, b, c])
    useBoard.getState().remove([a.id])
    expect(useBoard.getState().doc!.objects[c.id]).toBeUndefined()
    expect(useBoard.getState().doc!.order).toEqual([b.id])
  })
  it('selecting one member of a group selects the group', () => {
    const a = { ...makeSticky(0, 0), groupId: 'g' }, b = { ...makeSticky(300, 0), groupId: 'g' }, c = makeSticky(600, 0)
    useBoard.getState().add([a, b, c])
    useBoard.getState().select([a.id])
    expect(useBoard.getState().selection.sort()).toEqual([a.id, b.id].sort())
  })
  it('frames stay behind content when sent to back', () => {
    const f = { ...makeShape('rect', 0, 0), kind: 'frame', title: 'F', fill: '#fff' } as unknown as BoardObj
    const n = makeSticky(10, 10)
    useBoard.getState().add([f, n])
    useBoard.getState().sendToBack([n.id])
    expect(useBoard.getState().doc!.order).toEqual([f.id, n.id])
  })
})

describe('.jiro files', () => {
  it('round-trips a board and gives the import a fresh id', () => {
    const d = emptyBoard('Plan')
    const n = makeSticky(0, 0, '#fff176', 'hello')
    d.objects[n.id] = n
    d.order.push(n.id)
    const back = parseBoard(serializeBoard(d))
    expect(back.id).not.toBe(d.id)
    expect(back.name).toBe('Plan')
    expect(back.objects[n.id]).toMatchObject({ kind: 'sticky', text: 'hello' })
  })
  it('rejects files that are not boards', () => {
    expect(() => parseBoard('{"hello":1}')).toThrow()
  })
})

describe('templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t]))('%s builds a consistent board', (_id, t) => {
    const objs = instantiate(t, 1000, 1000)
    expect(objs.length).toBeGreaterThan(2)
    const ids = new Set(objs.map((o) => o.id))
    expect(ids.size).toBe(objs.length)
    for (const o of objs) {
      if (o.kind === 'connector') {
        if (o.from.id) expect(ids.has(o.from.id)).toBe(true)
        if (o.to.id) expect(ids.has(o.to.id)).toBe(true)
      }
      if (o.kind === 'mind' && o.parent) expect(ids.has(o.parent)).toBe(true)
    }
  })
  it('mind map template children do not overlap', () => {
    const objs = instantiate(TEMPLATES.find((t) => t.id === 'mindmap')!, 0, 0).filter((o) => o.kind === 'mind')
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) expect(intersects(objs[i], objs[j])).toBe(false)
  })
})

describe('text', () => {
  it('wraps long text and hard-breaks very long words', () => {
    const lines = wrapText('a quick brown fox jumps over the lazy dog', 60, '400 16px sans-serif')
    expect(lines.length).toBeGreaterThan(2)
    const long = wrapText('x'.repeat(100), 50, '400 16px sans-serif')
    expect(long.length).toBeGreaterThan(1)
  })
})

describe('pdf writer', () => {
  it('writes a valid xref table and one page per image', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
    const blob = buildPdf([{ jpeg, w: 2, h: 1, pw: 100, ph: 50 }, { jpeg, w: 2, h: 1, pw: 60, ph: 60 }], 'T (x)')
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/Title (T \\(x\\))')
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.startsWith('xref', xref)).toBe(true)
    const offs = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(offs.length).toBe(9)
    offs.forEach((o, i) => expect(text.startsWith(`${i + 1} 0 obj`, o)).toBe(true))
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })
})

describe('flowchart layout', () => {
  it('ranks by longest path, keeps loops from breaking the order, and never overlaps', () => {
    const nodes = ['s', 'f', 'v', 'e', 'd'].map((key) => ({ key, w: 200, h: 100 }))
    const edges = [{ from: 's', to: 'f' }, { from: 'f', to: 'v' }, { from: 'v', to: 'd' }, { from: 'v', to: 'e' }, { from: 'e', to: 'f' }]
    const p = layoutFlow(nodes, edges)
    expect(p.s.y).toBeLessThan(p.f.y)
    expect(p.f.y).toBeLessThan(p.v.y)
    expect(p.v.y).toBeLessThan(p.d.y)
    expect(p.e.y).toBe(p.d.y)
    expect(Math.abs(p.e.x - p.d.x)).toBeGreaterThanOrEqual(200)
  })
})
