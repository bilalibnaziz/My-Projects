import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { exportPng } from '@/board/exporter'
import { boardToPdf } from '@/board/pdf'
import { uid } from '@/board/geometry'
import { saveBoard } from '@/board/persist'
import { useBoard } from '@/board/store'
import type { BoardDoc } from '@/board/types'
import { isTauri, openTextFile, safeName, saveFile } from '@/lib/files'

export const JIRO_FILTER = { name: 'Jiro board', extensions: ['jiro'] }

export function serializeBoard(doc: BoardDoc): string {
  return JSON.stringify({ format: 'jiro', version: 1, board: { ...doc, thumbnail: undefined } })
}

export function parseBoard(text: string): BoardDoc {
  const j = JSON.parse(text)
  const b = j?.format === 'jiro' ? j.board : j
  if (!b || typeof b !== 'object' || !b.objects || !Array.isArray(b.order)) throw new Error('Not a Jiro board file')
  const now = Date.now()
  // Imported boards get a fresh id so they never overwrite an existing one
  return {
    ...b,
    id: uid(),
    createdAt: b.createdAt ?? now,
    updatedAt: now,
    viewport: b.viewport ?? { x: 0, y: 0, zoom: 1 },
    order: b.order.filter((id: string) => b.objects[id]),
  }
}

export async function saveBoardFile() {
  const doc = useBoard.getState().doc
  if (!doc) return
  const doc2 = { ...doc, viewport: useBoard.getState().vp }
  const path = await saveFile(`${safeName(doc.name)}.jiro`, new Blob([serializeBoard(doc2)], { type: 'application/json' }), JIRO_FILTER)
  if (path) toast.success('Board saved', { description: path })
}

export async function importBoardFile(): Promise<BoardDoc | null> {
  const f = await openTextFile(JIRO_FILTER)
  if (!f) return null
  try {
    const doc = parseBoard(f.text)
    await saveBoard(doc)
    toast.success(`Opened “${doc.name}”`)
    return doc
  } catch (e) {
    toast.error('Could not open that file', { description: String((e as Error).message ?? e) })
    return null
  }
}

const canvasBg = () => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#f4f3ef'

export async function exportBoardPng(opts: { ids?: string[]; transparent?: boolean; scale?: number; name?: string } = {}) {
  const doc = useBoard.getState().doc
  if (!doc) return
  const blob = await exportPng(doc, { ids: opts.ids, scale: opts.scale ?? 2, background: opts.transparent ? null : canvasBg() })
  if (!blob) return toast.message('Nothing to export yet')
  const path = await saveFile(`${safeName(opts.name ?? doc.name)}.png`, blob, { name: 'PNG image', extensions: ['png'] })
  if (path) toast.success('Exported PNG', { description: path })
}

export async function exportSelectionPng() {
  const { selection } = useBoard.getState()
  if (!selection.length) return exportBoardPng()
  return exportBoardPng({ ids: selection, name: `${useBoard.getState().doc?.name ?? 'board'} selection` })
}

export async function copyBoardPng() {
  const { doc, selection } = useBoard.getState()
  if (!doc) return
  const blob = await exportPng(doc, { ids: selection.length ? selection : undefined, scale: 2, background: canvasBg() })
  if (!blob) return
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast.success('Copied image to clipboard')
  } catch {
    toast.error('Clipboard image copy is not available here')
  }
}

export async function openUrl(url: string) {
  if (!/^(https?|mailto):/i.test(url)) return
  if (isTauri()) await invoke('open_url', { url })
  else window.open(url, '_blank', 'noopener')
}

/** Every frame becomes a page (board order); without frames the whole board is one page */
export async function exportBoardPdf() {
  const doc = useBoard.getState().doc
  if (!doc) return
  const frames = doc.order.map((id) => doc.objects[id]).filter((o): o is Extract<typeof o, { kind: 'frame' }> => o?.kind === 'frame')
  const id = toast.loading(frames.length ? `Rendering ${frames.length} page${frames.length === 1 ? '' : 's'}…` : 'Rendering…')
  try {
    const blob = await boardToPdf(doc, frames)
    toast.dismiss(id)
    if (!blob) return toast.message('Nothing to export yet')
    const path = await saveFile(`${safeName(doc.name)}.pdf`, blob, { name: 'PDF document', extensions: ['pdf'] })
    if (path) toast.success(`Exported PDF (${frames.length || 1} page${frames.length > 1 ? 's' : ''})`, { description: path })
  } catch (e) {
    toast.dismiss(id)
    toast.error('PDF export failed', { description: String((e as Error).message ?? e) })
  }
}
