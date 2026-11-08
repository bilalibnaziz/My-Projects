// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { importBoardKey, newBoardKey, WebsocketProvider } from '@/sync/websocketProvider'
import { readdirSync, readFileSync } from 'node:fs'

const PORT = 4600 + Math.floor(Math.random() * 300)
const SERVER = `ws://127.0.0.1:${PORT}`
const HTTP = `http://127.0.0.1:${PORT}`
let data = ''
let proc: ChildProcess | null = null
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function startServer() {
  proc = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, JIRO_SYNC_PORT: String(PORT), JIRO_SYNC_HOST: '127.0.0.1', JIRO_SYNC_DATA: data }, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${HTTP}/health`).then((r) => r.ok, () => false)) return
    await sleep(50)
  }
  throw new Error('server did not start')
}
async function stopServer() {
  if (!proc) return
  const p = proc
  proc = null
  await new Promise<void>((r) => { p.once('exit', () => r()); p.kill('SIGTERM') })
}
async function until(cond: () => boolean, ms = 4000) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await sleep(20)
  }
}
function client(room: string, params: Record<string, string> = {}, key?: CryptoKey, extra: { owner?: boolean; compactAfter?: number } = {}) {
  const doc = new Y.Doc()
  const p = new WebsocketProvider(doc, { server: SERVER, room, params, key, ...extra })
  p.connect()
  return { doc, p, map: doc.getMap<string>('m'), text: doc.getText('t') }
}

beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), 'jiro-sync-'))
  await startServer()
})
afterAll(async () => {
  await stopServer()
  rmSync(data, { recursive: true, force: true })
})

describe('live sync server + provider', { timeout: 30_000 }, () => {
  it('two clients converge on concurrent map edits and typing in the same text', async () => {
    const a = client('room-a')
    const b = client('room-a')
    await until(() => a.p.status === 'synced' && b.p.status === 'synced')
    a.map.set('x', '1')
    b.map.set('y', '2')
    a.text.insert(0, 'Hello')
    await until(() => b.text.toString() === 'Hello')
    // concurrent typing at both ends
    a.text.insert(5, ' world')
    b.text.insert(0, '>> ')
    await until(() => a.text.toString() === b.text.toString() && a.text.length === 14)
    expect(a.text.toString()).toBe('>> Hello world')
    expect(a.map.toJSON()).toEqual({ x: '1', y: '2' })
    expect(b.map.toJSON()).toEqual({ x: '1', y: '2' })
    a.p.destroy(); b.p.destroy()
  })

  it('offline edits are counted, then merge both ways on reconnect', async () => {
    const a = client('room-b')
    const b = client('room-b')
    await until(() => a.p.status === 'synced' && b.p.status === 'synced')
    a.p.disconnect()
    a.map.set('offline', 'a')
    a.map.set('offline2', 'a')
    b.map.set('online', 'b')
    expect(a.p.pending).toBe(2)
    await sleep(100)
    expect(b.map.get('offline')).toBeUndefined()
    a.p.connect()
    await until(() => a.p.status === 'synced' && b.map.get('offline2') === 'a' && a.map.get('online') === 'b')
    expect(a.p.pending).toBe(0)
    a.p.destroy(); b.p.destroy()
  })

  it('presence: each client sees the other, and the state is removed when one leaves', async () => {
    const a = client('room-c')
    const b = client('room-c')
    a.p.awareness.setLocalState({ user: { name: 'A' }, cursor: { x: 1, y: 2 } })
    b.p.awareness.setLocalState({ user: { name: 'B' } })
    await until(() => b.p.awareness.getStates().get(a.doc.clientID)?.cursor?.x === 1)
    a.p.awareness.setLocalStateField('cursor', { x: 50, y: 60 })
    await until(() => b.p.awareness.getStates().get(a.doc.clientID)?.cursor?.x === 50)
    a.p.destroy()
    await until(() => !b.p.awareness.getStates().has(a.doc.clientID))
    b.p.destroy()
  })

  it('a protected room: wrong key is refused, a view token cannot write, an edit token can', async () => {
    const owner = client('room-d', { owner: 'secret-owner-key' })
    await until(() => owner.p.status === 'synced')
    owner.map.set('title', 'Plan')
    // invite tokens come only with the owner key
    expect((await fetch(`${HTTP}/invite?room=room-d&role=edit&owner=nope`)).status).toBe(403)
    const viewTok = (await (await fetch(`${HTTP}/invite?room=room-d&role=view&owner=secret-owner-key`)).json()).token
    const editTok = (await (await fetch(`${HTTP}/invite?room=room-d&role=edit&owner=secret-owner-key`)).json()).token

    const stranger = client('room-d')
    await sleep(600)
    expect(stranger.p.status).not.toBe('synced')
    expect(stranger.map.get('title')).toBeUndefined()
    stranger.p.destroy()

    const viewer = client('room-d', { token: viewTok })
    await until(() => viewer.map.get('title') === 'Plan')
    expect(viewer.p.readOnly).toBe(true)
    // Even a client that ignores readOnly and pushes raw updates is dropped by the server
    viewer.map.set('hack', 'x')
    ;(viewer.p as unknown as { readOnly: boolean }).readOnly = false
    viewer.map.set('hack2', 'x')
    const editor = client('room-d', { token: editTok })
    await until(() => editor.p.status === 'synced')
    editor.map.set('fromEditor', 'ok')
    await until(() => owner.map.get('fromEditor') === 'ok')
    await sleep(300)
    expect(owner.map.get('hack')).toBeUndefined()
    expect(owner.map.get('hack2')).toBeUndefined()
    // a forged token is refused
    const forged = client('room-d', { token: editTok.split('.')[0] + '.AAAA' })
    await sleep(600)
    expect(forged.p.status).not.toBe('synced')
    for (const c of [owner, viewer, editor, forged]) c.p.destroy()
  })

  it('invites expire, and revoking ends every invite at once (guests are disconnected, the owner stays)', async () => {
    const owner = client('room-f', { owner: 'k-owner' })
    await until(() => owner.p.status === 'synced')
    // an invite that lasts ~1.7 s
    const short = (await (await fetch(`${HTTP}/invite?room=room-f&role=edit&days=0.00002&owner=k-owner`)).json()).token
    const a = client('room-f', { token: short })
    await until(() => a.p.status === 'synced')
    a.p.destroy()
    await sleep(2200)
    const late = client('room-f', { token: short })
    await sleep(700)
    expect(late.p.status).not.toBe('synced')
    late.p.destroy()
    // revoke: a connected guest is closed and gives up; the old token stops working; a new one works
    const tok = (await (await fetch(`${HTTP}/invite?room=room-f&role=edit&owner=k-owner`)).json()).token
    const guest = client('room-f', { token: tok })
    await until(() => guest.p.status === 'synced')
    expect((await fetch(`${HTTP}/revoke?room=room-f&owner=wrong`)).status).toBe(403)
    const rv = await (await fetch(`${HTTP}/revoke?room=room-f&owner=k-owner`)).json()
    expect(rv.disconnected).toBe(1)
    await until(() => guest.p.status === 'denied')
    expect(owner.p.status).toBe('synced')
    const again = client('room-f', { token: tok })
    await sleep(700)
    expect(again.p.status).not.toBe('synced')
    again.p.destroy()
    const fresh = (await (await fetch(`${HTTP}/invite?room=room-f&role=edit&owner=k-owner`)).json()).token
    const b = client('room-f', { token: fresh })
    await until(() => b.p.status === 'synced')
    owner.map.set('after', 'revoke')
    await until(() => b.map.get('after') === 'revoke')
    for (const c of [owner, guest, b]) c.p.destroy()
  })

  it('end-to-end encrypted room: clients converge, the server stores only ciphertext', async () => {
    const k = await importBoardKey(await newBoardKey())
    const owner = client('room-g', { owner: 'k-g' }, k, { owner: true })
    await until(() => owner.p.status === 'synced')
    owner.text.insert(0, 'SECRET-PLAN-ALPHA')
    owner.map.set('note', 'TOP-SECRET-NOTE')
    const tok = (await (await fetch(`${HTTP}/invite?room=room-g&role=edit&owner=k-g`)).json()).token
    const guest = client('room-g', { token: tok }, k)
    await until(() => guest.text.toString() === 'SECRET-PLAN-ALPHA' && guest.map.get('note') === 'TOP-SECRET-NOTE')
    guest.text.insert(guest.text.length, ' + guest')
    await until(() => owner.text.toString() === 'SECRET-PLAN-ALPHA + guest')
    // encrypted presence still works
    owner.p.awareness.setLocalState({ user: { name: 'O' }, cursor: { x: 7, y: 8 } })
    await until(() => guest.p.awareness.getStates().get(owner.doc.clientID)?.cursor?.x === 7)
    await owner.p.flushed(); await guest.p.flushed()
    await sleep(500)
    // nothing readable on disk
    const files = readdirSync(data).filter((f) => f.startsWith('room-g'))
    const all = files.map((f) => readFileSync(join(data, f)).toString('latin1')).join('')
    expect(files.some((f) => f.endsWith('.elog'))).toBe(true)
    expect(all.includes('SECRET-PLAN-ALPHA')).toBe(false)
    expect(all.includes('TOP-SECRET-NOTE')).toBe(false)
    expect(JSON.parse(readFileSync(join(data, 'room-g.json'), 'utf8')).encrypted).toBe(true)
    // a plaintext client can't join an encrypted room, a wrong key can't read it
    const plain = client('room-g', { token: tok })
    await sleep(600)
    expect(plain.p.status).not.toBe('synced')
    plain.p.destroy()
    const wrong = client('room-g', { token: tok }, await importBoardKey(await newBoardKey()))
    await until(() => wrong.p.status === 'denied')
    expect(wrong.text.toString()).toBe('')
    for (const c of [owner, guest, wrong]) c.p.destroy()
  })

  it('encrypted room: offline edits merge, a viewer cannot write, the owner compacts the log', async () => {
    const k = await importBoardKey(await newBoardKey())
    const owner = client('room-h', { owner: 'k-h' }, k, { owner: true, compactAfter: 20 })
    await until(() => owner.p.status === 'synced')
    for (let i = 0; i < 40; i++) owner.map.set('k' + i, 'v' + i)
    const tok = (await (await fetch(`${HTTP}/invite?room=room-h&role=edit&owner=k-h`)).json()).token
    const view = (await (await fetch(`${HTTP}/invite?room=room-h&role=view&owner=k-h`)).json()).token
    const guest = client('room-h', { token: tok }, k)
    await until(() => guest.map.get('k39') === 'v39')
    // offline on both sides, then reconnect
    guest.p.disconnect()
    guest.map.set('offline', 'guest')
    owner.map.set('online', 'owner')
    await owner.p.flushed()
    guest.p.connect()
    await until(() => owner.map.get('offline') === 'guest' && guest.map.get('online') === 'owner')
    // viewer: can read, its writes are dropped by the server
    const viewer = client('room-h', { token: view }, k)
    await until(() => viewer.map.get('k39') === 'v39')
    ;(viewer.p as unknown as { readOnly: boolean }).readOnly = false
    viewer.map.set('hack', 'x')
    await viewer.p.flushed()
    await sleep(400)
    expect(owner.map.get('hack')).toBeUndefined()
    // the owner reconnects: > 20 log entries → one snapshot; a newcomer still gets everything
    await owner.p.flushed(); await guest.p.flushed()
    await sleep(400)
    const before = (readFileSync(join(data, 'room-h.elog')).length)
    owner.p.disconnect()
    owner.p.connect()
    await until(() => owner.p.status === 'synced')
    await owner.p.flushed()
    await sleep(500)
    const after = readFileSync(join(data, 'room-h.elog')).length
    const fresh = client('room-h', { token: tok }, k)
    await until(() => fresh.map.get('k39') === 'v39' && fresh.map.get('offline') === 'guest' && fresh.map.get('online') === 'owner')
    expect(after).toBeLessThan(before)
    for (const c of [owner, guest, viewer, fresh]) c.p.destroy()
  })

  it('encrypted room: key rotation re-encrypts the server log, old keys cannot read new state, new key clients sync', async () => {
    const k1 = await importBoardKey(await newBoardKey())
    const owner = client('room-rot', { owner: 'k-rot' }, k1, { owner: true })
    await until(() => owner.p.status === 'synced')
    owner.map.set('phase1', 'pre-rotation secret')
    await owner.p.flushed()

    const tok1 = (await (await fetch(`${HTTP}/invite?room=room-rot&role=edit&owner=k-rot`)).json()).token
    const guest1 = client('room-rot', { token: tok1 }, k1)
    await until(() => guest1.map.get('phase1') === 'pre-rotation secret')

    // Rotate key to k2
    const k2 = await importBoardKey(await newBoardKey())
    await owner.p.rotateKey!(k2)

    // Revoke invites on the server
    const revRes = await (await fetch(`${HTTP}/revoke?room=room-rot&owner=k-rot`)).json()
    expect(revRes.disconnected).toBeGreaterThanOrEqual(1)

    // Owner writes new updates under k2
    owner.map.set('phase2', 'post-rotation secret')
    await owner.p.flushed()

    // New invite with updated generation
    const tok2 = (await (await fetch(`${HTTP}/invite?room=room-rot&role=edit&owner=k-rot`)).json()).token

    // Client with old k1 fails to read new state or is denied
    const oldKeyClient = client('room-rot', { token: tok2 }, k1)
    await until(() => oldKeyClient.p.status === 'denied')
    expect(oldKeyClient.map.get('phase2')).toBeUndefined()
    oldKeyClient.p.destroy()

    // Client with new k2 joins and receives both pre-rotation and post-rotation secrets
    const guest2 = client('room-rot', { token: tok2 }, k2)
    await until(() => guest2.map.get('phase1') === 'pre-rotation secret' && guest2.map.get('phase2') === 'post-rotation secret')
    expect(guest2.map.get('phase2')).toBe('post-rotation secret')

    // Server log verification: the old key CANNOT decrypt the server's elog
    const logBytes = readFileSync(join(data, 'room-rot.elog'))
    const n = logBytes.readUInt32LE(0)
    const entry = new Uint8Array(logBytes.subarray(4, 4 + n))
    const entryDec = (await import('lib0/decoding')).createDecoder(entry)
    ;(await import('lib0/decoding')).readVarUint(entryDec) // MSG_ENC_UPDATE
    const box = (await import('lib0/decoding')).readVarUint8Array(entryDec)
    const iv = box.subarray(0, 12)
    const ct = box.subarray(12)
    // Decrypting with k1 throws (bad key)
    let k1Failed = false
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k1, ct)
    } catch {
      k1Failed = true
    }
    expect(k1Failed).toBe(true)
    // Decrypting with k2 succeeds
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k2, ct)
    expect(decrypted.byteLength).toBeGreaterThan(0)

    for (const c of [owner, guest1, guest2]) c.p.destroy()
  })

  it('rooms survive a server restart', async () => {
    const a = client('room-e')
    await until(() => a.p.status === 'synced')
    a.map.set('kept', 'yes')
    await sleep(500)
    a.p.destroy()
    await stopServer()
    await startServer()
    const b = client('room-e')
    await until(() => b.map.get('kept') === 'yes')
    b.p.destroy()
  })
})
