// Smart Objects (lossless transform, Smart Filters, Replace Contents, save / load), lock
// transparency, the layer context menu, color labels and layer search.
import { connect, sleep, META, CTRL } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const MOD = process.platform === 'darwin' ? META : CTRL;
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const geo = () => b.eval(`const { store } = window.__ps; const r = document.querySelector('.viewport-canvas').getBoundingClientRect(); const v = store.doc.view; return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const docPx = (x, y) => st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(${x}, ${y}, 1, 1).data)`);

/** 100×100 layer of 2-px black / white vertical stripes at (100, 50). */
const setup = () =>
  b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(400, 300, 'transparent', 'Smart', undefined);
    const c = document.createElement('canvas'); c.width = 100; c.height = 100; const g = c.getContext('2d');
    for (let x = 0; x < 100; x += 4) { g.fillStyle = '#000'; g.fillRect(x, 0, 2, 100); g.fillStyle = '#fff'; g.fillRect(x + 2, 0, 2, 100); }
    store.newRasterLayer('Stripes', { canvas: c, x: 100, y: 50 });`);
/** Free-transform the active layer by a uniform scale around its centre and apply. */
const scale = (k) => b.eval(`const { store, ops } = window.__ps; ops.beginTransform(); const t = store.state.transform; store.state.transform = { ...t, scaleX: t.scaleX * ${k}, scaleY: t.scaleY * ${k} }; ops.updateTransformPreview(); ops.commitTransform();`);
const stripes = () => b.eval(`const { store } = window.__ps; const l = store.activeLayer; const d = l.canvas.getContext('2d').getImageData(0, Math.floor(l.canvas.height / 2), l.canvas.width, 1).data; let flips = 0; for (let x = 8; x < l.canvas.width - 8; x++) if ((d[x * 4] > 128) !== (d[(x - 1) * 4] > 128)) flips++; return { flips, w: l.canvas.width };`);

// 1. Shrink to 10% and back: a pixel layer turns to mush, a smart object stays crisp
{
  await setup();
  await scale(0.1);
  await scale(10);
  const raster = await stripes();
  await setup();
  await b.eval(`window.__ps.ops.convertToSmartObject()`);
  const isSmart = await st(`!!store.activeLayer.smart`);
  await scale(0.1);
  await scale(10);
  const smart = await stripes();
  check('a Smart Object scales down and back up without losing detail', isSmart && smart.flips >= 40 && raster.flips < 10, { raster, smart });
}

// 2. Moving, then transforming again, keeps the transform anchored to the layer
{
  await b.eval(`const { store } = window.__ps; const l = store.activeLayer; store.updateLayer(l.id, { x: l.x + 60, y: l.y + 20 }, 'Move');`);
  const box = await b.eval(`const { store, ops } = window.__ps; ops.beginTransform(); const c = ops.transformCorners(store.state.transform).map(p => [Math.round(p.x), Math.round(p.y)]); ops.cancelTransform(); return c;`);
  check('after moving, the transform box sits on the moved layer', box[0].join() === '160,70' && box[2].join() === '260,170', box);
}

// 3. Filters on a smart object become editable Smart Filters
{
  const before = await docPx(161, 120);
  await b.eval(`window.__ps.ops.commitFilter('gaussian-blur', { radius: 6 })`);
  await sleep(100);
  const blurred = await docPx(161, 120);
  const r = await st(`store.activeLayer.smart.filters.map(f => f.id + ':' + f.enabled).join()`);
  const rows = await b.eval(`return [...document.querySelectorAll('.smart-filter-name')].map(e => e.textContent)`);
  await b.eval(`const { store, ops } = window.__ps; const l = store.activeLayer; ops.setSmartFilters(l.id, l.smart.filters.map(f => ({ ...f, enabled: false })), 'Hide');`);
  await sleep(100);
  const hidden = await docPx(161, 120);
  check('Gaussian Blur on a Smart Object is a Smart Filter you can hide', r === 'gaussian-blur:true' && rows.join() === 'Gaussian Blur' && before.join() !== blurred.join() && hidden.join() === before.join(), { r, rows, before, blurred, hidden });
  // Edit it from the panel: double-click opens the filter with its settings
  await b.eval(`const { store, ops } = window.__ps; const l = store.activeLayer; ops.setSmartFilters(l.id, l.smart.filters.map(f => ({ ...f, enabled: true })), 'Show');`);
  await sleep(100);
  const p = await b.eval(`const el = document.querySelector('.smart-filter-name'); const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 };`);
  await b.click(p.x, p.y, { clickCount: 2 });
  await sleep(200);
  const d = await st(`store.state.dialog`);
  check('double-clicking a Smart Filter reopens it with its settings', d?.type === 'filter' && d.smartIndex === 0 && d.params?.radius === 6, d);
  await b.eval(`window.__ps.store.set({ dialog: null }); window.__ps.store.overrides.clear();`);
}

// 4. Painting is blocked on smart objects; save / load keeps the source, transform and filters
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    // Painting never touches the smart object: it goes to a new pixel layer above it
    const smartId = store.activeLayer.id;
    const ed = store.beginPixelEdit('pixels');
    const blocked = !!ed && ed.layer.id !== smartId && ed.layer.kind === 'raster' && !ed.layer.smart && !!store.doc.layers.find((l) => l.id === smartId)?.smart;
    store.selectLayer(smartId);
    const doc = await io.loadProject(io.serializeProject(store.doc), 'Reloaded');
    const l = doc.layers.find(l => l.name === 'Stripes');
    return { blocked, src: l.smart?.source?.width, filters: l.smart?.filters.length, ax: Math.round(l.smart?.ax) };
  `);
  check('painting goes to a new layer, never into the smart object; projects keep smart objects', r.blocked && r.src === 100 && r.filters === 1 && r.ax > 0, r);
}

