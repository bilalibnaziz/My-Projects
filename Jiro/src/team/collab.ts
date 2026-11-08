import { textOf } from '@/board/actions'
import { uid } from '@/board/geometry'
import { useBoard } from '@/board/store'
import type { ActivityEntry, BoardDoc, BoardObj, CardObj, CommentObj, ID, Person } from '@/board/types'
import { useNotifications } from './notifications'
import { isMe, toPerson, useTeam } from './team'

// ---------------------------------------------------------------- activity

/** Append to the open board's activity log (not an undo step; persisted with the board) */
export function logActivity(text: string, objectId?: ID) {
  const s = useBoard.getState()
  if (!s.doc) return
  const entry: ActivityEntry = { id: uid(), at: Date.now(), who: useTeam.getState().me.name, text, objectId }
  s.setMeta({ activity: [...(s.doc.activity ?? []), entry].slice(-300) })
}

// ---------------------------------------------------------------- tasks

export const assigneesOf = (c: CardObj): Person[] =>
  c.assignees?.length ? c.assignees : c.assignee ? [{ id: 'legacy:' + c.assignee, name: c.assignee, color: c.tag }] : []

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none'
export function dueState(c: CardObj): DueState {
  if (!c.due || c.status === 'done') return 'none'
  const t = todayIso()
  if (c.due < t) return 'overdue'
  if (c.due === t) return 'today'
  const days = (Date.parse(c.due) - Date.parse(t)) / 86_400_000
  return days <= 3 ? 'soon' : 'later'
}

export function cardsOf(doc: BoardDoc): CardObj[] {
  return doc.order.map((id) => doc.objects[id]).filter((o): o is CardObj => o?.kind === 'card')
}

/** Set a card's assignees; notifies you if you were added, logs who changed what */
export function setAssignees(cardId: ID, people: Person[]) {
  const s = useBoard.getState()
  const c = s.doc?.objects[cardId]
  if (c?.kind !== 'card') return
  const before = assigneesOf(c)
  const added = people.filter((p) => !before.some((b) => b.id === p.id))
  const removed = before.filter((b) => !people.some((p) => p.id === b.id))
  s.update(cardId, { assignees: people, assignee: undefined } as Partial<BoardObj>)
  for (const p of added) {
    logActivity(`assigned “${c.title}” to ${p.name}`, cardId)
    if (isMe(p))
      useNotifications.getState().push({ key: `assigned:${s.doc!.id}:${cardId}`, kind: 'assigned', title: `You were assigned “${c.title}”`, body: c.due ? `Due ${c.due}` : undefined, boardId: s.doc!.id, boardName: s.doc!.name, objectId: cardId }, { os: false })
  }
  for (const p of removed) logActivity(`unassigned ${p.name} from “${c.title}”`, cardId)
}

export function setStatus(cardId: ID, status: CardObj['status']) {
  const s = useBoard.getState()
  const c = s.doc?.objects[cardId]
  if (c?.kind !== 'card' || c.status === status) return
  s.update(cardId, { status } as Partial<BoardObj>)
  logActivity(`moved “${c.title}” to ${status === 'done' ? 'Done' : status === 'doing' ? 'In progress' : 'To do'}`, cardId)
}

/**
 * Turn new things that concern me on a board into notifications: tasks assigned to me, @mentions of
 * me, due/overdue reminders. Each fires once (keyed). Used on open/import and on a timer.
 */
export function scanForMe(doc: BoardDoc, opts: { reminders?: boolean; os?: boolean } = {}) {
  const push = useNotifications.getState().push
  const os = opts.os ?? true
  for (const id of doc.order) {
    const o = doc.objects[id]
    if (o?.kind === 'card') {
      const mine = assigneesOf(o).some(isMe)
      if (!mine) continue
      push({ key: `assigned:${doc.id}:${o.id}`, kind: 'assigned', title: `${doc.sharedBy && !isMe(doc.sharedBy) ? doc.sharedBy.name + ' assigned you' : 'Assigned to you'}: “${o.title}”`, body: o.due ? `Due ${o.due}` : undefined, boardId: doc.id, boardName: doc.name, objectId: o.id }, { os: os && !!doc.sharedBy })
      if (opts.reminders !== false) {
        const ds = dueState(o)
        if (ds === 'today') push({ key: `due:${doc.id}:${o.id}:${o.due}`, kind: 'due', title: `Due today: “${o.title}”`, body: doc.name, boardId: doc.id, boardName: doc.name, objectId: o.id }, { os })
        if (ds === 'overdue') push({ key: `overdue:${doc.id}:${o.id}:${o.due}`, kind: 'overdue', title: `Overdue: “${o.title}”`, body: `Was due ${o.due} · ${doc.name}`, boardId: doc.id, boardName: doc.name, objectId: o.id }, { os })
      }
    }
    if (o?.kind === 'comment') {
      for (const m of o.thread) {
        if (!m.mentions?.some(isMe) || isMe({ id: '', name: m.author, email: m.authorEmail, color: '' })) continue
        push({ key: `mention:${doc.id}:${m.id}`, kind: 'mention', title: `${m.author} mentioned you`, body: m.text.slice(0, 140), boardId: doc.id, boardName: doc.name, objectId: o.id }, { os })
      }
    }
  }
}

