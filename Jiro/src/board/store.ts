import { create } from 'zustand'
import * as Y from 'yjs'
import {
  boardDocFromYDoc,
  boardMetaFromYDoc,
  transactionChanges,
  yMapToBoardObj,
  boardObjToYMap,
  createBoardYDoc,
  createScopedUndoManager,
  initYDocFromBoardDoc,
  LOCAL_ORIGIN,
  patchYMap,
  REMOTE_ORIGIN,
  updateYText,
} from './crdt'
import { generateInitialKeys, minimalReorderKeys, generateNKeysBetweenKeys, sortIdsByFractionalOrder } from './fractionalIndex'
import { connectorBounds, rotatedBounds, uid, union } from './geometry'
import { layoutMind, mindDescendants, mindRoot } from './mindmap'
import type { BoardDoc, BoardObj, ID, Rect, ShapeKind, Tool, Viewport } from './types'

/** Current fractional `order` keys of `ids` in the Y.Doc. */
function currentOrderKeys(ydoc: Y.Doc, ids: ID[]): Record<ID, string | undefined> {
  const yObjects = ydoc.getMap<Y.Map<unknown>>('objects')
  const out: Record<ID, string | undefined> = {}
  for (const id of ids) out[id] = yObjects.get(id)?.get('order') as string | undefined
  return out
}

interface Snapshot {
  objects: Record<ID, BoardObj>
  order: ID[]
}

export interface ToolOptions {
  shape: ShapeKind
  stickyColor: string
  penColor: string
  penWidth: number
  highlighterColor: string
  emoji: string
  connectorStyle: 'straight' | 'elbow' | 'curve'
}

export interface BoardState {
  doc: BoardDoc | null
  ydoc: Y.Doc | null
  undoManager: Y.UndoManager | null
  vp: Viewport
  selection: ID[]
  editingId: ID | null
  tool: Tool
  /** Tool stays active after placing an object (double-click a tool / hold ⇧ to lock) */
  toolLocked: boolean
  opts: ToolOptions
  past: Snapshot[]
  future: Snapshot[]
  /** Snapshot taken at gesture start; pushed onto history on its first change */
  gesture: Snapshot | null
  gestureDirty: boolean
  snap: boolean
  dirty: number
  author: string

  open(doc: BoardDoc, ydoc?: Y.Doc): void
  close(): void
  rename(name: string): void
  setBackground(bg: BoardDoc['background']): void
  setNotes(notes: string): void
  /** Board-level data that isn't an undo step (activity log, who shared it) — goes through the CRDT */
  setMeta(patch: Partial<Pick<BoardDoc, 'activity' | 'sharedBy'>>): void
  /** Put objects in this z-order (ids not listed keep their place relative to each other at the end) */
  reorder(order: ID[], opts?: { history?: boolean }): void
  setVp(vp: Partial<Viewport>): void
  setTool(t: Tool, locked?: boolean): void
  setOpts(o: Partial<ToolOptions>): void
  select(ids: ID[], additive?: boolean): void
  setEditing(id: ID | null): void

  checkpoint(): void
  beginGesture(): void
  endGesture(): void
  add(objs: BoardObj | BoardObj[], opts?: { select?: boolean; history?: boolean; back?: boolean }): void
  update(id: ID, patch: Partial<BoardObj>, opts?: { history?: boolean; relayout?: boolean }): void
  updateMany(patches: Record<ID, Partial<BoardObj>>, opts?: { history?: boolean; relayout?: boolean }): void
  remove(ids: ID[], opts?: { history?: boolean }): void
  /** Swap the whole board content (version restore) as one undo step */
  replaceContent(objects: Record<ID, BoardObj>, order: ID[]): void
  undo(): void
  redo(): void

  bringToFront(ids?: ID[]): void
  sendToBack(ids?: ID[]): void
  forward(ids?: ID[]): void
  backward(ids?: ID[]): void
  group(): void
  ungroup(): void
  toggleLock(): void
  relayoutMind(id: ID): void
  applyRemoteUpdate(update: Uint8Array, origin?: string): void
}

const initialOpts: ToolOptions = {
  shape: 'rect',
  stickyColor: '#fff176',
  penColor: '#1a1a2e',
  penWidth: 4,
  highlighterColor: '#ffd02f',
  emoji: '👍',
  connectorStyle: 'curve',
}

let activeUndoManager: Y.UndoManager | null = null
let unsubscribeObserver: (() => void) | null = null
let isGesturing = false

