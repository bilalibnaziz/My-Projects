import {
  ClipboardCopy, Download, History, Sparkles, Share2, ListTodo, NotebookPen, Users, Link2, FileText, MessageCircle, FileDown, Frame, Keyboard, LayoutGrid, LayoutTemplate, Map as MapIcon, Maximize, Moon, Palette, Play, SortAsc, Sun, Vote, Wand2,
} from 'lucide-react'
import { openAssistant } from '@/ai/open'
import { clusterByColor, frameSelection, sortByText, textOf, tidyUp } from '@/board/actions'
import { intersects, rotatedBounds } from '@/board/geometry'
import { boundsOf, useBoard } from '@/board/store'
import { instantiate, TEMPLATES } from '@/board/templates'
import type { Tool } from '@/board/types'
import { viewCenter, zoomToFit, zoomToRect } from '@/canvas/viewport'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command'
import { copyBoardPng, exportBoardPdf, exportBoardPng, saveBoardFile } from './boardIo'
import { boardMarkdown } from '@/team/collab'
import { openWhatsAppWindow } from '@/team/whatsapp'
import { togglePanel } from './TopBar'
import { useUi } from './uiStore'

const TOOLS: [Tool, string, string][] = [
  ['select', 'Select', 'V'], ['hand', 'Hand', 'H'], ['sticky', 'Sticky note', 'N'], ['text', 'Text', 'T'], ['shape', 'Shape', 'S'],
  ['connector', 'Connection line', 'L'], ['pen', 'Pen', 'P'], ['highlighter', 'Highlighter', '⇧P'], ['eraser', 'Eraser', 'E'],
  ['frame', 'Frame', 'F'], ['card', 'Card', 'K'], ['mind', 'Mind map', 'M'], ['comment', 'Comment', 'C'], ['emoji', 'Stamp', 'R'], ['laser', 'Laser pointer', 'Q'],
]

export function insertTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) return
  const c = viewCenter()
  let objs = instantiate(t, c.x, c.y)
  // Never drop a template on top of existing work: move it beside the board's content instead
  const doc = useBoard.getState().doc!
  const tb = boundsOf(objs.map((o) => o.id), Object.fromEntries(objs.map((o) => [o.id, o])))
  const content = boundsOf(doc.order, doc.objects)
  if (tb && content && intersects(tb, content)) {
    const nx = content.x + content.w + 240 + tb.w / 2
    const ny = content.y + tb.h / 2
    objs = instantiate(t, nx, ny)
  }
  const frames = objs.filter((o) => o.kind === 'frame')
  const rest = objs.filter((o) => o.kind !== 'frame')
  const s = useBoard.getState()
  s.checkpoint()
  if (frames.length) s.add(frames, { back: true, history: false })
  s.add(rest, { history: false, select: false })
  s.select(objs.map((o) => o.id))
  const xs = objs.filter((o) => o.kind !== 'connector').map((o) => rotatedBounds(o))
  const x0 = Math.min(...xs.map((r) => r.x)), y0 = Math.min(...xs.map((r) => r.y))
  zoomToRect({ x: x0, y: y0, w: Math.max(...xs.map((r) => r.x + r.w)) - x0, h: Math.max(...xs.map((r) => r.y + r.h)) - y0 }, { maxZoom: 1 })
}

