import {
  ChevronDown, ClipboardCopy, FileText, History, ListTodo, NotebookPen, Share2, Users, MessageCircle, Command, Download, FileDown, FileUp, Grid3x3, Home, Keyboard, LayoutTemplate, Monitor, Moon,
  PanelLeft, Play, Sun, Vote, FilePlus2, Trash, Sparkles,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LiveBar } from '@/sync/LiveBar'
import { toggleAssistant } from '@/ai/open'
import { clearVotes } from '@/board/actions'
import { AvatarStack } from '@/team/Avatar'
import { assigneesOf } from '@/team/collab'
import { NotificationsBell } from '@/team/NotificationsBell'
import { isMe, useTeam } from '@/team/team'
import { openWhatsAppWindow } from '@/team/whatsapp'
import { WhatsAppButton } from '@/team/WhatsAppButton'
import type { BoardObj } from '@/board/types'
import { useBoard } from '@/board/store'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { copyBoardPng, exportBoardPdf, exportBoardPng, saveBoardFile } from './boardIo'
import { JiroMark } from './JiroMark'
import { Timer } from './Timer'
import { Divider, ToolButton } from './ToolButton'
import { useUi } from './uiStore'

export function TopBar({ onHome, onNew, onOpenFile }: { onHome(): void; onNew(): void; onOpenFile(): void }) {
  const name = useBoard((s) => s.doc?.name ?? '')
  const bg = useBoard((s) => s.doc?.background ?? 'dots')
  const snap = useBoard((s) => s.snap)
  const voteMode = useUi((s) => s.voteMode)
  const framesPanel = useUi((s) => s.framesPanel)
  const tasksPanel = useUi((s) => s.tasksPanel)
  const notesPanel = useUi((s) => s.notesPanel)
  const versionsPanel = useUi((s) => s.versionsPanel)
  const me = useTeam((s) => s.me)
  const members = useTeam((s) => s.members)
  const myOpen = useBoard((s) => myOpenCount(s.doc?.objects))
  const minimap = useUi((s) => s.minimap)
  const theme = useUi((s) => s.theme)
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const totalVotes = useBoard((s) => voteTotal(s.doc?.objects))

  const commit = () => {
    const v = draft.trim()
    if (v && v !== name) useBoard.getState().rename(v)
    else setDraft(name)
  }

  return (
    <>
      <div className="jiro-float absolute top-3 left-3 z-20 flex h-12 items-center gap-1 pr-1 pl-1.5" data-ui>
        <button onClick={onHome} aria-label="All boards" className="grid size-9 place-items-center rounded-lg hover:bg-accent" data-action="home">
          <JiroMark className="size-7" />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(name)
              ;(e.target as HTMLInputElement).blur()
            }
            e.stopPropagation()
          }}
          aria-label="Board name"
          className="h-8 w-[min(220px,30vw)] truncate rounded-md bg-transparent px-2 text-[15px] font-semibold outline-none hover:bg-accent/60 focus:bg-background focus:ring-2 focus:ring-ring"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Board menu" className="grid size-8 place-items-center rounded-md hover:bg-accent" data-action="menu">
              <ChevronDown className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start">
            <DropdownMenuItem onSelect={onHome}><Home /> All boards</DropdownMenuItem>
            <DropdownMenuItem onSelect={onNew}><FilePlus2 /> New board <DropdownMenuShortcut>⌥N</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useUi.getState().set({ templatesOpen: true })}><LayoutTemplate /> Templates <DropdownMenuShortcut>⇧T</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenFile}><FileUp /> Open .jiro file… <DropdownMenuShortcut>⌘O</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void saveBoardFile()}><FileDown /> Save as .jiro file… <DropdownMenuShortcut>⌘S</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportBoardPng()}><Download /> Export board as PNG <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportBoardPdf()}><FileText /> Export frames as PDF <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyBoardPng()}><ClipboardCopy /> Copy as image <DropdownMenuShortcut>⇧⌘C</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Grid3x3 /> Background</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={bg} onValueChange={(v) => useBoard.getState().setBackground(v as 'dots')}>
                  <DropdownMenuRadioItem value="dots">Dots</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="lines">Lines</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="none">Plain</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />} Theme</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => useUi.getState().setTheme(v as 'light')}>
                  <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem checked={snap} onCheckedChange={(v) => useBoard.setState({ snap: !!v })}>Smart guides</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={minimap} onCheckedChange={(v) => useUi.getState().set({ minimap: !!v })}>Minimap</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => useUi.getState().set({ command: true })}><Command /> Command palette <DropdownMenuShortcut>⌘K</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useUi.getState().set({ shareOpen: true })}><Share2 /> Share… </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useUi.getState().set({ teamOpen: true })}><Users /> Team</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void openWhatsAppWindow()}><MessageCircle /> WhatsApp</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useUi.getState().set({ shortcuts: true })}><Keyboard /> Keyboard shortcuts <DropdownMenuShortcut>⌘/</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="jiro-float absolute top-3 right-3 z-20 flex h-12 items-center gap-0.5 px-1.5" data-ui>
        <LiveBar />
        <Timer />
        <Popover>
          <PopoverTrigger asChild>
            <ToolButton label="Voting" side="bottom" className={cn('size-9', voteMode && 'bg-[#4262ff] text-white hover:bg-[#4262ff] hover:text-white')} data-action="vote">
              <Vote />
              {totalVotes > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#4262ff] px-1 text-[10px] font-bold text-white ring-2 ring-card">{totalVotes}</span>}
            </ToolButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3" data-ui>
            <VotePanel />
          </PopoverContent>
        </Popover>
        <ToolButton label="Frames" shortcut="⇧F" side="bottom" className="size-9" active={framesPanel} onClick={() => togglePanel('framesPanel')} data-action="frames">
          <PanelLeft />
        </ToolButton>
        <ToolButton label="Tasks" shortcut="⇧K" side="bottom" className="size-9" active={tasksPanel} onClick={() => togglePanel('tasksPanel')} data-action="tasks">
          <ListTodo />
          {myOpen > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#4262ff] px-1 text-[10px] font-bold text-white ring-2 ring-card">{myOpen}</span>}
        </ToolButton>
        <ToolButton label="Notes" shortcut="⇧N" side="bottom" className="size-9" active={notesPanel} onClick={() => togglePanel('notesPanel')} data-action="notes">
          <NotebookPen />
        </ToolButton>
        <ToolButton label="Version history" shortcut="⇧H" side="bottom" className="size-9" active={versionsPanel} onClick={() => togglePanel('versionsPanel')} data-action="versions">
          <History />
        </ToolButton>
        <NotificationsBell />
        <WhatsAppButton />
        <Divider vertical />
        <button onClick={() => useUi.getState().set({ teamOpen: true })} className="flex h-9 items-center rounded-lg px-1 hover:bg-accent" aria-label="Team" title="Team" data-action="team">
          <AvatarStack people={[me, ...members]} size={26} max={3} />
        </button>
        <button
          onClick={() => toggleAssistant()}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium hover:bg-accent"
          data-action="ai"
          title="Jiro AI (⌘⌥K)"
        >
          <Sparkles className="size-4 text-[#8e4ec6]" /> AI
        </button>
        <button
          onClick={() => useUi.getState().set({ presenting: true, slide: 0 })}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-accent"
          data-action="present"
        >
          <Play className="size-4" /> Present
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium hover:bg-accent" data-action="export" aria-label="Export">
              <Download className="size-4" /> <ChevronDown className="size-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void exportBoardPng()} data-export="png"><Download /> PNG image <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportBoardPdf()} data-export="pdf"><FileText /> PDF — a page per frame <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyBoardPng()}><ClipboardCopy /> Copy as image <DropdownMenuShortcut>⇧⌘C</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void saveBoardFile()}><FileDown /> .jiro board file <DropdownMenuShortcut>⌘S</DropdownMenuShortcut></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => useUi.getState().set({ shareOpen: true })}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          data-action="share"
        >
          <Share2 className="size-4" /> Share
        </button>
      </div>
    </>
  )
}

