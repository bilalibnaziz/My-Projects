// Move tool (Selection) with real pointer input: click to select, drag to move, handles to resize and
// rotate, marquee and empty-click deselect. Shapes and text must stay live (editable) throughout.
import { connect, sleep, SHIFT, ALT, META } from './cdp.mjs';
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
const layer = (name) => b.eval(`
  const l = window.__ps.store.doc.layers.find((l) => l.name === ${JSON.stringify(name)});
  return l && { id: l.id, kind: l.kind, x: l.x, y: l.y, width: l.width, height: l.height, rotation: l.rotation ?? 0, size: l.text?.size, boxWidth: l.text?.boxWidth };
`);
const state = () => b.eval(`
  const { store } = window.__ps;
  const ot = await import('/src/core/objectTransform.ts');
  return { active: store.activeLayer?.name, selected: store.selectedLayers.map((l) => l.name), visible: ot.frameVisible(), steps: store.doc.hIndex };
`);
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
  renderDocument(store.doc, t);
  return Array.from(t.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);

await b.eval(`
  const { store, ops } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  const { syncTextBounds } = await import('/src/core/render.ts');
  const { withLayer } = await import('/src/core/types.ts');
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Objects');
  const sq = (name, x, y, w, h, fill) => makeLayer({ kind: 'shape', name, x, y, width: w, height: h, shape: { shape: 'rectangle', fill, stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
  const a = sq('A', 100, 100, 200, 100, '#e33');
  const c = sq('B', 600, 400, 120, 120, '#33e');
  const t0 = makeLayer({ kind: 'text', name: 'Title', x: 120, y: 480, text: { text: 'Title', font: 'Inter', size: 40, weight: 700, italic: false, color: '#111111', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' } });
  const t = withLayer(t0, syncTextBounds(t0));
  store.commit('Setup', { layers: [...store.doc.layers, a, c, t], activeId: store.doc.layers[0].id });
  store.setOpts({ autoSelect: 'group', transformControls: true, lockAspect: true });
  store.setTool('move');
`);
await sleep(300);

// 1. A plain click selects the object under the pointer (no ⌘ needed)
{
  const g = await geo();
  const p = S(g, 200, 150);
  await b.click(p.x, p.y);
  await sleep(80);
  const st = await state();
  check('click selects the shape under the pointer', st.active === 'A' && st.visible, st);
}

// 2. Dragging it moves it
{
  const g = await geo();
  await b.drag([S(g, 200, 150), S(g, 230, 170), S(g, 260, 190)], { modifiers: 4 }); // ⌘: no snapping
  const l = await layer('A');
  check('drag moves the object', Math.abs(l.x - 160) < 1.5 && Math.abs(l.y - 140) < 1.5, l);
}

// 3. Bottom-right handle resizes (proportional by default, as the options-bar link is on)
{
  const g = await geo();
  const before = await layer('A');
  const se = S(g, before.x + before.width, before.y + before.height);
  // ⌘ drags freely (no snapping to other objects' edges), so the size is exact
  await b.drag([se, { x: se.x + 40, y: se.y + 10 }, { x: se.x + 100 * g.zoom, y: se.y + 20 * g.zoom }], { modifiers: META });
  const l = await layer('A');
  const ratio = l.width / l.height;
  check('corner handle resizes, keeping proportions', l.kind === 'shape' && Math.abs(l.width - 300) < 2 && Math.abs(ratio - 2) < 0.02 && Math.abs(l.x - before.x) < 0.5, l);
}

// 4. Shift frees the proportions
{
  const g = await geo();
  const before = await layer('A');
  const e = S(g, before.x + before.width, before.y + before.height / 2);
  await b.drag([e, { x: e.x - 10, y: e.y }, { x: e.x - 50 * g.zoom, y: e.y }], { modifiers: SHIFT | META });
  const l = await layer('A');
  check('side handle with Shift changes only the width', Math.abs(l.width - 250) < 2 && Math.abs(l.height - before.height) < 0.5, l);
}

