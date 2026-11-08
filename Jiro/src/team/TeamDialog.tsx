import { Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useUi } from '@/ui/uiStore'
import { Avatar } from './Avatar'
import { MEMBER_COLORS, useTeam, type Member } from './team'

function MemberForm({ init, onSave, onCancel, self = false }: { init?: Partial<Member>; onSave(m: Partial<Member>): void; onCancel(): void; self?: boolean }) {
  const [m, setM] = useState<Partial<Member>>(init ?? { color: MEMBER_COLORS[1] })
  const f = (k: keyof Member) => (e: React.ChangeEvent<HTMLInputElement>) => setM({ ...m, [k]: e.target.value })
  return (
    <form
      className="grid gap-2 rounded-lg border bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (m.name?.trim()) onSave(m)
      }}
      data-member-form
    >
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Name" aria-label="Name" value={m.name ?? ''} onChange={f('name')} autoFocus required />
        <Input placeholder={self ? 'Your role (optional)' : 'Role (optional)'} aria-label="Role" value={m.role ?? ''} onChange={f('role')} />
        <Input type="email" placeholder="Email" aria-label="Email" value={m.email ?? ''} onChange={f('email')} />
        <Input type="tel" placeholder="WhatsApp number, e.g. +44 7700 900123" aria-label="WhatsApp number" value={m.phone ?? ''} onChange={f('phone')} />
      </div>
      <div className="flex items-center gap-1.5">
        {MEMBER_COLORS.map((c) => (
          <button type="button" key={c} aria-label={`Colour ${c}`} onClick={() => setM({ ...m, color: c })} className={cn('size-6 rounded-full', m.color === c && 'ring-2 ring-ring ring-offset-2 ring-offset-background')} style={{ background: c }} />
        ))}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm">Save</Button>
        </div>
      </div>
    </form>
  )
}

export function TeamDialog() {
  const open = useUi((s) => s.teamOpen)
  const { me, members, setMe, upsert, remove } = useTeam()
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={(o) => { useUi.getState().set({ teamOpen: o }); setEditing(null) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-ui data-team-dialog>
        <DialogHeader>
          <DialogTitle>Team</DialogTitle>
          <DialogDescription>People you assign tasks to and share boards with. Email and WhatsApp numbers are used to notify them; they stay on this computer.</DialogDescription>
        </DialogHeader>

        <section>
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">You</div>
          {editing === 'me' ? (
            <MemberForm self init={me} onCancel={() => setEditing(null)} onSave={(m) => { setMe({ name: m.name!.trim(), email: m.email?.trim() || undefined, phone: m.phone?.replace(/[^\d+]/g, '') || undefined, role: m.role?.trim() || undefined, color: m.color ?? me.color }); setEditing(null) }} />
          ) : (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Avatar p={me} size={36} ring={false} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{me.name}{me.name === 'You' && <span className="ml-2 text-xs text-amber-600">set your name so teammates know it’s you</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{[me.role, me.email, me.phone].filter(Boolean).join(' · ') || 'No contact details yet'}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing('me')} data-edit-me><UserRound /> Edit profile</Button>
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Teammates · {members.length}</div>
            {editing !== 'new' && <Button className="ml-auto" size="sm" onClick={() => setEditing('new')} data-add-member><Plus /> Add teammate</Button>}
          </div>
          <div className="grid gap-2">
            {editing === 'new' && <MemberForm onCancel={() => setEditing(null)} onSave={(m) => { upsert({ name: m.name!, email: m.email, phone: m.phone, role: m.role, color: m.color }); setEditing(null) }} />}
            {!members.length && editing !== 'new' && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No teammates yet. Add the people you work with to assign them tasks and share boards in one click.</p>}
            {members.map((m) =>
              editing === m.id ? (
                <MemberForm key={m.id} init={m} onCancel={() => setEditing(null)} onSave={(v) => { upsert({ ...m, ...v, id: m.id, name: v.name! }); setEditing(null) }} />
              ) : (
                <div key={m.id} className="group flex items-center gap-3 rounded-lg border p-3" data-member={m.name}>
                  <Avatar p={m} size={32} ring={false} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.name}{m.role && <span className="ml-2 text-xs font-normal text-muted-foreground">{m.role}</span>}</div>
                    <div className="truncate text-xs text-muted-foreground">{[m.email, m.phone].filter(Boolean).join(' · ') || 'No contact details'}</div>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m.id)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} onClick={() => remove(m.id)}><Trash2 /></Button>
                </div>
              ),
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
