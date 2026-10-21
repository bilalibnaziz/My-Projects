// Gradient annotator on the canvas (real pointer: drag the end, drag a stop, add a stop by clicking the
// line, pull a stop off to delete it), gradient strokes (pixels + SVG), and global document swatches
// (apply links, editing the swatch recolours every linked use, saved in the project, undo).
import { connect, sleep, ALT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
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
const steps = (a, d, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n }));
const grad = () => b.eval(`return window.__ps.store.activeLayer?.shape?.gradient`);

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Gradients');
  const { makeLayer } = await import('/src/core/types.ts');
  const l = makeLayer({ kind: 'shape', name: 'Card', x: 200, y: 200, width: 400, height: 200, shape: {
    shape: 'rectangle', fill: '#000000', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0,
    gradient: { type: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] },
  } });
  store.insertLayer(l, undefined, 'Card');
  store.setSelectedLayers([l.id]);
  store.setTool('gradient');
  store.setDockTab('properties');
`);
await sleep(300);
let g = await geo();

// ---- drag the end handle from (600,300) to (600,400): the gradient turns diagonal
await b.drag(steps(S(g, 600, 300), { x: 0, y: 100 * g.zoom }), { modifiers: 4 });
await sleep(150);
let gr = await grad();
check('dragging the end handle moves only the end', gr && gr.x0 === 0 && gr.y0 === 0.5 && Math.abs(gr.x1 - 1) < 0.01 && Math.abs(gr.y1 - 1) < 0.02, gr);
check('the gradient keeps both stops', gr?.stops.length === 2);
await b.eval(`window.__ps.store.undo()`);
await sleep(100);
gr = await grad();
check('one undo step restores the direction', gr.y1 === 0.5, gr);

// ---- click the line at 25 %: a stop is added there, in the colour at that point
await b.click(S(g, 300, 300).x, S(g, 300, 300).y);
await sleep(150);
gr = await grad();
check('clicking the line adds a stop at 25 %', gr.stops.length === 3 && Math.abs(gr.stops[2].offset - 0.25) < 0.01 && gr.stops[2].color === '#404040', gr.stops);
check('the new stop is picked (shared with the panel)', await b.eval(`const m = await import('/src/core/gradientAnnotator.ts'); return m.gradientPick.stop`) === 2);
const pickedPanel = await b.eval(`return document.querySelector('.gradient-editor:not(.stroke) .grad-stop.active')?.getAttribute('aria-label') ?? ''`);
check('the Appearance editor shows the same stop', /25%/.test(pickedPanel), pickedPanel);

// ---- drag that stop to 75 %
await b.drag(steps(S(g, 300, 300), { x: 200 * g.zoom, y: 0 }), { modifiers: 4 });
await sleep(150);
gr = await grad();
check('dragging a stop moves it along the line (75 %)', Math.abs(gr.stops[2].offset - 0.75) < 0.01, gr.stops[2]);
let p = await px(500, 300);
check('the moved stop renders (dark grey at 75 %)', Math.abs(p[0] - 64) <= 4, p);

// ---- pull it off the line: deleted
await b.drag(steps(S(g, 500, 300), { x: 0, y: 120 * g.zoom }), { modifiers: 4 });
await sleep(150);
gr = await grad();
check('pulling a stop off the line deletes it', gr.stops.length === 2, gr.stops);

// ---- a drag on empty canvas still lays down a new gradient
await b.drag(steps(S(g, 300, 220), { x: 0, y: 160 * g.zoom }), { modifiers: 4 });
await sleep(150);
gr = await grad();
check('a drag away from the handles draws a new (vertical) gradient', Math.abs(gr.x0 - gr.x1) < 0.01 && gr.y1 > gr.y0, gr);

// ---- the options bar drives a new gradient: Foreground → Transparent, Reverse, Reflected, Radial
await b.eval(`
  const { store } = window.__ps;
  const l = store.activeLayer;
  store.updateLayer(l.id, { shape: { ...l.shape, gradient: undefined } }, 'Solid');
  store.set({ fg: '#ff0000', bg: '#0000ff' });
  store.setOpts({ gradientMode: 'fg-transparent', gradientReverse: true, gradientType: 'linear' });
