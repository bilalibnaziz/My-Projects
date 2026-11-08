import { clamp } from '@/board/geometry'
import { boundsOf, useBoard } from '@/board/store'
import type { Rect, Viewport } from '@/board/types'

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 8

/** Size of the board stage element, kept current by the canvas */
export const stage = { w: typeof window !== 'undefined' ? window.innerWidth : 1200, h: typeof window !== 'undefined' ? window.innerHeight : 800, left: 0, top: 0 }

let anim = 0

export function zoomAt(sx: number, sy: number, zoom: number) {
  const vp = useBoard.getState().vp
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const bx = (sx - vp.x) / vp.zoom, by = (sy - vp.y) / vp.zoom
  cancelAnimationFrame(anim)
  useBoard.getState().setVp({ zoom: z, x: sx - bx * z, y: sy - by * z })
}

export function zoomBy(factor: number) {
  zoomAt(stage.w / 2, stage.h / 2, useBoard.getState().vp.zoom * factor)
}

export function animateVp(to: Viewport, ms = 360) {
  cancelAnimationFrame(anim)
  const from = { ...useBoard.getState().vp }
  const t0 = performance.now()
  // Zoom interpolated in log space so it feels uniform
  const lz0 = Math.log(from.zoom), lz1 = Math.log(to.zoom)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const e = 1 - Math.pow(1 - t, 3)
    const z = Math.exp(lz0 + (lz1 - lz0) * e)
    // keep the world point under the screen centre moving linearly
    const cx0 = (stage.w / 2 - from.x) / from.zoom, cy0 = (stage.h / 2 - from.y) / from.zoom
    const cx1 = (stage.w / 2 - to.x) / to.zoom, cy1 = (stage.h / 2 - to.y) / to.zoom
    const cx = cx0 + (cx1 - cx0) * e, cy = cy0 + (cy1 - cy0) * e
    useBoard.getState().setVp({ zoom: z, x: stage.w / 2 - cx * z, y: stage.h / 2 - cy * z })
    if (t < 1) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

/** Width covered on the right by an open side panel (the AI drawer), so fits land in the visible part */
function rightInset() {
  if (typeof document === 'undefined') return 0
  const p = document.querySelector('.ai-panel')
  return p ? Math.max(0, stage.left + stage.w - p.getBoundingClientRect().left) : 0
}

export function vpForRect(r: Rect, pad = 80, maxZoom = 2): Viewport {
  const w = stage.w - rightInset()
  const zoom = clamp(Math.min((w - pad * 2) / Math.max(1, r.w), (stage.h - pad * 2) / Math.max(1, r.h)), MIN_ZOOM, maxZoom)
  return { zoom, x: w / 2 - (r.x + r.w / 2) * zoom, y: stage.h / 2 - (r.y + r.h / 2) * zoom }
}

export function zoomToRect(r: Rect, opts: { pad?: number; maxZoom?: number; instant?: boolean } = {}) {
  const v = vpForRect(r, opts.pad ?? 80, opts.maxZoom ?? 2)
  if (opts.instant) useBoard.getState().setVp(v)
  else animateVp(v)
}

export function zoomToFit(instant = false) {
  const { doc } = useBoard.getState()
  if (!doc) return
  const b = boundsOf(doc.order, doc.objects)
  if (!b) return animateVp({ x: stage.w / 2, y: stage.h / 2, zoom: 1 })
  zoomToRect(b, { instant, maxZoom: 1.5 })
}

export function zoomToSelection() {
  const { doc, selection } = useBoard.getState()
  if (!doc || !selection.length) return
  const b = boundsOf(selection, doc.objects)
  if (b) zoomToRect(b, { maxZoom: 3 })
}

export function resetZoom() {
  const vp = useBoard.getState().vp
  const cx = (stage.w / 2 - vp.x) / vp.zoom, cy = (stage.h / 2 - vp.y) / vp.zoom
  animateVp({ zoom: 1, x: stage.w / 2 - cx, y: stage.h / 2 - cy }, 240)
}

/** Board point at the centre of the visible stage */
export function viewCenter() {
  const vp = useBoard.getState().vp
  return { x: (stage.w / 2 - vp.x) / vp.zoom, y: (stage.h / 2 - vp.y) / vp.zoom }
}

/** Visible board rect (for culling) */
export function visibleRect(vp: Viewport, margin = 200): Rect {
  return { x: (-vp.x - margin) / vp.zoom, y: (-vp.y - margin) / vp.zoom, w: (stage.w + margin * 2) / vp.zoom, h: (stage.h + margin * 2) / vp.zoom }
}
