import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import * as Y from 'yjs'
import { boardDocFromYDoc, createBoardYDoc } from './crdt'
import { thumbnailSvg } from './thumbnail'
import type { BoardDoc, BoardMeta } from './types'
import type { BoardVersion } from './versions'

// Boards live in IndexedDB.
// 1. y-indexeddb store 'jiro-crdt-<boardId>' for collaborative CRDT updates.
// 2. legacy 'boards' store for backward compatibility and export.
// 3. 'meta' store for fast home screen listings.
// 4. 'versions' store for version snapshots.
const DB = 'jiro'
const VERSION = 2 // 2: version history
let dbp: Promise<IDBDatabase> | null = null

export const crdtDbName = (id: string) => `jiro-crdt-${id}`

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') {
      return rej(new Error('IndexedDB not available'))
    }
    const r = indexedDB.open(DB, VERSION)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('versions')) d.createObjectStore('versions', { keyPath: 'id' }).createIndex('boardId', 'boardId')
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return dbp
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const t = d.transaction(store, mode)
        const req = fn(t.objectStore(store))
        t.oncomplete = () => res(req ? (req.result as T) : (undefined as T))
        t.onerror = () => rej(t.error)
        t.onabort = () => rej(t.error)
      }),
  )
}

export function metaOf(doc: BoardDoc): BoardMeta {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    starred: doc.starred,
    thumbnail: thumbnailSvg(doc),
    count: doc.order.length,
    sharedBy: doc.sharedBy?.name,
  }
}

/**
 * Connect a Y.Doc to y-indexeddb for local CRDT persistence.
 */
export function connectCrdtPersistence(id: string, ydoc: Y.Doc): IndexeddbPersistence | null {
  if (typeof indexedDB === 'undefined') return null
  return new IndexeddbPersistence(crdtDbName(id), ydoc)
}

/**
 * Save board document, persisting both metadata and legacy document format,
 * alongside active y-indexeddb storage.
 */
export async function saveBoard(doc: BoardDoc, ydoc?: Y.Doc) {
  try {
    await tx('boards', 'readwrite', (s) => s.put(doc))
    await tx('meta', 'readwrite', (s) => s.put(metaOf(doc)))
  } catch (e) {
    // If indexedDB transactions fail, still attempt CRDT store if possible
    console.warn('saveBoard meta/boards store warning:', e)
  }

  // If ydoc provided and not yet saved via active persistence, persist update
  if (ydoc && typeof indexedDB !== 'undefined') {
    const provider = new IndexeddbPersistence(crdtDbName(doc.id), ydoc)
    await provider.whenSynced
  }
}

const crdtUpdatedAt = (y: Y.Doc) => (y.getMap('meta').get('updatedAt') as number) || 0
const hasCrdtContent = (y: Y.Doc) => y.getMap('objects').size > 0 || y.getMap('meta').size > 0

/**
 * Load a board. Two copies are kept: the JSON document (`boards`, written by autosave) and the CRDT
 * (y-indexeddb, written on every change while the board is open). The newer one wins.
 */
export async function loadBoard(id: string): Promise<BoardDoc | undefined> {
  let legacy: BoardDoc | undefined
  try {
    legacy = await tx<BoardDoc | undefined>('boards', 'readonly', (s) => s.get(id))
  } catch {
    legacy = undefined
  }
  if (typeof indexedDB === 'undefined') return legacy
  try {
    const ydoc = new Y.Doc()
    const provider = new IndexeddbPersistence(crdtDbName(id), ydoc)
    await provider.whenSynced
    const useCrdt = hasCrdtContent(ydoc) && (!legacy || crdtUpdatedAt(ydoc) >= legacy.updatedAt)
    const doc = useCrdt ? boardDocFromYDoc(ydoc) : undefined
    await provider.destroy()
    if (doc) return legacy ? { ...legacy, ...doc } : doc
  } catch (e) {
    console.warn('loadBoard y-indexeddb check failed:', e)
  }
  return legacy
}

/**
 * The CRDT document for an opened board, connected to y-indexeddb so every change is saved as it happens.
 * A stored CRDT older than `doc` (e.g. renamed from the home screen, or written before this format) is
 * rebuilt from `doc`, never merged with it: merging two independently created documents would duplicate text.
 */
export async function openBoardCrdt(
  doc: BoardDoc,
  opts: { keepStored?: boolean } = {},
): Promise<{ ydoc: Y.Doc; provider: IndexeddbPersistence | null }> {
  if (typeof indexedDB === 'undefined') return { ydoc: createBoardYDoc(doc), provider: null }
  const name = crdtDbName(doc.id)
  const stored = new Y.Doc()
  const provider = new IndexeddbPersistence(name, stored)
  await provider.whenSynced
  // A live board's CRDT is shared with other people: rebuilding it would create a second, unrelated
  // document that duplicates everything when it syncs. Always keep it.
  if (hasCrdtContent(stored) && (opts.keepStored || crdtUpdatedAt(stored) >= doc.updatedAt)) return { ydoc: stored, provider }
  await provider.destroy()
  await clearDocument(name)
  const fresh = createBoardYDoc(doc)
  const p2 = new IndexeddbPersistence(name, fresh)
  await p2.whenSynced
  return { ydoc: fresh, provider: p2 }
}

export async function listBoards(): Promise<BoardMeta[]> {
  try {
    const all = await tx<BoardMeta[]>('meta', 'readonly', (s) => s.getAll())
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function deleteBoard(id: string) {
  try {
    await tx('boards', 'readwrite', (s) => s.delete(id))
    await tx('meta', 'readwrite', (s) => s.delete(id))
    for (const v of await listVersions(id)) await deleteVersion(v.id)
  } catch (e) {
    console.warn('deleteBoard error:', e)
  }
  if (typeof indexedDB !== 'undefined') {
    try {
      await clearDocument(crdtDbName(id))
    } catch {
      // ignore
    }
  }
}

// ---- version history ----

/** Versions of a board, newest first */
export async function listVersions(boardId: string): Promise<BoardVersion[]> {
  try {
    const all = await tx<BoardVersion[]>('versions', 'readonly', (s) => s.index('boardId').getAll(boardId))
    return all.sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

export const putVersion = (v: BoardVersion) => tx('versions', 'readwrite', (s) => s.put(v))
export const deleteVersion = (id: string) => tx('versions', 'readwrite', (s) => s.delete(id))

export async function patchMeta(id: string, patch: Partial<Pick<BoardDoc, 'name' | 'starred'>>) {
  const doc = await loadBoard(id)
  if (!doc) return
  // Newer than the stored CRDT, so the next open rebuilds it with the new name / star
  Object.assign(doc, patch, { updatedAt: Date.now() })
  await saveBoard(doc)
}
