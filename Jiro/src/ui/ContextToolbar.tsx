import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, ArrowLeftRight, Bold, BringToFront, ChevronDown, Copy, Frame as FrameIcon,
  Group, Italic, LayoutGrid, Lock, MoreHorizontal, Palette, SendToBack, SortAsc, Strikethrough, Trash2, Underline, Ungroup, Unlock, Wand2,
  Minus, Plus, Download, Link2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  align, clusterByColor, distribute, duplicateSelection, frameSelection, sortByText, tidyUp,
} from '@/board/actions'
import { CARD_TAGS, FILL_COLORS, INK_COLORS, MIND_COLORS, STICKY_COLORS, inkFor } from '@/board/factory'
import { SHAPES } from '@/board/shapes'
import { boundsOf, useBoard } from '@/board/store'
import type { BoardObj, Cap, ID, TextStyle } from '@/board/types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { AssignPicker } from '@/team/AssignPicker'
import { exportSelectionPng } from './boardIo'
import { ShapeIcon } from './Toolbar'
import { Divider, ToolButton } from './ToolButton'

const TEXT_KINDS = new Set(['sticky', 'shape', 'text'])

function patchAll(ids: ID[], fn: (o: BoardObj) => Partial<BoardObj> | null) {
  const s = useBoard.getState()
  const patches: Record<ID, Partial<BoardObj>> = {}
  for (const id of ids) {
    const o = s.doc!.objects[id]
    if (!o || o.locked) continue
    const p = fn(o)
    if (p) patches[id] = p
  }
  s.updateMany(patches)
}

