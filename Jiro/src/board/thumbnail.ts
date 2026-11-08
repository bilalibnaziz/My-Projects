import { connectorPath, rotatedBounds, union } from './geometry'
import type { BoardDoc } from './types'

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)

/** Lightweight vector preview of a board for the home screen (no text, just the layout) */
export function thumbnailSvg(doc: BoardDoc): string | undefined {
  const objs = doc.order.map((id) => doc.objects[id]).filter((o) => o && o.kind !== 'connector' && o.kind !== 'comment')
  const b = union(objs.map((o) => rotatedBounds(o)))
  if (!b) return undefined
  const pad = Math.max(b.w, b.h) * 0.06 + 20
  const vb = `${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`
  const parts: string[] = []
  for (const id of doc.order) {
    const o = doc.objects[id]
    if (!o) continue
    const t = o.rotation ? ` transform="rotate(${o.rotation} ${o.x + o.w / 2} ${o.y + o.h / 2})"` : ''
    switch (o.kind) {
      case 'frame':
        parts.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${esc(o.fill)}" stroke="#d4d4d8" stroke-width="${Math.max(2, b.w / 300)}"/>`)
        break
      case 'sticky':
        parts.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${esc(o.fill)}"${t}/>`)
        break
      case 'shape':
        parts.push(
          o.shape === 'ellipse'
            ? `<ellipse cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" fill="${o.fill === 'transparent' ? 'none' : esc(o.fill)}" stroke="${esc(o.stroke)}" stroke-width="${o.strokeWidth * 2}"${t}/>`
            : `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.shape === 'round' ? 16 : 0}" fill="${o.fill === 'transparent' ? 'none' : esc(o.fill)}" stroke="${esc(o.stroke)}" stroke-width="${o.strokeWidth * 2}"${t}/>`,
        )
        break
      case 'card':
        parts.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="8" fill="#fff" stroke="#e4e4e7" stroke-width="2"/><rect x="${o.x}" y="${o.y}" width="8" height="${o.h}" fill="${esc(o.tag)}"/>`)
        break
      case 'mind':
        parts.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.h / 2}" fill="${o.parent ? '#fff' : esc(o.color)}" stroke="${esc(o.color)}" stroke-width="3"/>`)
        break
      case 'text':
        parts.push(`<rect x="${o.x}" y="${o.y + o.h * 0.3}" width="${o.w}" height="${o.h * 0.4}" rx="4" fill="#a1a1aa" opacity="0.6"/>`)
        break
      case 'pen': {
        let d = ''
        for (let i = 0; i < o.points.length; i += 2) d += `${i ? 'L' : 'M'}${o.x + o.points[i]},${o.y + o.points[i + 1]}`
        parts.push(`<path d="${d}" fill="none" stroke="${esc(o.color)}" stroke-width="${o.width * 1.5}" stroke-linecap="round" opacity="${o.highlighter ? 0.4 : 1}"/>`)
        break
      }
      case 'image':
        parts.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#c7d2fe"${t}/>`)
        break
      case 'emoji':
        parts.push(`<circle cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" r="${o.w / 2.4}" fill="#fcd34d"/>`)
        break
    }
  }
  for (const id of doc.order) {
    const o = doc.objects[id]
    if (o?.kind === 'connector') {
      try {
        parts.push(`<path d="${connectorPath(o, doc.objects).d}" fill="none" stroke="${esc(o.stroke)}" stroke-width="${o.strokeWidth * 1.5}"/>`)
      } catch { /* dangling connector */ }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
