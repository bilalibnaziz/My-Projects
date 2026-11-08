import { create } from 'zustand'
import type * as Y from 'yjs'
import { uid } from '@/board/geometry'
import { useBoard } from '@/board/store'
import type { ID, Viewport } from '@/board/types'
import { animateVp, stage } from '@/canvas/viewport'
import { useTeam } from '@/team/team'
import type { SyncStatus } from './SyncProvider'
import { importBoardKey, WebsocketProvider } from './websocketProvider'

/** How this device joins a board's live session (kept per device, outside the board document). */
export interface LiveInfo {
  server: string
  room: string
  /** Set on the device that started the session: proves ownership to the server. */
  owner?: string
  /** Invite token (joiners). */
  token?: string
  role: 'owner' | 'edit' | 'view'
  /** End-to-end encryption key (base64url, travels only in the link's #fragment). */
  key?: string
}

/** The board centre + zoom someone is looking at (screen sizes differ, so not raw viewports). */
export interface ViewCenter { cx: number; cy: number; zoom: number }

export interface Presence {
  user: { id: string; name: string; color: string }
  cursor?: { x: number; y: number } | null
  sel?: ID[]
  editing?: ID | null
  view?: ViewCenter
  /** "Bring everyone to me": a view plus when it was asked for. */
  summon?: { view: ViewCenter; at: number }
}

export interface Peer extends Presence { clientId: number }

interface LiveState {
  boardId: string | null
  info: LiveInfo | null
  status: SyncStatus | 'off'
  pending: number
  readOnly: boolean
  peers: Peer[]
  following: number | null
}

export const useLive = create<LiveState>()(() => ({
  boardId: null, info: null, status: 'off', pending: 0, readOnly: false, peers: [], following: null,
}))

const KEY = 'jiro.live'
export const DEFAULT_SERVER = 'ws://localhost:1234'

function readAll(): Record<string, LiveInfo> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} }
}
export function getLiveInfo(boardId: string): LiveInfo | null {
  return readAll()[boardId] ?? null
}
/** The local board that joined `room` on this device, if any. */
export function findLiveBoard(room: string): string | null {
  return Object.entries(readAll()).find(([, i]) => i.room === room)?.[0] ?? null
}
export function setLiveInfo(boardId: string, info: LiveInfo | null) {
  const all = readAll()
  if (info) all[boardId] = info
  else delete all[boardId]
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* storage blocked */ }
}

let provider: WebsocketProvider | null = null
let offs: (() => void)[] = []
let joinedAt = 0
const seenSummons = new Map<number, number>()

export const liveProvider = () => provider

export function viewCenter(vp: Viewport = useBoard.getState().vp): ViewCenter {
  return { cx: (stage.w / 2 - vp.x) / vp.zoom, cy: (stage.h / 2 - vp.y) / vp.zoom, zoom: vp.zoom }
}
export function vpForCenter(v: ViewCenter): Viewport {
  return { x: stage.w / 2 - v.cx * v.zoom, y: stage.h / 2 - v.cy * v.zoom, zoom: v.zoom }
}

/** Connect the open board's Y.Doc to its live session. */
export function startLive(boardId: string, ydoc: Y.Doc, info: LiveInfo) {
  stopLive()
  setLiveInfo(boardId, info)
  useLive.setState({ boardId, info, status: 'connecting', pending: 0, readOnly: info.role === 'view', peers: [], following: null })
  const token = ++startToken
  if (info.key) {
    // The key is imported asynchronously; a newer start (or a stop) meanwhile wins
    void importBoardKey(info.key).then(
      (key) => { if (token === startToken) connectLive(boardId, ydoc, info, key) },
      () => { if (token === startToken) useLive.setState({ status: 'denied' }) },
    )
  } else connectLive(boardId, ydoc, info)
}
let startToken = 0

