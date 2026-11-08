#!/usr/bin/env node
/**
 * Jiro live-sync server: a small self-hosted relay for real-time board editing.
 *
 * Speaks the standard y-websocket wire protocol (y-protocols sync + awareness), so every client
 * converges on the same Yjs document. Each room's document is saved to disk and survives restarts.
 *
 * Rooms can be end-to-end encrypted (the owner creates them with enc=1): the server then only stores and relays
 * AES-GCM ciphertext (an append-only log the owner compacts), and refuses plaintext clients.
 *
 * Rooms are open by default. A room becomes protected when the first client connects with an
 * `owner` key: from then on, joining needs that key or an invite token signed by this server
 * (HMAC-SHA256), and invite tokens carry a role: `edit` or `view`. Writes from viewers are dropped
 * here, on the server, so a modified client can't change the board.
 *
 * Usage: node server/server.mjs   (env: JIRO_SYNC_PORT=1234, JIRO_SYNC_HOST=0.0.0.0,
 *                                   JIRO_SYNC_DATA=server/data, JIRO_SYNC_SECRET=<random>)
 * HTTP:  GET /health                                   → { ok, rooms }
 *        GET /invite?room=<id>&role=edit|view&owner=<key>[&days=7] → { token, expires }   (owner key required)
 *        GET /revoke?room=<id>&owner=<key> → ends every invite of the room and disconnects guests
 * WS:    ws://host:port/<room>?owner=<key> | ?token=<token>
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.JIRO_SYNC_PORT ?? 1234)
const HOST = process.env.JIRO_SYNC_HOST ?? '0.0.0.0'
const DATA = resolve(process.env.JIRO_SYNC_DATA ?? join(here, 'data'))
mkdirSync(DATA, { recursive: true })

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_AUTH = 2
const MSG_QUERY_AWARENESS = 3
// End-to-end encrypted rooms: the server only relays and stores ciphertext it can't read
const MSG_ENC_UPDATE = 10 // an encrypted Yjs update (stored in the room's log, relayed)
const MSG_ENC_SYNCED = 11 // server → client: the whole log has been sent
const MSG_ENC_COMPACT = 12 // owner → server: [count] + one encrypted snapshot replacing the first `count` entries
const MSG_ENC_AWARE = 13 // encrypted presence (relayed only)

// ---- secrets + tokens ----
const secretFile = join(DATA, '.secret')
const SECRET = process.env.JIRO_SYNC_SECRET
  ?? (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : (() => {
    const s = randomBytes(32).toString('hex')
    writeFileSync(secretFile, s, { mode: 0o600 })
    return s
  })())
const b64u = (buf) => Buffer.from(buf).toString('base64url')
const sign = (s) => createHmac('sha256', SECRET).update(s).digest('base64url')
const hashKey = (k) => createHash('sha256').update(String(k)).digest('hex')
/** An invite: room, role, the room's invite generation (revoking bumps it) and an expiry (ms; 0 = never). */
function makeToken(room, role, gen = 0, exp = 0) {
  const body = b64u(JSON.stringify({ r: room, role, g: gen, exp, iat: Date.now() }))
  return `${body}.${sign(body)}`
}
function readToken(token, room, gen = 0) {
  const [body, mac] = String(token ?? '').split('.')
  if (!body || !mac) return null
  const want = Buffer.from(sign(body))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (p.r !== room || (p.role !== 'edit' && p.role !== 'view')) return null
    if ((p.g ?? 0) !== gen) return null // revoked
    if (p.exp && Date.now() > p.exp) return null // expired
    return p
  } catch { return null }
}

// ---- rooms ----
const ROOM_RE = /^[A-Za-z0-9_-]{1,80}$/
const rooms = new Map()

function roomFiles(name) {
  return { state: join(DATA, `${name}.ystate`), meta: join(DATA, `${name}.json`), log: join(DATA, `${name}.elog`) }
}

// Encrypted log on disk: [u32 length][bytes] …
function readLog(file) {
  if (!existsSync(file)) return []
  const b = readFileSync(file)
  const out = []
  for (let p = 0; p + 4 <= b.length; ) {
    const n = b.readUInt32LE(p)
    out.push(new Uint8Array(b.subarray(p + 4, p + 4 + n)))
    p += 4 + n
  }
  return out
}
function writeLog(file, log) {
  const parts = []
  for (const e of log) {
    const h = Buffer.alloc(4)
    h.writeUInt32LE(e.length)
    parts.push(h, Buffer.from(e))
  }
  writeFileSync(file + '.tmp', Buffer.concat(parts))
  renameSync(file + '.tmp', file)
}

