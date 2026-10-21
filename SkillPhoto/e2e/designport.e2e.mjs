// Skill Vector design features in Skill Photo, with real input: live shapes (per-corner radii, corner
// widgets dragged on canvas, star / donut), gradient + fill opacity + inside stroke (rendered pixels),
// Properties shape + Appearance sections, Pathfinder, Make Button that grows with its label, Eyedropper
// look copy, Transform Again (⌘D), editable SVG place + SVG export, and the Social Studio.
import { connect, sleep, ALT, META } from './cdp.mjs';
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
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
  renderDocument(store.doc, t);
  return Array.from(t.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);
const near = (p, q, tol = 6) => p.slice(0, 3).every((v, i) => Math.abs(v - q[i]) <= tol);
const isWhite = (p) => p[0] > 240 && p[1] > 240 && p[2] > 240;
const steps = (a, d, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n }));
const active = () => b.eval(`const l = window.__ps.store.activeLayer; return l && { id: l.id, kind: l.kind, name: l.name, x: l.x, y: l.y, w: l.width, h: l.height, parent: l.parent, ...l.shape }`);
const fresh = (w = 1000, h = 700, title = 'Design') => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(${w}, ${h}, 'white', '${title}');
  store.set({ fg: '#2255ee' });
  store.setOpts({ shapeType: 'rectangle', shapeFill: true, shapeStrokeWidth: 0, shapeRadius: 0, shapeSides: 6, shapeExtras: {}, transformControls: true, liveCorners: true });
`);
const openProps = () => b.eval(`
  const t = [...document.querySelectorAll('.dock-tabs button, .dock-tabs [role=tab], .dock-tabs > *')].find((e) => /^properties$/i.test(e.textContent.trim()));
  if (t && !t.classList.contains('active')) t.click();
  return !!t;
`);

await fresh();
await openProps();
await sleep(300);
let g = await geo();

// ---- Live rectangle with per-corner radii, drawn with a real drag
await b.eval(`window.__ps.store.setOpts({ shapeExtras: { radii: [80, 0, 0, 0] } }); window.__ps.store.setTool('shape')`);
await b.drag(steps(S(g, 100, 100), { x: 300 * g.zoom, y: 200 * g.zoom }));
await sleep(200);
let s = await active();
check('Shape tool draws a rectangle with the next-shape corner radii', s?.shape === 'rectangle' && JSON.stringify(s.radii) === '[80,0,0,0]', s && { shape: s.shape, radii: s.radii });
check('rounded top-left corner is cut away (white), other corners are square (blue)', isWhite(await px(104, 104)) && near(await px(396, 104), [0x22, 0x55, 0xee]) && near(await px(104, 296), [0x22, 0x55, 0xee]));
const shapeSec = await b.eval(`return document.querySelector('.shape-section')?.innerText ?? ''`);
check('Properties shows the live shape section for the selected rectangle', /selected rectangle/i.test(shapeSec) && /live/i.test(shapeSec), shapeSec.slice(0, 80));

// ---- Corner widget dragged on the canvas (Move tool, real mouse)
await b.eval(`window.__ps.store.setTool('move')`);
await sleep(100);
const w = await b.eval(`
  const { shapeWidgets } = await import('/src/core/shapeWidgets.ts');
  const { store } = window.__ps;
  return shapeWidgets(store.activeLayer, store.doc.view.zoom).filter((w) => w.kind === 'corner').map((w) => ({ x: w.x, y: w.y, index: w.index }));
`);
check('rectangle shows 4 corner widgets', w.length === 4, w.length);
const tr = w.find((q) => q.index === 1);
if (tr) {
  const a = S(g, tr.x, tr.y);
  await b.drag(steps(a, { x: -40 * g.zoom, y: 40 * g.zoom }, 10));
  await sleep(150);
}
s = await active();
check('dragging the top-right widget rounds that corner on the canvas', s.radii && s.radii[1] > 20, s.radii);
check('top-right corner pixel now empty', isWhite(await px(397, 103)));
await b.key('z', { modifiers: META });
await sleep(100);
s = await active();
check('one undo step restores the corner', s.radii && s.radii[1] === 0, s.radii);

// ---- Gradient fill, fill opacity, inside stroke: rendered
await b.eval(`
  const { store } = window.__ps;
  const l = store.activeLayer;
  store.updateLayer(l.id, { shape: { ...l.shape, radii: undefined, radius: 0, gradient: { type: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } } }, 'Gradient');
`);
await sleep(100);
let L = await px(110, 200), R = await px(390, 200);
check('linear gradient renders red → blue across the shape', L[0] > 200 && L[2] < 60 && R[2] > 200 && R[0] < 60, { L, R });
await b.eval(`
  const { store } = window.__ps;
  const l = store.activeLayer;
  store.updateLayer(l.id, { shape: { ...l.shape, gradient: undefined, fill: '#000000', fillOpacity: 0.5, stroke: '#ff0000', strokeWidth: 10, strokeAlign: 'inside' } }, 'Look');
