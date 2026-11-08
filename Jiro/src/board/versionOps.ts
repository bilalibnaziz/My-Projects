// Version history actions on the open board (UI-free, so the panel, palette and e2e share them).
import { deleteVersion, listVersions, putVersion } from './persist'
import { useBoard } from './store'
import type { BoardDoc } from './types'
import { makeVersion, pruneAuto, shouldAutoSnapshot, signature, type BoardVersion } from './versions'

const changed = () => window.dispatchEvent(new CustomEvent('jiro:versions'))

/** Subscribe to version list changes (returns an unsubscribe) */
export function onVersionsChanged(fn: () => void): () => void {
  window.addEventListener('jiro:versions', fn)
  return () => window.removeEventListener('jiro:versions', fn)
}

let busy: Promise<unknown> = Promise.resolve()
/** Version writes run one at a time, so two quick saves can't both decide to snapshot */
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const p = busy.then(fn, fn)
  busy = p.catch(() => undefined)
  return p
}

/** Takes an auto version if the board changed since the newest one and that is old enough (or forced). */
export function autoVersion(doc: BoardDoc, reason?: string, force = false): Promise<BoardVersion | null> {
  return serial(async () => {
    if (!doc.order.length && !force) return null
    const list = await listVersions(doc.id)
    const sig = signature(doc.objects, doc.order)
    if (force ? list[0]?.sig === sig : !shouldAutoSnapshot(list[0], sig, Date.now())) return null
    const v = makeVersion(doc, { reason })
    await putVersion(v)
    for (const id of pruneAuto([v, ...list])) await deleteVersion(id)
    changed()
    return v
  })
}

/** Saves the current board as a named version. */
export function saveNamedVersion(name: string): Promise<BoardVersion | null> {
  const doc = useBoard.getState().doc
  if (!doc) return Promise.resolve(null)
  return serial(async () => {
    const v = makeVersion(doc, { name: name.trim() || `Version ${new Date().toLocaleString()}` })
    await putVersion(v)
    changed()
    return v
  })
}

/** Restores a version: the current state is kept as a version first, then the board content is swapped (undoable). */
export async function restoreVersion(v: BoardVersion): Promise<boolean> {
  const doc = useBoard.getState().doc
  if (!doc || doc.id !== v.boardId) return false
  await autoVersion(doc, 'Before restore', true)
  useBoard.getState().replaceContent(v.objects, v.order)
  return true
}

export async function renameVersion(v: BoardVersion, name: string) {
  const n = name.trim()
  await serial(() => putVersion({ ...v, name: n || undefined, auto: !n }))
  changed()
}

export async function removeVersion(id: string) {
  await serial(() => deleteVersion(id))
  changed()
}
