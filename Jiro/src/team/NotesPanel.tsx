import { ListChecks, NotebookPen, X } from 'lucide-react'
import { makeCard } from '@/board/factory'
import { freeSpot } from '@/board/diagram'
import { useBoard } from '@/board/store'
import type { BoardObj } from '@/board/types'
import { viewCenter, zoomToRect } from '@/canvas/viewport'
import { boundsOf } from '@/board/store'
import { useUi } from '@/ui/uiStore'
import { logActivity, openChecklist, setAssignees, splitAssignee } from './collab'
import { everyone, toPerson } from './team'

/** Turn every open "- [ ] …" line into a task card (with @name assignees) and tick it off */
export function notesToCards(): number {
  const s = useBoard.getState()
  const doc = s.doc
  if (!doc) return 0
  const items = openChecklist(doc.notes ?? '')
  if (!items.length) return 0
  const people = everyone().map(toPerson)
  const cols = Math.min(4, items.length)
  const W = cols * 300, H = Math.ceil(items.length / cols) * 152
  const at = freeSpot(W, H, viewCenter(), doc.objects, doc.order)
  const cards = items.map((line, i) => {
    const { title } = splitAssignee(line, people)
    return makeCard(at.x + (i % cols) * 300, at.y + Math.floor(i / cols) * 152, title || line)
  })
  s.add(cards as BoardObj[])
  cards.forEach((c, i) => {
    const { who } = splitAssignee(items[i], people)
    if (who.length) setAssignees(c.id, who)
  })
  const notes = (useBoard.getState().doc!.notes ?? '').replace(/^(\s*[-*]\s+)\[ \](\s+)/gm, '$1[x]$2')
  useBoard.getState().setNotes(notes)
  logActivity(`turned ${cards.length} note item${cards.length > 1 ? 's' : ''} into tasks`)
  const b = boundsOf(cards.map((c) => c.id), useBoard.getState().doc!.objects)
  if (b) zoomToRect(b, { maxZoom: 1 })
  return cards.length
}

export function NotesPanel() {
  const open = useUi((s) => s.notesPanel)
  const notes = useBoard((s) => s.doc?.notes ?? '')
  if (!open) return null
  const openItems = openChecklist(notes).length
  return (
    <div className="jiro-float absolute top-[72px] bottom-3 left-[66px] z-20 flex w-80 flex-col" data-ui data-notes-panel>
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <NotebookPen className="size-4" />
        <span className="text-sm font-semibold">Notes</span>
        <button aria-label="Close notes" className="ml-auto grid size-7 place-items-center rounded-md hover:bg-accent" onClick={() => useUi.getState().set({ notesPanel: false })}><X className="size-4" /></button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => {
          const s = useBoard.getState()
          if (s.doc) s.setNotes(e.target.value)
        }}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder={'Meeting notes, decisions, next steps…\n\n- [ ] Draft the brief @Sam\n- [ ] Book the venue\n\nChecklist lines become task cards.'}
        aria-label="Board notes"
        className="flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none"
        data-scrollable
        data-notes
      />
      <div className="border-t p-2">
        <button
          disabled={!openItems}
          onClick={notesToCards}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          data-notes-to-cards
        >
          <ListChecks className="size-4" /> {openItems ? `Turn ${openItems} checklist item${openItems > 1 ? 's' : ''} into tasks` : 'Add “- [ ] …” lines to make tasks'}
        </button>
      </div>
    </div>
  )
}
