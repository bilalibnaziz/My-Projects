import { Download, Frame, Play, Plus, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { frameChildren } from '@/board/actions'
import { makeFrame } from '@/board/factory'
import { useBoard } from '@/board/store'
import type { FrameObj } from '@/board/types'
import { viewCenter, zoomToRect } from '@/canvas/viewport'
import { exportBoardPng } from './boardIo'
import { useUi } from './uiStore'

/** Frames in reading order: the board order of frames (what Present walks through) */
const NONE: FrameObj[] = []

/** Frames in board order. Pass enabled=false to skip the scan entirely (it runs on every board change). */
export function useFrames(enabled = true): FrameObj[] {
  return useBoard(useShallow((s) => (enabled && s.doc ? s.doc.order.map((id) => s.doc!.objects[id]).filter((o): o is FrameObj => o?.kind === 'frame') : NONE)))
}

export function FramesPanel() {
  const open = useUi((s) => s.framesPanel)
  return open ? <FramesList /> : null
}

function FramesList() {
  const frames = useFrames()
  const sel = useBoard((s) => s.selection)
  return (
    <div className="jiro-float absolute top-[72px] bottom-3 left-[66px] z-20 flex w-64 flex-col" data-ui data-frames-panel>
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <Frame className="size-4" />
        <span className="text-sm font-semibold">Frames</span>
        <span className="text-xs text-muted-foreground">{frames.length}</span>
        <button
          aria-label="Add frame"
          className="ml-auto grid size-7 place-items-center rounded-md hover:bg-accent"
          onClick={() => {
            const c = viewCenter()
            const f = makeFrame(c.x - 640, c.y - 360, 1280, 720, `Frame ${frames.length + 1}`)
            useBoard.getState().add(f, { back: true })
          }}
        >
          <Plus className="size-4" />
        </button>
        <button aria-label="Close frames" className="grid size-7 place-items-center rounded-md hover:bg-accent" onClick={() => useUi.getState().set({ framesPanel: false })}>
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2" data-scrollable>
        {!frames.length && <p className="p-3 text-sm text-muted-foreground">No frames yet. Press F and click the board to add one: frames become slides when you present.</p>}
        {frames.map((f, i) => (
          <div
            key={f.id}
            className={'group mb-1 flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-accent ' + (sel.includes(f.id) ? 'bg-accent' : '')}
            onClick={() => {
              useBoard.getState().select([f.id])
              zoomToRect(f, { pad: 60, maxZoom: 4 })
            }}
            data-frame-item
          >
            <div className="grid h-10 w-16 shrink-0 place-items-center rounded border text-xs font-semibold text-muted-foreground" style={{ background: f.fill }}>
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{f.title || 'Untitled'}</div>
              <div className="text-xs text-muted-foreground">{frameChildren(f, useBoard.getState().doc!.objects, useBoard.getState().doc!.order).length} items</div>
            </div>
            <button
              aria-label={`Present from ${f.title}`}
              className="hidden size-7 place-items-center rounded-md group-hover:grid hover:bg-background"
              onClick={(e) => {
                e.stopPropagation()
                useUi.getState().set({ presenting: true, slide: i })
              }}
            >
              <Play className="size-3.5" />
            </button>
            <button
              aria-label={`Export ${f.title}`}
              className="hidden size-7 place-items-center rounded-md group-hover:grid hover:bg-background"
              onClick={(e) => {
                e.stopPropagation()
                void exportBoardPng({ ids: [f.id], name: f.title })
              }}
            >
              <Download className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
