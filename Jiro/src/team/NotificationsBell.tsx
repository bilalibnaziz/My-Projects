import { AtSign, Bell, CalendarClock, CheckCheck, History, Share2, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { useBoard } from '@/board/store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ToolButton } from '@/ui/ToolButton'
import { openAt } from './nav'
import { useNotifications, type NoteKind } from './notifications'

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const ICON: Record<NoteKind, React.ReactNode> = {
  assigned: <UserCheck className="size-4 text-[#4262ff]" />,
  mention: <AtSign className="size-4 text-[#8e4ec6]" />,
  due: <CalendarClock className="size-4 text-amber-500" />,
  overdue: <CalendarClock className="size-4 text-red-500" />,
  shared: <Share2 className="size-4 text-green-600" />,
  comment: <AtSign className="size-4 text-[#8e4ec6]" />,
  done: <CheckCheck className="size-4 text-green-600" />,
}

export function NotificationsBell({ side = 'bottom' }: { side?: 'bottom' | 'top' }) {
  const items = useNotifications((s) => s.items)
  const unread = items.filter((n) => !n.read).length
  const activity = useBoard((s) => s.doc?.activity)
  const hasBoard = useBoard((s) => !!s.doc)
  const [tab, setTab] = useState<'inbox' | 'activity'>('inbox')
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolButton label="Notifications" side={side} className="size-9" data-action="notifications">
          <Bell />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-card" data-unread={unread}>{unread > 99 ? '99+' : unread}</span>}
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" data-ui data-notifications>
        <div className="flex items-center gap-1 border-b px-3 py-2">
          {(['inbox', 'activity'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} disabled={k === 'activity' && !hasBoard} className={cn('rounded-md px-2 py-1 text-sm disabled:opacity-40', tab === k ? 'bg-accent font-semibold' : 'text-muted-foreground hover:text-foreground')}>
              {k === 'inbox' ? `Inbox${unread ? ` · ${unread}` : ''}` : 'Board activity'}
            </button>
          ))}
          {tab === 'inbox' && unread > 0 && (
            <button className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => useNotifications.getState().markRead()}><CheckCheck className="size-3.5" /> Mark all read</button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto" data-scrollable>
          {tab === 'inbox' ? (
            items.length ? items.map((n) => (
              <button
                key={n.id}
                className={cn('flex w-full gap-3 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent/60', !n.read && 'bg-[#4262ff]/5')}
                onClick={() => {
                  useNotifications.getState().markRead(n.id)
                  setOpen(false)
                  void openAt(n.boardId, n.objectId)
                }}
                data-notification={n.kind}
              >
                <span className="mt-0.5">{ICON[n.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm', !n.read && 'font-semibold')}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                  {n.boardName && <span className="block truncate text-[11px] text-muted-foreground">{n.boardName}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{ago(n.at)}</span>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#4262ff]" />}
              </button>
            )) : <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up. Assignments, @mentions, due dates and shared boards show up here.</p>
          ) : activity?.length ? (
            [...activity].reverse().map((a) => (
              <button key={a.id} className="flex w-full gap-3 border-b px-3 py-2 text-left last:border-0 hover:bg-accent/60" onClick={() => { setOpen(false); void openAt(undefined, a.objectId) }} data-activity>
                <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-sm"><span className="font-semibold">{a.who}</span> {a.text}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{ago(a.at)}</span>
              </button>
            ))
          ) : <p className="p-6 text-center text-sm text-muted-foreground">No activity on this board yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
