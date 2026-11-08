import { exportCanvas } from './exporter'
import { boundsOf } from './store'
import type { BoardDoc, FrameObj, Rect } from './types'

const enc = new TextEncoder()

/**
 * Minimal PDF 1.4 writer: one page per image, each image a full-bleed JPEG (DCTDecode).
 * Page size follows the image's aspect, in points (1 board px = 0.75 pt, like CSS px → pt).
 */
export function buildPdf(pages: { jpeg: Uint8Array; w: number; h: number; pw: number; ph: number }[], title = 'Jiro board'): Blob {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let pos = 0
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b
    chunks.push(u)
    pos += u.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = pos
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
  const n = pages.length
  // 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const pageId = (i: number) => 4 + i * 3
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`))
  const safe = title.replace(/[()\\]/g, '\\$&').replace(/[^\x20-\x7e]/g, '')
  obj(3, () => push(`<< /Title (${safe}) /Producer (Jiro) >>`))
  pages.forEach((p, i) => {
    const id = pageId(i)
    const pw = p.pw.toFixed(2), ph = p.ph.toFixed(2)
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`))
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      push(p.jpeg)
      push('\nendstream')
    })
  })
  const xref = pos
  const total = 4 + n * 3
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(x)
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

async function jpegOf(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92))
  if (!blob) throw new Error('Could not encode a page')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Frames become pages in board order; a board without frames becomes one page */
export async function boardToPdf(doc: BoardDoc, frames: FrameObj[], background = '#ffffff'): Promise<Blob | null> {
  const rects: Rect[] = frames.length ? frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })) : (() => {
    const b = boundsOf(doc.order, doc.objects)
    return b ? [{ x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }] : []
  })()
  if (!rects.length) return null
  const pages = []
  for (const r of rects) {
    // ~2× for crisp text, capped so huge frames stay reasonable
    const scale = Math.min(2, 3200 / Math.max(r.w, r.h))
    const c = await exportCanvas(doc, { clip: r, scale, background })
    if (!c) continue
    pages.push({ jpeg: await jpegOf(c), w: c.width, h: c.height, pw: r.w * 0.75, ph: r.h * 0.75 })
  }
  return buildPdf(pages, doc.name)
}
