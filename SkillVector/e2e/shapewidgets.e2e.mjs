// On-canvas live shape widgets with real pointer input: corner dots round a rectangle (all corners,
// one corner with ⌥, style cycle with ⌥-click), at any rotation, with the shape tool or the Selection
// tool; the polygon sides diamond, star inner handle, ellipse pie and hole handles. Pixels are checked
// on the rendered document, and each drag is one undo step.
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
const isWhite = (p) => p[0] > 240 && p[1] > 240 && p[2] > 240;
const isBlue = (p) => p[2] > 180 && p[0] < 90;
const shape = () => b.eval(`const l = window.__ps.store.activeLayer; return l && { id: l.id, n: window.__ps.store.doc.layers.length, rot: l.rotation ?? 0, ...l.shape, points: undefined }`);
/** The widgets of the shown shape, in screen coordinates. */
const widgets = async () => {
  const g = await geo();
  const ws = await b.eval(`
    const tools = await import('/src/core/tools.ts');
    const { shapeWidgets } = await import('/src/core/shapeWidgets.ts');
    const l = tools.widgetLayer();
    return l ? shapeWidgets(l, window.__ps.store.doc.view.zoom) : [];
  `);
  return ws.map((w) => ({ ...w, ...S(g, w.x, w.y) }));
};
const steps = (a, d, n = 8) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n }));
const tool = (t) => b.eval(`window.__ps.store.setTool(${JSON.stringify(t)})`);

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Widgets');
  store.set({ fg: '#2255ee' });
  store.setOpts({ shapeFill: true, shapeStrokeWidth: 0, shapeRadius: 0, shapeSides: 6, shapeExtras: {}, transformControls: true });
`);
await sleep(400);
let g = await geo();

// ---- rectangle tool: draw, then the corner widgets appear on it
await tool('shape-rect');
await b.drag(steps(S(g, 200, 200), { x: 300 * g.zoom, y: 200 * g.zoom }));
await sleep(150);
let s = await shape();
let ws = await widgets();
check('drawn rectangle shows 4 corner widgets with the Rectangle tool', s?.shape === 'rectangle' && ws.length === 4 && ws.every((w) => w.kind === 'corner'), ws.length);
check('sharp corner before', isBlue(await px(201, 201)));

// Drag the top-left dot 40 doc px toward the centre: all four corners round
const layersBefore = s.n;
await b.drag(steps(ws[0], { x: 40 * g.zoom, y: 40 * g.zoom }));
await sleep(150);
s = await shape();
check('corner drag rounds all corners by the distance moved (40)', Math.abs(s.radius - 40) < 1.5 && !s.radii, { r: s.radius, zoom: g.zoom });
check('corner drag did not draw a new shape', s.n === layersBefore, s.n);
check('rounded pixels: corner cleared, inside filled', isWhite(await px(203, 203)) && isWhite(await px(497, 397)) && isBlue(await px(350, 300)));
const r1 = s.radius;

// One undo step per drag
await b.eval(`window.__ps.store.undo()`);
await sleep(100);
s = await shape();
check('undo restores the sharp rectangle in one step', s.radius === 0, s.radius);
await b.eval(`window.__ps.store.redo()`);
await sleep(100);

// ⌥-drag the top-right dot: only that corner changes
ws = await widgets();
await b.drag(steps(ws[1], { x: -20 * g.zoom, y: 20 * g.zoom }), { modifiers: ALT });
await sleep(150);
s = await shape();
check('⌥ drag rounds one corner only', !!s.radii && Math.abs(s.radii[1] - (r1 + 20)) < 2 && Math.abs(s.radii[0] - r1) < 0.5 && Math.abs(s.radii[2] - r1) < 0.5, s.radii);

// ⌥-click cycles the corner style
ws = await widgets();
const style0 = s.cornerStyle ?? 'round';
await b.click(ws[2].x, ws[2].y, { modifiers: ALT });
await sleep(150);
s = await shape();
check('⌥ click cycles the corner style', (s.cornerStyle ?? 'round') !== style0, { from: style0, to: s.cornerStyle });

// Selection tool, rotated shape: widgets follow the rotation and still drag along the corner diagonal
await tool('move');
await b.eval(`
  const { store } = window.__ps;
  const l = store.activeLayer;
  store.updateLayer(l.id, { rotation: 30, shape: { ...l.shape, radii: undefined, radius: 10, cornerStyle: 'round' } }, 'Prep');
