// Every tool on the rail, driven with a real drag + click over a painted pixel layer. A tool fails when
// it throws, or when it is expected to change the document (pixels, layers or selection) and doesn't.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const geo = () => b.eval(`
  const { store } = window.__ps;
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const setup = () => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false, transform: null, crop: null, textEditId: null, cloneSource: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Sweep');
  store.newRasterLayer('Paint');
  const c = store.activeLayer.canvas; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, c.width, 0); g.addColorStop(0, '#ff8800'); g.addColorStop(1, '#0088ff');
  x.fillStyle = g; x.fillRect(250, 150, 500, 350); x.fillStyle = '#ffffff'; x.fillRect(420, 280, 60, 60);
  const { touch } = await import('/src/core/canvas.ts'); touch(c);
  store.renderer.invalidate?.();
  store.set({ fg: '#2255ee', bg: '#ffffff' });
`);
const snap = () => b.eval(`
  const { store } = window.__ps;
  const d = store.doc;
  const out = store.renderer.render(d, store.overrides);
  const px = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
  let h = 0; for (let i = 0; i < px.length; i += 37) h = (h * 31 + px[i]) | 0;
  return { n: d.layers.length, px: h, w: d.width, sel: d.selection ? JSON.stringify(d.selection.bounds) : null, fg: store.state.fg, steps: d.hIndex, transform: !!store.state.transform, crop: !!store.state.crop };
`);
// Tools that only navigate, measure or sample; selection tools must make a selection
const PASSIVE = new Set(['hand', 'zoom', 'ruler', 'color-sampler', 'move', 'rotate-view', 'note', 'count', 'slice', 'slice-select', 'frame']);
// Need a source point first (Alt-click) or special content: checked by their own suites
const NEEDS_SETUP = new Set(['clone', 'heal-brush', 'pattern-stamp', 'history-brush', 'art-history', 'red-eye', 'crop', 'perspective-crop', 'poly-lasso']);

const tools = await b.eval(`const m = await import('/src/ui/ToolRail.tsx'); return m.TOOL_INFO.map((t) => t.id);`);
const only = process.env.TOOL;
for (const tool of tools.filter((t) => !only || t === only)) {
  await setup();
  await sleep(60);
  const before = await snap();
  b.logs.length = 0;
  await b.eval(`window.__ps.store.setTool(${JSON.stringify(tool)})`);
  await sleep(40);
  const g = await geo();
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(S(g, 300 + i * 25, 200 + i * 15));
  try {
    if (tool === 'pen') {
      // A path needs at least two anchors: click three corners, Enter commits it
      for (const [x, y] of [[300, 200], [600, 220], [450, 450]]) await b.click(S(g, x, y).x, S(g, x, y).y);
    } else await b.drag(pts, { delay: 5 });
    await sleep(120);
    // Spot Healing fills in a background task: wait for its history step
    if (tool === 'heal') await b.waitFor(`window.__ps.store.doc.hIndex > ${before.steps}`, 8000).catch(() => {});
    // Object Selection runs the on-device AI in a worker: wait for the selection (and the busy spinner)
    if (tool === 'object-select') await b.waitFor(`!!window.__ps.store.doc.selection && !window.__ps.store.state.busy`, 30000).catch(() => {});
    if (/text|type/.test(tool)) {
      for (const k of 'Hi') await b.key(k);
      await b.key('Escape');
    }
    await b.key('Enter');
    await sleep(120);
  } catch (err) {
    b.logs.push('[exception] ' + err.message);
  }
  const after = await snap();
  const errors = b.logs.filter((l) => l.startsWith('[exception]'));
  const changed = before.px !== after.px || before.n !== after.n || before.sel !== after.sel || before.w !== after.w || before.fg !== after.fg || after.steps !== before.steps;
  const ok = errors.length === 0 && (PASSIVE.has(tool) || NEEDS_SETUP.has(tool) || changed);
  check(tool, ok, { changed, layers: `${before.n}->${after.n}`, sel: after.sel, errors: errors.slice(0, 2) });
  await b.eval(`const { store, ops } = window.__ps; if (store.state.transform) ops.cancelTransform(); store.set({ crop: null, textEditId: null })`).catch(() => {});
  await b.key('Escape');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tools OK`);
if (failed.length) console.log('Failing: ' + failed.map((f) => f.name).join(', '));
b.close();
process.exit(failed.length ? 1 : 0);
