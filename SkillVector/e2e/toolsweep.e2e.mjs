// Every tool on the rail, driven with a real drag + click over a selected shape. A tool fails when it
// throws, or when it is expected to change the document and leaves it untouched.
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
const setup = (raster, tool = '') => b.eval(`
  const { store, ops } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  store.set({ dialog: null, paletteOpen: false, transform: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Sweep');
  const a = makeLayer({ kind: 'shape', name: 'A', x: 300, y: 200, width: 300, height: 250, shape: { shape: 'rectangle', fill: '#e33333', stroke: '#000000', strokeWidth: 4, fillEnabled: true, radius: 0 } });
  store.insertLayer(a, undefined, 'Add A');
  store.selectLayer(a.id);
  if (${JSON.stringify(tool)} === 'blend') {
    const b2 = makeLayer({ kind: 'shape', name: 'B', x: 700, y: 450, width: 120, height: 120, shape: { shape: 'ellipse', fill: '#3355ee', stroke: '#000000', strokeWidth: 2, fillEnabled: true, radius: 0 } });
    store.insertLayer(b2, undefined, 'Add B');
    store.selectLayer(a.id);
  }
  if (${JSON.stringify(tool)}.startsWith('symbol-') && ${JSON.stringify(tool)} !== 'symbol-sprayer') {
    for (let i = 0; i < 6; i++) store.insertLayer(makeLayer({ kind: 'shape', name: 'Symbol Instance', symbol: 'star', x: 380 + i * 30, y: 260 + i * 15, width: 28, height: 28, shape: { shape: 'star', fill: '#22aa44', stroke: '#000000', strokeWidth: 1, fillEnabled: true, radius: 0, sides: 5 } }), undefined, 'Sym');
    store.selectLayer(a.id);
  }
  if (${raster ? 'true' : 'false'}) {
    // Raster tools work on pixels: a painted layer with a gradient and a few marks
    store.newRasterLayer('Paint');
    const c = store.activeLayer.canvas; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, c.width, 0); g.addColorStop(0, '#ff8800'); g.addColorStop(1, '#0088ff');
    x.fillStyle = g; x.fillRect(250, 150, 500, 350); x.fillStyle = '#ffffff'; x.fillRect(420, 280, 60, 60);
    const { touch } = await import('/src/core/canvas.ts'); touch(c);
  }
  store.set({ fg: '#2255ee', bg: '#ffffff' });
`);
// What the document looks like, as a cheap fingerprint
const snap = () => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const d = store.doc;
  const t = document.createElement('canvas'); t.width = d.width; t.height = d.height;
  renderDocument(d, t);
  const px = t.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  let h = 0; for (let i = 0; i < px.length; i += 37) h = (h * 31 + px[i]) | 0;
  const strip = (l) => JSON.stringify({ ...l, canvas: undefined, mask: undefined, children: l.children?.map?.((c) => c.id) });
  return { slices: (d.slices ?? []).length, persp: JSON.stringify(d.perspective ?? null), sel: JSON.stringify(d.selection ? [d.selection.bounds ?? d.selection.rect ?? 1] : null) + (d.selection?.mask ? d.selection.mask.width : ''), n: d.layers.length, layers: d.layers.map(strip).join('|').length + ':' + d.layers.map(strip).join('|').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0), px: h, fg: store.state.fg, art: JSON.stringify(d.artboards ?? null).length, transform: !!store.state.transform };
`);

// Tools that only navigate, inspect or select; everything else must change the document
const PASSIVE = new Set(['marquee-rect', 'marquee-ellipse', 'poly-lasso', 'join', 'anchor-point', 'curvature', 'hand', 'zoom', 'ruler', 'move', 'master-select', 'direct-select', 'group-select', 'wand', 'lasso',
  'slice-select', 'perspective-select', 'live-paint-select', 'eyedropper', 'print-tiling', 'color-sampler']);

const { rail, all } = await b.eval(`const m = await import('/src/ui/ToolRail.tsx'); return { rail: m.ADVANCED_GROUPS.flat(), all: Object.keys(m.TOOLS) };`);
const tools = [...rail, ...all.filter((t) => !rail.includes(t))];
const only = process.env.TOOL;
for (const tool of tools.filter((t) => !only || t === only)) {
  // Image Trace needs a picture under the pointer: the raster setup paints one
  const raster = !rail.includes(tool) || tool === 'image-trace';
  await setup(raster, tool);
  await sleep(60);
  const before = await snap();
  b.logs.length = 0;
  await b.eval(`window.__ps.store.setTool(${JSON.stringify(tool)})`);
  await sleep(40);
  const g = await geo();
  const pts = [];
  // Cutting and reshaping tools need a drag that crosses the shape's edge
  const crossing = ['knife', 'path-eraser', 'reshape'].includes(tool);
  for (let i = 0; i <= 12; i++) {
    // The Width tool grabs the stroke itself: start on the shape's right edge and pull outwards
    if (tool === 'width') pts.push(S(g, 600 + i * 3, 320));
    else pts.push(crossing ? S(g, tool === 'reshape' ? 450 : 250 + i * 40, tool === 'reshape' ? 200 - i * 4 : 320 + i * 2) : S(g, 350 + i * 20, 260 + i * 12));
  }
  try {
    await b.drag(pts, { delay: 5 });
    await sleep(80);
    // Graph tools open the Graph Data dialog: confirm it like a user would
    if (tool.startsWith('graph-')) await b.eval(`[...document.querySelectorAll('.modal button')].find((x) => x.textContent.trim() === 'Create')?.click()`);
    // Scissors cut where you click on the outline (A's top edge is y = 200)
    else if (tool === 'scissors') await b.click(S(g, 450, 200).x, S(g, 450, 200).y);
    else await b.click(S(g, 450, 320).x, S(g, 450, 320).y);
    // Blend needs a second object
    if (tool === 'blend') await b.click(S(g, 760, 510).x, S(g, 760, 510).y);
    await sleep(80);
    if (/type/.test(tool)) { for (const k of 'Hi') await b.key(k); await b.key('Escape'); }
    await b.key('Enter');
    await sleep(80);
  } catch (err) {
    b.logs.push('[exception] ' + err.message);
  }
  // The trace runs in a worker
  if (tool === 'image-trace') await b.waitFor('!window.__ps.store.state.busy', 20000).catch(() => {});
  const after = await snap();
  const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
  const changed = before.slices !== after.slices || before.persp !== after.persp || before.sel !== after.sel || before.layers !== after.layers || before.px !== after.px || before.n !== after.n || before.art !== after.art;
  // Need a source point (Alt-click), red eyes or an earlier history state: covered by protools.e2e.mjs
  const passive = PASSIVE.has(tool) || ['clone', 'heal-brush', 'history-brush', 'red-eye'].includes(tool);
  const ok = errors.length === 0 && (passive || changed || before.fg !== after.fg) && !after.transform;
  check(`${raster ? '(raster) ' : ''}${tool}`, ok, { changed, layers: `${before.n}->${after.n}`, fg: after.fg !== before.fg, transform: after.transform, errors: errors.slice(0, 2) });
  await b.eval(`window.__ps.store.set({ transform: null })`).catch(() => {});
  await b.key('Escape');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tools OK`);
if (failed.length) console.log('Failing: ' + failed.map((f) => f.name).join(', '));
b.close();
process.exit(failed.length ? 1 : 0);
