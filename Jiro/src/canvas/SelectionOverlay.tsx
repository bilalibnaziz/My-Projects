import { Lock, RotateCw } from 'lucide-react'
import { resolveEnds, rotatedBounds } from '@/board/geometry'
import { boundsOf, useBoard } from '@/board/store'
import type { BoardObj } from '@/board/types'

const HANDLES = [
  ['nw', -1, -1, 'nwse-resize'], ['n', 0, -1, 'ns-resize'], ['ne', 1, -1, 'nesw-resize'], ['e', 1, 0, 'ew-resize'],
  ['se', 1, 1, 'nwse-resize'], ['s', 0, 1, 'ns-resize'], ['sw', -1, 1, 'nesw-resize'], ['w', -1, 0, 'ew-resize'],
] as const

const PLUS_KINDS = new Set(['sticky', 'shape', 'card', 'mind'])

export function SelectionOverlay() {
  const doc = useBoard((s) => s.doc)
  const sel = useBoard((s) => s.selection)
  const vp = useBoard((s) => s.vp)
  const editing = useBoard((s) => s.editingId)
  const tool = useBoard((s) => s.tool)
  if (!doc || !sel.length || tool !== 'select') return null
  const objs = sel.map((id) => doc.objects[id]).filter(Boolean) as BoardObj[]
  if (!objs.length) return null
  const S = (x: number, y: number) => ({ x: x * vp.zoom + vp.x, y: y * vp.zoom + vp.y })

  // A single connector: endpoint handles only
  if (objs.length === 1 && objs[0].kind === 'connector') {
    const [A, B] = resolveEnds(objs[0], doc.objects)
    const a = S(A.p.x, A.p.y), b = S(B.p.x, B.p.y)
    return (
      <div className="pointer-events-none absolute inset-0" data-selection>
        {[['end-from', a], ['end-to', b]].map(([h, p]) => (
          <div
            key={h as string}
            data-handle={h as string}
            className="pointer-events-auto absolute size-3.5 -translate-1/2 cursor-move rounded-full border-2 border-selection bg-white shadow"
            style={{ left: (p as { x: number }).x, top: (p as { y: number }).y }}
          />
        ))}
      </div>
    )
  }

  const single = objs.length === 1 ? objs[0] : null
  const locked = objs.every((o) => o.locked)
  const rot = single?.rotation ?? 0
  const box = single ? { x: single.x, y: single.y, w: single.w, h: single.h } : boundsOf(sel, doc.objects)!
  const tl = S(box.x, box.y)
  const w = box.w * vp.zoom, h = box.h * vp.zoom
  const cx = tl.x + w / 2, cy = tl.y + h / 2
  const showHandles = !locked && editing !== single?.id && !(single?.kind === 'comment') && !(single?.kind === 'mind' && single.parent)
  const tiny = w < 28 || h < 28
  const resizable = showHandles && !(single?.kind === 'mind')

  return (
    <div className="pointer-events-none absolute inset-0" data-selection>
      {/* outlines of each member in a multi-selection */}
      {objs.length > 1 &&
        objs.map((o) => {
          if (o.kind === 'connector') return null
          const b = rotatedBounds(o)
          const p = S(b.x, b.y)
          return <div key={o.id} className="absolute border border-selection/60" style={{ left: p.x, top: p.y, width: b.w * vp.zoom, height: b.h * vp.zoom }} />
        })}
      <div
        className="absolute"
        style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: rot ? `rotate(${rot}deg)` : undefined }}
      >
        <div className={'absolute -inset-px border-[1.5px] ' + (locked ? 'border-dashed border-muted-foreground' : 'border-selection')} />
        {resizable &&
          HANDLES.filter(([, hx, hy]) => !tiny || (hx !== 0 && hy !== 0)).filter(([, hx, hy]) => hx !== 0 && hy !== 0 || !(single && ['sticky', 'emoji', 'image'].includes(single.kind))).map(([id, hx, hy, cur]) => (
            <div
              key={id}
              data-handle={id}
              className={'pointer-events-auto absolute -translate-1/2 border-[1.5px] border-selection bg-white shadow-sm ' + (hx !== 0 && hy !== 0 ? 'size-[11px] rounded-full' : hx === 0 ? 'h-[7px] w-5 rounded-full' : 'h-5 w-[7px] rounded-full')}
              style={{ left: ((hx + 1) / 2) * w, top: ((hy + 1) / 2) * h, cursor: cur }}
            />
          ))}
        {showHandles && single && single.kind !== 'frame' && single.kind !== 'mind' && single.kind !== 'emoji' && (
          <div
            data-handle="rot"
            title="Rotate (⇧ snaps to 15°)"
            className="pointer-events-auto absolute grid size-6 -translate-x-1/2 cursor-grab place-items-center rounded-full border bg-white text-[#1a1a2e] shadow"
            style={{ left: w / 2, top: -34 }}
          >
            <RotateCw className="pointer-events-none size-3.5" />
          </div>
        )}
        {!locked && editing !== single?.id && single && PLUS_KINDS.has(single.kind) && !rot &&
          (['top', 'right', 'bottom', 'left'] as const)
            .filter((a) => single.kind !== 'mind' || a === 'right' || (single.parent && a === 'bottom'))
            .map((a) => (
              <div
                key={a}
                data-handle={'plus-' + a}
                title={single.kind === 'mind' ? (a === 'right' ? 'Add child (Tab)' : 'Add sibling (Enter)') : 'Click to add a connected copy, drag to connect'}
                className="group pointer-events-auto absolute grid size-6 -translate-1/2 cursor-pointer place-items-center"
                style={{ left: a === 'left' ? -26 : a === 'right' ? w + 26 : w / 2, top: a === 'top' ? -26 : a === 'bottom' ? h + 26 : h / 2 }}
              >
                <div className="pointer-events-none grid size-[18px] place-items-center rounded-full bg-selection text-[14px] leading-none font-bold text-white opacity-70 shadow transition group-hover:scale-125 group-hover:opacity-100">+</div>
              </div>
            ))}
      </div>
      {locked && (
        <div className="absolute grid size-6 place-items-center rounded-md bg-card text-muted-foreground shadow" style={{ left: tl.x + w - 12, top: tl.y - 12 }}>
          <Lock className="size-3.5" />
        </div>
      )}
      {objs.length > 1 && (
        <div className="absolute rounded bg-selection px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ left: tl.x, top: tl.y + h + 8 }}>
          {objs.length} selected
        </div>
      )}
    </div>
  )
}
