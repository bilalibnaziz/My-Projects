// Layer groups: ⌘G / ⇧⌘G, the Layers panel tree (collapse, folder rows), group visibility,
// opacity and styles, dragging a whole group with the Move tool, merge, delete, save / load.
import { connect, sleep, META, CTRL, SHIFT } from './cdp.mjs';
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
const rowNames = () => b.eval(`return [...document.querySelectorAll('.layer-row .layer-name span')].map(s => s.textContent)`);
const flat = () => st(`store.doc.layers.map(l => l.name).join(',')`);

// White 400×300 page with a red (A) and a blue (B) square
await b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(400, 300, 'white', 'Groups', undefined);`);
await sleep(150);
await b.eval(`
  const { store } = window.__ps;
  const square = (name, x, color) => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 60;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 60, 60);
    return store.newRasterLayer(name, { canvas: c, x, y: 100 });
  };
  square('A', 50, '#ff0000');
  square('B', 200, '#0000ff');
`);
await sleep(100);

// 1. Select both and ⌘G
{
  await b.eval(`const { store } = window.__ps; const ids = store.doc.layers.filter(l => l.name === 'A' || l.name === 'B').map(l => l.id); store.setSelectedLayers(ids);`);
  await b.key('g', { modifiers: MOD });
  await sleep(150);
  const r = await st(`({ active: store.activeLayer.kind, name: store.activeLayer.name, kids: store.doc.layers.filter(l => l.parent === store.activeLayer.id).map(l => l.name) })`);
  const rows = await rowNames();
  const indented = await b.eval(`return [...document.querySelectorAll('.layer-row')].filter(r => r.style.paddingLeft).length`);
  check('⌘G groups the selected layers; the panel shows the group with its layers indented', r.active === 'group' && r.kids.join() === 'A,B' && rows.join() === 'Group 1,B,A,Background' && indented === 2, { r, rows, indented });
}

// 2. Hiding the group hides its contents; group opacity fades them
{
  const gid = await st(`store.activeLayer.id`);
  await b.eval(`const { store } = window.__ps; store.updateLayer('${gid}', { visible: false }, 'Hide');`);
  await sleep(100);
  const hidden = await docPx(80, 130);
  await b.eval(`const { store } = window.__ps; store.updateLayer('${gid}', { visible: true, opacity: 0.5 }, 'Show');`);
  await sleep(100);
  const half = await docPx(80, 130);
  await b.eval(`const { store } = window.__ps; store.updateLayer('${gid}', { opacity: 1 }, 'Opacity');`);
  check('hidden group hides its layers; 50% group opacity fades them', hidden.join() === '255,255,255,255' && Math.abs(half[1] - 128) <= 2 && half[0] === 255, { hidden, half });
}

// 3. Collapse hides the children rows
{
  const p = await b.eval(`const el = document.querySelector('.group-chevron'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.click(p.x, p.y);
  await sleep(120);
  const collapsed = await rowNames();
  await b.click(p.x, p.y);
  await sleep(120);
  const open = await rowNames();
  check('the chevron collapses and expands the group', collapsed.join() === 'Group 1,Background' && open.length === 4, { collapsed, open });
}

// 4. Move tool drags the whole group (both squares move, then baked into the layers)
{
  await b.key('v');
  const g = await geo();
  const from = S(g, 80, 130);
  const to = S(g, 80 + 20, 130 + 30);
  // No ⌘ here: ⌘-drag would pick the layer under the cursor instead of the group
  await b.drag([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]);
  await sleep(150);
  const r = await st(`({ A: (l => [l.x, l.y])(store.doc.layers.find(l => l.name === 'A')), B: (l => [l.x, l.y])(store.doc.layers.find(l => l.name === 'B')), G: (l => [l.x, l.y])(store.doc.layers.find(l => l.kind === 'group')) })`);
  const moved = await docPx(240, 150);
  check('dragging a group moves every layer in it', r.A.join() === '70,130' && r.B.join() === '220,130' && r.G.join() === '0,0' && moved.join() === '0,0,255,255', { r, moved });
  await b.key('z', { modifiers: MOD });
  await sleep(120);
  const back = await st(`store.doc.layers.find(l => l.name === 'A').x`);
  check('undo puts the group back', back === 50, { back });
}

// 5. Styles on a group apply to the composite (stroke around both squares)
{
  await b.eval(`const m = await import('/src/core/layerStyle.ts'); m.setEffect('stroke', { enabled: true, size: 5, color: '#00ff00', position: 'outside' });`);
  await sleep(150);
  const ring = await docPx(47, 130);
  const between = await docPx(150, 130);
  check('a stroke on the group outlines its contents', ring.join() === '0,255,0,255' && between.join() === '255,255,255,255', { ring, between });
  await b.eval(`const m = await import('/src/core/layerStyle.ts'); m.clearStyle();`);
}

// 6. Drop a layer into / out of the group, Bring Forward inside the group
{
  await b.eval(`const { store, ops } = window.__ps; const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d').fillStyle = '#000'; c.getContext('2d').fillRect(0,0,20,20); store.selectLayer(store.doc.layers[0].id); store.newRasterLayer('C', { canvas: c, x: 300, y: 20 });`);
  await sleep(80);
  const before = await flat();
  await b.eval(`const { store, ops } = window.__ps; const g = store.doc.layers.find(l => l.kind === 'group'); const c = store.doc.layers.find(l => l.name === 'C'); ops.dropLayer(c.id, g.id, 'into');`);
  await sleep(80);
  const into = await flat();
  await b.eval(`const { store, ops } = window.__ps; store.selectLayer(store.doc.layers.find(l => l.name === 'A').id); ops.shiftLayer(1);`);
  await sleep(80);
  const shifted = await flat();
  check('drop into a group and Bring Forward among siblings', before === 'Background,C,A,B,Group 1' && into === 'Background,A,B,C,Group 1' && shifted === 'Background,B,A,C,Group 1', { before, into, shifted });
}

// 7. Ungroup (⇧⌘G) keeps the layers and their order
{
  await b.eval(`const { store } = window.__ps; store.selectLayer(store.doc.layers.find(l => l.kind === 'group').id);`);
  await b.key('g', { modifiers: MOD | SHIFT });
  await sleep(120);
  const r = await st(`({ names: store.doc.layers.map(l => l.name).join(','), parents: store.doc.layers.filter(l => l.parent).length })`);
  check('⇧⌘G ungroups and keeps the order', r.names === 'Background,B,A,C' && r.parents === 0, r);
  await b.key('z', { modifiers: MOD });
  await sleep(100);
}

// 8. Groups survive save / load; duplicate copies the contents; delete removes them
{
  const r = await b.eval(`
    const io = await import('/src/core/io.ts');
    const { store, ops } = window.__ps;
    const json = io.serializeProject(store.doc);
    const doc = await io.loadProject(json, 'Reloaded');
    const g = doc.layers.find(l => l.kind === 'group');
    const kids = doc.layers.filter(l => l.parent === g.id).map(l => l.name).join(',');
    store.selectLayer(g.id);
    ops.duplicateLayer();
    const groups = store.doc.layers.filter(l => l.kind === 'group').length;
    const total = store.doc.layers.length;
    ops.deleteLayer();
    return { kids, groups, total, after: store.doc.layers.length };
  `);
  check('save / load keeps groups; duplicate copies the contents; delete removes them', r.kids === 'B,A,C' && r.groups === 2 && r.total === 9 && r.after === 5, r);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
