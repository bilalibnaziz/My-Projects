// Tools and core editing flows, driven with real input through Chrome.
import { connect, sleep, ALT, META, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const setup = async (w = 800, h = 600, bg = 'white') => {
  await b.eval(`
    const { store, ops } = window.__ps;
    store.set({ dialog: null, paletteOpen: false });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(${w}, ${h}, '${bg}', 'Tools');
    store.newRasterLayer('Paint');
    store.set({ fg: '#000000', bg: '#ffffff' });
    store.setOpts({ size: 10, hardness: 1, opacity: 1, flow: 1, selFeather: 0, smoothing: 0, tolerance: 32, contiguous: true, sampleAll: true });
  `);
  await sleep(200);
};
const geo = () => b.eval(`
  const { store } = window.__ps;
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
// Pixel of the flattened document
const px = (x, y) => b.eval(`
  const { store } = window.__ps; const out = store.renderer.render(store.doc, store.overrides);
  const d = out.getContext('2d').getImageData(${x}, ${y}, 1, 1).data; return Array.from(d);
`);
const tool = (t) => b.eval(`window.__ps.store.setTool('${t}')`);
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);

// 1. Stabilizer on: still ends at release point, string drawn during stroke
await setup();
await b.eval(`window.__ps.store.setOpts({ smoothing: 0.6 })`);
await tool('brush');
let g = await geo();
{
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push(S(g, 100 + i * 20, 300 + Math.sin(i / 3) * 40));
  await b.drag(pts);
  const ext = await b.eval(`
    const c = window.__ps.store.activeLayer.canvas; const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let maxX = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y*c.width+x)*4+3] > 127 && x > maxX) maxX = x; return maxX;`);
  check('stabilized stroke still reaches release point', Math.abs(ext - 704.5) <= 2, ext);
}

// 2. Pen pressure changes width
await setup();
await tool('brush');
await b.eval(`window.__ps.store.setOpts({ size: 30, pressureSize: true })`);
g = await geo();
{
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push({ ...S(g, 100 + i * 30, 300), force: 0.1 + (i / 20) * 0.9 });
  await b.drag(pts, { pointerType: 'pen', force: 0.1 });
  const widths = await b.eval(`
    const c = window.__ps.store.activeLayer.canvas; const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const col = (x) => { let n = 0; for (let y = 0; y < c.height; y++) if (d[(y*c.width+x)*4+3] > 127) n++; return n; };
    return [col(130), col(400), col(680)];`);
  check('pen pressure: stroke widens with pressure', widths[0] < widths[1] && widths[1] < widths[2] && widths[2] >= 24, widths);
}

// 3. Lasso freehand
await setup();
await tool('lasso');
g = await geo();
{
  await b.drag([S(g, 100, 100), S(g, 300, 100), S(g, 300, 300), S(g, 100, 300), S(g, 100, 101)]);
  const bnd = await st(`store.doc.selection && store.doc.selection.bounds`);
  check('lasso selects the drawn area', bnd && Math.abs(bnd.x - 100) <= 1 && Math.abs(bnd.width - 200) <= 2 && Math.abs(bnd.height - 200) <= 2, bnd);
}

// 4. Polygonal lasso with clicks + double-click
await setup();
await tool('poly-lasso');
g = await geo();
{
  for (const [x, y] of [[100, 100], [400, 100], [250, 350]]) await b.click(S(g, x, y).x, S(g, x, y).y);
  const p = S(g, 250, 350);
  await b.click(p.x, p.y, { clickCount: 2 });
  await sleep(100);
  const bnd = await st(`store.doc.selection && store.doc.selection.bounds`);
  check('polygonal lasso closes on double-click', bnd && Math.abs(bnd.width - 300) <= 2 && Math.abs(bnd.height - 250) <= 2, bnd);
}

// 5. Magic wand on a filled square
await setup();
await b.eval(`const l = window.__ps.store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#ff0000'; c.fillRect(200, 150, 100, 80); window.__ps.store.renderer.invalidate(); window.__ps.store.emit();`);
await tool('wand');
g = await geo();
{
  await b.click(S(g, 250, 190).x, S(g, 250, 190).y);
  const bnd = await st(`store.doc.selection && store.doc.selection.bounds`);
  check('magic wand selects exactly the red square', bnd && bnd.x === 200 && bnd.y === 150 && bnd.width === 100 && bnd.height === 80, bnd);
}