export const useBoard = create<BoardState>()((set, get) => {
  /** Re-run mind-map layout for every tree touched by `ids` */
  const relayout = (
    objects: Record<ID, BoardObj>,
    order: ID[],
    ids: Iterable<ID>,
    yObjects?: Y.Map<Y.Map<unknown>>,
  ) => {
    const roots = new Set<ID>()
    for (const id of ids) {
      const r = mindRoot(objects, id)
      if (r) roots.add(r.id)
    }
    for (const r of roots) {
      const p = layoutMind(objects, order, r)
      for (const [id, pos] of Object.entries(p)) {
        objects[id] = { ...objects[id], ...pos } as BoardObj
        if (yObjects) {
          const yMap = yObjects.get(id)
          if (yMap) {
            yMap.set('x', pos.x)
            yMap.set('y', pos.y)
          }
        }
      }
    }
  }

  const targets = (ids?: ID[]) => {
    const s = get()
    return new Set(ids ?? s.selection)
  }

  return {
    doc: null,
    ydoc: null,
    undoManager: null,
    vp: { x: 0, y: 0, zoom: 1 },
    selection: [],
    editingId: null,
    tool: 'select',
    toolLocked: false,
    opts: initialOpts,
    past: [],
    future: [],
    gesture: null,
    gestureDirty: false,
    snap: true,
    dirty: 0,
    author: 'You',

    open(doc, ydoc) {
      if (unsubscribeObserver) {
        unsubscribeObserver()
        unsubscribeObserver = null
      }
      if (activeUndoManager) {
        activeUndoManager.destroy()
        activeUndoManager = null
      }

      const activeDoc = ydoc ?? createBoardYDoc()
      if (!ydoc) {
        initYDocFromBoardDoc(activeDoc, doc, LOCAL_ORIGIN)
      }

      activeUndoManager = createScopedUndoManager(activeDoc, LOCAL_ORIGIN)

      const yObjects = activeDoc.getMap<Y.Map<unknown>>('objects')

      // One sync per transaction, touching only what changed: unchanged objects keep their identity
      // (so their views don't re-render), and order is re-sorted only when keys or membership changed
      const onTransaction = (txn: Y.Transaction) => {
        const prev = get().doc
        if (!prev) return
        const ch = transactionChanges(txn, activeDoc)
        const undoLen = activeUndoManager ? activeUndoManager.undoStack.length : 0
        const redoLen = activeUndoManager ? activeUndoManager.redoStack.length : 0
        const stacksMoved = undoLen !== get().past.length || redoLen !== get().future.length
        if (!ch.ids.size && !ch.meta && !stacksMoved) return
        let objects = prev.objects
        if (ch.ids.size) {
          objects = { ...prev.objects }
          for (const id of ch.ids) {
            const y = yObjects.get(id)
            if (y instanceof Y.Map) objects[id] = yMapToBoardObj(y)
            else delete objects[id]
          }
        }
        const order = ch.order ? sortIdsByFractionalOrder(objects) : prev.order
        const nextDoc: BoardDoc = ch.meta ? { ...boardMetaFromYDoc(activeDoc), objects, order } : { ...prev, objects, order }
        const snap = { objects, order }
        set({
          doc: nextDoc,
          past: undoLen === get().past.length ? get().past : Array(undoLen).fill(snap),
          future: redoLen === get().future.length ? get().future : Array(redoLen).fill(snap),
          dirty: get().dirty + 1,
        })
      }

      activeDoc.on('afterTransaction', onTransaction)
      unsubscribeObserver = () => activeDoc.off('afterTransaction', onTransaction)

      const initialDoc = boardDocFromYDoc(activeDoc)
      isGesturing = false
      set({
        doc: initialDoc,
        ydoc: activeDoc,
        undoManager: activeUndoManager,
        vp: initialDoc.viewport || { x: 0, y: 0, zoom: 1 },
        selection: [],
        editingId: null,
        past: [],
        future: [],
        tool: 'select',
        gesture: null,
        gestureDirty: false,
      })
    },

    close() {
      if (unsubscribeObserver) {
        unsubscribeObserver()
        unsubscribeObserver = null
      }
      if (activeUndoManager) {
        activeUndoManager.destroy()
        activeUndoManager = null
      }
      isGesturing = false
      set({
        doc: null,
        ydoc: null,
        undoManager: null,
        selection: [],
        editingId: null,
        past: [],
        future: [],
        gesture: null,
        gestureDirty: false,
      })
    },

    rename(name) {
      const s = get()
      if (!s.ydoc) return
      s.ydoc.transact(() => {
        const meta = s.ydoc!.getMap('meta')
        meta.set('name', name)
        meta.set('updatedAt', Date.now())
      }, LOCAL_ORIGIN)
      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    setBackground(background) {
      const s = get()
      if (!s.ydoc) return
      s.ydoc.transact(() => {
        const meta = s.ydoc!.getMap('meta')
        meta.set('background', background)
        meta.set('updatedAt', Date.now())
      }, LOCAL_ORIGIN)
      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    setNotes(notes) {
      const s = get()
      if (!s.ydoc) return
      s.ydoc.transact(() => {
        const yNotes = s.ydoc!.getText('notes')
        updateYText(yNotes, notes)
        const meta = s.ydoc!.getMap('meta')
        meta.set('updatedAt', Date.now())
      }, LOCAL_ORIGIN)
      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    setMeta(patch) {
      const s = get()
      if (!s.ydoc) return
      s.ydoc.transact(() => {
        const meta = s.ydoc!.getMap('meta')
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) meta.delete(k)
          else meta.set(k, v)
        }
      }, 'no-history')
    },

    reorder(order, opts = {}) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const listed = new Set(order)
      const full = [...order.filter((id) => s.doc!.objects[id]), ...s.doc.order.filter((id) => !listed.has(id))]
      if (full.length === s.doc.order.length && full.every((id, i) => id === s.doc!.order[i])) return
      const yObjects = s.ydoc.getMap<Y.Map<unknown>>('objects')
      const current: Record<ID, string | undefined> = {}
      for (const id of full) current[id] = yObjects.get(id)?.get('order') as string | undefined
      // Re-key only the moved objects, so concurrent reorders on other peers keep their keys
      const newKeys = minimalReorderKeys(current, full)
      s.ydoc.transact(() => {
        for (const [id, key] of Object.entries(newKeys)) {
          const y = yObjects.get(id)
          if (y && y.get('order') !== key) y.set('order', key)
        }
      }, opts.history === false ? 'no-history' : LOCAL_ORIGIN)
      if (!isGesturing && opts.history !== false) activeUndoManager?.stopCapturing()
    },

    setVp(v) {
      set({ vp: { ...get().vp, ...v } })
    },

    setTool(tool, locked = false) {
      set({ tool, toolLocked: locked, editingId: null, ...(tool !== 'select' ? { selection: [] } : {}) })
    },

    setOpts(o) {
      set({ opts: { ...get().opts, ...o } })
    },

    select(ids, additive = false) {
      const s = get()
      if (!s.doc) return
      // Expand groups: picking one member picks the whole group
      const out = new Set(additive ? s.selection : [])
      for (const id of ids) {
        const o = s.doc.objects[id]
        if (!o) continue
        if (additive && s.selection.includes(id) && ids.length === 1) {
          out.delete(id)
          if (o.groupId) for (const k of s.doc.order) if (s.doc.objects[k]?.groupId === o.groupId) out.delete(k)
          continue
        }
        out.add(id)
        if (o.groupId) for (const k of s.doc.order) if (s.doc.objects[k]?.groupId === o.groupId) out.add(k)
      }
      const sel = [...out]
      if (sel.length === s.selection.length && sel.every((x, i) => x === s.selection[i])) return
      set({ selection: sel, editingId: s.editingId && out.has(s.editingId) ? s.editingId : null })
    },

    setEditing(id) {
      set({ editingId: id, ...(id ? { selection: [id] } : {}) })
    },

    checkpoint() {
      activeUndoManager?.stopCapturing()
    },

    beginGesture() {
      const s = get()
      if (!s.doc) return
      activeUndoManager?.stopCapturing()
      isGesturing = true
      set({ gesture: { objects: s.doc.objects, order: s.doc.order }, gestureDirty: false })
    },

    endGesture() {
      activeUndoManager?.stopCapturing()
      isGesturing = false
      set({ gesture: null, gestureDirty: false })
    },

    add(objs, opts = {}) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const list = Array.isArray(objs) ? objs : [objs]
      if (!list.length) return

      const origin = opts.history === false ? 'no-history' : LOCAL_ORIGIN
      const currentOrder = s.doc.order
      const objects = s.doc.objects
      let keys: string[]

      if (opts.back) {
        // Frames go below everything else so they never hide content
        const frames = currentOrder.filter((id) => objects[id]?.kind === 'frame')
        const rest = currentOrder.filter((id) => objects[id]?.kind !== 'frame')
        const prevKey = frames.length ? objects[frames[frames.length - 1]]?.order : null
        const nextKey = rest.length ? objects[rest[0]]?.order : null
        keys = generateNKeysBetweenKeys(prevKey, nextKey, list.length)
      } else {
        const lastId = currentOrder[currentOrder.length - 1]
        const lastKey = lastId ? objects[lastId]?.order : null
        keys = generateNKeysBetweenKeys(lastKey, null, list.length)
      }

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        list.forEach((o, i) => {
          yObjects.set(o.id, boardObjToYMap(o, keys[i]))
        })

        const mindIds = list.filter((o) => o.kind === 'mind').map((o) => o.id)
        if (mindIds.length) {
          const snapshotDoc = boardDocFromYDoc(s.ydoc!)
          relayout(snapshotDoc.objects, snapshotDoc.order, mindIds, yObjects)
        }
      }, origin)

      if (!isGesturing && opts.history !== false) {
        activeUndoManager?.stopCapturing()
      }
      if (opts.select !== false) {
        set({ selection: list.map((o) => o.id) })
      }
    },

    update(id, patch, opts = {}) {
      get().updateMany({ [id]: patch }, opts)
    },

    updateMany(patches, opts = {}) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const ids = Object.keys(patches).filter((id) => s.doc!.objects[id])
      if (!ids.length) return

      const origin = opts.history === false ? 'no-history' : LOCAL_ORIGIN

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        const mindTouched: ID[] = []
        for (const id of ids) {
          const yMap = yObjects.get(id)
          if (!yMap) continue
          patchYMap(yMap, patches[id])
          const obj = s.doc!.objects[id]
          if (
            obj?.kind === 'mind' &&
            ('w' in patches[id] || 'h' in patches[id] || 'text' in patches[id] || 'collapsed' in patches[id] || 'side' in patches[id])
          ) {
            mindTouched.push(id)
          }
        }
        if (mindTouched.length && opts.relayout !== false) {
          const snapshotDoc = boardDocFromYDoc(s.ydoc!)
          relayout(snapshotDoc.objects, snapshotDoc.order, mindTouched, yObjects)
        }
      }, origin)

      if (!isGesturing && opts.history !== false) {
        activeUndoManager?.stopCapturing()
      }
    },

    remove(ids, opts = {}) {
      const s = get()
      if (!s.doc || !s.ydoc || !ids.length) return
      const kill = new Set(ids)
      // Removing a mind node removes its subtree
      for (const id of ids) {
        if (s.doc.objects[id]?.kind === 'mind') {
          for (const d of mindDescendants(s.doc.objects, s.doc.order, id)) kill.add(d)
        }
      }
      const touchedRoots = ids
        .map((id) => s.doc!.objects[id])
        .filter((o) => o?.kind === 'mind' && o.parent)
        .map((o) => (o as { parent: ID }).parent)

      const origin = opts.history === false ? 'no-history' : LOCAL_ORIGIN

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        for (const id of kill) {
          yObjects.delete(id)
        }
        // Connectors pointing at removed objects go too
        for (const id of s.doc!.order) {
          const o = s.doc!.objects[id]
          if (o?.kind === 'connector' && ((o.from.id && kill.has(o.from.id)) || (o.to.id && kill.has(o.to.id)))) {
            yObjects.delete(id)
            kill.add(id)
          }
        }
        const snapshotDoc = boardDocFromYDoc(s.ydoc!)
        const aliveRoots = touchedRoots.filter((id) => snapshotDoc.objects[id])
        if (aliveRoots.length) {
          relayout(snapshotDoc.objects, snapshotDoc.order, aliveRoots, yObjects)
        }
      }, origin)

      if (!isGesturing && opts.history !== false) {
        activeUndoManager?.stopCapturing()
      }
      set({ selection: get().selection.filter((id) => !kill.has(id)), editingId: null })
    },

    replaceContent(objects, order) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const cleanOrder = order.filter((id) => objects[id])
      const keys = generateInitialKeys(cleanOrder.length)

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        for (const k of Array.from(yObjects.keys())) {
          yObjects.delete(k)
        }
        cleanOrder.forEach((id, idx) => {
          yObjects.set(id, boardObjToYMap(objects[id], keys[idx]))
        })
      }, LOCAL_ORIGIN)

      if (!isGesturing) activeUndoManager?.stopCapturing()
      set({ selection: [], editingId: null })
    },

    undo() {
      if (!activeUndoManager || !activeUndoManager.undoStack.length) return
      activeUndoManager.undo()
      const s = get()
      if (s.doc) {
        set({
          selection: s.selection.filter((id) => s.doc!.objects[id]),
          editingId: null,
        })
      }
    },

    redo() {
      if (!activeUndoManager || !activeUndoManager.redoStack.length) return
      activeUndoManager.redo()
      const s = get()
      if (s.doc) {
        set({
          selection: s.selection.filter((id) => s.doc!.objects[id]),
          editingId: null,
        })
      }
    },

    bringToFront(ids) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const t = targets(ids)
      const order = s.doc.order
      const others = order.filter((id) => !t.has(id))
      const moving = order.filter((id) => t.has(id))
      if (!moving.length) return

      const lastKey = others.length ? s.doc.objects[others[others.length - 1]]?.order : null
      const keys = generateNKeysBetweenKeys(lastKey, null, moving.length)

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        moving.forEach((id, i) => {
          yObjects.get(id)?.set('order', keys[i])
        })
      }, LOCAL_ORIGIN)

      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    sendToBack(ids) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const t = targets(ids)
      const isFrame = (id: ID) => s.doc!.objects[id]?.kind === 'frame'
      const order = s.doc.order
      const selFrames = order.filter((id) => t.has(id) && isFrame(id))
      const selOther = order.filter((id) => t.has(id) && !isFrame(id))
      const frames = order.filter((id) => !t.has(id) && isFrame(id))
      const rest = order.filter((id) => !t.has(id) && !isFrame(id))
      const targetOrder = [...selFrames, ...frames, ...selOther, ...rest]
      const newKeys = minimalReorderKeys(currentOrderKeys(s.ydoc, targetOrder), targetOrder, t)

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        for (const [id, key] of Object.entries(newKeys)) {
          yObjects.get(id)?.set('order', key)
        }
      }, LOCAL_ORIGIN)

      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    forward(ids) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const t = targets(ids)
      const order = [...s.doc.order]
      let changed = false
      for (let i = order.length - 2; i >= 0; i--) {
        if (t.has(order[i]) && !t.has(order[i + 1])) {
          ;[order[i], order[i + 1]] = [order[i + 1], order[i]]
          changed = true
        }
      }
      if (!changed) return
      const newKeys = minimalReorderKeys(currentOrderKeys(s.ydoc, order), order, t)

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        for (const [id, key] of Object.entries(newKeys)) {
          yObjects.get(id)?.set('order', key)
        }
      }, LOCAL_ORIGIN)

      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    backward(ids) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      const t = targets(ids)
      const order = [...s.doc.order]
      let changed = false
      for (let i = 1; i < order.length; i++) {
        if (t.has(order[i]) && !t.has(order[i - 1])) {
          ;[order[i], order[i - 1]] = [order[i - 1], order[i]]
          changed = true
        }
      }
      if (!changed) return
      const newKeys = minimalReorderKeys(currentOrderKeys(s.ydoc, order), order, t)

      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        for (const [id, key] of Object.entries(newKeys)) {
          yObjects.get(id)?.set('order', key)
        }
      }, LOCAL_ORIGIN)

      if (!isGesturing) activeUndoManager?.stopCapturing()
    },

    group() {
      const s = get()
      if (s.selection.length < 2) return
      const g = uid()
      s.updateMany(Object.fromEntries(s.selection.map((id) => [id, { groupId: g }])))
    },

    ungroup() {
      const s = get()
      s.updateMany(Object.fromEntries(s.selection.map((id) => [id, { groupId: undefined }])))
    },

    toggleLock() {
      const s = get()
      if (!s.doc || !s.selection.length) return
      const lock = !s.selection.every((id) => s.doc!.objects[id]?.locked)
      s.updateMany(Object.fromEntries(s.selection.map((id) => [id, { locked: lock }])))
    },

    relayoutMind(id) {
      const s = get()
      if (!s.doc || !s.ydoc) return
      s.ydoc.transact(() => {
        const yObjects = s.ydoc!.getMap<Y.Map<unknown>>('objects')
        relayout(s.doc!.objects, s.doc!.order, [id], yObjects)
      }, 'no-history')
    },

    applyRemoteUpdate(update, origin = REMOTE_ORIGIN) {
      const s = get()
      if (!s.ydoc) return
      Y.applyUpdate(s.ydoc, update, origin)
    },
  }
})

/** Bounds of a set of objects (connectors included) */
export function boundsOf(ids: ID[], objects: Record<ID, BoardObj>): Rect | null {
  return union(
    ids
      .map((id) => objects[id])
      .filter(Boolean)
      .map((o) => (o.kind === 'connector' ? connectorBounds(o, objects) : rotatedBounds(o))),
  )
}

export function screenToBoard(vp: Viewport, sx: number, sy: number) {
  return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom }
}
export function boardToScreen(vp: Viewport, bx: number, by: number) {
  return { x: bx * vp.zoom + vp.x, y: by * vp.zoom + vp.y }
}

// Exposed for e2e checks
declare global {
  interface Window {
    __jiro?: { store: typeof useBoard }
  }
}
if (typeof window !== 'undefined') window.__jiro = { store: useBoard }