function getRoom(name) {
  let room = rooms.get(name)
  if (room) return room
  const files = roomFiles(name)
  const doc = new Y.Doc({ gc: true })
  if (existsSync(files.state)) Y.applyUpdate(doc, readFileSync(files.state))
  const meta = existsSync(files.meta) ? JSON.parse(readFileSync(files.meta, 'utf8')) : {}
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null) // the server has no presence of its own
  room = { name, doc, awareness, meta, conns: new Map(), saveTimer: null, log: meta.encrypted ? readLog(files.log) : [] }

  doc.on('update', (update, origin) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    const msg = encoding.toUint8Array(enc)
    for (const c of room.conns.keys()) if (c !== origin) send(c, msg)
    scheduleSave(room)
  })
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed]
    if (origin && room.conns.has(origin)) {
      const ids = room.conns.get(origin).clients
      for (const id of added) ids.add(id)
      for (const id of removed) ids.delete(id)
    }
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
    const msg = encoding.toUint8Array(enc)
    for (const c of room.conns.keys()) send(c, msg)
  })
  rooms.set(name, room)
  return room
}

function saveNow(room) {
  clearTimeout(room.saveTimer)
  room.saveTimer = null
  const files = roomFiles(room.name)
  // Write-then-rename so a crash mid-write never leaves a half file
  if (room.meta.encrypted) writeLog(files.log, room.log)
  else {
    writeFileSync(files.state + '.tmp', Y.encodeStateAsUpdate(room.doc))
    renameSync(files.state + '.tmp', files.state)
  }
  writeFileSync(files.meta, JSON.stringify(room.meta))
}
function scheduleSave(room) {
  if (!room.saveTimer) room.saveTimer = setTimeout(() => saveNow(room), 300)
}

function send(conn, msg) {
  if (conn.readyState !== 1) return
  try { conn.send(msg) } catch { conn.close() }
}

/** Who may join `room` with these credentials: { role, owner } or null. */
function authorize(room, params) {
  const owner = params.get('owner')
  const token = params.get('token')
  const wantsEnc = params.get('enc') === '1'
  if (!room.meta.ownerHash) {
    if (owner) {
      room.meta.ownerHash = hashKey(owner)
      // The owner decides once, when the room is created, whether it is end-to-end encrypted
      if (wantsEnc && room.doc.store.clients.size === 0) room.meta.encrypted = true
      saveNow(room)
      return { role: 'edit', owner: true }
    }
    if (wantsEnc) return null // an encrypted room must be created by its owner
    return { role: 'edit', owner: false } // open room
  }
  // A client must speak the room's protocol: plaintext into an encrypted room would leak, and back
  if (!!room.meta.encrypted !== wantsEnc) return null
  if (owner && hashKey(owner) === room.meta.ownerHash) return { role: 'edit', owner: true }
  const t = readToken(token, room.name, room.meta.gen ?? 0)
  return t ? { role: t.role, owner: false } : null
}

/** The owner check for HTTP requests (claims an unowned room). */
function ownerOk(room, owner) {
  if (!owner) return false
  if (!room.meta.ownerHash) { room.meta.ownerHash = hashKey(owner); saveNow(room) }
  return hashKey(owner) === room.meta.ownerHash
}

// ---- HTTP (health + invite tokens) ----
const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/health') return res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
  if (url.pathname === '/invite') {
    const name = url.searchParams.get('room') ?? ''
    const role = url.searchParams.get('role') === 'view' ? 'view' : 'edit'
    if (!ROOM_RE.test(name)) { res.statusCode = 400; return res.end('{"error":"bad room"}') }
    const room = getRoom(name)
    if (!ownerOk(room, url.searchParams.get('owner'))) { res.statusCode = 403; return res.end('{"error":"owner key required"}') }
    // days: how long the invite works (default 7, 0 = never expires, at most 365)
    const days = Math.min(365, Math.max(0, Number(url.searchParams.get('days') ?? 7) || 0))
    const exp = days ? Date.now() + days * 86400_000 : 0
    return res.end(JSON.stringify({ token: makeToken(name, role, room.meta.gen ?? 0, exp), role, expires: exp || null }))
  }
  if (url.pathname === '/revoke') {
    // Ends every invite of the room at once: tokens carry the old generation; guests are disconnected
    const name = url.searchParams.get('room') ?? ''
    if (!ROOM_RE.test(name)) { res.statusCode = 400; return res.end('{"error":"bad room"}') }
    const room = getRoom(name)
    if (!ownerOk(room, url.searchParams.get('owner'))) { res.statusCode = 403; return res.end('{"error":"owner key required"}') }
    room.meta.gen = (room.meta.gen ?? 0) + 1
    saveNow(room)
    let closed = 0
    for (const [conn, info] of room.conns) if (!info.owner) { conn.close(4001, 'invite revoked'); closed++ }
    return res.end(JSON.stringify({ ok: true, gen: room.meta.gen, disconnected: closed }))
  }
  res.statusCode = 404
  res.end('{"error":"not found"}')
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 })
http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  const name = decodeURIComponent(url.pathname.slice(1))
  if (!ROOM_RE.test(name)) { socket.destroy(); return }
  const room = getRoom(name)
  const who = authorize(room, url.searchParams)
  if (!who) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, room, who.role, who.owner))
})