`);
await b.drag(steps(S(g, 300, 300), { x: 200 * g.zoom, y: 0 }), { modifiers: 4 });
await sleep(150);
gr = await grad();
check('Foreground → Transparent + Reverse', gr.stops[0].color === '#ff000000' && gr.stops[1].color === '#ff0000', gr.stops);
await b.eval(`const { store } = window.__ps; const l = store.activeLayer; store.updateLayer(l.id, { shape: { ...l.shape, gradient: undefined } }, 'Solid'); store.setOpts({ gradientMode: 'fg-bg', gradientReverse: false, gradientType: 'reflected' })`);
await b.drag(steps(S(g, 400, 300), { x: 100 * g.zoom, y: 0 }), { modifiers: 4 });
await sleep(150);
gr = await grad();
check('Reflected: mirrored about the press point', gr.type === 'linear' && gr.stops.length === 3 && gr.stops[1].color === '#ff0000' && Math.abs(gr.x0 - 0.25) < 0.02 && Math.abs(gr.x1 - 0.75) < 0.02, gr);
await b.eval(`const { store } = window.__ps; const l = store.activeLayer; store.updateLayer(l.id, { shape: { ...l.shape, gradient: undefined } }, 'Solid'); store.setOpts({ gradientType: 'radial' })`);
await b.drag(steps(S(g, 400, 300), { x: 100 * g.zoom, y: 0 }), { modifiers: 4 });
await sleep(150);
gr = await grad();
check('Radial in the options bar draws a radial gradient', gr.type === 'radial', gr.type);
await b.eval(`window.__ps.store.setOpts({ gradientType: 'linear' })`);

// ---- gradient stroke
await b.eval(`
  const { store } = window.__ps;
  const l = store.activeLayer;
  store.updateLayer(l.id, { shape: { ...l.shape, gradient: undefined, fill: '#ffffff', strokeWidth: 20,
    strokeGradient: { type: 'linear', x0: 0, y0: 0.5, x1: 1, y1: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } } }, 'Stroke gradient');
`);
await sleep(150);
const left = await px(200, 300), right = await px(600, 300);
check('gradient stroke renders red on the left edge, blue on the right', left[0] > 200 && left[2] < 60 && right[2] > 200 && right[0] < 60, { left, right });
const svg = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc)`);
check('SVG export strokes with a linearGradient', /stroke="url\(#grad\d+\)"/.test(svg) && svg.includes('stop-color="#ff0000"'), svg.slice(0, 160));
const strokeEditor = await b.eval(`return !!document.querySelector('.gradient-editor.stroke .grad-bar')`);
check('Appearance shows a stroke gradient editor', strokeEditor);