`);
await sleep(150);
ws = await widgets();
check('Selection tool shows the widgets too', ws.length === 4);
const a = (30 * Math.PI) / 180;
const d = 30 * g.zoom;
await b.drag(steps(ws[2], { x: -d * Math.cos(a) + d * Math.sin(a), y: -d * Math.sin(a) - d * Math.cos(a) }));
await sleep(150);
s = await shape();
check('rotated rectangle: inward drag adds the distance moved', Math.abs(s.radius - 40) < 1.5 && s.rot === 30, { r: s.radius });

// Away from the widgets the shape tool still draws
await tool('shape-rect');
await b.drag(steps(S(g, 650, 450), { x: 120 * g.zoom, y: 90 * g.zoom }));
await sleep(150);
s = await shape();
check('shape tool still draws away from the widgets, with the last radius remembered', s.n === layersBefore + 1 && s.shape === 'rectangle' && Math.abs(s.radius - 40) < 1.5, { n: s.n, r: s.radius });

// ---- polygon: sides diamond and point rounding
await tool('shape-polygon');
await b.drag(steps(S(g, 100, 420), { x: 200 * g.zoom, y: 200 * g.zoom }));
await sleep(150);
s = await shape();
ws = await widgets();
const sides = ws.find((w) => w.kind === 'sides');
const sides0 = s.sides;
check('polygon shows sides + rounding widgets', !!sides && ws.some((w) => w.kind === 'point-round'), ws.map((w) => w.kind));
await b.drag(steps(sides, { x: 0, y: -60 }));
await sleep(150);
s = await shape();
check('dragging the sides diamond up adds sides', s.sides > sides0, { from: sides0, to: s.sides });
ws = await widgets();
const pr = ws.find((w) => w.kind === 'point-round');
await b.drag(steps(pr, { x: 0, y: 14 * g.zoom }));
await sleep(150);
s = await shape();
check('point widget rounds every point', s.pointRadius > 10, s.pointRadius);

// ---- star: inner radius handle
await tool('shape-star');
await b.drag(steps(S(g, 380, 450), { x: 200 * g.zoom, y: 200 * g.zoom }));
await sleep(150);
ws = await widgets();
const inner = ws.find((w) => w.kind === 'star-inner');
const c = S(g, 480, 550);
await b.drag([inner, { x: (inner.x + c.x) / 2, y: (inner.y + c.y) / 2 }, { x: c.x + 80 * g.zoom, y: c.y }]);
await sleep(150);
s = await shape();
check('star inner handle sets the inner radius where dropped (80%)', Math.abs((s.innerRatio ?? 0) - 0.8) < 0.03, s.innerRatio);

// ---- ellipse: pie and hole
await tool('shape-ellipse');
await b.drag(steps(S(g, 620, 60), { x: 240 * g.zoom, y: 240 * g.zoom }));
await sleep(150);
ws = await widgets();
const pie = ws.find((w) => w.kind === 'pie-start');
const ec = S(g, 740, 180);
await b.drag([pie, { x: ec.x + 100 * g.zoom, y: ec.y + 60 * g.zoom }, { x: ec.x, y: ec.y + 120 * g.zoom }]);
await sleep(150);
s = await shape();
check('pie handle dragged to 6 o’clock opens a 270° pie', Math.abs(s.pieStart - 90) < 2 && s.pieEnd === 360, { s: s.pieStart, e: s.pieEnd });
check('pie wedge (3 → 6 o’clock) is empty, the rest filled', isWhite(await px(790, 230)) && isBlue(await px(790, 130)) && isBlue(await px(690, 230)));
ws = await widgets();
check('an open pie shows its end handle', ws.some((w) => w.kind === 'pie-end'));
const hole = ws.find((w) => w.kind === 'hole');
// The hole handle sits on the bisector; drag it to 50 % of the radius on the same side
const hx = (hole.x - ec.x) / Math.hypot(hole.x - ec.x, hole.y - ec.y);
const hy = (hole.y - ec.y) / Math.hypot(hole.x - ec.x, hole.y - ec.y);
await b.drag([hole, { x: ec.x + hx * 60 * g.zoom, y: ec.y + hy * 60 * g.zoom }]);
await sleep(150);
s = await shape();
check('hole handle makes a ring', Math.abs((s.hole ?? 0) - 0.5) < 0.03, s.hole);
check('the hole is empty', isWhite(await px(700, 175)));

// ---- Direct Selection on a live shape: a miss keeps it live, grabbing an anchor converts it; the anchor panel edits it
await b.eval(`
  const { store } = window.__ps;
  store.setDockTab('properties');
  store.setOpts({ shapeRadius: 0, shapeExtras: {} });
  store.setTool('shape-rect');
`);
await b.drag(steps(S(g, 100, 60), { x: 200 * g.zoom, y: 100 * g.zoom }));
await sleep(150);
await b.eval(`window.__ps.store.setTool('direct-select')`);
await sleep(100);
let p0 = S(g, 200, 110);
await b.click(p0.x, p0.y);
await sleep(150);
s = await shape();
check('Direct Selection click inside a live rectangle keeps it live', s.shape === 'rectangle', s.shape);
p0 = S(g, 300, 60);
await b.drag([p0, { x: p0.x + 10 * g.zoom, y: p0.y }, { x: p0.x + 20 * g.zoom, y: p0.y }]);
await sleep(150);
s = await shape();
const lay = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y, w: l.width, h: l.height }`);
check('grabbing a corner anchor converts it and moves the point', s.shape === 'path' && Math.abs(lay.w - 220) < 1.5, lay);
const panel = await b.eval(`return document.querySelector('.anchor-section')?.innerText ?? ''`);
check('Properties shows the picked anchor', /anchor \d of 4/i.test(panel) && panel.includes('Corner'), panel.slice(0, 80));
const btn = await b.eval(`
  const el = [...document.querySelectorAll('.anchor-section button')].find((e) => e.textContent === 'Smooth');
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
`);
await b.click(btn.x, btn.y);
await sleep(150);
const info = await b.eval(`const { selectedAnchor } = await import('/src/core/anchorEdit.ts'); const a = selectedAnchor(); return a && { kind: a.kind, inLen: a.inLen, outLen: a.outLen, x: a.x, y: a.y }`);
check('Smooth button gives the anchor in-line handles', info && info.kind !== 'corner' && info.kind !== 'cusp' && info.inLen > 5 && info.outLen > 5, info);
await b.eval(`const m = await import('/src/core/anchorEdit.ts'); m.moveAnchorTo(undefined, 40)`);
await sleep(100);
const moved = await b.eval(`const { selectedAnchor } = await import('/src/core/anchorEdit.ts'); return selectedAnchor()?.y`);
check('typed Y moves the anchor', Math.abs(moved - 40) < 0.01, moved);

const exc = b.logs.filter((l) => l.startsWith('[exception]'));
check('no exceptions', !exc.length, exc);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
