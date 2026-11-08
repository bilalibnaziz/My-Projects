import { describe, expect, it } from 'vitest'
import { emptyBoard, makeCard, makeImage, makeSticky } from '@/board/factory'
import type { CardObj, Person } from '@/board/types'
import { dueState, hasShareLink, makeShareLink, openChecklist, parseMentions, readShareLink, splitAssignee, todayIso } from '@/team/collab'

const P = (name: string, email?: string): Person => ({ id: name, name, email, color: '#000' })
const people = [P('Maya Lopez'), P('Sam'), P('Sam Reed')]

describe('mentions', () => {
  it('matches full names, prefers the longest, ignores partial words', () => {
    expect(parseMentions('ping @Sam Reed and @maya lopez', people).map((p) => p.name)).toEqual(['Sam Reed', 'Maya Lopez'])
    expect(parseMentions('hi @Samuel', people)).toEqual([])
    expect(parseMentions('cc @Sam, thanks', people).map((p) => p.name)).toEqual(['Sam'])
  })
})

describe('notes checklists', () => {
  it('finds open items only and splits @assignees off the title', () => {
    const notes = 'Intro\n- [ ] Book venue @Sam Reed\n* [ ] Order prints\n- [x] Done thing\n-[ ] not a checklist'
    expect(openChecklist(notes)).toEqual(['Book venue @Sam Reed', 'Order prints'])
    const r = splitAssignee('Book venue @Sam Reed', people)
    expect(r.title).toBe('Book venue')
    expect(r.who.map((p) => p.name)).toEqual(['Sam Reed'])
  })
})

describe('due dates', () => {
  it('classifies overdue / today / soon / later, and done tasks are never due', () => {
    const c = (due: string, status: CardObj['status'] = 'todo') => ({ ...makeCard(0, 0), due, status })
    const t = todayIso()
    const plus = (d: number) => { const x = new Date(Date.parse(t) + d * 86_400_000); return x.toISOString().slice(0, 10) }
    expect(dueState(c('2001-01-01'))).toBe('overdue')
    expect(dueState(c(t))).toBe('today')
    expect(dueState(c(plus(2)))).toBe('soon')
    expect(dueState(c(plus(20)))).toBe('later')
    expect(dueState(c('2001-01-01', 'done'))).toBe('none')
  })
})

describe('share links', () => {
  it('round-trips a board through a compact jiro:// link, without images', async () => {
    const d = emptyBoard('Plan')
    const s = makeSticky(0, 0, '#fff176', 'Ship it ✨ — ünïcode')
    const img = makeImage(0, 0, 'data:image/png;base64,' + 'A'.repeat(20000), 10, 10)
    d.objects[s.id] = s
    d.objects[img.id] = img
    d.order.push(s.id, img.id)
    const { link, images, chars } = await makeShareLink(d, 'hello')
    expect(link.startsWith('jiro://open?b=')).toBe(true)
    expect(images).toBe(1)
    expect(chars).toBeLessThan(2000)
    expect(hasShareLink(`see ${link} thanks`)).toBe(true)
    const p = await readShareLink(`Hey!\n${link}\n— me`)
    expect(p.message).toBe('hello')
    expect(p.board.order).toEqual([s.id])
    expect(p.board.objects[s.id]).toMatchObject({ text: 'Ship it ✨ — ünïcode' })
  })
  it('explains damaged or foreign links', async () => {
    await expect(readShareLink('no link here')).rejects.toThrow(/No Jiro link/)
    await expect(readShareLink('jiro://open?b=AAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toThrow(/incomplete or damaged/)
  })
})

describe('whatsapp', () => {
  it('builds web.whatsapp.com chat links with the message, digits-only numbers', async () => {
    const { whatsappWebUrl, whatsappMode } = await import('@/team/whatsapp')
    expect(whatsappWebUrl('Hi & bye ✨', '+44 7700-900123')).toBe('https://web.whatsapp.com/send?phone=447700900123&text=Hi%20%26%20bye%20%E2%9C%A8')
    expect(whatsappWebUrl('Hi')).toBe('https://web.whatsapp.com/')
    expect(whatsappMode()).toBe('app') // not in Tauri → the WhatsApp app / wa.me
  })
})

describe('whatsapp app links', () => {
  it('builds whatsapp://send links for the desktop app', async () => {
    const { whatsappAppUrl } = await import('@/team/whatsapp')
    expect(whatsappAppUrl('Hi & bye', '+44 7700-900123')).toBe('whatsapp://send?phone=447700900123&text=Hi%20%26%20bye')
    expect(whatsappAppUrl('Hi')).toBe('whatsapp://send?text=Hi')
  })
})
