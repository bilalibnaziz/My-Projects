import { describe, expect, it } from 'vitest'
import type { BoardObj, ID, Rect } from '@/board/types'
import { cullBoard } from '@/canvas/culling'

const view: Rect = { x: 0, y: 0, w: 800, h: 600 }

const sticky = (id: string, x: number, y: number, w = 100, h = 100): BoardObj =>
  ({ id, kind: 'sticky', x, y, w, h }) as unknown as BoardObj
const mind = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): BoardObj =>
  ({ id, kind: 'mind', x, y, w: 160, h: 60, ...extra }) as unknown as BoardObj
const line = (id: string, from: { x: number; y: number }, to: { x: number; y: number }): BoardObj =>
  ({ id, kind: 'connector', from, to }) as unknown as BoardObj

function board(objects: BoardObj[]) {
  return {
    objects: Object.fromEntries(objects.map((o) => [o.id, o])) as Record<ID, BoardObj>,
    order: objects.map((o) => o.id),
  }
}

describe('cullBoard (single-pass canvas culling)', () => {
  it('keeps objects inside the view, in z-order, and culls the rest', () => {
    const { objects, order } = board([sticky('a', 10, 10), sticky('b', 5000, 10), sticky('c', 750, 10)])
    const { visible } = cullBoard(objects, order, view, null)
    expect(visible.map((o) => o.id)).toEqual(['a', 'c'])
  })

  it('a connector far outside the view is culled, one inside is kept', () => {
    const { objects, order } = board([
      line('in', { x: 10, y: 10 }, { x: 100, y: 100 }),
      line('out', { x: 5000, y: 5000 }, { x: 5100, y: 5100 }),
    ])
    const { visible } = cullBoard(objects, order, view, null)
    expect(visible.map((o) => o.id)).toEqual(['in'])
  })

  it('the connector being edited stays visible even off-screen; other kinds do not', () => {
    const { objects, order } = board([
      line('off', { x: 5000, y: 5000 }, { x: 5100, y: 5100 }),
      sticky('far', 5000, 10),
    ])
    const { visible } = cullBoard(objects, order, view, 'off')
    expect(visible.map((o) => o.id)).toEqual(['off'])
  })

  it('children of a collapsed mind node are hidden, grandchildren too, but stay visible', () => {
    const { objects, order } = board([
      mind('root', 10, 10, { collapsed: true }),
      mind('kid', 200, 10, { parent: 'root' }),
      mind('grand', 400, 10, { parent: 'kid' }),
      mind('other', 10, 200),
    ])
    const { visible, hidden } = cullBoard(objects, order, view, null)
    expect([...hidden].sort()).toEqual(['grand', 'kid'])
    expect(visible.map((o) => o.id)).toEqual(['root', 'kid', 'grand', 'other'])
  })

  it('children of an open mind node are not hidden', () => {
    const { objects, order } = board([mind('root', 10, 10), mind('kid', 200, 10, { parent: 'root' })])
    expect(cullBoard(objects, order, view, null).hidden.size).toBe(0)
  })

  it('branches link a visible mind node to its open mind parent only', () => {
    const open = board([mind('root', 10, 10), mind('kid', 200, 10, { parent: 'root' })])
    const b1 = cullBoard(open.objects, open.order, view, null).branches
    expect(b1.map((b) => [b.o.id, b.parent.id])).toEqual([['kid', 'root']])

    const shut = board([mind('root', 10, 10, { collapsed: true }), mind('kid', 200, 10, { parent: 'root' })])
    expect(cullBoard(shut.objects, shut.order, view, null).branches).toEqual([])

    const offscreen = board([mind('root', 10, 10), mind('kid', 5000, 10, { parent: 'root' })])
    expect(cullBoard(offscreen.objects, offscreen.order, view, null).branches).toEqual([])
  })

  it('a mind node whose parent is not a mind gets no branch', () => {
    const { objects, order } = board([sticky('s', 10, 10), mind('kid', 200, 10, { parent: 's' })])
    expect(cullBoard(objects, order, view, null).branches).toEqual([])
  })

  it('an empty board and ids missing from objects are skipped', () => {
    expect(cullBoard({}, [], view, null)).toEqual({ visible: [], hidden: new Set(), branches: [] })
    const { objects, order } = board([sticky('a', 10, 10)])
    const { visible } = cullBoard(objects, [...order, 'ghost'], view, null)
    expect(visible.map((o) => o.id)).toEqual(['a'])
  })
})
