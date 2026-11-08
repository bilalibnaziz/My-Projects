import { Check, Send, UserPlus } from 'lucide-react'
import { useBoard } from '@/board/store'
import type { CardObj, Person } from '@/board/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ToolButton } from '@/ui/ToolButton'
import { useUi } from '@/ui/uiStore'
import { Avatar, AvatarStack } from './Avatar'
import { assigneesOf, setAssignees } from './collab'
import { NotifyMenu } from './NotifyMenu'
import { toPerson, useTeam } from './team'

/** Card toolbar: who's on it, due date, priority, and a quick notify */
export function AssignPicker({ card }: { card: CardObj }) {
  const me = useTeam((s) => s.me)
  const members = useTeam((s) => s.members)
  const doc = useBoard((s) => s.doc)!
  const current = assigneesOf(card)
  const all = [me, ...members]
  // People on the card who aren't in my roster (e.g. from a shared board) still show and can be removed
  const strangers = current.filter((p) => !all.some((m) => m.id === p.id))
  const toggle = (p: Person) => {
    const on = current.some((x) => x.id === p.id)
    setAssignees(card.id, on ? current.filter((x) => x.id !== p.id) : [...current.filter((x) => !x.id.startsWith('legacy:')), p])
  }
  const set = (patch: Partial<CardObj>) => useBoard.getState().update(card.id, patch)
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Assign" side="top" className="h-9 w-auto gap-1 px-1.5" data-assign>
            {current.length ? <AvatarStack people={current} size={22} /> : <UserPlus />}
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent side="top" sideOffset={10} className="w-72 p-2" data-ui data-keep-editing data-assign-menu onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="px-1.5 pb-1.5 text-xs font-medium text-muted-foreground">Assign to</div>
          {[...all.map(toPerson), ...strangers].map((p) => {
            const on = current.some((x) => x.id === p.id)
            return (
              <button key={p.id} onClick={() => toggle(p)} className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent', on && 'bg-accent')} data-assign-person={p.name}>
                <Avatar p={p} size={24} ring={false} />
                <span className="min-w-0 flex-1 truncate text-left">{p.name}{p.id === me.id && <span className="text-muted-foreground"> (you)</span>}</span>
                {on && <Check className="size-4 text-[#4262ff]" />}
              </button>
            )
          })}
          <button onClick={() => useUi.getState().set({ teamOpen: true })} className="mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-muted-foreground hover:bg-accent">
            <UserPlus className="size-4" /> Manage team…
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2 border-t px-1 pt-2">
            <label className="text-xs text-muted-foreground">
              Due
              <input type="date" className="mt-1 h-8 w-full rounded-md border bg-background px-1.5 text-sm text-foreground" value={card.due ?? ''} onChange={(e) => set({ due: e.target.value || undefined })} data-due-input />
            </label>
            <label className="text-xs text-muted-foreground">
              Priority
              <select className="mt-1 h-8 w-full rounded-md border bg-background px-1.5 text-sm text-foreground" value={card.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || undefined) as CardObj['priority'] })}>
                <option value="">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
        </PopoverContent>
      </Popover>
      <NotifyMenu doc={doc} card={card} people={current}>
        <ToolButton label="Notify assignees" side="top" className="size-9" disabled={!current.length}>
          <Send />
        </ToolButton>
      </NotifyMenu>
    </>
  )
}
