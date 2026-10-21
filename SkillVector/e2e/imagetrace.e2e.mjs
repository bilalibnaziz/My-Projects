// Image Trace tool with real input: the rail button, hover outline, click to trace a picture with
// Auto (colours found, flat backdrop dropped, placed exactly over the picture), drag to trace one
// region, ⌥-click to pick exact colours, Expand / Ungroup the result, centerline strokes, and the
// trace running in a worker (the page keeps answering while a big picture traces).
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const ALT = 1;
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderRect } = await import('/src/core/studio/export.ts');
  const c = renderRect(store.doc, { x: ${x}, y: ${y}, width: 1, height: 1 }, 1, '#ffffff');
  return Array.from(c.getContext('2d').getImageData(0, 0, 1, 1).data);
`);
const near = (p, c, t = 30) => Math.abs(p[0] - c[0]) < t && Math.abs(p[1] - c[1]) < t && Math.abs(p[2] - c[2]) < t;
const geo = () => b.eval(`
  const { store } = window.__ps;
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const layers = () => b.eval(`return window.__ps.store.doc.layers.map((l) => ({ id: l.id, name: l.name, kind: l.kind, parent: l.parent ?? null, visible: l.visible, x: l.x, y: l.y, w: l.width, h: l.height, fill: l.shape?.fill, rings: l.shape?.compoundPoints?.length ?? (l.shape ? 1 : 0), closed: l.shape?.closed, fillOn: l.shape?.fillEnabled, sw: l.shape?.strokeWidth }))`);
const waitIdle = () => b.waitFor(`!window.__ps.store.state.busy`, 20000);

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(900, 700, 'white', 'Trace tool');
  store.setOpts({ tracePreset: 'auto', tracePalette: '', traceOutput: 'group', traceAfter: 'hide' });
`);
await sleep(300);

// A flat colour logo on a blue backdrop: yellow disc with a red square inside, placed at (100, 80)
await b.eval(`
  const { store } = window.__ps;
  const c = document.createElement('canvas'); c.width = 300; c.height = 240;
  const x = c.getContext('2d');
  x.fillStyle = '#1e40af'; x.fillRect(0, 0, 300, 240);
  x.fillStyle = '#facc15'; x.beginPath(); x.arc(150, 120, 90, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#dc2626'; x.fillRect(120, 90, 60, 60);
  store.newRasterLayer('Logo', { canvas: c, x: 100, y: 80 });
`);
await sleep(300);

// ---------------------------------------------------------------- the rail button
const btn = await b.eval(`
  const el = [...document.querySelectorAll('button')].find((e) => (e.title || e.getAttribute('aria-label') || '').includes('Image Trace Tool') && e.getBoundingClientRect().width > 0);
  if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
`);
check('the tools bar has an Image Trace tool', !!btn);
if (btn) await b.click(btn.x, btn.y);
await sleep(200);
const tool = await b.eval(`return window.__ps.store.state.tool`);
check('clicking it selects the tool', tool === 'image-trace', tool);
const bar = await b.eval(`return document.querySelector('.options-bar')?.innerText ?? ''`);
check('the options bar offers Auto, output and Trace Studio', /Trace Studio/.test(bar) && (await b.eval(`return [...document.querySelectorAll('.options-bar select')].some((s) => s.value === 'auto')`)), bar.slice(0, 200));

// ---------------------------------------------------------------- hover + click = trace it all
let g = await geo();
const mid = S(g, 250, 200);
await b.mouse('mouseMoved', mid.x, mid.y);
await sleep(100);
const hover = await b.eval(`const { traceOverlay } = await import('/src/core/studio/trace.ts'); return traceOverlay.hover`);
check('hovering a picture outlines it', hover && hover.x === 100 && hover.y === 80 && hover.width === 300, hover);
const before = (await layers()).length;
await b.click(mid.x, mid.y);
await sleep(100);
// The page keeps answering while the worker traces
const alive = await b.eval(`return 1 + 1`);
await waitIdle();
await sleep(100);
let L = await layers();
const group = L.find((l) => l.kind === 'group' && /Traced · Logo/.test(l.name));
const kids = L.filter((l) => l.parent === group?.id);
check('a click traces the picture into one group, picture hidden', !!group && kids.length === 2 && !L.find((l) => l.name === 'Logo').visible && alive === 2, { n: L.length - before, kids: kids.map((k) => k.fill) });
const fills = kids.map((k) => k.fill).sort();
check('Auto finds the exact colours and drops the blue backdrop', fills.length === 2 && fills.every((f) => f !== '#1e40af') && fills.includes('#dc2626') && fills.includes('#facc15'), fills);
const yellow = kids.find((k) => k.fill === '#facc15');
// The layer box is the true curve bounds: the disc is 180 px wide at (160, 110)
check('paths sit exactly over the picture', yellow && Math.abs(yellow.x - 160) < 1 && Math.abs(yellow.y - 110) < 1 && Math.abs(yellow.w - 180) < 1.5 && Math.abs(yellow.h - 180) < 1.5, yellow);
check('the rendered trace matches the picture', near(await px(250, 200), [220, 38, 38]) && near(await px(180, 200), [250, 204, 21]) && near(await px(110, 90), [255, 255, 255]));

// ---------------------------------------------------------------- Expand / Ungroup
await b.eval(`window.__ps.store.setSelectedLayers([${JSON.stringify(group?.id)}])`);
await b.eval(`const T = await import('/src/core/studio/trace.ts'); T.expandTrace({ split: false })`);
L = await layers();
check('Ungroup Trace leaves loose colour paths', !L.some((l) => l.id === group?.id) && L.filter((l) => l.kind === 'shape' && /Trace ·/.test(l.name) && !l.parent).length === 2);
await b.eval(`const { store } = window.__ps; store.undo();`);
await sleep(100);

// Two separate shapes in one colour → Expand splits them, holes kept
await b.eval(`
  const { store } = window.__ps;
  const c = document.createElement('canvas'); c.width = 200; c.height = 100;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 200, 100);
  x.fillStyle = '#111111'; x.fillRect(10, 10, 80, 80); x.fillRect(110, 10, 80, 80);
  x.fillStyle = '#ffffff'; x.fillRect(30, 30, 40, 40);
  store.newRasterLayer('Two boxes', { canvas: c, x: 600, y: 450 });
