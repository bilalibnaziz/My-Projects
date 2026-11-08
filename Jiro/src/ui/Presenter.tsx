import { ChevronLeft, ChevronRight, Pointer, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { boundsOf, useBoard } from '@/board/store'
import { animateVp, vpForRect } from '@/canvas/viewport'
import { isTauri } from '@/lib/files'
import { cn } from '@/lib/utils'
import { useFrames } from './FramesPanel'
import { useUi } from './uiStore'

/** Presentation mode: frames are slides, chrome is hidden, arrows / space step through */
export function Presenter() {
  const presenting = useUi((s) => s.presenting)
  const slide = useUi((s) => s.slide)
  const frames = useFrames(presenting)
  const tool = useBoard((s) => s.tool)
  const saved = useRef<{ vp: ReturnType<typeof useBoard.getState>['vp']; tool: ReturnType<typeof useBoard.getState>['tool'] } | null>(null)

  useEffect(() => {
    if (!presenting) return
    const s = useBoard.getState()
    saved.current = { vp: s.vp, tool: s.tool }
    s.select([])
    s.setEditing(null)
    void setFullscreen(true)
    return () => {
      void setFullscreen(false)
      if (saved.current) {
        animateVp(saved.current.vp, 300)
        useBoard.getState().setTool(saved.current.tool === 'laser' ? 'select' : saved.current.tool)
      }
    }
  }, [presenting])

  useEffect(() => {
    if (!presenting) return
    const s = useBoard.getState()
    const f = frames[slide]
    const r = f ?? (s.doc ? boundsOf(s.doc.order, s.doc.objects) : null)
    if (r) animateVp(vpForRect(r, f ? 24 : 80, 8), 450)
  }, [presenting, slide, frames])

  useEffect(() => {
    if (!presenting) return
    const n = Math.max(1, frames.length)
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ui.set({ slide: Math.min(n - 1, ui.slide + 1) })
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        ui.set({ slide: Math.max(0, ui.slide - 1) })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        ui.set({ presenting: false })
      } else if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'l') {
        e.stopImmediatePropagation()
        const st = useBoard.getState()
        st.setTool(st.tool === 'laser' ? 'select' : 'laser')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [presenting, frames.length])

  if (!presenting) return null
  const n = Math.max(1, frames.length)
  const set = useUi.getState().set
  return (
    <div className="pointer-events-none absolute inset-0 z-40" data-ui data-presenter>
      <div className="jiro-pop pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#1a1a2e]/90 p-1.5 text-white shadow-2xl backdrop-blur">
        <button aria-label="Previous slide" className="grid size-9 place-items-center rounded-full hover:bg-white/15 disabled:opacity-30" disabled={slide === 0} onClick={() => set({ slide: slide - 1 })}>
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-24 px-2 text-center text-sm tabular-nums">
          {frames.length ? (
            <>
              <span className="font-semibold">{slide + 1}</span> / {n}
              <div className="max-w-40 truncate text-[11px] opacity-70">{frames[slide]?.title}</div>
            </>
          ) : (
            'Whole board'
          )}
        </div>
        <button aria-label="Next slide" className="grid size-9 place-items-center rounded-full hover:bg-white/15 disabled:opacity-30" disabled={slide >= n - 1} onClick={() => set({ slide: slide + 1 })}>
          <ChevronRight className="size-5" />
        </button>
        <div className="mx-1 h-6 w-px bg-white/20" />
        <button
          aria-label="Laser pointer"
          title="Laser pointer (Q)"
          className={cn('grid size-9 place-items-center rounded-full hover:bg-white/15', tool === 'laser' && 'bg-[#ff3355] hover:bg-[#ff3355]')}
          onClick={() => useBoard.getState().setTool(tool === 'laser' ? 'select' : 'laser')}
        >
          <Pointer className="size-4" />
        </button>
        <button aria-label="Stop presenting" className="flex h-9 items-center gap-1 rounded-full px-3 text-sm hover:bg-white/15" onClick={() => set({ presenting: false })}>
          <X className="size-4" /> Exit
        </button>
      </div>
    </div>
  )
}

/** Native window fullscreen on desktop (WKWebView's DOM fullscreen is unreliable); DOM API in browsers */
async function setFullscreen(on: boolean) {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setFullscreen(on)
    } else if (on) await document.documentElement.requestFullscreen?.()
    else if (document.fullscreenElement) await document.exitFullscreen()
  } catch {
    /* fullscreen refused: present in the window */
  }
}
