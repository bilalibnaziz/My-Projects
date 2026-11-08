import { CloudOff, Eye, Loader2, Radio, Users } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Avatar } from '@/team/Avatar'
import { cn } from '@/lib/utils'
import { follow, summonEveryone, useLive } from './live'

/** Live-session status, the people here (click to follow), and "Bring everyone to me". */
export function LiveBar() {
  const { status, pending, peers, following, readOnly } = useLive(
    useShallow((s) => ({ status: s.status, pending: s.pending, peers: s.peers, following: s.following, readOnly: s.readOnly })),
  )
  if (status === 'off') return null
  const label =
    status === 'synced' ? 'Synced'
    : status === 'connecting' ? 'Connecting…'
    : status === 'denied' ? 'No access'
    : pending ? `Offline — ${pending} change${pending === 1 ? '' : 's'} waiting`
    : 'Offline'
  return (
    <div className="flex items-center gap-1.5" data-live-bar data-live-status={status} data-live-pending={pending}>
      <span
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
          status === 'synced' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' : status === 'connecting' ? 'bg-muted text-muted-foreground' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        )}
        title="Live session"
      >
        {status === 'synced' ? <Radio className="size-3.5" /> : status === 'connecting' ? <Loader2 className="size-3.5 animate-spin" /> : <CloudOff className="size-3.5" />}
        <span data-live-label>{label}</span>
      </span>
      {readOnly && (
        <span className="flex h-7 items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground" data-live-readonly>
          <Eye className="size-3.5" /> View only
        </span>
      )}
      {peers.length > 0 && (
        <span className="flex items-center">
          {peers.slice(0, 6).map((p, i) => (
            <button
              key={p.clientId}
              onClick={() => follow(following === p.clientId ? null : p.clientId)}
              title={following === p.clientId ? `Stop following ${p.user.name}` : `Follow ${p.user.name}`}
              aria-label={following === p.clientId ? `Stop following ${p.user.name}` : `Follow ${p.user.name}`}
              data-follow={p.user.name}
              data-following={following === p.clientId || undefined}
              className={cn('rounded-full', i && '-ml-1.5', following === p.clientId && 'ring-2 ring-offset-1 ring-[#4262ff]')}
            >
              <Avatar p={{ id: p.user.id, name: p.user.name, color: p.user.color }} size={26} />
            </button>
          ))}
          {peers.length > 6 && <span className="ml-1 text-[11px] text-muted-foreground">+{peers.length - 6}</span>}
        </span>
      )}
      {peers.length > 0 && !readOnly && (
        <button
          onClick={summonEveryone}
          className="flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Bring everyone to what you're looking at"
          data-action="summon"
        >
          <Users className="size-3.5" /> Bring everyone
        </button>
      )}
    </div>
  )
}