`);
await sleep(200);
g = await geo();
const boxes = S(g, 650, 500);
await b.click(boxes.x, boxes.y);
await waitIdle();
await sleep(100);
L = await layers();
const g2 = L.find((l) => l.kind === 'group' && /Two boxes/.test(l.name));
const k2 = L.filter((l) => l.parent === g2?.id);
check('two black boxes trace as one compound path', k2.length === 1 && k2[0].rings === 3, k2);
await b.eval(`window.__ps.store.setSelectedLayers([${JSON.stringify(g2?.id)}])`);
// Through the menu command, as a user would
await b.eval(`const { COMMANDS } = await import('/src/core/commands.ts'); const c = COMMANDS.find((x) => x.id === 'expand-trace'); if (c.enabled()) c.run()`);
await sleep(100);
L = await layers();
const parts = L.filter((l) => /Trace · #111111/.test(l.name) && l.x > 590);
check('Expand to Shapes: one path per box, the hole stays in its box', parts.length === 2 && parts.some((p) => p.rings === 2) && parts.some((p) => p.rings === 1), parts);
const sel = await b.eval(`return window.__ps.store.selectedLayers.length`);
check('the expanded shapes are selected', sel === 2, sel);

// ---------------------------------------------------------------- drag = trace a region
await b.eval(`const { store } = window.__ps; const l = store.doc.layers.find((l) => l.name === 'Logo'); store.commit('show', { layers: store.doc.layers.map((x) => x.id === l.id ? { ...x, visible: true } : x) });`);
await b.eval(`const { store } = window.__ps; store.commit('drop', { layers: store.doc.layers.filter((l) => !(/Traced · Logo/.test(l.name)) && !(l.parent && store.doc.layers.find((g) => g.id === l.parent && /Traced · Logo/.test(g.name)))) });`);
await sleep(150);
g = await geo();
const a = S(g, 215, 185), z = S(g, 285, 255);
await b.drag([a, { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }, z]);
await waitIdle();
await sleep(100);
L = await layers();
const g3 = L.filter((l) => l.kind === 'group' && /Traced · Logo/.test(l.name)).pop();
const k3 = L.filter((l) => l.parent === g3?.id);
const box3 = k3.reduce((r, k) => ({ x0: Math.min(r.x0, k.x), y0: Math.min(r.y0, k.y), x1: Math.max(r.x1, k.x + k.w), y1: Math.max(r.y1, k.y + k.h) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
check('a drag traces only that region of the picture', !!g3 && box3.x0 >= 213 && box3.y0 >= 183 && box3.x1 <= 287 && box3.y1 <= 257, box3);
check('a traced region keeps the picture visible', L.find((l) => l.name === 'Logo').visible);

// ---------------------------------------------------------------- ⌥-click picks exact colours
g = await geo();
const onRed = S(g, 250, 200), onYellow = S(g, 170, 200);
await b.click(onRed.x, onRed.y, { modifiers: ALT });
await b.click(onYellow.x, onYellow.y, { modifiers: ALT });
await sleep(100);
const pal = await b.eval(`return window.__ps.store.state.opts.tracePalette`);
check('⌥-click adds the exact picture colours to the trace palette', pal === '#dc2626, #facc15', pal);
const chips = await b.eval(`return document.querySelectorAll('.options-bar .trace-pal .swatch-dot').length`);
check('the options bar shows the picked colours', chips === 2, chips);
await b.eval(`window.__ps.store.setOpts({ tracePalette: '' })`);

// ---------------------------------------------------------------- centerline strokes
await b.eval(`
  const { store } = window.__ps;
  const c = document.createElement('canvas'); c.width = 240; c.height = 120;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 240, 120);
  x.strokeStyle = '#000000'; x.lineWidth = 6; x.lineCap = 'round';
  x.beginPath(); x.moveTo(20, 60); x.bezierCurveTo(70, 0, 120, 120, 220, 50); x.stroke();
  store.newRasterLayer('Sketch', { canvas: c, x: 40, y: 450 });
  const T = await import('/src/core/studio/trace.ts');
  const Tr = await import('/src/core/tracer.ts');
  const l = store.doc.layers.find((l) => l.name === 'Sketch');
  await T.runTrace(l, Tr.TRACE_PRESETS.find((p) => p.id === 'centerline').opts, { output: 'group' });