export function CommandPalette() {
  const open = useUi((s) => s.command)
  const set = useUi((s) => s.set)
  const doc = useBoard((s) => s.doc)
  const run = (fn: () => void) => () => {
    set({ command: false })
    setTimeout(fn, 0)
  }
  const items = open && doc ? doc.order.map((id) => doc.objects[id]).filter((o) => o && o.kind !== 'pen' && textOf(o).trim()).slice(0, 300) : []
  const frames = open && doc ? doc.order.map((id) => doc.objects[id]).filter((o) => o?.kind === 'frame') : []

  return (
    <CommandDialog open={open} onOpenChange={(o) => set({ command: o })} title="Command palette" description="Search the board or run a command">
      <CommandInput placeholder="Search the board, run a command, add a template…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No results.</CommandEmpty>
        {items.length > 0 && (
          <CommandGroup heading="On this board">
            {items.map((o) => (
              <CommandItem
                key={o.id}
                value={`${o.kind} ${textOf(o)} ${o.id}`}
                onSelect={run(() => {
                  useBoard.getState().select([o.id])
                  zoomToRect(rotatedBounds(o), { pad: 160, maxZoom: 1.5 })
                })}
              >
                <span className="w-14 shrink-0 text-xs text-muted-foreground capitalize">{o.kind}</span>
                <span className="truncate">{textOf(o).replace(/\s+/g, ' ')}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {frames.length > 0 && (
          <CommandGroup heading="Go to frame">
            {frames.map((f) => f.kind === 'frame' && (
              <CommandItem key={f.id} value={`frame go ${f.title} ${f.id}`} onSelect={run(() => zoomToRect(f, { pad: 60, maxZoom: 4 }))}>
                <Frame /> {f.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Team">
          <CommandItem value="share board email whatsapp link" onSelect={run(() => set({ shareOpen: true }))}><Share2 /> Share board… (email, WhatsApp, link)</CommandItem>
          <CommandItem value="tasks assigned my tasks" onSelect={run(() => togglePanel('tasksPanel'))}><ListTodo /> Tasks <CommandShortcut>⇧K</CommandShortcut></CommandItem>
          <CommandItem value="notes meeting notes checklist" onSelect={run(() => togglePanel('notesPanel'))}><NotebookPen /> Notes <CommandShortcut>⇧N</CommandShortcut></CommandItem>
          <CommandItem value="version history restore snapshot backup undo" onSelect={run(() => togglePanel('versionsPanel'))}><History /> Version history <CommandShortcut>⇧H</CommandShortcut></CommandItem>
          <CommandItem value="whatsapp web open log in qr" onSelect={run(() => void openWhatsAppWindow())}><MessageCircle /> Open WhatsApp</CommandItem>
          <CommandItem value="team members teammates profile" onSelect={run(() => set({ teamOpen: true }))}><Users /> Team & profile</CommandItem>
          <CommandItem value="open shared link paste" onSelect={run(() => set({ linkOpen: true }))}><Link2 /> Open a shared link…</CommandItem>
          <CommandItem value="copy as document markdown google docs notion" onSelect={run(() => { const d = useBoard.getState().doc; if (d) void navigator.clipboard.writeText(boardMarkdown(d)) })}><FileText /> Copy board as document</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="ask jiro ai assistant claude chatgpt gemini" onSelect={run(() => openAssistant())}><Sparkles /> Ask Jiro AI <CommandShortcut>⌥⌘K</CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => zoomToFit())}><Maximize /> Zoom to fit <CommandShortcut>⇧1</CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => set({ presenting: true, slide: 0 }))}><Play /> Present frames</CommandItem>
          <CommandItem onSelect={run(tidyUp)}><LayoutGrid /> Tidy up selection</CommandItem>
          <CommandItem onSelect={run(clusterByColor)}><Palette /> Cluster selection by colour</CommandItem>
          <CommandItem onSelect={run(sortByText)}><SortAsc /> Sort selection A → Z</CommandItem>
          <CommandItem onSelect={run(frameSelection)}><Frame /> Wrap selection in a frame</CommandItem>
          <CommandItem onSelect={run(() => set({ voteMode: !useUi.getState().voteMode }))}><Vote /> Toggle voting</CommandItem>
          <CommandItem onSelect={run(() => void exportBoardPng())}><Download /> Export board as PNG <CommandShortcut>⇧⌘E</CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => void exportBoardPdf())}><Download /> Export frames as PDF <CommandShortcut>⇧⌘P</CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => void copyBoardPng())}><ClipboardCopy /> Copy as image <CommandShortcut>⇧⌘C</CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => void saveBoardFile())}><FileDown /> Save as .jiro file <CommandShortcut>⌘S</CommandShortcut></CommandItem>
          <CommandItem onSelect={run(() => set({ minimap: !useUi.getState().minimap }))}><MapIcon /> Toggle minimap</CommandItem>
          <CommandItem onSelect={run(() => useUi.getState().setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'))}>
            <Moon className="dark:hidden" /><Sun className="hidden dark:block" /> Toggle dark mode
          </CommandItem>
          <CommandItem onSelect={run(() => set({ shortcuts: true }))}><Keyboard /> Keyboard shortcuts <CommandShortcut>⌘/</CommandShortcut></CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Tools">
          {TOOLS.map(([t, n, k]) => (
            <CommandItem key={t} value={`tool ${n}`} onSelect={run(() => useBoard.getState().setTool(t))}>
              <Wand2 /> {n} <CommandShortcut>{k}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Add template">
          {TEMPLATES.map((t) => (
            <CommandItem key={t.id} value={`template ${t.name} ${t.description}`} onSelect={run(() => insertTemplate(t.id))}>
              <LayoutTemplate /> {t.name} <span className="ml-2 truncate text-xs text-muted-foreground">{t.description}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
