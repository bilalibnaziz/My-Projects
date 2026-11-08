import { Ban, Eye, KeyRound, Link2, Lock, Pencil, Radio, Square } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useBoard } from '@/board/store'
import { Button } from '@/components/ui/button'
import { newBoardKey } from './websocketProvider'
import { DEFAULT_SERVER, getLiveInfo, leaveLive, liveLink, makeInvite, newOwnerKey, newRoomId, revokeInvites, rotateRoomKey, startLive, useLive } from './live'

/** Share dialog section: start a live session on your sync server and invite people to edit or view. */
export function LiveSection() {
  const doc = useBoard((s) => s.doc)
  const status = useLive((s) => s.status)
  const info = useLive((s) => s.info)
  const [server, setServer] = useState(() => (doc && getLiveInfo(doc.id)?.server) || localStorage.getItem('jiro.live.server') || DEFAULT_SERVER)
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [e2e, setE2e] = useState(true)
  if (!doc) return null
  const live = status !== 'off' && info

  const start = () => {
    const ydoc = useBoard.getState().ydoc
    if (!ydoc) return
    const url = server.trim()
    if (!/^wss?:\/\/.+/.test(url)) return toast.error('Use a ws:// or wss:// server address')
    try { localStorage.setItem('jiro.live.server', url) } catch { /* ignore */ }
    void (async () => {
      const key = e2e ? await newBoardKey() : undefined
      startLive(doc.id, ydoc, { server: url, room: newRoomId(doc.id), owner: newOwnerKey(), role: 'owner', key })
      toast.success('Live session started', { description: e2e ? 'End-to-end encrypted: the server only sees ciphertext. Invite people with an edit or view link.' : 'Invite people with an edit or view link.' })
    })()
  }
  const invite = async (role: 'edit' | 'view') => {
    if (!info) return
    try {
      const token = await makeInvite(info, role, days)
      const link = liveLink(info, token, doc.name)
      setLastLink(link)
      await navigator.clipboard.writeText(link).catch(() => {})
      toast.success(role === 'edit' ? 'Edit link copied' : 'View-only link copied', { description: 'Teammates paste it into Jiro to join.' })
    } catch (e) {
      toast.error('Could not create the invite', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <section data-live-section>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Radio className="size-4" /> Edit together, live</div>
      {!live ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Runs on your own sync server (start it with <code className="rounded bg-muted px-1">npm run server</code>). The board stays saved on this computer, so it keeps working offline and merges when you reconnect.
          </p>
          <div className="flex gap-2">
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              aria-label="Sync server"
              className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              data-live-server
            />
            <Button onClick={start} className="bg-[#4262ff] text-white hover:bg-[#3451e6]" data-action="live-start"><Radio /> Start live session</Button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={e2e} onChange={(e) => setE2e(e.target.checked)} data-live-e2e />
            <Lock className="size-3.5" /> End-to-end encrypted (the key travels in the invite link; the server stores only ciphertext)
          </label>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground" data-live-room={info.room}>
            Live on <span className="font-medium text-foreground">{info.server}</span> · {status === 'synced' ? 'connected' : status}
            {info.key ? ' · end-to-end encrypted' : ''}
            {info.role === 'view' ? ' · you can view only' : ''}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {info.owner ? (
              <>
                <Button variant="outline" onClick={() => void invite('edit')} data-action="live-invite-edit"><Pencil /> Copy edit link</Button>
                <Button variant="outline" onClick={() => void invite('view')} data-action="live-invite-view"><Eye /> Copy view link</Button>
              </>
            ) : (
              <p className="col-span-2 self-center text-xs text-muted-foreground">Only the person who started the session can invite.</p>
            )}
            <Button variant="outline" onClick={() => { leaveLive(doc.id); toast.message('Left the live session', { description: 'The board stays on this computer.' }) }} data-action="live-stop"><Square /> {info.owner ? 'End session' : 'Leave'}</Button>
          </div>
          {info.owner && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              Links work for
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Invite lifetime" className="h-7 rounded-md border bg-background px-1.5 text-xs" data-live-days>
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={0}>until revoked</option>
              </select>
              <button
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
                data-action="live-revoke"
                onClick={async () => {
                  try {
                    const n = await revokeInvites(info)
                    setLastLink(null)
                    toast.success('All invite links revoked', { description: n ? `${n} guest${n === 1 ? '' : 's'} disconnected. New links work as usual.` : 'New links work as usual.' })
                  } catch (e) {
                    toast.error('Could not revoke', { description: e instanceof Error ? e.message : String(e) })
                  }
                }}
              >
                <Ban className="size-3.5" /> Revoke
              </button>
              {info.key && (
                <button
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-amber-600 hover:bg-accent dark:text-amber-400"
                  data-action="live-rotate-key"
                  title="Re-encrypts the server log with a fresh key and revokes old links"
                  onClick={async () => {
                    try {
                      const res = await rotateRoomKey(doc.id)
                      setLastLink(null)
                      toast.success('Key rotated & invites revoked', {
                        description: `Server log re-keyed. ${res.disconnected} guest${res.disconnected === 1 ? '' : 's'} disconnected. Generate a new link to invite.`,
                      })
                    } catch (e) {
                      toast.error('Could not rotate key', { description: e instanceof Error ? e.message : String(e) })
                    }
                  }}
                >
                  <KeyRound className="size-3.5" /> Rotate key
                </button>
              )}
            </div>
          )}
          {lastLink && <p className="mt-2 flex items-center gap-1 truncate text-xs text-muted-foreground" data-live-link={lastLink}><Link2 className="size-3" /> {lastLink.slice(0, 64)}…</p>}
        </>
      )}
    </section>
  )
}
