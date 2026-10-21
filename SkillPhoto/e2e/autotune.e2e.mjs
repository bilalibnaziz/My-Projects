// Auto Tune (intent presets, swap in place, strength, Auto Color, white-balance picker) and the
// tool-aware Properties card (settings per tool, selection modes, social crop ratios). Real clicks.
import { connect, sleep, META, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const px = (x, y) => b.eval(`
  const { store } = window.__ps; const out = store.renderer.render(store.doc, store.overrides);
  return Array.from(out.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);`);
const openProps = () => b.eval(`const t = [...document.querySelectorAll('.dock-tabs button')].find((e) => /propert/i.test(e.textContent)); if (t && !t.classList.contains('active')) t.click(); return !!t`);
const spread = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
const center = (sel) => b.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
const clickSel = async (sel) => {
  const p = await center(sel);
  if (!p) throw new Error('missing ' + sel);
  await b.click(p.x, p.y);
  await sleep(200);
};
const geo = () => b.eval(`
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = window.__ps.store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const drag = async (pts, opts = {}) => {
  const g = await geo();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, c] = [pts[i], pts[i + 1]];
    for (let k = 0; k < 8; k++) out.push(S(g, a[0] + ((c[0] - a[0]) * k) / 8, a[1] + ((c[1] - a[1]) * k) / 8));
  }
  out.push(S(g, ...pts[pts.length - 1]));
  await b.drag(out, { delay: 4, ...opts });
  await sleep(150);
};

// A dim photo under warm (tungsten-ish) light: grey card, grey ramp, colour patches
await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(600, 400, 'white', 'Tune');
  const c = store.activeLayer.canvas; const x = c.getContext('2d');
  const cast = [1.18, 1.0, 0.72];
  const put = (r, g, b) => 'rgb(' + Math.round(20 + r * 0.55 * cast[0]) + ',' + Math.round(20 + g * 0.55 * cast[1]) + ',' + Math.round(20 + b * 0.55 * cast[2]) + ')';
  for (let i = 0; i < 600; i++) { const v = (i / 599) * 255; x.fillStyle = put(v, v, v); x.fillRect(i, 0, 1, 200); }
  const cols = [[200, 70, 50], [70, 160, 80], [60, 90, 200], [128, 128, 128], [230, 200, 80], [210, 160, 130]];
  cols.forEach((col, i) => { x.fillStyle = put(...col); x.fillRect(i * 100, 200, 100, 200); });
  const { touch } = await import('/src/core/canvas.ts'); touch(c);
  store.setTool('move');
  store.set({ rightTab: 'adjust' });
  store.invalidateRender(); store.emit();
  let cv = null;
  for (let i = 0; i < 50 && !cv; i++) { await new Promise((r) => setTimeout(r, 30)); cv = document.querySelector('.viewport-canvas'); }
  const v = store.doc.view; v.zoom = 1; v.panX = Math.round((cv.clientWidth - 600) / 2); v.panY = Math.round((cv.clientHeight - 400) / 2);
  store.emit();
  return true;
`);
await sleep(300);
const grey0 = await px(350, 300);
const mid0 = await px(300, 100);

// 1. The Auto Tune card is in the Adjust panel; clicking Food adds one editable "Auto · Food" layer
await b.openTab('Adjust');
await b.waitFor(`!!document.querySelector('[data-testid="autotune"]')`, 5000).catch(() => {});
await clickSel('.autotune-chip[data-intent="food"]');
const l1 = await st(`store.doc.layers.filter((l) => l.name.startsWith('Auto · ')).map((l) => [l.name, l.adjust.exposure, l.adjust.temperature, l.adjust.vibrance])`);
const mid1 = await px(300, 100);
check('Food chip adds one editable Auto · Food adjustment layer that brightens the dim photo', l1.length === 1 && l1[0][0] === 'Auto · Food' && mid1[1] > mid0[1] + 10, { l1, mid0, mid1 });

// 2. Product swaps the same layer (no stacking) and neutralises the grey card
await clickSel('.autotune-chip[data-intent="product"]');
const l2 = await st(`store.doc.layers.filter((l) => l.name.startsWith('Auto · ')).map((l) => l.name)`);
const grey2 = await px(350, 300);
check('Product swaps the Auto layer in place and makes the grey card neutral', l2.length === 1 && l2[0] === 'Auto · Product' && spread(grey2) < 12 && spread(grey0) > 30, { l2, grey0, grey2 });

// 3. Food keeps more warmth than Product on the same photo
await clickSel('.autotune-chip[data-intent="food"]');
const greyFood = await px(350, 300);
check('Food stays warmer than Product (red − blue on the grey card)', greyFood[0] - greyFood[2] > grey2[0] - grey2[2] + 5, { greyFood, grey2 });

// 4. Strength 0 is a no-op
await b.eval(`const m = await import('/src/core/tuneOps.ts'); m.applyIntent('food', 0); return true`);
await sleep(150);
const grey4 = await px(350, 300);
check('Strength 0 leaves the photo unchanged', Math.max(...grey4.map((v, i) => Math.abs(v - grey0[i]))) <= 2, { grey0, grey4 });
await b.eval(`const { store, ops } = window.__ps; ops.deleteLayer(); store.setActiveLayer?.(store.doc.layers[0].id); return true`);
await b.eval(`const { store } = window.__ps; store.doc.activeId = store.doc.layers[0].id; store.emit(); return true`);

// 5. White-balance eyedropper picked from the options bar, then a click on the grey card
await b.eval(`window.__ps.store.setTool('eyedropper'); return true`);
await sleep(100);
await b.eval(`
  const s = [...document.querySelectorAll('.options-bar select')].find((e) => [...e.options].some((o) => o.value === 'wb'));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, 'wb');
  s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
await sleep(100);
await openProps();
await sleep(150);
const card = await b.eval(`const c = document.querySelector('[data-testid="tool-card"]'); return c ? c.textContent : null`);
{
  const g = await geo();
  const p = S(g, 350, 300);
  await b.click(p.x, p.y);
  await sleep(250);
}
const wb = await st(`(() => { const l = store.doc.layers.find((l) => l.name === 'White Balance'); return l ? [l.adjust.temperature, l.adjust.tint, !!l.adjust.curves] : null })()`);
const grey5 = await px(350, 300);
check('WB eyedropper click on the grey card adds a White Balance layer that makes it neutral', !!wb && spread(grey5) <= 4, { wb, grey0, grey5 });
check('Properties shows the eyedropper in white-balance mode', !!card && card.includes('White balance') && card.includes('neutral'), card?.slice(0, 160));
await b.eval(`window.__ps.store.setOpts({ eyedropperMode: 'color' }); return true`);

// 6. ⇧⌘B runs Auto Color as an adjustment layer
await b.key('b', { modifiers: META | SHIFT });
await sleep(200);
const ac = await st(`store.doc.layers.some((l) => l.name === 'Auto Color')`);
check('⇧⌘B adds an Auto Color adjustment layer', ac);

// 7. Tool card follows the active tool
const cardFor = async (tool) => {
  await b.eval(`window.__ps.store.setTool(${JSON.stringify(tool)}); return true`);
  await openProps();
  await sleep(200);
  return b.eval(`const c = document.querySelector('[data-testid="tool-card"]'); return c ? { tool: c.dataset.tool, text: c.textContent } : null`);
};
const qs = await cardFor('quick-select');
const os = await cardFor('object-select');
const crop = await cardFor('crop');
const brush = await cardFor('brush');
check(
  'Properties tool card changes with the tool (Quick Selection, Object Selection, Crop, Brush)',
  qs?.tool === 'quick-select' && qs.text.includes('Snap to object edges') && qs.text.includes('Select and Mask') &&
    os?.tool === 'object-select' && os.text.includes('box an object') &&
    crop?.tool === 'crop' && crop.text.includes('9:16') && crop.text.includes('1.91:1') &&
    brush?.tool === 'brush' && brush.text.includes('Hardness') && brush.text.includes('Flow'),
  { qs: qs?.text.slice(0, 80), crop: crop?.text.slice(0, 80) }
);

// 8. Crop chip 1:1 makes a square crop box
await cardFor('crop');
await b.eval(`[...document.querySelectorAll('[data-testid="tool-card"] .preset-chip')].find((e) => e.textContent === '1:1').click(); return true`);
await sleep(150);
const cr = await st(`store.state.crop?.rect`);
check('Crop chip 1:1 makes a square crop box', !!cr && Math.abs(cr.width - cr.height) <= 1, cr);
await b.eval(`const t = await import('/src/core/tools.ts'); t.cancelCrop(); window.__ps.store.setOpts({ cropRatio: 'free' }); return true`);

// 9. Selection mode "Add" from the Properties card: two plain drags add up
await cardFor('marquee-rect');
await b.eval(`window.__ps.ops.deselect(); return true`);
await b.eval(`[...document.querySelectorAll('[data-testid="tool-card"] .sel-modes button')].find((e) => e.textContent.includes('Add')).click(); return true`);
await sleep(100);
await drag([[20, 20], [120, 120]]);
await drag([[300, 200], [400, 300]]);
const area = await b.eval(`
  const d = window.__ps.store.doc; const a = d.selection.canvas.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  let n = 0; for (let i = 3; i < a.length; i += 4) if (a[i] >= 128) n++; return n;`);
const status = await b.eval(`return document.querySelector('.tool-card-status')?.textContent ?? ''`);
check('Selection mode Add: two drags without modifiers make one combined selection', Math.abs(area - 20000) < 900 && status.startsWith('Adding'), { area, status });
await b.eval(`window.__ps.store.setOpts({ selMode: 'replace' }); return true`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
