import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LiveCursors } from '@/sync/LiveCursors'
import { setCursor, useLive } from '@/sync/live'
import { addImageFiles, cloneObjects, createWithTool, frameChildren, handleCopy, handlePaste, quickCreate, vote } from '@/board/actions'
import { makeConnector, makePen } from '@/board/factory'
import {
  anchorPoint, connectorBounds, intersects, nearestAnchor, normRect, polylineHit, rotatedBounds, simplify, smoothPath, contains,
} from '@/board/geometry'
import { mindDescendants, mindRoot } from '@/board/mindmap'
import { boundsOf, screenToBoard, useBoard } from '@/board/store'
import type { Anchor, BoardObj, End, ID, Pt, Rect } from '@/board/types'
import { useUi } from '@/ui/uiStore'
import { ConnectorView, MindBranch, ObjectView } from './ObjectView'
import { BoardContextMenu } from './BoardContextMenu'
import { cullBoard } from './culling'
import { SelectionOverlay } from './SelectionOverlay'
import { stage, visibleRect, zoomAt } from './viewport'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Drag =
  | { t: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { t: 'marquee'; a: Pt; additive: boolean; base: ID[]; moved: boolean; frameHit: ID | null }
  | { t: 'move'; a: Pt; ids: ID[]; orig: Map<ID, { x: number; y: number; from?: Pt; to?: Pt }>; bounds: Rect; moved: boolean; alt: boolean; clickId: ID | null; shift: boolean }
  | { t: 'resize'; h: Handle; a: Pt; bounds: Rect; orig: Map<ID, BoardObj>; single: boolean }
  | { t: 'rotate'; c: Pt; orig: Map<ID, BoardObj>; a0: number }
  | { t: 'create'; a: Pt; b: Pt }
  | { t: 'draw'; pts: number[] }
  | { t: 'erase' }
  | { t: 'connect'; from: End; b: Pt; target: { id: ID; anchor: Anchor } | null }
  | { t: 'end'; id: ID; which: 'from' | 'to'; target: { id: ID; anchor: Anchor } | null }
  | { t: 'laser' }

const SNAP = 6

export function Canvas() {
  const doc = useBoard((s) => s.doc)!
  const vp = useBoard((s) => s.vp)
  const tool = useBoard((s) => s.tool)
  const editingId = useBoard((s) => s.editingId)
  const opts = useBoard((s) => s.opts)
  const voteMode = useUi((s) => s.voteMode)
  const presenting = useUi((s) => s.presenting)
  // A view-only live invite: look around, but no edits
  const readOnly = useLive((s) => s.readOnly)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const pointer = useRef<Pt>({ x: 0, y: 0 })
  const space = useRef(false)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])
  const [guides, setGuides] = useState<{ x?: number; y?: number }[]>([])
  const [laser, setLaser] = useState<{ x: number; y: number; t: number }[]>([])
  const [hoverTarget, setHoverTarget] = useState<{ id: ID; anchor: Anchor } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const visibleRef = useRef<BoardObj[]>([])

  // ---- stage size ----
  useLayoutEffect(() => {
    const el = stageRef.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      Object.assign(stage, { w: r.width, h: r.height, left: r.left, top: r.top })
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    Object.assign(stage, { w: r.width, h: r.height, left: r.left, top: r.top })
    return () => ro.disconnect()
  }, [])

  const toBoard = useCallback((e: { clientX: number; clientY: number }) => {
    const { vp } = useBoard.getState()
    return screenToBoard(vp, e.clientX - stage.left, e.clientY - stage.top)
  }, [])

  // ---- wheel: pinch / ⌘-wheel zooms at the cursor, plain wheel pans ----
  useEffect(() => {
    const el = stageRef.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-scrollable]')) return
      e.preventDefault()
      const sx = e.clientX - stage.left, sy = e.clientY - stage.top
      const { vp, setVp } = useBoard.getState()
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0075))
        zoomAt(sx, sy, vp.zoom * factor)
      } else {
        const k = e.deltaMode === 1 ? 20 : 1
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        setVp({ x: vp.x - dx * k, y: vp.y - dy * k })
      }
    }
    // Safari/WebKit trackpad pinch
    let gz = 1
    const onGStart = (e: Event) => { e.preventDefault(); gz = useBoard.getState().vp.zoom }
    const onGChange = (e: Event) => {
      e.preventDefault()
      const ge = e as unknown as { scale: number; clientX: number; clientY: number }
      zoomAt(ge.clientX - stage.left, ge.clientY - stage.top, gz * ge.scale)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGStart)
    el.addEventListener('gesturechange', onGChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGStart)
      el.removeEventListener('gesturechange', onGChange)
    }
  }, [])

  // ---- paste / space-to-pan ----
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (useBoard.getState().editingId || (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return
      void handlePaste(e, screenToBoard(useBoard.getState().vp, pointer.current.x, pointer.current.y))
    }
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !useBoard.getState().editingId && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
        e.preventDefault()
        space.current = true
        setSpaceDown(true)
      }
    }
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false
        setSpaceDown(false)
      }
    }
    const busy = (e: Event) => !!useBoard.getState().editingId || !!(e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]') || !!document.querySelector('[role="dialog"]:not(.ai-panel)')
    const onCopy = (e: ClipboardEvent) => { if (!busy(e)) handleCopy(e, false) }
    const onCut = (e: ClipboardEvent) => { if (!busy(e)) handleCopy(e, true) }
    window.addEventListener('copy', onCopy)
    window.addEventListener('cut', onCut)
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('cut', onCut)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  // ---- remove empty text objects when their edit ends ----
  const prevEditing = useRef<ID | null>(null)
  useEffect(() => {
    const prev = prevEditing.current
    prevEditing.current = editingId
    if (prev && prev !== editingId) {
      const o = useBoard.getState().doc?.objects[prev]
      if (o?.kind === 'text' && !o.text.trim()) {
        // drop it without leaving an undo step for "deleted empty text"
        useBoard.getState().remove([prev], { history: false })
      }
    }
  }, [editingId])

  // ---- laser fade ----
  useEffect(() => {
    if (!laser.length) return
    const id = requestAnimationFrame(() => setLaser((l) => l.filter((p) => performance.now() - p.t < 700)))
    return () => cancelAnimationFrame(id)
  }, [laser])

  const hitId = (target: EventTarget | null): ID | null => {
    const el = (target as Element | null)?.closest?.('[data-id], [data-frame-title]')
    if (!el) return null
    return el.getAttribute('data-id') ?? el.getAttribute('data-frame-title')
  }

  /** A side's connection point if the pointer is within ~18 screen px of it, else 'auto' */
  const snapAnchor = (id: ID, clientX: number, clientY: number): Anchor => {
    const o = useBoard.getState().doc?.objects[id]
    if (!o || o.kind === 'connector' || o.rotation) return 'auto'
    const p = toBoard({ clientX, clientY })
    const a = nearestAnchor(o, p)
    const q = anchorPoint(o, a)
    return Math.hypot(q.x - p.x, q.y - p.y) * useBoard.getState().vp.zoom <= 18 ? a : 'auto'
  }

  const targetAt = (clientX: number, clientY: number, exclude?: ID): { id: ID; anchor: Anchor } | null => {
    const t = rawTargetAt(clientX, clientY, exclude)
    return t ? { id: t.id, anchor: snapAnchor(t.id, clientX, clientY) } : null
  }

  const rawTargetAt = (clientX: number, clientY: number, exclude?: ID): { id: ID; anchor: Anchor } | null => {
    // A side's connection dot counts even when the pointer is just outside the item
    {
      const st = useBoard.getState()
      const p = toBoard({ clientX, clientY })
      const tol = 18 / st.vp.zoom
      for (let i = st.doc!.order.length - 1; i >= 0; i--) {
        const o = st.doc!.objects[st.doc!.order[i]]
        if (!o || o.id === exclude || o.rotation || o.kind === 'connector' || o.kind === 'pen' || o.kind === 'comment' || o.kind === 'frame') continue
        if (p.x < o.x - tol || p.x > o.x + o.w + tol || p.y < o.y - tol || p.y > o.y + o.h + tol) continue
        const q = anchorPoint(o, nearestAnchor(o, p))
        if (Math.hypot(q.x - p.x, q.y - p.y) <= tol) return { id: o.id, anchor: 'auto' }
      }
    }
    const els = document.elementsFromPoint(clientX, clientY)
    for (const el of els) {
      const id = hitId(el)
      if (!id || id === exclude) continue
      const o = useBoard.getState().doc?.objects[id]
      if (!o || o.kind === 'connector' || o.kind === 'pen' || o.kind === 'comment') continue
      return { id, anchor: 'auto' }
    }
    // Frames don't catch pointer events on their body; test geometrically
    const p = toBoard({ clientX, clientY })
    const d = useBoard.getState().doc!
    for (let i = d.order.length - 1; i >= 0; i--) {
      const o = d.objects[d.order[i]]
      if (o?.kind === 'frame' && o.id !== exclude && contains(o, { x: p.x, y: p.y, w: 0, h: 0 })) return { id: o.id, anchor: 'auto' }
    }
    return null
  }

  // ---- pointer handlers ----
  const onPointerDown = (e: React.PointerEvent) => {
    const s = useBoard.getState()
    if (!s.doc || (presenting && tool !== 'laser')) return
    const target = e.target as HTMLElement
    if (target.closest('[data-editor], [data-ui], button, input, textarea')) return
    if (e.button === 2) return // right-click: the context menu handles it
    stageRef.current!.setPointerCapture(e.pointerId)
    pointer.current = { x: e.clientX - stage.left, y: e.clientY - stage.top }
    const p = toBoard(e)

    if (readOnly || e.button === 1 || space.current || tool === 'hand' || (e.button === 0 && e.altKey && tool !== 'select')) {
      drag.current = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: s.vp.x, vy: s.vp.y }
      rerender()
      return
    }
    if (e.button !== 0) return
    if (s.editingId) s.setEditing(null)

    // Selection handles
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle')
    if (handle) {
      const objs = s.doc!.objects
      if (handle.startsWith('plus-')) {
        const id = s.selection[0]
        const anchor = handle.slice(5) as Exclude<Anchor, 'auto'>
        drag.current = { t: 'connect', from: { id, anchor, x: p.x, y: p.y }, b: p, target: null }
        ;(drag.current as { plus?: string }).plus = anchor
        return
      }
      if (handle === 'end-from' || handle === 'end-to') {
        s.beginGesture()
        drag.current = { t: 'end', id: s.selection[0], which: handle === 'end-from' ? 'from' : 'to', target: null }
        return
      }
      const ids = s.selection.filter((id) => objs[id] && !objs[id].locked)
      if (!ids.length) return
      s.beginGesture()
      const orig = new Map(ids.map((id) => [id, objs[id]]))
      if (handle === 'rot') {
        const o = objs[ids[0]]
        const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 }
        drag.current = { t: 'rotate', c, orig, a0: Math.atan2(p.y - c.y, p.x - c.x) }
      } else {
        const single = ids.length === 1 && objs[ids[0]].kind !== 'connector'
        const bounds = single ? { x: objs[ids[0]].x, y: objs[ids[0]].y, w: objs[ids[0]].w, h: objs[ids[0]].h } : boundsOf(ids, objs)!
        drag.current = { t: 'resize', h: handle as Handle, a: p, bounds, orig, single }
      }
      return
    }

    const id = hitId(target)
    const o = id ? s.doc!.objects[id] : null

    switch (tool) {
      case 'select': {
        if (voteMode && o && o.kind !== 'connector' && o.kind !== 'frame') {
          vote(o.id, e.altKey ? -1 : 1)
          return
        }
        if (o) {
          if (o.kind === 'comment') {
            s.select([o.id])
          }
          let sel = s.selection
          if (e.shiftKey) {
            s.select([o.id], true)
            sel = useBoard.getState().selection
            if (!sel.includes(o.id)) return
          } else if (!sel.includes(o.id)) {
            s.select([o.id])
            sel = useBoard.getState().selection
          }
          startMove(sel, p, e.altKey, o.id, e.shiftKey)
        } else {
          drag.current = { t: 'marquee', a: p, additive: e.shiftKey, base: e.shiftKey ? s.selection : [], moved: false, frameHit: null }
          if (!e.shiftKey) s.select([])
        }
        break
      }
      case 'sticky': case 'shape': case 'text': case 'frame': case 'card': case 'mind': case 'emoji': case 'comment':
        drag.current = { t: 'create', a: p, b: p }
        break
      case 'pen': case 'highlighter':
        drag.current = { t: 'draw', pts: [p.x, p.y] }
        break
      case 'eraser':
        s.beginGesture()
        drag.current = { t: 'erase' }
        eraseAt(p)
        break
      case 'connector': {
        const t = o && o.kind !== 'connector' && o.kind !== 'pen' && o.kind !== 'comment' ? { id: o.id, anchor: snapAnchor(o.id, e.clientX, e.clientY) } : targetAt(e.clientX, e.clientY)
        drag.current = { t: 'connect', from: t ? { id: t.id, anchor: t.anchor, x: p.x, y: p.y } : { x: p.x, y: p.y }, b: p, target: null }
        break
      }
      case 'laser':
        drag.current = { t: 'laser' }
        setLaser((l) => [...l, { x: pointer.current.x, y: pointer.current.y, t: performance.now() }])
        break
    }
    rerender()
  }

  const startMove = (sel: ID[], p: Pt, alt: boolean, clickId: ID | null, shift: boolean) => {
    const s = useBoard.getState()
    const objs = s.doc!.objects
    const ids = new Set(sel.filter((id) => objs[id] && !objs[id].locked))
    // Frames carry their contents; mind roots carry their tree
    for (const id of Array.from(ids)) {
      const o = objs[id]
      if (o.kind === 'frame') for (const c of frameChildren(o, objs, s.doc!.order)) if (!objs[c].locked) ids.add(c)
      if (o.kind === 'mind') for (const c of mindDescendants(objs, s.doc!.order, id)) ids.add(c)
    }
    const orig = new Map<ID, { x: number; y: number; from?: Pt; to?: Pt }>()
    for (const id of ids) {
      const o = objs[id]
      if (o.kind === 'connector') orig.set(id, { x: 0, y: 0, from: { x: o.from.x, y: o.from.y }, to: { x: o.to.x, y: o.to.y } })
      else orig.set(id, { x: o.x, y: o.y })
    }
    s.beginGesture()
    drag.current = { t: 'move', a: p, ids: [...ids], orig, bounds: boundsOf([...ids].filter((i) => objs[i].kind !== 'connector'), objs) ?? { x: p.x, y: p.y, w: 0, h: 0 }, moved: false, alt, clickId, shift }
  }

  const eraseAt = (p: Pt) => {
    const s = useBoard.getState()
    const tol = 8 / s.vp.zoom
    const kill: ID[] = []
    for (const id of s.doc!.order) {
      const o = s.doc!.objects[id]
      if (o?.kind === 'pen' && !o.locked && intersects(rotatedBounds(o), { x: p.x - tol - o.width, y: p.y - tol - o.width, w: (tol + o.width) * 2, h: (tol + o.width) * 2 }) && polylineHit(o.points, o.x, o.y, p, tol + o.width / 2)) kill.push(id)
    }
    if (kill.length) s.remove(kill)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX - stage.left, y: e.clientY - stage.top }
    setCursor(toBoard(e))
    const d = drag.current
    if (tool === 'laser') setLaser((l) => [...l.slice(-60), { x: pointer.current.x, y: pointer.current.y, t: performance.now() }])
    if (!d) {
      if (tool === 'connector') {
        const t = targetAt(e.clientX, e.clientY)
        setHoverTarget(t)
      }
      return
    }
    const s = useBoard.getState()
    const p = toBoard(e)
    switch (d.t) {
      case 'pan':
        s.setVp({ x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy })
        break
      case 'marquee': {
        if (!d.moved && Math.hypot(p.x - d.a.x, p.y - d.a.y) * s.vp.zoom < 3) return
        d.moved = true
        const r = normRect(d.a, p)
        ;(d as { r?: Rect }).r = r
        const hits: ID[] = []
        for (const id of s.doc!.order) {
          const o = s.doc!.objects[id]
          if (!o) continue
          if (o.kind === 'frame') {
            if (contains(r, o)) hits.push(id)
          } else if (o.kind === 'connector') {
            const b = connectorBounds(o, s.doc!.objects)
            if (contains(r, { x: b.x + 30, y: b.y + 30, w: b.w - 60, h: b.h - 60 })) hits.push(id)
          } else if (intersects(r, rotatedBounds(o))) hits.push(id)
        }
        s.select([...new Set([...d.base, ...hits])])
        rerender()
        break
      }
      case 'move': {
        let dx = p.x - d.a.x, dy = p.y - d.a.y
        if (!d.moved) {
          if (Math.hypot(dx, dy) * s.vp.zoom < 3) return
          d.moved = true
          if (d.alt) {
            // ⌥-drag duplicates: move the copies, originals stay put
            const objs = s.doc!.objects
            const src = s.doc!.order.filter((id) => d.ids.includes(id)).map((id) => objs[id])
            const clones = cloneObjects(src, 0, 0)
            s.add(clones, { history: false })
            const map = new Map(src.map((o, i) => [o.id, clones[i].id]))
            d.ids = d.ids.map((id) => map.get(id)!)
            d.orig = new Map([...d.orig].map(([k, v]) => [map.get(k)!, v]))
            useBoard.setState({ selection: d.ids })
          }
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        // Smart guides: snap edges and centres to nearby objects
        const g: { x?: number; y?: number }[] = []
        if (s.snap && !e.metaKey && !e.ctrlKey) {
          const r = { ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy }
          const moving = new Set(d.ids)
          const view = visibleRect(s.vp, 0)
          const tol = SNAP / s.vp.zoom
          let bx: { d: number; v: number } | null = null, by: { d: number; v: number } | null = null
          const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h]
          const pool = visibleRef.current.length ? visibleRef.current : s.doc!.order.map((id) => s.doc!.objects[id]).filter(Boolean)
          for (const o of pool) {
            if (moving.has(o.id)) continue
            if (!o || o.kind === 'connector' || o.kind === 'pen' || o.kind === 'comment') continue
            const ob = rotatedBounds(o)
            for (const tx of [ob.x, ob.x + ob.w / 2, ob.x + ob.w])
              for (const x of xs) {
                const dd = tx - x
                if (Math.abs(dd) <= tol && (!bx || Math.abs(dd) < Math.abs(bx.d))) bx = { d: dd, v: tx }
              }
            for (const ty of [ob.y, ob.y + ob.h / 2, ob.y + ob.h])
              for (const y of ys) {
                const dd = ty - y
                if (Math.abs(dd) <= tol && (!by || Math.abs(dd) < Math.abs(by.d))) by = { d: dd, v: ty }
              }
          }
          if (bx) { dx += bx.d; g.push({ x: bx.v }) }
          if (by) { dy += by.d; g.push({ y: by.v }) }
        }
        setGuides(g)
        const patches: Record<ID, Partial<BoardObj>> = {}
        for (const id of d.ids) {
          const o0 = d.orig.get(id)!
          const o = s.doc!.objects[id]
          if (o?.kind === 'connector') {
            patches[id] = { from: { ...o.from, x: o0.from!.x + dx, y: o0.from!.y + dy }, to: { ...o.to, x: o0.to!.x + dx, y: o0.to!.y + dy } } as Partial<BoardObj>
          } else patches[id] = { x: o0.x + dx, y: o0.y + dy }
        }
        moveNoRelayout(patches)
        break
      }
      case 'resize':
        doResize(d, p, e.shiftKey, e.altKey)
        break
      case 'rotate': {
        const ang = ((Math.atan2(p.y - d.c.y, p.x - d.c.x) - d.a0) * 180) / Math.PI
        const patches: Record<ID, Partial<BoardObj>> = {}
        for (const [id, o] of d.orig) {
          let r = (o.rotation + ang + 360) % 360
          if (e.shiftKey) r = Math.round(r / 15) * 15
          else for (const k of [0, 90, 180, 270, 360]) if (Math.abs(r - k) < 3) r = k % 360
          patches[id] = { rotation: r }
        }
        s.updateMany(patches)
        break
      }
      case 'create':
        d.b = p
        rerender()
        break
      case 'draw': {
        const n = d.pts.length
        const minD = 1.5 / s.vp.zoom
        if (Math.hypot(p.x - d.pts[n - 2], p.y - d.pts[n - 1]) >= minD) {
          d.pts.push(p.x, p.y)
          rerender()
        }
        break
      }
      case 'erase':
        eraseAt(p)
        break
      case 'connect': {
        d.b = p
        d.target = targetAt(e.clientX, e.clientY, d.from.id)
        setHoverTarget(d.target)
        rerender()
        break
      }
      case 'end': {
        const c = s.doc!.objects[d.id]
        if (c?.kind !== 'connector') return
        const other = d.which === 'from' ? c.to.id : c.from.id
        d.target = targetAt(e.clientX, e.clientY, other)
        setHoverTarget(d.target)
        const end: End = d.target ? { id: d.target.id, anchor: d.target.anchor, x: p.x, y: p.y } : { x: p.x, y: p.y }
        s.update(d.id, { [d.which]: end } as Partial<BoardObj>)
        break
      }
    }
  }

  /** Move without re-running mind layout every frame (layout runs once on drop) */
  const moveNoRelayout = (patches: Record<ID, Partial<BoardObj>>) => {
    useBoard.getState().updateMany(patches, { relayout: false })
  }

  const doResize = (d: Extract<Drag, { t: 'resize' }>, p: Pt, shift: boolean, alt: boolean) => {
    const s = useBoard.getState()
    const h = d.h
    const hx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0
    const hy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0
    let ddx = p.x - d.a.x, ddy = p.y - d.a.y
    const first = d.orig.values().next().value!
    const rot = d.single ? (first.rotation * Math.PI) / 180 : 0
    if (rot) {
      const c = Math.cos(-rot), sn = Math.sin(-rot)
      ;[ddx, ddy] = [ddx * c - ddy * sn, ddx * sn + ddy * c]
    }
    const B = d.bounds
    const keepAspect = shift || (d.single && ['sticky', 'image', 'emoji', 'mind'].includes(first.kind) && hx !== 0 && hy !== 0) || (!d.single && hx !== 0 && hy !== 0)
    let w = Math.max(8, B.w + ddx * hx * (alt ? 2 : 1))
    let hh = Math.max(8, B.h + ddy * hy * (alt ? 2 : 1))
    if (hx === 0) w = B.w
    if (hy === 0) hh = B.h
    if (keepAspect && hx !== 0 && hy !== 0) {
      const k = Math.max(w / B.w, hh / B.h)
      w = B.w * k
      hh = B.h * k
    }
    // Keep the opposite handle fixed (in the object's rotated frame)
    const fOld = { x: (-hx * B.w) / 2, y: (-hy * B.h) / 2 }
    const fNew = { x: (-hx * w) / 2, y: (-hy * hh) / 2 }
    if (alt) {
      fOld.x = fOld.y = fNew.x = fNew.y = 0
    }
    const cr = Math.cos(rot), sr = Math.sin(rot)
    const dfx = fOld.x - fNew.x, dfy = fOld.y - fNew.y
    const cx = B.x + B.w / 2 + dfx * cr - dfy * sr
    const cy = B.y + B.h / 2 + dfx * sr + dfy * cr
    const nb = { x: cx - w / 2, y: cy - hh / 2, w, h: hh }
    const patches: Record<ID, Partial<BoardObj>> = {}
    const sx = nb.w / B.w, sy = nb.h / B.h
    for (const [id, o] of d.orig) {
      if (o.kind === 'connector') {
        const map = (q: Pt) => ({ x: nb.x + (q.x - B.x) * sx, y: nb.y + (q.y - B.y) * sy })
        patches[id] = { from: { ...o.from, ...map(o.from) }, to: { ...o.to, ...map(o.to) } } as Partial<BoardObj>
        continue
      }
      const r = d.single ? nb : { x: nb.x + (o.x - B.x) * sx, y: nb.y + (o.y - B.y) * sy, w: o.w * sx, h: o.h * sy }
      const patch: Record<string, unknown> = { ...r }
      if (o.kind === 'pen') patch.points = o.points.map((v, i) => (i % 2 ? v * (r.h / o.h) : v * (r.w / o.w)))
      if (o.kind === 'text') {
        if (hx !== 0 && hy !== 0) {
          patch.fontSize = Math.max(6, Math.round((o.fontSize || 24) * (r.h / o.h) * 10) / 10)
        } else if (hx !== 0) {
          // Side handles re-wrap text at the new width
          patch.autoWidth = false
          patch.h = o.h
        }
      }
      if (o.kind === 'emoji') patch.h = patch.w
      patches[id] = patch as Partial<BoardObj>
    }
    s.updateMany(patches)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setGuides([])
    setHoverTarget(null)
    try { stageRef.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    const s = useBoard.getState()
    if (!d || !s.doc) return rerender()
    const p = toBoard(e)
    const finishTool = (created: BoardObj | null) => {
      if (!created) return
      if (!s.toolLocked) s.setTool('select')
      s.select([created.id])
      if (['sticky', 'shape', 'text', 'mind', 'card'].includes(created.kind)) s.setEditing(created.id)
    }
    switch (d.t) {
      case 'marquee':
        if (!d.moved) {
          // Clicking empty space inside a frame selects the frame
          const order = s.doc.order
          for (let i = order.length - 1; i >= 0; i--) {
            const o = s.doc.objects[order[i]]
            if (o?.kind === 'frame' && contains(o, { x: p.x, y: p.y, w: 0, h: 0 })) {
              s.select([o.id], d.additive)
              break
            }
          }
        }
        break
      case 'move': {
        s.endGesture()
        if (!d.moved && d.clickId && !d.shift) s.select([d.clickId])
        // Re-tidy any mind trees we touched
        const roots = new Set<ID>()
        for (const id of d.ids) {
          const r = mindRoot(s.doc.objects, id)
          if (r) roots.add(r.id)
        }
        for (const r of roots) s.relayoutMind(r)
        // Drop into a frame: bring the dropped items above it (frames are always behind)
        break
      }
      case 'resize': case 'rotate': case 'erase':
        s.endGesture()
        break
      case 'end': {
        s.endGesture()
        break
      }
      case 'create': {
        const r = normRect(d.a, d.b)
        const big = r.w * s.vp.zoom > 10 && r.h * s.vp.zoom > 10
        finishTool(createWithTool(tool, d.a, big && (tool === 'shape' || tool === 'frame' || tool === 'text' || tool === 'sticky') ? (tool === 'sticky' ? { ...r, h: r.w } : r) : undefined))
        break
      }
      case 'draw': {
        const pts = simplify(d.pts, 0.6 / s.vp.zoom)
        if (pts.length >= 2) {
          const hl = tool === 'highlighter'
          s.add(makePen(0, 0, pts, hl ? s.opts.highlighterColor : s.opts.penColor, hl ? Math.max(14, s.opts.penWidth * 4) : s.opts.penWidth, hl), { select: false })
        }
        break
      }
      case 'connect': {
        const plus = (d as { plus?: Exclude<Anchor, 'auto'> }).plus
        const dist = Math.hypot(d.b.x - (d.from.x ?? 0), d.b.y - (d.from.y ?? 0)) * s.vp.zoom
        if (plus && dist < 6) {
          quickCreate(d.from.id!, plus)
          break
        }
        if (dist < 6 && !d.target) break
        const to: End = d.target ? { id: d.target.id, anchor: d.target.anchor, x: d.b.x, y: d.b.y } : { x: d.b.x, y: d.b.y }
        if (d.target && d.target.id === d.from.id) break
        const c = makeConnector(d.from, to, s.opts.connectorStyle)
        s.add(c)
        if (!s.toolLocked && tool === 'connector') s.setTool('select')
        s.select([c.id])
        break
      }
    }
    rerender()
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useBoard.getState()
    if (tool !== 'select' || presenting || readOnly) return
    const target = e.target as HTMLElement
    if (target.closest('[data-editor], [data-ui], [data-card-status]')) return
    const id = hitId(target)
    const o = id ? s.doc!.objects[id] : null
    if (o && !o.locked) {
      if (['sticky', 'shape', 'text', 'card', 'mind', 'frame', 'connector'].includes(o.kind)) s.setEditing(o.id)
      if (o.kind === 'mind' && e.altKey) s.update(o.id, { collapsed: !o.collapsed })
      return
    }
    if (!o) {
      const p = toBoard(e)
      const t = createWithTool('text', p)
      if (t) s.setEditing(t.id)
    }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length) await addImageFiles(files, toBoard(e))
  }

  // ---- culling: one pass over the board per frame (visible + hidden mind children + branches) ----
  const view = visibleRect(vp, 300)
  const { visible, hidden, branches } = useMemo(
    () => cullBoard(doc.objects, doc.order, view, editingId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.order, doc.objects, Math.round((view.x * vp.zoom) / 150), Math.round((view.y * vp.zoom) / 150), Math.round(stage.w / 150), Math.round(stage.h / 150), Math.round(Math.log2(vp.zoom) * 4), editingId],
  )
  visibleRef.current = visible

  // Below ~22 % text is unreadable: draw items as plain blocks (Miro-style level of detail)
  const lod = vp.zoom < 0.22
  const frameZoom = vp.zoom
  const items = useMemo(
    () =>
      visible.map((o) =>
        hidden.has(o.id) ? null : o.kind === 'connector' ? (
          <ConnectorView key={o.id} o={o} a={o.from.id ? doc.objects[o.from.id] : undefined} b={o.to.id ? doc.objects[o.to.id] : undefined} editing={editingId === o.id} />
        ) : (
          <ObjectView key={o.id} o={o} editing={editingId === o.id} zoom={o.kind === 'frame' ? frameZoom : 1} lod={lod && editingId !== o.id} />
        ),
      ),
    // frame titles need the exact zoom; everything else only the LOD switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, hidden, editingId, lod, visible.some((o) => o.kind === 'frame') ? frameZoom : 0],
  )

  const d = drag.current
  const zoom = vp.zoom
  const bg = doc.background ?? 'dots'
  const gs = 24 * zoom * (zoom < 0.35 ? 4 : zoom < 0.7 ? 2 : 1)
  const bgStyle: React.CSSProperties =
    bg === 'dots'
      ? { backgroundImage: `radial-gradient(circle, var(--canvas-dot) ${Math.max(0.8, Math.min(1.6, zoom * 1.3))}px, transparent 0)`, backgroundSize: `${gs}px ${gs}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }
      : bg === 'grid'
        ? { backgroundImage: `linear-gradient(var(--canvas-dot) 1px, transparent 0), linear-gradient(90deg, var(--canvas-dot) 1px, transparent 0)`, backgroundSize: `${gs}px ${gs}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }
        : bg === 'lines'
          ? { backgroundImage: `linear-gradient(var(--canvas-dot) 1px, transparent 0)`, backgroundSize: `${gs}px ${gs}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }
          : {}

  const cursor =
    d?.t === 'pan' || spaceDown ? (d?.t === 'pan' ? 'grabbing' : 'grab')
      : tool === 'hand' ? 'grab'
        : tool === 'select' ? (voteMode ? 'copy' : 'default')
          : tool === 'eraser' ? 'cell'
            : tool === 'text' ? 'text'
              : tool === 'laser' ? 'none'
                : 'crosshair'

  const draftRect = d?.t === 'create' ? normRect(d.a, d.b) : null
  const marquee = d?.t === 'marquee' ? (d as { r?: Rect }).r : null
  const connectDraft = d?.t === 'connect' ? d : null

  return (
    <BoardContextMenu>
    <div
      ref={stageRef}
      className={'absolute inset-0 touch-none overflow-hidden bg-canvas ' + (tool === 'select' && !d ? 'jiro-hover' : '')}
      style={{ ...bgStyle, cursor }}
      data-stage
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setCursor(null)}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        className="jiro-world absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${zoom})`, ['--z' as string]: zoom }}
      >
        {branches.length > 0 && (
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
            {branches.filter((b) => !hidden.has(b.o.id)).map((b) => <MindBranch key={b.o.id} o={b.o} parent={b.parent} />)}
          </svg>
        )}
        {items}
        {/* drafts */}
        {d?.t === 'draw' && (
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
            <path
              d={smoothPath(d.pts)}
              fill="none"
              stroke={tool === 'highlighter' ? opts.highlighterColor : opts.penColor}
              strokeWidth={tool === 'highlighter' ? Math.max(14, opts.penWidth * 4) : opts.penWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={tool === 'highlighter' ? 0.45 : 1}
            />
          </svg>
        )}
        {connectDraft && (
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
            <ConnectorDraft from={connectDraft.from} b={connectDraft.b} target={connectDraft.target} />
          </svg>
        )}
        {draftRect && draftRect.w * zoom > 10 && (
          <div className="pointer-events-none absolute rounded-sm border-[calc(1.5px/var(--z))] border-dashed border-selection bg-selection/5" style={{ left: draftRect.x, top: draftRect.y, width: draftRect.w, height: tool === 'sticky' ? draftRect.w : draftRect.h }} />
        )}
        {hoverTarget && <TargetHighlight id={hoverTarget.id} anchor={hoverTarget.anchor} />}
        {guides.map((g, i) =>
          g.x !== undefined ? (
            <div key={i} className="pointer-events-none absolute bg-[#ff3b7f]" style={{ left: g.x, top: view.y, width: 1 / zoom, height: view.h }} />
          ) : (
            <div key={i} className="pointer-events-none absolute bg-[#ff3b7f]" style={{ top: g.y, left: view.x, height: 1 / zoom, width: view.w }} />
          ),
        )}
      </div>

      {!presenting && !readOnly && <SelectionOverlay />}
      <LiveCursors />

      {marquee && (
        <div
          className="pointer-events-none absolute border border-selection bg-selection/8"
          style={{ left: marquee.x * zoom + vp.x, top: marquee.y * zoom + vp.y, width: marquee.w * zoom, height: marquee.h * zoom }}
          data-marquee
        />
      )}
      {laser.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 size-full">
          <polyline points={laser.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ff3355" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} style={{ filter: 'drop-shadow(0 0 6px #ff3355)' }} />
          <circle cx={laser[laser.length - 1].x} cy={laser[laser.length - 1].y} r={6} fill="#ff3355" />
        </svg>
      )}
    </div>
    </BoardContextMenu>
  )
}