// 6. Bucket fill
await setup();
await tool('bucket');
await b.eval(`window.__ps.store.set({ fg: '#00ff00' })`);
g = await geo();
{
  await b.click(S(g, 400, 300).x, S(g, 400, 300).y);
  check('bucket fills the clicked region with the foreground color', JSON.stringify(await px(10, 10)) === '[0,255,0,255]', await px(10, 10));
}

// 7. Eraser
await setup();
await b.eval(`const l = window.__ps.store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 800, 600); window.__ps.store.renderer.invalidate(); window.__ps.store.emit();`);
await tool('eraser');
g = await geo();
{
  await b.drag([S(g, 100, 300), S(g, 400, 300)]);
  const p = await b.eval(`const c = window.__ps.store.activeLayer.canvas; return c.getContext('2d').getImageData(250, 300, 1, 1).data[3]`);
  check('eraser clears pixels to transparent', p === 0, p);
}

// 8. Gradient
await setup();
await tool('gradient');
await b.eval(`window.__ps.store.set({ fg: '#ff0000', bg: '#0000ff' })`);
g = await geo();
{
  await b.drag([S(g, 100, 300), S(g, 400, 300), S(g, 700, 300)]);
  const a = await px(50, 300), c = await px(750, 300), m = await px(400, 300);
  check('gradient runs fg→bg along the drag', a[0] > 250 && a[2] < 5 && c[2] > 250 && c[0] < 5 && m[0] > 100 && m[2] > 100, { a, m, c });
}

// 9. Shape
await setup();
await tool('shape');
await b.eval(`window.__ps.store.setOpts({ shapeType: 'rectangle', shapeFill: true, shapeStrokeWidth: 0 })`);
g = await geo();
{
  await b.drag([S(g, 100, 100), S(g, 200, 150), S(g, 300, 250)]);
  const l = await st(`(() => { const l = store.activeLayer; return { kind: l.kind, x: l.x, y: l.y, w: l.width, h: l.height }; })()`);
  check('shape tool creates a vector layer matching the drag', l.kind === 'shape' && Math.abs(l.x - 100) < 1 && Math.abs(l.w - 200) < 1 && Math.abs(l.h - 150) < 1, l);
}

// 10. Text: click, type, escape
await setup();
await tool('text');
g = await geo();
{
  await b.click(S(g, 200, 200).x, S(g, 200, 200).y);
  await sleep(150);
  await b.send('Input.insertText', { text: 'Hello' });
  await sleep(100);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  const l = await st(`(() => { const l = store.activeLayer; return { kind: l.kind, text: l.text && l.text.text, editing: store.state.textEditId }; })()`);
  check('type tool: click, type, Esc creates the text layer', l.kind === 'text' && l.text === 'Hello' && !l.editing, l);
  await tool('move');
  await b.key('t');
  await sleep(50);
  const t = await st('store.state.tool');
  check('T key after editing text switches back to type tool (focus released)', t === 'text', t);
}

// 11. Crop: drag new rect, Enter
await setup();
await tool('crop');
await sleep(100);
g = await geo();
{
  await b.drag([S(g, 100, 100), S(g, 300, 200), S(g, 500, 400)]);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const d = await st(`({ w: store.doc.width, h: store.doc.height, crop: !!store.state.crop })`);
  check('crop to a dragged rectangle + Enter', d.w === 400 && d.h === 300 && !d.crop, d);
  await b.key('z', { modifiers: META, code: 'KeyZ' });
  const u = await st(`({ w: store.doc.width, h: store.doc.height })`);
  check('⌘Z restores the uncropped canvas', u.w === 800 && u.h === 600, u);
}

