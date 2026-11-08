import {
  BringToFront, ClipboardPaste, Copy, CreditCard, Download, Frame, Group, LayoutGrid, LayoutTemplate, Lock, Maximize, Pencil, Scissors, SendToBack,
  Sparkles, SquareDashedMousePointer, StickyNote, Trash2, Type, Ungroup, Unlock, ZoomIn,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { openAssistant } from '@/ai/open'
import { copyFromMenu, createWithTool, duplicateSelection, frameSelection, pasteFromMenu, tidyUp } from '@/board/actions'
import { inkFor, STICKY_COLORS } from '@/board/factory'
import { screenToBoard, useBoard } from '@/board/store'
import type { BoardObj, ID, Pt } from '@/board/types'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { exportSelectionPng } from '@/ui/boardIo'
import { useUi } from '@/ui/uiStore'
import { stage, zoomToFit, zoomToSelection } from './viewport'

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/** Right-click menu for the board: acts on what's under the cursor (selecting it first), or on the spot */
export function BoardContextMenu({ children }: { children: React.ReactNode }) {
  const at = useRef<Pt>({ x: 0, y: 0 })
  const [target, setTarget] = useState<'items' | 'canvas'>('canvas')
  // Read the board when the menu opens, not on every change (keeps big-board drags cheap)
  const [, setOpenTick] = useState(0)
  const { doc, selection: sel } = useBoard.getState()
  const objs = doc ? (sel.map((id) => doc.objects[id]).filter(Boolean) as BoardObj[]) : []
  const locked = objs.length > 0 && objs.every((o) => o.locked)
  const grouped = objs.length > 1 && objs.every((o) => o.groupId && o.groupId === objs[0].groupId)
  const stickies = objs.filter((o) => o.kind === 'sticky')
  const editable = objs.length === 1 && !locked && ['sticky', 'shape', 'text', 'card', 'mind', 'frame', 'connector'].includes(objs[0].kind)

  const onContextMenu = (e: React.MouseEvent) => {
    const s = useBoard.getState()
    if ((e.target as HTMLElement).closest('[data-ui], [data-editor]') || useUi.getState().presenting) {
      e.preventDefault()
      return
    }
    at.current = screenToBoard(s.vp, e.clientX - stage.left, e.clientY - stage.top)
    if (s.editingId) s.setEditing(null)
    const el = (e.target as Element).closest('[data-id], [data-frame-title]')
    const id = (el?.getAttribute('data-id') ?? el?.getAttribute('data-frame-title')) as ID | null
    if (id && s.doc?.objects[id]) {
      if (!s.selection.includes(id)) s.select([id])
      setTarget('items')
    } else if (s.selection.length && isInsideSelection(at.current)) {
      setTarget('items')
    } else {
      s.select([])
      setTarget('canvas')
    }
    if (s.tool !== 'select') s.setTool('select')
    setOpenTick((n) => n + 1)
  }

  const s = () => useBoard.getState()
  const place = (tool: 'sticky' | 'text' | 'frame' | 'card') => {
    const o = createWithTool(tool, at.current)
    if (o && tool !== 'frame') s().setEditing(o.id)
  }

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60" data-ui data-board-menu onCloseAutoFocus={(e) => e.preventDefault()}>
        {target === 'items' && objs.length > 0 ? (
          <>
            {stickies.length > 0 && !locked && (
              <div className="flex flex-wrap gap-1 px-1.5 py-1.5" role="group" aria-label="Sticky colour">
                {STICKY_COLORS.slice(0, 10).map((c) => (
                  <button
                    key={c.fill}
                    aria-label={c.name}
                    title={c.name}
                    className="size-5 rounded border border-black/10 transition hover:scale-125"
                    style={{ background: c.fill }}
                    onClick={() => {
                      const patches: Record<ID, Partial<BoardObj>> = {}
                      for (const o of stickies) patches[o.id] = { fill: c.fill, color: inkFor(c.fill) } as Partial<BoardObj>
                      s().updateMany(patches)
                    }}
                  />
                ))}
              </div>
            )}
            {editable && (
              <ContextMenuItem onSelect={() => s().setEditing(objs[0].id)}>
                <Pencil /> Edit text <ContextMenuShortcut>↵</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {!locked && (
              <ContextMenuItem onSelect={() => void copyFromMenu(true)}>
                <Scissors /> Cut <ContextMenuShortcut>{mod}X</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={() => void copyFromMenu()}>
              <Copy /> Copy <ContextMenuShortcut>{mod}C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => duplicateSelection()}>
              <Copy /> Duplicate <ContextMenuShortcut>{mod}D</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => s().bringToFront()}>
              <BringToFront /> Bring to front <ContextMenuShortcut>]</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => s().sendToBack()}>
              <SendToBack /> Send to back <ContextMenuShortcut>[</ContextMenuShortcut>
            </ContextMenuItem>
            {objs.length > 1 && !grouped && (
              <ContextMenuItem onSelect={() => s().group()}>
                <Group /> Group <ContextMenuShortcut>{mod}G</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {grouped && (
              <ContextMenuItem onSelect={() => s().ungroup()}>
                <Ungroup /> Ungroup
              </ContextMenuItem>
            )}
            {objs.length > 1 && (
              <ContextMenuItem onSelect={tidyUp}>
                <LayoutGrid /> Tidy up
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={frameSelection}>
              <Frame /> Wrap in frame
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => s().toggleLock()}>
              {locked ? <Unlock /> : <Lock />} {locked ? 'Unlock' : 'Lock'}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => openAssistant()}>
              <Sparkles className="text-[#8e4ec6]" /> Ask AI about this
            </ContextMenuItem>
            <ContextMenuItem onSelect={zoomToSelection}>
              <ZoomIn /> Zoom to selection <ContextMenuShortcut>⇧2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void exportSelectionPng()}>
              <Download /> Export as PNG
            </ContextMenuItem>
            {!locked && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => s().remove(s().selection.filter((id) => !s().doc!.objects[id]?.locked))}>
                  <Trash2 /> Delete <ContextMenuShortcut>⌫</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            )}
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => void pasteFromMenu(at.current)}>
              <ClipboardPaste /> Paste here <ContextMenuShortcut>{mod}V</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => place('sticky')}>
              <StickyNote /> Add sticky note <ContextMenuShortcut>N</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => place('text')}>
              <Type /> Add text <ContextMenuShortcut>T</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => place('card')}>
              <CreditCard /> Add card <ContextMenuShortcut>K</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => place('frame')}>
              <Frame /> Add frame <ContextMenuShortcut>F</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => useUi.getState().set({ templatesOpen: true })}>
              <LayoutTemplate /> Templates… <ContextMenuShortcut>⇧T</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => s().select(s().doc!.order.filter((id) => !s().doc!.objects[id]?.locked))}>
              <SquareDashedMousePointer /> Select all <ContextMenuShortcut>{mod}A</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => zoomToFit()}>
              <Maximize /> Zoom to fit <ContextMenuShortcut>⇧1</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openAssistant()}>
              <Sparkles className="text-[#8e4ec6]" /> Ask Jiro AI <ContextMenuShortcut>⌥{mod}K</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function isInsideSelection(p: Pt) {
  const { doc, selection } = useBoard.getState()
  if (!doc) return false
  return selection.some((id) => {
    const o = doc.objects[id]
    return o && o.kind !== 'connector' && p.x >= o.x && p.y >= o.y && p.x <= o.x + o.w && p.y <= o.y + o.h
  })
}
