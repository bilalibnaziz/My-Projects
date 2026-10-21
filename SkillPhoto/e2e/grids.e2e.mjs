// Grids and sharp type in Skill Photo: Auto Grid, presets, undo, the Grids panel, shapes snapping
// to layout grids, Snap to Grid at a high zoom, and type / shape layers staying sharp when zoomed.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const geo = () => b.eval(`
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = window.__ps.store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const run = (id) => b.eval(`const c = await import('/src/core/commands.ts'); c.COMMANDS.find((x) => x.id === ${JSON.stringify(id)}).run(); return true;`);
const grids = () => b.eval(`return (window.__ps.store.doc.grids ?? []).map((g) => g.kind + (g.count ? ':' + g.count : ''))`);

await b.eval(`
  const { store, ops } = window.__ps;
  const g = await import('/src/core/grids.ts');
  store.set({ dialog: null, paletteOpen: false, showGrid: false, docGrid: { ...g.DEFAULT_DOC_GRID } });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1080, 1350, 'white', 'Post');
`);
await sleep(300);

// 1. Auto Grid reads a 4:5 post
{
  await run('auto-grid');
  await sleep(150);
  const k = await grids();
  check('Auto Grid on 1080×1350 adds the 3:4 profile crop, safe margin and thirds', k.includes('aspect') && k.includes('safe') && k.includes('thirds'), k);
}

// 2. Undo / redo
{
  await b.key('z', { modifiers: 4 });
  await sleep(100);
  const a = await grids();
  await b.key('z', { modifiers: 4 | 8 });
  await sleep(100);
  const c = await grids();
  check('undo / redo of grid changes', a.length === 0 && c.length === 3, { a, c });
}

// 3. Grids panel opens from the View command and applies a preset
{
  await run('grids-panel');
  await sleep(200);
  await b.eval(`[...document.querySelectorAll('.grid-cats button')].find((x) => x.textContent === 'Web & UI').click()`);
  await sleep(100);
  const btn = await b.eval(`
    const el = [...document.querySelectorAll('.grid-preset-main')].find((x) => x.textContent.includes('Mobile 4 col'));
    el.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(r));
    const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 };
  `);
  await b.click(btn.x, btn.y);
  await sleep(200);
  const k = await grids();
  check('Grids panel preset: Mobile 4 col', k.join() === 'columns:4', k);
}

// 4. A shape drawn near a column edge snaps onto it
{
  const edge = await b.eval(`
    const { gridGeometry } = await import('/src/core/grids.ts');
    const d = window.__ps.store.doc;
    return gridGeometry(d.grids[0], d.width, d.height).snapX[1];
  `);
  await b.eval(`const { store } = window.__ps; store.setOpts({ shapeType: 'rectangle' }); store.setTool('shape');`);
  const g = await geo();
  const a = S(g, edge, 500);
  const c = S(g, edge + 300, 800);
  await b.drag([{ x: a.x + 2, y: a.y }, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, c]);
  await sleep(150);
  const l = await b.eval(`const l = window.__ps.store.activeLayer; return { kind: l.kind, x: l.x, w: l.width };`);
  check('rectangle snaps to the column edge', l.kind === 'shape' && Math.abs(l.x - edge) < 1e-6, { ...l, edge });
}

