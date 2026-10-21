// Smart guides, brush resize gesture, repeat filter, zoom to selection, export all.
import { connect, sleep, ALT, META, CTRL, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const geo = () => b.eval(`const { store } = window.__ps; const r = document.querySelector('.viewport-canvas').getBoundingClientRect(); const v = store.doc.view; return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: v.zoom, panX: v.panX, panY: v.panY };`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const setup = async () => {
  await b.eval(`
    const { store, ops } = window.__ps;
    store.set({ dialog: null, paletteOpen: false });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(1000, 800, 'white', 'Feat');
    store.newRasterLayer('Box');
    const c = store.activeLayer.canvas.getContext('2d'); c.fillStyle = '#e33'; c.fillRect(100, 100, 100, 100);
    store.renderer.invalidate(); store.emit();
    store.setOpts({ smoothing: 0 });
  `);
  await sleep(200);
};

// 1. Snapping: drag box centre close to the canvas centre → snaps exactly, guides shown, cleared after
await setup();
await b.eval(`window.__ps.store.setTool('move')`);
let g = await geo();
{
  // Box centre (150,150) → want (500,400). Drag by (347,247): 3px short in both axes.
  const a = S(g, 150, 150);
  const pts = [a];
  for (let i = 1; i <= 8; i++) pts.push({ x: a.x + (347 * g.zoom * i) / 8, y: a.y + (247 * g.zoom * i) / 8 });
  await b.mouse('mouseMoved', pts[0].x, pts[0].y);
  await b.mouse('mousePressed', pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) await b.mouse('mouseMoved', p.x, p.y, { buttons: 1, button: 'left' });
  await sleep(80);
  // Read the guide straight off the screen: magenta pixel on the vertical canvas-centre line, away from the box
  const gx = Math.round(g.left + g.panX + 500 * g.zoom), gy = Math.round(g.top + g.panY + 700 * g.zoom);
  const pick = () => b.eval(`const c = document.querySelector('.viewport-canvas'); const r = c.getBoundingClientRect(); const k = c.width / r.width;
    const ctx = c.getContext('2d'); let hit = false; for (let dx = -1; dx <= 1; dx++) { const d = ctx.getImageData(Math.round((${gx} - r.left + dx) * k), Math.round((${gy} - r.top) * k), 1, 1).data; if (d[0] > 200 && d[1] < 120 && d[2] > 180) hit = true; } return hit;`);
  const mid = await pick();
  await b.mouse('mouseReleased', pts.at(-1).x, pts.at(-1).y, { buttons: 0 });
  await sleep(50);
  const l = await st(`({ x: store.activeLayer.x, y: store.activeLayer.y })`);
  await sleep(80);
  const after = await pick();
  check('move snaps the layer centre onto the canvas centre', l.x === 350 && l.y === 250, l);
  check('smart guides show while snapping and clear on release', mid === true && after === false, { mid, after });
}
// 1b. Hold ⌘ to move freely
await setup();
await b.eval(`window.__ps.store.setTool('move')`);
g = await geo();
{
  const a = S(g, 150, 150);
  const end = { x: a.x + 347 * g.zoom, y: a.y + 247 * g.zoom };
  await b.drag([a, { x: (a.x + end.x) / 2, y: (a.y + end.y) / 2 }, end], { modifiers: META });
  const l = await st(`({ x: store.activeLayer.x, y: store.activeLayer.y })`);
  check('holding ⌘ disables snapping (exact pointer delta)', l.x === 347 && l.y === 247, l);
}

// 2. Brush resize gesture: ⌃⌥-drag right grows, up hardens; no paint
await setup();
await b.eval(`window.__ps.store.setTool('brush'); window.__ps.store.setOpts({ size: 40, hardness: 0.5 });`);
g = await geo();
{
  const a = S(g, 500, 400);
  await b.drag([a, { x: a.x + 30, y: a.y - 20 }, { x: a.x + 60, y: a.y - 40 }], { modifiers: CTRL | ALT });
  const o = await st(`({ size: store.state.opts.size, hardness: store.state.opts.hardness, hist: store.doc.history.length })`);
  const expectSize = Math.round(40 + (60 * 2) / g.zoom);
  check('⌃⌥-drag resizes the brush (right = bigger)', o.size === expectSize, { ...o, expectSize });
  check('⌃⌥-drag up makes the brush harder', Math.abs(o.hardness - 0.7) < 0.011, o.hardness);
  const painted = await b.eval(`const c = window.__ps.store.activeLayer.canvas; const d = c.getContext('2d').getImageData(450, 350, 100, 100).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n;`);
  check('resize gesture does not paint', painted === 0, painted);
}

// 3. Repeat last filter
await setup();
{
  const r = await b.eval(`
    const { store, ops } = window.__ps;
    const { COMMANDS } = await import('/src/core/commands.ts');
    const rep = COMMANDS.find(c => c.id === 'filter-repeat');
    const before = rep.enabled();
    await ops.commitFilter('gaussian-blur', { radius: 4 });
    const a1 = store.activeLayer.canvas.getContext('2d').getImageData(100, 150, 1, 1).data[3];
    return { before, after: rep.enabled(), a1 };`);
  await b.key('f', { modifiers: META | ALT, code: 'KeyF' });
  // Filters run in a worker: wait for the second blur's history step
  await b.waitFor(`window.__ps.store.doc.history.filter((h) => /Blur/.test(h.label)).length >= 2`, 5000).catch(() => {});
  const r2 = await st(`({ a2: store.activeLayer.canvas.getContext('2d').getImageData(100, 150, 1, 1).data[3], label: store.doc.history[store.doc.hIndex].label, steps: store.doc.history.map(h => h.label).filter(l => /Blur/.test(l)).length })`);
  check('⌘⌥F repeats the last filter with the same settings', !r.before && r.after && r2.steps === 2 && r2.a2 < r.a1, { ...r, ...r2 });
}

// 4. Zoom to selection
await setup();
{
  await b.eval(`const { ops } = window.__ps; ops.selectAll(); `);
  await b.eval(`const { store } = window.__ps; const sel = await import('/src/core/selection.ts');
    const c = sel.drawSelection(1000, 800, (ctx) => { ctx.fillRect(700, 500, 100, 50); });
    store.setSelection(sel.selectionFromCanvas(c), 'test');`);
  await b.key('0', { modifiers: META | ALT, code: 'Digit0' });
  await sleep(100);
  const g2 = await geo();
  const c = { x: g2.left + g2.panX + 750 * g2.zoom, y: g2.top + g2.panY + 525 * g2.zoom };
  const viewMid = { x: g2.left + 20 + (g2.w - 20) / 2, y: g2.top + 20 + (g2.h - 20) / 2 };
  check('⌘⌥0 zooms to the selection and centres it', g2.zoom > 4 && Math.hypot(c.x - viewMid.x, c.y - viewMid.y) < 2, { zoom: g2.zoom, c, viewMid });
}

// 5. Export all open documents
{
  const r = await b.eval(`
    const { store, ops } = window.__ps;
    ops.newDocument(200, 100, 'white', 'Second');
    const io = await import('/src/core/io.ts');
    const names = []; const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
    const { COMMANDS } = await import('/src/core/commands.ts');
    await COMMANDS.find(c => c.id === 'export-all').run();
    await new Promise(r => setTimeout(r, 300));
    HTMLAnchorElement.prototype.click = origClick;
    return names;`);
  check('Export All writes one PNG per open document', r.length === 2 && r.every((n) => n.endsWith('.png')), r);
}

// Frequency Separation: splits into two layers whose blend gives back the original picture
await setup();
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const { renderDocument } = await import('/src/core/render.ts');
    const { COMMANDS } = await import('/src/core/commands.ts');
    const c = store.activeLayer.canvas.getContext('2d');
    for (let y = 80; y < 260; y += 6) for (let x = 80; x < 260; x += 6) { c.fillStyle = 'hsl(' + ((x * 7 + y * 13) % 360) + ', 70%, ' + (35 + ((x + y) % 30)) + '%)'; c.fillRect(x, y, 6, 6); }
    store.renderer.invalidate();
    const shot = () => { const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height; renderDocument(store.doc, t); return t.getContext('2d').getImageData(80, 80, 180, 180).data; };
    const before = shot();
    COMMANDS.find((x) => x.id === 'frequency-separation').run();
    const after = shot();
    let maxDiff = 0;
    for (let i = 0; i < before.length; i++) if (i % 4 !== 3) maxDiff = Math.max(maxDiff, Math.abs(before[i] - after[i]));
    const group = store.doc.layers.find((l) => l.kind === 'group');
    const inGroup = store.doc.layers.filter((l) => group && l.parent === group.id).map((l) => l.name);
    return { maxDiff, inGroup };`);
  check('Frequency Separation makes low/high layers that blend back to the original', r.maxDiff <= 2 && r.inGroup.length === 2 && /Low/.test(r.inGroup[0]) && /High/.test(r.inGroup[1]), r);
}

// Liquify: ⇧⌘X opens the workspace, a forward-warp drag pushes pixels, OK applies one undo step
await setup();
{
  await b.key('x', { modifiers: META | SHIFT, code: 'KeyX' });
  await sleep(300);
  const box = await b.eval(`const r = document.querySelector('.liquify-canvas')?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height, cw: document.querySelector('.liquify-canvas').width } : null`);
  const open = !!box;
  if (box) {
    // Layer px → screen: the preview shows the whole 1000×800 layer
    const P = (x, y) => ({ x: box.x + (x / 1000) * box.w, y: box.y + (y / 800) * box.h });
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push(P(150 + i * 10, 150));
    await b.drag(pts);
    await sleep(100);
    const ok = await b.eval(`return [...document.querySelectorAll('.modal.liquify .btn.primary')].map(e => ({ x: e.getBoundingClientRect().left + 10, y: e.getBoundingClientRect().top + 10 }))[0]`);
    await b.click(ok.x, ok.y);
    await sleep(600);
  }
  const r = await st(`({ label: store.doc.history[store.doc.hIndex].label, right: Array.from(store.activeLayer.canvas.getContext('2d').getImageData(215, 150, 1, 1).data), dialog: store.state.dialog })`);
  // The red box ended at x = 200; pushing right drags red past it
  check('Liquify forward warp pushes pixels and applies as one step', open && r.label === 'Liquify' && r.right[0] > 200 && r.right[3] > 200 && !r.dialog, { open, ...r });
}

// Big-layer filters run in a background worker: the page keeps ticking while a heavy blur runs
{
  const r = await b.eval(`
    const { store, ops } = window.__ps;
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(3000, 3000, 'white', 'Big');
    store.newRasterLayer('Paint');
    const c = store.activeLayer.canvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(1400, 1400, 200, 200);
    let ticks = 0; const t = setInterval(() => ticks++, 10);
    const t0 = performance.now();
    await ops.commitFilter('gaussian-blur', { radius: 60 });
    const ms = performance.now() - t0;
    clearInterval(t);
    const edge = store.activeLayer.canvas.getContext('2d').getImageData(1390, 1500, 1, 1).data[3];
    return { ms: Math.round(ms), ticks, expected: Math.floor(ms / 10), edge, label: store.doc.history[store.doc.hIndex].label };`);
  // A frozen main thread would deliver almost no ticks during the filter
  check('a big-layer filter runs off the main thread (the page keeps responding)', r.label === 'Gaussian Blur' && r.edge > 0 && r.ticks >= r.expected * 0.5, r);
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
