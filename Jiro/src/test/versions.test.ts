import { describe, expect, it } from 'vitest'
import { emptyBoard, makeImage, makeShape, makeSticky } from '@/board/factory'
import { useBoard } from '@/board/store'
import type { BoardObj } from '@/board/types'
import { AUTO_GAP_MS, diffSummary, makeVersion, pruneAuto, relativeTime, shouldAutoSnapshot, signature, type BoardVersion } from '@/board/versions'

const byId = (objs: BoardObj[]) => Object.fromEntries(objs.map((o) => [o.id, o]))

describe('version signatures', () => {
  it('equal content gives equal signatures; any edit or reorder changes it', () => {
    const a = makeSticky(0, 0, '#fff176', 'Idea')
    const b = makeShape('rect', 200, 0)
    const objs = byId([a, b])
    const sig = signature(objs, [a.id, b.id])
    expect(signature({ ...objs }, [a.id, b.id])).toBe(sig)
    expect(signature({ ...objs, [a.id]: { ...a, text: 'Idea!' } }, [a.id, b.id])).not.toBe(sig)
    expect(signature(objs, [b.id, a.id])).not.toBe(sig)
    expect(signature({ ...objs, [b.id]: { ...b, x: 201 } }, [a.id, b.id])).not.toBe(sig)
  })

  it('big images are fingerprinted, not stringified whole, and still tell images apart', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(2_000_000)
    const img = makeImage(0, 0, big, 100, 100)
    const t = performance.now()
    const s1 = signature(byId([img]), [img.id])
    expect(performance.now() - t).toBeLessThan(200)
    const other = { ...img, src: 'data:image/png;base64,' + 'B'.repeat(2_000_000) }
    expect(signature(byId([other]), [img.id])).not.toBe(s1)
  })
})

describe('auto snapshots', () => {
  const v = (at: number, sig: string, auto = true): BoardVersion => ({ id: `v${at}`, boardId: 'b', at, auto, objects: {}, order: [], count: 0, sig, name: auto ? undefined : 'Named' })

  it('first version always; then only when changed and at least 10 minutes later', () => {
    const now = 1_000_000_000
    expect(shouldAutoSnapshot(undefined, 'x', now)).toBe(true)
    expect(shouldAutoSnapshot(v(now - AUTO_GAP_MS * 2, 'x'), 'x', now)).toBe(false) // unchanged
    expect(shouldAutoSnapshot(v(now - 60_000, 'x'), 'y', now)).toBe(false) // too soon
    expect(shouldAutoSnapshot(v(now - AUTO_GAP_MS, 'x'), 'y', now)).toBe(true)
  })

  it('prunes the oldest auto versions beyond the cap and never named ones', () => {
    const list = [v(1, 'a', false), ...Array.from({ length: 35 }, (_, i) => v(100 + i, String(i)))]
    const drop = pruneAuto(list, 30)
    expect(drop).toHaveLength(5)
    expect([...drop].sort()).toEqual(['v100', 'v101', 'v102', 'v103', 'v104'])
    expect(drop).not.toContain('v1')
  })

  it('makeVersion records counts, a thumbnail, and named / auto', () => {
    const d = emptyBoard('Plan')
    const s = makeSticky(10, 10)
    const doc = { ...d, objects: byId([s]), order: [s.id] }
    const auto = makeVersion(doc, { reason: 'Opened' })
    expect(auto.auto).toBe(true)
    expect(auto.count).toBe(1)
    expect(auto.thumbnail).toMatch(/^data:image\/svg\+xml|<svg/)
    const named = makeVersion(doc, { name: '  Client review  ' })
    expect(named.auto).toBe(false)
    expect(named.name).toBe('Client review')
    expect(named.sig).toBe(auto.sig)
  })
})

describe('diff and restore', () => {
  it('counts added, removed and changed items between two states', () => {
    const a = makeSticky(0, 0)
    const b = makeSticky(200, 0)
    const c = makeSticky(400, 0)
    const from = byId([a, b])
    const to = byId([{ ...a, text: 'edited' }, c])
    expect(diffSummary(from, to)).toEqual({ added: 1, removed: 1, changed: 1 })
    expect(diffSummary(from, { ...from })).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('replaceContent swaps the board in one undo step', () => {
    const d = emptyBoard('Restore')
    const s = makeSticky(0, 0, '#fff176', 'old')
    useBoard.getState().open({ ...d, objects: byId([s]), order: [s.id] })
    const n = makeShape('ellipse', 100, 100)
    useBoard.getState().select([s.id])
    useBoard.getState().replaceContent(byId([n]), [n.id, 'missing'])
    let st = useBoard.getState()
    expect(st.doc!.order).toEqual([n.id])
    expect(st.selection).toEqual([])
    st.undo()
    st = useBoard.getState()
    expect(st.doc!.order).toEqual([s.id])
    expect((st.doc!.objects[s.id] as { text: string }).text).toBe('old')
  })

  it('relative times read naturally', () => {
    const now = Date.now()
    expect(relativeTime(now - 5_000, now)).toBe('just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago')
  })
})
