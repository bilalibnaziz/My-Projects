// Appearance + live corners with real input: fill / stroke / object opacity (rendered pixels, SVG),
// the Properties Appearance section editing a multi-selection, number-key opacity, a rounded-rectangle
// "button" that stays rounded after its points are edited with Direct Selection, Live Corner widgets on
// a pen path, the anchor Corner field, and the gradient editor (stops, stop opacity).
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
const near = (p, q, tol = 6) => p.slice(0, 3).every((v, i) => Math.abs(v - q[i]) <= tol);
const isWhite = (p) => p[0] > 240 && p[1] > 240 && p[2] > 240;
const steps = (a, d, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n }));
const active = () => b.eval(`const l = window.__ps.store.activeLayer; return l && { id: l.id, opacity: l.opacity, blend: l.blend, x: l.x, y: l.y, w: l.width, h: l.height, ...l.shape }`);
/** Sets a React-controlled range input like a user drag would. */
const setRange = (labelRe, value) => b.eval(`
  const sec = document.querySelector('.appearance-section');
  const sl = [...sec.querySelectorAll('.slider')].find((s) => ${labelRe}.test(s.querySelector('.slider-label')?.textContent ?? ''));
  if (!sl) return false;
  const input = sl.querySelector('input[type=range]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, String(${value}));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
`);
const center = (sel) => b.eval(`
  const el = ${sel};
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
`);

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Appearance');
  store.set({ fg: '#2255ee' });
  store.setOpts({ shapeFill: true, shapeStrokeWidth: 0, shapeRadius: 0, shapeSides: 6, shapeExtras: {}, transformControls: true, liveCorners: true });
  store.setDockTab('properties');
`);
await sleep(400);
let g = await geo();

// ---- fill opacity / stroke opacity render
await b.eval(`window.__ps.store.setTool('shape-rect')`);
await b.drag(steps(S(g, 100, 100), { x: 200 * g.zoom, y: 100 * g.zoom }));
await sleep(150);
let s = await active();
check('rectangle drawn', s?.shape === 'rectangle', s?.shape);
await b.eval(`window.__ps.store.setTool('move')`);
await sleep(100);
const sec = await b.eval(`return document.querySelector('.appearance-section')?.innerText ?? ''`);
check('Appearance shows opacity, blend, fill and stroke for a shape', /opacity/i.test(sec) && /blend/i.test(sec) && /fill opacity/i.test(sec) && /stroke/i.test(sec), sec.slice(0, 200));
check('fill opacity slider moved', await setRange('/^Fill opacity/i', 50));
await sleep(150);
s = await active();
check('Fill opacity 50% stored on the shape', Math.abs(s.fillOpacity - 0.5) < 1e-6, s.fillOpacity);
let p = await px(200, 150);
check('fill opacity 50% renders half-blended blue on white', near(p, [144, 170, 246], 4), p);

await b.eval(`
  const { store } = window.__ps;
  const l = store.activeLayer;
  store.updateLayer(l.id, { shape: { ...l.shape, fillOpacity: undefined, stroke: '#000000', strokeWidth: 20, strokeOpacity: 0.5 } }, 'Stroke');
`);
await sleep(150);
// Centre of the stroke on the left edge: outer half over white, inner half over the opaque fill
const pOut = await px(93, 150), pIn = await px(107, 150);
check('stroke opacity 50% over white = mid grey', near(pOut, [128, 128, 128], 4), pOut);
check('stroke opacity 50% over the blue fill = darkened blue', near(pIn, [17, 43, 119], 4), pIn);
const svgText = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc)`);
check('SVG export writes stroke-opacity', typeof svgText === 'string' && svgText.includes('stroke-opacity="0.5"'), typeof svgText === 'string' ? svgText.slice(0, 120) : svgText);

// ---- multi-selection: one Opacity change for every selected object
await b.eval(`window.__ps.store.setTool('shape-ellipse')`);
await b.drag(steps(S(g, 450, 100), { x: 150 * g.zoom, y: 150 * g.zoom }));
await sleep(150);
await b.eval(`
  const { store } = window.__ps;
  store.setTool('move');
  const ids = store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id);
  store.setSelectedLayers(ids);
`);
await sleep(150);
const secMulti = await b.eval(`return document.querySelector('.appearance-section')?.innerText ?? ''`);
check('Appearance counts the selected objects', /2 objects/i.test(secMulti), secMulti.slice(0, 80));
check('opacity slider moved', await setRange('/^Opacity/i', 40));
await sleep(150);
let ops2 = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.opacity)`);
check('Opacity applies to every selected object', ops2.length === 2 && ops2.every((o) => Math.abs(o - 0.4) < 1e-6), ops2);
await b.eval(`window.__ps.store.undo()`);
await sleep(100);
ops2 = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.opacity)`);
check('one undo step restores both', ops2.every((o) => o === 1), ops2);

