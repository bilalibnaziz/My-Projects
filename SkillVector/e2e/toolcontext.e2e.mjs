// Tool-aware Properties and options bar with real pointer input: every shape tool shows its own live
// controls, presets set up the next shape or edit the selected one, and the panel only shows sections
// that fit the tool and selection. Pixels are checked on the rendered document.
import { connect, sleep, SHIFT } from './cdp.mjs';
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
const active = () => b.eval(`
  const l = window.__ps.store.activeLayer;
  return l && { name: l.name, kind: l.kind, x: l.x, y: l.y, w: l.width, h: l.height, shape: l.shape && { ...l.shape, points: l.shape.points?.length, compoundPoints: l.shape.compoundPoints?.length } };
`);
/** Clicks the first element matching the selector whose text (or title) includes `text`. */
const clickEl = async (sel, text) => {
  const r = await b.eval(`
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => (e.textContent + ' ' + (e.title || '')).includes(${JSON.stringify(text ?? '')}) && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `);
  if (!r) throw new Error(`no element ${sel} ${text}`);
  await b.click(r.x, r.y);
  await sleep(120);
};
const panelText = () => b.eval(`return document.querySelector('.properties-panel')?.innerText ?? ''`);
const barText = () => b.eval(`return document.querySelector('.options-bar')?.innerText ?? ''`);

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Tool Context');
  store.set({ fg: '#2255ee' });
  store.setOpts({ shapeFill: true, shapeStrokeWidth: 0, shapeRadius: 0, shapeSides: 6, shapeExtras: {} });
  store.setDockTab('properties');
  store.setTool('shape-rect');