function onConnection(conn, room, role, owner = false) {
  conn.binaryType = 'arraybuffer'
  room.conns.set(conn, { role, owner, clients: new Set() })
  let alive = true
  conn.on('pong', () => { alive = true })
  const ping = setInterval(() => {
    if (!alive) { conn.terminate(); return }
    alive = false
    try { conn.ping() } catch { /* closed */ }
  }, 30_000)

  if (role === 'view') {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_AUTH)
    encoding.writeVarUint(enc, 0) // permission denied (for writes)
    encoding.writeVarString(enc, 'read-only')
    send(conn, encoding.toUint8Array(enc))
  }

  conn.on('message', (data) => {
    try {
      const buf = new Uint8Array(data)
      const dec = decoding.createDecoder(buf)
      const type = decoding.readVarUint(dec)
      if (room.meta.encrypted) {
        if (type === MSG_ENC_UPDATE) {
          if (role === 'view') return // viewers can't write
          room.log.push(buf)
          for (const c of room.conns.keys()) if (c !== conn) send(c, buf)
          scheduleSave(room)
        } else if (type === MSG_ENC_AWARE) {
          for (const c of room.conns.keys()) if (c !== conn) send(c, buf)
        } else if (type === MSG_ENC_COMPACT && room.conns.get(conn)?.owner) {
          const count = decoding.readVarUint(dec)
          const snap = decoding.readVarUint8Array(dec)
          const e = encoding.createEncoder()
          encoding.writeVarUint(e, MSG_ENC_UPDATE)
          encoding.writeVarUint8Array(e, snap)
          // Entries that arrived after the owner's snapshot stay
          room.log = [encoding.toUint8Array(e), ...room.log.slice(Math.min(count, room.log.length))]
          saveNow(room)
        }
        return // plaintext messages are ignored in an encrypted room
      }
      if (type === MSG_SYNC) {
        if (role === 'view') {
          // Viewers may only ask for the document (step 1); their step 2 / updates are dropped
          const peek = decoding.createDecoder(buf)
          decoding.readVarUint(peek)
          if (decoding.readVarUint(peek) !== syncProtocol.messageYjsSyncStep1) return
        }
        const enc = encoding.createEncoder()
        encoding.writeVarUint(enc, MSG_SYNC)
        syncProtocol.readSyncMessage(dec, enc, room.doc, conn)
        if (encoding.length(enc) > 1) send(conn, encoding.toUint8Array(enc))
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn)
      } else if (type === MSG_QUERY_AWARENESS) {
        sendAwareness(conn, room)
      }
    } catch (e) {
      console.warn('[jiro-sync] bad message', e?.message ?? e)
    }
  })
  conn.on('close', () => {
    clearInterval(ping)
    const info = room.conns.get(conn)
    room.conns.delete(conn)
    if (info?.clients.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...info.clients], null)
    if (!room.conns.size) {
      saveNow(room)
      room.awareness.destroy()
      room.doc.destroy()
      rooms.delete(room.name)
    }
  })

  if (room.meta.encrypted) {
    // The whole encrypted log, then "synced" (clients send what the log doesn't have yet)
    for (const e of room.log) send(conn, e)
    const s = encoding.createEncoder()
    encoding.writeVarUint(s, MSG_ENC_SYNCED)
    encoding.writeVarUint(s, room.log.length)
    send(conn, encoding.toUint8Array(s))
    return
  }
  // Start the handshake: our state vector, then everyone's presence
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_SYNC)
  syncProtocol.writeSyncStep1(enc, room.doc)
  send(conn, encoding.toUint8Array(enc))
  sendAwareness(conn, room)
}

function sendAwareness(conn, room) {
  const ids = [...room.awareness.getStates().keys()]
  if (!ids.length) return
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MSG_AWARENESS)
  encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, ids))
  send(conn, encoding.toUint8Array(enc))
}

function shutdown() {
  for (const room of rooms.values()) saveNow(room)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

http.listen(PORT, HOST, () => {
  const a = http.address()
  console.log(`[jiro-sync] listening on ws://${HOST}:${a.port}  data: ${DATA}`)
})