// ---- number keys set the selection's opacity
await b.eval(`
  const { store } = window.__ps;
  const ids = store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id);
  store.setSelectedLayers(ids);
  document.activeElement?.blur?.();
  return document.activeElement?.tagName;
`);
await sleep(100);
await b.key('5');
await sleep(80);
ops2 = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.opacity)`);
check('key 5 → 50% on the selected objects', ops2.every((o) => Math.abs(o - 0.5) < 1e-6), ops2);
await sleep(700);
await b.key('7');
await b.key('5');
await sleep(80);
ops2 = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.opacity)`);
check('quick 7 5 → 75%', ops2.every((o) => Math.abs(o - 0.75) < 1e-6), ops2);
await sleep(700);
await b.key('0');
await sleep(80);
const brushOp = await b.eval(`return window.__ps.store.state.opts.opacity`);
ops2 = await b.eval(`return window.__ps.store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.opacity)`);
check('key 0 → 100%, the brush opacity is untouched', ops2.every((o) => o === 1) && brushOp !== undefined, { ops2, brushOp });

// ---- a rounded "button" stays rounded after its points are edited
await b.eval(`
  const { store, ops } = window.__ps;
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Button');
  store.setOpts({ shapeRadius: 24, shapeExtras: {}, shapeStrokeWidth: 0 });
  store.setDockTab('properties');
  store.setTool('shape-rect');
`);
await sleep(400);
g = await geo();
await b.drag(steps(S(g, 200, 200), { x: 300 * g.zoom, y: 100 * g.zoom }));
await sleep(150);
s = await active();
check('rounded button drawn (radius 24)', s.radius === 24 || (s.radii && s.radii[0] === 24), { r: s.radius, radii: s.radii });
check('corner of the button is clear before', isWhite(await px(202, 202)));
await b.eval(`window.__ps.store.setTool('direct-select')`);
await sleep(100);
// Drag the bottom-right anchor 40 px right
const br = S(g, 500, 300);
await b.drag(steps(br, { x: 40 * g.zoom, y: 0 }, 6));
await sleep(200);
s = await active();
const corners = (s.points ?? []).map((a) => a.corner ?? 0);
check('Direct Selection edit converts to a 4-anchor path with live corners', s.shape === 'path' && s.points?.length === 4 && corners.every((c) => Math.abs(c - 24) < 0.01), { shape: s.shape, n: s.points?.length, corners });
check('the edited button still has round corners (pixels)', isWhite(await px(202, 202)) && isWhite(await px(538, 298)) && !isWhite(await px(260, 250)), [await px(202, 202), await px(538, 298)]);

// The anchor panel shows the corner radius of the picked anchor
const anchorPanel = await b.eval(`return document.querySelector('.anchor-section')?.innerText ?? ''`);
check('anchor panel shows a Corner field', /corner/i.test(anchorPanel), anchorPanel.slice(0, 160));
await b.eval(`const m = await import('/src/core/anchorEdit.ts'); m.setAnchorCorner(4)`);
await sleep(100);
s = await active();
const ci = await b.eval(`return (await import('/src/core/tools.ts')).interaction.selectedAnchorIndex`);
check('Corner field sets only that anchor', s.points[ci].corner === 4 && s.points.filter((a, i) => i !== ci).every((a) => a.corner === 24), s.points.map((a) => a.corner));

// ---- Live Corner widgets on the path: ⌥-drag one corner, drag all
const pathWidgets = async () => {
  const g2 = await geo();
  const ws = await b.eval(`
    const tools = await import('/src/core/tools.ts');
    const { shapeWidgets } = await import('/src/core/shapeWidgets.ts');
    const l = tools.widgetLayer();
    return l ? shapeWidgets(l, window.__ps.store.doc.view.zoom) : [];
  `);
  return ws.map((w) => ({ ...w, ...S(g2, w.x, w.y) }));
};
let ws = await pathWidgets();
check('path shows 4 corner widgets with Direct Selection', ws.length === 4 && ws.every((w) => w.kind === 'path-corner'), ws.map((w) => w.kind));
const w0 = ws.find((w) => w.index === 0);
// Drag the top-left dot back toward the anchor: radius shrinks by the distance along the diagonal
await b.drag(steps(w0, { x: -10 * g.zoom, y: -10 * g.zoom }), { modifiers: ALT });
await sleep(150);
s = await active();
check('⌥-drag changes only that corner (24 → ~14)', Math.abs(s.points[0].corner - 14) < 1.5 && s.points[1].corner === 24 && s.points[2].corner === 4 && s.points[3].corner === 24, s.points.map((a) => a.corner));
ws = await pathWidgets();
const w1 = ws.find((w) => w.index === 1);
await b.click(w1.x, w1.y, { modifiers: ALT });
await sleep(150);
s = await active();
check('⌥-click makes that corner sharp', !s.points[1].corner, s.points.map((a) => a.corner));
check('sharp corner pixel filled (top-right anchor at 500,200)', !isWhite(await px(498, 202)), await px(498, 202));
await b.eval(`window.__ps.store.undo()`);
await sleep(100);
s = await active();
check('undo restores the corner in one step', s.points[1].corner === 24, s.points.map((a) => a.corner));

