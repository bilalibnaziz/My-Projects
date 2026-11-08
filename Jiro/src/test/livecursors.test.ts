import { describe, expect, it } from 'vitest'
import type { BoardObj, ID } from '@/board/types'
import type { Peer } from '@/sync/live'
import { samePeerMarks } from '@/sync/LiveCursors'

function peer(over: Partial<Peer> = {}): Peer {
  return {
    clientId: 1,
    user: { id: 'u1', name: 'Ana', color: '#e5484d' },
    cursor: { x: 10, y: 20 },
    sel: [],
    editing: null,
    ...over,
  }
}
const vp = { x: 0, y: 0, zoom: 1 }
const obj = (id: string) => ({ id }) as unknown as BoardObj
const a = obj('a')
const aMoved = obj('a')
const b = obj('b')

describe('samePeerMarks (live presence memo)', () => {
  it('identical props skip the re-render', () => {
    const props = { p: peer(), vp, objects: { a } as Record<ID, BoardObj> }
    expect(samePeerMarks(props, props)).toBe(true)
  })
  it('a new objects record with the same object identities skips the re-render (the per-frame case)', () => {
    const p = peer()
    expect(samePeerMarks({ p, vp, objects: { a, b } }, { p, vp, objects: { a, b } })).toBe(true)
  })
  it('a moved cursor re-renders', () => {
    expect(samePeerMarks({ p: peer(), vp, objects: { a } }, { p: peer({ cursor: { x: 11, y: 20 } }), vp, objects: { a } })).toBe(false)
  })
  it('a cursor disappearing re-renders', () => {
    expect(samePeerMarks({ p: peer(), vp, objects: { a } }, { p: peer({ cursor: null }), vp, objects: { a } })).toBe(false)
  })
  it('a gained selection re-renders', () => {
    expect(samePeerMarks({ p: peer(), vp, objects: { a } }, { p: peer({ sel: ['a'] }), vp, objects: { a } })).toBe(false)
  })
  it('the same selection in a different order skips the re-render', () => {
    expect(
      samePeerMarks({ p: peer({ sel: ['a', 'b'] }), vp, objects: { a, b } }, { p: peer({ sel: ['b', 'a'] }), vp, objects: { a, b } }),
    ).toBe(true)
  })
  it('a selected object changing re-renders', () => {
    expect(
      samePeerMarks({ p: peer({ sel: ['a'] }), vp, objects: { a } }, { p: peer({ sel: ['a'] }), vp, objects: { a: aMoved } }),
    ).toBe(false)
  })
  it('an unselected object changing skips the re-render', () => {
    expect(
      samePeerMarks({ p: peer({ sel: ['a'] }), vp, objects: { a, b } }, { p: peer({ sel: ['a'] }), vp, objects: { a, b: obj('b') } }),
    ).toBe(true)
  })
  it('starting to edit re-renders', () => {
    expect(samePeerMarks({ p: peer(), vp, objects: { a } }, { p: peer({ editing: 'a' }), vp, objects: { a } })).toBe(false)
  })
  it('the edited object changing re-renders', () => {
    expect(
      samePeerMarks({ p: peer({ editing: 'a' }), vp, objects: { a } }, { p: peer({ editing: 'a' }), vp, objects: { a: aMoved } }),
    ).toBe(false)
  })
  it('a changed viewport re-renders', () => {
    expect(samePeerMarks({ p: peer(), vp, objects: { a } }, { p: peer(), vp: { x: 5, y: 0, zoom: 1 }, objects: { a } })).toBe(false)
  })
  it('a renamed peer re-renders', () => {
    expect(
      samePeerMarks({ p: peer(), vp, objects: { a } }, { p: peer({ user: { id: 'u1', name: 'Anaïs', color: '#e5484d' } }), vp, objects: { a } }),
    ).toBe(false)
  })
})
