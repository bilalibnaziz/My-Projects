import { CalendarClock, CheckCircle2, Circle, CircleDot, ListTodo, Plus, Send, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { makeCard } from '@/board/factory'
import { freeSpot } from '@/board/diagram'
import { listBoards, loadBoard } from '@/board/persist'
import { useBoard } from '@/board/store'
import type { BoardDoc, CardObj } from '@/board/types'
import { viewCenter } from '@/canvas/viewport'
import { cn } from '@/lib/utils'
import { useUi } from '@/ui/uiStore'
import { AvatarStack } from './Avatar'
import { assigneesOf, dueState, logActivity, setAssignees, setStatus, splitAssignee, type DueState } from './collab'
import { openAt } from './nav'
import { NotifyMenu } from './NotifyMenu'
import { everyone, isMe, toPerson } from './team'

export const DUE_STYLE: Record<DueState, string> = {
  overdue: 'bg-red-500/15 text-red-600 dark:text-red-400',
  today: 'bg-amber-400/25 text-amber-700 dark:text-amber-300',
  soon: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  later: 'bg-muted text-muted-foreground',
  none: 'bg-muted text-muted-foreground',
}

export function DueBadge({ c }: { c: CardObj }) {
  if (!c.due) return null
  const ds = dueState(c)
  const d = new Date(c.due + 'T00:00')
  const label = ds === 'today' ? 'Today' : ds === 'overdue' ? `Overdue · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium', DUE_STYLE[ds])} data-due={ds}><CalendarClock className="size-3" />{label}</span>
}

const StatusIcon = ({ s }: { s?: CardObj['status'] }) => (s === 'done' ? <CheckCircle2 className="size-4 text-green-600" /> : s === 'doing' ? <CircleDot className="size-4 text-amber-500" /> : <Circle className="size-4 text-muted-foreground" />)
const next = (s?: CardObj['status']) => (s === 'todo' || !s ? 'doing' : s === 'doing' ? 'done' : 'todo')

interface Row { c: CardObj; board: { id: string; name: string } }

export function TasksPanel() {
  const open = useUi((s) => s.tasksPanel)
  return open ? <Tasks /> : null
}

function Tasks() {
  const doc = useBoard((s) => s.doc)!
  const cards = useBoard(useShallow((s) => s.doc!.order.map((id) => s.doc!.objects[id]).filter((o): o is CardObj => o?.kind === 'card')))
  const [scope, setScope] = useState<'board' | 'all'>('board')
  const [who, setWho] = useState<'all' | 'me'>('all')
  const [showDone, setShowDone] = useState(false)
  const [others, setOthers] = useState<Row[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (scope !== 'all') return
    let live = true
    void (async () => {
      const rows: Row[] = []
      for (const m of await listBoards()) {
        if (m.id === doc.id) continue
        const d: BoardDoc | undefined = await loadBoard(m.id)
        if (d) for (const id of d.order) { const o = d.objects[id]; if (o?.kind === 'card') rows.push({ c: o, board: { id: d.id, name: d.name } }) }
      }
      if (live) setOthers(rows)
    })()
    return () => { live = false }
  }, [scope, doc.id])

  const rows = useMemo(() => {
    const here: Row[] = cards.map((c) => ({ c, board: { id: doc.id, name: doc.name } }))
    const all = scope === 'all' ? [...here, ...others] : here
    const order: Record<DueState, number> = { overdue: 0, today: 1, soon: 2, later: 3, none: 4 }
    return all
      .filter((r) => showDone || r.c.status !== 'done')
      .filter((r) => who === 'all' || assigneesOf(r.c).some(isMe))
      .sort((a, b) => (a.c.status === 'done' ? 1 : 0) - (b.c.status === 'done' ? 1 : 0) || order[dueState(a.c)] - order[dueState(b.c)] || (a.c.due ?? '9').localeCompare(b.c.due ?? '9'))
  }, [cards, others, scope, who, showDone, doc.id, doc.name])

  const counts = { overdue: rows.filter((r) => dueState(r.c) === 'overdue').length, mine: (scope === 'all' ? [...cards, ...others.map((o) => o.c)] : cards).filter((c) => c.status !== 'done' && assigneesOf(c).some(isMe)).length }

  const addTask = () => {
    const t = draft.trim()
    if (!t) return
    const people = everyone().map(toPerson)
    const { title, who: ppl } = splitAssignee(t, people)
    const s = useBoard.getState()
    const at = freeSpot(280, 132, viewCenter(), s.doc!.objects, s.doc!.order)
    const card = makeCard(at.x, at.y, title || t)
    s.add(card, { select: false })
    logActivity(`added task “${card.title}”`, card.id)
    if (ppl.length) setAssignees(card.id, ppl)
    setDraft('')
  }

  return (
    <div className="jiro-float absolute top-[72px] bottom-3 left-[66px] z-20 flex w-80 flex-col" data-ui data-tasks-panel>
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <ListTodo className="size-4" />
        <span className="text-sm font-semibold">Tasks</span>
        {counts.overdue > 0 && <span className="rounded-full bg-red-500/15 px-1.5 text-[11px] font-semibold text-red-600">{counts.overdue} overdue</span>}
        <button aria-label="Close tasks" className="ml-auto grid size-7 place-items-center rounded-md hover:bg-accent" onClick={() => useUi.getState().set({ tasksPanel: false })}><X className="size-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-xs">
        {(['board', 'all'] as const).map((k) => (
          <button key={k} onClick={() => setScope(k)} className={cn('rounded-md px-2 py-1', scope === k ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-accent')}>{k === 'board' ? 'This board' : 'All boards'}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => setWho(who === 'me' ? 'all' : 'me')} className={cn('rounded-md px-2 py-1', who === 'me' ? 'bg-[#4262ff] font-semibold text-white' : 'hover:bg-accent')} data-filter-mine>Mine{counts.mine ? ` · ${counts.mine}` : ''}</button>
        <button onClick={() => setShowDone(!showDone)} className={cn('rounded-md px-2 py-1', showDone ? 'bg-accent font-semibold' : 'hover:bg-accent')}>Done</button>
      </div>
      <form className="flex gap-1.5 border-b p-2" onSubmit={(e) => { e.preventDefault(); addTask() }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addTask() } }} placeholder="Add a task… (@name assigns)" aria-label="New task" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" data-new-task />
        <button aria-label="Add task" className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><Plus className="size-4" /></button>
      </form>
      <div className="flex-1 overflow-y-auto p-1.5" data-scrollable>
        {!rows.length && <p className="p-4 text-center text-sm text-muted-foreground">{who === 'me' ? 'Nothing assigned to you. 🎉' : 'No tasks yet. Add one above, press K on the board, or turn note checklists into cards.'}</p>}
        {rows.map(({ c, board }) => {
          const ppl = assigneesOf(c)
          const local = board.id === doc.id
          return (
            <div key={board.id + c.id} className="group flex items-start gap-2 rounded-lg p-2 hover:bg-accent/60" data-task={c.title}>
              <button aria-label={`Status: ${c.status ?? 'todo'}`} className="mt-0.5" disabled={!local} onClick={() => setStatus(c.id, next(c.status))}><StatusIcon s={c.status} /></button>
              <button className="min-w-0 flex-1 text-left" onClick={() => void openAt(board.id, c.id)}>
                <div className={cn('truncate text-sm font-medium', c.status === 'done' && 'text-muted-foreground line-through')}>{c.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <DueBadge c={c} />
                  {c.priority === 'high' && <span className="rounded-full bg-red-500/10 px-1.5 text-[11px] font-medium text-red-600">High</span>}
                  {scope === 'all' && <span className="truncate text-[11px] text-muted-foreground">{board.name}</span>}
                </div>
              </button>
              <AvatarStack people={ppl} size={22} />
              {local && (
                <NotifyMenu doc={doc} card={c} people={ppl}>
                  <button aria-label={`Notify about ${c.title}`} className="grid size-6 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-background data-[state=open]:opacity-100"><Send className="size-3.5" /></button>
                </NotifyMenu>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
