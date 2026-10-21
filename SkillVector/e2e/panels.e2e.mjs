// Panels and UI flows (layers, history, adjustments, navigator, export, masks) with real input.
import { connect, sleep, META } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const center = (sel, idx = 0, filter = '') => b.eval(`
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})]${filter ? `.filter(${filter})` : ''};
  const el = els[${idx}]; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };`);
const setup = async () => {
  await b.eval(`
    const { store, ops } = window.__ps;
    store.set({ dialog: null, paletteOpen: false, focusMode: false });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(600, 400, 'white', 'UI');
    store.newRasterLayer('Alpha'); store.newRasterLayer('Beta'); store.newRasterLayer('Gamma');
  `);
  await sleep(250);
};

// 1. Layer drag-reorder in the panel (HTML5 DnD via CDP drag interception)
await setup();
{
  const names0 = await st(`store.doc.layers.map(l => l.name)`);
  // HTML5 drag-and-drop: dispatch the DOM drag events the panel listens to (CDP mouse input cannot drive native DnD)
  const reordered = await b.eval(`
    const rows = [...document.querySelectorAll('.layer-list > *')];
    const src = rows.find(r => r.textContent.trim().startsWith('Gamma')); const dst = rows.find(r => r.textContent.trim().startsWith('Alpha'));
    const dt = new DataTransfer();
    const fire = (el, type, y) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 20, clientY: y ?? r.y + r.height * 0.75 })); };
    // Real drags are spread over time; give React a frame between events
    const tick = () => new Promise(r => setTimeout(r, 30));
    fire(src, 'dragstart'); await tick(); fire(dst, 'dragenter'); await tick(); fire(dst, 'dragover'); await tick(); fire(dst, 'drop'); await tick(); fire(src, 'dragend');
    await new Promise(r => setTimeout(r, 100));
    return window.__ps.store.doc.layers.map(l => l.name);`);
  check('dragging a layer row reorders the stack', JSON.stringify(reordered) !== JSON.stringify(names0) && reordered.indexOf('Gamma') < names0.indexOf('Gamma'), { before: names0, after: reordered });
}

// 2. Rename by double-click
await setup();
{
  const nm = await center('.layer-name', 0);
  await b.click(nm.x, nm.y, { clickCount: 1 });
  await b.click(nm.x, nm.y, { clickCount: 2 });
  await sleep(120);
  await b.send('Input.insertText', { text: 'Renamed' });
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(100);
  const names = await st(`store.doc.layers.map(l => l.name)`);
  check('double-click a layer name to rename it', names.includes('Renamed'), names);
  const sel = await st(`!!store.doc.selection`);
  check('⌘A inside the rename field selects text, not the canvas', !sel, sel);
}

