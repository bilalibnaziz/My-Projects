import { create } from 'zustand'
import { uid } from '@/board/geometry'
import type { Person } from '@/board/types'

export const MEMBER_COLORS = ['#4262ff', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#0090ff', '#ad7f58', '#6b7280']

export interface Member extends Person {
  role?: string
}

interface TeamState {
  me: Member
  members: Member[]
  setMe(p: Partial<Member>): void
  upsert(m: Omit<Member, 'id' | 'color'> & { id?: string; color?: string }): Member
  remove(id: string): void
}

const KEY = 'jiro.team'

function load(): { me: Member; members: Member[] } {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (j?.me?.id) return { me: j.me, members: Array.isArray(j.members) ? j.members : [] }
  } catch { /* fresh */ }
  return { me: { id: uid(), name: 'You', color: MEMBER_COLORS[0] }, members: [] }
}

function save(s: { me: Member; members: Member[] }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ me: s.me, members: s.members }))
  } catch { /* storage blocked */ }
}

export const useTeam = create<TeamState>()((set, get) => ({
  ...load(),
  setMe(p) {
    const me = { ...get().me, ...p }
    set({ me })
    save({ me, members: get().members })
  },
  upsert(m) {
    const members = [...get().members]
    const i = m.id ? members.findIndex((x) => x.id === m.id) : -1
    const next: Member = {
      id: m.id ?? uid(),
      name: m.name.trim() || 'Teammate',
      email: m.email?.trim() || undefined,
      phone: m.phone?.replace(/[^\d+]/g, '') || undefined,
      role: m.role?.trim() || undefined,
      color: m.color ?? MEMBER_COLORS[(members.length + 1) % MEMBER_COLORS.length],
    }
    if (i >= 0) members[i] = next
    else members.push(next)
    set({ members })
    save({ me: get().me, members })
    return next
  },
  remove(id) {
    const members = get().members.filter((m) => m.id !== id)
    set({ members })
    save({ me: get().me, members })
  },
}))

/** Everyone you can assign to: you first, then the roster */
export const everyone = (): Member[] => {
  const { me, members } = useTeam.getState()
  return [me, ...members]
}

export const toPerson = (m: Member): Person => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, color: m.color })

/** Is this person me? Matches by id, then email, then name (boards from teammates carry their ids) */
export function isMe(p: Person | undefined | null): boolean {
  if (!p) return false
  const me = useTeam.getState().me
  if (p.id === me.id) return true
  if (p.email && me.email && p.email.toLowerCase() === me.email.toLowerCase()) return true
  return !p.email && !!me.name && me.name !== 'You' && p.name.trim().toLowerCase() === me.name.trim().toLowerCase()
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

/** Find a roster member matching a person carried on a board */
export function findMember(p: Person): Member | undefined {
  const all = everyone()
  return all.find((m) => m.id === p.id) ?? (p.email ? all.find((m) => m.email?.toLowerCase() === p.email!.toLowerCase()) : undefined) ?? all.find((m) => m.name.toLowerCase() === p.name.toLowerCase())
}
