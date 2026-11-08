import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findLiveBoard, getLiveInfo, parseLiveLink, setLiveInfo, startLive, stopLive } from '@/sync/live'
import { toast } from 'sonner'
import { emptyBoard } from '@/board/factory'
import { rotatedBounds } from '@/board/geometry'
import { loadBoard, openBoardCrdt, saveBoard } from '@/board/persist'
import { autoVersion } from '@/board/versionOps'
import { useBoard } from '@/board/store'
import { instantiate, TEMPLATES } from '@/board/templates'
import type { BoardDoc } from '@/board/types'
import { Canvas } from '@/canvas/Canvas'
import { stage, vpForRect } from '@/canvas/viewport'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AiAssistant } from '@/ai/AiAssistant'
import { jiroAdapter } from '@/ai/appAdapter'
import { Home } from '@/home/Home'
import { uid } from '@/board/geometry'
import { listBoards } from '@/board/persist'
import { readShareLink, scanForMe, type SharePayload } from '@/team/collab'
import { setBoardOpener } from '@/team/nav'
import { NotesPanel } from '@/team/NotesPanel'
import { useNotifications } from '@/team/notifications'
import { OpenLinkDialog } from '@/team/OpenLinkDialog'
import { ShareDialog } from '@/team/ShareDialog'
import { TasksPanel } from '@/team/TasksPanel'
import { TeamDialog } from '@/team/TeamDialog'
import { isMe } from '@/team/team'
import { isTauri } from '@/lib/files'
import { detectWhatsAppApp, setWhatsappMode } from '@/team/whatsapp'
import { importBoardFile, openUrl, parseBoard } from '@/ui/boardIo'
import { CommandPalette } from '@/ui/CommandPalette'
import { CommentThread } from '@/ui/CommentThread'
import { ContextToolbar } from '@/ui/ContextToolbar'
import { ShortcutsDialog, TemplatesDialog } from '@/ui/Dialogs'
import { FramesPanel } from '@/ui/FramesPanel'
import { VersionsPanel } from '@/ui/VersionsPanel'
import { Presenter } from '@/ui/Presenter'
import { Toolbar } from '@/ui/Toolbar'
import { TopBar } from '@/ui/TopBar'
import { useShortcuts } from '@/ui/useShortcuts'
import { useUi } from '@/ui/uiStore'
import { ZoomBar } from '@/ui/ZoomBar'

const LAST = 'jiro.lastBoard'

function boardFromTemplate(templateId?: string): BoardDoc {
  const t = TEMPLATES.find((x) => x.id === templateId)
  const doc = emptyBoard(t ? t.name : 'Untitled board')
  if (t) {
    const objs = instantiate(t, 0, 0)
    const frames = objs.filter((o) => o.kind === 'frame')
    const rest = objs.filter((o) => o.kind !== 'frame')
    for (const o of objs) doc.objects[o.id] = o
    doc.order = [...frames, ...rest].map((o) => o.id)
  }
  return doc
}

