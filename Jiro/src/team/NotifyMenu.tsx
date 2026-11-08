import { Mail, MessageCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import type { BoardDoc, CardObj, Person } from '@/board/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { openUrl } from '@/ui/boardIo'
import { logActivity, mailtoUrl, makeShareLink, taskMessage } from './collab'
import { sendWhatsApp } from './whatsapp'
import { findMember } from './team'

/** Email / WhatsApp someone about a task, with the board link attached */
export async function notifyPerson(doc: BoardDoc, card: CardObj, p: Person, via: 'email' | 'whatsapp') {
  const m = findMember(p) ?? p
  const email = m.email ?? p.email
  const phone = m.phone ?? p.phone
  if (via === 'email' && !email) return toast.error(`No email for ${p.name}`, { description: 'Add it in Team.' })
  let link: string | null = null
  try {
    const r = await makeShareLink(doc)
    link = r.chars < 60_000 ? r.link : null
  } catch { /* send without link */ }
  const msg = taskMessage(doc, card, p, link)
  if (via === 'email') await openUrl(mailtoUrl([email!], msg.subject, msg.body))
  else await sendWhatsApp(`${msg.subject}\n\n${msg.body}`, phone)
  logActivity(`notified ${p.name} about “${card.title}” by ${via === 'email' ? 'email' : 'WhatsApp'}`, card.id)
}

export function NotifyMenu({ doc, card, people, children }: { doc: BoardDoc; card: CardObj; people: Person[]; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" data-keep-editing>
        <DropdownMenuLabel className="flex items-center gap-1.5"><Send className="size-3.5" /> Notify about this task</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!people.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">Assign someone first.</div>}
        {people.map((p) => (
          <div key={p.id}>
            <DropdownMenuItem onSelect={() => void notifyPerson(doc, card, p, 'email')}><Mail /> Email {p.name}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void notifyPerson(doc, card, p, 'whatsapp')}><MessageCircle /> WhatsApp {p.name}</DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
