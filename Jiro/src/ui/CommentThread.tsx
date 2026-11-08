import { Check, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/team/Avatar'
import { addComment, mailtoUrl } from '@/team/collab'
import { sendWhatsApp } from '@/team/whatsapp'
import { everyone, findMember, isMe, toPerson } from '@/team/team'
import { openUrl } from './boardIo'
import { useBoard } from '@/board/store'
import type { CommentObj } from '@/board/types'

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(t).toLocaleDateString()
}

/** Thread card next to a selected comment pin */
export function CommentThread() {
  const c = useBoard((s) => {
    if (s.selection.length !== 1 || s.tool !== 'select') return null
    const o = s.doc?.objects[s.selection[0]]
    return o?.kind === 'comment' ? o : null
  }) as CommentObj | null
  const vp = useBoard((s) => s.vp)
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    setText('')
    if (c) setTimeout(() => input.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id])
  // @mention autocomplete: the word being typed after "@"
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null)
  const matches = mention ? everyone().filter((m) => m.name.toLowerCase().startsWith(mention.q.toLowerCase())).slice(0, 6) : []
  const pick = (name: string) => {
    if (!mention) return
    const before = text.slice(0, mention.at)
    const after = text.slice(mention.at + 1 + mention.q.length)
    const next = `${before}@${name} ${after}`
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      const el = input.current
      if (el) {
        el.focus()
        el.selectionStart = el.selectionEnd = before.length + name.length + 2
      }
    })
  }
  if (!c) return null
  const x = (c.x + c.w) * vp.zoom + vp.x + 12
  const y = c.y * vp.zoom + vp.y
  const send = () => {
    const t = text.trim()
    if (!t) return
    const people = everyone().map(toPerson)
    const mentioned = (addComment(c.id, t, people) ?? []).filter((p) => !isMe(p))
    setText('')
    setMention(null)
    // Offer to tell the people you mentioned (they also get it in their inbox when the board reaches them)
    for (const p of mentioned) {
      const m = findMember(p) ?? p
      const doc = useBoard.getState().doc!
      const body = `${t}\n\n— on the Jiro board “${doc.name}”`
      if (m.email || m.phone)
        toast(`You mentioned ${p.name}`, {
          description: 'Let them know?',
          action: { label: m.email ? 'Email' : 'WhatsApp', onClick: () => void (m.email ? openUrl(mailtoUrl([m.email], `${doc.name}: you were mentioned`, body)) : sendWhatsApp(body, m.phone)) },
        })
    }
  }
  return (
    <div
      className="jiro-float jiro-pop absolute z-30 w-72 p-0"
      style={{ left: Math.min(x, window.innerWidth - 300), top: Math.max(70, Math.min(y, window.innerHeight - 260)) }}
      data-ui
      data-comment-thread
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="text-sm font-semibold">Comment</span>
        <button
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent"
          onClick={() => useBoard.getState().update(c.id, { resolved: !c.resolved })}
        >
          <Check className="size-3.5" /> {c.resolved ? 'Reopen' : 'Resolve'}
        </button>
        <button aria-label="Delete comment" className="grid size-7 place-items-center rounded-md hover:bg-accent" onClick={() => useBoard.getState().remove([c.id])}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="max-h-56 space-y-3 overflow-y-auto px-3 py-2" data-scrollable>
        {c.thread.map((m) => (
          <div key={m.id} className="flex gap-2">
            <Avatar p={findMember({ id: '', name: m.author, email: m.authorEmail, color: '' }) ?? { id: m.id, name: m.author, color: '#8e8ea0' }} size={28} ring={false} />
            <div className="min-w-0">
              <div className="text-xs">
                <span className="font-semibold">{m.author}</span> <span className="text-muted-foreground">{ago(m.at)}</span>
              </div>
              <div className="text-sm break-words whitespace-pre-wrap">{highlight(m.text, m.mentions?.map((p) => p.name) ?? [])}</div>
            </div>
          </div>
        ))}
        {!c.thread.length && <div className="py-1 text-sm text-muted-foreground">Start the conversation…</div>}
      </div>
      {mention && matches.length > 0 && (
        <div className="border-t p-1" data-mention-menu>
          {matches.map((m) => (
            <button key={m.id} onMouseDown={(e) => { e.preventDefault(); pick(m.name) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent" data-mention={m.name}>
              <Avatar p={m} size={20} ring={false} /> {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5 border-t p-2">
        <textarea
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const pos = e.target.selectionStart ?? e.target.value.length
            const m = /(^|\s)@([\p{L}\p{N}_ ]{0,24})$/u.exec(e.target.value.slice(0, pos))
            setMention(m && !m[2].includes('  ') ? { q: m[2], at: pos - m[2].length - 1 } : null)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (mention && matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault()
              pick(matches[0].name)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
            if (e.key === 'Escape') useBoard.getState().select([])
          }}
          rows={1}
          placeholder="Reply… (@ to mention)"
          aria-label="Reply"
          className="max-h-24 min-h-8 flex-1 resize-none rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button aria-label="Send" onClick={send} className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
          <Send className="size-4" />
        </button>
      </div>
    </div>
  )
}

function highlight(text: string, names: string[]) {
  if (!names.length) return text
  const re = new RegExp('(' + names.map((n) => '@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <span key={i} className="rounded bg-[#4262ff]/12 px-0.5 font-medium text-[#4262ff]">{part}</span> : part))
}
