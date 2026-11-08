import * as Y from 'yjs'
import { generateInitialKeys, generateKeyAfter, sortIdsByFractionalOrder } from './fractionalIndex'
import type { BoardDoc, BoardObj, ID, Viewport } from './types'

export const LOCAL_ORIGIN = 'local'
export const REMOTE_ORIGIN = 'remote'

/**
 * Returns true if the object field should be stored as a collaborative Y.Text.
 */
export function isTextField(kind: string | undefined, key: string): boolean {
  if (key === 'text') {
    return kind === 'sticky' || kind === 'text' || kind === 'shape' || kind === 'mind' || !kind
  }
  if (key === 'body' && kind === 'card') return true
  if (key === 'label' && kind === 'connector') return true
  return false
}

/**
 * Efficiently update a Y.Text with minimal character insertions/deletions.
 * Preserves concurrent edits from other peers at non-overlapping positions.
 */
export function updateYText(yText: Y.Text, newText: string): void {
  const oldText = yText.toString()
  if (oldText === newText) return

  let start = 0
  const oldLen = oldText.length
  const newLen = newText.length

  // Find common prefix
  while (start < oldLen && start < newLen && oldText[start] === newText[start]) {
    start++
  }

  // Find common suffix
  let endOld = oldLen
  let endNew = newLen
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--
    endNew--
  }

  const deleteCount = endOld - start
  const insertText = newText.slice(start, endNew)

  if (deleteCount > 0) {
    yText.delete(start, deleteCount)
  }
  if (insertText.length > 0) {
    yText.insert(start, insertText)
  }
}

/**
 * Convert a BoardObj to a Y.Map.
 * Text fields are converted to Y.Text instances.
 */
export function boardObjToYMap(obj: BoardObj, orderKey?: string): Y.Map<unknown> {
  const yMap = new Y.Map<unknown>()
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue
    if (isTextField(obj.kind, key) && typeof val === 'string') {
      const yText = new Y.Text(val)
      yMap.set(key, yText)
    } else {
      yMap.set(key, val)
    }
  }
  if (orderKey !== undefined) {
    yMap.set('order', orderKey)
  } else if (!yMap.has('order') && obj.order) {
    yMap.set('order', obj.order)
  }
  return yMap
}

/**
 * Convert a Y.Map representation back to a BoardObj.
 */
export function yMapToBoardObj(yMap: Y.Map<unknown>): BoardObj {
  const obj: Record<string, unknown> = {}
  for (const [key, val] of yMap.entries()) {
    if (val instanceof Y.Text) {
      obj[key] = val.toString()
    } else {
      obj[key] = val
    }
  }
  return obj as unknown as BoardObj
}

/**
 * Apply patches to a Y.Map representation of an object.
 */
export function patchYMap(yMap: Y.Map<unknown>, patch: Partial<BoardObj>): void {
  const kind = (yMap.get('kind') as string) || (patch.kind as string)
  for (const [key, val] of Object.entries(patch)) {
    if (val === undefined) {
      yMap.delete(key)
    } else if (isTextField(kind, key) && typeof val === 'string') {
      const existing = yMap.get(key)
      if (existing instanceof Y.Text) {
        updateYText(existing, val)
      } else {
        const yText = new Y.Text(val)
        yMap.set(key, yText)
      }
    } else {
      yMap.set(key, val)
    }
  }
}

/**
 * Initialize a Y.Doc from an existing BoardDoc.
 */
export function initYDocFromBoardDoc(ydoc: Y.Doc, doc: BoardDoc, origin: string = LOCAL_ORIGIN): void {
  ydoc.transact(() => {
    // 1. Meta
    const meta = ydoc.getMap('meta')
    meta.set('id', doc.id)
    meta.set('name', doc.name)
    meta.set('createdAt', doc.createdAt)
    meta.set('updatedAt', doc.updatedAt)
    if (doc.starred !== undefined) meta.set('starred', doc.starred)
    if (doc.background !== undefined) meta.set('background', doc.background)
    if (doc.thumbnail !== undefined) meta.set('thumbnail', doc.thumbnail)
    if (doc.viewport) meta.set('viewport', doc.viewport)
    if (doc.sharedBy) meta.set('sharedBy', doc.sharedBy)
    if (doc.activity) meta.set('activity', doc.activity)

    // 2. Notes
    const notes = ydoc.getText('notes')
    notes.delete(0, notes.length)
    if (doc.notes) {
      notes.insert(0, doc.notes)
    }

    // 3. Objects
    const yObjects = ydoc.getMap<Y.Map<unknown>>('objects')
    // Clear any existing
    for (const key of Array.from(yObjects.keys())) {
      yObjects.delete(key)
    }

    // Assign fractional indices along doc.order
    const orderIds = doc.order || []
    const orderKeys = generateInitialKeys(orderIds.length)
    const processedIds = new Set<ID>()

    orderIds.forEach((id, idx) => {
      const obj = doc.objects[id]
      if (!obj) return
      processedIds.add(id)
      const fractionalOrder = obj.order ?? orderKeys[idx]
      const yMap = boardObjToYMap(obj, fractionalOrder)
      yObjects.set(id, yMap)
    })

    // If there are objects in doc.objects not in doc.order, append them
    let lastKey = orderKeys[orderKeys.length - 1] ?? null
    for (const [id, obj] of Object.entries(doc.objects)) {
      if (processedIds.has(id)) continue
      lastKey = generateKeyAfter(lastKey)
      const yMap = boardObjToYMap(obj, obj.order ?? lastKey)
      yObjects.set(id, yMap)
    }
  }, origin)
}