// 12. Free transform: ⌘T, drag corner, Enter
await setup();
await b.eval(`const l = window.__ps.store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(100, 100, 200, 100); window.__ps.store.renderer.invalidate(); window.__ps.store.emit(); window.__ps.store.setTool('move');`);
{
  await b.key('t', { modifiers: META, code: 'KeyT' });
  await sleep(100);
  const t0 = await st(`store.state.transform && { sx: store.state.transform.sx, sy: store.state.transform.sy, w: store.state.transform.source.width, h: store.state.transform.source.height }`);
  check('⌘T enters free transform around layer content', t0 && t0.sx === 100 && t0.sy === 100 && t0.w === 200 && t0.h === 100, t0);
  g = await geo();
  await b.drag([S(g, 300, 200), S(g, 400, 250), S(g, 500, 300)]);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const bb = await b.eval(`
    const l = window.__ps.store.activeLayer; const c = l.canvas; const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let minX=1e9,maxX=-1,minY=1e9,maxY=-1; for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) if (d[(y*c.width+x)*4+3]>127){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    return { x: minX + l.x, y: minY + l.y, w: maxX - minX + 1, h: maxY - minY + 1, transform: !!window.__ps.store.state.transform };`);
  check('dragging the corner scales proportionally from the opposite corner', Math.abs(bb.x - 100) <= 1 && Math.abs(bb.w - 400) <= 2 && Math.abs(bb.h - 200) <= 2 && !bb.transform, bb);
}

// 13. Clone stamp
await setup();
await b.eval(`const l = window.__ps.store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#f00'; c.fillRect(100, 100, 50, 50); window.__ps.store.renderer.invalidate(); window.__ps.store.emit();`);
await tool('clone');
await b.eval(`window.__ps.store.setOpts({ size: 20 })`);
g = await geo();
{
  await b.click(S(g, 125, 125).x, S(g, 125, 125).y, { modifiers: ALT });
  await b.drag([S(g, 425, 325), S(g, 426, 325)]);
  const p = await px(425, 325);
  check('clone stamp copies from the ⌥-clicked source', p[0] > 200 && p[1] < 50, p);
}

// 14. Spot heal removes a dark dot on a flat background
await setup(400, 300);
await b.eval(`const { store } = window.__ps; const bgL = store.doc.layers[0]; store.selectLayer(bgL.id);
  const c = bgL.canvas.getContext('2d'); c.fillStyle = '#808080'; c.fillRect(0,0,400,300); c.fillStyle = '#000'; c.beginPath(); c.arc(200,150,6,0,7); c.fill(); store.renderer.invalidate(); store.emit();`);
await tool('heal');
await b.eval(`window.__ps.store.setOpts({ size: 24 })`);
g = await geo();
{
  await b.drag([S(g, 196, 150), S(g, 204, 150)]);
  await b.waitFor(`!window.__ps.store.state.busy`, 20000);
  await sleep(200);
  const p = await px(200, 150);
  check('spot healing brush removes the blemish', Math.abs(p[0] - 128) < 20, p);
}

// 15. Dodge brightens
await setup(400, 300);
await b.eval(`const { store } = window.__ps; const bgL = store.doc.layers[0]; store.selectLayer(bgL.id); const c = bgL.canvas.getContext('2d'); c.fillStyle = '#808080'; c.fillRect(0,0,400,300); store.renderer.invalidate(); store.emit(); store.setOpts({ size: 30 });`);
await tool('dodge');
g = await geo();
{
  await b.drag([S(g, 100, 150), S(g, 300, 150)]);
  const p = await px(200, 150);
  check('dodge lightens', p[0] > 140, p);
}

