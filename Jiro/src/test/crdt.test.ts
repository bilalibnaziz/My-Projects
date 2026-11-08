import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  boardDocFromYDoc,
  boardObjToYMap,

  createScopedUndoManager,
  initYDocFromBoardDoc,
  LOCAL_ORIGIN,
  REMOTE_ORIGIN,
  updateYText,
} from '@/board/crdt'
import { emptyBoard, makeCard, makeShape, makeSticky } from '@/board/factory'
import {
  assignFractionalOrders,
  generateKeyAfter,
  generateKeyBetween,
  generateKeyBefore,
  sortIdsByFractionalOrder,
} from '@/board/fractionalIndex'
import { loadBoard, saveBoard, openBoardCrdt } from '@/board/persist'
import { useBoard } from '@/board/store'
import type { ID } from '@/board/types'

describe('CRDT fractional indexing', () => {
  it('generates monotonic keys between null, before, after and between existing keys', () => {
    const k1 = generateKeyBetween(null, null)
    expect(typeof k1).toBe('string')
    const k0 = generateKeyBefore(k1)
    const k2 = generateKeyAfter(k1)
    expect(k0 < k1).toBe(true)
    expect(k1 < k2).toBe(true)

    const mid = generateKeyBetween(k0, k1)
    expect(k0 < mid).toBe(true)
    expect(mid < k1).toBe(true)
  })

  it('sorts objects deterministically with fallback tie-breaker', () => {
    const objs: Record<ID, { order?: string }> = {
      b: { order: 'a1' },
      a: { order: 'a0' },
      c: { order: 'a2' },
      d: { order: 'a1' }, // tie with b
    }
    const sorted = sortIdsByFractionalOrder(objs)
    expect(sorted[0]).toBe('a')
    expect(sorted[1]).toBe('b') // 'b'.localeCompare('d') < 0
    expect(sorted[2]).toBe('d')
    expect(sorted[3]).toBe('c')
  })

  it('assigns initial fractional orders across an array of IDs', () => {
    const ids = ['first', 'second', 'third']
    const assigned = assignFractionalOrders(ids)
    expect(assigned.first < assigned.second).toBe(true)
    expect(assigned.second < assigned.third).toBe(true)
  })
})

describe('CRDT text editing & character-level merging', () => {
  it('updates Y.Text with minimal diff without clobbering concurrent edits', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()

    const ytA = docA.getText('text')
    ytA.insert(0, 'The quick brown fox')
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

    const ytB = docB.getText('text')
    expect(ytB.toString()).toBe('The quick brown fox')

    // Peer A inserts 'very ' before 'quick'
    updateYText(ytA, 'The very quick brown fox')

    // Peer B replaces 'fox' with 'wolf'
    updateYText(ytB, 'The quick brown wolf')

    // Sync A -> B and B -> A
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)))
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)))

    expect(ytA.toString()).toBe('The very quick brown wolf')
    expect(ytB.toString()).toBe('The very quick brown wolf')
  })
})

