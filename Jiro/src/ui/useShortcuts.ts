import { useEffect } from 'react'
import { useLive } from '@/sync/live'
import { duplicateSelection, mindAddChild, mindAddSibling } from '@/board/actions'
import { toggleAssistant } from '@/ai/open'
import { useBoard } from '@/board/store'
import type { BoardObj, ID, ShapeKind, Tool } from '@/board/types'
import { resetZoom, zoomBy, zoomToFit, zoomToSelection } from '@/canvas/viewport'
import { copyBoardPng, exportBoardPdf, exportBoardPng, saveBoardFile } from './boardIo'
import { togglePanel } from './TopBar'
import { useUi } from './uiStore'

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', h: 'hand', n: 'sticky', t: 'text', s: 'shape', l: 'connector', p: 'pen', e: 'eraser', f: 'frame', k: 'card', m: 'mind', c: 'comment', q: 'laser',
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')
}

export function useShortcuts(handlers: { onNew(): void; onOpenFile(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useBoard.getState()
      const ui = useUi.getState()
      if (!s.doc || ui.presenting || useLive.getState().readOnly) return
      if (isTyping(e.target) || s.editingId) return
      if (document.querySelector('[role="dialog"]:not(.ai-panel), [role="menu"]')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const sel = s.selection

      const done = () => {
        e.preventDefault()
        e.stopPropagation()
      }

      if (mod) {
        if (e.altKey && e.code === 'KeyK') { done(); return toggleAssistant() }
        if (k === 'z') { done(); return e.shiftKey ? s.redo() : s.undo() }
        if (k === 'y') { done(); return s.redo() }
        if (k === 'c' && e.shiftKey) { done(); return void copyBoardPng() }
        // ⌘C / ⌘X / ⌘V go through the native copy / cut / paste events (see Canvas)
        if (k === 'c' || k === 'x' || k === 'v') return
        if (k === 'd') { done(); return duplicateSelection() }
        if (k === 'a') { done(); return s.select(s.doc.order.filter((id) => !s.doc!.objects[id]?.locked)) }
        if (k === 'g') { done(); return e.shiftKey ? s.ungroup() : s.group() }
        if (k === 'l' && e.shiftKey) { done(); return s.toggleLock() }
        if (k === 'k') { done(); return ui.set({ command: true }) }
        if (k === 'f') { done(); return ui.set({ command: true }) }
        if (k === '/') { done(); return ui.set({ shortcuts: true }) }
        if (k === 's') { done(); return void saveBoardFile() }
        if (k === 'o') { done(); return handlers.onOpenFile() }
        if (k === 'e' && e.shiftKey) { done(); return void exportBoardPng() }
        if (k === 'p' && e.shiftKey) { done(); return void exportBoardPdf() }
        if (k === '0') { done(); return resetZoom() }
        if (k === '=' || k === '+') { done(); return zoomBy(1.25) }
        if (k === '-') { done(); return zoomBy(0.8) }
        if (k === 'u') { done(); return document.querySelector<HTMLButtonElement>('[aria-label="Upload image"]')?.click() }
        if (['b', 'i'].includes(k) && sel.length) {
          done()
          const key = k === 'b' ? 'bold' : 'italic'
          const textual = sel.filter((id) => ['sticky', 'shape', 'text'].includes(s.doc!.objects[id]?.kind))
          if (!textual.length) return
          const on = !(s.doc.objects[textual[0]] as unknown as Record<string, unknown>)[key]
          const patches: Record<ID, Partial<BoardObj>> = {}
          for (const id of textual) patches[id] = { [key]: on } as Partial<BoardObj>
          return s.updateMany(patches)
        }
        return
      }

      if (e.altKey && k === 'n') { done(); return handlers.onNew() }
      if (e.shiftKey && e.code === 'Digit1') { done(); return zoomToFit() }
      if (e.shiftKey && e.code === 'Digit2') { done(); return zoomToSelection() }
      if (e.shiftKey && k === 'f') { done(); return togglePanel('framesPanel') }
      if (e.shiftKey && k === 'k') { done(); return togglePanel('tasksPanel') }
      if (e.shiftKey && k === 'n') { done(); return togglePanel('notesPanel') }
      if (e.shiftKey && k === 'h') { done(); return togglePanel('versionsPanel') }
      if (e.shiftKey && k === 't') { done(); return ui.set({ templatesOpen: true }) }
      if (e.shiftKey && k === 'p') { done(); return s.setTool('highlighter') }

      if (k === 'escape') {
        if (ui.voteMode) return ui.set({ voteMode: false })
        if (s.tool !== 'select') return s.setTool('select')
        return s.select([])
      }
      if ((k === 'backspace' || k === 'delete') && sel.length) {
        done()
        return s.remove(sel.filter((id) => !s.doc!.objects[id]?.locked))
      }
      if (k === 'enter' && sel.length === 1) {
        const o = s.doc.objects[sel[0]]
        if (o && !o.locked && ['sticky', 'shape', 'text', 'card', 'mind', 'frame', 'connector'].includes(o.kind)) {
          done()
          return s.setEditing(o.id)
        }
      }
      if (k === 'tab' && sel.length === 1) {
        const o = s.doc.objects[sel[0]]
        if (o?.kind === 'mind') { done(); return e.shiftKey && o.parent ? mindAddSibling(o.id) : mindAddChild(o.id) }
      }
      if (k === ']') { done(); return s.bringToFront() }
      if (k === '[') { done(); return s.sendToBack() }
      if (k.startsWith('arrow') && sel.length) {
        done()
        const d = e.shiftKey ? 10 : 1
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0
        const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0
        const patches: Record<ID, Partial<BoardObj>> = {}
        for (const id of sel) {
          const o = s.doc.objects[id]
          if (!o || o.locked) continue
          if (o.kind === 'connector') patches[id] = { from: { ...o.from, x: o.from.x + dx, y: o.from.y + dy }, to: { ...o.to, x: o.to.x + dx, y: o.to.y + dy } } as Partial<BoardObj>
          else patches[id] = { x: o.x + dx, y: o.y + dy }
        }
        return s.updateMany(patches)
      }
      if (k === 'r' || k === 'o') {
        done()
        s.setOpts({ shape: (k === 'r' ? 'rect' : 'ellipse') as ShapeKind })
        return s.setTool('shape')
      }
      if (e.altKey || e.shiftKey) return
      const t = TOOL_KEYS[k]
      if (t) {
        done()
        s.setTool(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}
