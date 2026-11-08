import {
  CreditCard, Eraser, Frame, Hand, Highlighter, ImagePlus, LayoutTemplate, MessageSquare, MousePointer2, Network, PenLine, Pointer, Redo2, Shapes,
  SmilePlus, Spline, StickyNote, Type, Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { addImageFiles } from '@/board/actions'
import { INK_COLORS, STICKY_COLORS } from '@/board/factory'
import { shapePath, SHAPES } from '@/board/shapes'
import { useBoard } from '@/board/store'
import type { Tool } from '@/board/types'
import { viewCenter } from '@/canvas/viewport'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { pickImages } from '@/lib/files'
import { cn } from '@/lib/utils'
import { Divider, ToolButton } from './ToolButton'
import { useUi } from './uiStore'

export const EMOJIS = ['👍', '❤️', '🔥', '🎉', '💡', '✅', '❌', '⭐', '🚀', '👀', '😂', '🤔', '😍', '🙌', '💯', '⚠️', '❓', '📌', '🎯', '⏰', '💬', '👏', '😎', '🥳']

function Swatch({ color, active, onClick, label, round = true }: { color: string; active?: boolean; onClick(): void; label: string; round?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('size-7 border border-black/10 transition hover:scale-110', round ? 'rounded-full' : 'rounded-md', active && 'ring-2 ring-selection ring-offset-2 ring-offset-popover')}
      style={{ background: color === 'transparent' ? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50%/10px 10px' : color }}
    />
  )
}

export function ShapeIcon({ kind, size = 22 }: { kind: Parameters<typeof shapePath>[0]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-2 -2 28 28">
      <path d={shapePath(kind, 24, kind === 'arrow' || kind === 'parallelogram' || kind === 'cylinder' ? 18 : 24)} transform={kind === 'arrow' || kind === 'parallelogram' ? 'translate(0 3)' : undefined} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  )
}

export function Toolbar() {
  const tool = useBoard((s) => s.tool)
  const locked = useBoard((s) => s.toolLocked)
  const opts = useBoard((s) => s.opts)
  const canUndo = useBoard((s) => s.past.length > 0)
  const canRedo = useBoard((s) => s.future.length > 0)
  const set = useBoard((s) => s.setTool)
  const setOpts = useBoard((s) => s.setOpts)
  const [pop, setPop] = useState<string | null>(null)

  const pick = (t: Tool) => (e: React.MouseEvent) => set(t, e.detail >= 2 || e.shiftKey)
  const btn = (t: Tool, label: string, key: string, icon: React.ReactNode) => (
    <ToolButton label={label + (locked && tool === t ? ' (locked)' : '')} shortcut={key} active={tool === t} onClick={pick(t)} data-tool={t}>
      {icon}
    </ToolButton>
  )

  const popTool = (t: Tool, label: string, key: string, icon: React.ReactNode, content: React.ReactNode, width = 'w-64') => (
    <Popover open={pop === t} onOpenChange={(o) => setPop(o ? t : null)}>
      <PopoverTrigger asChild>
        <ToolButton
          label={label}
          shortcut={key}
          active={tool === t}
          data-tool={t}
          onClick={(e) => {
            set(t, e.detail >= 2 || e.shiftKey)
          }}
        >
          {icon}
          <span className="absolute right-[5px] bottom-[5px] size-[5px] rounded-tl-[1px] [clip-path:polygon(100%_0,100%_100%,0_100%)] bg-current opacity-50" />
        </ToolButton>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} className={cn('p-3', width)} data-ui onOpenAutoFocus={(e) => e.preventDefault()}>
        {content}
      </PopoverContent>
    </Popover>
  )

  return (
    <div className="jiro-float absolute top-1/2 left-3 z-20 flex max-h-[calc(100%-120px)] -translate-y-1/2 flex-col items-center gap-0.5 overflow-y-auto p-1.5 [scrollbar-width:none]" data-ui data-toolbar>
      {btn('select', 'Select', 'V', <MousePointer2 />)}
      {btn('hand', 'Hand', 'H', <Hand />)}
      <ToolButton label="Templates" shortcut="⇧T" onClick={() => useUi.getState().set({ templatesOpen: true })}>
        <LayoutTemplate />
      </ToolButton>
      <Divider />
      {popTool(
        'sticky', 'Sticky note', 'N',
        <StickyNote />,
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Sticky colour</div>
          <div className="grid grid-cols-6 gap-2">
            {STICKY_COLORS.map((c) => (
              <Swatch key={c.fill} color={c.fill} label={c.name} round={false} active={opts.stickyColor === c.fill} onClick={() => { setOpts({ stickyColor: c.fill }); set('sticky'); setPop(null) }} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Tip: Tab while typing makes the next note. Paste a list to get one note per line.</p>
        </div>,
      )}
      {btn('text', 'Text', 'T', <Type />)}
      {popTool(
        'shape', 'Shapes', 'S',
        <Shapes />,
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Shapes</div>
          <div className="grid grid-cols-6 gap-1">
            {SHAPES.map((s) => (
              <button
                key={s.kind}
                title={s.label}
                aria-label={s.label}
                data-shape={s.kind}
                onClick={() => { setOpts({ shape: s.kind }); set('shape'); setPop(null) }}
                className={cn('grid size-9 place-items-center rounded-md hover:bg-accent', opts.shape === s.kind && 'bg-accent ring-1 ring-ring')}
              >
                <ShapeIcon kind={s.kind} />
              </button>
            ))}
          </div>
        </div>,
      )}
      {popTool(
        'connector', 'Connection line', 'L',
        <Spline />,
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Line style</div>
          <div className="grid grid-cols-3 gap-1">
            {(['curve', 'elbow', 'straight'] as const).map((st) => (
              <button
                key={st}
                onClick={() => { setOpts({ connectorStyle: st }); set('connector'); setPop(null) }}
                className={cn('rounded-md px-2 py-1.5 text-sm capitalize hover:bg-accent', opts.connectorStyle === st && 'bg-accent ring-1 ring-ring')}
              >
                {st}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Drag from one item to another. Lines stay attached when you move things.</p>
        </div>,
        'w-60',
      )}
      {popTool(
        'pen', 'Pen', 'P',
        <PenLine />,
        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Pen</span>
            <button className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent', tool === 'highlighter' && 'bg-accent')} onClick={() => { set('highlighter'); setPop(null) }}>
              <Highlighter className="size-3.5" /> Highlighter
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {INK_COLORS.map((c) => (
              <Swatch key={c} color={c} label={c} active={opts.penColor === c} onClick={() => { setOpts({ penColor: c }); set('pen') }} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {[2, 4, 8, 14].map((w) => (
              <button key={w} aria-label={`Width ${w}`} onClick={() => setOpts({ penWidth: w })} className={cn('grid h-8 flex-1 place-items-center rounded-md hover:bg-accent', opts.penWidth === w && 'bg-accent ring-1 ring-ring')}>
                <span className="rounded-full bg-foreground" style={{ width: 22, height: Math.max(2, w / 1.6) }} />
              </button>
            ))}
          </div>
        </div>,
      )}
      {btn('eraser', 'Eraser', 'E', <Eraser />)}
      {btn('frame', 'Frame', 'F', <Frame />)}
      {btn('card', 'Card', 'K', <CreditCard />)}
      {btn('mind', 'Mind map', 'M', <Network />)}
      {btn('comment', 'Comment', 'C', <MessageSquare />)}
      {popTool(
        'emoji', 'Stamps & reactions', 'R',
        <SmilePlus />,
        <div className="grid grid-cols-8 gap-1">
          {EMOJIS.map((e) => (
            <button key={e} aria-label={`Stamp ${e}`} className={cn('grid size-8 place-items-center rounded-md text-xl hover:bg-accent', opts.emoji === e && 'bg-accent')} onClick={() => { setOpts({ emoji: e }); set('emoji'); setPop(null) }}>
              {e}
            </button>
          ))}
        </div>,
        'w-80',
      )}
      <ToolButton
        label="Upload image"
        shortcut="⌘U"
        onClick={async () => {
          const files = await pickImages()
          if (files.length) await addImageFiles(files, viewCenter())
        }}
      >
        <ImagePlus />
      </ToolButton>
      {btn('laser', 'Laser pointer', 'Q', <Pointer />)}
      <Divider />
      <ToolButton label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={() => useBoard.getState().undo()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => useBoard.getState().redo()}>
        <Redo2 />
      </ToolButton>
    </div>
  )
}
