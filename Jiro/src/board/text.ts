import type { TextStyle } from './types'

export const FONT_STACK: Record<NonNullable<TextStyle['font']>, string> = {
  sans: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  hand: "Caveat, 'Comic Sans MS', cursive",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
}

export const LINE_HEIGHT = 1.25

let ctx: CanvasRenderingContext2D | null = null
function measureCtx() {
  if (!ctx) {
    // jsdom (unit tests) has no 2D canvas; the estimate fallback is used there
    const c = typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent) ? document.createElement('canvas') : null
    ctx = c?.getContext('2d') ?? null
  }
  return ctx
}

export function cssFont(size: number, font: TextStyle['font'] = 'sans', bold = false, italic = false) {
  return `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px ${FONT_STACK[font ?? 'sans']}`
}

/** Word-wrap text to a width with the given font (breaks long words too) */
export function wrapText(text: string, width: number, font: string): string[] {
  const c = measureCtx()
  const measure = (s: string) => (c ? ((c.font = font), c.measureText(s).width) : s.length * parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '16') * 0.55)
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (!para) {
      lines.push('')
      continue
    }
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const cand = line + w
      if (measure(cand) <= width || !line.trim()) {
        if (measure(cand) > width && !line.trim()) {
          // single word wider than the box: hard-break it
          let chunk = ''
          for (const ch of w) {
            if (measure(chunk + ch) > width && chunk) {
              lines.push(chunk)
              chunk = ch
            } else chunk += ch
          }
          line = chunk
        } else line = cand
      } else {
        lines.push(line.trimEnd())
        line = w.trimStart()
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

const fitCache = new Map<string, number>()

/** Largest font size (8…72) at which `text` fits the box; used by auto-size stickies & shapes */
export function fitFontSize(text: string, w: number, h: number, font: TextStyle['font'] = 'sans', bold = false, max = 64): number {
  const key = `${text}\u0000${Math.round(w)}\u0000${Math.round(h)}\u0000${font}\u0000${bold}\u0000${max}`
  const hit = fitCache.get(key)
  if (hit) return hit
  const t = text || 'M'
  let lo = 8, hi = max
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2
    const lines = wrapText(t, w, cssFont(mid, font, bold))
    if (lines.length * mid * LINE_HEIGHT <= h) lo = mid
    else hi = mid
  }
  const size = Math.floor(lo)
  if (fitCache.size > 4000) fitCache.clear()
  fitCache.set(key, size)
  return size
}

/** Width a single-line-per-paragraph text needs (for auto-width text objects) */
export function measureTextBlock(text: string, size: number, font: TextStyle['font'] = 'sans', bold = false) {
  const c = measureCtx()
  const lines = (text || ' ').split('\n')
  let w = 0
  if (c) {
    c.font = cssFont(size, font, bold)
    for (const l of lines) w = Math.max(w, c.measureText(l || ' ').width)
  } else w = Math.max(...lines.map((l) => l.length)) * size * 0.55
  return { w: Math.ceil(w) + 4, h: Math.ceil(lines.length * size * LINE_HEIGHT) }
}