describe('CRDT scoped UndoManager', () => {
  it('undo after a remote edit undoes only the local edit', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const originA = 'peerA'
    const originB = 'peerB'

    const objectsA = docA.getMap<Y.Map<unknown>>('objects')
    const objectsB = docB.getMap<Y.Map<unknown>>('objects')

    const umA = createScopedUndoManager(docA, originA)

    // 1. Initial shared state: Sticky S at (0, 0)
    docA.transact(() => {
      const s = new Y.Map<unknown>()
      s.set('id', 'sticky_1')
      s.set('kind', 'sticky')
      s.set('x', 0)
      s.set('y', 0)
      s.set('text', new Y.Text('Initial note'))
      s.set('order', 'a0')
      objectsA.set('sticky_1', s)
    }, originA)
    umA.stopCapturing()

    // Sync to Peer B
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
    expect(objectsB.get('sticky_1')).toBeDefined()

    // 2. Peer A moves Sticky S to (100, 200)
    docA.transact(() => {
      const s = objectsA.get('sticky_1')!
      s.set('x', 100)
      s.set('y', 200)
    }, originA)
    umA.stopCapturing()

    // 3. Peer B creates a new Card C at (500, 500)
    docB.transact(() => {
      const c = new Y.Map<unknown>()
      c.set('id', 'card_remote')
      c.set('kind', 'card')
      c.set('x', 500)
      c.set('y', 500)
      c.set('body', new Y.Text('Card from B'))
      c.set('order', 'a1')
      objectsB.set('card_remote', c)
    }, originB)

    // Sync Peer B's edit to Peer A
    const updateBtoA = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA))
    Y.applyUpdate(docA, updateBtoA, originB)

    expect(objectsA.get('sticky_1')?.get('x')).toBe(100)
    expect(objectsA.get('card_remote')?.get('x')).toBe(500)

    // 4. Peer A invokes undo
    umA.undo()

    // Sticky S must revert to (0, 0), and Card C from Peer B MUST NOT be undone!
    expect(objectsA.get('sticky_1')?.get('x')).toBe(0)
    expect(objectsA.get('sticky_1')?.get('y')).toBe(0)
    expect(objectsA.get('card_remote')).toBeDefined()
    expect(objectsA.get('card_remote')?.get('x')).toBe(500)

    // Sync back to Peer B
    const updateAtoB = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB))
    Y.applyUpdate(docB, updateAtoB, originA)

    expect(objectsB.get('sticky_1')?.get('x')).toBe(0)
    expect(objectsB.get('card_remote')?.get('x')).toBe(500)
  })

  it('maintains gesture coalescing during rapid local updates', () => {
    const doc = new Y.Doc()
    const objects = doc.getMap<Y.Map<unknown>>('objects')
    const um = createScopedUndoManager(doc, LOCAL_ORIGIN)

    // Add sticky
    doc.transact(() => {
      const s = new Y.Map<unknown>()
      s.set('id', 's')
      s.set('x', 0)
      objects.set('s', s)
    }, LOCAL_ORIGIN)
    um.stopCapturing()
    expect(um.undoStack.length).toBe(1)

    // Begin gesture
    um.stopCapturing()
    for (let i = 1; i <= 30; i++) {
      doc.transact(() => {
        objects.get('s')!.set('x', i * 2)
      }, LOCAL_ORIGIN)
    }
    // End gesture
    um.stopCapturing()

    // Entire gesture must be exactly 1 undo entry
    expect(um.undoStack.length).toBe(2)
    expect(objects.get('s')?.get('x')).toBe(60)

    // Remote edit arrives
    doc.transact(() => {
      const r = new Y.Map<unknown>()
      r.set('id', 'r')
      r.set('x', 999)
      objects.set('r', r)
    }, REMOTE_ORIGIN)

    // Undo reverts gesture in a single step
    um.undo()
    expect(objects.get('s')?.get('x')).toBe(0)
    expect(objects.get('r')).toBeDefined()

    // Redo restores gesture in a single step
    um.redo()
    expect(objects.get('s')?.get('x')).toBe(60)
  })
})

