import { connectorPath, rotatedBounds, smoothPath, union } from './geometry'
import { mindDescendants } from './mindmap'
import { shapePath, shapeTextBox } from './shapes'
import { boundsOf } from './store'
import { cssFont, fitFontSize, LINE_HEIGHT, wrapText } from './text'
import type { BoardDoc, BoardObj, Cap, ID, Rect, TextStyle } from './types'

const imgCache = new Map<string, HTMLImageElement>()
function loadImg(src: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(src)
  if (hit?.complete) return Promise.resolve(hit)
  return new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => {
      imgCache.set(src, i)
      res(i)
    }
    i.onerror = rej
    i.src = src
  })
}

function drawText(ctx: CanvasRenderingContext2D, text: string, box: Rect, st: TextStyle, size: number) {
  if (!text) return
  const font = cssFont(size, st.font, st.bold, st.italic)
  const lines = wrapText(text, box.w, font)
  const lh = size * LINE_HEIGHT
  const total = lines.length * lh
  let y = st.valign === 'top' ? box.y : st.valign === 'bottom' ? box.y + box.h - total : box.y + (box.h - total) / 2
  ctx.font = font
  ctx.fillStyle = st.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = st.align === 'left' ? 'left' : st.align === 'right' ? 'right' : 'center'
  const x = st.align === 'left' ? box.x : st.align === 'right' ? box.x + box.w : box.x + box.w / 2
  for (const l of lines) {
    ctx.fillText(l, x, y + lh / 2)
    if (st.underline || st.strike) {
      const w = ctx.measureText(l).width
      const x0 = st.align === 'left' ? x : st.align === 'right' ? x - w : x - w / 2
      ctx.fillRect(x0, y + lh / 2 + (st.underline ? size * 0.45 : 0), w, Math.max(1, size / 14))
    }
    y += lh
  }
}

function dash(ctx: CanvasRenderingContext2D, d: string, w: number) {
  ctx.setLineDash(d === 'dashed' ? [w * 4, w * 3] : d === 'dotted' ? [0.1, w * 2.5] : [])
}

