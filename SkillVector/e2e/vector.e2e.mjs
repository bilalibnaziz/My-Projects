// Vector tools with real input: Shape Builder region picking, Divide and Outline Stroke.
import { connect, sleep, ALT } from './cdp.mjs';
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

// Two overlapping squares, both selected
const setup = async () => {
  await b.eval(`
    const { store, ops } = window.__ps;
    const { makeLayer } = await import('/src/core/types.ts');
    store.set({ dialog: null, paletteOpen: false });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(600, 400, 'white', 'Vector');
    const sq = (name, x, y, fill) => makeLayer({ kind: 'shape', name, x, y, width: 160, height: 160, shape: { shape: 'rectangle', fill, stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
    const a = sq('A', 100, 80, '#e33'), c = sq('B', 180, 160, '#33e');
    store.commit('Squares', { layers: [...store.doc.layers, a, c], activeId: c.id });
    store.setSelectedLayers([a.id, c.id]);
    store.setTool('shape-builder');
  `);
  await sleep(250);
};
// Document point → flattened pixel colour
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
  renderDocument(store.doc, t);
  return Array.from(t.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);
const shapes = () => b.eval(`return window.__ps.store.doc.layers.filter(l => l.kind === 'shape').length`);

// 1. Hovering highlights a region
await setup();
{
  const g = await geo();
  const p = S(g, 220, 200);
  await b.mouse('mouseMoved', p.x, p.y);
  await sleep(120);
  const hover = await b.eval(`return (await import('/src/core/tools.ts')).interaction.shapeBuilder?.hover ?? -1`);
  check('Shape Builder highlights the region under the pointer', hover >= 0, hover);
}

// 2. Dragging from the left-only part into the overlap merges those two regions
{
  const g = await geo();
  await b.drag([S(g, 130, 110), S(g, 160, 140), S(g, 200, 180), S(g, 220, 200)]);
  await sleep(250);
  const n = await shapes();
  const left = await px(130, 110);
  const mid = await px(220, 200);
  const rightOnly = await px(320, 300);
  // Merged piece keeps the colour of the region the drag started in (red); the blue-only part stays separate
  check('dragging across regions merges them into one shape', n === 2 && left[0] > 200 && mid[0] > 200 && mid[2] < 80 && rightOnly[2] > 200, { n, left, mid, rightOnly });
  await b.key('z', { modifiers: 4, code: 'KeyZ' });
  await sleep(200);
  check('⌘Z restores the original shapes', (await shapes()) === 2 && (await b.eval(`return window.__ps.store.doc.layers.filter(l => l.kind === 'shape').map(l => l.name).join()`)) === 'A,B');
}

// 3. ⌥-click deletes a region
await setup();
{
  const g = await geo();
  const p = S(g, 220, 200);
  await b.click(p.x, p.y, { modifiers: ALT });
  await sleep(250);
  const hole = await px(220, 200);
  check('⌥-click deletes the region under the pointer', (await shapes()) === 2 && hole[0] > 240 && hole[1] > 240 && hole[2] > 240, hole);
}

// 4. Divide and Outline Stroke from the Object menu commands
await setup();
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const { COMMANDS } = await import('/src/core/commands.ts');
    COMMANDS.find(c => c.id === 'pathfinder-divide').run();
    const divided = store.doc.layers.filter(l => l.kind === 'shape').length;
    const l = store.doc.layers.find(l => l.kind === 'shape');
    store.selectLayer(l.id);
    store.updateLayer(l.id, { shape: { ...l.shape, strokeWidth: 6, stroke: '#0a0' } });
    COMMANDS.find(c => c.id === 'outline-stroke').run();
    return { divided, names: store.doc.layers.map(x => x.name) };`);
  check('Divide splits into 3 shapes and Outline Stroke adds an outline layer', r.divided === 3 && r.names.some((n) => /Outlined$/.test(n)), r);
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