function Colors({ colors, value, onPick, round = true, cols = 6 }: { colors: string[]; value?: string; onPick(c: string): void; round?: boolean; cols?: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {colors.map((c) => (
        <button
          key={c}
          aria-label={c === 'transparent' ? 'No fill' : c}
          title={c === 'transparent' ? 'No fill' : c}
          onClick={() => onPick(c)}
          className={cn('size-7 border border-black/10 transition hover:scale-110', round ? 'rounded-full' : 'rounded-md', value === c && 'ring-2 ring-selection ring-offset-2 ring-offset-popover')}
          style={{ background: c === 'transparent' ? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50%/10px 10px' : c }}
        />
      ))}
    </div>
  )
}

function Pop({ label, trigger, children, width = 'w-56' }: { label: string; trigger: React.ReactNode; children: React.ReactNode; width?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolButton label={label} side="top" className="size-9">
          {trigger}
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className={cn('p-3', width)} data-ui data-keep-editing onOpenAutoFocus={(e) => e.preventDefault()}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

const Dot = ({ color, ring }: { color: string; ring?: string }) => (
  <span className="size-5 rounded-full border border-black/15" style={{ background: color === 'transparent' ? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50%/8px 8px' : color, boxShadow: ring ? `inset 0 0 0 3px ${ring}` : undefined }} />
)

const SIZES: [string, number][] = [['Auto', 0], ['S', 14], ['M', 20], ['L', 32], ['XL', 48], ['XXL', 72]]

function TextControls({ ids, first }: { ids: ID[]; first: BoardObj & TextStyle }) {
  const isText = first.kind === 'text'
  const size = first.fontSize
  const step = (d: number) => patchAll(ids, (o) => ('fontSize' in o ? { fontSize: Math.max(6, Math.min(400, Math.round(((o as TextStyle).fontSize || 20) + d))) } : null))
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm hover:bg-accent" aria-label="Font" data-ui>
            <span className="w-12 truncate text-left" style={{ fontFamily: first.font === 'hand' ? 'Caveat' : first.font === 'serif' ? 'Georgia' : first.font === 'mono' ? 'monospace' : undefined }}>
              {first.font === 'hand' ? 'Hand' : first.font === 'serif' ? 'Serif' : first.font === 'mono' ? 'Mono' : 'Inter'}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-keep-editing>
          {(['sans', 'hand', 'serif', 'mono'] as const).map((f) => (
            <DropdownMenuItem key={f} onSelect={() => patchAll(ids, () => ({ font: f }) as Partial<BoardObj>)}>
              {f === 'sans' ? 'Inter' : f === 'hand' ? 'Hand-drawn' : f === 'serif' ? 'Serif' : 'Monospace'}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center">
        <button aria-label="Smaller text" className="grid size-7 place-items-center rounded hover:bg-accent" onClick={() => step(-2)}><Minus className="size-3.5" /></button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 min-w-9 rounded px-1 text-sm tabular-nums hover:bg-accent" aria-label="Font size" data-ui>
              {size ? Math.round(size) : 'Auto'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-keep-editing>
            {SIZES.filter(([, v]) => v || !isText).map(([n, v]) => (
              <DropdownMenuItem key={n} onSelect={() => patchAll(ids, () => ({ fontSize: v }) as Partial<BoardObj>)}>
                {n} {v ? <span className="ml-auto text-muted-foreground">{v}</span> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button aria-label="Larger text" className="grid size-7 place-items-center rounded hover:bg-accent" onClick={() => step(2)}><Plus className="size-3.5" /></button>
      </div>
      <ToolButton label="Bold" shortcut="⌘B" side="top" className="size-9" active={!!first.bold} onClick={() => patchAll(ids, (o) => ({ bold: !(o as TextStyle).bold }) as Partial<BoardObj>)}><Bold /></ToolButton>
      <Pop label="Text style" trigger={<span className="text-[15px] font-semibold underline decoration-2 underline-offset-2" style={{ textDecorationColor: first.color }}>A</span>}>
        <div className="mb-2 flex gap-1">
          <ToolButton label="Italic" side="top" className="size-8" active={!!first.italic} onClick={() => patchAll(ids, (o) => ({ italic: !(o as TextStyle).italic }) as Partial<BoardObj>)}><Italic /></ToolButton>
          <ToolButton label="Underline" side="top" className="size-8" active={!!first.underline} onClick={() => patchAll(ids, (o) => ({ underline: !(o as TextStyle).underline }) as Partial<BoardObj>)}><Underline /></ToolButton>
          <ToolButton label="Strikethrough" side="top" className="size-8" active={!!first.strike} onClick={() => patchAll(ids, (o) => ({ strike: !(o as TextStyle).strike }) as Partial<BoardObj>)}><Strikethrough /></ToolButton>
          <div className="mx-1 w-px bg-border" />
          {(['left', 'center', 'right'] as const).map((a) => (
            <ToolButton key={a} label={`Align ${a}`} side="top" className="size-8" active={first.align === a} onClick={() => patchAll(ids, () => ({ align: a }) as Partial<BoardObj>)}>
              {a === 'left' ? <AlignLeft /> : a === 'center' ? <AlignCenter /> : <AlignRight />}
            </ToolButton>
          ))}
        </div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Text colour</div>
        <Colors colors={INK_COLORS} value={first.color} onPick={(c) => patchAll(ids, () => ({ color: c }) as Partial<BoardObj>)} />
        {isText && (
          <>
            <div className="mt-3 mb-1.5 text-xs font-medium text-muted-foreground">Highlight</div>
            <Colors colors={['transparent', '#fff3bf', '#ffe3e3', '#d3f9d8', '#d0ebff', '#e5dbff']} value={(first as { highlight?: string }).highlight ?? 'transparent'} onPick={(c) => patchAll(ids, () => ({ highlight: c === 'transparent' ? undefined : c }) as Partial<BoardObj>)} />
          </>
        )}
      </Pop>
    </>
  )
}

export function ContextToolbar() {
  // Hidden while dragging / resizing / rotating (it would chase the pointer and re-render every frame)
  const dragging = useBoard((s) => s.gesture !== null && s.editingId === null)
  return dragging ? null : <ContextToolbarInner />
}

function ContextToolbarInner() {
  const doc = useBoard((s) => s.doc)
  const sel = useBoard((s) => s.selection)
  const vp = useBoard((s) => s.vp)
  const tool = useBoard((s) => s.tool)
  const [, setTick] = useState(0)
  if (!doc || !sel.length || tool !== 'select') return null
  const objs = sel.map((id) => doc.objects[id]).filter(Boolean)
  if (!objs.length) return null
  const b = boundsOf(sel, doc.objects)
  if (!b) return null
  const kinds = new Set(objs.map((o) => o.kind))
  const one = kinds.size === 1 ? objs[0] : null
  const allLocked = objs.every((o) => o.locked)
  const multi = objs.filter((o) => o.kind !== 'connector').length > 1
  const textObjs = objs.filter((o) => TEXT_KINDS.has(o.kind)) as (BoardObj & TextStyle)[]

  // place above the selection, flip below if there's no room
  const top0 = b.y * vp.zoom + vp.y
  const bottom0 = (b.y + b.h) * vp.zoom + vp.y
  const cx = (b.x + b.w / 2) * vp.zoom + vp.x
  const above = top0 > 120
  const style: React.CSSProperties = { left: Math.max(240, Math.min(window.innerWidth - 240, cx)), top: above ? top0 - (one?.kind === 'frame' ? 34 : 12) - (one && !['connector', 'frame', 'mind', 'comment'].includes(one.kind) && sel.length === 1 ? 40 : 0) : bottom0 + 52 }

  const ids = sel
  const fills = one?.kind === 'sticky' ? STICKY_COLORS.map((c) => c.fill) : FILL_COLORS

  return (
    <div
      className="jiro-float absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 p-1"
      style={style}
      data-ui
      data-keep-editing
      data-context-toolbar
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}
    >
      {allLocked ? (
        <ToolButton label="Unlock" shortcut="⇧⌘L" side="top" className="size-9" onClick={() => useBoard.getState().toggleLock()}>
          <Unlock />
        </ToolButton>
      ) : (
        <>
          {/* ---------- per-kind controls ---------- */}
          {one?.kind === 'sticky' && (
            <Pop label="Colour" trigger={<Dot color={one.fill} />} width="w-60">
              <Colors colors={fills} round={false} value={one.fill} onPick={(c) => patchAll(ids, () => ({ fill: c, color: inkFor(c) }) as Partial<BoardObj>)} />
            </Pop>
          )}
          {one?.kind === 'shape' && (
            <>
              <Pop label="Shape" trigger={<ShapeIcon kind={one.shape} size={20} />} width="w-auto">
                <div className="grid grid-cols-6 gap-1">
                  {SHAPES.map((s) => (
                    <button key={s.kind} title={s.label} aria-label={s.label} onClick={() => patchAll(ids, () => ({ shape: s.kind }) as Partial<BoardObj>)} className={cn('grid size-9 place-items-center rounded-md hover:bg-accent', one.shape === s.kind && 'bg-accent')}>
                      <ShapeIcon kind={s.kind} />
                    </button>
                  ))}
                </div>
              </Pop>
              <Pop label="Fill & border" trigger={<Dot color={one.fill} ring={one.stroke} />} width="w-64">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Fill</div>
                <Colors colors={FILL_COLORS} value={one.fill} cols={8} onPick={(c) => patchAll(ids, () => ({ fill: c, color: c === 'transparent' ? '#1a1a2e' : inkFor(c) }) as Partial<BoardObj>)} />
                <div className="mt-3 mb-1.5 text-xs font-medium text-muted-foreground">Border</div>
                <Colors colors={INK_COLORS} value={one.stroke} onPick={(c) => patchAll(ids, () => ({ stroke: c }) as Partial<BoardObj>)} />
                <div className="mt-3 flex items-center gap-1">
                  {[0, 1, 2, 4, 6].map((w) => (
                    <button key={w} onClick={() => patchAll(ids, () => ({ strokeWidth: w }) as Partial<BoardObj>)} className={cn('h-8 flex-1 rounded-md text-xs hover:bg-accent', one.strokeWidth === w && 'bg-accent ring-1 ring-ring')}>
                      {w === 0 ? 'None' : <span className="mx-auto block w-6 rounded-full bg-foreground" style={{ height: w }} />}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {(['solid', 'dashed', 'dotted'] as const).map((d) => (
                    <button key={d} onClick={() => patchAll(ids, () => ({ dash: d }) as Partial<BoardObj>)} className={cn('rounded-md py-1 text-xs capitalize hover:bg-accent', one.dash === d && 'bg-accent ring-1 ring-ring')}>{d}</button>
                  ))}
                </div>
              </Pop>
            </>
          )}
          {one?.kind === 'connector' && <ConnectorControls ids={ids} o={one} />}
          {one?.kind === 'frame' && (
            <>
              <Pop label="Frame colour" trigger={<Dot color={one.fill} />} width="w-64">
                <Colors colors={['#ffffff', '#f4f6ff', '#fff8e1', '#effaf1', '#fdf0ff', '#fff1f0', '#f3f4f6', '#1a1a2e']} value={one.fill} cols={8} onPick={(c) => patchAll(ids, () => ({ fill: c }) as Partial<BoardObj>)} />
              </Pop>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm hover:bg-accent" data-ui>
                    Size <ChevronDown className="size-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {([['16:9 slide', 1280, 720], ['4:3', 1024, 768], ['A4', 794, 1123], ['Square', 1080, 1080], ['Phone', 390, 844], ['Desktop', 1440, 1024]] as const).map(([n, w, h]) => (
                    <DropdownMenuItem key={n} onSelect={() => useBoard.getState().update(one.id, { w, h })}>
                      {n} <span className="ml-auto pl-4 text-xs text-muted-foreground">{w}×{h}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {one?.kind === 'card' && (
            <>
              <Pop label="Tag colour" trigger={<Dot color={one.tag} />}>
                <Colors colors={CARD_TAGS} value={one.tag} cols={7} onPick={(c) => patchAll(ids, () => ({ tag: c }) as Partial<BoardObj>)} />
              </Pop>
              <AssignPicker card={one} />
            </>
          )}
          {one?.kind === 'mind' && (
            <>
              <Pop label="Branch colour" trigger={<Dot color={one.color} />}>
                <Colors colors={MIND_COLORS} value={one.color} cols={7} onPick={(c) => patchAll(ids, () => ({ color: c }) as Partial<BoardObj>)} />
              </Pop>
              {!one.parent && (
                <ToolButton label={one.side === 'both' ? 'Grow to the right' : 'Grow both ways'} side="top" className="size-9" onClick={() => useBoard.getState().update(one.id, { side: one.side === 'both' ? 'right' : 'both' })}>
                  <ArrowLeftRight />
                </ToolButton>
              )}
              <button className="h-9 rounded-lg px-2 text-sm hover:bg-accent" onClick={() => useBoard.getState().update(one.id, { collapsed: !one.collapsed })}>
                {one.collapsed ? 'Expand' : 'Collapse'}
              </button>
            </>
          )}
          {one?.kind === 'pen' && (
            <Pop label="Ink" trigger={<Dot color={one.color} />}>
              <Colors colors={INK_COLORS} value={one.color} onPick={(c) => patchAll(ids, () => ({ color: c }) as Partial<BoardObj>)} />
            </Pop>
          )}
          {textObjs.length > 0 && textObjs.length === objs.length && <TextControls ids={ids} first={textObjs[0]} />}

          {/* ---------- multi-select organize ---------- */}
          {multi && (
            <>
              {kinds.size > 0 && objs.some((o) => o.kind === 'sticky') && !one && (
                <Pop label="Sticky colour" trigger={<Palette />} width="w-60">
                  <Colors colors={STICKY_COLORS.map((c) => c.fill)} round={false} onPick={(c) => patchAll(ids, (o) => (o.kind === 'sticky' ? ({ fill: c, color: inkFor(c) } as Partial<BoardObj>) : null))} />
                </Pop>
              )}
              {one?.kind === 'sticky' && <Divider vertical />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium hover:bg-accent" data-ui data-organize>
                    <Wand2 className="size-4" /> Organize <ChevronDown className="size-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuItem onSelect={tidyUp}><LayoutGrid /> Tidy up into a grid</DropdownMenuItem>
                  <DropdownMenuItem onSelect={clusterByColor}><Palette /> Cluster by colour</DropdownMenuItem>
                  <DropdownMenuItem onSelect={sortByText}><SortAsc /> Sort A → Z</DropdownMenuItem>
                  <DropdownMenuItem onSelect={frameSelection}><FrameIcon /> Wrap in a frame</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => align('left')}><AlignStartVertical /> Align left</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => align('hcenter')}><AlignCenterVertical /> Align centre</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => align('right')}><AlignEndVertical /> Align right</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => align('top')}><AlignStartHorizontal /> Align top</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => align('vcenter')}><AlignCenterHorizontal /> Align middle</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => align('bottom')}><AlignEndHorizontal /> Align bottom</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => distribute('h')}><AlignHorizontalSpaceAround /> Distribute horizontally</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => distribute('v')}><AlignVerticalSpaceAround /> Distribute vertically</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {objs.every((o) => o.groupId && o.groupId === objs[0].groupId) ? (
                <ToolButton label="Ungroup" shortcut="⇧⌘G" side="top" className="size-9" onClick={() => useBoard.getState().ungroup()}><Ungroup /></ToolButton>
              ) : (
                <ToolButton label="Group" shortcut="⌘G" side="top" className="size-9" onClick={() => useBoard.getState().group()}><Group /></ToolButton>
              )}
            </>
          )}
          <Divider vertical />
          {sel.length === 1 && objs[0].kind !== 'connector' && (
            <Pop label={objs[0].link ? 'Edit link' : 'Add link'} trigger={<Link2 className={objs[0].link ? 'text-selection' : ''} />} width="w-72">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const v = String(new FormData(e.currentTarget).get('url') ?? '').trim()
                  useBoard.getState().update(objs[0].id, { link: v ? (/^[a-z]+:/i.test(v) ? v : 'https://' + v) : undefined })
                  toast.success(v ? 'Link saved' : 'Link removed')
                }}
              >
                <label className="text-xs font-medium text-muted-foreground" htmlFor="jiro-link">Link</label>
                <div className="mt-1 flex gap-1.5">
                  <input id="jiro-link" name="url" autoFocus className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" defaultValue={objs[0].link ?? ''} placeholder="https://…" />
                  <button className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Save</button>
                </div>
              </form>
            </Pop>
          )}
          <ToolButton label="Lock" shortcut="⇧⌘L" side="top" className="size-9" onClick={() => { useBoard.getState().toggleLock(); setTick((n) => n + 1) }}>
            <Lock />
          </ToolButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="More actions" className="grid size-9 place-items-center rounded-lg hover:bg-accent" data-ui data-more>
                <MoreHorizontal className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <DropdownMenuItem onSelect={duplicateSelection}><Copy /> Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => useBoard.getState().bringToFront()}><BringToFront /> Bring to front <DropdownMenuShortcut>]</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => useBoard.getState().sendToBack()}><SendToBack /> Send to back <DropdownMenuShortcut>[</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportSelectionPng().catch((e) => toast.error(String(e)))}><Download /> Export selection as PNG</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => useBoard.getState().remove(ids)}><Trash2 /> Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )
}

const CAPS: Cap[] = ['none', 'arrow', 'triangle', 'dot', 'bar']
function CapIcon({ cap, flip }: { cap: Cap; flip?: boolean }) {
  return (
    <svg width="28" height="14" viewBox="0 0 28 14" style={{ transform: flip ? 'scaleX(-1)' : undefined }}>
      <path d="M2 7 H24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {cap === 'arrow' && <path d="M18 2 L24 7 L18 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {cap === 'triangle' && <path d="M18 2 L25 7 L18 12 Z" fill="currentColor" />}
      {cap === 'dot' && <circle cx="23" cy="7" r="3.5" fill="currentColor" />}
      {cap === 'bar' && <path d="M24 2 V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  )
}

function ConnectorControls({ ids, o }: { ids: ID[]; o: Extract<BoardObj, { kind: 'connector' }> }) {
  return (
    <>
      <div className="flex rounded-lg bg-muted p-0.5">
        {(['curve', 'elbow', 'straight'] as const).map((st) => (
          <button key={st} onClick={() => patchAll(ids, () => ({ style: st }) as Partial<BoardObj>)} className={cn('rounded-md px-2 py-1 text-xs capitalize', o.style === st ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {st}
          </button>
        ))}
      </div>
      <Pop label="Line colour & width" trigger={<span className="block h-1 w-5 rounded-full" style={{ background: o.stroke }} />} width="w-60">
        <Colors colors={INK_COLORS} value={o.stroke} onPick={(c) => patchAll(ids, () => ({ stroke: c }) as Partial<BoardObj>)} />
        <div className="mt-3 flex gap-1">
          {[1, 2, 3, 5, 8].map((w) => (
            <button key={w} onClick={() => patchAll(ids, () => ({ strokeWidth: w }) as Partial<BoardObj>)} className={cn('grid h-8 flex-1 place-items-center rounded-md hover:bg-accent', o.strokeWidth === w && 'bg-accent ring-1 ring-ring')}>
              <span className="block w-6 rounded-full bg-foreground" style={{ height: w }} />
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {(['solid', 'dashed', 'dotted'] as const).map((d) => (
            <button key={d} onClick={() => patchAll(ids, () => ({ dash: d }) as Partial<BoardObj>)} className={cn('rounded-md py-1 text-xs capitalize hover:bg-accent', o.dash === d && 'bg-accent ring-1 ring-ring')}>{d}</button>
          ))}
        </div>
      </Pop>
      {(['startCap', 'endCap'] as const).map((k) => (
        <DropdownMenu key={k}>
          <DropdownMenuTrigger asChild>
            <button aria-label={k === 'startCap' ? 'Start cap' : 'End cap'} className="grid h-9 place-items-center rounded-lg px-1.5 hover:bg-accent" data-ui>
              <CapIcon cap={o[k]} flip={k === 'startCap'} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {CAPS.map((c) => (
              <DropdownMenuItem key={c} onSelect={() => patchAll(ids, () => ({ [k]: c }) as Partial<BoardObj>)}>
                <CapIcon cap={c} flip={k === 'startCap'} /> <span className="capitalize">{c}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      <ToolButton label="Swap direction" side="top" className="size-9" onClick={() => patchAll(ids, (c) => (c.kind === 'connector' ? ({ from: c.to, to: c.from } as Partial<BoardObj>) : null))}>
        <ArrowLeftRight />
      </ToolButton>
    </>
  )
}
