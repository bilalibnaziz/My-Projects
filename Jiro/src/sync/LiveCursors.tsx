import { memo, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { rotatedBounds } from '@/board/geometry'
import { useBoard } from '@/board/store'
import type { BoardObj, ID } from '@/board/types'
import { type Peer, useLive } from './live'

/**
 * Other people in the live session: their cursors (with names), what they have selected, and which
 * item they're typing in. Screen-space overlay; cursor moves are eased so 30 Hz updates look smooth.
 */
export function LiveCursors() {
  const peers = useLive(useShallow((s) => s.peers))
  const vp = useBoard((s) => s.vp)
  const objects = useBoard((s) => s.doc?.objects)
  if (!peers.length || !objects) return null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-live-layer>
      {peers.map((p) => (
        <PeerMarks key={p.clientId} p={p} vp={vp} objects={objects} />
      ))}
    </div>
  )
}

interface PeerMarksProps {
  p: Peer
  vp: { x: number; y: number; zoom: number }
  objects: Record<ID, BoardObj>
}

function sameIdList(a?: ID[], b?: ID[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/**
 * Memo comparison for one peer's marks. A peer's marks only depend on their cursor, the items
 * they select / are editing, and those items' current shape — not on the rest of the board, and
 * not on their view or summon (those never render here). So a remote edit to any other object
 * leaves this peer's marks untouched, instead of re-rendering every peer's marks on every frame
 * of a busy session (30 peers × 10 edits/s was re-rendering all of them each frame).
 */
export function samePeerMarks(prev: PeerMarksProps, next: PeerMarksProps): boolean {
  if (prev.vp !== next.vp) return false
  const a = prev.p, b = next.p
  if (a.clientId !== b.clientId) return false
  if (a.user.name !== b.user.name || a.user.color !== b.user.color) return false
  if ((a.cursor?.x ?? null) !== (b.cursor?.x ?? null) || (a.cursor?.y ?? null) !== (b.cursor?.y ?? null)) return false
  if (a.editing !== b.editing) return false
  if (!sameIdList(a.sel, b.sel)) return false
  const ids = new Set<ID>([...(a.sel ?? []), ...(b.sel ?? []), ...(a.editing ? [a.editing] : []), ...(b.editing ? [b.editing] : [])])
  for (const id of ids) if (prev.objects[id] !== next.objects[id]) return false
  return true
}

const PeerMarks = memo(function PeerMarks({ p, vp, objects }: PeerMarksProps) {
  const color = p.user.color || '#4262ff'
  const sel = (p.sel ?? []).filter((id) => objects[id])
  const editing = p.editing && objects[p.editing] ? p.editing : null
  return (
    <>
      {sel.map((id) => {
        const b = rotatedBounds(objects[id])
        return (
          <div
            key={id}
            data-peer-selection={p.user.name}
            className="absolute rounded-[3px]"
            style={{ left: b.x * vp.zoom + vp.x - 3, top: b.y * vp.zoom + vp.y - 3, width: b.w * vp.zoom + 6, height: b.h * vp.zoom + 6, border: `2px solid ${color}` }}
          />
        )
      })}
      {editing && (() => {
        const b = rotatedBounds(objects[editing])
        return (
          <div
            data-peer-editing={p.user.name}
            className="absolute rounded-[4px]"
            style={{ left: b.x * vp.zoom + vp.x - 5, top: b.y * vp.zoom + vp.y - 5, width: b.w * vp.zoom + 10, height: b.h * vp.zoom + 10, border: `2px dashed ${color}` }}
          >
            <span className="absolute -top-5 left-0 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white" style={{ background: color }}>
              {p.user.name} is typing…
            </span>
          </div>
        )
      })()}
      {p.cursor && <Cursor p={p} sx={p.cursor.x * vp.zoom + vp.x} sy={p.cursor.y * vp.zoom + vp.y} color={color} />}
    </>
  )
}, samePeerMarks)

type ActiveCursor = {
  el: HTMLDivElement
  pos: { x: number; y: number }
  target: { x: number; y: number }
}
const activeCursors = new Set<ActiveCursor>()
let sharedRaf = 0

function stepCursors() {
  sharedRaf = 0
  for (const c of activeCursors) {
    const cur = c.pos
    const t = c.target
    const dx = t.x - cur.x, dy = t.y - cur.y
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      c.pos.x = t.x
      c.pos.y = t.y
      activeCursors.delete(c)
    } else {
      c.pos.x = cur.x + dx * 0.5
      c.pos.y = cur.y + dy * 0.5
    }
    c.el.style.setProperty('transform', `translate(${c.pos.x}px, ${c.pos.y}px)`)
  }
  if (activeCursors.size > 0) {
    sharedRaf = requestAnimationFrame(stepCursors)
  }
}

/**
 * A cursor that glides to each new position (interpolated between network updates).
 *
 * The glide runs entirely outside React on a shared rAF loop: 30 cursors no longer cost 30
 * separate animation-frame callbacks and 30 React re-renders every frame. Only the target
 * position is a React prop (`data-x` / `data-y` — what the realtime e2e checks read), and it
 * updates on render exactly as before. The transform React paints on first render is kept
 * fixed afterwards, so a re-render never snaps the gliding cursor back to its target.
 */
function Cursor({ p, sx, sy, color }: { p: Peer; sx: number; sy: number; color: string }) {
  const el = useRef<HTMLDivElement | null>(null)
  const painted = useRef({ x: sx, y: sy })
  const cursorRef = useRef<ActiveCursor | null>(null)

  useEffect(() => {
    if (!cursorRef.current && el.current) {
      cursorRef.current = { el: el.current, pos: { x: sx, y: sy }, target: { x: sx, y: sy } }
    }
    if (cursorRef.current) {
      cursorRef.current.target.x = sx
      cursorRef.current.target.y = sy
      activeCursors.add(cursorRef.current)
      if (!sharedRaf) sharedRaf = requestAnimationFrame(stepCursors)
    }
  }, [sx, sy])

  useEffect(() => {
    return () => {
      if (cursorRef.current) {
        activeCursors.delete(cursorRef.current)
        cursorRef.current = null
      }
    }
  }, [])

  return (
    <div ref={el} className="absolute top-0 left-0" style={{ transform: `translate(${painted.current.x}px, ${painted.current.y}px)` }} data-peer-cursor={p.user.name} data-x={Math.round(sx)} data-y={Math.round(sy)}>
      <svg width="18" height="22" viewBox="0 0 18 22" className="drop-shadow-sm" aria-hidden>
        <path d="M1 1 L1 17 L5.5 13 L8.5 20.5 L11.5 19.2 L8.6 12 L15 12 Z" fill={color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="absolute top-[18px] left-3 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-sm" style={{ background: color }}>
        {p.user.name}
      </span>
    </div>
  )
}
