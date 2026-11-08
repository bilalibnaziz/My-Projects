import { create } from 'zustand'
import { uid } from '@/board/geometry'
import { isTauri } from '@/lib/files'

export type NoteKind = 'assigned' | 'mention' | 'due' | 'overdue' | 'shared' | 'comment' | 'done'

export interface JiroNotification {
  id: string
  at: number
  kind: NoteKind
  title: string
  body?: string
  boardId?: string
  boardName?: string
  objectId?: string
  read?: boolean
}

interface NotesState {
  items: JiroNotification[]
  push(n: Omit<JiroNotification, 'id' | 'at'> & { key?: string }, opts?: { os?: boolean }): JiroNotification | null
  markRead(id?: string): void
  clear(): void
}

const KEY = 'jiro.notifications'
const SEEN = 'jiro.notified.keys'

const load = (): JiroNotification[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const persist = (items: JiroNotification[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)))
  } catch { /* blocked */ }
}

/** Keys of things already notified (so a due reminder or a shared assignment fires once) */
function seen(key: string): boolean {
  try {
    const set: string[] = JSON.parse(localStorage.getItem(SEEN) ?? '[]')
    if (set.includes(key)) return true
    set.push(key)
    localStorage.setItem(SEEN, JSON.stringify(set.slice(-2000)))
  } catch { /* blocked: may repeat */ }
  return false
}

export const useNotifications = create<NotesState>()((set, get) => ({
  items: load(),
  push(n, opts = {}) {
    if (n.key && seen(n.key)) return null
    const item: JiroNotification = { id: uid(), at: Date.now(), kind: n.kind, title: n.title, body: n.body, boardId: n.boardId, boardName: n.boardName, objectId: n.objectId }
    const items = [item, ...get().items].slice(0, 200)
    set({ items })
    persist(items)
    if (opts.os !== false) void osNotify(item.title, item.body)
    return item
  },
  markRead(id) {
    const items = get().items.map((x) => (!id || x.id === id ? { ...x, read: true } : x))
    set({ items })
    persist(items)
  },
  clear() {
    set({ items: [] })
    persist([])
  },
}))

/** Native notification (Jiro's os_notify command on desktop, Web Notifications in a browser); silent if not allowed */
export async function osNotify(title: string, body?: string) {
  try {
    if (isTauri()) {
      // Native notification through Jiro's own command (no plugin script in other windows)
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('os_notify', { title, body: body ?? null })
      return
    }
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission === 'granted') new Notification(title, { body })
  } catch { /* not available */ }
}