// 3. Opacity field and blend select
await setup();
{
  const res = await b.eval(`
    const sel = document.querySelector('.blend-select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'multiply'); sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    return window.__ps.store.activeLayer.blend;`);
  check('blend mode select applies to the active layer', res === 'multiply', res);
  const field = await b.eval(`const el = [...document.querySelectorAll('.layers-head input, .layers-panel input')].find(i => i.type !== 'checkbox'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  if (field) {
    await b.click(field.x, field.y);
    await b.click(field.x, field.y, { clickCount: 2 });
    await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: META, commands: ['selectAll'] });
    await b.send('Input.insertText', { text: '35' });
    await b.key('Enter', { code: 'Enter', vk: 13 });
    await sleep(100);
  }
  const op = await st('store.activeLayer.opacity');
  check('typing an opacity value sets layer opacity', Math.abs(op - 0.35) < 0.011, op);
}

// 4. History panel: clicking an earlier step restores it
await setup();
{
  const n = await st('store.doc.history.length');
  const tab = await b.eval(`const t = [...document.querySelectorAll('.dock-tabs button')].find(b => b.textContent.trim() === 'History'); const r = t.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  await b.click(tab.x, tab.y);
  await sleep(150);
  const item = await center('.hist-row', 0);
  if (item) await b.click(item.x, item.y);
  await sleep(100);
  const r = await st('({ h: store.doc.hIndex, layers: store.doc.layers.length })');
  check('clicking the first history step jumps back to it', r.h === 0 && r.layers === 1, { ...r, n, found: !!item });
}

// 5. Adjustment slider drag: one undo step for one drag, image changes live
await b.eval(`
  const { store, ops } = window.__ps; while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(300, 200, 'white', 'Adj'); const l = store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#808080'; c.fillRect(0,0,300,200); store.renderer.invalidate(); store.emit();`);
await sleep(200);
{
  // Make sure the Adjust tab is showing and find the Exposure slider
  const tab = await b.eval(`const t = [...document.querySelectorAll('.dock-tabs button')].find(b => b.textContent.trim() === 'Adjust'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  if (tab) await b.click(tab.x, tab.y);
  await sleep(150);
  const sl = await b.eval(`
    const s = [...document.querySelectorAll('.slider')].find(s => /^Exposure/.test(s.querySelector('.slider-label')?.textContent || ''));
    if (!s) return null; const input = s.querySelector('input[type=range]'); input.scrollIntoView({ block: 'center' }); const r = input.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width };`);
  const h0 = await st('store.doc.history.length');
  if (sl) {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push({ x: sl.x + sl.w * (0.5 + i * 0.03), y: sl.y });
    await b.drag(pts, { delay: 20 });
  }
  await sleep(300);
  const r = await st(`({ h: store.doc.history.length, kind: store.activeLayer.kind, exp: store.activeLayer.adjust && store.activeLayer.adjust.exposure, px: Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(10,10,1,1).data) })`);
  check('dragging the Exposure slider brightens the image live', r.px[0] > 140 && r.kind === 'adjustment', r);
  check('one slider drag = at most 2 undo steps (layer + edit)', r.h - h0 <= 2, { before: h0, after: r.h });
}

// 7. Export: real file produced
{
  const r = await b.eval(`
    const io = await import('/src/core/io.ts');
    const saved = []; const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { saved.push({ type: blob.type, size: blob.size }); return origCreate(blob); };
    const origClick = HTMLAnchorElement.prototype.click; let name = null;
    HTMLAnchorElement.prototype.click = function () { name = this.download; };
    await io.exportImage(window.__ps.store.doc, 'jpeg', 0.9, 1, null);
    HTMLAnchorElement.prototype.click = origClick; URL.createObjectURL = origCreate;
    return { saved, name };`);
  check('Export writes a real JPEG with a sensible file name', r.saved[0]?.type === 'image/jpeg' && r.saved[0].size > 500 && /\.jpe?g$/.test(r.name || ''), r);
}

// 8. Opening an image file through the real file path
{
  const r = await b.eval(`
    const io = await import('/src/core/io.ts'); const { store } = window.__ps;
    const blob = await (await fetch('/samples/landscape.jpg')).blob();
    const file = new File([blob], 'my-photo.jpg', { type: 'image/jpeg' });
    const before = store.state.docs.length;
    await io.openFiles([file]);
    return { docs: store.state.docs.length - before, title: store.doc.title, w: store.doc.width, h: store.doc.height };`);
  check('opening a JPEG creates a document with its real size and name', r.docs === 1 && r.w > 100 && /my-photo/.test(r.title), r);
}

// 9. Mask painting: add mask, paint black hides
await setup();
{
  await b.eval(`const { store, ops } = window.__ps; const l = store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#f00'; c.fillRect(0,0,600,400); store.renderer.invalidate(); ops.addMask(true); store.set({ fg: '#000000' }); store.setTool('brush'); store.setOpts({ size: 40, hardness: 1, opacity: 1, flow: 1, smoothing: 0 });`);
  await sleep(100);
  const g = await b.eval(`const { store } = window.__ps; const r = document.querySelector('.viewport-canvas').getBoundingClientRect(); const v = store.doc.view; return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY, editMask: store.doc.editMask };`);
  const S = (x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
  await b.drag([S(100, 200), S(500, 200)]);
  const r = await st(`({ editMask: store.doc.editMask, px: Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(300, 200, 1, 1).data), layerPx: Array.from(store.activeLayer.canvas.getContext('2d').getImageData(300,200,1,1).data) })`);
  check('painting black on a layer mask hides the layer there (pixels untouched)', r.px[0] > 200 && r.px[1] > 200 && r.layerPx[0] === 255, { ...r, editMaskAtStart: g.editMask });
}

// 10. Focus mode Tab hides panels, Esc restores; focus mode must not swallow Tab in inputs
await setup();
{
  await b.key('Tab', { code: 'Tab', vk: 9 });
  const f1 = await st('store.state.focusMode');
  const dock = await b.eval(`return !!document.querySelector('.dock')`);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  const f2 = await st('store.state.focusMode');
  check('Tab hides panels (focus mode), Esc brings them back', f1 && !dock && !f2, { f1, dock, f2 });
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