describe('CRDT 1,000 concurrent operations convergence acceptance test', () => {
  it('1,000 random concurrent operations across 3 simulated peers converge to identical state', () => {
    interface Peer {
      id: string
      doc: Y.Doc
      name: string
    }

    const peers: Peer[] = ['PeerA', 'PeerB', 'PeerC'].map((name, i) => {
      const doc = new Y.Doc()
      doc.clientID = 1000 + i
      return { id: `peer_${i}`, doc, name }
    })

    // Helper to sync two peers
    const syncPeers = (p1: Peer, p2: Peer) => {
      const u1 = Y.encodeStateAsUpdate(p1.doc, Y.encodeStateVector(p2.doc))
      const u2 = Y.encodeStateAsUpdate(p2.doc, Y.encodeStateVector(p1.doc))
      if (u1.length > 0) Y.applyUpdate(p2.doc, u1, REMOTE_ORIGIN)
      if (u2.length > 0) Y.applyUpdate(p1.doc, u2, REMOTE_ORIGIN)
    }

    const fullSync = () => {
      for (let round = 0; round < 4; round++) {
        syncPeers(peers[0], peers[1])
        syncPeers(peers[1], peers[2])
        syncPeers(peers[0], peers[2])
      }
    }

    // Seed initial doc with 3 items
    const initialBoard = emptyBoard('Collab Test')
    const s1 = makeSticky(0, 0, '#fff176', 'Welcome')
    const s2 = makeShape('rect', 200, 200)
    const s3 = makeCard(400, 0)
    initialBoard.objects[s1.id] = s1
    initialBoard.objects[s2.id] = s2
    initialBoard.objects[s3.id] = s3
    initialBoard.order = [s1.id, s2.id, s3.id]
    initialBoard.notes = 'Initial collaborative notes'

    initYDocFromBoardDoc(peers[0].doc, initialBoard, LOCAL_ORIGIN)
    syncPeers(peers[0], peers[1])
    syncPeers(peers[0], peers[2])

    // Run 1,000 randomized operations
    const totalOps = 1000
    for (let opIdx = 0; opIdx < totalOps; opIdx++) {
      const peer = peers[opIdx % 3]
      const ydoc = peer.doc
      const yObjects = ydoc.getMap<Y.Map<unknown>>('objects')
      const objIds = Array.from(yObjects.keys())

      const action = Math.floor(Math.random() * 8)

      switch (action) {
        case 0: {
          // Add new sticky
          ydoc.transact(() => {
            const id = `sticky_${peer.name}_${opIdx}`
            const s = makeSticky(Math.random() * 800, Math.random() * 600, '#fff176', `Text ${opIdx}`)
            const lastId = objIds[objIds.length - 1]
            const lastKey = lastId ? (yObjects.get(lastId)?.get('order') as string) : null
            const orderKey = generateKeyAfter(lastKey)
            yObjects.set(id, boardObjToYMap(s, orderKey))
          }, LOCAL_ORIGIN)
          break
        }
        case 1: {
          // Add new card
          ydoc.transact(() => {
            const id = `card_${peer.name}_${opIdx}`
            const c = makeCard(Math.random() * 800, Math.random() * 600)
            c.body = `Card body ${opIdx}`
            const orderKey = generateKeyBetween(null, null)
            yObjects.set(id, boardObjToYMap(c, orderKey))
          }, LOCAL_ORIGIN)
          break
        }
        case 2: {
          // Move object
          if (objIds.length > 0) {
            const pickId = objIds[Math.floor(Math.random() * objIds.length)]
            ydoc.transact(() => {
              const obj = yObjects.get(pickId)
              if (obj) {
                obj.set('x', Math.round(Math.random() * 1000))
                obj.set('y', Math.round(Math.random() * 1000))
              }
            }, LOCAL_ORIGIN)
          }
          break
        }
        case 3: {
          // Edit text inside object
          if (objIds.length > 0) {
            const pickId = objIds[Math.floor(Math.random() * objIds.length)]
            ydoc.transact(() => {
              const obj = yObjects.get(pickId)
              if (obj) {
                const textProp = obj.get('text') ?? obj.get('body')
                if (textProp instanceof Y.Text) {
                  textProp.insert(Math.floor(Math.random() * (textProp.length + 1)), ` ${peer.name}`)
                }
              }
            }, LOCAL_ORIGIN)
          }
          break
        }
        case 4: {
          // Reorder item (bring to front or send to back)
          if (objIds.length > 1) {
            const pickId = objIds[Math.floor(Math.random() * objIds.length)]
            ydoc.transact(() => {
              const obj = yObjects.get(pickId)
              if (obj) {
                const toFront = Math.random() > 0.5
                const allKeys = objIds.map((id) => yObjects.get(id)?.get('order') as string).filter(Boolean)
                allKeys.sort()
                const newKey = toFront
                  ? generateKeyAfter(allKeys[allKeys.length - 1])
                  : generateKeyBefore(allKeys[0])
                obj.set('order', newKey)
              }
            }, LOCAL_ORIGIN)
          }
          break
        }
        case 5: {
          // Append / edit board notes
          ydoc.transact(() => {
            const notes = ydoc.getText('notes')
            notes.insert(Math.floor(Math.random() * (notes.length + 1)), ` [${peer.name}:${opIdx}]`)
          }, LOCAL_ORIGIN)
          break
        }
        case 6: {
          // Delete an object (keep at least 5 objects alive)
          if (objIds.length > 5) {
            const pickId = objIds[Math.floor(Math.random() * objIds.length)]
            ydoc.transact(() => {
              yObjects.delete(pickId)
            }, LOCAL_ORIGIN)
          }
          break
        }
        case 7: {
          // Intermittent partial sync between two random peers
          const pA = peers[Math.floor(Math.random() * 3)]
          const pB = peers[Math.floor(Math.random() * 3)]
          if (pA !== pB) syncPeers(pA, pB)
          break
        }
      }

      // Periodic network exchange every 10 operations
      if (opIdx % 10 === 0) {
        const p1 = peers[opIdx % 3]
        const p2 = peers[(opIdx + 1) % 3]
        syncPeers(p1, p2)
      }
    }

    // Fully converge all 3 peers
    fullSync()

    const docA = boardDocFromYDoc(peers[0].doc)
    const docB = boardDocFromYDoc(peers[1].doc)
    const docC = boardDocFromYDoc(peers[2].doc)

    // 1. Verify object IDs match completely
    const keysA = Object.keys(docA.objects).sort()
    const keysB = Object.keys(docB.objects).sort()
    const keysC = Object.keys(docC.objects).sort()

    expect(keysA).toEqual(keysB)
    expect(keysB).toEqual(keysC)
    expect(keysA.length).toBeGreaterThan(5)

    // 2. Verify deterministic fractional order array matches identically across all peers
    expect(docA.order).toEqual(docB.order)
    expect(docB.order).toEqual(docC.order)

    // 3. Verify notes converge identically
    expect(docA.notes).toBe(docB.notes)
    expect(docB.notes).toBe(docC.notes)

    // 4. Verify each individual object field converged identically
    for (const id of keysA) {
      const objA = docA.objects[id]
      const objB = docB.objects[id]
      const objC = docC.objects[id]

      expect(objA.kind).toBe(objB.kind)
      expect(objB.kind).toBe(objC.kind)

      expect(objA.x).toBe(objB.x)
      expect(objB.x).toBe(objC.x)

      expect(objA.y).toBe(objB.y)
      expect(objB.y).toBe(objC.y)

      expect(objA.order).toBe(objB.order)
      expect(objB.order).toBe(objC.order)

      if ('text' in objA && 'text' in objB && 'text' in objC) {
        expect(objA.text).toBe(objB.text)
        expect(objB.text).toBe(objC.text)
      }
      if ('body' in objA && 'body' in objB && 'body' in objC) {
        expect(objA.body).toBe(objB.body)
        expect(objB.body).toBe(objC.body)
      }
    }
  })
})

