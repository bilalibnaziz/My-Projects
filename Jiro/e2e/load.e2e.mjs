// Live-session load: 30 peers × 10 edits / s (plus moving cursors) on one encrypted room; the receiving browser
// must keep ≥ 50 fps and end up with the same board. Meaningful with PROD=1 (npm run test:perf runs it too).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, sleep } from './cdp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const results = []
const check = (name, ok, info) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '')
}
if (!process.env.PROD) console.log('NOTE  dev server: fps numbers are only meaningful with PROD=1')
const SYNC_PORT = 5100 + Math.floor(Math.random() * 90)
const data = mkdtempSync(join(tmpdir(), 'jiro-load-'))
const server = spawn(process.execPath, [join(here, '..', 'server', 'server.mjs')], { env: { ...process.env, JIRO_SYNC_PORT: String(SYNC_PORT), JIRO_SYNC_HOST: '127.0.0.1', JIRO_SYNC_DATA: data }, stdio: 'ignore' })
for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${SYNC_PORT}/health`).then((r) => r.ok, () => false)); i++) await sleep(50)

const b = await connect()
try {
  await b.nav()
  const center = async (sel) => {
    const r = await b.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
    if (!r) throw new Error('missing ' + sel)
    return r
  }
  const clickSel = async (sel) => { const p = await center(sel); await b.click(p.x, p.y); await sleep(200) }
  await clickSel('[data-action="new-board"]')
  await b.waitFor(`!!document.querySelector('[data-board-view]')`)
  // 60 stickies, shaped exactly like factory.makeSticky (the production build can't import modules)
  await b.eval(`const s = window.__jiro.store.getState(); const objs = [];
    for (let i = 0; i < 60; i++) objs.push({ id: 'ld' + i, kind: 'sticky', x: 100 + (i % 10) * 120, y: 100 + Math.floor(i / 10) * 120, w: 100, h: 100, rotation: 0, fill: '#fff176', text: 'sticky ' + i, fontSize: 0, color: '#1a1a2e', align: 'center', valign: 'middle', font: 'sans' });
    s.add(objs, { select: false }); s.setVp({ x: 0, y: 0, zoom: 1 }); return true`)
  await clickSel('[data-action="share"]')
  await b.eval(`const el = document.querySelector('[data-live-server]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'ws://127.0.0.1:${SYNC_PORT}'); el.dispatchEvent(new Event('input', { bubbles: true }))`)
  await clickSel('[data-action="live-start"]')
  await b.waitFor(`document.querySelector('[data-live-bar]')?.dataset.liveStatus === 'synced'`)
  await clickSel('[data-action="live-invite-edit"]')
  await b.waitFor(`!!document.querySelector('[data-live-link]')`)
  const link = await b.eval(`return document.querySelector('[data-live-link]').dataset.liveLink`)
  await b.key('Escape')
  const objsInPage = await b.eval(`return Object.keys(window.__jiro.store.getState().doc.objects).length`)

  // Frame timing in the page while the peers edit
  await b.eval(`window.__frames = []; let last = performance.now(); window.__stopFrames = false; const tick = (t) => { window.__frames.push(t - last); last = t; if (!window.__stopFrames) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true`)
  const peers = spawn(process.execPath, [join(here, 'loadpeers.mjs'), link, '30', '10', '10'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  peers.stdout.on('data', (d) => (out += d))
  peers.stderr.on('data', (d) => (out += d))
  const code = await new Promise((r) => peers.on('exit', r))
  const frames = await b.eval(`window.__stopFrames = true; const f = window.__frames.slice(5); const s = [...f].sort((a, c) => a - c); return { n: f.length, total: f.reduce((a, c) => a + c, 0), p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }`)
  const joined = /JOINED (\d+)/.exec(out)?.[1]
  const edits = +(/EDITS (\d+)/.exec(out)?.[1] ?? 0)
  check('30 peers join the encrypted room and make ~3000 edits in 10 s', code === 0 && joined === '30' && edits > 2400, { joined, edits, objsInPage, out: out.slice(-160) })
  const fps = frames.n / (frames.total / 1000)
  check('the receiving browser keeps ≥ 50 fps under 30 peers × 10 edits / s', fps >= 50, { fps: +fps.toFixed(1), p95ms: +frames.p95.toFixed(1), maxms: +frames.max.toFixed(1), prod: !!process.env.PROD })
  // The page ends with the peers' final positions: compare with a fresh peer reading the room
  await sleep(800)
  const pageState = await b.eval(`const o = window.__jiro.store.getState().doc.objects; return Object.keys(o).sort().map((k) => k + ':' + Math.round(o[k].x) + ',' + Math.round(o[k].y)).join('|')`)
  const reader = spawn(process.execPath, ['--input-type=module', '-e', `
    import * as Y from 'yjs'; import { importBoardKey, WebsocketProvider } from '${join(here, '..', 'src', 'sync', 'websocketProvider.ts')}';
    const m = /jiro:\\/\\/live\\?([^\\s#]+)(?:#k=([A-Za-z0-9_-]+))?/.exec(${JSON.stringify(link)}); const q = new URLSearchParams(m[1]);
    const doc = new Y.Doc(); const p = new WebsocketProvider(doc, { server: q.get('s'), room: q.get('r'), params: { token: q.get('t') }, key: await importBoardKey(m[2]) }); p.connect();
    while (p.status !== 'synced') await new Promise((r) => setTimeout(r, 50));
    const o = doc.getMap('objects'); console.log('STATE ' + [...o.keys()].sort().map((k) => k + ':' + Math.round(o.get(k).get('x')) + ',' + Math.round(o.get(k).get('y'))).join('|')); p.destroy(); process.exit(0)`], { cwd: join(here, '..'), stdio: ['ignore', 'pipe', 'pipe'] })
  let rout = ''
  reader.stdout.on('data', (d) => (rout += d))
  await new Promise((r) => reader.on('exit', r))
  const serverState = /STATE (.*)/.exec(rout)?.[1]
  check('after the storm the page matches the room exactly', !!serverState && serverState === pageState, { same: serverState === pageState, n: pageState.split('|').length })
} finally {
  b.close()
  server.kill()
  await sleep(200)
  rmSync(data, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exitCode = failed ? 1 : 0
