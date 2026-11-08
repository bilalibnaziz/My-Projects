import { invoke } from '@tauri-apps/api/core'
import { Check, ClipboardCopy, FileDown, FileText, Link2, Mail, MessageCircle, NotebookText, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { boardToPdf } from '@/board/pdf'
import { useBoard } from '@/board/store'
import type { FrameObj } from '@/board/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isTauri, safeName, saveFile } from '@/lib/files'
import { cn } from '@/lib/utils'
import { openUrl, serializeBoard } from '@/ui/boardIo'
import { useUi } from '@/ui/uiStore'
import { Avatar } from './Avatar'
import { boardMarkdown, boardMessage, logActivity, mailtoUrl, makeShareLink } from './collab'
import { detectWhatsAppApp, openWhatsAppWindow, sendWhatsApp, setWhatsappMode, whatsappMode, type WhatsAppMode } from './whatsapp'
import { useTeam } from './team'
import { LiveSection } from '@/sync/LiveSection'

const WHATSAPP_MAX = 60_000

async function revealIfDesktop(path: string | null) {
  if (path && isTauri()) await invoke('reveal_path', { path }).catch(() => {})
}

export function ShareDialog() {
  const open = useUi((s) => s.shareOpen)
  const doc = useBoard((s) => s.doc)
  const members = useTeam((s) => s.members)
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [link, setLink] = useState<{ link: string; images: number; chars: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [waMode, setWaMode] = useState<WhatsAppMode>(whatsappMode)
  useEffect(() => {
    if (open) void detectWhatsAppApp().then(() => setWaMode(whatsappMode()))
  }, [open])

  useEffect(() => {
    if (!open || !doc) return
    setCopied(false)
    let live = true
    void makeShareLink(doc, note).then((r) => live && setLink(r)).catch(() => live && setLink(null))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.updatedAt, note])

  if (!doc) return null
  const people = members.filter((m) => picked.includes(m.id))
  const linkOk = !!link && link.chars < WHATSAPP_MAX
  const msg = boardMessage(doc, linkOk ? link!.link : null, note)
  const names = people.map((p) => p.name).join(', ')

  const email = async () => {
    const to = people.map((p) => p.email).filter((e): e is string => !!e)
    const missing = people.filter((p) => !p.email).map((p) => p.name)
    if (missing.length) toast.message(`No email for ${missing.join(', ')}`, { description: 'Add it in Team; they were left out.' })
    await openUrl(mailtoUrl(to, msg.subject, msg.body))
    logActivity(`shared the board by email${names ? ' with ' + names : ''}`)
  }
  const whatsapp = async () => {
    const text = `*${msg.subject}*\n\n${msg.body}`
    const withPhone = people.filter((p) => p.phone)
    if (withPhone.length > 1) toast.message('WhatsApp opens one chat at a time', { description: `Opening ${withPhone[0].name} — send again for the others, or pick nobody to choose a chat or group in WhatsApp.` })
    await sendWhatsApp(text, withPhone[0]?.phone)
    logActivity(`shared the board on WhatsApp${withPhone[0] ? ' with ' + withPhone[0].name : ''}`)
  }
  const copyLink = async () => {
    if (!link) return
    await navigator.clipboard.writeText(msg.body).catch(() => {})
    setCopied(true)
    toast.success('Link copied with a short message', { description: 'Teammates paste it into Jiro (or click it) to open the board.' })
    logActivity('copied a share link')
  }
  const saveJiro = async () => {
    const p = await saveFile(`${safeName(doc.name)}.jiro`, new Blob([serializeBoard({ ...doc, viewport: useBoard.getState().vp })], { type: 'application/json' }), { name: 'Jiro board', extensions: ['jiro'] })
    if (p) {
      toast.success('Saved — attach it to an email or chat', { description: p })
      await revealIfDesktop(p)
      logActivity('shared the board as a .jiro file')
    }
  }
  const savePdf = async () => {
    const frames = doc.order.map((id) => doc.objects[id]).filter((o): o is FrameObj => o?.kind === 'frame')
    const blob = await boardToPdf(doc, frames)
    if (!blob) return toast.message('Nothing to export yet')
    const p = await saveFile(`${safeName(doc.name)}.pdf`, blob, { name: 'PDF document', extensions: ['pdf'] })
    if (p) {
      toast.success('PDF saved — ready to attach', { description: p })
      await revealIfDesktop(p)
      logActivity('shared the board as a PDF')
    }
  }
  const copyDoc = async () => {
    await navigator.clipboard.writeText(boardMarkdown(doc)).catch(() => {})
    toast.success('Copied as a document', { description: 'Paste into Google Docs, Notion, an email or Slack.' })
  }
  const saveDoc = async () => {
    const p = await saveFile(`${safeName(doc.name)}.md`, new Blob([boardMarkdown(doc)], { type: 'text/markdown' }), { name: 'Markdown document', extensions: ['md'] })
    if (p) await revealIfDesktop(p)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => useUi.getState().set({ shareOpen: o })}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl" data-ui data-share-dialog>
        <DialogHeader>
          <DialogTitle>Share “{doc.name}”</DialogTitle>
          <DialogDescription>Send a copy to your team. A Jiro link carries the whole board (without images), so it opens on their computer with tasks, comments and notes.</DialogDescription>
        </DialogHeader>

        <LiveSection />

        <section className="border-t pt-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Users className="size-4" /> Send to</div>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => {
              const on = picked.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id])}
                  className={cn('flex items-center gap-1.5 rounded-full border py-0.5 pr-3 pl-0.5 text-sm transition', on ? 'border-transparent bg-[#4262ff] text-white' : 'hover:bg-accent')}
                  aria-pressed={on}
                  data-share-to={m.name}
                >
                  <Avatar p={m} size={24} ring={false} />
                  {m.name}
                  {on && <Check className="size-3.5" />}
                </button>
              )
            })}
            <button onClick={() => useUi.getState().set({ teamOpen: true })} className="flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent">
              <UserPlus className="size-3.5" /> {members.length ? 'Add' : 'Add teammates'}
            </button>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a message (optional)"
            aria-label="Message"
            rows={2}
            className="mt-3 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button onClick={() => void email()} className="bg-[#4262ff] text-white hover:bg-[#3451e6]" data-share="email"><Mail /> Email</Button>
            <Button onClick={() => void whatsapp()} className="bg-[#25d366] text-[#073b1d] hover:bg-[#1fbe5b]" data-share="whatsapp"><MessageCircle /> WhatsApp</Button>
            <Button variant="outline" onClick={() => void copyLink()} disabled={!link} data-share="copy">{copied ? <Check /> : <Link2 />} {copied ? 'Copied' : 'Copy link'}</Button>
          </div>
          {isTauri() && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-wa-mode>
              WhatsApp opens
              <div className="flex rounded-md bg-muted p-0.5">
                {(['inside', 'app'] as WhatsAppMode[]).map((m) => (
                  <button key={m} onClick={() => { setWhatsappMode(m); setWaMode(m) }} className={cn('rounded px-2 py-0.5', waMode === m ? 'bg-card font-medium text-foreground shadow-sm' : 'hover:text-foreground')}>
                    {m === 'inside' ? 'inside Jiro' : 'in the WhatsApp app'}
                  </button>
                ))}
              </div>
              <button className="ml-auto underline-offset-2 hover:text-foreground hover:underline" onClick={() => void openWhatsAppWindow()}>{waMode === 'inside' ? 'Log in / open WhatsApp' : 'Open WhatsApp'}</button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground" data-link-status>
            {!link ? 'Preparing link…' : linkOk
              ? `Link ready · ${(link.chars / 1000).toFixed(1)}k characters${link.images ? ` · ${link.images} image${link.images > 1 ? 's' : ''} not included (share the file for those)` : ''}.`
              : 'This board is too big for a chat link — share it as a .jiro file or PDF below.'}
          </p>
        </section>

        <section className="border-t pt-4">
          <div className="mb-2 text-sm font-medium">Share as a file or document</div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void saveJiro()} className="justify-start"><FileDown /> Jiro file (.jiro)</Button>
            <Button variant="outline" onClick={() => void savePdf()} className="justify-start"><FileText /> PDF, a page per frame</Button>
            <Button variant="outline" onClick={() => void copyDoc()} className="justify-start" data-share="copy-doc"><ClipboardCopy /> Copy as document</Button>
            <Button variant="outline" onClick={() => void saveDoc()} className="justify-start"><NotebookText /> Save as Markdown doc</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{isTauri() ? 'Saved files are shown in Finder so you can drag them into Mail, WhatsApp or Drive.' : 'Files download so you can attach them anywhere.'}</p>
        </section>
      </DialogContent>
    </Dialog>
  )
}
