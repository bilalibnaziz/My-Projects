import { TEMPLATES } from '@/board/templates'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { insertTemplate } from './CommandPalette'
import { TemplatePreview } from './TemplatePreview'
import { useUi } from './uiStore'

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

export const SHORTCUTS: [string, [string, string][]][] = [
  ['Tools', [
    ['V', 'Select'], ['H / Space', 'Hand (pan)'], ['N', 'Sticky note'], ['T', 'Text'], ['S', 'Shape'], ['R / O', 'Rectangle / circle'], ['L', 'Connection line'],
    ['P', 'Pen'], ['⇧P', 'Highlighter'], ['E', 'Eraser'], ['F', 'Frame'], ['K', 'Card'], ['M', 'Mind map'], ['C', 'Comment'], ['Q', 'Laser pointer'],
    ['Double-click tool', 'Keep tool active'],
  ]],
  ['Editing', [
    ['Enter', 'Edit selected'], ['Esc', 'Stop editing / deselect'], ['Tab', 'Next sticky / mind-map child'], ['Enter (mind map)', 'Add sibling'],
    [`${mod}Z / ⇧${mod}Z`, 'Undo / redo'], [`${mod}C / ${mod}X / ${mod}V`, 'Copy / cut / paste'], [`${mod}D`, 'Duplicate'], ['⌥ drag', 'Duplicate while dragging'],
    [`${mod}A`, 'Select all'], ['⌫', 'Delete'], [`${mod}G / ⇧${mod}G`, 'Group / ungroup'], [`⇧${mod}L`, 'Lock / unlock'], ['] / [', 'Bring to front / send to back'],
    ['Arrows', 'Nudge (⇧ ×10)'], [`${mod}B / ${mod}I / ${mod}U`, 'Bold / italic / underline'],
  ]],
  ['View', [
    ['Scroll', 'Pan'], [`Pinch / ${mod} scroll`, 'Zoom'], [`${mod}+ / ${mod}−`, 'Zoom in / out'], ['⇧1', 'Zoom to fit'], ['⇧2', 'Zoom to selection'], [`${mod}0`, 'Zoom 100%'],
    [`${mod}K`, 'Command palette & search'], ['⇧F', 'Frames panel'], ['⇧K', 'Tasks panel'], ['⇧N', 'Notes panel'], ['⇧T', 'Templates'], [`${mod}/`, 'This list'],
  ]],
  ['Board', [[`${mod}S`, 'Save .jiro file'], [`${mod}O`, 'Open .jiro file'], [`⇧${mod}E`, 'Export PNG'], [`⇧${mod}P`, 'Export frames as PDF'], [`⇧${mod}C`, 'Copy as image'], ['⌥N', 'New board']]],
]

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcuts)
  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().set({ shortcuts: o })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-ui>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Jiro is built to be driven from the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SHORTCUTS.map(([group, rows]) => (
            <div key={group}>
              <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</div>
              <div className="space-y-1">
                {rows.map(([k, d]) => (
                  <div key={k + d} className="flex items-center justify-between gap-3 text-sm">
                    <span>{d}</span>
                    <kbd className="shrink-0 rounded-md border bg-muted px-1.5 py-0.5 font-sans text-xs">{k}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function TemplatesDialog() {
  const open = useUi((s) => s.templatesOpen)
  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().set({ templatesOpen: o })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl" data-ui>
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>Drop a ready-made structure onto the board at the centre of your view.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              data-template={t.id}
              className="group overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                useUi.getState().set({ templatesOpen: false })
                setTimeout(() => insertTemplate(t.id), 0)
              }}
            >
              <TemplatePreview t={t} className="h-28" />
              <div className="p-3">
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