// 17. Filter: Gaussian blur via dialog flow
await setup(200, 200);
await b.eval(`const l = window.__ps.store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0,0,100,200); window.__ps.store.renderer.invalidate(); window.__ps.store.emit();`);
{
  const ids = await b.eval(`const { FILTERS } = await import('/src/core/filters.ts'); return FILTERS.map(f => f.id + ':' + f.name);`);
  const blurId = ids.find((s) => /gauss|blur/i.test(s)).split(':')[0];
  await b.eval(`window.__ps.store.set({ dialog: { type: 'filter', filterId: '${blurId}' } })`);
  await sleep(600);
  const btn = await b.eval(`const bs = [...document.querySelectorAll('.modal-foot .btn.primary')]; const r = bs[bs.length-1].getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, t: bs[bs.length-1].textContent }`);
  await b.click(btn.x, btn.y);
  await b.waitFor(`!window.__ps.store.state.busy && !window.__ps.store.state.dialog`, 10000).catch(() => {});
  const p = await b.eval(`const c = window.__ps.store.activeLayer.canvas; return c.getContext('2d').getImageData(100, 100, 1, 1).data[3]`);
  check(`filter dialog "${btn.t}" applies ${blurId} (edge alpha softened)`, p > 20 && p < 235, { p, filters: ids.length });
}

// 18. Save/load project round-trip keeps layers & pixels
await setup();
await b.eval(`const { store } = window.__ps; const l = store.activeLayer; const c = l.canvas.getContext('2d'); c.fillStyle = '#123456'; c.fillRect(10,10,50,50); store.renderer.invalidate(); store.emit();`);
{
  const r = await b.eval(`
    const io = await import('/src/core/io.ts'); const { store } = window.__ps;
    const json = io.serializeProject(store.doc);
    const doc = await io.loadProject(json, 'Round');
    const c = doc.layers[1].canvas; const p = Array.from(c.getContext('2d').getImageData(20,20,1,1).data);
    return { layers: doc.layers.length, names: doc.layers.map(l => l.name), p, size: json.length };`);
  check('project save → load keeps layers and exact pixels', r.layers === 2 && JSON.stringify(r.p) === '[18,52,86,255]', r);
}

// 19. UI: tool rail click, layers eye toggle, menu click, command palette, new dialog
await setup();
{
  const btn = await b.eval(`const el = [...document.querySelectorAll('.tool-rail button')].find(b => (b.title||'').startsWith('Eraser')); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  await b.click(btn.x, btn.y);
  check('clicking a tool in the rail selects it', (await st('store.state.tool')) === 'eraser');

  const eye = await b.eval(`const el = document.querySelectorAll('.layer-list .eye')[0]; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  const vis0 = await st('store.doc.layers.map(l => l.visible)');
  await b.click(eye.x, eye.y);
  const vis1 = await st('store.doc.layers.map(l => l.visible)');
  check('clicking a layer eye toggles visibility', JSON.stringify(vis0) !== JSON.stringify(vis1), { vis0, vis1 });

  const menu = await b.eval(`const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit'); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  await b.click(menu.x, menu.y);
  await sleep(100);
  const item = await b.eval(`const el = [...document.querySelectorAll('button, [role=menuitem], div')].find(b => b.children.length <= 3 && b.textContent.trim().startsWith('Flip Object Horizontal')); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height/2 };`);
  if (item) await b.click(item.x, item.y);
  const hist = await st('store.doc.history[store.doc.hIndex].label');
  check('menu click runs a command (Edit ▸ Flip Object Horizontal)', /flip/i.test(hist), hist);

  await b.key('k', { modifiers: META, code: 'KeyK' });
  await sleep(150);
  await b.send('Input.insertText', { text: 'flip object vert' });
  await sleep(100);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const h2 = await st('store.doc.history[store.doc.hIndex].label');
  check('⌘K palette: type + Enter runs the command', /flip/i.test(h2) && !(await st('store.state.paletteOpen')), h2);

  await b.key('n', { modifiers: META, code: 'KeyN' });
  await sleep(200);
  const dlg = await st('store.state.dialog && store.state.dialog.type');
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(200);
  const docs = await st('store.state.docs.length');
  check('⌘N opens New dialog and Enter creates the document', dlg === 'new' && docs === 2, { dlg, docs });
  await b.key('Escape', { code: 'Escape', vk: 27 });
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