// 5. Replace Contents keeps size and position
{
  const r = await b.eval(`
    const { store, ops } = window.__ps;
    const c = document.createElement('canvas'); c.width = 50; c.height = 30; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 50, 30);
    const before = { w: store.activeLayer.smart.source.width, x: store.activeLayer.x };
    const blob = await new Promise(r => c.toBlob(r));
    await ops.replaceSmartContents(blob);
    const l = store.activeLayer;
    return { before, w: l.smart.source.width, x: l.x, filters: l.smart.filters.length };
  `);
  await sleep(100);
  const px = await docPx(210, 120);
  check('Replace Contents swaps the pixels, keeping size, place and filters', r.w === 100 && r.x === r.before.x && r.filters === 1 && px[0] > 200 && px[1] < 40, { r, px });
}

// 6. Lock transparency: a brush stroke across the layer edge only paints existing pixels
{
  await setup();
  await b.eval(`const { store } = window.__ps; const l = store.activeLayer; store.commit('Lock Transparency', { layers: store.doc.layers.map(x => x.id === l.id ? { ...x, lockAlpha: true } : x) });`);
  await sleep(50);
  const locked = await st(`store.activeLayer.lockAlpha`);
  await b.eval(`window.__ps.store.set({ fg: '#ff0000' }); window.__ps.store.setTool('brush');`);
  const g = await geo();
  await b.drag([S(g, 60, 100), S(g, 150, 100), S(g, 240, 100)], { delay: 10 });
  await sleep(100);
  const inside = await docPx(150, 100);
  const outside = await docPx(70, 100);
  check('Lock Transparency paints only where the layer has pixels', locked && inside[0] > 200 && inside[1] < 60 && outside[3] === 0, { locked, inside, outside });
}

// 7. Right-click menu, color labels, search
{
  const row = await b.eval(`const el = [...document.querySelectorAll('.layer-row')].find(r => r.textContent.includes('Stripes')); const r = el.getBoundingClientRect(); return { x: r.x + 120, y: r.y + r.height / 2 };`);
  await b.mouse('mouseMoved', row.x, row.y);
  await b.mouse('mousePressed', row.x, row.y, { button: 'right', buttons: 2 });
  await b.mouse('mouseReleased', row.x, row.y, { button: 'right', buttons: 0 });
  await sleep(150);
  const items = await b.eval(`return [...document.querySelectorAll('.ctx-item span')].map(s => s.textContent)`);
  const lab = await b.eval(`const el = [...document.querySelectorAll('.ctx-label')].find(e => e.title === 'Green'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 6, y: r.y + 6 };`);
  if (lab) await b.click(lab.x, lab.y);
  await sleep(120);
  const label = await st(`store.activeLayer.label`);
  const shadow = await b.eval(`return [...document.querySelectorAll('.layer-row')].find(r => r.textContent.includes('Stripes')).style.boxShadow`);
  check('right-click opens the layer menu; color labels mark the row', items.includes('Convert to Smart Object') && items.includes('Layer Style…') && label === 'green' && /inset/.test(shadow), { items: items.length, label, shadow });

  await b.eval(`const { store } = window.__ps; store.newRasterLayer('Logo'); store.newRasterLayer('Headline'); store.newRasterLayer('Photo');`);
  await sleep(100);
  const inp = await b.eval(`const el = document.querySelector('.layer-search input'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 };`);
  await b.click(inp.x, inp.y);
  await b.send('Input.insertText', { text: 'head' });
  await sleep(120);
  const found = await b.eval(`return [...document.querySelectorAll('.layer-row .layer-name span')].map(s => s.textContent)`);
  await b.send('Input.insertText', { text: '' });
  await b.eval(`document.querySelector('.layer-search input').blur()`);
  check('layer search filters the list', found.join() === 'Headline', found);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