// ---------------------------------------------------------------- mentions

/** People @mentioned in a comment, matched against the roster. Longer names claim their text first,
 *  so "@Sam Reed" doesn't also count as a mention of a teammate called "Sam". */
export function parseMentions(text: string, people: Person[]): Person[] {
  const out: Person[] = []
  const taken: [number, number][] = []
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length)
  const lower = text.toLowerCase()
  for (const p of sorted) {
    const tag = '@' + p.name.toLowerCase()
    for (let i = lower.indexOf(tag); i >= 0; i = lower.indexOf(tag, i + 1)) {
      const end = i + tag.length
      const after = lower[end]
      if (after && /[\p{L}\p{N}_]/u.test(after)) continue
      if (taken.some(([a, b]) => i >= a && i < b)) continue
      taken.push([i, end])
      if (!out.some((x) => x.id === p.id)) out.push(p)
    }
  }
  // keep reading order
  return out.sort((a, b) => lower.indexOf('@' + a.name.toLowerCase()) - lower.indexOf('@' + b.name.toLowerCase()))
}

export function addComment(commentId: ID, text: string, people: Person[]) {
  const s = useBoard.getState()
  const c = s.doc?.objects[commentId] as CommentObj | undefined
  if (!c || c.kind !== 'comment') return
  const me = useTeam.getState().me
  const mentions = parseMentions(text, people)
  s.update(commentId, { thread: [...c.thread, { id: uid(), author: me.name, authorEmail: me.email, text, at: Date.now(), mentions: mentions.length ? mentions : undefined }] } as Partial<BoardObj>)
  logActivity(`commented: “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}”`, commentId)
  return mentions
}

// ---------------------------------------------------------------- share links

export const LINK_PREFIX = 'jiro://open?b='

const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Response(bytes as BodyInit).body!.pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

export interface SharePayload {
  v: 1
  board: BoardDoc
  from: Person
  message?: string
  at: number
}

/** The board as a self-contained link. Images are left out (they'd make links megabytes long). */
export async function makeShareLink(doc: BoardDoc, message?: string): Promise<{ link: string; images: number; chars: number }> {
  let images = 0
  const objects: Record<ID, BoardObj> = {}
  const order: ID[] = []
  for (const id of doc.order) {
    const o = doc.objects[id]
    if (!o) continue
    if (o.kind === 'image') {
      images++
      continue
    }
    objects[id] = o
    order.push(id)
  }
  const me = toPerson(useTeam.getState().me)
  const payload: SharePayload = { v: 1, at: Date.now(), from: me, message: message?.trim() || undefined, board: { ...doc, objects, order, thumbnail: undefined, sharedBy: undefined } }
  const zipped = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'))
  const link = LINK_PREFIX + b64url(zipped)
  return { link, images, chars: link.length }
}

/** Finds a Jiro link inside any text (an email body, a WhatsApp message) and decodes it */
export async function readShareLink(text: string): Promise<SharePayload> {
  const m = /jiro:\/\/open\?b=([A-Za-z0-9_-]+)/.exec(text)
  if (!m) throw new Error('No Jiro link found in that text.')
  let json: string
  try {
    json = new TextDecoder().decode(await pipe(unb64url(m[1]), new DecompressionStream('deflate-raw')))
  } catch {
    throw new Error('The link is incomplete or damaged — ask for it again (some apps cut long messages).')
  }
  const p = JSON.parse(json) as SharePayload
  if (p?.v !== 1 || !p.board?.objects || !Array.isArray(p.board.order)) throw new Error('Not a Jiro board link.')
  return p
}

export const hasShareLink = (text: string) => /jiro:\/\/open\?b=[A-Za-z0-9_-]{20,}|jiro:\/\/live\?\S+/.test(text)

// ---------------------------------------------------------------- messages & documents

export function taskLines(doc: BoardDoc, filter?: (c: CardObj) => boolean): string[] {
  return cardsOf(doc)
    .filter((c) => !filter || filter(c))
    .map((c) => {
      const who = assigneesOf(c).map((p) => p.name).join(', ')
      return `${c.status === 'done' ? '✅' : c.status === 'doing' ? '🔄' : '⬜'} ${c.title}${who ? ` — ${who}` : ''}${c.due ? ` (due ${c.due})` : ''}`
    })
}