function ConnectorDraft({ from, b, target }: { from: End; b: Pt; target: { id: ID; anchor: Anchor } | null }) {
  const objects = useBoard((s) => s.doc!.objects)
  const style = useBoard((s) => s.opts.connectorStyle)
  const c = makeConnector(from, target ? { id: target.id, anchor: target.anchor, x: b.x, y: b.y } : { x: b.x, y: b.y }, style)
  c.id = '__draft'
  return <ConnectorView o={c} a={from.id ? objects[from.id] : undefined} b={target ? objects[target.id] : undefined} editing={false} />
}

/** Outline of the item a line will attach to, with its four connection points (the snapped one filled) */
function TargetHighlight({ id, anchor }: { id: ID; anchor: Anchor }) {
  const o = useBoard((s) => s.doc!.objects[id])
  if (!o) return null
  const b = rotatedBounds(o)
  return (
    <>
      <div className="pointer-events-none absolute rounded-md border-[calc(2px/var(--z))] border-selection" style={{ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8 }} />
      {!o.rotation &&
        (['top', 'right', 'bottom', 'left'] as const).map((a) => {
          const q = anchorPoint(o, a)
          const on = a === anchor
          return (
            <div
              key={a}
              data-anchor-dot={a}
              data-active={on || undefined}
              className={'pointer-events-none absolute rounded-full border-selection ' + (on ? 'bg-selection' : 'bg-white')}
              style={{ left: q.x, top: q.y, width: `calc(${on ? 14 : 10}px / var(--z))`, height: `calc(${on ? 14 : 10}px / var(--z))`, borderWidth: 'calc(2px / var(--z))', transform: 'translate(-50%, -50%)' }}
            />
          )
        })}
    </>
  )
}