/**
 * Convert the state of a Y.Doc into a complete BoardDoc.
 */
/** Everything but objects / order: board fields from the `meta` map and the notes text. */
export function boardMetaFromYDoc(ydoc: Y.Doc): Omit<BoardDoc, 'objects' | 'order'> {
  const meta = ydoc.getMap('meta')
  return {
    id: (meta.get('id') as string) || ydoc.guid,
    name: (meta.get('name') as string) || 'Untitled board',
    createdAt: (meta.get('createdAt') as number) || Date.now(),
    updatedAt: (meta.get('updatedAt') as number) || Date.now(),
    starred: meta.get('starred') as boolean | undefined,
    background: meta.get('background') as BoardDoc['background'],
    thumbnail: meta.get('thumbnail') as string | undefined,
    viewport: (meta.get('viewport') as Viewport) || { x: 0, y: 0, zoom: 1 },
    notes: ydoc.getText('notes').toString(),
    activity: meta.get('activity') as BoardDoc['activity'],
    sharedBy: meta.get('sharedBy') as BoardDoc['sharedBy'],
  }
}

export function boardDocFromYDoc(ydoc: Y.Doc): BoardDoc {
  const yObjects = ydoc.getMap<Y.Map<unknown>>('objects')
  const objects: Record<ID, BoardObj> = {}
  for (const [id, yMap] of yObjects.entries()) {
    if (yMap instanceof Y.Map) objects[id] = yMapToBoardObj(yMap)
  }
  // Order comes from the fractional index keys
  return { ...boardMetaFromYDoc(ydoc), objects, order: sortIdsByFractionalOrder(objects) }
}

/**
 * What a transaction touched: ids of objects added / removed / edited (a field, or text inside one),
 * whether z-order may have changed, and whether board meta or notes changed.
 */
export function transactionChanges(txn: Y.Transaction, ydoc: Y.Doc) {
  const yObjects: unknown = ydoc.getMap('objects')
  const yMeta: unknown = ydoc.getMap('meta')
  const yNotes: unknown = ydoc.getText('notes')
  const ids = new Set<ID>()
  let order = false
  let meta = false
  for (const [type, keys] of txn.changed) {
    if (type === yObjects) {
      for (const k of keys) if (k) ids.add(k)
      order = true
      continue
    }
    if (type === yMeta || type === yNotes) {
      meta = true
      continue
    }
    // A field of an object map, or a Y.Text inside one: walk up to the object's key in `objects`
    let t: Y.AbstractType<unknown> | null = type as Y.AbstractType<unknown>
    while (t && t._item) {
      const parent = t._item.parent as Y.AbstractType<unknown> | null
      if (parent === yObjects) {
        const id = t._item.parentSub
        if (id) ids.add(id)
        if (t === type && keys.has('order')) order = true
        break
      }
      t = parent
    }
  }
  return { ids, order, meta }
}

/**
 * Create a new Y.Doc, optionally initialized with a BoardDoc.
 */
export function createBoardYDoc(initialDoc?: BoardDoc): Y.Doc {
  const ydoc = new Y.Doc()
  if (initialDoc) {
    initYDocFromBoardDoc(ydoc, initialDoc, LOCAL_ORIGIN)
  }
  return ydoc
}

/**
 * Create a scoped Y.UndoManager that only tracks local transactions.
 * Transactions with remote origins will NOT be tracked or undone.
 */
export function createScopedUndoManager(
  ydoc: Y.Doc,
  localOrigin: string = LOCAL_ORIGIN,
): Y.UndoManager {
  const yObjects = ydoc.getMap('objects')
  const yNotes = ydoc.getText('notes')
  const yMeta = ydoc.getMap('meta')

  return new Y.UndoManager([yObjects, yNotes, yMeta], {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout: 60000, // Coalescing controlled manually via stopCapturing()
  })
}

/**
 * Apply a remote update to a Y.Doc with the specified remote origin.
 */
export function applyRemoteUpdate(
  ydoc: Y.Doc,
  update: Uint8Array,
  origin: string = REMOTE_ORIGIN,
): void {
  Y.applyUpdate(ydoc, update, origin)
}

/**
 * Encode current doc state as a binary Yjs update.
 */
export function encodeDocState(ydoc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc, stateVector)
}