`);
await sleep(100);
check('fill opacity 50% renders mid grey on white', near(await px(250, 200), [128, 128, 128], 4), await px(250, 200));
check('inside stroke stays inside the outline', near(await px(103, 200), [255, 0, 0], 8) && isWhite(await px(96, 200)), { in: await px(103, 200), out: await px(96, 200) });
const appSec = await b.eval(`return document.querySelector('.appearance-section')?.innerText ?? ''`);
check('Appearance section lists fill opacity and stroke', /fill opacity/i.test(appSec) && /stroke/i.test(appSec), appSec.slice(0, 120));

// ---- SVG export keeps the look
const svg = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc);`);
check('SVG export writes fill-opacity and an inside stroke clip', /fill-opacity="0\.5"/.test(svg) && /clipPath/.test(svg));

// ---- Star / donut live geometry
await b.eval(`window.__ps.store.setOpts({ shapeType: 'ellipse', shapeExtras: { hole: 0.5 } }); window.__ps.store.setTool('shape')`);
await b.drag(steps(S(g, 500, 100), { x: 200 * g.zoom, y: 200 * g.zoom }));
await sleep(150);
s = await active();
check('ellipse drawn as a donut', s.shape === 'ellipse' && s.hole === 0.5, s.hole);
check('donut hole is empty, ring is filled', isWhite(await px(600, 200)) && near(await px(600, 125), [0x22, 0x55, 0xee]));

// ---- Pathfinder (Smart Actions button with 2 shapes selected)
await b.eval(`
  const { store } = window.__ps;
  const shapes = store.doc.layers.filter((l) => l.kind === 'shape');
  store.setSelectedLayers(shapes.map((l) => l.id));
  store.setTool('move');
`);
await sleep(200);
const uniteBtn = await b.eval(`
  const el = [...document.querySelectorAll('.smart-actions button')].find((x) => /^unite/i.test(x.textContent.trim()));
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
`);
check('Next steps offers Pathfinder Unite for two shapes', !!uniteBtn);
if (uniteBtn) await b.click(uniteBtn.x, uniteBtn.y);
await sleep(200);
const after = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.shape.shape)`);
check('Unite merges both shapes into one path', after.length === 1 && after[0] === 'path', after);

// ---- Make Button: text + auto-hugging shape
await fresh(800, 600, 'Button');
await sleep(200);
await b.eval(`
  const { store } = window.__ps;
  store.setTool('text');
`);
await b.eval(`const t = await import('/src/core/tools.ts'); t.createTextAt(200, 200); window.__ps.store.set({ textEditId: null });`);
await sleep(100);
await b.eval(`
  const t = await import('/src/core/tools.ts');
  const l = window.__ps.store.activeLayer;
  t.updateText(l.id, { text: 'Buy', size: 40 });
  window.__ps.store.setSelectedLayers([l.id]);
  window.__ps.store.setTool('move');
`);
await sleep(100);
const made = await b.eval(`
  const { COMMANDS } = await import('/src/core/commands.ts');
  const c = COMMANDS.find((c) => c.id === 'make-button');
  if (!c.enabled()) return 'disabled';
  c.run();
  const doc = window.__ps.store.doc;
  const g = doc.layers.find((l) => l.kind === 'group');
  const shape = doc.layers.find((l) => l.kind === 'shape');
  return g && shape && { group: g.name, hug: !!shape.hug, w: shape.width };
`);
check('Make Button groups a hugging shape behind the label', made && made.hug && /^Button/.test(made.group), made);
const grown = await b.eval(`
  const t = await import('/src/core/tools.ts');
  const doc = window.__ps.store.doc;
  const text = doc.layers.find((l) => l.kind === 'text');
  t.updateText(text.id, { text: 'Buy now — 50% off' });
  return doc.layers.find((l) => l.kind === 'shape').width;
`);
check('editing the label grows the button', made && grown > made.w + 100, { before: made?.w, after: grown });

// ---- Eyedropper copies a look from one shape to another
await fresh(800, 600, 'Eyedropper');
await sleep(200);
g = await geo();
await b.eval(`
  const { store } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  const mk = (name, x, fill, extra) => makeLayer({ kind: 'shape', name, x, y: 100, width: 150, height: 150, shape: { shape: 'rectangle', fill, fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0, ...extra } });
  const a = mk('Source', 100, '#ff8800', { strokeWidth: 8, stroke: '#00aa00', fillOpacity: 0.7 });
  const t = mk('Target', 450, '#222222', {});
  store.commit('Shapes', { layers: [...store.doc.layers, a, t], activeId: t.id });
  store.setSelectedLayers([t.id]);
  store.setTool('move');