function connectLive(boardId: string, ydoc: Y.Doc, info: LiveInfo, key?: CryptoKey) {
  const p = new WebsocketProvider(ydoc, {
    server: info.server,
    room: info.room,
    params: { owner: info.owner, token: info.token },
    key,
    owner: !!info.owner,
  })
  provider = p
  joinedAt = Date.now()
  seenSummons.clear()
  const me = useTeam.getState().me
  p.awareness.setLocalState({
    user: { id: me.id, name: me.name, color: me.color },
    cursor: null,
    sel: [],
    editing: null,
    view: viewCenter(),
  } satisfies Presence)

  const sync = () => useLive.setState({ status: p.status, pending: p.pending, readOnly: p.readOnly || info.role === 'view' })
  offs.push(p.on('status', sync))

  // Presence changes are folded into one update per frame (dozens of cursors move many times a second)
  let awarenessFrame = 0
  const onAwareness = () => {
    if (awarenessFrame) return
    awarenessFrame = requestAnimationFrame(() => {
      awarenessFrame = 0
      applyAwareness()
    })
  }
  offs.push(() => cancelAnimationFrame(awarenessFrame))
  const applyAwareness = () => {
    const peers: Peer[] = []
    p.awareness.getStates().forEach((s, clientId) => {
      if (clientId === ydoc.clientID || !s?.user) return
      peers.push({ clientId, ...(s as Presence) })
    })
    peers.sort((a, b) => a.clientId - b.clientId)
    const following = useLive.getState().following
    useLive.setState({ peers, following: following !== null && peers.some((x) => x.clientId === following) ? following : null })
    for (const peer of peers) {
      // Summons sent after we joined, once each
      if (peer.summon && peer.summon.at > joinedAt && (seenSummons.get(peer.clientId) ?? 0) < peer.summon.at) {
        seenSummons.set(peer.clientId, peer.summon.at)
        animateVp(vpForCenter(peer.summon.view))
      }
    }
    const f = useLive.getState().following
    const target = f !== null ? peers.find((x) => x.clientId === f) : undefined
    if (target?.view) useBoard.getState().setVp(vpForCenter(target.view))
  }
  p.awareness.on('change', onAwareness)
  offs.push(() => p.awareness.off('change', onAwareness))

  // Share our view and selection as they change
  let last = ''
  const unsub = useBoard.subscribe((s) => {
    const v = viewCenter(s.vp)
    const key = `${v.cx.toFixed(1)},${v.cy.toFixed(1)},${v.zoom.toFixed(4)}|${s.selection.join(',')}|${s.editingId ?? ''}`
    if (key === last) return
    last = key
    const cur = p.awareness.getLocalState() as Presence | null
    if (!cur) return
    p.awareness.setLocalState({ ...cur, view: v, sel: s.selection, editing: s.editingId ?? null })
  })
  offs.push(unsub)

  p.connect()
  sync()
}

export function stopLive() {
  startToken++
  for (const off of offs) off()
  offs = []
  provider?.destroy()
  provider = null
  useLive.setState({ boardId: null, info: null, status: 'off', pending: 0, readOnly: false, peers: [], following: null })
}

/** End the live session for this board on this device (the board stays, as a local board). */
export function leaveLive(boardId: string) {
  stopLive()
  setLiveInfo(boardId, null)
}

let lastCursor = 0
let cursorTimer: ReturnType<typeof setTimeout> | null = null
let queued: { x: number; y: number } | null = null
/** Our pointer position in board coordinates, sent at most 30 times a second. */
export function setCursor(pt: { x: number; y: number } | null) {
  if (!provider) return
  queued = pt
  const now = performance.now()
  const flush = () => {
    cursorTimer = null
    lastCursor = performance.now()
    const cur = provider?.awareness.getLocalState() as Presence | null
    if (cur) provider!.awareness.setLocalState({ ...cur, cursor: queued })
  }
  if (now - lastCursor >= 33) flush()
  else if (!cursorTimer) cursorTimer = setTimeout(flush, 33 - (now - lastCursor))
}