// ---- pen-drawn triangle gets widgets too
await b.eval(`
  const { store } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  const c = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y, type: 'corner' });
  const l = makeLayer({ kind: 'shape', name: 'Pen triangle', x: 600, y: 380, width: 240, height: 240, shape: {
    shape: 'path', fill: '#e5484d', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0, closed: true,
    points: [c(0, 0), c(1, 0), c(0, 1)],
  } });
  store.insertLayer(l, undefined, 'Pen triangle');
  store.setSelectedLayers([l.id]);
  store.setTool('move');
`);
await sleep(200);
ws = await pathWidgets();
check('pen triangle shows 3 widgets with the Selection tool', ws.length === 3, ws.length);
const tw = ws.find((w) => w.index === 0);
await b.drag(steps(tw, { x: 30 * g.zoom, y: 30 * g.zoom }));
await sleep(150);
s = await active();
check('drag rounds every triangle corner (≈30)', s.points.every((a) => Math.abs((a.corner ?? 0) - 30) < 1.5), s.points.map((a) => a.corner));
check('triangle right-angle corner is now clear', isWhite(await px(603, 383)), await px(603, 383));
const props = await b.eval(`return document.querySelector('.appearance-section')?.innerText ?? ''`);
check('Appearance offers a Corners radius for paths', /corners/i.test(props), props.slice(-120));

