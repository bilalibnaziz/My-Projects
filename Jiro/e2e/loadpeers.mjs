// Load-test helper (not a suite): N peers join a live room from an invite link and each moves a random sticky
// `rate` times a second for `seconds`. Uses the app's real client (src/sync/websocketProvider.ts).
// Usage: node e2e/loadpeers.mjs <link> <peers> <rate> <seconds>
import * as Y from 'yjs'
import { importBoardKey, WebsocketProvider } from '../src/sync/websocketProvider.ts'

const [link, nPeers = '30', rate = '10', seconds = '10'] = process.argv.slice(2)
const m = /jiro:\/\/live\?([^\s#]+)(?:#k=([A-Za-z0-9_-]+))?/.exec(link)
const q = new URLSearchParams(m[1])
const key = m[2] ? await importBoardKey(m[2]) : undefined
const peers = []
for (let i = 0; i < +nPeers; i++) {
  const doc = new Y.Doc()
  const p = new WebsocketProvider(doc, { server: q.get('s'), room: q.get('r'), params: { token: q.get('t') }, key })
  p.awareness.setLocalState({ user: { id: 'p' + i, name: 'Peer ' + i, color: '#888888' }, cursor: { x: 100 + i * 20, y: 100 } })
  p.connect()
  peers.push({ doc, p })
}
const t0 = Date.now()
while (peers.some((x) => x.p.status !== 'synced')) {
  if (Date.now() - t0 > 15000) { console.log('JOIN_TIMEOUT', peers.filter((x) => x.p.status !== 'synced').length); process.exit(1) }
  await new Promise((r) => setTimeout(r, 50))
}
console.log('JOINED', peers.length, 'objects', peers[0].doc.getMap('objects').size)
let edits = 0
const end = Date.now() + +seconds * 1000
const timers = peers.map(({ doc, p }, i) => setInterval(() => {
  if (Date.now() > end) return
  const objs = doc.getMap('objects')
  const ids = [...objs.keys()]
  if (!ids.length) return
  const o = objs.get(ids[(edits * 7 + i) % ids.length])
  doc.transact(() => { o.set('x', 200 + Math.random() * 1000); o.set('y', 150 + Math.random() * 500) })
  edits++
  const cur = p.awareness.getLocalState()
  p.awareness.setLocalState({ ...cur, cursor: { x: Math.random() * 1200, y: Math.random() * 700 } })
}, 1000 / +rate))
await new Promise((r) => setTimeout(r, +seconds * 1000 + 300))
timers.forEach(clearInterval)
await Promise.all(peers.map((x) => x.p.flushed()))
console.log('EDITS', edits)
await new Promise((r) => setTimeout(r, 500))
peers.forEach((x) => x.p.destroy())
process.exit(0)