/** Move everyone in the session to what we're looking at. */
export function summonEveryone() {
  if (!provider) return
  const cur = provider.awareness.getLocalState() as Presence | null
  if (cur) provider.awareness.setLocalState({ ...cur, summon: { view: viewCenter(), at: Date.now() } })
}

export function follow(clientId: number | null) {
  useLive.setState({ following: clientId })
  const p = clientId !== null ? useLive.getState().peers.find((x) => x.clientId === clientId) : undefined
  if (p?.view) useBoard.getState().setVp(vpForCenter(p.view))
}

/** HTTP base of a ws:// server URL. */
export function httpBase(server: string) {
  return server.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '')
}

/** Ask the server for an invite token (only the owner can). */
export async function makeInvite(info: LiveInfo, role: 'edit' | 'view', days = 7): Promise<string> {
  if (!info.owner) throw new Error('Only the person who started the session can invite')
  const r = await fetch(`${httpBase(info.server)}/invite?room=${encodeURIComponent(info.room)}&role=${role}&days=${days}&owner=${encodeURIComponent(info.owner)}`)
  if (!r.ok) throw new Error(`Server said ${r.status}`)
  return (await r.json()).token as string
}

/** Ends every invite link of the session at once (guests are disconnected; you stay). */
export async function revokeInvites(info: LiveInfo): Promise<number> {
  if (!info.owner) throw new Error('Only the person who started the session can revoke invites')
  const r = await fetch(`${httpBase(info.server)}/revoke?room=${encodeURIComponent(info.room)}&owner=${encodeURIComponent(info.owner)}`)
  if (!r.ok) throw new Error(`Server said ${r.status}`)
  return (await r.json()).disconnected as number
}

/**
 * Rotate the room's encryption key and revoke all previous invites.
 * The server's encrypted log is re-encrypted with the new key, and guests with the old key/tokens are disconnected.
 */
export async function rotateRoomKey(boardId: string): Promise<{ newKey: string; disconnected: number }> {
  const info = getLiveInfo(boardId)
  if (!info || !info.owner || !info.key) throw new Error('Only the owner of an encrypted live session can rotate the key')
  if (!provider?.rotateKey) throw new Error('Current provider does not support key rotation')

  const { newBoardKey, importBoardKey } = await import('./websocketProvider')
  const newKeyB64 = await newBoardKey()
  const cryptoKey = await importBoardKey(newKeyB64)
  await provider.rotateKey(cryptoKey)
  const disconnected = await revokeInvites(info)

  const updatedInfo: LiveInfo = { ...info, key: newKeyB64 }
  setLiveInfo(boardId, updatedInfo)
  useLive.setState({ info: updatedInfo })
  return { newKey: newKeyB64, disconnected }
}

/** jiro://live link a teammate opens to join. */
export function liveLink(info: LiveInfo, token: string, name: string) {
  const q = new URLSearchParams({ s: info.server, r: info.room, t: token, n: name })
  // The encryption key rides in the #fragment: it is part of the link, never part of a request to the server
  return `jiro://live?${q.toString()}${info.key ? `#k=${info.key}` : ''}`
}

export function parseLiveLink(text: string): { server: string; room: string; token: string; name: string; role: 'edit' | 'view'; key?: string } | null {
  const m = /jiro:\/\/live\?([^\s#]+)(?:#k=([A-Za-z0-9_-]+))?/.exec(text)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  const server = q.get('s'), room = q.get('r'), token = q.get('t')
  if (!server || !room || !token) return null
  let role: 'edit' | 'view' = 'edit'
  try { role = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).role === 'view' ? 'view' : 'edit' } catch { /* edit */ }
  return { server, room, token, name: q.get('n') ?? 'Live board', role, key: m[2] }
}

/** A new random room id for a board that goes live. */
export const newRoomId = (boardId: string) => `${boardId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}-${uid().replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`
export const newOwnerKey = () => {
  const a = new Uint8Array(24)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}
