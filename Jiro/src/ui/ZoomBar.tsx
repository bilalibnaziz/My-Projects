import { Maximize, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { rotatedBounds, union } from '@/board/geometry'
import { useBoard } from '@/board/store'
import { stage, resetZoom, zoomBy, zoomToFit } from '@/canvas/viewport'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToolButton } from './ToolButton'
import { useUi } from './uiStore'

export function ZoomBar() {
  const zoom = useBoard((s) => s.vp.zoom)
  const minimap = useUi((s) => s.minimap)
  return (
    <div className="absolute right-3 bottom-3 z-20 flex flex-col items-end gap-2" data-ui>
      {minimap && <Minimap />}
      <div className="jiro-float flex h-11 items-center gap-0.5 px-1">
        <ToolButton label="Zoom out" shortcut="⌘−" side="top" className="size-9" onClick={() => zoomBy(1 / 1.25)}>
          <Minus />
        </ToolButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-14 rounded-md text-sm font-medium tabular-nums hover:bg-accent" aria-label="Zoom level" data-zoom>
              {Math.round(zoom * 100)}%
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="w-52">
            <DropdownMenuItem onSelect={() => zoomToFit()}>Zoom to fit <DropdownMenuShortcut>⇧1</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem onSelect={resetZoom}>Zoom to 100% <DropdownMenuShortcut>⌘0</DropdownMenuShortcut></DropdownMenuItem>
            {[0.25, 0.5, 2, 4].map((z) => (
              <DropdownMenuItem key={z} onSelect={() => zoomBy(z / useBoard.getState().vp.zoom)}>
                {z * 100}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton label="Zoom in" shortcut="⌘+" side="top" className="size-9" onClick={() => zoomBy(1.25)}>
          <Plus />
        </ToolButton>
        <ToolButton label="Fit to screen" shortcut="⇧1" side="top" className="size-9" onClick={() => zoomToFit()}>
          <Maximize />
        </ToolButton>
      </div>
    </div>
  )
}

const MW = 200, MH = 130

/** Overview of the whole board; click or drag to fly there */
function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null)
  const doc = useBoard((s) => s.doc)
  const vp = useBoard((s) => s.vp)
  const map = useRef({ x: 0, y: 0, k: 1 })

  // Redraw at most every ~120 ms: on a huge board a drag changes the doc every frame
  const [tick, setTick] = useState(0)
  const lastDraw = useRef(0)
  useEffect(() => {
    const wait = 120 - (performance.now() - lastDraw.current)
    if (wait <= 0) return setTick((t) => t + 1)
    const id = setTimeout(() => setTick((t) => t + 1), wait)
    return () => clearTimeout(id)
  }, [doc, vp])

  useEffect(() => {
    const c = ref.current
    if (!c || !doc) return
    lastDraw.current = performance.now()
    const dpr = window.devicePixelRatio || 1
    c.width = MW * dpr
    c.height = MH * dpr
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, MW, MH)
    const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: stage.w / vp.zoom, h: stage.h / vp.zoom }
    const objs = doc.order.map((id) => doc.objects[id]).filter((o) => o && o.kind !== 'connector')
    const b = union([...objs.map((o) => rotatedBounds(o)), view])!
    const pad = 8
    const k = Math.min((MW - pad * 2) / b.w, (MH - pad * 2) / b.h)
    const ox = pad + (MW - pad * 2 - b.w * k) / 2 - b.x * k
    const oy = pad + (MH - pad * 2 - b.h * k) / 2 - b.y * k
    map.current = { x: ox, y: oy, k }
    for (const o of objs) {
      const color =
        o.kind === 'sticky' || o.kind === 'shape' ? (o.fill === 'transparent' ? '#a1a1aa' : o.fill)
          : o.kind === 'frame' ? '#ffffff'
            : o.kind === 'card' ? o.tag
              : o.kind === 'mind' ? o.color
                : o.kind === 'pen' ? o.color
                  : '#a1a1aa'
      ctx.fillStyle = color
      ctx.globalAlpha = o.kind === 'frame' ? 0.9 : 0.85
      const r = rotatedBounds(o)
      ctx.fillRect(ox + r.x * k, oy + r.y * k, Math.max(1.5, r.w * k), Math.max(1.5, r.h * k))
      if (o.kind === 'frame') {
        ctx.strokeStyle = '#c4c4cc'
        ctx.lineWidth = 0.5
        ctx.strokeRect(ox + r.x * k, oy + r.y * k, r.w * k, r.h * k)
      }
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#4262ff'
    ctx.lineWidth = 1.5
    ctx.fillStyle = 'rgba(66,98,255,.08)'
    ctx.fillRect(ox + view.x * k, oy + view.y * k, view.w * k, view.h * k)
    ctx.strokeRect(ox + view.x * k, oy + view.y * k, view.w * k, view.h * k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const go = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const m = map.current
    const bx = (e.clientX - r.left - m.x) / m.k
    const by = (e.clientY - r.top - m.y) / m.k
    const z = useBoard.getState().vp.zoom
    useBoard.getState().setVp({ x: stage.w / 2 - bx * z, y: stage.h / 2 - by * z })
  }

  return (
    <div className="jiro-float overflow-hidden p-0" data-minimap>
      <canvas
        ref={ref}
        style={{ width: MW, height: MH }}
        className="block cursor-pointer bg-canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          go(e)
        }}
        onPointerMove={(e) => e.buttons && go(e)}
        aria-label="Minimap"
      />
    </div>
  )
}
