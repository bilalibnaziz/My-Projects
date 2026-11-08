import { Pause, Play, RotateCcw, Timer as TimerIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ToolButton } from './ToolButton'

function chime() {
  try {
    const ac = new AudioContext()
    ;[880, 1175, 1568].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain()
      o.frequency.value = f
      o.type = 'sine'
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.18 + 0.6)
      o.connect(g).connect(ac.destination)
      o.start(ac.currentTime + i * 0.18)
      o.stop(ac.currentTime + i * 0.18 + 0.7)
    })
  } catch { /* no audio */ }
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Facilitation timer: presets, pause/resume, chime at zero */
export function Timer() {
  const [total, setTotal] = useState(5 * 60_000)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [left, setLeft] = useState(total)
  const running = endAt !== null

  useEffect(() => {
    if (!endAt) return
    const id = setInterval(() => {
      const l = endAt - Date.now()
      setLeft(l)
      if (l <= 0) {
        setEndAt(null)
        setLeft(0)
        chime()
        toast("⏰ Time's up!")
      }
    }, 250)
    return () => clearInterval(id)
  }, [endAt])

  const start = (ms = left > 0 ? left : total) => {
    setLeft(ms)
    setEndAt(Date.now() + ms)
  }
  const active = running || (left > 0 && left < total)

  return (
    <Popover>
      <PopoverTrigger asChild>
        {active ? (
          <button className={cn('flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold tabular-nums', left < 10_000 && running ? 'bg-red-500/15 text-red-600' : 'bg-primary/25')} aria-label="Timer" data-ui>
            <TimerIcon className="size-4" />
            {fmt(left)}
          </button>
        ) : (
          <ToolButton label="Timer" side="bottom" className="size-9">
            <TimerIcon />
          </ToolButton>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" data-ui>
        <div className="mb-3 text-center text-4xl font-semibold tabular-nums">{fmt(running ? left : left > 0 && left < total ? left : total)}</div>
        <div className="mb-3 grid grid-cols-4 gap-1">
          {[1, 3, 5, 10, 15, 20, 30, 45].map((m) => (
            <button
              key={m}
              onClick={() => {
                setTotal(m * 60_000)
                setLeft(m * 60_000)
                setEndAt(null)
              }}
              className={cn('rounded-md py-1 text-sm hover:bg-accent', total === m * 60_000 && 'bg-accent ring-1 ring-ring')}
            >
              {m}m
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            onClick={() => (running ? (setEndAt(null), setLeft(endAt! - Date.now())) : start())}
          >
            {running ? <Pause className="size-4" /> : <Play className="size-4" />}
            {running ? 'Pause' : left > 0 && left < total ? 'Resume' : 'Start'}
          </button>
          <button aria-label="Reset timer" className="grid size-9 place-items-center rounded-md border hover:bg-accent" onClick={() => { setEndAt(null); setLeft(total) }}>
            <RotateCcw className="size-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