export function boardMessage(doc: BoardDoc, link: string | null, note?: string): { subject: string; body: string } {
  const me = useTeam.getState().me
  const tasks = taskLines(doc, (c) => c.status !== 'done')
  const lines = [
    note?.trim() ? note.trim() : `Here's the Jiro board “${doc.name}”.`,
    '',
    ...(tasks.length ? ['Open tasks:', ...tasks.slice(0, 15), tasks.length > 15 ? `…and ${tasks.length - 15} more` : '', ''] : []),
    ...(link ? ['Open it in Jiro (click, or copy this whole message and paste it into Jiro):', link, ''] : []),
    `— ${me.name}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === ''))
  return { subject: `${doc.name} — Jiro board`, body: lines.join('\n') }
}

export function taskMessage(doc: BoardDoc, c: CardObj, to: Person, link: string | null): { subject: string; body: string } {
  const me = useTeam.getState().me
  const lines = [
    `Hi ${to.name.split(' ')[0]},`,
    '',
    `You're on “${c.title}”${c.due ? ` — due ${c.due}` : ''}.`,
    c.body ? `\n${c.body}\n` : '',
    `Board: ${doc.name}`,
    ...(link ? ['', 'Open it in Jiro:', link] : []),
    '',
    `— ${me.name}`,
  ].filter((l) => l !== '')
  return { subject: `Task: ${c.title}`, body: lines.join('\n') }
}

export const mailtoUrl = (to: string[], subject: string, body: string) =>
  `mailto:${to.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

/** wa.me opens WhatsApp (desktop app or web) with the text ready; with a number it opens that chat */
export const whatsappUrl = (text: string, phone?: string) => `https://wa.me/${phone ? phone.replace(/[^\d]/g, '') : ''}?text=${encodeURIComponent(text)}`

/** The board as a Markdown document: frames as sections, then stickies, tasks, mind maps, notes */
export function boardMarkdown(doc: BoardDoc): string {
  const out: string[] = [`# ${doc.name}`, '']
  const inFrame = new Set<ID>()
  const frames = doc.order.map((id) => doc.objects[id]).filter((o) => o?.kind === 'frame')
  const bullet = (o: BoardObj) => {
    const t = textOf(o).replace(/\s+/g, ' ').trim()
    if (!t) return null
    if (o.kind === 'card') return taskLines({ ...doc, order: [o.id] })[0]
    return `- ${t}${o.votes ? ` (${o.votes} vote${o.votes > 1 ? 's' : ''})` : ''}`
  }
  for (const f of frames) {
    if (f.kind !== 'frame') continue
    const items = doc.order
      .map((id) => doc.objects[id])
      .filter((o) => o && o.id !== f.id && o.kind !== 'frame' && o.kind !== 'connector' && o.kind !== 'comment' && o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h)
      .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x))
    out.push(`## ${f.title || 'Frame'}`, '')
    for (const o of items) {
      inFrame.add(o.id)
      const l = bullet(o)
      if (l) out.push(l)
    }
    out.push('')
  }
  const rest = doc.order.map((id) => doc.objects[id]).filter((o) => o && !inFrame.has(o.id) && !['frame', 'connector', 'comment', 'mind'].includes(o.kind))
  if (rest.length) {
    out.push(frames.length ? '## Other items' : '## Items', '')
    for (const o of rest) {
      const l = bullet(o)
      if (l) out.push(l)
    }
    out.push('')
  }
  const roots = doc.order.map((id) => doc.objects[id]).filter((o) => o?.kind === 'mind' && !o.parent)
  for (const r of roots) {
    out.push(`## Mind map: ${textOf(r)}`, '')
    const walk = (pid: ID, depth: number) => {
      for (const id of doc.order) {
        const c = doc.objects[id]
        if (c?.kind === 'mind' && c.parent === pid) {
          out.push(`${'  '.repeat(depth)}- ${c.text}`)
          walk(c.id, depth + 1)
        }
      }
    }
    walk(r!.id, 0)
    out.push('')
  }
  if (doc.notes?.trim()) out.push('## Notes', '', doc.notes.trim(), '')
  const comments = doc.order.map((id) => doc.objects[id]).filter((o): o is CommentObj => o?.kind === 'comment' && o.thread.length > 0)
  if (comments.length) {
    out.push('## Comments', '')
    for (const c of comments) for (const m of c.thread) out.push(`- **${m.author}:** ${m.text}`)
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// ---------------------------------------------------------------- notes → tasks

/** Unchecked "- [ ] …" lines in the notes */
export function openChecklist(notes: string): string[] {
  return notes
    .split('\n')
    .map((l) => /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(l)?.[1]?.trim())
    .filter((x): x is string => !!x)
}

/** "@Name" in a checklist line assigns the card */
export function splitAssignee(line: string, people: Person[]): { title: string; who: Person[] } {
  const who = parseMentions(line, people)
  let title = line
  for (const p of who) title = title.replace(new RegExp('@' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')
  return { title: title.replace(/\s{2,}/g, ' ').trim(), who }
}
