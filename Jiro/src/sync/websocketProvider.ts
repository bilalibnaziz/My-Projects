import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { SyncProvider, SyncStatus } from './SyncProvider'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_AUTH = 2
const MSG_QUERY_AWARENESS = 3
const MSG_ENC_UPDATE = 10
const MSG_ENC_SYNCED = 11
const MSG_ENC_COMPACT = 12
const MSG_ENC_AWARE = 13
/** The owner folds the encrypted log into one snapshot once it has this many entries. */
const COMPACT_AFTER = 200

/** AES-GCM: 12-byte IV + ciphertext. */
async function seal(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource))
  const out = new Uint8Array(12 + c.length)
  out.set(iv, 0)
  out.set(c, 12)
  return out
}
async function open(key: CryptoKey, box: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.subarray(0, 12) as BufferSource }, key, box.subarray(12) as BufferSource))
}

/** A new random board key (raw AES-256), as base64url for the link fragment. */
export async function newBoardKey(): Promise<string> {
  const k = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...k)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function importBoardKey(b64: string): Promise<CryptoKey> {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return crypto.subtle.importKey('raw', Uint8Array.from(s, (c) => c.charCodeAt(0)) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export interface WebsocketOptions {
  /** e.g. ws://localhost:1234 */
  server: string
  room: string
  /** Query params: `owner` (owner key) or `token` (invite). */
  params?: Record<string, string | undefined>
  /** Inject a WebSocket implementation (tests). */
  WebSocketImpl?: typeof WebSocket
  /** End-to-end encryption key: the server then only ever sees ciphertext. */
  key?: CryptoKey
  /** This client is the room's owner (it compacts the encrypted log). */
  owner?: boolean
  /** Compact the encrypted log once it has more entries than this (default 200). */
  compactAfter?: number
}

/**
 * Client for Jiro's sync server (y-websocket wire protocol): exchanges state vectors on connect so
 * offline edits merge both ways, streams updates, shares presence through Yjs awareness, and
 * reconnects with backoff.
 */
export class WebsocketProvider implements SyncProvider {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  status: SyncStatus = 'offline'
  pending = 0
  readOnly = false
  private ws: WebSocket | null = null
  private wanted = false
  private destroyed = false
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(s: SyncStatus) => void>()
  private gotStep2 = false
  private queue: Promise<void> = Promise.resolve() // keeps encrypt / decrypt work in order
  private seen = new Y.Doc() // encrypted rooms: what the server's log holds (so we only send the difference)
  private logCount = 0
  /** Encrypted updates that failed to decrypt (wrong key). */
  badKey = 0
  // Remote updates are applied in one transaction per frame: 30 people editing would otherwise mean hundreds of
  // store updates and renders a second
  private inbox: Uint8Array[] = []
  private inboxTimer: number | ReturnType<typeof setTimeout> | null = null
  private seenUpdates: Uint8Array[] = []

  private opts: WebsocketOptions

  constructor(doc: Y.Doc, opts: WebsocketOptions) {
    this.opts = opts
    this.doc = doc
    this.awareness = new awarenessProtocol.Awareness(doc)
    doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
  }

  get url() {
    const base = this.opts.server.replace(/\/+$/, '')
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(this.opts.params ?? {})) if (v) q.set(k, v)
    if (this.opts.key) q.set('enc', '1')
    const qs = q.toString()
    return `${base}/${encodeURIComponent(this.opts.room)}${qs ? '?' + qs : ''}`
  }

  on(_event: 'status', cb: (s: SyncStatus) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private setStatus(s: SyncStatus) {
    if (this.status === s) return
    this.status = s
    for (const cb of this.listeners) cb(s)
  }

  private notify() {
    for (const cb of this.listeners) cb(this.status)
  }

  connect() {
    if (this.destroyed) return
    this.wanted = true
    if (this.ws) return
    this.setStatus('connecting')
    const Impl = this.opts.WebSocketImpl ?? WebSocket
    let ws: WebSocket
    try {
      ws = new Impl(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.gotStep2 = false
    ws.onopen = () => {
      this.retry = 0
      if (this.opts.key) {
        // Encrypted room: the server sends its log first; presence goes out encrypted
        this.seen = new Y.Doc()
        this.logCount = 0
        this.sendAwarenessEnc([this.doc.clientID])
        return
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeSyncStep1(enc, this.doc)
      this.send(encoding.toUint8Array(enc))
      if (this.awareness.getLocalState() !== null) {
        const a = encoding.createEncoder()
        encoding.writeVarUint(a, MSG_AWARENESS)
        encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
        this.send(encoding.toUint8Array(a))
      }
      const q = encoding.createEncoder()
      encoding.writeVarUint(q, MSG_QUERY_AWARENESS)
      this.send(encoding.toUint8Array(q))
    }
    ws.onmessage = (ev) => this.onMessage(new Uint8Array(ev.data as ArrayBuffer))
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      // 4001: the owner revoked the invites; don't keep knocking
      if (ev.code === 4001) {
        this.wanted = false
        this.setStatus('denied')
      }
      // Everyone else's presence is stale now
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
      if (others.length) awarenessProtocol.removeAwarenessStates(this.awareness, others, this)
      if (this.status !== 'denied') this.setStatus('offline')
      if (this.wanted && this.status !== 'denied') this.scheduleReconnect()
    }
    ws.onerror = () => { /* onclose follows */ }
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.destroyed) return
    const ms = Math.min(5000, 300 * 2 ** this.retry++)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.wanted) this.connect()
    }, ms)
  }

  private onMessage(buf: Uint8Array) {
    const dec = decoding.createDecoder(buf)
    const type = decoding.readVarUint(dec)
    if (this.opts.key) {
      const key = this.opts.key
      if (type === MSG_ENC_AWARE) {
        const box = decoding.readVarUint8Array(dec)
        open(key, box)
          .then((raw) => {
            if (this.status !== 'denied' && !this.destroyed) {
              awarenessProtocol.applyAwarenessUpdate(this.awareness, raw, this)
            }
          })
          .catch(() => {
            this.badKey++
            if (this.badKey === 1) { this.wanted = false; this.setStatus('denied'); this.ws?.close() }
          })
        return
      }
      this.queue = this.queue.then(async () => {
        // A wrong key already stopped this session: ignore whatever was still queued
        if (this.status === 'denied') return
        try {
          if (type === MSG_ENC_UPDATE) {
            const u = await open(key, decoding.readVarUint8Array(dec))
            this.seenUpdates.push(u)
            this.applyRemote(u)
            this.logCount++
          } else if (type === MSG_ENC_SYNCED) {
            this.flushSeen()
            // Owner: fold the log first. The snapshot is exactly the entries received so far, so anything others add
            // meanwhile lands after them and is kept by the server
            this.drainInbox()
            if (this.opts.owner && this.logCount > (this.opts.compactAfter ?? COMPACT_AFTER)) await this.compact()
            // Send what the log doesn't have yet (offline edits, or the whole board when we create the room)
            const diff = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.seen))
            if (diff.length > 2 && !this.readOnly) await this.sendEnc(diff)
            this.pending = 0
            this.setStatus('synced')
            this.notify()
          } else if (type === MSG_AUTH) {
            if (decoding.readVarUint(dec) === 0) { this.readOnly = true; this.notify() }
          }
        } catch {
          // A wrong key (or a tampered message) can't be opened: count it, never apply it
          this.badKey++
          if (this.badKey === 1) { this.wanted = false; this.setStatus('denied'); this.ws?.close() }
        }
      })
      return
    }
    if (type === MSG_SYNC) {
      // Plain updates (the steady stream while people edit) are batched per frame; handshake steps run at once
      const peek = decoding.createDecoder(buf)
      decoding.readVarUint(peek)
      if (decoding.readVarUint(peek) === syncProtocol.messageYjsUpdate) {
        this.applyRemote(decoding.readVarUint8Array(peek))
        return
      }
      this.drainInbox()
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      const sub = syncProtocol.readSyncMessage(dec, enc, this.doc, this)
      // A viewer's answer would be dropped by the server anyway
      if (encoding.length(enc) > 1 && !this.readOnly) this.send(encoding.toUint8Array(enc))
      if (sub === syncProtocol.messageYjsSyncStep2 && !this.gotStep2) {
        this.gotStep2 = true
        // The server has answered our state vector, and we answered its: offline edits are delivered
        this.pending = 0
        this.setStatus('synced')
        this.notify()
      }
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this)
    } else if (type === MSG_AUTH) {
      // 0 = permission denied for writes (view-only invite)
      if (decoding.readVarUint(dec) === 0) {
        this.readOnly = true
        this.notify()
      }
    }
  }

  private applyRemote(update: Uint8Array) {
    this.inbox.push(update)
    if (this.inboxTimer !== null) return
    const run = () => {
      this.inboxTimer = null
      const list = this.inbox
      this.inbox = []
      if (!list.length) return
      Y.applyUpdate(this.doc, list.length === 1 ? list[0] : Y.mergeUpdates(list), this)
    }
    this.inboxTimer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)
  }

  /** Applies queued remote updates now (before sending our state, and on disconnect). */
  private drainInbox() {
    this.flushSeen()
    if (this.inboxTimer !== null) {
      if (typeof cancelAnimationFrame === 'function' && typeof this.inboxTimer === 'number') cancelAnimationFrame(this.inboxTimer)
      else clearTimeout(this.inboxTimer as ReturnType<typeof setTimeout>)
      this.inboxTimer = null
    }
    const list = this.inbox
    this.inbox = []
    if (list.length) Y.applyUpdate(this.doc, list.length === 1 ? list[0] : Y.mergeUpdates(list), this)
  }

  private send(msg: Uint8Array) {
    const ws = this.ws
    if (ws && ws.readyState === 1) ws.send(msg as Uint8Array<ArrayBuffer>)
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.readOnly) return
    if (!this.ws || this.ws.readyState !== 1 || (this.opts.key && this.status !== 'synced')) {
      // Not connected (or the encrypted log isn't in yet): the change waits in the local doc and goes out with
      // the next handshake
      this.pending++
      this.notify()
      return
    }
    if (this.opts.key) {
      this.queue = this.queue.then(() => this.sendEnc(update))
      return
    }
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    this.send(encoding.toUint8Array(enc))
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return
    const changed = [...added, ...updated, ...removed]
    if (this.opts.key) {
      this.sendAwarenessEnc(changed)
      return
    }
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
    this.send(encoding.toUint8Array(enc))
  }

  private flushSeen() {
    if (!this.seenUpdates.length) return
    const u = this.seenUpdates.length === 1 ? this.seenUpdates[0] : Y.mergeUpdates(this.seenUpdates)
    this.seenUpdates = []
    Y.applyUpdate(this.seen, u)
  }

  /** Encrypts and sends one Yjs update (also remembered as "the server has it"). */
  private async sendEnc(update: Uint8Array) {
    const box = await seal(this.opts.key!, update)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_ENC_UPDATE)
    encoding.writeVarUint8Array(enc, box)
    this.send(encoding.toUint8Array(enc))
    this.flushSeen()
    Y.applyUpdate(this.seen, update)
    this.logCount++
  }

  private sendAwarenessEnc(ids: number[]) {
    if (!this.opts.key || !this.ws || this.ws.readyState !== 1) return
    const data = awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids)
    const key = this.opts.key
    this.queue = this.queue.then(async () => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_ENC_AWARE)
      encoding.writeVarUint8Array(enc, await seal(key, data))
      this.send(encoding.toUint8Array(enc))
    })
  }

  /** Owner: replace the log entries seen so far with one encrypted snapshot of the board. */
  private async compact(targetKey?: CryptoKey) {
    this.flushSeen()
    const count = this.logCount
    const keyToUse = targetKey ?? this.opts.key!
    const snap = await seal(keyToUse, Y.encodeStateAsUpdate(this.seen))
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_ENC_COMPACT)
    encoding.writeVarUint(enc, count)
    encoding.writeVarUint8Array(enc, snap)
    this.send(encoding.toUint8Array(enc))
    this.logCount = 1
  }

  /**
   * Owner only: rotate the encryption key for this room.
   * Re-encrypts the entire server log into a snapshot under the new key,
   * wipes the old ciphertext on the server, and updates the local cipher state.
   */
  async rotateKey(newKey: CryptoKey): Promise<void> {
    if (!this.opts.owner || !this.opts.key) throw new Error('Only the owner of an encrypted room can rotate the key')
    this.drainInbox()
    this.flushSeen()
    await this.compact(newKey)
    this.opts.key = newKey
    this.seen = new Y.Doc()
    Y.applyUpdate(this.seen, Y.encodeStateAsUpdate(this.doc))
    this.seenUpdates = []
    this.logCount = 1
  }

  /** Waits until queued encrypted work has gone out (tests). */
  flushed() {
    return this.queue
  }

  disconnect() {
    this.drainInbox()
    this.wanted = false
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const ws = this.ws
    this.ws = null
    ws?.close()
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID)
    if (others.length) awarenessProtocol.removeAwarenessStates(this.awareness, others, this)
    if (this.status !== 'denied') this.setStatus('offline')
  }

  destroy() {
    if (this.destroyed) return
    // Tell the others we left before the socket closes
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.disconnect()
    this.destroyed = true
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.awareness.destroy()
    this.listeners.clear()
  }
}