describe('CRDT IndexedDB persistence and legacy migration', () => {
  it('migrates legacy board format into CRDT and persists updates', async () => {
    const legacyId = 'legacy_board_42'
    const legacyBoard = emptyBoard('Legacy Plan')
    legacyBoard.id = legacyId
    const s = makeSticky(100, 150, '#fff176', 'Legacy sticky text')
    legacyBoard.objects[s.id] = s
    legacyBoard.order = [s.id]
    legacyBoard.notes = 'Legacy notes'

    // Save directly in legacy store
    await saveBoard(legacyBoard)

    // Load board: no CRDT copy yet, so the JSON copy is returned
    const loaded = await loadBoard(legacyId)
    expect(loaded).toBeDefined()
    expect(loaded!.name).toBe('Legacy Plan')
    expect(loaded!.objects[s.id].x).toBe(100)
    expect((loaded!.objects[s.id] as { text: string }).text).toBe('Legacy sticky text')
    expect(loaded!.order).toEqual([s.id])

    // Opening it builds the CRDT copy and keeps it saved
    const opened = await openBoardCrdt(loaded!)
    expect(boardDocFromYDoc(opened.ydoc).objects[s.id]).toBeDefined()
    opened.ydoc.transact(() => opened.ydoc.getMap('meta').set('updatedAt', loaded!.updatedAt + 1000), 'local')
    opened.ydoc.getText('notes').insert(0, 'CRDT ')
    await new Promise((r) => setTimeout(r, 50))
    await opened.provider?.destroy()

    // A second session reads the stored CRDT copy (newer than the JSON one)
    const again = await loadBoard(legacyId)
    expect(again!.notes).toBe('CRDT Legacy notes')

    // A newer JSON copy (e.g. renamed from the home screen) wins, and opening rebuilds the CRDT from it
    await saveBoard({ ...again!, name: 'Renamed', updatedAt: again!.updatedAt + 5000 })
    const renamed = await loadBoard(legacyId)
    expect(renamed!.name).toBe('Renamed')
    const reopened = await openBoardCrdt(renamed!)
    expect(boardDocFromYDoc(reopened.ydoc).name).toBe('Renamed')
    expect(boardDocFromYDoc(reopened.ydoc).notes).toBe('CRDT Legacy notes') // rebuilt, not merged (no duplicate text)
    await reopened.provider?.destroy()
  })
})

describe('CRDT integration with zustand useBoard store', () => {
  it('mutations through useBoard reflect in reactive Y.Doc view and local scoped undo', () => {
    const d = emptyBoard('Store Test')
    useBoard.getState().open(d)

    const sticky = makeSticky(50, 50, '#fff176', 'Zustand Sticky')
    useBoard.getState().add(sticky)

    let state = useBoard.getState()
    expect(state.doc!.objects[sticky.id]).toBeDefined()
    expect(state.doc!.order).toContain(sticky.id)
    expect(state.ydoc).toBeDefined()

    // Remote peer applies an update directly onto the Y.Doc
    const remoteUpdate = new Y.Doc()
    remoteUpdate.transact(() => {
      const m = new Y.Map<unknown>()
      m.set('id', 'remote_card')
      m.set('kind', 'card')
      m.set('x', 900)
      m.set('y', 900)
      m.set('body', new Y.Text('Remote text'))
      m.set('order', 'z9')
      remoteUpdate.getMap('objects').set('remote_card', m)
    })
    const updateBytes = Y.encodeStateAsUpdate(remoteUpdate)

    // Apply remote update to our store's Y.Doc
    useBoard.getState().applyRemoteUpdate(updateBytes, REMOTE_ORIGIN)

    state = useBoard.getState()
    expect(state.doc!.objects['remote_card']).toBeDefined()
    expect(state.doc!.objects['remote_card'].x).toBe(900)

    // Local undo: should undo only the local add of sticky, NOT the remote_card!
    useBoard.getState().undo()

    state = useBoard.getState()
    expect(state.doc!.objects[sticky.id]).toBeUndefined()
    expect(state.doc!.objects['remote_card']).toBeDefined()

    useBoard.getState().close()
  })
})
