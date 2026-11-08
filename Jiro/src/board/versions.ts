// Version history: snapshots of a board's content (objects + order) in IndexedDB.
// - Auto versions: when a board is opened, and then at most every 10 minutes while it changes.
// - Named versions: saved on purpose ("Before the client review"); never pruned automatically.
// Restoring is one undo step on the board, and the current state is saved as a version first.
import { uid } from './geometry'
import { thumbnailSvg } from './thumbnail'
import type { BoardDoc, BoardObj, ID } from './types'

export interface BoardVersion {
  id: string
  boardId: string
  at: number
  /** Set for named versions */
  name?: string
  auto: boolean
  /** Why an auto version was taken ("Opened", "Before restore"…) */
  reason?: string
  objects: Record<ID, BoardObj>
  order: ID[]
  count: number
  thumbnail?: string
  /** Content fingerprint: equal signatures = same board content */
  sig: string
}

export const AUTO_GAP_MS = 10 * 60_000
export const MAX_AUTO = 30

/** FNV-1a over a string, as 8 hex digits */
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Fingerprint of a board's content. Image data is represented by its length, so this stays fast. */
export function signature(objects: Record<ID, BoardObj>, order: ID[]): string {
  let h = fnv(order.join(','))
  for (const id of order) {
    const o = objects[id]
    if (!o) continue
    const json = JSON.stringify(o, (k, v) => (k === 'src' && typeof v === 'string' && v.length > 256 ? `#${v.length}:${fnv(v.slice(0, 4096))}` : v))
    h = fnv(json, h)
  }
  return `${order.length}:${h.toString(16)}`
}

export function makeVersion(doc: Pick<BoardDoc, 'id' | 'objects' | 'order'> & Partial<BoardDoc>, opts: { name?: string; reason?: string; at?: number } = {}): BoardVersion {
  const name = opts.name?.trim() || undefined
  return {
    id: uid(),
    boardId: doc.id,
    at: opts.at ?? Date.now(),
    name,
    auto: !name,
    reason: opts.reason,
    objects: doc.objects,
    order: doc.order,
    count: doc.order.length,
    thumbnail: thumbnailSvg({ name: '', createdAt: 0, updatedAt: 0, viewport: { x: 0, y: 0, zoom: 1 }, ...doc } as BoardDoc),
    sig: signature(doc.objects, doc.order),
  }
}

/** Auto-snapshot when the content differs from the newest version and that one is old enough. */
export function shouldAutoSnapshot(latest: BoardVersion | undefined, sig: string, now: number, gap = AUTO_GAP_MS): boolean {
  if (!latest) return true
  if (latest.sig === sig) return false
  return now - latest.at >= gap
}

/** Auto versions beyond the newest `max` (named ones are always kept). Returns ids to delete. */
export function pruneAuto(versions: BoardVersion[], max = MAX_AUTO): string[] {
  return versions
    .filter((v) => v.auto)
    .sort((a, b) => b.at - a.at)
    .slice(max)
    .map((v) => v.id)
}

export interface VersionDiff {
  added: number
  removed: number
  changed: number
}

/** What going from `from` to `to` would do, object by object. */
export function diffSummary(from: Record<ID, BoardObj>, to: Record<ID, BoardObj>): VersionDiff {
  let added = 0
  let removed = 0
  let changed = 0
  for (const id in to) {
    if (!(id in from)) added++
    else if (from[id] !== to[id] && JSON.stringify(from[id]) !== JSON.stringify(to[id])) changed++
  }
  for (const id in from) if (!(id in to)) removed++
  return { added, removed, changed }
}

/** "just now", "5 min ago", "3 h ago", or a date */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