`);
await b.click(S(g, 525, 175).x, S(g, 525, 175).y);
await sleep(100);
await b.eval(`window.__ps.store.setTool('eyedropper')`);
await b.click(S(g, 175, 175).x, S(g, 175, 175).y);
await sleep(150);
const tgt = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Target'); return l.shape`);
check('Eyedropper with a shape selected copies fill, stroke and opacity', tgt.fill === '#ff8800' && tgt.strokeWidth === 8 && tgt.fillOpacity === 0.7, tgt);

// ---- Transform Again (⌘D) with no pixel selection
await b.eval(`window.__ps.store.setTool('move')`);
await b.click(S(g, 525, 175).x, S(g, 525, 175).y);
await sleep(100);
const p0 = await active();
await b.drag(steps(S(g, 525, 175), { x: 60 * g.zoom, y: 0 }), { modifiers: META });
await sleep(150);
const p1 = await active();
await b.key('d', { modifiers: META });
await sleep(150);
const p2 = await active();
check('⌘D repeats the last move', Math.abs(p1.x - p0.x - 60) < 2 && Math.abs(p2.x - p1.x - 60) < 2, { p0: p0.x, p1: p1.x, p2: p2.x });

// ---- Place SVG as editable shapes
const placed = await b.eval(`
  const io = await import('/src/core/io.ts');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="0" y="0" width="100" height="100" rx="10" fill="#ff0000"/><circle cx="150" cy="50" r="50" fill="#00ff00" fill-opacity="0.5"/></svg>';
  await io.placeImage(new Blob([svg], { type: 'image/svg+xml' }), 'Logo');
  const doc = window.__ps.store.doc;
  const g = doc.layers.find((l) => l.kind === 'group' && l.name === 'Logo');
  const kids = doc.layers.filter((l) => l.parent === g?.id);
  return { group: !!g, kinds: kids.map((k) => k.kind), op: kids.map((k) => k.shape?.fillOpacity ?? 1) };
`);
check('placing an SVG gives an editable group of shapes', placed.group && placed.kinds.length === 2 && placed.kinds.every((k) => k === 'shape') && placed.op.some((o) => Math.abs(o - 0.5) < 0.01), placed);

// ---- Social Studio
await fresh(1080, 1080, 'Post');
await sleep(200);
const adapted = await b.eval(`
  const { store } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  const card = makeLayer({ kind: 'shape', name: 'Card', x: 340, y: 340, width: 400, height: 400, shape: { shape: 'rectangle', fill: '#ff0000', fillEnabled: true, stroke: '#000', strokeWidth: 0, radius: 24 } });
  store.commit('Card', { layers: [...store.doc.layers, card], activeId: card.id });
  const ss = await import('/src/core/socialStudio.ts');
  const before = store.state.docs.length;
  const srcId = store.doc.id;
  const n = ss.resizeForPlatforms(['ig-story', 'yt-thumb']);
  const docs = store.state.docs.slice(before);
  const story = docs[0];
  const sc = story.layers.find((l) => l.name === 'Card');
  const bg = story.layers.find((l) => l.name === 'Background');
  return { n, back: store.doc.id === srcId, sizes: docs.map((d) => d.width + 'x' + d.height), card: sc && { cx: sc.x + sc.width / 2, cy: sc.y + sc.height / 2, w: sc.width, live: sc.kind === 'shape' }, bg: bg && { w: bg.width, h: bg.height, x: bg.x } };
`);
check('Resize for platforms opens one tab per size and returns to the source', adapted.n === 2 && adapted.back && adapted.sizes.join() === '1080x1920,1280x720', adapted);
// Centred in the story's visible area (top 250 px: profile bar, bottom 340 px: reply bar)
check('story: content stays live and centred in the safe zone, background covers the taller canvas', adapted.card?.live && Math.abs(adapted.card.cx - 540) < 1 && Math.abs(adapted.card.cy - (250 + 1920 - 340) / 2) < 1 && adapted.bg && adapted.bg.h >= 1920 && adapted.bg.x <= 0, adapted);
await b.eval(`window.__ps.store.set({ dialog: { type: 'socialStudio' } })`);
await sleep(200);
const dlg = await b.eval(`return document.querySelector('.social-studio')?.innerText ?? ''`);
check('Social Studio dialog opens with all four tools', /resize for every platform/i.test(dlg) && /carousel/i.test(dlg) && /profile grid/i.test(dlg) && /legibility/i.test(dlg), dlg.slice(0, 100));
const car = await b.eval(`
  const { store } = window.__ps;
  store.set({ dialog: null });
  const ss = await import('/src/core/socialStudio.ts');
  const d = ss.createCarousel(4, 'ig-portrait');
  return { w: d.width, h: d.h ?? d.height, grids: (store.doc.grids ?? []).map((g) => g.kind), slides: ss.carouselSlides(store.doc).length };
`);
check('New carousel: 4 × 1080 wide with slide dividers', car.w === 4320 && car.h === 1350 && car.grids.includes('panels') && car.slides === 4, car);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close?.();
process.exit(failed.length ? 1 : 0);