function VotePanel() {
  const voteMode = useUi((s) => s.voteMode)
  const ranked = useBoard(useShallow((s) =>
    s.doc
      ? s.doc.order
          .map((id) => s.doc!.objects[id])
          .filter((o) => o?.votes)
          .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
          .slice(0, 8)
      : [],
  ))
  return (
    <div>
      <div className="mb-1 font-semibold">Dot voting</div>
      <p className="mb-3 text-xs text-muted-foreground">While voting is on, click any item to add a vote; ⌥-click removes one.</p>
      <button
        onClick={() => useUi.getState().set({ voteMode: !voteMode })}
        className={cn('mb-3 h-9 w-full rounded-md text-sm font-semibold', voteMode ? 'bg-[#4262ff] text-white' : 'bg-primary text-primary-foreground')}
        data-action="vote-toggle"
      >
        {voteMode ? 'Stop voting' : 'Start voting'}
      </button>
      {ranked.length > 0 && (
        <>
          <DropdownMenuLabelLike>Results</DropdownMenuLabelLike>
          <ol className="space-y-1">
            {ranked.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-sm">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#4262ff] text-xs font-bold text-white">{o.votes}</span>
                <span className="truncate">{'text' in o && o.text ? o.text : 'title' in o ? o.title : o.kind}</span>
              </li>
            ))}
          </ol>
          <button className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={clearVotes}>
            <Trash className="size-3.5" /> Clear all votes
          </button>
        </>
      )}
    </div>
  )
}

const DropdownMenuLabelLike = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 text-xs font-medium text-muted-foreground">{children}</div>

// Vote total, recomputed only when the objects map changes identity (not on every store update)
let lastObjects: unknown = null
let lastTotal = 0
function voteTotal(objects: Record<string, { votes?: number }> | undefined) {
  if (!objects) return 0
  if (objects === lastObjects) return lastTotal
  let t = 0
  for (const k in objects) t += objects[k].votes ?? 0
  lastObjects = objects
  lastTotal = t
  return t
}

/** Show one left drawer at a time (frames / tasks / notes) */
export function togglePanel(k: 'framesPanel' | 'tasksPanel' | 'notesPanel' | 'versionsPanel') {
  const ui = useUi.getState()
  const on = !ui[k]
  ui.set({ framesPanel: false, tasksPanel: false, notesPanel: false, versionsPanel: false, [k]: on })
}

// Open tasks assigned to me on this board (badge on the Tasks button), recomputed per objects map
let lastObjs: unknown = null
let lastMine = 0
function myOpenCount(objects: Record<string, BoardObj> | undefined) {
  if (!objects) return 0
  if (objects === lastObjs) return lastMine
  let n = 0
  for (const k in objects) {
    const o = objects[k]
    if (o.kind === 'card' && o.status !== 'done' && assigneesOf(o).some(isMe)) n++
  }
  lastObjs = objects
  lastMine = n
  return n
}