`);
await sleep(300);

// 1. The Rectangle tool has its own bar (corner radius, link, corner styles), with no shape-type dropdown
{
  const bar = await barText();
  const hasCorners = await b.eval(`return !!document.querySelector('.options-bar .corner-styles') && [...document.querySelectorAll('.options-bar .num-label, .options-bar label, .options-bar span')].some((e) => e.textContent.trim() === 'Corners')`);
  const typeSelect = await b.eval(`return [...document.querySelectorAll('.options-bar select')].some((s) => [...s.options].some((o) => o.textContent.includes('Ellipse (L)')))`);
  check('Rectangle tool: corner controls in the options bar, no type dropdown', hasCorners && !typeSelect, { bar: bar.slice(0, 160) });
  const panel = await panelText();
  check('Rectangle tool: Properties shows the next-rectangle editor and gestures', /Next rectangle/i.test(panel) && /Ticket/.test(panel) && /from centre/.test(panel), panel.slice(0, 300));
  check('No selection: Pathfinder and Align are hidden', !/Pathfinder|Minus Front|Align Left/.test(panel));
}

// 2. Ticket preset → the next rectangle is drawn with scooped corners
{
  await clickEl('.properties-panel .preset-chip', 'Ticket');
  const g = await geo();
  await b.drag([S(g, 100, 100), S(g, 250, 200), S(g, 400, 300)], { modifiers: 4 });
  await sleep(150);
  const l = await active();
  check('Ticket preset applies to the drawn rectangle', l?.shape?.cornerStyle === 'scoop' && l.shape.radius > 0, l?.shape);
  const corner = await px(Math.round(l.x + 3), Math.round(l.y + 3));
  const mid = await px(Math.round(l.x + l.w / 2), Math.round(l.y + l.h / 2));
  check('scooped corner is empty, middle is filled', isWhite(corner) && isBlue(mid), { corner, mid });
  const panel = await panelText();
  check('drawn rectangle becomes the live target', /Selected rectangle/i.test(panel) && /live/i.test(panel), panel.slice(0, 200));
}

// 3. Tab preset on the selected rectangle: only the top corners are round
{
  await clickEl('.properties-panel .preset-chip', 'Tab');
  const l = await active();
  check('Tab preset edits the selected rectangle per corner', Array.isArray(l?.shape?.radii) && l.shape.radii[0] > 0 && l.shape.radii[2] === 0 && l.shape.radii[3] === 0, l?.shape?.radii);
  const tl = await px(Math.round(l.x + 2), Math.round(l.y + 2));
  const bl = await px(Math.round(l.x + 2), Math.round(l.y + l.h - 3));
  check('top-left round (empty), bottom-left sharp (filled)', isWhite(tl) && isBlue(bl), { tl, bl });
  await clickEl('.properties-panel .corner-styles button', 'Cut');
  const c = await active();
  check('corner style button switches to cut corners', c?.shape?.cornerStyle === 'chamfer', c?.shape?.cornerStyle);
  const undoSteps = await b.eval(`return window.__ps.store.doc.hIndex`);
  check('each change is one undo step', undoSteps >= 3, undoSteps);
}

// 4. Star tool: own bar (points, inner radius, rounding); the selected rectangle is left alone
{
  await b.eval(`window.__ps.store.setTool('shape-star')`);
  await sleep(150);
  const bar = await barText();
  const panel = await panelText();
  check('Star tool: points / inner radius in the bar', /Points/.test(bar) && /Inner/.test(bar), bar.slice(0, 200));
  check('Star tool does not edit the selected rectangle', /Next star/i.test(panel), panel.slice(0, 200));
  await clickEl('.properties-panel .preset-chip', 'Burst');
  const g = await geo();
  await b.drag([S(g, 500, 80), S(g, 600, 180), S(g, 700, 280)], { modifiers: 4 });
  await sleep(150);
  const l = await active();
  check('Burst preset star: 14 points, 72% inner radius', l?.shape?.shape === 'star' && l.shape.sides === 14 && Math.abs(l.shape.innerRatio - 0.72) < 1e-6, l?.shape);
  const centre = await px(Math.round(l.x + l.w / 2), Math.round(l.y + l.h / 2));
  check('star is drawn', isBlue(centre), centre);
}

// 5. Ellipse tool: Donut preset → the hole is empty; Convert to Path keeps it
{
  await b.eval(`window.__ps.store.setTool('shape-ellipse')`);
  await sleep(150);
  check('Ellipse tool: pie / hole controls in the bar', /Hole/.test(await barText()));
  await clickEl('.properties-panel .preset-chip', 'Donut');
  const g = await geo();
  await b.drag([S(g, 100, 380), S(g, 200, 480), S(g, 300, 580)], { modifiers: 4 });
  await sleep(150);
  const l = await active();
  const cx = Math.round(l.x + l.w / 2), cy = Math.round(l.y + l.h / 2);
  const hole = await px(cx, cy);
  const ring = await px(Math.round(l.x + l.w * 0.1), cy);
  check('donut: empty centre, filled ring', l.shape.hole > 0.5 && isWhite(hole) && isBlue(ring), { hole, ring, h: l.shape.hole });
  await b.eval(`window.__ps.store.setTool('move')`);
  await sleep(100);
  await clickEl('.properties-panel .smart-actions button', 'Convert to Path');
  const p = await active();
  const hole2 = await px(cx, cy);
  check('Convert to Path keeps the donut hole', p?.shape?.shape === 'path' && p.shape.compoundPoints === 2 && isWhite(hole2), { shape: p?.shape?.shape, rings: p?.shape?.compoundPoints, hole2 });
}

// 6. Selection tool: sections follow the selection
{
  const one = await panelText();
  check('one path selected: Simplify offered, no Pathfinder', /Simplify Path/.test(one) && !/Unite/.test(one), one.slice(0, 400));
  await b.eval(`
    const { store } = window.__ps;
    const ids = store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id);
    store.setSelectedLayers(ids);
  `);
  await sleep(150);
  const many = await panelText();
  check('several shapes selected: Pathfinder steps and Group appear', /Unite/.test(many) && /Intersect/.test(many) && /Group/.test(many), many.slice(0, 400));
}

// 7. Reshape tools get their own settings
{
  await b.eval(`window.__ps.store.setTool('twirl')`);
  await sleep(120);
  check('Twirl tool: brush size in the bar', /Size/.test(await barText()));
  await b.eval(`window.__ps.store.setTool('blend')`);
  await sleep(120);
  check('Blend tool: steps in the bar', /Steps/.test(await barText()));
}

// 8. SVG export carries the live corners as paths
{
  const svg = await b.eval(`
    const { docToSvg } = await import('/src/core/formats/svg.ts');
    return docToSvg(window.__ps.store.doc);
  `);
  check('SVG export writes the live shapes', (svg.match(/<path/g) || []).length >= 3 && !/NaN/.test(svg), (svg.match(/<path/g) || []).length);
}

if (process.env.SHOT) {
  await b.eval(`const { store } = window.__ps; store.setTool('shape-rect'); store.setSelectedLayers([store.doc.layers.find((l) => l.shape?.shape === 'rectangle').id]);`);
  await sleep(300);
  await b.eval(`let e = document.querySelector('.properties-panel'); while (e) { e.scrollTop = 0; e = e.parentElement; }`);
  await sleep(150);
  await b.shot(process.env.SHOT);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
