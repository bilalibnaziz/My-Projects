// Grids with real input: Auto Grid from the menu command, the Grids panel, preset library, layout
// grids drawn on the canvas, drawing and moving objects snapping to grid lines, the super-zoom
// document grid, undo, and grids surviving save / open.
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

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false, showGrid: false });
  localStorage.removeItem('skill.docGrid');
  const g = await import('/src/core/grids.ts');
  store.set({ docGrid: { ...g.DEFAULT_DOC_GRID } });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1080, 1920, 'white', 'Reel');
`);
await sleep(300);

// 1. Auto Grid reads a 9:16 artboard
{
  await run('auto-grid');
  await sleep(200);
  const r = await b.eval(`
    const { store } = window.__ps;
    const { gridPages } = await import('/src/core/gridOps.ts');
    const p = gridPages(store.doc)[0];
    return { kinds: p.grids.map((g) => g.kind), toast: store.state.toasts?.map((t) => t.text).join(' | ') };
  `);
  check('Auto Grid on 1080×1920 adds Reel safe zones + 4:5 crop', r.kinds.includes('safe') && r.kinds.includes('aspect') && r.kinds.includes('region'), r);
}

// 2. Layout grid is drawn on the canvas (the safe-area outline shows in the viewport pixels)
{
  const px = await b.eval(`
    const { store } = window.__ps;
    const { gridPages } = await import('/src/core/gridOps.ts');
    const { gridGeometry } = await import('/src/core/grids.ts');
    const safe = gridPages(store.doc)[0].grids.find((g) => g.kind === 'safe');
    const r = gridGeometry(safe, 1080, 1920).rects[0];
    const v = store.doc.view;
    const c = document.querySelector('.viewport-canvas');
    const dpr = c.width / c.clientWidth;
    // Middle of the safe area's left edge: should be tinted (not the white paper)
    const x = Math.round((v.panX + r.x * v.zoom) * dpr), y = Math.round((v.panY + (r.y + r.h / 2) * v.zoom) * dpr);
    const d = c.getContext('2d').getImageData(x - 1, y, 3, 1).data;
    let minR = 255; for (let i = 0; i < 3; i++) minR = Math.min(minR, d[i * 4]);
    return minR;
  `);
  check('safe-area line is drawn over the artboard', px < 200, { red: px });
}

// 3. Undo removes the Auto Grid, redo brings it back
{
  await b.key('z', { modifiers: 4 });
  await sleep(100);
  const n0 = await b.eval(`const { gridPages } = await import('/src/core/gridOps.ts'); return gridPages(window.__ps.store.doc)[0].grids.length;`);
  await b.key('z', { modifiers: 4 | 8 });
  await sleep(100);
  const n1 = await b.eval(`const { gridPages } = await import('/src/core/gridOps.ts'); return gridPages(window.__ps.store.doc)[0].grids.length;`);
  check('undo / redo of grid changes', n0 === 0 && n1 > 0, { n0, n1 });
}

// 4. Grids panel: preset library applies a 4-column mobile grid; parameters edit live
{
  await b.eval(`window.__ps.store.setDockTab('grids')`);
  await sleep(200);
  const has = await b.eval(`return !!document.querySelector('.grids-panel')`);
  check('Grids panel opens in the dock', has);
  // Web & UI category, then click "Mobile 4 col"
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
  const cols = await b.eval(`const { gridPages } = await import('/src/core/gridOps.ts'); return gridPages(window.__ps.store.doc)[0].grids.map((g) => g.kind + ':' + (g.count ?? ''));`);
  check('preset click replaces grids with Mobile 4 col', cols.length === 1 && cols[0] === 'columns:4', cols);
}

// 5. Drawing a rectangle snaps its corner to a column edge
{
  const edge = await b.eval(`
    const { store } = window.__ps;
    const { gridPages } = await import('/src/core/gridOps.ts');
    const { gridGeometry } = await import('/src/core/grids.ts');
    const g = gridPages(store.doc)[0].grids[0];
    return gridGeometry(g, 1080, 1920).snapX[1]; // right edge of column 1
  `);
  await b.eval(`window.__ps.store.setTool('shape-rect')`);
  const g = await geo();
  // Start 2 screen px off the column edge (inside the 6 px snap distance)
  const a = S(g, edge, 600);
  const c = S(g, edge + 300, 900);
  await b.drag([{ x: a.x + 2, y: a.y }, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, c]);
  await sleep(150);
  const l = await b.eval(`const l = window.__ps.store.activeLayer; return { kind: l.kind, x: l.x, w: l.width };`);
  check('rectangle corner snaps to the column edge', l.kind === 'shape' && Math.abs(l.x - edge) < 1e-6, { ...l, edge });
}

// 6. Moving that rectangle snaps its left edge to another column edge
{
  const target = await b.eval(`
    const { store } = window.__ps;
    const { gridPages } = await import('/src/core/gridOps.ts');
    const { gridGeometry } = await import('/src/core/grids.ts');
    return gridGeometry(gridPages(store.doc)[0].grids[0], 1080, 1920).snapX[2]; // left edge of column 2
  `);
  await b.eval(`window.__ps.store.setTool('move')`);
  const l0 = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y, w: l.width, h: l.height };`);
  const g = await geo();
  const from = S(g, l0.x + l0.w / 2, l0.y + l0.h / 2);
  const dxDoc = target - l0.x + 2 / g.zoom; // aim 2 screen px past the edge
  const to = { x: from.x + dxDoc * g.zoom, y: from.y };
  await b.drag([from, { x: (from.x + to.x) / 2, y: from.y + 1 }, to]);
  await sleep(150);
  const x = await b.eval(`return window.__ps.store.activeLayer.x`);
  check('moved object snaps to a column edge', Math.abs(x - target) < 1, { x, target });
}