export default function App() {
  const doc = useBoard((s) => s.doc)
  const presenting = useUi((s) => s.presenting)
  const [booted, setBooted] = useState(false)

  const open = useCallback(async (d: BoardDoc, fit = false) => {
    // The board's CRDT, saved to IndexedDB on every change (see persist.ts)
    await crdtProvider?.destroy()
    crdtProvider = null
    try {
      const c = await openBoardCrdt(d, { keepStored: !!getLiveInfo(d.id) })
      crdtProvider = c.provider
      useBoard.getState().open(d, c.ydoc)
    } catch (e) {
      console.warn('CRDT storage unavailable, editing without it', e)
      useBoard.getState().open(d)
    }
    // Live boards reconnect to their session (the local copy opens first, so offline still works)
    const info = getLiveInfo(d.id)
    const ydoc = useBoard.getState().ydoc
    if (info && ydoc) startLive(d.id, ydoc, info)
    else stopLive()
    try { localStorage.setItem(LAST, d.id) } catch { /* private mode */ }
    scanForMe(d)
    // Version history: keep the board as it was when opened (skipped when unchanged since the last version)
    void autoVersion(d, 'Opened', true).catch((e) => console.warn('version snapshot failed', e))
    if (fit) {
      requestAnimationFrame(() => {
        const objs = d.order.map((id) => d.objects[id]).filter((o) => o && o.kind !== 'connector')
        if (objs.length) {
          const xs = objs.map((o) => rotatedBounds(o))
          const x0 = Math.min(...xs.map((r) => r.x)), y0 = Math.min(...xs.map((r) => r.y))
          useBoard.getState().setVp(vpForRect({ x: x0, y: y0, w: Math.max(...xs.map((r) => r.x + r.w)) - x0, h: Math.max(...xs.map((r) => r.y + r.h)) - y0 }, 100, 1))
        } else useBoard.getState().setVp({ x: stage.w / 2, y: stage.h / 2, zoom: 1 })
      })
    }
  }, [])

  const openById = useCallback(
    async (id: string) => {
      const d = await loadBoard(id)
      if (d) await open(d)
      else toast.error('That board could not be found')
    },
    [open],
  )

  const create = useCallback(
    async (templateId?: string) => {
      await flush()
      const d = boardFromTemplate(templateId)
      await saveBoard(d)
      await open(d, true)
    },
    [open],
  )

  const importFile = useCallback(async () => {
    await flush()
    const d = await importBoardFile()
    if (d) await open(d, true)
  }, [open])

  const goHome = useCallback(async () => {
    await flush()
    useUi.getState().set({ presenting: false, framesPanel: false, voteMode: false })
    stopLive()
    useBoard.getState().close()
    await crdtProvider?.destroy()
    crdtProvider = null
    try { localStorage.removeItem(LAST) } catch { /* ignore */ }
  }, [])

  // Reopen the last board on launch
  useEffect(() => {
    const last = (() => { try { return localStorage.getItem(LAST) } catch { return null } })()
    ;(last ? loadBoard(last) : Promise.resolve(undefined))
      .then((d) => d && open(d))
      .catch(() => {})
      .finally(() => setBooted(true))
  }, [open])

  // Autosave: debounced on every change, plus viewport
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    return useBoard.subscribe((s, prev) => {
      if (!s.doc) return
      if (s.dirty !== prev.dirty || s.vp !== prev.vp) {
        clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, s.dirty !== prev.dirty ? 500 : 1500)
      }
    })
  }, [])
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  // Empty comment pins vanish when you click away
  useEffect(() => {
    return useBoard.subscribe((s, prev) => {
      if (s.selection === prev.selection || !s.doc) return
      for (const id of prev.selection) {
        const o = s.doc.objects[id]
        if (o?.kind === 'comment' && !o.thread.length && !s.selection.includes(id)) {
          // Through the CRDT (a direct state write would be overwritten by the next change); not an undo step
          useBoard.getState().remove([id], { history: false })
        }
      }
    })
  }, [])

  // ⌘-click (or click while presenting) follows an object's link
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey || useUi.getState().presenting)) return
      const id = (e.target as HTMLElement).closest?.('[data-id]')?.getAttribute('data-id')
      const link = id ? useBoard.getState().doc?.objects[id]?.link : undefined
      if (link) void openUrl(link)
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [])

  // ---- shared boards: links (paste, dialog, jiro:// deep links) ----
  const importShared = useCallback(
    async (p: SharePayload) => {
      await flush()
      const from = p.from
      const doc: BoardDoc = {
        ...p.board,
        id: uid(),
        updatedAt: Date.now(),
        sharedBy: from,
        activity: [...(p.board.activity ?? []), { id: uid(), at: p.at, who: from.name, text: 'shared this board' + (p.message ? `: “${p.message}”` : ''), objectId: undefined }].slice(-300),
      }
      await saveBoard(doc)
      if (!isMe(from))
        useNotifications.getState().push({ kind: 'shared', title: `${from.name} shared “${doc.name}”`, body: p.message, boardId: doc.id, boardName: doc.name }, { os: false })
      await open(doc, true)
      toast.success(`Opened “${doc.name}”`, { description: isMe(from) ? 'Your own shared copy.' : `Shared by ${from.name}` })
    },
    [open],
  )
  // ---- live sessions: a jiro://live link joins the room (first time: a new local board for it) ----
  const joinLive = useCallback(
    async (l: NonNullable<ReturnType<typeof parseLiveLink>>) => {
      await flush()
      const known = findLiveBoard(l.room)
      const existing = known ? await loadBoard(known) : undefined
      if (existing) {
        setLiveInfo(existing.id, { server: l.server, room: l.room, token: l.token, role: l.role, key: l.key })
        await open(existing)
      } else {
        const d = emptyBoard(l.name)
        setLiveInfo(d.id, { server: l.server, room: l.room, token: l.token, role: l.role, key: l.key })
        await saveBoard(d)
        await open(d)
      }
      toast.success(`Joined “${l.name}”`, { description: (l.role === 'view' ? 'View only' : 'Editing live with your team') + (l.key ? ' · end-to-end encrypted' : '') })
    },
    [open],
  )
  useEffect(() => {
    const onLink = async (e: Event) => {
      try {
        const text = String((e as CustomEvent).detail ?? '')
        const live = parseLiveLink(text)
        if (live) return await joinLive(live)
        await importShared(await readShareLink(text))
      } catch (err) {
        toast.error('Could not open that link', { description: (err as Error).message })
      }
    }
    window.addEventListener('jiro:open-link', onLink)
    // On the home screen there's no canvas paste handler: a pasted link still opens
    const onPaste = (e: ClipboardEvent) => {
      if (useBoard.getState().doc || (e.target as HTMLElement)?.closest?.('input, textarea')) return
      const t = e.clipboardData?.getData('text/plain') ?? ''
      if (/jiro:\/\/(open\?b=|live\?)/.test(t)) window.dispatchEvent(new CustomEvent('jiro:open-link', { detail: t }))
    }
    window.addEventListener('paste', onPaste)
    // Desktop: jiro:// links clicked in Mail / browsers open here
    let unlisten: (() => void) | undefined
    if (isTauri())
      void import('@tauri-apps/plugin-deep-link')
        .then(async (dl) => {
          const first = await dl.getCurrent().catch(() => null)
          if (first?.length) window.dispatchEvent(new CustomEvent('jiro:open-link', { detail: first.join(' ') }))
          unlisten = await dl.onOpenUrl((urls) => window.dispatchEvent(new CustomEvent('jiro:open-link', { detail: urls.join(' ') })))
          const { listen } = await import('@tauri-apps/api/event')
          const off = await listen<string>('jiro-open-link', (ev) => window.dispatchEvent(new CustomEvent('jiro:open-link', { detail: ev.payload })))
          // "Use WhatsApp app" in the WhatsApp window's help bar: remember the choice
          const offWa = await listen<string>('jiro-whatsapp-mode', () => {
            setWhatsappMode('app')
            toast.message('Using the WhatsApp app from now on', { description: 'Switch back any time in Share → “WhatsApp opens inside Jiro”.' })
          })
          const prev = unlisten
          unlisten = () => { prev?.(); off(); offWa() }
        })
        .catch(() => {})
    return () => {
      window.removeEventListener('jiro:open-link', onLink)
      window.removeEventListener('paste', onPaste)
      unlisten?.()
    }
  }, [importShared, joinLive])

  // Know up front whether the WhatsApp app is installed (decides where WhatsApp messages go)
  useEffect(() => {
    void detectWhatsAppApp()
  }, [])

  // ---- reminders: due today / overdue tasks assigned to me (current board every minute, all boards every 15) ----
  useEffect(() => {
    const scanAll = async () => {
      for (const m of await listBoards().catch(() => [])) {
        const d = m.id === useBoard.getState().doc?.id ? useBoard.getState().doc : await loadBoard(m.id).catch(() => undefined)
        if (d) scanForMe(d)
      }
    }
    void scanAll()
    const a = setInterval(() => { const d = useBoard.getState().doc; if (d) scanForMe(d) }, 60_000)
    const b = setInterval(() => void scanAll(), 15 * 60_000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])

  useEffect(() => setBoardOpener(async (id) => { await flush(); await openById(id) }), [openById])

  const handlers = useMemo(() => ({ onNew: () => void create(), onOpenFile: () => void importFile() }), [create, importFile])
  useShortcuts(handlers)

  // Drop a .jiro file anywhere to open it
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault()
    const drop = async (e: DragEvent) => {
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.name.endsWith('.jiro'))
      if (!f) return
      e.preventDefault()
      e.stopPropagation()
      try {
        const d = parseBoard(await f.text())
        await flush()
        await saveBoard(d)
        await open(d, true)
      } catch {
        toast.error('That file is not a Jiro board')
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop, true)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop, true)
    }
  }, [open])

  return (
    <TooltipProvider delayDuration={350}>
      {!booted ? null : doc ? (
        <div className="relative h-full w-full overflow-hidden" data-board-view>
          <Canvas />
          {!presenting && (
            <>
              <TopBar onHome={() => void goHome()} onNew={() => void create()} onOpenFile={() => void importFile()} />
              <Toolbar />
              <FramesPanel />
              <TasksPanel />
              <NotesPanel />
              <VersionsPanel />
              <ContextToolbar />
              <CommentThread />
              <ZoomBar />
              {doc.order.length === 0 && <EmptyHint />}
            </>
          )}
          {!presenting && (
            <div className="jiro-ai">
              <AiAssistant adapter={jiroAdapter} />
            </div>
          )}
          <Presenter />
          <CommandPalette />
          <ShortcutsDialog />
          <TemplatesDialog />
          <ShareDialog />
        </div>
      ) : (
        <Home onOpen={(id) => void openById(id)} onCreate={(t) => void create(t)} onImport={() => void importFile()} />
      )}
      <TeamDialog />
      <OpenLinkDialog />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}

function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="text-center text-muted-foreground">
        <div className="mb-1 text-lg font-semibold text-foreground/70">Your board is empty</div>
        <div className="text-sm">
          Press <kbd className="rounded border bg-card px-1.5">N</kbd> for a sticky note, <kbd className="rounded border bg-card px-1.5">⇧T</kbd> for templates, or{' '}
          <kbd className="rounded border bg-card px-1.5">⌘K</kbd> for everything else.
        </div>
      </div>
    </div>
  )
}

let lastSaveError = 0
/** y-indexeddb connection of the open board (one at a time) */
let crdtProvider: { destroy(): Promise<void> | void } | null = null

/** Persist the open board now (also called before switching boards) */
export async function flush() {
  const { doc, vp } = useBoard.getState()
  if (!doc) return
  try {
    await saveBoard({ ...doc, viewport: vp })
    void autoVersion(doc).catch((e) => console.warn('version snapshot failed', e))
  } catch (e) {
    // Tell the user (at most once a minute) rather than failing silently
    console.warn('autosave failed', e)
    if (Date.now() - lastSaveError > 60_000) {
      lastSaveError = Date.now()
      toast.error('Could not save the board', { description: 'Use Save as .jiro file to keep a copy.' })
    }
  }
}

