import { memo } from 'react'
import { CalendarDays, Check, Flag, MessageCircle } from 'lucide-react'
import { AvatarStack } from '@/team/Avatar'
import { assigneesOf, dueState, setStatus } from '@/team/collab'
import { mindAddChild, mindAddSibling } from '@/board/actions'
import { inkFor, makeSticky } from '@/board/factory'
import { connectorPath, smoothPath } from '@/board/geometry'
import { mindWidthFor } from '@/board/mindmap'
import { shapePath, shapeTextBox } from '@/board/shapes'
import { useBoard } from '@/board/store'
import { FONT_STACK, LINE_HEIGHT, fitFontSize, measureTextBlock } from '@/board/text'
import type { BoardObj, Cap, CardObj, ConnectorObj, Dash, ID, MindObj, TextStyle } from '@/board/types'
import { EditableText } from './EditableText'

const upd = (id: ID, patch: Partial<BoardObj>) => useBoard.getState().update(id, patch)

export const dashArray = (d: Dash, w: number) => (d === 'dashed' ? `${w * 4} ${w * 3}` : d === 'dotted' ? `0.1 ${w * 2.5}` : undefined)

function textCss(o: TextStyle, size: number): React.CSSProperties {
  return {
    fontSize: size,
    lineHeight: LINE_HEIGHT,
    color: o.color,
    textAlign: o.align,
    fontWeight: o.bold ? 700 : 400,
    fontStyle: o.italic ? 'italic' : undefined,
    textDecoration: [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    fontFamily: FONT_STACK[o.font ?? 'sans'],
    width: '100%',
  }
}

const vAlign = (v: TextStyle['valign']) => (v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center')

function Votes({ n }: { n?: number }) {
  if (!n) return null
  return (
    <div className="absolute -top-3 -right-3 z-10 grid size-8 place-items-center rounded-full bg-[#4262ff] text-sm font-bold text-white shadow-md ring-2 ring-white" data-votes={n}>
      {n}
    </div>
  )
}

/** Sticky: Tab makes the next note to the right, ⌘↵ the next one below */
function stickyKeys(id: ID) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      const s = useBoard.getState()
      const o = s.doc?.objects[id]
      if (o?.kind !== 'sticky') return true
      const below = e.key === 'Enter'
      const n = { ...makeSticky(o.x + (below ? 0 : o.w + 20), o.y + (below ? o.h + 20 : 0), o.fill), w: o.w, h: o.h, font: o.font }
      s.setEditing(null)
      s.add(n)
      s.setEditing(n.id)
      return true
    }
  }
}

function Sticky({ o, editing }: { o: Extract<BoardObj, { kind: 'sticky' }>; editing: boolean }) {
  const pad = Math.max(10, o.w * 0.08)
  const size = o.fontSize || fitFontSize(o.text, o.w - pad * 2, o.h - pad * 2, o.font, o.bold, 48)
  return (
    <div className="absolute inset-0 flex" style={{ background: o.fill, padding: pad, alignItems: vAlign(o.valign), boxShadow: '0 1px 1px rgba(0,0,0,.06), 0 6px 14px -6px rgba(0,0,0,.25)' }}>
      <EditableText value={o.text} editing={editing} onChange={(text) => upd(o.id, { text })} onKey={stickyKeys(o.id)} style={textCss(o, size)} />
      {o.author && <div className="absolute right-2 bottom-1 text-[11px] opacity-50" style={{ color: o.color }}>{o.author}</div>}
    </div>
  )
}

function Shape({ o, editing }: { o: Extract<BoardObj, { kind: 'shape' }>; editing: boolean }) {
  const tb = shapeTextBox(o.shape, o.w, o.h)
  const size = o.fontSize || fitFontSize(o.text, tb.w, tb.h, o.font, o.bold, 40)
  const sw = o.strokeWidth
  return (
    <>
      <svg className="absolute inset-0 overflow-visible" width={o.w} height={o.h}>
        <path
          d={shapePath(o.shape, o.w, o.h)}
          fill={o.fill === 'transparent' ? 'none' : o.fill}
          stroke={sw ? o.stroke : 'none'}
          strokeWidth={sw}
          strokeDasharray={dashArray(o.dash, sw)}
          strokeLinejoin="round"
          strokeLinecap="round"
          pointerEvents={o.fill === 'transparent' ? 'visibleStroke' : 'visiblePainted'}
          data-hit
        />
      </svg>
      <div className="absolute flex" style={{ left: tb.x, top: tb.y, width: tb.w, height: tb.h, alignItems: vAlign(o.valign), pointerEvents: editing ? 'auto' : 'none' }}>
        <EditableText value={o.text} editing={editing} onChange={(text) => upd(o.id, { text })} style={textCss(o, size)} />
      </div>
    </>
  )
}