// ---- gradient editor
const linear = await center(`[...document.querySelectorAll('.gradient-editor button')].find((e) => e.textContent === 'Linear')`);
check('gradient editor shown', !!linear);
await b.click(linear.x, linear.y);
await sleep(150);
s = await active();
check('Linear makes a 2-stop gradient', s.gradient?.type === 'linear' && s.gradient.stops.length === 2, s.gradient);
const barR = await b.eval(`const r = document.querySelector('.grad-bar').getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + r.height / 2 }`);
await b.click(barR.l + barR.w / 2, barR.y);
await sleep(150);
s = await active();
check('clicking the bar adds a stop at 50%', s.gradient.stops.length === 3 && Math.abs(s.gradient.stops[2].offset - 0.5) < 0.03, s.gradient.stops);
check('stop opacity slider moved', await setRange('/^Stop opacity/i', 0));
await sleep(150);
s = await active();
check('stop opacity 0% stored as #rrggbb00', /^#[0-9a-f]{6}00$/i.test(s.gradient.stops[2].color), s.gradient.stops[2]);
await b.eval(`window.__ps.store.setOpts({ liveCorners: false })`);
await sleep(80);
ws = await pathWidgets();
check('View ▸ Corner Widgets off hides the widgets', ws.length === 0, ws.length);
await b.eval(`window.__ps.store.setOpts({ liveCorners: true })`);

// ---- Eyedropper copies a whole look onto the selection, ⌥-click paints it back
await b.eval(`
  const { store, ops } = window.__ps;
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Eyedropper');
  const { makeLayer } = await import('/src/core/types.ts');
  const mk = (name, x, shape) => makeLayer({ kind: 'shape', name, x, y: 200, width: 200, height: 80, shape: { shape: 'rectangle', fill: '#000000', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0, ...shape } });
  const src = mk('Primary', 100, { fill: '#2255ee', fillOpacity: 0.6, stroke: '#ff8800', strokeWidth: 4, radius: 40 });
  const dst = mk('Plain', 500, { fill: '#cccccc', radius: 8 });
  const third = mk('Third', 500, { fill: '#30a46c' });
  third.y = 400;
  store.insertLayer(src, undefined, 'a'); store.insertLayer(dst, undefined, 'b'); store.insertLayer(third, undefined, 'c');
  store.setSelectedLayers([dst.id]);
  store.setTool('eyedropper');
  store.setDockTab('properties');
`);
await sleep(300);
g = await geo();
let q = S(g, 200, 240);
await b.click(q.x, q.y);
await sleep(150);
let dst = await b.eval(`const l = window.__ps.store.doc.layers.find((x) => x.name === 'Plain'); return { ...l.shape, x: l.x, w: l.width }`);
check('Eyedropper click copies fill, opacity and stroke to the selection', dst.fill === '#2255ee' && Math.abs(dst.fillOpacity - 0.6) < 1e-6 && dst.stroke === '#ff8800' && dst.strokeWidth === 4, dst);
check('…but keeps its own geometry (radius 8, x 500)', dst.radius === 8 && dst.x === 500 && dst.w === 200, dst);
q = S(g, 600, 440);
await b.click(q.x, q.y, { modifiers: ALT });
await sleep(150);
const third = await b.eval(`const l = window.__ps.store.doc.layers.find((x) => x.name === 'Third'); return l.shape`);
check('⌥-click paints the selection’s look onto the clicked object', third.fill === '#2255ee' && third.strokeWidth === 4, third);
await b.eval(`window.__ps.store.undo(); window.__ps.store.undo()`);
await sleep(100);
dst = await b.eval(`const l = window.__ps.store.doc.layers.find((x) => x.name === 'Plain'); return l.shape`);
check('each eyedropper change is one undo step', dst.fill === '#cccccc', dst.fill);

// ---- Make Button: the shape hugs its label
await b.eval(`
  const { store, ops } = window.__ps;
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Button');
  store.set({ fg: '#ffffff' });
  store.setTool('type');
  const tools = await import('/src/core/tools.ts');
  tools.createTextAt(300, 300, undefined, { text: 'Buy now', size: 24, color: '#ffffff' });
  store.set({ textEditId: null });
  store.setSelectedLayers([store.doc.layers.at(-1).id]);
  store.setTool('move');
  store.setDockTab('properties');
`);
await sleep(300);
const nextSteps = await b.eval(`return [...document.querySelectorAll('.smart-actions button')].map((e) => e.textContent)`);
check('Next steps offers Make Button for a text', nextSteps.includes('Make Button'), nextSteps);
const mb = await center(`[...document.querySelectorAll('.smart-actions button')].find((e) => e.textContent === 'Make Button')`);
await b.click(mb.x, mb.y);
await sleep(200);
const bt = () => b.eval(`
  const L = window.__ps.store.doc.layers;
  const s = L.find((l) => l.hug), t = L.find((l) => l.id === s?.hug.target), g = L.find((l) => l.kind === 'group');
  return s && { s: { x: s.x, y: s.y, w: s.width, h: s.height, fill: s.shape.fill, pad: s.hug }, t: { x: t.x, y: t.y, w: t.width, h: t.height, color: t.text.color }, group: g?.name, below: L.indexOf(s) < L.indexOf(t) };
`);
let B = await bt();
check('Make Button adds a padded shape under the label, grouped', B && B.below && B.group?.startsWith('Button') && Math.abs(B.s.x - (B.t.x - B.s.pad.padX)) < 0.01 && Math.abs(B.s.w - (B.t.w + 2 * B.s.pad.padX)) < 0.01, B);
check('the white-on-white label gets a readable fill', B.s.fill !== '#ffffff', B.s.fill);
const lp = await px(Math.round(B.s.x + 4), Math.round(B.s.y + B.s.h / 2));
check('button fill renders around the label', !isWhite(lp), lp);
const bw0 = B.s.w;
await b.eval(`const tools = await import('/src/core/tools.ts'); const t = window.__ps.store.doc.layers.find((l) => l.kind === 'text'); tools.updateText(t.id, { text: 'Buy now — free shipping' })`);
await sleep(150);
B = await bt();
check('typing a longer label grows the button with the same padding', B.s.w > bw0 + 50 && Math.abs(B.s.w - (B.t.w + 2 * B.s.pad.padX)) < 0.01, { bw0, w: B.s.w });
await b.eval(`const { store } = window.__ps; const s = store.doc.layers.find((l) => l.hug); store.updateLayer(s.id, { width: s.width + 100, height: s.height + 20 }, 'Resize')`);
await sleep(150);
B = await bt();
check('resizing the button re-centres the label', Math.abs(B.t.x + B.t.w / 2 - (B.s.x + B.s.w / 2)) < 0.01 && Math.abs(B.t.y + B.t.h / 2 - (B.s.y + B.s.h / 2)) < 0.01, B);
// Drag the whole button with the Selection tool
g = await geo();
const sx = B.s.x, tx0 = B.t.x;
// From the middle of the button (the edges are resize handles); no ⌘ (that would pick the shape alone)
const from = S(g, B.s.x + B.s.w / 2, B.s.y + B.s.h / 2);
await b.drag(steps(from, { x: 80 * g.zoom, y: 0 }));
await sleep(150);
B = await bt();
check('dragging the button moves shape and label together', Math.abs(B.s.x - sx - 80) < 7 && Math.abs(B.s.x - sx - (B.t.x - tx0)) < 0.01, { ds: B.s.x - sx, dt: B.t.x - tx0 });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
if (failed.length) process.exit(1);
