import { useEffect, useMemo, useState } from 'react'
import { History, Pencil, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { listVersions } from '@/board/persist'
import { useBoard } from '@/board/store'
import { onVersionsChanged, removeVersion, renameVersion, restoreVersion, saveNamedVersion } from '@/board/versionOps'
import { diffSummary, relativeTime, signature, type BoardVersion } from '@/board/versions'
import { Input } from '@/components/ui/input'
import { useUi } from './uiStore'

/** Left drawer: named and automatic versions of the board, with preview, diff and restore. */
export function VersionsPanel() {
  const open = useUi((s) => s.versionsPanel)
  const boardId = useBoard((s) => s.doc?.id)
  const objects = useBoard((s) => s.doc?.objects)
  const order = useBoard((s) => s.doc?.order)
  const [versions, setVersions] = useState<BoardVersion[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!open || !boardId) return
    let live = true
    const load = () => void listVersions(boardId).then((v) => live && setVersions(v))
    load()
    const off = onVersionsChanged(load)
    // Relative times ("5 min ago") stay fresh while the panel is open
    const t = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => {
      live = false
      off()
      clearInterval(t)
    }
  }, [open, boardId])

  const currentSig = useMemo(() => (objects && order ? signature(objects, order) : ''), [objects, order])
  if (!open || !objects) return null

  const save = async () => {
    const v = await saveNamedVersion(name)
    if (v) {
      setName('')
      toast.success(`Saved version “${v.name}”`)
    }
  }
  const restore = async (v: BoardVersion) => {
    if (await restoreVersion(v)) toast.success(`Restored ${v.name ? `“${v.name}”` : relativeTime(v.at)}`, { description: 'The board before it is saved as a version. ⌘Z also undoes the restore.' })
  }

  return (
    <div className="jiro-float absolute top-[72px] bottom-3 left-[66px] z-20 flex w-80 flex-col" data-ui data-versions-panel>
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <History className="size-4" />
        <span className="text-sm font-semibold">Version history</span>
        <button aria-label="Close version history" className="ml-auto grid size-7 place-items-center rounded-md hover:bg-accent" onClick={() => useUi.getState().set({ versionsPanel: false })}>
          <X className="size-4" />
        </button>
      </div>
      <form
        className="flex gap-2 border-b p-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Name this version…" aria-label="Version name" className="h-8 text-sm" />
        <button type="submit" className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90" data-action="save-version">
          <Save className="size-3.5" /> Save
        </button>
      </form>
      <div className="flex-1 overflow-y-auto p-2" data-scrollable>
        {!versions.length && <p className="p-3 text-center text-xs text-muted-foreground">No versions yet. Jiro keeps one when you open the board and every 10 minutes while it changes; save named ones for milestones.</p>}
        {versions.map((v) => {
          const isCurrent = v.sig === currentSig
          const d = diffSummary(objects, v.objects)
          const sel = picked === v.id
          const title = v.name ?? (v.reason ? `Auto · ${v.reason}` : 'Auto-save')
          return (
            <div key={v.id} className={`mb-1.5 rounded-lg border transition-colors ${sel ? 'border-[#4262ff] bg-accent/60' : 'border-transparent hover:bg-accent/50'}`} data-version={v.id} data-version-named={!v.auto || undefined}>
              <button className="flex w-full items-center gap-2.5 p-2 text-left" onClick={() => setPicked(sel ? null : v.id)} aria-expanded={sel}>
                <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded border bg-card">
                  {v.thumbnail ? <img src={v.thumbnail} alt="" className="size-full object-contain p-0.5" draggable={false} /> : <span className="text-[9px] text-muted-foreground">Empty</span>}
                </span>
                <span className="min-w-0 flex-1">
                  {renaming?.id === v.id ? (
                    <input
                      autoFocus
                      className="w-full rounded border bg-background px-1 text-sm"
                      value={renaming.name}
                      aria-label="Rename version"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') void renameVersion(v, renaming.name).then(() => setRenaming(null))
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={() => void renameVersion(v, renaming.name).then(() => setRenaming(null))}
                    />
                  ) : (
                    <span className={`block truncate text-sm ${v.auto ? 'text-muted-foreground' : 'font-semibold'}`}>{title}</span>
                  )}
                  <span className="block text-[11px] text-muted-foreground">
                    {relativeTime(v.at)} · {v.count} item{v.count === 1 ? '' : 's'}
                  </span>
                </span>
                {isCurrent ? (
                  <span className="rounded bg-[#4262ff]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4262ff]">Current</span>
                ) : (
                  <span className="text-right font-mono text-[10px] leading-tight text-muted-foreground" title="Restoring this version would add / remove / change this many items" data-version-diff>
                    {d.added ? <span className="block text-emerald-600">+{d.added}</span> : null}
                    {d.removed ? <span className="block text-rose-600">−{d.removed}</span> : null}
                    {d.changed ? <span className="block">~{d.changed}</span> : null}
                  </span>
                )}
              </button>
              {sel && (
                <div className="flex gap-1 px-2 pb-2">
                  <button disabled={isCurrent} onClick={() => void restore(v)} className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40" data-action="restore-version">
                    <RotateCcw className="size-3.5" /> Restore
                  </button>
                  <button onClick={() => setRenaming({ id: v.id, name: v.name ?? '' })} className="grid size-7 place-items-center rounded-md border hover:bg-accent" aria-label={v.name ? 'Rename version' : 'Name this version'} title={v.name ? 'Rename' : 'Name it (named versions are never cleaned up)'}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button onClick={() => void removeVersion(v.id)} className="grid size-7 place-items-center rounded-md border hover:bg-accent hover:text-rose-600" aria-label="Delete version" title="Delete">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