function TextView({ o, editing }: { o: Extract<BoardObj, { kind: 'text' }>; editing: boolean }) {
  const onChange = (text: string) => {
    const patch: Partial<BoardObj> = { text }
    if (o.autoWidth) {
      const m = measureTextBlock(text, o.fontSize || 24, o.font, o.bold)
      Object.assign(patch, { w: Math.max(40, m.w), h: m.h })
    } else {
      const m = measureTextBlock(text, o.fontSize || 24, o.font, o.bold)
      Object.assign(patch, { h: Math.max(o.h, m.h) })
    }
    upd(o.id, patch)
  }
  return (
    <div className="absolute inset-0" style={{ background: o.highlight }}>
      <EditableText
        value={o.text}
        editing={editing}
        onChange={onChange}
        placeholder="Type something"
        style={{ ...textCss(o, o.fontSize || 24), whiteSpace: o.autoWidth ? 'pre' : 'pre-wrap', minHeight: '1em' }}
      />
    </div>
  )
}

function Frame({ o, editing, zoom }: { o: Extract<BoardObj, { kind: 'frame' }>; editing: boolean; zoom: number }) {
  const s = 1 / zoom
  return (
    <>
      <div className="absolute inset-0" style={{ background: o.fill, boxShadow: `0 0 0 ${s}px rgba(26,26,46,.14), 0 ${2 * s}px ${12 * s}px rgba(26,26,46,.06)` }} />
      <div
        className="pointer-events-auto absolute left-0 flex max-w-full origin-bottom-left cursor-default items-center gap-1 font-medium whitespace-nowrap text-[#5c5c70] dark:text-[#b4b4c4]"
        style={{ bottom: '100%', transform: `scale(${s})`, fontSize: 14, paddingBottom: 6, maxWidth: o.w * zoom }}
        data-frame-title={o.id}
      >
        <EditableText value={o.title} editing={editing} onChange={(title) => upd(o.id, { title })} onKey={(e) => { if (e.key === 'Enter') { e.preventDefault(); useBoard.getState().setEditing(null); return true } }} className="truncate" />
      </div>
    </>
  )
}

function Card({ o, editing }: { o: CardObj; editing: boolean }) {
  const status = o.status ?? 'todo'
  return (
    <div className="absolute inset-0 flex overflow-hidden rounded-lg bg-white text-[#1a1a2e] shadow-[0_1px_2px_rgba(0,0,0,.08),0_4px_16px_-6px_rgba(0,0,0,.18)] ring-1 ring-black/5">
      <div className="w-2 shrink-0" style={{ background: o.tag }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <EditableText
          value={o.title}
          editing={editing}
          onChange={(title) => upd(o.id, { title })}
          onKey={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); useBoard.getState().setEditing(null); return true } }}
          className={'text-[17px] leading-snug font-semibold ' + (status === 'done' ? 'line-through opacity-60' : '')}
        />
        <EditableText value={o.body} editing={editing} autoFocus={false} onChange={(body) => upd(o.id, { body })} placeholder={editing ? 'Add a description' : ''} className="line-clamp-3 text-[13px] leading-snug text-[#5c5c70]" />
        <div className="mt-auto flex items-center gap-2 text-[12px] text-[#5c5c70]">
          <button
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
            style={{ background: status === 'done' ? '#d3f9d8' : status === 'doing' ? '#fff3bf' : '#eef0f4' }}
            data-card-status
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStatus(o.id, status === 'todo' ? 'doing' : status === 'doing' ? 'done' : 'todo')}
            aria-label={`Status: ${status}. Click to advance`}
          >
            {status === 'done' && <Check className="size-3" />}
            {status === 'todo' ? 'To do' : status === 'doing' ? 'In progress' : 'Done'}
          </button>
          {o.priority === 'high' && <span className="inline-flex items-center gap-0.5 font-semibold text-red-600" title="High priority"><Flag className="size-3 fill-current" />High</span>}
          {o.due && (() => {
            const ds = dueState(o)
            return (
              <span className={'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ' + (ds === 'overdue' ? 'bg-red-100 text-red-700' : ds === 'today' ? 'bg-amber-100 text-amber-800' : '')} data-card-due={ds}>
                <CalendarDays className="size-3" />
                {ds === 'today' ? 'Today' : new Date(o.due + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )
          })()}
          <span className="ml-auto">
            <AvatarStack people={assigneesOf(o)} size={24} />
          </span>
        </div>
      </div>
    </div>
  )
}