// 5. Type stays sharp at 4000% (vector render, not stretched pixels)
{
  const p = await b.eval(`
    const { store } = window.__ps;
    const { makeLayer, withLayer } = await import('/src/core/types.ts');
    const { syncTextBounds, renderDocument } = await import('/src/core/render.ts');
    const t0 = makeLayer({ kind: 'text', name: 'Word', x: 300, y: 1000, text: { text: 'O', font: 'Arial', size: 160, weight: 400, italic: false, color: '#000000', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' } });
    const t = withLayer(t0, syncTextBounds(t0));
    store.commit('Text', { layers: [...store.doc.layers, t] });
    store.set({ docGrid: { ...store.state.docGrid, showLayout: false } });
    const c = document.createElement('canvas'); renderDocument(store.doc, c);
    const y = Math.round(t.y + t.height * 0.3);
    const d = c.getContext('2d').getImageData(Math.round(t.x), y, Math.round(t.width), 1).data;
    for (let i = 0; i < d.length / 4; i++) if (d[i * 4] < 128) return { x: Math.round(t.x) + i, y };
    return null;
  `);
  const Z = 40;
  const f = await b.eval(`
    const { store } = window.__ps;
    const c = document.querySelector('.viewport-canvas');
    const v = store.doc.view; v.zoom = ${Z};
    v.panX = Math.round(c.clientWidth / 2 - ${p.x} * ${Z}); v.panY = Math.round(c.clientHeight / 2 - ${p.y} * ${Z});
    store.emit();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ctx = c.getContext('2d');
    const cx = Math.round(c.width / 2), cy = Math.round(c.height / 2);
    const found = [];
    for (let k = 0; k < 16; k++) {
      const d = ctx.getImageData(cx - 300, cy - 32 + k * 4, 600, 1).data;
      let seen = false, x = -1;
      for (let i = 0; i < 600; i++) { if (d[i * 4] >= 128) seen = true; else if (seen) { x = i; break; } }
      found.push(x);
    }
    return found;
  `);
  const n = new Set(f.filter((v) => v >= 0)).size;
  check('4000%: type outline is smooth, not pixel blocks', n >= 10, { n, f });
}

// 6. Snap to Grid at 6400% puts a new shape on a sub-pixel grid step
{
  await run('snap-grid');
  const step = await b.eval(`
    const { store } = window.__ps;
    const g = await import('/src/core/grids.ts');
    const c = document.querySelector('.viewport-canvas');
    const v = store.doc.view; v.zoom = 64; v.panX = Math.round(c.clientWidth / 2 - 200 * 64); v.panY = Math.round(c.clientHeight / 2 - 200 * 64);
    store.emit();
    store.setTool('shape');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return g.snapStep(store.state.docGrid, 64);
  `);
  const g = await geo();
  const a = S(g, 200.37, 200.12);
  const c = S(g, 202.9, 202.2);
  await b.drag([a, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, c]);
  await sleep(150);
  const l = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y, w: l.width, h: l.height };`);
  const on = (v) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
  check('small shape drawn at 6400% lands on the grid (not a 200 px click shape)', on(l.x) && on(l.y) && l.w < 4, { ...l, step });
  await run('snap-grid');
}

// 7. Grids survive save → open
{
  const k = await b.eval(`
    const io = await import('/src/core/io.ts');
    const d = await io.loadProject(io.serializeProject(window.__ps.store.doc), 'Copy');
    return (d.grids ?? []).map((g) => g.kind);
  `);
  check('project file keeps grids', k.join() === 'columns', k);
}

// 8. Bake Grid makes a pixel layer with the grid drawn in
{
  const r = await b.eval(`
    const { store } = window.__ps;
    store.set({ docGrid: { ...store.state.docGrid, showLayout: true } });
    const go = await import('/src/core/gridOps.ts');
    go.bakeGrids();
    const l = store.activeLayer;
    const { gridGeometry } = await import('/src/core/grids.ts');
    const x = Math.round(gridGeometry(store.doc.grids[0], store.doc.width, store.doc.height).snapX[0]);
    const d = l.canvas.getContext('2d').getImageData(x - 2, 100, 5, 1).data;
    let a = 0; for (let i = 0; i < 5; i++) a = Math.max(a, d[i * 4 + 3]);
    return { kind: l.kind, name: l.name, alpha: a };
  `);
  check('Bake Grid makes a "Grid" pixel layer with the lines in it', r.kind === 'raster' && r.name === 'Grid' && r.alpha > 0, r);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