// ---- pattern fill
await b.eval(`
  const { store, ops } = window.__ps;
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Pattern');
  const { makeLayer } = await import('/src/core/types.ts');
  const l = makeLayer({ kind: 'shape', name: 'Box', x: 200, y: 200, width: 240, height: 240, shape: { shape: 'rectangle', fill: '#ffcc00', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0 } });
  store.insertLayer(l, undefined, 'Box');
  store.setSelectedLayers([l.id]);
  store.setTool('move');
  store.setDockTab('properties');
`);
await sleep(300);
const patBtn = await b.eval(`const el = [...document.querySelectorAll('.gradient-editor:not(.stroke) button')].find((e) => e.textContent === 'Pattern'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
await b.click(patBtn.x, patBtn.y);
await sleep(200);
let pat = await b.eval(`return window.__ps.store.activeLayer.shape.pattern`);
check('Pattern makes a dot pattern: dark ink on the yellow fill', pat?.preset === 'dots' && pat.fg === '#1f1f1f' && pat.bg === '#ffcc00', pat);
// Dots 24 px tiles from (200,200): ink at the tile centre (212,212), background at the tile corner (201,201)
let ink = await px(212, 212), back = await px(201, 201);
check('dots render: ink at the tile centre, background at its corner', ink[0] < 60 && back[0] > 240 && back[2] < 40, { ink, back });
const patternChipsCount = await b.eval(`return document.querySelectorAll('.pattern-chip').length`);
check('the picker shows every preset', patternChipsCount === 10, patternChipsCount);
const stripes = await b.eval(`const el = document.querySelector('.pattern-chip[aria-label="Stripes"]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
await b.click(stripes.x, stripes.y);
await sleep(150);
pat = await b.eval(`return window.__ps.store.activeLayer.shape.pattern`);
// Stripes: ink in the top quarter of each tile (h = 24 · 0.5 · 0.5 = 6)
ink = await px(300, 202);
back = await px(300, 215);
check('switching to Stripes re-renders the motif', pat.preset === 'stripes' && ink[0] < 60 && back[0] > 240, { ink, back });
const psvg = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc)`);
check('SVG export writes a vector <pattern> fill', /<pattern id="pat\d+" patternUnits="userSpaceOnUse" width="24" height="24"/.test(psvg) && /fill="url\(#pat\d+\)"/.test(psvg), psvg.slice(200, 400));
const pdf = await b.eval(`const { buildVectorPdf } = await import('/src/core/formats/vectorPdf.ts'); const r = await buildVectorPdf(window.__ps.store.doc); return { n: r.bytes.length, stats: r.stats }`);
check('PDF export works with a pattern (that layer becomes a 300 dpi image)', pdf.n > 1000 && pdf.stats.reasons.pattern === 1, pdf);

// ---- global swatches
await b.eval(`
  const { store, ops } = window.__ps;
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Brand');
  const { makeLayer } = await import('/src/core/types.ts');
  const mk = (name, x) => makeLayer({ kind: 'shape', name, x, y: 200, width: 150, height: 100, shape: { shape: 'rectangle', fill: '#cccccc', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0 } });
  for (const [n, x] of [['A', 100], ['B', 300], ['C', 500]]) store.insertLayer(mk(n, x), undefined, n);
  store.setTool('move');
  store.setDockTab('properties');
  const A = store.doc.layers.find((l) => l.name === 'A');
  store.setSelectedLayers([A.id]);
  const { addSwatch, applySwatch } = await import('/src/core/swatches.ts');
  const id = addSwatch('#2255ee', { name: 'Brand blue' });
  applySwatch(id, 'fill', store.selectedLayers);
`);
await sleep(200);
let chips = await b.eval(`return [...document.querySelectorAll('.doc-swatch')].map((e) => e.getAttribute('aria-label') + (e.classList.contains('linked') ? ':linked' : ''))`);
check('the swatch shows in Appearance, linked to the selection', chips.length === 1 && chips[0] === 'Brand blue:linked', chips);
// Select B and C and click the chip: both get the swatch fill
await b.eval(`const { store } = window.__ps; store.setSelectedLayers(store.doc.layers.filter((l) => l.name === 'B' || l.name === 'C').map((l) => l.id))`);
await sleep(150);
const chip = await b.eval(`const el = document.querySelector('.doc-swatch'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
await b.click(chip.x, chip.y);
await sleep(150);
let fills = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => [l.name, l.shape.fill, l.shape.fillSwatch ? 'link' : '-'])`);
check('clicking the chip fills the selection and links it', fills.every(([, f, k]) => f === '#2255ee' && k === 'link'), fills);
// ⌥-click: stroke
await b.click(chip.x, chip.y, { modifiers: ALT });
await sleep(150);
const strokes = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.name === 'B').map((l) => [l.shape.stroke, l.shape.strokeWidth, !!l.shape.strokeSwatch])[0]`);
check('⌥-click applies it to the stroke', strokes[0] === '#2255ee' && strokes[1] > 0 && strokes[2], strokes);
// C gets a different colour by hand: it stops following
await b.eval(`const { store } = window.__ps; const C = store.doc.layers.find((l) => l.name === 'C'); store.updateLayer(C.id, { shape: { ...C.shape, fill: '#30a46c' } }, 'Hand colour')`);
// Edit the swatch
await b.eval(`const { store } = window.__ps; const { setSwatchColor } = await import('/src/core/swatches.ts'); setSwatchColor(store.doc.swatches[0].id, '#ff8800')`);
await sleep(150);
fills = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => [l.name, l.shape.fill, l.shape.stroke])`);
check('editing the swatch recolours every linked use (A, B fill + B stroke)', fills[0][1] === '#ff8800' && fills[1][1] === '#ff8800' && fills[1][2] === '#ff8800', fills);
check('…but not the one recoloured by hand (C)', fills[2][1] === '#30a46c', fills[2]);
p = await px(175, 250);
check('the recoloured fill renders', p[0] > 240 && Math.abs(p[1] - 136) < 4 && p[2] < 10, p);
await b.eval(`window.__ps.store.undo()`);
await sleep(150);
fills = await b.eval(`return [window.__ps.store.doc.swatches[0].color, ...window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.shape.fill)]`);
check('undo puts the swatch and every use back in one step', fills[0] === '#2255ee' && fills[1] === '#2255ee' && fills[2] === '#2255ee' && fills[3] === '#30a46c', fills);
await b.eval(`window.__ps.store.redo()`);
await sleep(100);
// Save → open keeps the swatches and the links that still hold (C was recoloured by hand)
const reloaded = await b.eval(`
  const io = await import('/src/core/io.ts');
  const { linkedSwatch } = await import('/src/core/swatches.ts');
  const json = io.serializeProject(window.__ps.store.doc);
  const d = await io.loadProject(json, 'Reloaded');
  return { swatches: d.swatches, linked: d.layers.filter((l) => linkedSwatch(d, l, 'fill')).length };
`);
check('swatches and links survive save / open', reloaded.swatches?.[0]?.color === '#ff8800' && reloaded.linked === 2, reloaded);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
if (failed.length) process.exit(1);
