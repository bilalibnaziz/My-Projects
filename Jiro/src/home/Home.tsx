import { Copy, FileUp, Link2, LayoutGrid, List, Moon, MoreHorizontal, Pencil, Plus, Search, Star, Sun, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { uid } from '@/board/geometry'
import { deleteBoard, listBoards, loadBoard, patchMeta, saveBoard } from '@/board/persist'
import { TEMPLATES } from '@/board/templates'
import type { BoardMeta } from '@/board/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { JiroMark } from '@/ui/JiroMark'
import { TemplatePreview } from '@/ui/TemplatePreview'
import { useUi } from '@/ui/uiStore'
import { AvatarStack } from '@/team/Avatar'
import { NotificationsBell } from '@/team/NotificationsBell'
import { WhatsAppButton } from '@/team/WhatsAppButton'
import { useTeam } from '@/team/team'

const when = (t: number) => {
  const d = Date.now() - t
  if (d < 60_000) return 'Just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} d ago`
  return new Date(t).toLocaleDateString()
}

interface Props {
  onOpen(id: string): void
  onCreate(templateId?: string): void
  onImport(): void
}

export function Home({ onOpen, onCreate, onImport }: Props) {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'starred'>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [renaming, setRenaming] = useState<BoardMeta | null>(null)
  const [deleting, setDeleting] = useState<BoardMeta | null>(null)
  const theme = useUi((s) => s.theme)
  const me = useTeam((s) => s.me)
  const members = useTeam((s) => s.members)

  const refresh = () => listBoards().then(setBoards).catch(() => setBoards([]))
  useEffect(() => {
    refresh()
  }, [])

  const shown = useMemo(
    () => (boards ?? []).filter((b) => (filter === 'all' || b.starred) && b.name.toLowerCase().includes(q.toLowerCase())),
    [boards, q, filter],
  )

  const duplicate = async (b: BoardMeta) => {
    const d = await loadBoard(b.id)
    if (!d) return
    const now = Date.now()
    await saveBoard({ ...structuredClone(d), id: uid(), name: `${d.name} (copy)`, createdAt: now, updatedAt: now, starred: false })
    toast.success('Board duplicated')
    refresh()
  }

  return (
    <div className="flex h-full flex-col bg-background" data-home>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-6">
        <JiroMark className="size-8" />
        <span className="text-xl font-bold tracking-tight">Jiro</span>
        <div className="relative ml-6 w-full max-w-md">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search boards" className="h-10 pl-9" aria-label="Search boards" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => useUi.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <NotificationsBell />
          <WhatsAppButton />
          <Button variant="ghost" onClick={() => useUi.getState().set({ teamOpen: true })} data-action="team" className="gap-2 px-2">
            <AvatarStack people={[me, ...members]} size={26} max={4} /> Team
          </Button>
          <Button variant="outline" onClick={() => useUi.getState().set({ linkOpen: true })} data-action="open-link">
            <Link2 /> Open link
          </Button>
          <Button variant="outline" onClick={onImport} data-action="import">
            <FileUp /> Open file
          </Button>
          <Button onClick={() => onCreate()} className="font-semibold" data-action="new-board">
            <Plus /> New board
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <section>
            <h2 className="mb-1 text-2xl font-bold tracking-tight">Start something</h2>
            <p className="mb-5 text-sm text-muted-foreground">Blank canvas or a ready-made structure. Everything stays on this computer, works offline and saves as you go.</p>
            <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
              <button
                onClick={() => onCreate()}
                className="group flex w-44 shrink-0 flex-col overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                data-template="blank"
              >
                <div className="grid h-28 place-items-center bg-primary">
                  <Plus className="size-10 text-primary-foreground transition group-hover:scale-110" />
                </div>
                <div className="p-3">
                  <div className="text-sm font-semibold">Blank board</div>
                  <div className="text-xs text-muted-foreground">Infinite canvas</div>
                </div>
              </button>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onCreate(t.id)}
                  className="flex w-44 shrink-0 flex-col overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                  data-template={t.id}
                >
                  <TemplatePreview t={t} className="h-28" />
                  <div className="p-3">
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{t.category}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-semibold">Boards</h2>
              <div className="ml-4 flex rounded-lg bg-muted p-0.5 text-sm">
                {(['all', 'starred'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn('rounded-md px-3 py-1 capitalize', filter === f ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex rounded-lg bg-muted p-0.5">
                <button aria-label="Grid view" onClick={() => setView('grid')} className={cn('grid size-8 place-items-center rounded-md', view === 'grid' && 'bg-card shadow-sm')}><LayoutGrid className="size-4" /></button>
                <button aria-label="List view" onClick={() => setView('list')} className={cn('grid size-8 place-items-center rounded-md', view === 'list' && 'bg-card shadow-sm')}><List className="size-4" /></button>
              </div>
            </div>

            {boards && !shown.length && (
              <div className="rounded-xl border border-dashed p-12 text-center">
                <div className="mb-1 font-medium">{boards.length ? 'No boards match' : 'No boards yet'}</div>
                <div className="mb-4 text-sm text-muted-foreground">{boards.length ? 'Try another search.' : 'Create your first board to get going.'}</div>
                {!boards.length && <Button onClick={() => onCreate()}><Plus /> New board</Button>}
              </div>
            )}

            <div className={view === 'grid' ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4' : 'flex flex-col divide-y rounded-xl border'}>
              {shown.map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(b.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpen(b.id)}
                  className={cn(
                    'group relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    view === 'grid' ? 'overflow-hidden rounded-xl border bg-card transition hover:-translate-y-0.5 hover:shadow-lg' : 'flex items-center gap-4 p-3 hover:bg-accent/50',
                  )}
                  data-board={b.id}
                >
                  <div className={cn('relative bg-canvas', view === 'grid' ? 'h-36' : 'h-12 w-20 shrink-0 rounded-md')}>
                    {b.thumbnail ? <img src={b.thumbnail} alt="" className="absolute inset-0 size-full object-contain p-3" draggable={false} /> : <div className="grid h-full place-items-center text-xs text-muted-foreground">Empty</div>}
                  </div>
                  <div className={cn('flex items-center gap-2', view === 'grid' ? 'p-3' : 'flex-1')}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{b.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.sharedBy && <span className="mr-1 rounded-full bg-[#30a46c]/15 px-1.5 py-px font-medium text-[#1f7a4d] dark:text-[#4cc38a]" data-shared-by>from {b.sharedBy}</span>}
                        Edited {when(b.updatedAt)} · {b.count} item{b.count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <button
                      aria-label={b.starred ? 'Unstar' : 'Star'}
                      onClick={async (e) => {
                        e.stopPropagation()
                        await patchMeta(b.id, { starred: !b.starred })
                        refresh()
                      }}
                      className={cn('grid size-8 place-items-center rounded-md hover:bg-accent', !b.starred && 'opacity-0 group-hover:opacity-100')}
                    >
                      <Star className={cn('size-4', b.starred && 'fill-primary text-primary')} />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button aria-label="Board actions" onClick={(e) => e.stopPropagation()} className="grid size-8 place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent data-[state=open]:opacity-100">
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => setRenaming(b)}><Pencil /> Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void duplicate(b)}><Copy /> Duplicate</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(b)}><Trash2 /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
              if (renaming && name) await patchMeta(renaming.id, { name })
              setRenaming(null)
              refresh()
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename board</DialogTitle>
              <DialogDescription className="sr-only">Enter a new board name</DialogDescription>
            </DialogHeader>
            <Input name="name" defaultValue={renaming?.name} autoFocus className="my-4" aria-label="Board name" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>This removes the board from this computer. Save it as a .jiro file first if you want a copy.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (deleting) await deleteBoard(deleting.id)
                setDeleting(null)
                refresh()
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