// 7. Super-zoom document grid: Snap to Grid at 6400% puts a new point on a sub-pixel grid line
{
  await run('snap-grid');
  await b.eval(`const { store } = window.__ps; store.set({ docGrid: { ...store.state.docGrid, showLayout: false } });`);
  const r = await b.eval(`
    const { store } = window.__ps;
    const g = await import('/src/core/grids.ts');
    const v = store.doc.view;
    const c = document.querySelector('.viewport-canvas');
    v.zoom = 64; v.panX = Math.round(c.clientWidth / 2 - 300 * 64); v.panY = Math.round(c.clientHeight / 2 - 300 * 64);
    store.emit();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { show: store.state.showGrid, step: g.snapStep(store.state.docGrid, 64) };
  `);
  check('Snap to Grid also shows the grid; at 6400% it snaps to a sub-pixel step', r.show && r.step < 1, r);
  await b.eval(`window.__ps.store.setTool('shape-ellipse')`);
  const g = await geo();
  const a = S(g, 300.37, 300.12);
  const c = S(g, 302.9, 302.2);
  await b.drag([a, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, c]);
  await sleep(150);
  const l = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y, w: l.width, h: l.height };`);
  const onGrid = (v) => Math.abs(v / r.step - Math.round(v / r.step)) < 1e-6;
  check('shape drawn at 6400% lands on the sub-pixel grid', onGrid(l.x) && onGrid(l.y) && onGrid(l.x + l.w), { ...l, step: r.step });
  // The grid is visible at this zoom: lines on screen within 6–80 px of each other
  const lines = await b.eval(`
    const c = document.querySelector('.viewport-canvas');
    const ctx = c.getContext('2d');
    const y = Math.round(c.height * 0.15);
    const d = ctx.getImageData(0, y, c.width, 1).data;
    let n = 0; for (let i = 0; i < c.width; i++) { const r = d[i * 4], gg = d[i * 4 + 1], bb = d[i * 4 + 2]; if (bb > r + 6 && bb > 200) n++; }
    return n;
  `);
  check('super-zoom grid lines visible at 6400%', lines > 10, { bluePixels: lines });
  await run('snap-grid');
}

// 8. Grids survive save → open
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    const json = io.serializeProject(store.doc);
    const d = await io.loadProject(json, 'Copy');
    const { gridPages } = await import('/src/core/gridOps.ts');
    return gridPages(d)[0].grids.map((g) => g.kind);
  `);
  check('project file keeps layout grids', r.length === 1 && r[0] === 'columns', r);
}

// 9. Bake Grid turns the grids into a locked group of real vector paths
{
  const r = await b.eval(`
    const { store } = window.__ps;
    store.set({ docGrid: { ...store.state.docGrid, showLayout: true } });
    const go = await import('/src/core/gridOps.ts');
    const n = go.bakeGrids();
    const g = store.doc.layers.find((l) => l.kind === 'group' && l.name.startsWith('Grid'));
    const kids = store.doc.layers.filter((l) => l.parent === g?.id);
    const { renderDocument } = await import('/src/core/render.ts');
    const { gridGeometry } = await import('/src/core/grids.ts');
    const x = Math.round(gridGeometry(go.gridPages(store.doc)[0].grids[0], 1080, 1920).snapX[0]);
    const c = document.createElement('canvas'); renderDocument(store.doc, c);
    const d = c.getContext('2d').getImageData(x - 2, 100, 5, 1).data;
    let tinted = false; for (let i = 0; i < 5; i++) if (d[i * 4 + 1] < 245) tinted = true;
    return { n, locked: g?.locked, kinds: kids.map((k) => k.kind), tinted };
  `);
  check('Bake Grid makes a locked group of vector paths that render', r.n > 0 && r.locked && r.kinds.includes('shape') && r.tinted, r);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