function Mind({ o, editing }: { o: MindObj; editing: boolean }) {
  const root = !o.parent
  const onChange = (text: string) => {
    const lines = Math.max(1, text.split('\n').length)
    upd(o.id, { text, w: mindWidthFor(text, root), h: (root ? 56 : 40) + (lines - 1) * (root ? 22 : 19) })
  }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      useBoard.getState().setEditing(null)
      mindAddChild(o.id)
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      useBoard.getState().setEditing(null)
      if (o.parent) mindAddSibling(o.id)
      return true
    }
  }
  return (
    <div
      className="absolute inset-0 flex items-center justify-center rounded-full px-4 text-center"
      style={{
        background: root ? o.color : 'var(--card)',
        color: root ? inkFor(o.color) : 'var(--card-foreground)',
        border: `2.5px solid ${o.color}`,
        fontSize: root ? 18 : 15,
        fontWeight: root ? 700 : 500,
        lineHeight: 1.25,
      }}
    >
      <EditableText value={o.text} editing={editing} onChange={onChange} onKey={keys} placeholder="Idea" className="w-full" />
      {o.collapsed && <div className="absolute -right-3 grid size-6 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: o.color }}>+</div>}
    </div>
  )
}

function capPath(cap: Cap, p: { x: number; y: number }, ang: number, w: number, color: string) {
  if (cap === 'none') return null
  const s = 5 + w * 2.2
  const ca = Math.cos(ang), sa = Math.sin(ang)
  const rot = (dx: number, dy: number) => `${p.x + dx * ca - dy * sa},${p.y + dx * sa + dy * ca}`
  if (cap === 'arrow') return <path d={`M${rot(-s, -s * 0.6)} L${rot(0, 0)} L${rot(-s, s * 0.6)}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
  if (cap === 'triangle') return <path d={`M${rot(-s, -s * 0.55)} L${rot(0, 0)} L${rot(-s, s * 0.55)} Z`} fill={color} stroke={color} strokeWidth={w} strokeLinejoin="round" />
  if (cap === 'dot') return <circle cx={p.x} cy={p.y} r={2 + w * 1.3} fill={color} />
  return <path d={`M${rot(0, -s * 0.6)} L${rot(0, s * 0.6)}`} stroke={color} strokeWidth={w} strokeLinecap="round" />
}

export const ConnectorView = memo(function ConnectorView({ o, a, b, editing }: { o: ConnectorObj; a?: BoardObj; b?: BoardObj; editing: boolean }) {
  const objs: Record<ID, BoardObj> = {}
  if (a) objs[a.id] = a
  if (b) objs[b.id] = b
  const p = connectorPath(o, objs)
  const w = o.strokeWidth
  const label = o.label
  const lw = Math.max(40, label.length * 8 + 20)
  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} data-id={o.id} data-kind="connector">
      <path d={p.d} fill="none" stroke="transparent" strokeWidth={Math.max(14, w + 12)} pointerEvents="stroke" className="cursor-pointer" />
      <path d={p.d} fill="none" stroke={o.stroke} strokeWidth={w} strokeDasharray={dashArray(o.dash, w)} strokeLinecap="round" strokeLinejoin="round" />
      {capPath(o.startCap, p.a, p.angA, w, o.stroke)}
      {capPath(o.endCap, p.b, p.angB, w, o.stroke)}
      {(label || editing) && (
        <foreignObject x={p.mid.x - (editing ? 90 : lw / 2)} y={p.mid.y - 16} width={editing ? 180 : lw} height={32} pointerEvents="all" style={{ overflow: 'visible' }}>
          <div className="flex h-full items-center justify-center">
            <EditableText
              value={label}
              editing={editing}
              onChange={(l) => upd(o.id, { label: l })}
              onKey={(e) => { if (e.key === 'Enter') { e.preventDefault(); useBoard.getState().setEditing(null); return true } }}
              placeholder="Label"
              className="rounded-md bg-[var(--canvas)] px-1.5 text-center text-[14px] whitespace-nowrap text-foreground"
            />
          </div>
        </foreignObject>
      )}
    </svg>
  )
})

/** Branch from a mind node's parent to it */
export function MindBranch({ o, parent }: { o: MindObj; parent: MindObj }) {
  const right = o.x + o.w / 2 >= parent.x + parent.w / 2
  const x0 = right ? parent.x + parent.w : parent.x
  const y0 = parent.y + parent.h / 2
  const x1 = right ? o.x : o.x + o.w
  const y1 = o.y + o.h / 2
  const mx = (x0 + x1) / 2
  return <path d={`M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`} fill="none" stroke={o.color} strokeWidth={parent.parent ? 2.5 : 3.5} strokeLinecap="round" />
}

/** Zoomed-far-out stand-in: a flat block in the item's colour (no text, editors or shadows) */
function LodBlock({ o }: { o: BoardObj }) {
  const bg =
    o.kind === 'sticky' ? o.fill
      : o.kind === 'shape' ? (o.fill === 'transparent' ? 'transparent' : o.fill)
        : o.kind === 'card' ? '#ffffff'
          : o.kind === 'mind' ? (o.parent ? '#ffffff' : o.color)
            : o.kind === 'text' ? 'rgba(120,120,135,.35)'
              : null
  if (!bg) return null
  const border = o.kind === 'shape' ? `${Math.max(2, o.strokeWidth)}px solid ${o.stroke}` : o.kind === 'card' ? `0 0 0 0` : o.kind === 'mind' ? `3px solid ${o.color}` : undefined
  return (
    <div
      className="absolute"
      data-id={o.id}
      data-kind={o.kind}
      data-lod
      style={{
        left: o.x, top: o.kind === 'text' ? o.y + o.h * 0.25 : o.y, width: o.w, height: o.kind === 'text' ? o.h * 0.5 : o.h, background: bg,
        border, borderLeft: o.kind === 'card' ? `10px solid ${o.tag}` : undefined, borderRadius: o.kind === 'mind' ? o.h / 2 : o.kind === 'shape' && o.shape === 'ellipse' ? '50%' : undefined,
        transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
      }}
    />
  )
}

export const ObjectView = memo(function ObjectView({ o, editing, zoom, lod = false }: { o: BoardObj; editing: boolean; zoom: number; lod?: boolean }) {
  if (o.kind === 'connector') return null
  if (lod && (o.kind === 'sticky' || o.kind === 'shape' || o.kind === 'card' || o.kind === 'mind' || o.kind === 'text')) return <LodBlock o={o} />
  const style: React.CSSProperties = {
    left: o.x,
    top: o.y,
    width: o.w,
    height: o.h,
    transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
  }
  let body: React.ReactNode = null
  switch (o.kind) {
    case 'sticky': body = <Sticky o={o} editing={editing} />; break
    case 'shape': body = <Shape o={o} editing={editing} />; break
    case 'text': body = <TextView o={o} editing={editing} />; break
    case 'frame': body = <Frame o={o} editing={editing} zoom={zoom} />; break
    case 'card': body = <Card o={o} editing={editing} />; break
    case 'mind': body = <Mind o={o} editing={editing} />; break
    case 'image':
      body = <img src={o.src} alt="" draggable={false} className="absolute inset-0 size-full rounded-[2px] object-fill" />
      break
    case 'emoji':
      body = <div className="absolute inset-0 grid place-items-center leading-none" style={{ fontSize: o.h * 0.82 }}>{o.char}</div>
      break
    case 'pen':
      body = (
        <svg className="absolute top-0 left-0 overflow-visible" width={o.w} height={o.h} style={{ mixBlendMode: o.highlighter ? 'multiply' : undefined }}>
          <path d={smoothPath(o.points)} fill="none" stroke="transparent" strokeWidth={Math.max(o.width + 10, 12)} strokeLinecap="round" pointerEvents="stroke" />
          <path d={smoothPath(o.points)} fill="none" stroke={o.color} strokeWidth={o.width} strokeLinecap="round" strokeLinejoin="round" opacity={o.highlighter ? 0.45 : 1} pointerEvents="none" />
        </svg>
      )
      break
    case 'comment':
      body = (
        <div className="absolute inset-0 grid place-items-center rounded-[16px_16px_16px_4px] bg-[#4262ff] text-white shadow-lg ring-2 ring-white" style={{ opacity: o.resolved ? 0.45 : 1 }}>
          {o.thread.length > 1 ? <span className="text-[13px] font-bold">{o.thread.length}</span> : <MessageCircle className="size-4" />}
        </div>
      )
      break
  }
  return (
    <div
      className="absolute"
      style={{ ...style, pointerEvents: o.kind === 'pen' || o.kind === 'frame' || (o.kind === 'shape' && !editing) ? 'none' : undefined }}
      data-id={o.id}
      data-kind={o.kind}
    >
      {o.kind === 'pen' || o.kind === 'shape' ? <div className="pointer-events-none absolute inset-0">{body}</div> : body}
      <Votes n={o.votes} />
    </div>
  )
})

