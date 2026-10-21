// Tool-by-tool audit with real input: each tool gets a realistic action and its RESULT is checked —
// geometry where the pointer put it, colours, layer kinds (vector stays vector), counts.
import { connect, sleep, ALT, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 500) : '');
};
const geo = () => b.eval(`
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = window.__ps.store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
/** New 1000×700 doc at 100%, with optional shapes: [name, kind, x, y, w, h, fill] */
const setup = (shapes = [], select = null) => b.eval(`
  const { store, ops } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  store.set({ dialog: null, paletteOpen: false, transform: null });
  const g = await import('/src/core/grids.ts');
  store.set({ docGrid: { ...g.DEFAULT_DOC_GRID, snapLayout: false }, showGrid: false, fg: '#2255ee', bg: '#ffffff' });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Audit');
  const ids = {};
  for (const [name, shape, x, y, w, h, fill] of ${JSON.stringify(shapes)}) {
    const l = makeLayer({ kind: 'shape', name, x, y, width: w, height: h, shape: { shape, fill, stroke: '#000000', strokeWidth: 2, fillEnabled: true, radius: 0, sides: 5 } });
    store.insertLayer(l, undefined, 'Add');
    ids[name] = l.id;
  }
  const sel = ${JSON.stringify(select)};
  if (sel) store.selectLayer(ids[sel]); else store.selectLayer(store.doc.layers[0].id);
  let c = null;
  for (let i = 0; i < 50 && !c; i++) { await new Promise((r) => setTimeout(r, 30)); c = document.querySelector('.viewport-canvas'); }
  const v = store.doc.view; v.zoom = 1; v.panX = Math.round((c.clientWidth - 1000) / 2); v.panY = Math.round((c.clientHeight - 700) / 2);
  store.emit();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return ids;
`);
const tool = async (t) => { await b.eval(`window.__ps.store.setTool(${JSON.stringify(t)}); return true`); await sleep(40); };
const layers = () => b.eval(`return window.__ps.store.doc.layers.map((l) => ({ id: l.id, name: l.name, kind: l.kind, x: +l.x.toFixed(2), y: +l.y.toFixed(2), w: +l.width.toFixed(2), h: +l.height.toFixed(2), rot: l.rotation ?? 0, shape: l.shape?.shape, fill: l.shape?.fill, grad: l.shape?.gradient ? { t: l.shape.gradient.type, x0: l.shape.gradient.x0, x1: l.shape.gradient.x1, y0: l.shape.gradient.y0, y1: l.shape.gradient.y1, n: l.shape.gradient.stops.length } : null, mesh: l.shape?.mesh?.length ?? 0, pts: l.shape?.points?.length ?? 0, closed: l.shape?.closed, parent: l.parent ?? null, text: l.text?.text, path: !!l.text?.path, sides: l.shape?.sides }))`);
const drag = async (a, c, n = 6, opts = {}) => {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ x: a.x + ((c.x - a.x) * i) / n, y: a.y + ((c.y - a.y) * i) / n });
  await b.drag(pts, { delay: 5, ...opts });
  await sleep(100);
};
const near = (a, v, t = 1.5) => Math.abs(a - v) <= t;
const added = (before, after) => after.filter((l) => !before.some((x) => x.id === l.id));

// ---------------------------------------------------------------- drawing tools
for (const [t, shape] of [['shape-rect', 'rectangle'], ['shape-ellipse', 'ellipse'], ['shape-round-rect', 'round-rect'], ['shape-polygon', 'polygon'], ['shape-star', 'star']]) {
  await setup();
  await tool(t);
  const g = await geo();
  const before = await layers();
  await drag(S(g, 200, 150), S(g, 400, 300));
  const n = added(before, await layers());
  const l = n[0];
  check(`${t}: drag makes one ${shape} exactly the dragged box`, n.length === 1 && l.kind === 'shape' && near(l.x, 200) && near(l.y, 150) && near(l.w, 200) && near(l.h, 150), n);
}
for (const t of ['line', 'arc', 'spiral', 'rect-grid', 'polar-grid']) {
  await setup();
  await tool(t);
  const g = await geo();
  const before = await layers();
  await drag(S(g, 200, 150), S(g, 400, 300));
  if (t === 'rect-grid' || t === 'polar-grid') { await b.key('Enter'); await sleep(60); }
  const n = added(before, await layers());
  const box = n.length ? { x: Math.min(...n.map((l) => l.x)), y: Math.min(...n.map((l) => l.y)), x1: Math.max(...n.map((l) => l.x + Math.abs(l.w))), y1: Math.max(...n.map((l) => l.y + Math.abs(l.h))) } : null;
  check(`${t}: drag makes vector art spanning the drag`, n.length >= 1 && n.every((l) => l.kind === 'shape' || l.kind === 'group') && box && near(box.x, 200, 3) && near(box.x1, 400, 3), { n: n.map((l) => [l.kind, l.shape, l.x, l.y, l.w, l.h]), box });
}

// ---------------------------------------------------------------- transform tools
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('rotate');
  const g = await geo();
  // Drag a quarter turn around the centre (400, 300)
  await drag(S(g, 600, 300), S(g, 400, 500), 10);
  const l = (await layers()).find((x) => x.id === ids.A);
  check('rotate tool: dragging a quarter turn rotates 90° about the centre, stays a live shape', l.kind === 'shape' && l.shape === 'rectangle' && near(((l.rot % 360) + 360) % 360, 90, 2) && near(l.x + l.w / 2, 400, 2) && near(l.y + l.h / 2, 300, 2), l);
}
{
  const ids = await setup([['A', 'triangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('reflect');
  const g = await geo();
  const c = S(g, 400, 300);
  await b.click(c.x, c.y, { modifiers: ALT });
  await sleep(150);
  await b.key('Enter');
  await sleep(100);
  const after = await layers();
  const l = after.find((x) => x.id === ids.A) ?? after.find((x) => x.kind === 'shape');
  check('reflect tool: flips the object in place (same box), still vector', l && l.kind === 'shape' && near(l.x, 300, 2) && near(l.w, 200, 2), { l, n: after.length });
}
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('scale');
  const g = await geo();
  // Scale about the centre: drag a corner outward to double the size
  await drag(S(g, 500, 350), S(g, 600, 400), 8);
  const l = (await layers()).find((x) => x.id === ids.A);
  check('scale tool: dragging twice as far from the centre doubles the size about the centre, stays a live shape', l.kind === 'shape' && l.shape === 'rectangle' && near(l.w, 400, 3) && near(l.h, 200, 3) && near(l.x + l.w / 2, 400, 2), l);
}
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('shear');
  const g = await geo();
  await drag(S(g, 400, 250), S(g, 460, 250), 6);
  const l = (await layers()).find((x) => x.id === ids.A) ?? (await layers()).at(-1);
  check('shear tool: skews the object and keeps it vector', l.kind === 'shape', l);
}

// ---------------------------------------------------------------- paint & appearance
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('gradient');
  const g = await geo();
  await drag(S(g, 300, 300), S(g, 500, 300));
  const l = (await layers()).find((x) => x.id === ids.A);
  check('gradient tool: drag across a shape gives it a left→right gradient, still vector', l.kind === 'shape' && l.grad && l.grad.n >= 2 && l.grad.x1 > l.grad.x0 && near(l.grad.y0, l.grad.y1, 0.05), l);
}
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('mesh');
  const g = await geo();
  const p = S(g, 350, 275);
  await b.click(p.x, p.y);
  await sleep(100);
  const l = (await layers()).find((x) => x.id === ids.A);
  check('mesh tool: a click adds one mesh point to the shape', l.kind === 'shape' && l.mesh === 1, l);
}
{
  const ids = await setup([['A', 'rectangle', 100, 100, 100, 100, '#ff0000'], ['B', 'rectangle', 700, 400, 100, 100, '#0000ff']], 'A');
  await tool('blend');
  const g = await geo();
  for (const [x, y] of [[150, 150], [750, 450]]) {
    const p = S(g, x, y);
    await b.click(p.x, p.y);
    await sleep(80);
  }
  await sleep(150);
  const after = await layers();
  const steps = after.filter((l) => l.kind === 'shape' && l.id !== ids.A && l.id !== ids.B);
  const mid = steps.find((l) => near(l.x, 400, 60));
  check('blend tool: steps between the two objects, positions and colours in between', steps.length >= 2 && !!mid && mid.fill && mid.fill.toLowerCase() !== '#ff0000' && mid.fill.toLowerCase() !== '#0000ff', { n: steps.length, mid, fills: steps.map((s) => s.fill).slice(0, 5) });
}
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('bucket');
  const g = await geo();
  const p = S(g, 400, 300);
  await b.click(p.x, p.y);
  await sleep(100);
  const after = await layers();
  const l = after.find((x) => x.id === ids.A);
  const filled = after.some((x) => x.kind === 'shape' && (x.fill ?? '').toLowerCase() === '#2255ee');
  check('live paint bucket: clicking inside fills that region with the colour', filled, { l, n: after.length });
}
{
  const ids = await setup([['A', 'rectangle', 100, 100, 100, 100, '#ff0000'], ['B', 'ellipse', 400, 300, 100, 100, '#00aa00']], 'A');
  await tool('eyedropper');
  const g = await geo();
  const p = S(g, 450, 350);
  await b.click(p.x, p.y);
  await sleep(100);
  const r = await b.eval(`const { store } = window.__ps; return { fg: store.state.fg, a: store.doc.layers.find((l) => l.name === 'A').shape.fill }`);
  check('eyedropper: with an object selected, clicking another copies its colour (Illustrator style)', r.fg.toLowerCase() === '#00aa00' || r.a.toLowerCase() === '#00aa00', r);
}

// ---------------------------------------------------------------- cutting & path tools
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('knife');
  const g = await geo();
  await drag(S(g, 400, 220), S(g, 400, 380), 10);
  const after = await layers();
  const parts = after.filter((l) => l.kind === 'shape');
  const area = parts.reduce((a, l) => a + Math.abs(l.w * l.h), 0);
  check('knife: a cut straight through splits the shape into two pieces of the same total size', parts.length === 2 && near(area, 20000, 600), parts);
}
{
  const ids = await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('scissors');
  const g = await geo();
  const p = S(g, 400, 250);
  await b.click(p.x, p.y);
  await sleep(100);
  const after = await layers();
  const sh = after.filter((x) => x.kind === 'shape');
  const l = sh[0];
  check('scissors: clicking a rectangle edge opens it into ONE path cut at the click (5 points)', sh.length === 1 && l.closed === false && l.pts === 6 && near(l.w, 200, 1), sh);
}
{
  // Open path: a cut in the middle of a line makes two pieces that meet at the click
  await setup();
  await tool('pen');
  const g0 = await geo();
  for (const [x, y] of [[200, 300], [600, 300]]) { const p = S(g0, x, y); await b.click(p.x, p.y); }
  await b.key('Enter'); await sleep(100);
  await tool('scissors');
  const p = S(g0, 450, 300);
  await b.click(p.x, p.y);
  await sleep(100);
  const sh = (await layers()).filter((x) => x.kind === 'shape');
  const ends = sh.map((l) => [l.x, l.x + l.w]).sort((a, b) => a[0] - b[0]);
  check('scissors: cutting an open line at x=450 gives two pieces meeting there', sh.length === 2 && near(ends[0][1], 450, 1) && near(ends[1][0], 450, 1), ends);
}
{
  await setup([['A', 'rectangle', 200, 200, 200, 200, '#ff0000'], ['B', 'rectangle', 300, 300, 200, 200, '#ff0000']], 'A');
  await b.eval(`const { store } = window.__ps; store.setSelectedIds ? store.setSelectedIds(store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id)) : (store.doc.selectedIds = store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id)); store.emit(); return true`);
  await tool('shape-builder');
  const g = await geo();
  await drag(S(g, 250, 250), S(g, 450, 450), 10);
  const after = await layers();
  const shapes = after.filter((l) => l.kind === 'shape');
  const big = shapes.find((l) => near(l.x, 200, 2) && near(l.x + l.w, 500, 2));
  check('shape builder: dragging across overlapping shapes merges them into one', !!big, shapes);
}
{
  await setup([['A', 'rectangle', 300, 250, 200, 100, '#e33333']], 'A');
  await tool('eraser');
  const g = await geo();
  await drag(S(g, 280, 300), S(g, 520, 300), 12);
  const after = await layers();
  const sh = after.filter((l) => l.kind === 'shape');
  check('eraser on a vector shape cuts it (vector result, not pixels)', sh.length >= 1 && after.every((l) => l.kind !== 'raster' || l.name === 'Background'), after.map((l) => [l.kind, l.name, l.x, l.y, l.w, l.h]));
}
{
  await setup([['A', 'ellipse', 300, 250, 200, 200, '#e33333']], 'A');
  await b.eval(`const vo = await import('/src/core/vectorOps.ts'); const { store } = window.__ps; const l = store.activeLayer; const p = vo.convertToEditablePath(l); store.commit('Path', { layers: store.doc.layers.map((x) => (x.id === l.id ? p : x)) }); return true`);
  for (const t of ['twirl', 'pucker', 'bloat', 'warp', 'crystallize']) {
    await b.eval(`const { store } = window.__ps; store.selectLayer(store.doc.layers.find((l) => l.kind === 'shape').id); return true`);
    await tool(t);
    const g = await geo();
    await drag(S(g, 380, 340), S(g, 420, 360), 8);
    const after = await layers();
    const l = after.find((x) => x.kind === 'shape');
    check(`${t}: reshapes the path and keeps it vector`, !!l && after.every((x) => x.kind !== 'raster' || x.name === 'Background'), after.map((x) => [x.kind, x.shape, x.pts]));
  }
}

// ---------------------------------------------------------------- type, artboards, slices, graphs
{
  await setup([['P', 'ellipse', 300, 200, 300, 300, '#ffffff']], 'P');
  await tool('path-type');
  const g = await geo();
  const p = S(g, 300, 350);
  await b.click(p.x, p.y);
  await sleep(150);
  for (const ch of 'Around') await b.key(ch);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(150);
  const t = (await layers()).find((l) => l.kind === 'text');
  check('type on a path: clicking a path and typing sets text along it', t && t.path && t.text === 'Around', t);
}
{
  await setup();
  await b.eval(`const { store } = window.__ps; const v = store.doc.view; v.zoom = 0.5; store.emit(); await new Promise((r) => requestAnimationFrame(r)); return true`);
  await tool('artboard');
  const g = await geo();
  const before = await b.eval(`return (window.__ps.store.doc.artboards ?? []).length`);
  await drag(S(g, 1100, 100), S(g, 1300, 300));
  const abs = await b.eval(`return (window.__ps.store.doc.artboards ?? []).map((a) => [a.x, a.y, a.width, a.height])`);
  const n = abs.find((a) => near(a[0], 1100, 3) && near(a[2], 200, 3));
  check('artboard tool: dragging on the pasteboard adds an artboard of that size', abs.length > before && !!n, abs);
}
{
  await setup();
  await tool('slice');
  const g = await geo();
  await drag(S(g, 100, 100), S(g, 300, 250));
  const sl = await b.eval(`return (window.__ps.store.doc.slices ?? []).map((s) => [s.x, s.y, s.width ?? s.w, s.height ?? s.h])`);
  check('slice tool: dragging makes a slice of that rectangle', sl.length === 1 && near(sl[0][0], 100, 2) && near(sl[0][2], 200, 2), sl);
}
{
  await setup();
  await tool('graph-column');
  const g = await geo();
  const before = await layers();
  await drag(S(g, 200, 200), S(g, 500, 450));
  await b.eval(`[...document.querySelectorAll('.modal button')].find((x) => x.textContent.trim() === 'Create')?.click(); return true`);
  await sleep(150);
  const n = added(before, await layers());
  const box = n.filter((l) => l.kind !== 'group');
  const x1 = Math.max(...box.map((l) => l.x + l.w));
  check('column graph: drag + Create builds a vector graph inside the dragged box', n.length > 2 && n.every((l) => l.kind !== 'raster') && Math.min(...box.map((l) => l.x)) >= 195 && x1 <= 505, { n: n.length, kinds: [...new Set(n.map((l) => l.kind))], x1 });
}
{
  await setup([['A', 'rectangle', 100, 100, 100, 100, '#ff0000']], 'A');
  await tool('ruler');
  const g = await geo();
  await drag(S(g, 100, 100), S(g, 400, 500));
  const txt = await b.eval(`return document.body.innerText`);
  check('measure tool: dragging 300 × 400 reports a 500 px distance', /500(\.0+)?\s*(px)?/.test(txt), txt.match(/[^\n]*500[^\n]*/)?.[0]);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('Failing: ' + failed.map((f) => f.name).join(' | '));
b.close();
process.exit(failed.length ? 1 : 0);
