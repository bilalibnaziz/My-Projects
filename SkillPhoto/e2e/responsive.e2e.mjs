// Responsive layout: window sizes from small laptop to phone-sized, and the interface size setting.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const size = (w, h) => b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const open = async (scale = 1) => {
  await b.nav();
  await sleep(400);
  await b.eval(`
    localStorage.removeItem('${process.env.LAYOUT_KEY ?? 'skillphoto.layout'}');
    const { store, ops } = window.__ps;
    store.set({ dialog: null, prefs: { ...store.state.prefs, uiScale: ${scale} } });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(1920, 1080, 'white', 'Responsive');
    store.setTool('move');
  `);
  await sleep(400);
};
// Every bar fits: nothing pokes out of the window, the bars keep one line
const fits = () => b.eval(`
  const vw = innerWidth, vh = innerHeight;
  const out = [];
  for (const sel of ['.menubar', '.options-bar', '.doc-tabs', '.statusbar', '.tool-rail', '.viewport', '.dock']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) out.push(sel + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round));
  }
  for (const sel of ['.menubar', '.statusbar']) {
    const el = document.querySelector(sel);
    if (el && el.scrollHeight > el.clientHeight + 1) out.push(sel + ' wraps');
  }
  // The last tool button and the color chips stay on screen
  const rail = document.querySelector('.tool-rail');
  const last = [...rail.querySelectorAll('.tool-slot')].pop()?.getBoundingClientRect();
  const bottom = rail.querySelector('.rail-bottom')?.getBoundingClientRect();
  if (last && bottom && last.bottom > bottom.top + 1) out.push('tools overlap the color controls');
  if (bottom && bottom.bottom > rail.getBoundingClientRect().bottom + 1) out.push('rail bottom cut off');
  if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways');
  return out;
`);

for (const [w, h, scale] of [[1440, 900, 1], [1280, 800, 1], [1024, 700, 1], [800, 600, 1], [700, 520, 1], [1440, 900, 1.5], [1280, 800, 0.75]]) {
  await size(w, h);
  await open(scale);
  const bad = await fits();
  check(`${w}×${h} at ${scale * 100}%: every bar fits`, bad.length === 0, bad);
}

// Narrow window: menus fold into one button, which still runs commands
{
  await size(800, 600);
  await open();
  const folded = await b.eval(`return [...document.querySelectorAll('.menubar .menu-btn')].map((e) => e.textContent.trim())`);
  await b.eval(`document.querySelector('.menubar .menu-btn').click()`);
  await sleep(100);
  await b.eval(`[...document.querySelectorAll('.menu-pop .menu-item')].find((e) => e.textContent.includes('View')).click()`);
  await sleep(100);
  const items = await b.eval(`return [...document.querySelectorAll('.menu-pop .menu-label')].map((e) => e.textContent)`);
  const zoom0 = await b.eval(`return window.__ps.store.doc.view.zoom`);
  await b.eval(`[...document.querySelectorAll('.menu-pop .menu-item')].find((e) => e.textContent.includes('Zoom In')).click()`);
  await sleep(100);
  const zoom1 = await b.eval(`return window.__ps.store.doc.view.zoom`);
  check('narrow window: one Menu button, View ▸ Zoom In still works', folded.length === 1 && items.includes('View') && zoom1 > zoom0, { folded, items: items.slice(0, 4), zoom0, zoom1 });
}

// Narrow window: the panels are a drawer, opened from the menu bar and closed by clicking outside
{
  const before = await b.eval(`return !!document.querySelector('.dock')`);
  await b.eval(`document.querySelector('.menubar-icon').click()`);
  await sleep(250);
  const drawer = await b.eval(`const d = document.querySelector('.dock.overlay'); const r = d?.getBoundingClientRect(); return r && { right: Math.round(r.right), w: Math.round(r.width) }`);
  const scrim = await b.eval(`const r = document.querySelector('.dock-scrim').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 200 }`);
  await b.click(scrim.x, scrim.y);
  await sleep(150);
  const after = await b.eval(`return !!document.querySelector('.dock')`);
  check('narrow window: panels slide over from the right and close on an outside click', !before && drawer && drawer.right === 800 && !after, { before, drawer, after });
}

// Wide window: the panels button hides and shows the docked column; the canvas takes the room
{
  await size(1280, 800);
  await open();
  const w0 = await b.eval(`return document.querySelector('.viewport').clientWidth`);
  await b.eval(`document.querySelector('.menubar-icon').click()`);
  await sleep(200);
  const w1 = await b.eval(`return document.querySelector('.viewport').clientWidth`);
  await b.eval(`document.querySelector('.menubar-icon').click()`);
  await sleep(200);
  const back = await b.eval(`return !!document.querySelector('.dock')`);
  check('wide window: hiding the panels gives the canvas their width', w1 > w0 + 200 && back, { w0, w1, back });
}

// Short window: the tool bar uses more columns so every tool stays reachable
{
  await size(1280, 480);
  await open();
  const cols = await b.eval(`return document.querySelector('.tool-rail').className.match(/cols-(\\d)/)[1]`);
  check('short window: tool bar in more than one column', Number(cols) >= 2, cols);
}

// The options bar scrolls sideways with the wheel when it doesn't fit
{
  await size(800, 600);
  await open();
  const r = await b.eval(`const el = document.querySelector('.options-bar'); const r = el.getBoundingClientRect(); return { x: r.left + 200, y: r.top + r.height / 2, over: el.scrollWidth > el.clientWidth }`);
  await b.mouse('mouseWheel', r.x, r.y, { deltaX: 0, deltaY: 300 });
  await sleep(150);
  const left = await b.eval(`return document.querySelector('.options-bar').scrollLeft`);
  const fade = await b.eval(`return document.querySelector('.options-bar').dataset.moreLeft`);
  check('options bar scrolls with the wheel and shows it has more', r.over && left > 0 && fade === 'true', { over: r.over, left, fade });
}

// Interface size: the whole interface grows, the setting is kept
{
  await size(1440, 900);
  await open();
  const h0 = await b.eval(`return document.querySelector('.menubar').getBoundingClientRect().height`);
  await b.eval(`const { store } = window.__ps; store.set({ prefs: { ...store.state.prefs, uiScale: 1.25 } });`);
  await sleep(250);
  const h1 = await b.eval(`return document.querySelector('.menubar').getBoundingClientRect().height`);
  const saved = await b.eval(`return JSON.parse(localStorage.getItem('photoscale.prefs')).uiScale`);
  check('interface size 125% scales the bars and is saved', Math.abs(h1 / h0 - 1.25) < 0.03 && saved === 1.25, { h0, h1, saved });
  await b.eval(`const { store } = window.__ps; store.set({ prefs: { ...store.state.prefs, uiScale: 1 } });`);
}

await size(1440, 900);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
