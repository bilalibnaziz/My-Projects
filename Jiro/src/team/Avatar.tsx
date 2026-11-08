import type { Person } from '@/board/types'
import { cn } from '@/lib/utils'
import { initials, isMe } from './team'

export function Avatar({ p, size = 24, ring = true, className }: { p: Person; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      title={p.name + (isMe(p) ? ' (you)' : '') + (p.email ? ` · ${p.email}` : '')}
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', ring && 'ring-2 ring-card', className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4), background: p.color }}
      data-avatar={p.name}
    >
      {initials(p.name)}
    </span>
  )
}

export function AvatarStack({ people, size = 22, max = 3 }: { people: Person[]; size?: number; max?: number }) {
  if (!people.length) return null
  return (
    <span className="inline-flex items-center">
      {people.slice(0, max).map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar p={p} size={size} />
        </span>
      ))}
      {people.length > max && <span className="ml-1 text-[11px] text-muted-foreground">+{people.length - max}</span>}
    </span>
  )
}