function cap(ctx: CanvasRenderingContext2D, c: Cap, p: { x: number; y: number }, ang: number, w: number, color: string) {
  if (c === 'none') return
  const s = 5 + w * 2.2
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(ang)
  ctx.setLineDash([])
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineWidth = w
  ctx.beginPath()
  if (c === 'arrow') {
    ctx.moveTo(-s, -s * 0.6)
    ctx.lineTo(0, 0)
    ctx.lineTo(-s, s * 0.6)
    ctx.stroke()
  } else if (c === 'triangle') {
    ctx.moveTo(-s, -s * 0.55)
    ctx.lineTo(0, 0)
    ctx.lineTo(-s, s * 0.55)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (c === 'dot') {
    ctx.arc(0, 0, 2 + w * 1.3, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.moveTo(0, -s * 0.6)
    ctx.lineTo(0, s * 0.6)
    ctx.stroke()
  }
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

async function drawObj(ctx: CanvasRenderingContext2D, o: BoardObj, objs: Record<ID, BoardObj>) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (o.rotation && o.kind !== 'connector') {
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2)
    ctx.rotate((o.rotation * Math.PI) / 180)
    ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2))
  }
  switch (o.kind) {
    case 'frame':
      ctx.fillStyle = o.fill
      ctx.fillRect(o.x, o.y, o.w, o.h)
      ctx.strokeStyle = 'rgba(26,26,46,.14)'
      ctx.lineWidth = 1
      ctx.strokeRect(o.x, o.y, o.w, o.h)
      ctx.font = cssFont(14, 'sans', true)
      ctx.fillStyle = '#5c5c70'
      ctx.textBaseline = 'bottom'
      ctx.fillText(o.title, o.x, o.y - 6)
      break
    case 'sticky': {
      ctx.shadowColor = 'rgba(0,0,0,.18)'
      ctx.shadowBlur = 12
      ctx.shadowOffsetY = 4
      ctx.fillStyle = o.fill
      ctx.fillRect(o.x, o.y, o.w, o.h)
      ctx.shadowColor = 'transparent'
      const pad = Math.max(10, o.w * 0.08)
      const box = { x: o.x + pad, y: o.y + pad, w: o.w - pad * 2, h: o.h - pad * 2 }
      drawText(ctx, o.text, box, o, o.fontSize || fitFontSize(o.text, box.w, box.h, o.font, o.bold, 48))
      break
    }
    case 'shape': {
      ctx.translate(o.x, o.y)
      const p = new Path2D(shapePath(o.shape, o.w, o.h))
      if (o.fill !== 'transparent') {
        ctx.fillStyle = o.fill
        ctx.fill(p)
      }
      if (o.strokeWidth) {
        ctx.strokeStyle = o.stroke
        ctx.lineWidth = o.strokeWidth
        dash(ctx, o.dash, o.strokeWidth)
        ctx.stroke(p)
        ctx.setLineDash([])
      }
      const tb = shapeTextBox(o.shape, o.w, o.h)
      drawText(ctx, o.text, tb, o, o.fontSize || fitFontSize(o.text, tb.w, tb.h, o.font, o.bold, 40))
      break
    }
    case 'text':
      if (o.highlight) {
        ctx.fillStyle = o.highlight
        ctx.fillRect(o.x, o.y, o.w, o.h)
      }
      drawText(ctx, o.text, { x: o.x, y: o.y, w: o.autoWidth ? 1e6 : o.w, h: o.h }, { ...o, valign: 'top', align: o.autoWidth ? 'left' : o.align }, o.fontSize || 24)
      break
    case 'card': {
      ctx.shadowColor = 'rgba(0,0,0,.14)'
      ctx.shadowBlur = 14
      ctx.shadowOffsetY = 3
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, o.x, o.y, o.w, o.h, 8)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.save()
      ctx.clip()
      ctx.fillStyle = o.tag
      ctx.fillRect(o.x, o.y, 8, o.h)
      ctx.restore()
      const base: TextStyle = { fontSize: 17, color: '#1a1a2e', align: 'left', valign: 'top', bold: true }
      drawText(ctx, o.title, { x: o.x + 22, y: o.y + 14, w: o.w - 36, h: 46 }, base, 17)
      drawText(ctx, o.body, { x: o.x + 22, y: o.y + 56, w: o.w - 36, h: o.h - 90 }, { ...base, bold: false, color: '#5c5c70' }, 13)
      const st = o.status === 'done' ? 'Done' : o.status === 'doing' ? 'In progress' : 'To do'
      ctx.font = cssFont(12, 'sans', true)
      const tw = ctx.measureText(st).width + 16
      ctx.fillStyle = o.status === 'done' ? '#d3f9d8' : o.status === 'doing' ? '#fff3bf' : '#eef0f4'
      roundRect(ctx, o.x + 22, o.y + o.h - 32, tw, 20, 10)
      ctx.fill()
      ctx.fillStyle = '#5c5c70'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(st, o.x + 30, o.y + o.h - 22)
      break
    }
    case 'mind': {
      roundRect(ctx, o.x, o.y, o.w, o.h, o.h / 2)
      ctx.fillStyle = o.parent ? '#ffffff' : o.color
      ctx.fill()
      ctx.strokeStyle = o.color
      ctx.lineWidth = 2.5
      ctx.stroke()
      drawText(ctx, o.text, { x: o.x + 14, y: o.y, w: o.w - 28, h: o.h }, { fontSize: 0, color: o.parent ? '#1a1a2e' : '#ffffff', align: 'center', valign: 'middle', bold: !o.parent }, o.parent ? 15 : 18)
      break
    }
    case 'pen':
      ctx.translate(o.x, o.y)
      ctx.strokeStyle = o.color
      ctx.lineWidth = o.width
      ctx.globalAlpha = o.highlighter ? 0.45 : 1
      if (o.highlighter) ctx.globalCompositeOperation = 'multiply'
      ctx.stroke(new Path2D(smoothPath(o.points)))
      break
    case 'image':
      try {
        ctx.drawImage(await loadImg(o.src), o.x, o.y, o.w, o.h)
      } catch { /* broken image */ }
      break
    case 'emoji':
      ctx.font = `${o.h * 0.82}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(o.char, o.x + o.w / 2, o.y + o.h / 2 + o.h * 0.04)
      break
    case 'connector': {
      const p = connectorPath(o, objs)
      ctx.strokeStyle = o.stroke
      ctx.lineWidth = o.strokeWidth
      dash(ctx, o.dash, o.strokeWidth)
      ctx.stroke(new Path2D(p.d))
      cap(ctx, o.startCap, p.a, p.angA, o.strokeWidth, o.stroke)
      cap(ctx, o.endCap, p.b, p.angB, o.strokeWidth, o.stroke)
      if (o.label) {
        ctx.font = cssFont(14)
        const w = ctx.measureText(o.label).width + 12
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(p.mid.x - w / 2, p.mid.y - 11, w, 22)
        ctx.fillStyle = '#1a1a2e'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(o.label, p.mid.x, p.mid.y)
      }
      break
    }
    case 'comment':
      break
  }
  ctx.restore()
  if (o.votes) {
    ctx.save()
    ctx.fillStyle = '#4262ff'
    ctx.beginPath()
    ctx.arc(o.x + o.w, o.y, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = cssFont(14, 'sans', true)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(o.votes), o.x + o.w, o.y + 1)
    ctx.restore()
  }
}

function drawBranches(ctx: CanvasRenderingContext2D, ids: Set<ID>, objs: Record<ID, BoardObj>) {
  for (const id of ids) {
    const o = objs[id]
    if (o?.kind !== 'mind' || !o.parent) continue
    const p = objs[o.parent]
    if (p?.kind !== 'mind') continue
    const right = o.x + o.w / 2 >= p.x + p.w / 2
    const x0 = right ? p.x + p.w : p.x, y0 = p.y + p.h / 2
    const x1 = right ? o.x : o.x + o.w, y1 = o.y + o.h / 2
    const mx = (x0 + x1) / 2
    ctx.strokeStyle = o.color
    ctx.lineWidth = p.parent ? 2.5 : 3.5
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1)
    ctx.stroke()
  }
}

export interface ExportOpts {
  ids?: ID[] // default: whole board
  scale?: number
  background?: string | null // null = transparent
  padding?: number
  /** Render exactly this board rect (slides / PDF pages); frame titles outside it are skipped */
  clip?: Rect
  /** Return the canvas instead of a PNG blob */
  canvas?: boolean
}

/** Renders the board (or a subset) to a PNG blob */
export async function exportPng(doc: BoardDoc, o: ExportOpts = {}): Promise<Blob | null> {
  let ids = o.ids ?? doc.order
  // A frame export includes what's inside it
  if (o.ids) {
    const set = new Set(ids)
    for (const id of o.ids) {
      const f = doc.objects[id]
      if (f?.kind === 'frame') {
        for (const k of doc.order) {
          const c = doc.objects[k]
          if (c && c.kind !== 'connector' && k !== id) {
            const b = rotatedBounds(c)
            if (b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h) set.add(k)
          }
        }
      }
      if (f?.kind === 'mind') for (const d of mindDescendants(doc.objects, doc.order, id)) set.add(d)
    }
    for (const k of doc.order) {
      const c = doc.objects[k]
      if (c?.kind === 'connector' && (!c.from.id || set.has(c.from.id)) && (!c.to.id || set.has(c.to.id)) && (c.from.id || c.to.id)) set.add(k)
    }
    ids = doc.order.filter((k) => set.has(k))
  }
  const b = boundsOf(ids, doc.objects) ?? union([])
  if (!b) return null
  const pad = o.padding ?? 48
  const frameTitles = ids.some((id) => doc.objects[id]?.kind === 'frame') ? 28 : 0
  const r = o.clip ?? { x: b.x - pad, y: b.y - pad - frameTitles, w: b.w + pad * 2, h: b.h + pad * 2 + frameTitles }
  let scale = o.scale ?? 2
  const MAX = 16384
  scale = Math.min(scale, MAX / r.w, MAX / r.h, Math.sqrt(268e6 / (r.w * r.h)))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(r.w * scale))
  c.height = Math.max(1, Math.round(r.h * scale))
  const ctx = c.getContext('2d')!
  if (o.background !== null) {
    ctx.fillStyle = o.background ?? '#f4f3ef'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.scale(scale, scale)
  ctx.translate(-r.x, -r.y)
  // Wait for fonts, but never hang an export on them
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))])
  drawBranches(ctx, new Set(ids), doc.objects)
  for (const id of ids) {
    const obj = doc.objects[id]
    if (obj) await drawObj(ctx, obj, doc.objects)
  }
  if (o.canvas) return c as unknown as Blob
  return new Promise((res) => c.toBlob((bl) => res(bl), 'image/png'))
}

/** Same as exportPng but hands back the canvas (for JPEG pages and snapshots) */
export async function exportCanvas(doc: BoardDoc, o: ExportOpts = {}): Promise<HTMLCanvasElement | null> {
  return (await exportPng(doc, { ...o, canvas: true })) as unknown as HTMLCanvasElement | null
}