`);
await sleep(100);
L = await layers();
const g4 = L.filter((l) => l.kind === 'group' && /Sketch/.test(l.name)).pop();
const k4 = L.filter((l) => l.parent === g4?.id);
check('centerline: a pen line becomes one open stroke of the ink width', k4.length === 1 && k4[0].closed === false && !k4[0].fillOn && k4[0].sw >= 5 && k4[0].sw <= 7.5, k4);
// Halfway along the drawn curve: canvas (101.25, 58.75) → document (141.25, 508.75)
check('the stroke renders along the original line', near(await px(141, 508), [0, 0, 0], 60) && near(await px(141, 520), [255, 255, 255], 20));

// ---------------------------------------------------------------- big picture: worker keeps the UI alive
await b.eval(`
  const { store } = window.__ps;
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1100;
  const x = c.getContext('2d');
  for (let i = 0; i < 400; i++) { x.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,' + (30 + i % 40) + '%)'; x.beginPath(); x.arc((i * 97) % 1600, (i * 53) % 1100, 30 + i % 60, 0, 7); x.fill(); }
  store.newRasterLayer('Busy photo', { canvas: c, x: 0, y: 0 });
`);
const t0 = Date.now();
await b.eval(`
  const { store } = window.__ps;
  const T = await import('/src/core/studio/trace.ts');
  const Tr = await import('/src/core/tracer.ts');
  const l = store.doc.layers.find((l) => l.name === 'Busy photo');
  window.__traceDone = false;
  T.runTrace(l, Tr.TRACE_PRESETS.find((p) => p.id === 'photo-high').opts).then(() => (window.__traceDone = true));
`);
const pings = [];
for (let i = 0; i < 5; i++) {
  const s = Date.now();
  await b.eval(`return 1`);
  pings.push(Date.now() - s);
  await sleep(60);
}
await b.waitFor(`window.__traceDone`, 30000);
L = await layers();
const g5 = L.filter((l) => l.kind === 'group' && /Busy photo/.test(l.name)).pop();
check('a big photo traces in the background (page answers within 250 ms)', !!g5 && Math.max(...pings) < 250, { pings, ms: Date.now() - t0 });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