// 5. Just outside a corner rotates — the shape stays a live shape with a rotation
{
  const g = await geo();
  const before = await layer('A');
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  const start = S(g, before.x + before.width + 8 / g.zoom, before.y - 8 / g.zoom);
  // Sweep 90° clockwise about the centre, then Shift snaps to 15° steps
  const r = Math.hypot(start.x - (g.left + g.panX + cx * g.zoom), start.y - (g.top + g.panY + cy * g.zoom));
  const a0 = Math.atan2(start.y - (g.top + g.panY + cy * g.zoom), start.x - (g.left + g.panX + cx * g.zoom));
  const pts = [start];
  for (let k = 1; k <= 6; k++) {
    const a = a0 + (k / 6) * (Math.PI / 2 + 0.03);
    pts.push({ x: g.left + g.panX + cx * g.zoom + r * Math.cos(a), y: g.top + g.panY + cy * g.zoom + r * Math.sin(a) });
  }
  await b.drag(pts, { modifiers: SHIFT });
  const l = await layer('A');
  check('rotate zone rotates, snapping to 15°, and the layer stays a shape', l.kind === 'shape' && Math.abs(l.rotation - 90) < 0.01 && Math.abs(l.x + l.width / 2 - cx) < 0.5, l);
  // Rotated 90°: the shape now covers a tall area through its centre
  const inTall = await px(Math.round(cx), Math.round(cy + l.width / 2 - 10));
  const outWide = await px(Math.round(cx + l.width / 2 - 10), Math.round(cy));
  check('the rotation is drawn', inTall[0] > 200 && inTall[1] < 80 && outWide[0] > 240 && outWide[1] > 240, { inTall, outWide });
}

// 6. Undo restores the unrotated shape in one step
{
  const before = await state();
  await b.key('z', { modifiers: 4 });
  await sleep(80);
  const l = await layer('A');
  const after = await state();
  check('one undo removes the rotation', l.rotation === 0 && after.steps === before.steps - 1, { l, before: before.steps, after: after.steps });
}

// 7. Clicking empty canvas deselects; Delete then does nothing
{
  const g = await geo();
  const p = S(g, 900, 80);
  await b.click(p.x, p.y);
  await sleep(80);
  const st = await state();
  await b.key('Backspace', { code: 'Backspace', vk: 8 });
  await sleep(80);
  const still = await layer('A');
  check('empty click deselects and Delete keeps the shape', !st.visible && !!still, st);
}

// 8. Marquee across both shapes selects both
{
  const g = await geo();
  await b.drag([S(g, 80, 60), S(g, 400, 300), S(g, 760, 560)]);
  await sleep(80);
  const st = await state();
  check('marquee selects every object it touches', st.selected.includes('A') && st.selected.includes('B') && st.selected.includes('Title') && st.visible, st);
}

// 9. Shift-click takes one out of the selection
{
  const g = await geo();
  const bl = await layer('B');
  const p = S(g, bl.x + 60, bl.y + 60);
  await b.click(p.x, p.y, { modifiers: SHIFT });
  await sleep(80);
  const st = await state();
  check('Shift-click toggles an object out', !st.selected.includes('B') && st.selected.includes('A'), st);
}

// 10. Text: dragging a corner scales the type and it stays editable text
{
  const g = await geo();
  const t = await layer('Title');
  const p = S(g, t.x + t.width / 2, t.y + t.height / 2);
  await b.click(p.x, p.y);
  await sleep(80);
  const se = S(g, t.x + t.width, t.y + t.height);
  await b.drag([se, { x: se.x + 10, y: se.y + 10 }, { x: se.x + t.width * g.zoom, y: se.y + t.height * g.zoom }]);
  const l = await layer('Title');
  check('text corner drag doubles the point size, still text', l.kind === 'text' && Math.abs(l.size - 80) < 1.5, l);
}

// 11. Alt-drag drags a copy
{
  const g = await geo();
  const bl = await layer('B');
  const p = S(g, bl.x + 60, bl.y + 60);
  const count0 = await b.eval(`return window.__ps.store.doc.layers.length`);
  await b.drag([p, { x: p.x - 20, y: p.y }, { x: p.x - 200 * g.zoom, y: p.y }], { modifiers: ALT });
  const count1 = await b.eval(`return window.__ps.store.doc.layers.length`);
  const orig = await layer('B');
  check('Alt-drag leaves the original and moves a copy', count1 === count0 + 1 && Math.abs(orig.x - 600) < 0.5, { count0, count1, orig });
}

// 12. Double-click text edits it in place
{
  const g = await geo();
  await b.eval(`window.__ps.store.setTool('move')`);
  const t = await layer('Title');
  const p = S(g, t.x + t.width / 2, t.y + t.height / 2);
  await sleep(400);
  await b.click(p.x, p.y);
  await b.click(p.x, p.y, { clickCount: 2 });
  await sleep(120);
  const editing = await b.eval(`const s = window.__ps.store.state; return s.textEditId === s.docs.find((d) => d.id === s.activeDocId).layers.find((l) => l.name === 'Title').id && !!document.querySelector('.text-editor')`);
  check('double-click text opens the in-place editor', editing, editing);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
